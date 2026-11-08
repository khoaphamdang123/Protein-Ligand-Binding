"""Build the static data of the Explore page (AdaBind vs bindEmbed21DL vs bindNode24 on TestSet300 / TestSetNew46).

    backend/.venv/bin/python backend/scripts/explore_data/fetch_sources.py   # once: raw inputs from Drive
    backend/.venv/bin/python backend/scripts/explore_data/fetch_names.py     # once: protein names
    backend/.venv/bin/python backend/scripts/explore_data/build.py           # -> public/explore-data/

Nothing is written unless every check passes. The checks rebuild the published numbers from the residue-level
data, so a wrong index base, protein order, label file or threshold cannot slip through:

  sequences   canonical FASTA == label FASTA == AdaBind csv residues == ESMFold PDB (chain A, residues 1..L)
  labels      label files == AdaBind y_true (metal, nuclear) == baseline per-protein TP+FN (metal, nuclear, small)
              DNA / RNA: the BioLiP protein-level rule of notebooks 12/13 applied to the nuclear labels
              (kind dna|both -> nuclear label, otherwise 0) == AdaBind y_true, and y_dna | y_rna == nuclear
  baselines   per-protein TP/FP/TN/FN at 0.5 == FULL_DIRECT_PER_PROTEIN_300_46.csv (every protein, exact)
  metrics     AUPRC, AUROC, precision, recall, F1, MCC of all 3 models == adabind CI_ALL_8_METRICS_B10000.csv
              (metal, small, dna, rna), SUMMARY.csv + FULL_DIRECT_BASELINE_METRICS (nuclear), within 1e-9
  thresholds  manifest.json == FINAL_MODELS.json == FINAL_DECISION.json == CI table

Output (public/explore-data/):
  index.json                 datasets, thresholds, model notes, per-split metrics, one row per protein
  proteins/<id>.json         sequence, pLDDT, labels and, per model and ligand class, probabilities, calls and metrics
  structures/<id>.pdb.gz     ESMFold structure used by AdaBind (B-factor = pLDDT 0..1)
"""
import gzip
import hashlib
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, matthews_corrcoef, roc_auc_score

REPO = Path(__file__).resolve().parents[3]
SRC = REPO / "explore_sources"
BL = REPO / "baselines_2124"
ADA = REPO / "adabind"
PDB_DIR = REPO / "foundation_models" / "esmfold_files"
OUT = REPO / "public" / "explore-data"

SPLITS = ("TestSet300", "TestSetNew46")
LIGANDS = ("metal", "small", "dna", "rna")    # the ligand classes shown on the page
CHECKED = ("metal", "small", "nuclear", "dna", "rna")  # + nuclear: kept to check against the published numbers
BASE_LIGANDS = ("metal", "small", "nuclear")  # the only outputs bindEmbed21DL / bindNode24 have
MODELS = ("adabind", "bindEmbed21DL", "bindNode24")
BASELINES = ("bindEmbed21DL", "bindNode24")
BASELINE_THRESHOLD = 0.5
AA3 = {"ALA": "A", "ARG": "R", "ASN": "N", "ASP": "D", "CYS": "C", "GLN": "Q", "GLU": "E", "GLY": "G", "HIS": "H", "ILE": "I",
       "LEU": "L", "LYS": "K", "MET": "M", "PHE": "F", "PRO": "P", "SER": "S", "THR": "T", "TRP": "W", "TYR": "Y", "VAL": "V"}
TOL = 1e-9

failures: list[str] = []
passes: list[str] = []


def check(ok: bool, what: str) -> bool:
    (passes if ok else failures).append(what)
    if not ok:
        print("FAIL", what)
    return ok


# ---------------------------------------------------------------- readers

def read_fasta(path: Path) -> dict[str, str]:
    out, key = {}, None
    for line in path.read_text().splitlines():
        line = line.strip()
        if line.startswith(">"):
            key = line[1:].split()[0]
            out[key] = ""
        elif key:
            out[key] += line
    return out


def read_label_file(path: Path) -> dict[str, set[int]]:
    """'<id>\\t<comma separated 1-based positions>' per line (trailing comma allowed)."""
    out = {}
    for line in path.read_text().splitlines():
        parts = line.split("\t")
        if parts[0].strip():
            out[parts[0].strip()] = {int(x) for x in (parts[1].split(",") if len(parts) > 1 else []) if x.strip()}
    return out


def read_pdb(path: Path) -> tuple[str, list[float], list[int]]:
    """Chain A CA atoms -> (sequence, pLDDT 0..1, residue numbers)."""
    seq, plddt, nums = [], [], []
    for line in path.read_text().splitlines():
        if line.startswith("ATOM") and line[12:16].strip() == "CA" and line[21] == "A":
            seq.append(AA3.get(line[17:20], "X"))
            plddt.append(float(line[60:66]))
            nums.append(int(line[22:26]))
    return "".join(seq), plddt, nums


def split_by(ids: list[str], seqs: dict[str, str], flat: np.ndarray) -> dict[str, np.ndarray]:
    out, k = {}, 0
    for i in ids:
        out[i] = flat[k:k + len(seqs[i])]
        k += len(seqs[i])
    assert k == len(flat), f"concatenated length {len(flat)} != sum of sequence lengths {k}"
    return out


def per_protein_csv(path: Path, ids, seqs, base: int, prob_col: str, aa_col: str | None, label_col: str | None, what: str):
    """Residue-level csv -> {id: prob array}, {id: label array}; checks residue indices and amino acids."""
    df = pd.read_csv(path)
    probs, labs = {}, {}
    ok_idx = ok_aa = True
    for pid, g in df.groupby("prot_id", sort=False):
        g = g.sort_values("residue_index")
        L = len(seqs.get(pid, ""))
        ok_idx &= list(g.residue_index) == list(range(base, base + L))
        if aa_col:
            ok_aa &= "".join(g[aa_col]) == seqs[pid]
        probs[pid] = g[prob_col].to_numpy(float)
        if label_col:
            labs[pid] = g[label_col].to_numpy(int)
    check(set(probs) == set(ids), f"{what}: covers exactly the split's proteins")
    check(ok_idx, f"{what}: residue_index is {base}-based and contiguous for every protein")
    if aa_col:
        check(ok_aa, f"{what}: residue letters equal the canonical sequence")
    return probs, labs


# ---------------------------------------------------------------- metrics

def confusion(y: np.ndarray, pred: np.ndarray) -> dict:
    tp = int(((y == 1) & pred).sum()); fp = int(((y == 0) & pred).sum())
    fn = int(((y == 1) & ~pred).sum()); tn = int(((y == 0) & ~pred).sum())
    return {"TP": tp, "FP": fp, "TN": tn, "FN": fn}


def global_metrics(y: np.ndarray, p: np.ndarray, thr: float) -> dict:
    pred = p >= thr
    c = confusion(y, pred)
    prec = c["TP"] / (c["TP"] + c["FP"]) if c["TP"] + c["FP"] else 0.0
    rec = c["TP"] / (c["TP"] + c["FN"]) if c["TP"] + c["FN"] else 0.0
    f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
    return {"AUPRC": float(average_precision_score(y, p)), "AUROC": float(roc_auc_score(y, p)),
            "precision": prec, "recall": rec, "F1": f1, "MCC": float(matthews_corrcoef(y, pred)),
            "threshold": thr, "n_residues": int(len(y)), "n_positive": int(y.sum()), **c}


def protein_metrics(y: np.ndarray, p: np.ndarray, thr: float) -> dict:
    """Metrics of one protein for the page, rounded to 6 decimals."""
    m = global_metrics(y, p, thr)
    return {k: round(v, 6) if isinstance(v, float) else v for k, v in m.items() if k not in ("n_residues", "n_positive", "threshold")}


# ---------------------------------------------------------------- build

def main() -> int:
    for p in (SRC, BL, ADA, PDB_DIR, SRC / "names" / "protein_names.json"):
        if not p.exists():
            print(f"missing input: {p}  (see the docstring for how to get it)")
            return 1

    names = json.loads((SRC / "names" / "protein_names.json").read_text())
    manifest = json.loads((ADA / "final_model" / "manifest.json").read_text())["profiles"]["final"]
    thr = {t: float(manifest[t]["threshold"]) for t in CHECKED}
    rules = {t: manifest[t].get("threshold_rule", "") for t in CHECKED}
    kinds = pd.read_csv(ADA / "decisions/evaluation_bootstrap_B10000/DNA_RNA_PROTEIN_KINDS.csv")
    kinds["prot_id"] = kinds.prot_id.astype(str)

    # thresholds agree everywhere they are written down
    fm = json.loads((SRC / "adabind/final3/FINAL_MODELS.json").read_text())
    for t in ("nuclear", "dna", "rna"):
        check(abs(fm[t]["threshold"] - thr[t]) < TOL, f"threshold {t}: manifest == FINAL_MODELS.json")
    fd_small = json.loads((SRC / "adabind/small/FINAL_DECISION.json").read_text())
    check(abs(fd_small["dev_mcc_threshold"] - thr["small"]) < TOL, "threshold small: manifest == FINAL_DECISION.json")
    ci = pd.read_csv(ADA / "decisions/evaluation_bootstrap_B10000/CI_ALL_8_METRICS_B10000.csv")
    for t in ("metal", "small", "dna", "rna"):
        v = ci[ci.task == t].new_threshold.unique()
        check(len(v) == 1 and abs(v[0] - thr[t]) < TOL, f"threshold {t}: manifest == CI table")
        rv = ci[(ci.task == t) & ci.ref_model.isin(BASELINES)].ref_threshold.unique()
        check(len(rv) == 1 and abs(rv[0] - BASELINE_THRESHOLD) < TOL, f"baseline threshold for {t} in CI table == 0.5")

    data = {}  # split -> dict
    for split in SPLITS:
        ids = [l.strip() for l in (BL / f"canonical/{split}_ids.txt").read_text().splitlines() if l.strip()]
        seqs = read_fasta(BL / f"canonical/{split}.fasta")
        check(list(seqs) == ids, f"{split}: canonical FASTA ids == id list (same order)")

        # ---- sequences from every other source
        if split == "TestSet300":
            other = read_fasta(SRC / "labels/TestSet300/all.fasta")
            lab_files = {t: SRC / f"labels/TestSet300/binding_residues_2.5_{t}.txt" for t in BASE_LIGANDS}
        else:
            other = read_fasta(SRC / "labels/TestSetNew46/indep_set.fasta")
            indep = [l.strip() for l in (SRC / "labels/TestSetNew46/indep_set.txt").read_text().splitlines() if l.strip()]
            check(sorted(indep) == sorted(ids), "TestSetNew46: indep_set.txt == canonical id list")
            lab_files = {t: SRC / f"labels/TestSetNew46/binding_residues_{t}.txt" for t in BASE_LIGANDS}
        check(all(other.get(i) == seqs[i] for i in ids), f"{split}: canonical sequences == label-set FASTA")
        check(all(set(s) <= set(AA3.values()) for s in seqs.values()), f"{split}: only the 20 standard amino acids")

        # ---- ground truth: metal / small / nuclear from the label files (1-based positions)
        gt = {t: {} for t in CHECKED}
        for t in BASE_LIGANDS:
            lf = read_label_file(lab_files[t])
            ok = True
            for i in ids:
                pos = lf.get(i, set())
                ok &= all(1 <= x <= len(seqs[i]) for x in pos)
                y = np.zeros(len(seqs[i]), int)
                y[[x - 1 for x in pos]] = 1
                gt[t][i] = y
            check(ok, f"{split} {t}: every label position lies inside its sequence")

        # ---- AdaBind residue predictions
        ada, ada_y = {}, {}
        ada["metal"], lab_metal = per_protein_csv(SRC / f"adabind/metal/{split}.csv.gz", ids, seqs, 0, "probability", "AA", "label", f"{split} adabind metal")
        check(all((lab_metal[i] == gt["metal"][i]).all() for i in ids), f"{split}: adabind metal labels == label file")
        for t in ("nuclear", "dna", "rna"):
            ada[t], y = per_protein_csv(SRC / f"adabind/final3/{t}__{split}__residue_predictions.csv.gz", ids, seqs, 1, "probability", "aa", "y_true", f"{split} adabind {t}")
            if t == "nuclear":
                check(all((y[i] == gt["nuclear"][i]).all() for i in ids), f"{split}: adabind nuclear y_true == label file")
            else:
                ada_y[t] = y
        members = []
        for name, w in zip(fd_small["members"], fd_small["weights"]):
            if name.endswith("_bag3"):
                arr = np.mean([np.load(SRC / f"adabind/small/{name[:-5]}_s{k}.npz")[split] for k in range(3)], axis=0)
            else:
                arr = np.load(SRC / f"adabind/small/{name}.npz")[split]
            members.append(w * arr)
        ada["small"] = split_by(ids, seqs, np.sum(members, axis=0))
        check(abs(sum(fd_small["weights"]) - 1) < TOL, "small: C3_union weights sum to 1")

        # DNA / RNA: per-residue nuclear labels are never changed. BioLiP says at protein level which nucleic acid
        # a protein binds: kind dna|both -> y = nuclear label, any other protein -> y = 0 (notebooks 12/13).
        k = kinds[kinds.split == split].set_index("prot_id").ligand_kind.to_dict()
        with_site = {i for i in ids if gt["nuclear"][i].any()}
        check(set(k) == with_site, f"{split}: kind table covers exactly the proteins with a nucleic-acid site")
        check("unknown" not in k.values(), f"{split}: no protein of unknown kind (nothing masked)")
        for t in ("dna", "rna"):
            for i in ids:
                gt[t][i] = gt["nuclear"][i] if k.get(i) in (t, "both") else np.zeros_like(gt["nuclear"][i])
            check(all((gt[t][i] == ada_y[t][i]).all() for i in ids), f"{split}: {t} labels from the rule == adabind y_true")
        check(all(((gt["dna"][i] | gt["rna"][i]) == gt["nuclear"][i]).all() for i in ids), f"{split}: y_dna | y_rna == nuclear")
        check(all(any(gt[t][i].any() for t in LIGANDS) for i in ids), f"{split}: every protein has at least one ligand class")

        # ---- baselines: frozen residue predictions (0-based)
        base = {m: {} for m in BASELINES}
        for m in BASELINES:
            for t in BASE_LIGANDS:
                df = pd.read_csv(BL / f"frozen_predictions/{m}__{split}__{t}_binding.csv.gz")
                probs, ok_idx = {}, True
                for pid, g in df.groupby("prot_id", sort=False):
                    g = g.sort_values("residue_index")
                    ok_idx &= list(g.residue_index) == list(range(len(seqs.get(pid, ""))))
                    probs[pid] = g.probability.to_numpy(float)
                check(set(probs) == set(ids) and ok_idx, f"{split} {m} {t}: frozen file covers every protein, 0-based contiguous")
                base[m][t] = probs

        # baseline per-protein confusion at 0.5 == published per-protein file (also proves the labels)
        pp = pd.read_csv(BL / "results_frozen/metrics_300_46/FULL_DIRECT_PER_PROTEIN_300_46.csv")
        pp = pp[(pp.dataset == split) & (pp.operating_point == "fixed_0.5")]
        for m in BASELINES:
            for t in BASE_LIGANDS:
                ref = pp[(pp.method == m) & (pp.label == f"{t}_binding")].set_index("prot_id")
                ok = len(ref) == len(ids)
                for i in ids:
                    c = confusion(gt[t][i], base[m][t][i] >= BASELINE_THRESHOLD)
                    r = ref.loc[i]
                    ok &= (c["TP"], c["FP"], c["TN"], c["FN"]) == (r.TP, r.FP, r.TN, r.FN)
                    if gt[t][i].any():
                        g = protein_metrics(gt[t][i], base[m][t][i], BASELINE_THRESHOLD)
                        ok &= all(abs(g[a] - r[b]) <= 5.1e-7 for a, b in (("precision", "precision"), ("recall", "recall"),
                                                                          ("F1", "F1"), ("MCC", "MCC")))
                check(ok, f"{split} {m} {t}: per-protein confusion, precision, recall, F1, MCC at 0.5 == published, all {len(ids)} proteins")

        # ---- structures
        plddt = {}
        ok_seq = ok_num = ok_scale = True
        for i in ids:
            s, pl, nums = read_pdb(PDB_DIR / f"{i}.pdb")
            ok_seq &= s == seqs[i]
            ok_num &= nums == list(range(1, len(seqs[i]) + 1))
            ok_scale &= all(0 <= x <= 1 for x in pl)
            plddt[i] = pl
        check(ok_seq, f"{split}: ESMFold PDB chain A sequence == canonical sequence")
        check(ok_num, f"{split}: ESMFold PDB residues numbered 1..L")
        check(ok_scale, f"{split}: ESMFold B-factor (pLDDT) on the 0..1 scale")

        data[split] = dict(ids=ids, seqs=seqs, gt=gt, ada=ada, base=base, plddt=plddt, kinds=k)

    # ---------------------------------------------------------------- dataset-level metrics + checks
    probs_of = lambda d, m, t, i: d["ada"][t][i] if m == "adabind" else d["base"][m]["nuclear" if t in ("dna", "rna") else t][i]
    thr_of = lambda m, t: thr[t] if m == "adabind" else BASELINE_THRESHOLD
    summary = {}
    for split in SPLITS:
        d = data[split]
        summary[split] = {}
        for t in CHECKED:
            y = np.concatenate([d["gt"][t][i] for i in d["ids"]])
            summary[split][t] = {"n_proteins_with_site": int(sum(d["gt"][t][i].any() for i in d["ids"])), "models": {}}
            for m in MODELS:
                p = np.concatenate([probs_of(d, m, t, i) for i in d["ids"]])
                summary[split][t]["models"][m] = global_metrics(y, p, thr_of(m, t))

    # published numbers: CI table (metal, small, dna, rna) — ref = baseline at 0.5, new = adabind at its threshold
    metric_map = {"AUPRC": "AUPRC", "AUROC": "AUROC", "Precision@thr": "precision", "Recall@thr": "recall", "F1@thr": "F1", "MCC@thr": "MCC"}
    n_cmp = 0
    for _, r in ci[ci.dataset.isin(SPLITS) & ci.metric.isin(metric_map)].iterrows():
        mine = summary[r.dataset][r.task]["models"]
        key = metric_map[r.metric]
        if r.ref_model in BASELINES:
            check(abs(mine[r.ref_model][key] - r.ref) < TOL, f"{r.dataset} {r.task} {r.ref_model} {key} == CI table ({r.ref:.6f})")
            n_cmp += 1
        check(abs(mine["adabind"][key] - r.new) < TOL, f"{r.dataset} {r.task} adabind {key} == CI table ({r.new:.6f})")
        n_cmp += 1
    # nuclear (not a task in the CI table): adabind SUMMARY.csv, baselines FULL_DIRECT_BASELINE_METRICS
    sm = pd.read_csv(SRC / "adabind/final3/SUMMARY.csv")
    for _, r in sm.iterrows():
        mine = summary[r.split][r.model]["models"]["adabind"]
        for k in ("AUPRC", "AUROC", "precision", "recall", "F1", "MCC"):
            check(abs(mine[k] - r[k]) < TOL, f"{r.split} {r.model} adabind {k} == SUMMARY.csv ({r[k]:.6f})")
            n_cmp += 1
    fdm = pd.read_csv(BL / "results_frozen/metrics_300_46/FULL_DIRECT_BASELINE_METRICS_300_46.csv")
    fdm = fdm[fdm.operating_point == "fixed_0.5"]
    for _, r in fdm[fdm.label.isin([f"{t}_binding" for t in BASE_LIGANDS])].iterrows():
        mine = summary[r.dataset][r.label.replace("_binding", "")]["models"][r.method]
        for k, col in (("AUPRC", "AP_AUPRC"), ("AUROC", "AUROC"), ("precision", "global_precision_PPV"),
                       ("recall", "global_recall_sensitivity"), ("F1", "global_positive_F1"), ("MCC", "global_MCC")):
            check(abs(mine[k] - r[col]) < TOL, f"{r.dataset} {r.label} {r.method} {k} == FULL_DIRECT_BASELINE_METRICS ({r[col]:.6f})")
            n_cmp += 1
        check(all(mine[k] == r[k] for k in ("TP", "FP", "TN", "FN")), f"{r.dataset} {r.label} {r.method} TP/FP/TN/FN == published")
    # small: candidate table; metal: external summary
    ce = pd.read_csv(SRC / "adabind/small/CANDIDATES_EXTERNAL.csv").set_index("candidate").loc["C3_union"]
    check(abs(summary["TestSet300"]["small"]["models"]["adabind"]["AUPRC"] - ce.TestSet300_AUPRC) < TOL, "TestSet300 small adabind AUPRC == CANDIDATES_EXTERNAL")
    check(abs(summary["TestSetNew46"]["small"]["models"]["adabind"]["AUPRC"] - ce.TestSetNew46_AUPRC) < TOL, "TestSetNew46 small adabind AUPRC == CANDIDATES_EXTERNAL")
    es = pd.read_csv(SRC / "adabind/metal/external_summary.csv")
    for _, r in es.iterrows():
        mine = summary[r.dataset]["metal"]["models"]["adabind"]
        check(abs(mine["AUPRC"] - r.AUPRC) < TOL and abs(mine["MCC"] - r.MCC_at_OOF_threshold) < TOL,
              f"{r.dataset} metal adabind AUPRC/MCC == external_summary.csv")
    # team DNA / RNA table (baselines scored with their nucleic-acid output). Its ours_RNA_model rows come from an
    # earlier RNA model (0.3423 / 0.0285); the final RNA model is checked above against the CI table and SUMMARY.csv.
    pl = pd.read_csv(SRC / "comparison/per_ligand_table.csv")
    mname = {"bindEmbed21DL": "bindEmbed21DL", "bindNode24": "bindNode24", "ours_DNA_model": "adabind"}
    for _, r in pl.iterrows():
        t = r.target.lower()
        if r.method in mname and (r.method != "ours_DNA_model" or t == "dna"):
            mine = summary[r.split][t]
            check(abs(mine["models"][mname[r.method]]["AUPRC"] - r.AUPRC_all) < TOL and mine["n_proteins_with_site"] == r.n_proteins,
                  f"{r.split} {t} {r.method} AUPRC == per_ligand_table ({r.AUPRC_all:.6f})")
    # dataset sizes
    da = pd.read_csv(BL / "results_frozen/metrics_300_46/dataset_audit.csv")
    for _, r in da[da.dataset.isin(SPLITS) & (da.label != "any_ligand_binding_sites")].iterrows():
        s = summary[r.dataset][r.label.replace("_binding", "")]["models"]["adabind"]
        check(s["n_residues"] == r.residues and s["n_positive"] == r.positives, f"{r.dataset} {r.label}: residues / positives == dataset_audit")

    # The protein each test set opens on: AdaBind's best call, MCC first, the larger site on ties.
    featured = {}
    for split in SPLITS:
        d = data[split]
        ranked = [(protein_metrics(d["gt"][t][i], d["ada"][t][i], thr[t]), i, t)
                  for i in d["ids"] for t in LIGANDS if d["gt"][t][i].any()]
        m, pid, lig = max(ranked, key=lambda r: (r[0]["MCC"], r[0]["TP"] + r[0]["FN"], r[1]))
        featured[split] = {"protein": pid, "ligand": lig, "MCC": m["MCC"], "TP": m["TP"], "FP": m["FP"], "FN": m["FN"]}
        check(m["MCC"] > 0, f"{split}: a protein to open on ({pid}, {lig}, MCC {m['MCC']:.3f})")

    print(f"\n{len(passes)} checks passed, {len(failures)} failed ({n_cmp} published metric values reproduced)")
    if failures:
        print("NOT writing output.")
        return 1

    # ---------------------------------------------------------------- write
    tmp = OUT.with_name(OUT.name + ".tmp")
    shutil.rmtree(tmp, ignore_errors=True)
    (tmp / "proteins").mkdir(parents=True)
    (tmp / "structures").mkdir(parents=True)
    rows = []
    r4 = lambda a: [round(float(x), 4) for x in a]
    bits = lambda a: "".join("1" if x else "0" for x in a)
    for split in SPLITS:
        d = data[split]
        for i in d["ids"]:
            nm = names.get(i) or {}
            lig = {t: int(d["gt"][t][i].sum()) for t in LIGANDS if d["gt"][t][i].any()}
            rows.append({"id": i, "split": split, "length": len(d["seqs"][i]), "name": nm.get("name"),
                         "nameSource": nm.get("source", "none"), "nameNote": nm.get("note"), "gene": nm.get("gene"),
                         "organism": nm.get("organism"), "sequence": d["seqs"][i], "ligands": lig})
            models = {}
            for m in MODELS:
                # Calls and metrics come from the full-precision probabilities; the JSON keeps 4 decimals for display.
                models[m] = {
                    "prob": {t: r4(probs_of(d, m, t, i)) for t in LIGANDS},
                    "call": {t: bits(probs_of(d, m, t, i) >= thr_of(m, t)) for t in LIGANDS},
                    "metrics": {t: protein_metrics(d["gt"][t][i], probs_of(d, m, t, i), thr_of(m, t))
                                for t in LIGANDS if d["gt"][t][i].any()},
                }
            doc = {"id": i, "split": split, "sequence": d["seqs"][i], "plddt": [round(x, 2) for x in d["plddt"][i]],
                   "labels": {t: bits(d["gt"][t][i]) for t in LIGANDS}, "models": models}
            (tmp / "proteins" / f"{i}.json").write_text(json.dumps(doc, separators=(",", ":")))
            with gzip.open(tmp / "structures" / f"{i}.pdb.gz", "wb", compresslevel=9) as f:
                f.write((PDB_DIR / f"{i}.pdb").read_bytes())

    def src_hash(p: Path) -> str:
        return hashlib.sha256(p.read_bytes()).hexdigest()[:16]

    index = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "checks_passed": len(passes),
        "datasets": [
            {"id": "TestSet300", "label": "TestSet300", "proteins": len(data["TestSet300"]["ids"]),
             "description": "Primary held-out benchmark (<20% sequence identity to development data)."},
            {"id": "TestSetNew46", "label": "TestSetNew46", "proteins": len(data["TestSetNew46"]["ids"]),
             "description": "Newer PDB entries, held out from every model's development."},
        ],
        "ligands": {
            "metal": {"label": "Metal ion", "baselineOutput": "metal"},
            "small": {"label": "Small molecule", "baselineOutput": "small"},
            "dna": {"label": "DNA", "baselineOutput": "nuclear"},
            "rna": {"label": "RNA", "baselineOutput": "nuclear"},
        },
        "models": {
            "adabind": {"label": "AdaBind", "thresholds": {t: thr[t] for t in LIGANDS},
                        "thresholdRules": {t: rules[t] for t in LIGANDS},
                        "note": "Ligand-class-specific ensembles; thresholds locked on DevSet1010 out-of-fold predictions."},
            "bindEmbed21DL": {"label": "bindEmbed21DL", "thresholds": {t: BASELINE_THRESHOLD for t in LIGANDS},
                              "note": "ProtT5 + 2-layer CNN, 5 checkpoints averaged; fixed 0.5 (published operating point)."},
            "bindNode24": {"label": "bindNode24", "thresholds": {t: BASELINE_THRESHOLD for t in LIGANDS},
                           "note": "ProtT5 + GraphSAGE on AlphaFold structures, 5 folds averaged; fixed 0.5 (published operating point)."},
        },
        "notes": {
            "thresholds": "AUPRC and AUROC do not depend on the threshold and compare the three models directly. Precision, recall, F1 and MCC compare AdaBind at its locked threshold with the baselines at 0.5.",
            "dnaRna": "bindEmbed21DL and bindNode24 predict nucleic-acid binding as one class, without separating DNA from RNA. Their nucleic-acid output is scored against the DNA and RNA labels.",
            "labels": "DNA and RNA labels come from the nucleic-acid labels: BioLiP2 says which nucleic acid each protein binds, and that protein's binding residues take that label.",
            "structure": "Structures are the ESMFold models AdaBind was evaluated on. bindNode24's frozen predictions were made on AlphaFold structures.",
        },
        "summary": {s: {t: summary[s][t] for t in LIGANDS} for s in SPLITS},
        "featured": featured,
        "sources": {
            "adabind_metal": "results/metal_v4_06_final_mlp_esmif_esmfold (ensemble_predictions)",
            "adabind_small": "results/SMALL_V3_IMPROVE (member_preds, C3_union weights of FINAL_DECISION.json)",
            "adabind_nuclear_dna_rna": "results/FINAL_INFERENCE_3_MODELS",
            "baselines": "baselines_2124/frozen_predictions (fixed 0.5)",
            "labels": "bindnode24 dataset binding_residues_2.5_* (TestSet300), bind21 independent_set (TestSetNew46); DNA/RNA split: adabind/decisions/evaluation_bootstrap_B10000/DNA_RNA_PROTEIN_KINDS.csv",
            "names": "UniProtKB (recommended name), UniParc for retired accessions",
            "manifest_sha256": src_hash(ADA / "final_model" / "manifest.json"),
        },
        "proteins": rows,
    }
    (tmp / "index.json").write_text(json.dumps(index, separators=(",", ":")))
    shutil.rmtree(OUT, ignore_errors=True)
    tmp.rename(OUT)
    size = sum(f.stat().st_size for f in OUT.rglob("*") if f.is_file())
    print(f"wrote {OUT} ({len(rows)} proteins, {size / 2**20:.1f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
