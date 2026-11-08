"""bindEmbed21DL and bindNode24, run live for the compare mode of the Predict page.

They need other library versions than the main environment, so they run in a worker (scripts/baseline_worker.py, in
backend/.venv-baselines), started on the first request. Both predict three classes at once (metal, nuclear, small) and
have no DNA- or RNA-specific output: for DNA and RNA their nucleic-acid output is shown, as in the published comparison.
"""
import logging
import tempfile
import uuid
from pathlib import Path

import numpy as np

from .errors import ApiError
from .line_worker import LineWorker

log = logging.getLogger("bindsite.baselines")

WORKER_SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "baseline_worker.py"
MODELS = ("bindEmbed21DL", "bindNode24")
OUTPUTS = ("metal", "nuclear", "small")   # column order of the models' output
OUTPUT_OF_LIGAND = {"metal": "metal", "small": "small", "nuclear": "nuclear", "dna": "nuclear", "rna": "nuclear"}
THRESHOLD = 0.5                           # the operating point both models were published at


class BaselineError(RuntimeError):
    pass


class BaselinesUnavailable(ApiError):
    def __init__(self, message: str):
        super().__init__(503, "BASELINES_UNAVAILABLE", message)


class BaselinesFailed(ApiError):
    def __init__(self, message: str):
        super().__init__(500, "BASELINES_FAILED", message)


class BaselineWorker(LineWorker):
    label = "baseline"
    error_type = BaselineError
    log = log

    def __init__(self, python: Path, baselines_dir: Path, timeout: float = 120.0, startup_timeout: float = 120.0,
                 script: Path = WORKER_SCRIPT):
        super().__init__(python, script, timeout, startup_timeout)
        self.baselines_dir = Path(baselines_dir)

    def missing(self) -> str | None:
        """What is missing to run the models, or None."""
        if not self.python.exists():
            return f"{self.python} not found (run: bash backend/setup_env.sh --only baselines)"
        for part in ("bindEmbed21DL/trained_models/checkpoint1.pt", "bindNode24/trained_model_dicts/bindNode24"):
            if not (self.baselines_dir / part).exists():
                return f"{self.baselines_dir / part} not found (unzip baselines_2124_*.zip next to adabind/)"
        return None

    def _check_files(self) -> None:
        problem = self.missing()
        if problem:
            raise BaselineError(problem)

    def _arguments(self) -> list[str]:
        return ["--baselines-dir", str(self.baselines_dir)]

    def predict(self, embedding: np.ndarray, ca: np.ndarray) -> dict[str, np.ndarray]:
        """{model: (L, 3) probabilities, columns as OUTPUTS} from ProtT5 (L, 1024) and Cα coordinates (L, 3)."""
        return self._with_restart(lambda: self._predict(embedding, ca))

    def _predict(self, embedding: np.ndarray, ca: np.ndarray) -> dict[str, np.ndarray]:
        with tempfile.TemporaryDirectory(prefix="baselines_") as tmp:
            emb_file, ca_file, out = Path(tmp) / "t5.npy", Path(tmp) / "ca.npy", Path(tmp) / "out.npz"
            np.save(emb_file, np.asarray(embedding, dtype=np.float32))
            np.save(ca_file, np.asarray(ca, dtype=np.float64))
            msg = self._request({"id": uuid.uuid4().hex[:8], "embedding": str(emb_file), "ca": str(ca_file),
                                 "out": str(out)}, "prediction")
            if not msg.get("ok"):
                raise BaselineError(f"baseline models failed: {msg.get('error')}")
            with np.load(out) as data:
                result = {m: data[m] for m in MODELS}
        length = embedding.shape[0]
        for model, arr in result.items():
            if arr.shape != (length, 3) or not np.isfinite(arr).all() or arr.min() < 0 or arr.max() > 1:
                raise BaselineError(f"{model} returned shape {arr.shape} for {length} residues, or invalid values")
        return result
