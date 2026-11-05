"""End-to-end check from the sequence alone, on every golden protein, exactly as a /predict request runs:

    structure  ESMFold (self-hosted first, API fallback), folded fresh (temporary cache, nothing reused)
    embeddings ESM-2 / ProtT5 (this environment) + ESM-IF (backend/.venv-esmif worker)
    models     the 140 checkpoints of adabind/final_model

and compared with the training-time predictions shipped in adabind/golden_set (training_final_<task>) for metal,
nuclear and small; dna / rna have no golden reference and are reported only.
Thresholds as adabind/scripts/verify_installation.py step [4]: max |diff| <= 0.03, at most 1 % of calls flipped.
Stop the backend first if the GPU is small: this loads a second copy of every model.

    cd backend && .venv/bin/python scripts/verify_golden_e2e.py [--api-only]
"""
import argparse
import json
import sys
import tempfile
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import model_files  # noqa: E402
from app.config import BINDING_TYPES, Settings, apply_offline_environment  # noqa: E402
from app.errors import ApiError  # noqa: E402
from app.esmfold import EsmFoldClient  # noqa: E402
from app.esmfold_local import LocalEsmFold, ca_coords, kabsch_rmsd  # noqa: E402
from app.predictor import create_predictor  # noqa: E402

TOL_E2E_MAX, TOL_E2E_FLIPS = 0.03, 0.01


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--api-only", action="store_true", help="fold with the ESMFold API instead of local ESMFold")
    a = ap.parse_args()
    settings = Settings.from_env()
    apply_offline_environment(settings)
    golden = settings.golden_dir
    index = json.loads((golden / "index.json").read_text())
    manifest, _ = model_files.load_manifest(settings.final_model_dir)
    thr = model_files.thresholds(manifest, settings.profile)

    local = None if a.api_only or settings.esmfold_local != "auto" else \
        LocalEsmFold(settings.esmfold_dir, device=settings.device_for("esmfold"))
    predictor, status = create_predictor(settings)
    if status["status"] != "ok":
        print("predictor:", status["message"])
        return 1
    worst = {t: 0.0 for t in ("metal", "nuclear", "small")}
    flips = {t: 0 for t in worst}
    calls = {t: 0 for t in BINDING_TYPES}
    ref_calls = {t: 0 for t in worst}
    fold_failed = []
    try:
        with tempfile.TemporaryDirectory() as tmp:
            client = EsmFoldClient(settings.esmfold_url, settings.esmfold_timeout, Path(tmp), local=local,
                                   attempts=settings.esmfold_attempts, backoff=settings.esmfold_backoff,
                                   total_timeout=settings.esmfold_total_timeout)
            for e in sorted(index["proteins"], key=lambda e: e["length"]):
                pid, seq = e["prot_id"], e["sequence"]
                ref = np.load(golden / f"{pid}.npz")
                t0 = time.perf_counter()
                try:
                    fold = client.fold(seq)
                except ApiError as exc:
                    fold_failed.append(pid)
                    print(f"{pid:>11} {len(seq):>3} aa  FOLD FAILED: {exc.message}", flush=True)
                    continue
                rmsd = kabsch_rmsd(ca_coords(fold.pdb), ca_coords((golden / f"{pid}.pdb").read_text()))
                row = [f"{pid:>11} {len(seq):>3} aa  {fold.source:<8} {fold.seconds:5.1f}s RMSD {rmsd:5.3f} A"]
                for t in BINDING_TYPES:
                    p = np.asarray(predictor.predict(seq, t, fold.pdb, thr[t]).probability)
                    calls[t] += int((p >= thr[t]).sum())
                    key = f"training_{settings.profile}_{t}"
                    if key in ref.files:
                        d = float(np.abs(p - ref[key]).max())
                        worst[t] = max(worst[t], d)
                        flips[t] += int(((p >= thr[t]) != (ref[key] >= thr[t])).sum())
                        ref_calls[t] += int((ref[key] >= thr[t]).sum())
                        row.append(f"{t} {d:.4f}")
                print("  ".join(row) + f"  ({time.perf_counter() - t0:.1f} s)", flush=True)
            client.close()
    finally:
        predictor.close()
    print()
    bad = 0
    for t in worst:
        ok = worst[t] <= TOL_E2E_MAX and flips[t] <= max(1, TOL_E2E_FLIPS * ref_calls[t])
        bad += not ok
        print(f"[{'PASS' if ok else 'FAIL'}] {t:<7} max |p - training| {worst[t]:.4f}, calls flipped "
              f"{flips[t]}/{ref_calls[t]}")
    print("        dna / rna (no golden reference): residues called", {t: calls[t] for t in ("dna", "rna")})
    if fold_failed:
        print(f"[FAIL] no structure for {len(fold_failed)} protein(s): {', '.join(fold_failed)}")
    return 1 if bad or fold_failed else 0


if __name__ == "__main__":
    sys.exit(main())
