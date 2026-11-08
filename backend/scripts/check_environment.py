"""Deep environment check: really loads every model and runs the full pipeline, exactly as the server does.

    cd backend
    .venv/bin/python scripts/check_environment.py              # ~1 min on GPU
    .venv/bin/python scripts/check_environment.py --full-hash  # + sha256 of the 6.7 GB of foundation weights

Writes logs/environment_report.json, which the backend serves in /diagnostics and the UI shows.

Checks: packages + GPU; final_model checksums (140 checkpoints); foundation weight files; self-hosted ESMFold
(golden fold vs training PDB, when foundation_models/esmfold_v1 exists); ESMFold API (fallback);
golden-set self-test (ESM-2 / ProtT5 recomputed here, ESM-IF in backend/.venv-esmif, every checkpoint; compared
with the training embeddings and the golden reference predictions); and one end-to-end prediction of ubiquitin
folded by the ESMFold API for each of the five ligand classes.
The complete golden-set check of the model team is adabind/scripts/verify_installation.py.
"""
import argparse
import importlib
import json
import platform
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import model_files  # noqa: E402
from app.config import BINDING_TYPES, Settings, apply_offline_environment  # noqa: E402
from app.esmfold import EsmFoldClient, PrecomputedStructures  # noqa: E402

TEST_SEQUENCE = "MQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQRLIFAGKQLEDGRTLSDYNIQKESTLHLVLRLRGG"  # ubiquitin


class Report:
    def __init__(self):
        self.checks: list[dict] = []

    def run(self, name: str, fn, *args):
        print(f"[....] {name}", flush=True)
        started = time.perf_counter()
        try:
            status, message, details = fn(*args)
        except Exception as exc:
            status, message, details = "error", f"{type(exc).__name__}: {exc}", {"traceback": traceback.format_exc()}
        seconds = round(time.perf_counter() - started, 2)
        self.checks.append({"name": name, "status": status, "message": message, "seconds": seconds, "details": details})
        print(f"[{status.upper():>5}] {name} ({seconds} s): {message}", flush=True)
        return details


def check_packages():
    versions = {"python": platform.python_version()}
    errors = []
    for module in ("numpy", "torch", "transformers", "sentencepiece", "fastapi", "Bio", "pbind"):
        try:
            versions[module] = getattr(importlib.import_module(module), "__version__", "?")
        except Exception as exc:
            errors.append(f"{module}: {type(exc).__name__}: {exc}")
    if errors:
        return "error", "; ".join(errors), versions
    import torch

    gpu = torch.cuda.get_device_name(0) if torch.cuda.is_available() else None
    versions["cuda"] = torch.version.cuda
    versions["gpu"] = gpu
    message = ", ".join(f"{k} {v}" for k, v in versions.items() if k not in ("cuda", "gpu"))
    message += f"; GPU {gpu} (CUDA {torch.version.cuda})" if gpu else "; no GPU: CPU (ProtT5 is slow)"
    return ("ok" if gpu else "warning"), message, versions


def check_final_model(settings: Settings):
    manifest, version = model_files.load_manifest(settings.final_model_dir)
    result = model_files.verify_final_model(manifest, settings.final_model_dir, settings.profile)
    bad = result["missing"] + result["mismatched"]
    if bad:
        return "error", f"{len(result['missing'])} missing, {len(result['mismatched'])} mismatched", result
    return "ok", (f"{result['files_checked']} checkpoints of {len(BINDING_TYPES)} ligand classes match the manifest "
                  f"(model_version {version[:12]})"), result


def check_weights(settings: Settings, full_hash: bool):
    results = model_files.check_foundation_files(settings.weights_dir, settings.profile)
    if full_hash:
        manifest = json.loads((settings.weights_dir / "MANIFEST.json").read_text())
        for name, entry in manifest.items():
            for rel, want in entry["sha256"].items():
                path = settings.weights_dir / name / rel
                if not path.exists():
                    if name != "esmfold_v1":  # only needed to self-host ESMFold
                        results[f"{name}/{rel}"] = {"status": "error", "message": f"missing {path}"}
                    continue
                ok = model_files.sha256_file(path) == want
                results[f"{name}/{rel}"] = {"status": "ok" if ok else "error",
                                            "message": "sha256 OK" if ok else "sha256 MISMATCH"}
    bad = {k: v for k, v in results.items() if v["status"] != "ok"}
    if bad:
        return "error", "; ".join(f"{k}: {v['message']}" for k, v in bad.items()), results
    return "ok", f"{len(results)} weight files present" + (" (sha256 verified against MANIFEST.json)"
                                                           if full_hash else ""), results


def check_esmfold(settings: Settings):
    client = EsmFoldClient(settings.esmfold_url, settings.esmfold_timeout, settings.cache_dir,
                           attempts=settings.esmfold_attempts, backoff=settings.esmfold_backoff,
                           total_timeout=settings.esmfold_total_timeout)
    try:
        fold = client.fold(TEST_SEQUENCE)
    finally:
        client.close()
    mean_plddt = sum(fold.plddt) / len(fold.plddt)
    details = {"pdb": fold.pdb, "cached": fold.cached, "mean_plddt": round(mean_plddt, 3)}
    return "ok", (f"chain A matches {len(TEST_SEQUENCE)} aa, mean pLDDT {mean_plddt:.2f}"
                  + (" (cached)" if fold.cached else f", {fold.seconds:.1f} s")), details


def check_precomputed(settings: Settings):
    pre = PrecomputedStructures(settings.esmfold_files_dir, settings.cache_dir / "esmfold_files_index.json")
    pre.start(background=False)
    return pre.status["status"], pre.status["message"], {"count": pre.count}


def check_local_esmfold(settings: Settings):
    from app.esmfold_local import LocalEsmFold, LocalFoldService, self_test

    local = LocalEsmFold(settings.esmfold_dir, device=settings.device_for("esmfold"))
    room, why = LocalFoldService(local, min_free_gb=settings.esmfold_min_free_gb,
                                 explicit_cpu=dict(settings.devices).get("esmfold") == "cpu")._has_room()
    if not room:  # the GPU is shared: never load next to another job that would run out of memory
        return "warning", f"not checked: {why}", {}
    result = self_test(local, settings.golden_dir)
    status = "ok" if result["ok"] else "error"
    local._model = None  # free the 8.4 GB before the binding-site models load
    import gc

    import torch

    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    return status, result["message"], result["details"]


def check_self_test(predictor, settings: Settings):
    result = predictor.self_test(settings.golden_dir)
    return "ok", result["message"], result["details"]


def check_end_to_end(predictor, thresholds: dict, pdb: str):
    calls, timing = {}, {}
    for bt in BINDING_TYPES:
        out = predictor.predict(TEST_SEQUENCE, bt, pdb, thresholds[bt])
        calls[bt] = sum(p >= thresholds[bt] for p in out.probability)
        timing[bt] = out.timing
    message = "ubiquitin, binding residues called: " + ", ".join(f"{bt} {n}" for bt, n in calls.items())
    return "ok", message, {"binding_calls": calls, "timing": timing}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--full-hash", action="store_true", help="also sha256 the foundation weights (slow)")
    parser.add_argument("--skip-models", action="store_true", help="skip loading the models")
    args = parser.parse_args()

    settings = Settings.from_env()
    apply_offline_environment(settings)
    report = Report()
    report.run("Python packages + GPU", check_packages)
    report.run("final_model checksums", check_final_model, settings)
    report.run("Foundation weight files", check_weights, settings, args.full_hash)
    report.run("Precomputed ESMFold structures", check_precomputed, settings)
    esmfold = report.run("ESMFold API", check_esmfold, settings)
    if not args.skip_models and settings.esmfold_local == "auto":
        report.run("ESMFold self-hosted (golden fold)", check_local_esmfold, settings)
    if not args.skip_models:
        from app.predictor import create_predictor

        predictor, status = create_predictor(settings)
        if status["status"] != "ok":
            report.run("pbind predictor", lambda: ("error", status["message"], {}))
        else:
            try:
                report.run("Golden-set self-test (all models)", check_self_test, predictor, settings)
                if esmfold and "pdb" in esmfold:
                    manifest, _ = model_files.load_manifest(settings.final_model_dir)
                    report.run("End-to-end prediction, 5 ligand classes", check_end_to_end, predictor,
                               model_files.thresholds(manifest, settings.profile), esmfold["pdb"])
            finally:
                predictor.close()

    for check in report.checks:
        check["details"].pop("pdb", None)
    statuses = {c["status"] for c in report.checks}
    overall = "error" if "error" in statuses else "warning" if "warning" in statuses else "ok"
    out = {
        "status": overall,
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "host": platform.node(),
        "test_sequence": TEST_SEQUENCE,
        "checks": report.checks,
    }
    settings.log_dir.mkdir(parents=True, exist_ok=True)
    out_file = settings.log_dir / "environment_report.json"
    out_file.write_text(json.dumps(out, indent=2, default=str), encoding="utf-8")
    print(f"\nOverall: {overall.upper()}  ->  {out_file}")
    return 0 if overall != "error" else 1


if __name__ == "__main__":
    sys.exit(main())
