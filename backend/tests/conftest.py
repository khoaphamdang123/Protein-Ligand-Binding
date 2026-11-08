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


def ca_only_pdb(sequence: str, plddt: float = 0.9) -> str:
    """Minimal chain-A PDB (one CA per residue) whose sequence is `sequence`."""
    three = {v: k for k, v in {"ALA": "A", "ARG": "R", "ASN": "N", "ASP": "D", "CYS": "C", "GLN": "Q", "GLU": "E",
                                "GLY": "G", "HIS": "H", "ILE": "I", "LEU": "L", "LYS": "K", "MET": "M", "PHE": "F",
                                "PRO": "P", "SER": "S", "THR": "T", "TRP": "W", "TYR": "Y", "VAL": "V"}.items()}
    lines = [f"ATOM  {i:5d}  CA  {three[aa]} A{i:4d}    {i * 3.8:8.3f}{0.0:8.3f}{0.0:8.3f}  1.00{plddt:6.2f}           C"
             for i, aa in enumerate(sequence, 1)]
    return "\n".join(lines + ["TER", "END"]) + "\n"


class FakeBaselineWorker:
    """Stands in for app.baselines.BaselineWorker: columns metal 0.9, nuclear 0.2, small 0.6 unless told otherwise."""

    def __init__(self, problem: str | None = None, error: Exception | None = None):
        self.problem = problem
        self.error = error
        self.calls: list[tuple] = []
        self.cas: list[np.ndarray] = []
        self.closed = False

    def missing(self) -> str | None:
        return self.problem

    def predict(self, embedding: np.ndarray, ca: np.ndarray) -> dict:
        self.calls.append((embedding.shape, ca.shape))
        self.cas.append(np.asarray(ca))
        if self.error:
            raise self.error
        row = np.array([0.9, 0.2, 0.6])
        return {"bindEmbed21DL": np.tile(row, (len(ca), 1)), "bindNode24": np.tile(row[::-1], (len(ca), 1))}

    def close(self) -> None:
        self.closed = True


class FakeLocalFold:
    """Stands in for app.esmfold_local.LocalFoldService: ready() answers (ok, reason); fold() uses a callable."""

    def __init__(self, fold=None, ready: tuple[bool, str] = (True, ""), device: str = "cuda"):
        self._fold = fold
        self._ready = ready
        self.device = device
        self.calls: list[str] = []
        self.ready_calls = 0

    @property
    def background(self) -> bool:  # as LocalFoldService: CPU folds are queued
        return not self.device.startswith("cuda")

    def can_queue(self) -> tuple[bool, str]:
        return self._ready

    def ready(self) -> tuple[bool, str]:
        self.ready_calls += 1
        return self._ready

    def status(self) -> dict:
        ok, why = self._ready
        return {"status": "ok" if ok else "warning", "state": "ready" if ok else "unavailable",
                "message": why or "ready", "device": self.device}

    def fold(self, sequence: str) -> str:
        self.calls.append(sequence)
        return self._fold(sequence)


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


def moved_pdb(pdb_text: str, plddt_scale: float = 100.0) -> str:
    """The same structure turned 90 degrees and shifted, pLDDT on a 0-100 scale: an AlphaFold DB file of it."""
    out = []
    for line in pdb_text.splitlines():
        if line.startswith("ATOM"):
            x, y, z = float(line[30:38]), float(line[38:46]), float(line[46:54])
            b = float(line[60:66]) * plddt_scale
            line = f"{line[:30]}{-y + 10:8.3f}{x - 5:8.3f}{z + 2:8.3f}{line[54:60]}{b:6.2f}{line[66:]}"
        out.append(line)
    return "\n".join(out) + "\n"


class FakeAlphaFoldDB:
    """httpx transport standing in for alphafold.ebi.ac.uk; knows the sequences in `models` ({sequence: pdb text})."""

    def __init__(self, models: dict[str, str] | None = None, status: int | None = None):
        self.models = models or {}
        self.status = status
        self.calls: list[str] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(request.url.path)
        if self.status:
            return httpx.Response(self.status, text="down")
        if request.url.path.endswith("/sequence/summary"):
            seq = request.url.params["id"]
            if seq not in self.models:
                return httpx.Response(404, json={"message": "No results found"})
            other = {"provider": "AlphaFold DB", "model_identifier": "AF-0000000066011125", "created": "2026-02-19",
                     "sequence_identity": 1.0, "coverage": 1.0,
                     "model_url": "https://alphafold.test/files/AF-0000000066011125-model_v1.cif"}
            uniprot = {"provider": "AlphaFold DB", "model_identifier": "AF-P0CG48-F1", "created": "2022-06-01",
                       "sequence_identity": 1.0, "coverage": 1.0, "model_page_url": "https://alphafold.test/entry/AF-P0CG48-F1",
                       "model_url": "https://alphafold.test/files/AF-P0CG48-F1-model_v6.cif"}
            own = {**uniprot, "model_identifier": "AF-Q99999-F1", "created": "2025-08-01",
                   "model_url": "https://alphafold.test/files/AF-Q99999-F1-model_v6.cif"}
            return httpx.Response(200, json={"structures": [{"summary": other}, {"summary": own}, {"summary": uniprot}]})
        if request.url.path.endswith(".pdb"):
            return httpx.Response(200, text=next(iter(self.models.values())))
        return httpx.Response(404)

    @property
    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self)
