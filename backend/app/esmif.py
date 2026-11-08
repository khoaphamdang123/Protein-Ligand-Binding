"""ESM-IF1 embeddings from the separate ESM-IF environment (numpy<2, fair-esm 2.0.0).

The main environment needs numpy>=2 (the metal checkpoints pickle numpy._core arrays) and fair-esm needs
numpy<2, so ESM-IF runs in its own interpreter: one long-lived worker process (scripts/esmif_worker.py) that
loads the 1.7 GB model once. Requests and answers are JSON lines; the embedding travels as a .npy file.
"""
import logging
import tempfile
import uuid
from pathlib import Path

import numpy as np

from .line_worker import LineWorker

log = logging.getLogger("bindsite.esmif")

WORKER_SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "esmif_worker.py"
ESMIF_DIM = 512


class EsmIfError(RuntimeError):
    pass


class EsmIfWorker(LineWorker):
    label = "ESM-IF"
    error_type = EsmIfError
    log = log

    def __init__(self, python: Path, weights: Path, device: str = "", timeout: float = 300.0,
                 startup_timeout: float = 300.0, torch_home: Path | None = None, script: Path = WORKER_SCRIPT):
        super().__init__(python, script, timeout, startup_timeout)
        self.weights = Path(weights)
        self.device = device
        self.torch_home = torch_home

    def _check_files(self) -> None:
        if not self.python.exists():
            raise EsmIfError(f"ESM-IF environment not found: {self.python} (run backend/setup_env.sh)")
        if not self.weights.exists():
            raise EsmIfError(f"ESM-IF weights not found: {self.weights}")

    def _arguments(self) -> list[str]:
        return ["--weights", str(self.weights), *(["--device", self.device] if self.device else [])]

    def _environment(self, env: dict) -> None:
        if self.torch_home:
            env["TORCH_HOME"] = str(self.torch_home)

    def embed(self, chain_pdb: Path, sequence: str) -> np.ndarray:
        """ESM-IF (L, 512) float32 of chain A of ``chain_pdb`` (must match ``sequence`` exactly)."""
        return self._with_restart(lambda: self._embed(chain_pdb, sequence))

    def _embed(self, chain_pdb: Path, sequence: str) -> np.ndarray:
        with tempfile.TemporaryDirectory(prefix="esmif_") as tmp:
            out = Path(tmp) / "query.ESMIF.npy"
            msg = self._request({"id": uuid.uuid4().hex[:8], "pdb": str(chain_pdb), "sequence": sequence,
                                 "out": str(out)}, "embedding")
            if not msg.get("ok"):
                raise EsmIfError(f"ESM-IF failed: {msg.get('error')}")
            arr = np.load(out)
        if arr.shape != (len(sequence), ESMIF_DIM) or not np.isfinite(arr).all():
            raise EsmIfError(f"ESM-IF returned shape {arr.shape} for {len(sequence)} residues (or NaN/inf)")
        return arr
