from pathlib import Path

import httpx
import pytest

from app.config import REPO_DIR, Settings

FIXTURES = Path(__file__).parent / "fixtures"
UBIQUITIN = "MQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQRLIFAGKQLEDGRTLSDYNIQKESTLHLVLRLRGG"
FINAL_MODEL_DIR = REPO_DIR / "final_models" / "final_model"
WEIGHTS_DIR = REPO_DIR / "model_weights"


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
