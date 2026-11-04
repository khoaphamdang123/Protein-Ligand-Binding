"""Deep environment check: really loads and runs every foundation model on a test protein.

    cd backend
    .venv/Scripts/python.exe scripts/check_environment.py            # ~2-5 min on CPU
    .venv/Scripts/python.exe scripts/check_environment.py --full-hash  # + sha256 of the 6.7 GB of weights

Writes logs/environment_report.json, which the backend serves in /diagnostics and the UI shows.
Settings follow FOUNDATION_MODELS.md sections 3-5. This is a smoke test (shapes, finite values,
timings), NOT the golden-set comparison: that needs the training-time features from the model team.
"""
import argparse
import importlib
import json
import platform
import re
import subprocess
import sys
import tempfile
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import model_files  # noqa: E402
from app.config import Settings, apply_offline_environment  # noqa: E402
from app.esmfold import EsmFoldClient  # noqa: E402

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
    for module in ("numpy", "torch", "transformers", "sentencepiece", "fastapi", "Bio"):
        try:
            versions[module] = getattr(importlib.import_module(module), "__version__", "?")
        except Exception as exc:
            errors.append(f"{module}: {type(exc).__name__}: {exc}")
    if errors:
        return "error", "; ".join(errors), versions
    return "ok", ", ".join(f"{k} {v}" for k, v in versions.items()), versions


def check_final_model(settings: Settings):
    manifest, version = model_files.load_manifest(settings.final_model_dir)
    result = model_files.verify_final_model(manifest, settings.final_model_dir, settings.profile)
    bad = result["missing"] + result["mismatched"]
    if bad:
        return "error", f"{len(result['missing'])} missing, {len(result['mismatched'])} mismatched", result
    return "ok", f"{result['files_checked']} files match manifest (model_version {version[:12]})", result


def check_weights(settings: Settings, full_hash: bool):
    results = model_files.check_foundation_files(settings.weights_dir, settings.profile)
    if full_hash:
        for name, (rel, _, expected) in model_files.FOUNDATION_FILES.items():
            if name not in results or results[name]["status"] != "ok" or "TORCH_HOME" in name:
                continue
            digest = model_files.sha256_file(settings.weights_dir / rel)
            results[name]["sha256"] = digest
            if expected and not (digest.startswith(expected[0]) and digest.endswith(expected[1])):
                results[name] = {"status": "error", "message": f"sha256 {digest} does not match the doc ({expected[0]}...{expected[1]})"}
    bad = {k: v for k, v in results.items() if v["status"] != "ok"}
    if bad:
        return "error", "; ".join(f"{k}: {v['message']}" for k, v in bad.items()), results
    return "ok", f"{len(results)} weight files present" + (" (sha256 verified)" if full_hash else ""), results


def check_esmfold(settings: Settings):
    client = EsmFoldClient(settings.esmfold_url, settings.esmfold_timeout, settings.cache_dir)
    try:
        fold = client.fold(TEST_SEQUENCE)
    finally:
        client.close()
    mean_plddt = sum(fold.plddt) / len(fold.plddt)
    details = {"pdb": fold.pdb, "cached": fold.cached, "mean_plddt": round(mean_plddt, 3)}
    return "ok", f"chain A matches {len(TEST_SEQUENCE)} aa, mean pLDDT {mean_plddt:.2f}" + (" (cached)" if fold.cached else ""), details


def check_esm2(settings: Settings):
    # FOUNDATION_MODELS.md section 3: transformers EsmModel, fp32, mean of the last two hidden states.
    import numpy as np
    import torch
    from transformers import EsmModel, EsmTokenizer

    path = settings.weights_dir / "esm2_t33_650M_UR50D"
    started = time.perf_counter()
    tok = EsmTokenizer.from_pretrained(path)
    model = EsmModel.from_pretrained(path, output_hidden_states=True, dtype=torch.float32).eval()  # fp32, NOT half
    load_s = time.perf_counter() - started

    started = time.perf_counter()
    t = tok([TEST_SEQUENCE], return_tensors="pt", padding=True, truncation=True, max_length=1002)
    with torch.inference_mode():
        h = torch.stack(model(**t).hidden_states[-2:], dim=0).mean(0)
    emb = h[0, 1:len(TEST_SEQUENCE) + 1].float().cpu().numpy().astype(np.float16)
    infer_s = time.perf_counter() - started

    expected = (len(TEST_SEQUENCE), 1280)
    ok = emb.shape == expected and np.isfinite(emb).all()
    details = {"shape": list(emb.shape), "load_s": round(load_s, 1), "infer_s": round(infer_s, 2),
               "layers": model.config.num_hidden_layers, "mean_abs": float(np.abs(emb.astype(np.float32)).mean())}
    return ("ok" if ok else "error"), f"shape {emb.shape} (expected {expected}), load {load_s:.1f} s, inference {infer_s:.2f} s", details


def check_prott5(settings: Settings):
    # FOUNDATION_MODELS.md section 4. The doc runs fp16 on CUDA; fp16 is not usable on this CPU,
    # so the half-precision weights run in fp32 (Rostlab's recommendation for CPU).
    import numpy as np
    import torch
    from transformers import T5EncoderModel, T5Tokenizer

    path = settings.weights_dir / "prot_t5_xl_half_uniref50-enc"
    started = time.perf_counter()
    tok = T5Tokenizer.from_pretrained(path, do_lower_case=False)
    t5 = T5EncoderModel.from_pretrained(path, dtype=torch.float32).eval()
    load_s = time.perf_counter() - started

    started = time.perf_counter()
    clean = re.sub(r"[UZOB]", "X", TEST_SEQUENCE)
    ids = tok(" ".join(clean), add_special_tokens=True)["input_ids"]
    if not (len(ids) == len(TEST_SEQUENCE) + 1 and tok.unk_token_id not in ids[:-1]):
        return "error", f"tokenizer produced {len(ids)} tokens for {len(TEST_SEQUENCE)} residues (expected one per residue + </s>)", {"ids": ids}
    ids = torch.tensor(ids)[None]
    with torch.no_grad():
        h = t5(input_ids=ids, attention_mask=torch.ones_like(ids)).last_hidden_state
    emb = h[0, :len(TEST_SEQUENCE)].float().cpu().numpy().astype(np.float16)
    infer_s = time.perf_counter() - started

    expected = (len(TEST_SEQUENCE), 1024)
    ok = emb.shape == expected and np.isfinite(emb).all()
    details = {"shape": list(emb.shape), "load_s": round(load_s, 1), "infer_s": round(infer_s, 2), "dtype_run": "float32 (CPU)",
               "mean_abs": float(np.abs(emb.astype(np.float32)).mean())}
    return ("ok" if ok else "error"), f"shape {emb.shape} (expected {expected}), load {load_s:.1f} s, inference {infer_s:.2f} s (fp32 on CPU)", details


def check_esmif(settings: Settings, pdb_text: str):
    if not settings.esmif_python.exists():
        return "error", f"ESM-IF environment not found: {settings.esmif_python}", {}
    with tempfile.TemporaryDirectory() as tmp:
        pdb_file, out_file = Path(tmp) / "chainA.pdb", Path(tmp) / "esmif.npy"
        pdb_file.write_text(pdb_text)
        proc = subprocess.run(
            [str(settings.esmif_python), str(Path(__file__).with_name("esmif_embed.py")), "--pdb", str(pdb_file),
             "--sequence", TEST_SEQUENCE, "--out", str(out_file), "--torch-home", str(settings.torch_home)],
            capture_output=True, text=True, timeout=900,
        )
        if proc.returncode != 0:
            return "error", f"esmif_embed.py exited with {proc.returncode}: {proc.stderr.strip()[-600:]}", {"stderr": proc.stderr[-4000:]}
        result = json.loads(proc.stdout.strip().splitlines()[-1])
    expected = [len(TEST_SEQUENCE), 512]
    ok = result["shape"] == expected and result["finite"]
    status = ("warning" if "stand-in" in result["torch_scatter"] else "ok") if ok else "error"
    message = (f"shape {tuple(result['shape'])} (expected {tuple(expected)}), load {result['load_s']} s, inference {result['infer_s']} s; "
               f"torch {result['torch']}, torch_scatter: {result['torch_scatter'].split(' (')[0]}")
    return status, message, result


def check_pbind():
    try:
        import pbind  # noqa: F401
    except Exception as exc:
        return "error", f"pbind is not installed yet ({type(exc).__name__}: {exc}). Real predictions need it (integration guide section 7).", {}
    return "ok", f"pbind {getattr(pbind, '__version__', '?')} importable", {}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--full-hash", action="store_true", help="also sha256 the foundation weights (slow)")
    parser.add_argument("--skip-models", action="store_true", help="skip loading ESM-2 / ProtT5 / ESM-IF")
    args = parser.parse_args()

    settings = Settings.from_env()
    apply_offline_environment(settings)
    report = Report()
    report.run("Python packages", check_packages)
    report.run("final_model checksums", check_final_model, settings)
    report.run("Foundation weight files", check_weights, settings, args.full_hash)
    esmfold = report.run("ESMFold API", check_esmfold, settings)
    if not args.skip_models:
        report.run("ESM-2 650M (embedding)", check_esm2, settings)
        report.run("ProtT5-XL (embedding)", check_prott5, settings)
        if esmfold and "pdb" in esmfold:
            report.run("ESM-IF1 (embedding)", check_esmif, settings, esmfold["pdb"])
    report.run("pbind (AdaBind inference code)", check_pbind)

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
    out_file.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(f"\nOverall: {overall.upper()}  ->  {out_file}")
    return 0 if overall != "error" else 1


if __name__ == "__main__":
    sys.exit(main())
