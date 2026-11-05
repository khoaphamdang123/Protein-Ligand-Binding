"""manifest.json, final_model checksums and foundation-model weight files (integration guide section 3)."""
import hashlib
import json
from pathlib import Path

from .config import BINDING_TYPES

# Weight files the foundation models load (FOUNDATION_MODELS.md section 0). Sizes in bytes;
# sha256 prefix/suffix as printed in the doc (None: the doc gives no hash).
FOUNDATION_FILES = {
    "ESM-2 650M": ("esm2_t33_650M_UR50D/model.safetensors", 2_609_506_392, ("a08adabb", "4db0")),
    "ProtT5-XL half": ("prot_t5_xl_half_uniref50-enc/pytorch_model.bin", 2_416_373_051, ("7f51ba88", "1157")),
    "ESM-IF1": ("esm_if1/esm_if1_gvp4_t16_142M_UR50.pt", 1_700_450_121, None),
    "ESM-IF1 in TORCH_HOME": ("torch_home/hub/checkpoints/esm_if1_gvp4_t16_142M_UR50.pt", 1_700_450_121, None),
}
# Foundation models each profile needs (manifest "foundation_models"; ESMFold runs through the API).
# ESM-IF1 is loaded from esm_if1/ by the worker; the TORCH_HOME copy is what fair-esm's hub loader would use.
PROFILE_FOUNDATIONS = {
    "final": ("ESM-2 650M", "ProtT5-XL half", "ESM-IF1"),
    "lite": ("ESM-2 650M",),
}


def load_manifest(final_model_dir: Path) -> tuple[dict, str]:
    """Return (manifest, model_version) where model_version = sha1 of manifest.json."""
    raw = (final_model_dir / "manifest.json").read_bytes()
    return json.loads(raw), hashlib.sha1(raw).hexdigest()


def thresholds(manifest: dict, profile: str) -> dict[str, float]:
    profiles = manifest["profiles"]
    if profile not in profiles:
        raise KeyError(f"profile '{profile}' not in manifest (available: {', '.join(profiles)})")
    missing = [bt for bt in BINDING_TYPES if bt not in profiles[profile]]
    if missing:
        raise KeyError(f"profile '{profile}' of manifest.json has no {', '.join(missing)} model "
                       f"(use the manifest shipped with adabind)")
    return {bt: float(profiles[profile][bt]["threshold"]) for bt in BINDING_TYPES}


def verify_final_model(manifest: dict, final_model_dir: Path, profile: str) -> dict:
    """sha1[:16] check of every checkpoint the profile uses (guide section 3.2)."""
    members = sorted({
        member
        for bt in BINDING_TYPES
        for term in manifest["profiles"][profile][bt]["terms"]
        for member in term["members"]
    })
    checked, missing, mismatched = 0, [], []
    for member in members:
        for filename, expected in manifest["members"][member]["sha1_16"].items():
            path = final_model_dir / member / filename
            if not path.exists():
                missing.append(f"{member}/{filename}")
                continue
            checked += 1
            if hashlib.sha1(path.read_bytes()).hexdigest()[:16] != expected:
                mismatched.append(f"{member}/{filename}")
    return {"members": len(members), "files_checked": checked, "missing": missing, "mismatched": mismatched}


def check_foundation_files(weights_dir: Path, profile: str) -> dict[str, dict]:
    """Presence and size of the weight files (fast; the full sha256 is in scripts/check_environment.py)."""
    results = {}
    for name in PROFILE_FOUNDATIONS.get(profile, ()):
        rel, size, _ = FOUNDATION_FILES[name]
        path = weights_dir / rel
        if not path.exists():
            results[name] = {"status": "error", "message": f"Missing {path}"}
        elif path.stat().st_size != size:
            results[name] = {"status": "error",
                             "message": f"{path} is {path.stat().st_size} bytes, expected {size}"}
        else:
            results[name] = {"status": "ok", "message": f"{rel} ({size / 1e9:.2f} GB)"}
    return results


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 24), b""):
            digest.update(block)
    return digest.hexdigest()
