"""Backend settings. Every value can be overridden with an environment variable."""
import os
from dataclasses import dataclass
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BACKEND_DIR.parent

# The five ligand classes of adabind/final_model/manifest.json (profile "final"). dna / rna are their own
# model lines, NOT a split of "nuclear": choosing nuclear or dna/rna asks a different question.
BINDING_TYPES = ("metal", "nuclear", "small", "dna", "rna")

_VENV_BIN = "Scripts" if os.name == "nt" else "bin"
_VENV_PY = "python.exe" if os.name == "nt" else "python"

# Models whose device can be chosen one by one (BINDSITE_DEVICE_<NAME>, falling back to BINDSITE_DEVICE, then
# "cuda when available, else cpu"). "models" = the 140 binding-site checkpoints + hand-crafted features.
DEVICE_KEYS = ("esmfold", "esm2", "prott5", "esmif", "models")
API_MAX_LENGTH = 400   # ESM Atlas API limit (HTTP 413 above)
LOCAL_MAX_LENGTH = 1000  # pbind accepts 30-1000 aa (training proteins up to 813: a warning is returned above that)


def _env_path(name: str, default: Path) -> Path:
    # absolute(), not resolve(): resolving a venv's bin/python symlink would leave the venv
    return Path(os.environ.get(name, str(default))).expanduser().absolute()


@dataclass(frozen=True)
class Settings:
    weights_dir: Path
    final_model_dir: Path
    cache_dir: Path
    log_dir: Path
    predictor: str          # "pbind" (real models) or "mock" (synthetic, for UI work without the models)
    profile: str
    esmfold_url: str
    esmfold_timeout: float
    min_length: int
    max_length: int
    esmif_python: Path
    device: str = ""        # default device of every model: "" = cuda when available, else cpu
    devices: tuple = ()     # per-model overrides, e.g. (("esmfold", "cpu"),); see DEVICE_KEYS
    esmfold_local: str = "off"   # "auto": self-hosted ESMFold first, API as fallback | "off": API only
    esmif_timeout: float = 300.0
    warmup: bool = True     # run the full pipeline once at start-up (loads every model, golden self-test)
    golden_dir: Path = REPO_DIR / "adabind" / "golden_set"
    esmfold_attempts: int = 3          # retries of gateway errors / timeouts (the public API is flaky)
    esmfold_backoff: float = 3.0
    esmfold_total_timeout: float = 110.0  # all attempts; the UI gives up after 150 s

    @classmethod
    def from_env(cls) -> "Settings":
        weights_dir = _env_path("BINDSITE_WEIGHTS_DIR", REPO_DIR / "foundation_models")
        esmfold_local = os.environ.get("BINDSITE_ESMFOLD_LOCAL", "auto").strip().lower()
        if esmfold_local not in ("auto", "off"):
            raise ValueError(f"BINDSITE_ESMFOLD_LOCAL must be auto or off, not {esmfold_local!r}")
        local = esmfold_local == "auto" and (weights_dir / "esmfold_v1" / "pytorch_model.bin").exists()
        devices = tuple((k, os.environ[f"BINDSITE_DEVICE_{k.upper()}"].strip().lower()) for k in DEVICE_KEYS
                        if os.environ.get(f"BINDSITE_DEVICE_{k.upper()}", "").strip())
        return cls(
            weights_dir=weights_dir,
            final_model_dir=_env_path("BINDSITE_FINAL_MODEL_DIR", REPO_DIR / "adabind" / "final_model"),
            cache_dir=_env_path("BINDSITE_CACHE_DIR", BACKEND_DIR / "cache"),
            log_dir=_env_path("BINDSITE_LOG_DIR", BACKEND_DIR / "logs"),
            predictor=os.environ.get("BINDSITE_PREDICTOR", "pbind").strip().lower(),
            profile=os.environ.get("BINDSITE_PROFILE", "final").strip().lower(),
            esmfold_url=os.environ.get("ESMFOLD_URL", "https://api.esmatlas.com/foldSequence/v1/pdb/"),
            esmfold_timeout=float(os.environ.get("ESMFOLD_TIMEOUT", "90")),
            min_length=int(os.environ.get("BINDSITE_MIN_LENGTH", "30")),
            max_length=int(os.environ.get("BINDSITE_MAX_LENGTH", LOCAL_MAX_LENGTH if local else API_MAX_LENGTH)),
            esmif_python=_env_path("BINDSITE_ESMIF_PYTHON", BACKEND_DIR / ".venv-esmif" / _VENV_BIN / _VENV_PY),
            device=os.environ.get("BINDSITE_DEVICE", "").strip().lower(),
            devices=devices,
            esmfold_local=esmfold_local if local else "off",
            esmif_timeout=float(os.environ.get("BINDSITE_ESMIF_TIMEOUT", "300")),
            warmup=os.environ.get("BINDSITE_WARMUP", "1").strip().lower() not in ("0", "false", "no"),
            golden_dir=_env_path("BINDSITE_GOLDEN_DIR", REPO_DIR / "adabind" / "golden_set"),
            esmfold_attempts=int(os.environ.get("ESMFOLD_ATTEMPTS", "3")),
            esmfold_backoff=float(os.environ.get("ESMFOLD_BACKOFF", "3")),
            esmfold_total_timeout=float(os.environ.get("ESMFOLD_TOTAL_TIMEOUT", "110")),
        )

    def device_for(self, key: str) -> str:
        """Device of one model: BINDSITE_DEVICE_<KEY>, else BINDSITE_DEVICE, else cuda when available."""
        if key not in DEVICE_KEYS:
            raise KeyError(key)
        spec = dict(self.devices).get(key) or self.device
        if not spec:
            import torch

            spec = "cuda" if torch.cuda.is_available() else "cpu"
        if spec not in ("cpu", "cuda") and not spec.startswith("cuda:"):
            raise ValueError(f"device for {key} must be cpu, cuda or cuda:N, not {spec!r}")
        return spec

    def all_devices(self) -> dict[str, str]:
        return {k: self.device_for(k) for k in DEVICE_KEYS}

    @property
    def torch_home(self) -> Path:
        return self.weights_dir / "torch_home"

    @property
    def esmfold_dir(self) -> Path:
        return self.weights_dir / "esmfold_v1"

    @property
    def esmif_weights(self) -> Path:
        return self.weights_dir / "esm_if1" / "esm_if1_gvp4_t16_142M_UR50.pt"


def apply_offline_environment(settings: Settings) -> None:
    """Integration guide section 4: run offline (except the ESMFold API) and load ESM-IF from TORCH_HOME."""
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
    os.environ.setdefault("TORCH_HOME", str(settings.torch_home))
