"""Backend settings. Every value can be overridden with an environment variable."""
import os
from dataclasses import dataclass
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BACKEND_DIR.parent

BINDING_TYPES = ("metal", "nuclear", "small")


def _env_path(name: str, default: Path) -> Path:
    return Path(os.environ.get(name, str(default))).resolve()


@dataclass(frozen=True)
class Settings:
    weights_dir: Path
    final_model_dir: Path
    cache_dir: Path
    log_dir: Path
    predictor: str          # "mock" until pbind is delivered, then "pbind"
    profile: str
    esmfold_url: str
    esmfold_timeout: float
    min_length: int
    max_length: int
    esmif_python: Path

    @classmethod
    def from_env(cls) -> "Settings":
        weights_dir = _env_path("BINDSITE_WEIGHTS_DIR", REPO_DIR / "model_weights")
        return cls(
            weights_dir=weights_dir,
            final_model_dir=_env_path("BINDSITE_FINAL_MODEL_DIR", REPO_DIR / "final_models" / "final_model"),
            cache_dir=_env_path("BINDSITE_CACHE_DIR", BACKEND_DIR / "cache"),
            log_dir=_env_path("BINDSITE_LOG_DIR", BACKEND_DIR / "logs"),
            predictor=os.environ.get("BINDSITE_PREDICTOR", "mock").strip().lower(),
            profile=os.environ.get("BINDSITE_PROFILE", "final").strip().lower(),
            esmfold_url=os.environ.get("ESMFOLD_URL", "https://api.esmatlas.com/foldSequence/v1/pdb/"),
            esmfold_timeout=float(os.environ.get("ESMFOLD_TIMEOUT", "90")),
            min_length=int(os.environ.get("BINDSITE_MIN_LENGTH", "30")),
            max_length=int(os.environ.get("BINDSITE_MAX_LENGTH", "400")),
            esmif_python=_env_path("BINDSITE_ESMIF_PYTHON", BACKEND_DIR / ".venv-esmif" / "Scripts" / "python.exe"),
        )

    @property
    def torch_home(self) -> Path:
        return self.weights_dir / "torch_home"


def apply_offline_environment(settings: Settings) -> None:
    """Integration guide section 4: run offline (except the ESMFold API) and load ESM-IF from TORCH_HOME."""
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
    os.environ.setdefault("TORCH_HOME", str(settings.torch_home))
