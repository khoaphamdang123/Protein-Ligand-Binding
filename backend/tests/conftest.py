import json
from pathlib import Path

import httpx
import numpy as np
import pytest

from app.config import BACKEND_DIR, REPO_DIR, Settings

FIXTURES = Path(__file__).parent / "fixtures"
UBIQUITIN = "MQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQRLIFAGKQLEDGRTLSDYNIQKESTLHLVLRLRGG"
FINAL_MODEL_DIR = REPO_DIR / "adabind" / "final_model"
WEIGHTS_DIR = REPO_DIR / "foundation_models"
GOLDEN_DIR = REPO_DIR / "adabind" / "golden_set"
ESMIF_PYTHON = BACKEND_DIR / ".venv-esmif" / "bin" / "python"

requires_models = pytest.mark.skipif(not (FINAL_MODEL_DIR / "manifest.json").exists(), reason="final_model not present")
requires_golden = pytest.mark.skipif(not (GOLDEN_DIR / "index.json").exists(), reason="golden set not present")


@pytest.fixture
def ubiquitin_pdb() -> str:
    return (FIXTURES / "ubiquitin_esmfold.pdb").read_text()


@pytest.fixture
def make_settings(tmp_path):
    def _make(**overrides) -> Settings:
        values = dict(
            weights_dir=WEIGHTS_DIR,
            final_model_dir=FINAL_MODEL_DIR,
            cache_dir=tmp_path / "cache",
            log_dir=tmp_path / "logs",
            predictor="mock",
            profile="final",
            esmfold_url="https://esmfold.test/fold",
            esmfold_timeout=5.0,
            min_length=30,
            max_length=400,
            esmif_python=Path("unused"),
            device="cpu",
            warmup=False,
            golden_dir=GOLDEN_DIR,
            esmfold_backoff=0.01,
        )
        values.update(overrides)
        return Settings(**values)

    return _make


class FakeEsmFold:
    """httpx transport standing in for the ESM Atlas API; records every call."""

    def __init__(self, responder):
        self.responder = responder
        self.calls: list[str] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(request.content.decode())
        return self.responder(request)

    @property
    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self)


@pytest.fixture
def esmfold_returning(ubiquitin_pdb):
    """FakeEsmFold that folds ubiquitin and answers HTTP `status` (body `text`) for anything else."""

    def _make(status: int = 200, text: str | None = None):
        def responder(request: httpx.Request) -> httpx.Response:
            if status == 200 and text is None:
                return httpx.Response(200, text=ubiquitin_pdb)
            return httpx.Response(status, text=text or "")

        return FakeEsmFold(responder)

    return _make


class FakeEsmIfWorker:
    """Stands in for app.esmif.EsmIfWorker: returns a fixed embedding per sequence (or a deterministic one)."""

    def __init__(self, embeddings: dict[str, np.ndarray] | None = None, error: Exception | None = None):
        self.embeddings = embeddings or {}
        self.error = error
        self.calls: list[str] = []
        self.started = 0
        self.closed = False

    def start(self) -> dict:
        self.started += 1
        return {"device": "fake"}

    def embed(self, chain_pdb: Path, sequence: str) -> np.ndarray:
        assert Path(chain_pdb).read_text().startswith(("ATOM", "HEADER", "REMARK", "MODEL")), "not a PDB"
        self.calls.append(sequence)
        if self.error:
            raise self.error
        if sequence in self.embeddings:
            return self.embeddings[sequence]
        rng = np.random.default_rng(len(sequence))
        return rng.normal(0, 0.3, (len(sequence), 512)).astype(np.float32)

    def close(self) -> None:
        self.closed = True


def fake_embedding(name: str, sequence: str) -> np.ndarray:
    dim = {"ESM": 1280, "PROTT5": 1024}[name]
    rng = np.random.default_rng(len(sequence) + dim)
    return rng.normal(0, 0.2, (len(sequence), dim)).astype(np.float16)


@pytest.fixture
def golden_protein():
    """Smallest golden protein: (sequence, pdb text, npz with training embeddings and reference predictions)."""
    index = json.loads((GOLDEN_DIR / "index.json").read_text())
    entry = min(index["proteins"], key=lambda e: e["length"])
    return (entry["sequence"], (GOLDEN_DIR / f"{entry['prot_id']}.pdb").read_text(),
            dict(np.load(GOLDEN_DIR / f"{entry['prot_id']}.npz")))


class FakeLocalEsmFold:
    """Stands in for app.esmfold_local.LocalEsmFold: folds with a callable, records calls."""

    name = "local"

    def __init__(self, fold=None, device: str = "cuda"):
        self._fold = fold
        self.device = device
        self.calls: list[str] = []
        self.loaded = False

    def load(self) -> dict:
        self.loaded = True
        return {"device": self.device}

    def fold(self, sequence: str) -> str:
        self.calls.append(sequence)
        return self._fold(sequence)
