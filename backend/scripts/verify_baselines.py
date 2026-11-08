"""Check the live bindEmbed21DL / bindNode24 worker against baselines_2124/frozen_predictions.

    cd backend && BINDSITE_DEVICE=cpu .venv/bin/python scripts/verify_baselines.py [--split TestSetNew46]
                                                       [--alphafold-dir DIR] [--limit N]

Spearman decides, as in baselines_2124/README_BASELINES.md section 4: AUPRC and AUROC depend only on the order of the
residues, and the ProtT5 file behind the frozen predictions is not documented, so an exact match cannot be expected.
  KHOP   max |diff| <= 1e-6
  DAT    Spearman >= 0.999
  LECH   Spearman < 0.999

bindEmbed21DL uses the sequence only. bindNode24 also uses a structure: its frozen predictions were made on AlphaFold
structures, so only --alphafold-dir (repos/bindnode24/dataset/AlphaFold_predictions on the team Drive) tests the code.
With the ESMFold structures of the page the numbers show how far the live model moves on another structure.
"""
import argparse
import gzip
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.baselines import MODELS, OUTPUTS, BaselineWorker  # noqa: E402
from app.config import Settings, apply_offline_environment  # noqa: E402
from app.esmfold_local import ca_coords  # noqa: E402


def read_frozen(path: Path) -> dict[str, list[float]]:
    out: dict[str, list[float]] = {}
    with gzip.open(path, "rt") as fh:
        next(fh)
        for line in fh:
            pid, _, p = line.strip().split(",")
            out.setdefault(pid, []).append(float(p))
    return out


def rank(a: np.ndarray) -> np.ndarray:
    order = np.argsort(a, kind="mergesort")
    r = np.empty(len(a))
    i = 0
    while i < len(a):
        j = i
        while j + 1 < len(a) and a[order[j + 1]] == a[order[i]]:
            j += 1
        r[order[i:j + 1]] = (i + j) / 2
        i = j + 1
    return r


def spearman(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.corrcoef(rank(a), rank(b))[0, 1])


def report(name: str, live: dict, frozen: dict) -> bool:
    ok = True
    for label in OUTPUTS:
        ids = sorted(live)
        a = np.concatenate([live[i][label] for i in ids])
        b = np.concatenate([np.asarray(frozen[label][i]) for i in ids])
        d, sp = float(np.abs(a - b).max()), spearman(a, b)
        calls = float(((a >= 0.5) != (b >= 0.5)).mean())
        verdict = "KHOP" if d <= 1e-6 else "DAT" if sp >= 0.999 else "LECH"
        ok &= verdict != "LECH"
        print(f"  {name:<28} {label:<8} max|d| {d:8.5f}  spearman {sp:9.6f}  calls flipped {calls * 100:6.3f}%  {verdict}")
    return ok


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--split", default="TestSetNew46", choices=("TestSet300", "TestSetNew46"))
    ap.add_argument("--alphafold-dir", type=Path)
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()

    settings = Settings.from_env()
    apply_offline_environment(settings)
    from app.predictor import create_predictor

    predictor, status = create_predictor(settings)
    if status["status"] != "ok":
        print("predictor:", status["message"])
        return 1
    canon = settings.baselines_dir / "canonical"
    ids = [x.strip() for x in (canon / f"{a.split}_ids.txt").read_text().splitlines() if x.strip()]
    ids = ids[:a.limit] if a.limit else ids
    seqs, key = {}, None
    for line in (canon / f"{a.split}.fasta").read_text().splitlines():
        if line.startswith(">"):
            key = line[1:].split()[0]
            seqs[key] = ""
        else:
            seqs[key] += line.strip()

    frozen = {m: {o: read_frozen(settings.baselines_dir / "frozen_predictions" / f"{m}__{a.split}__{o}_binding.csv.gz")
                  for o in OUTPUTS} for m in MODELS}
    worker = BaselineWorker(settings.baselines_python, settings.baselines_dir)
    print("worker:", worker.start())
    live_esm: dict = {m: {} for m in MODELS}
    live_af: dict = {}
    t0 = time.perf_counter()
    try:
        for n, pid in enumerate(ids, 1):
            pdb = (settings.esmfold_files_dir / f"{pid}.pdb").read_text()
            t5, _ = predictor.prott5(seqs[pid], pdb)
            out = worker.predict(t5, ca_coords(pdb))
            for m in MODELS:
                live_esm[m][pid] = {o: out[m][:, i] for i, o in enumerate(OUTPUTS)}
            af = a.alphafold_dir / f"{pid}.pdb" if a.alphafold_dir else None
            if af and af.exists():
                ca = ca_coords(af.read_text())
                if len(ca) == len(seqs[pid]):
                    r = worker.predict(t5, ca)["bindNode24"]
                    live_af[pid] = {o: r[:, i] for i, o in enumerate(OUTPUTS)}
                else:
                    print(f"  {pid}: AlphaFold file has {len(ca)} residues, sequence {len(seqs[pid])}: skipped")
            if n % 25 == 0:
                print(f"  {n}/{len(ids)} ({time.perf_counter() - t0:.0f} s)", flush=True)
    finally:
        worker.close()
        predictor.close()

    print(f"\n{a.split}: {len(ids)} proteins in {time.perf_counter() - t0:.0f} s")
    ok = report("bindEmbed21DL", live_esm["bindEmbed21DL"], frozen["bindEmbed21DL"])
    if live_af:
        print(f"  ({len(live_af)} proteins with their AlphaFold structure)")
        ok &= report("bindNode24, AlphaFold", live_af, frozen["bindNode24"])
    print("  (information only: another structure than the frozen run)")
    report("bindNode24, ESMFold", live_esm["bindNode24"], frozen["bindNode24"])
    print("\nRESULT:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
