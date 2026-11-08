"""The real baseline worker, when backend/.venv-baselines and baselines_2124 are there."""
import numpy as np
import pytest

from app.baselines import MODELS, BaselineError, BaselineWorker
from app.config import BACKEND_DIR, REPO_DIR

PYTHON = BACKEND_DIR / ".venv-baselines" / "bin" / "python"
BASELINES = REPO_DIR / "baselines_2124"
needs_worker = pytest.mark.skipif(not (PYTHON.exists() and BASELINES.exists()), reason="baseline environment not built")


def test_missing_parts_are_named(tmp_path):
    assert "setup_env.sh --only baselines" in BaselineWorker(tmp_path / "python", BASELINES).missing()
    (tmp_path / "python").write_text("")
    assert "baselines_2124_*.zip" in BaselineWorker(tmp_path / "python", tmp_path / "nowhere").missing()


def test_start_without_the_environment_is_an_error(tmp_path):
    with pytest.raises(BaselineError, match="setup_env.sh"):
        BaselineWorker(tmp_path / "python", BASELINES).start()


@needs_worker
def test_real_worker_answers_probabilities_and_uses_the_structure():
    rng = np.random.default_rng(0)
    embedding = rng.normal(0, 0.2, (60, 1024)).astype(np.float32)
    line = np.column_stack([np.arange(60) * 3.8, np.zeros(60), np.zeros(60)])
    fold = np.column_stack([np.cos(np.arange(60) / 3) * 8, np.sin(np.arange(60) / 3) * 8, np.arange(60) * 0.5])
    worker = BaselineWorker(PYTHON, BASELINES)
    try:
        info = worker.start()
        assert info["bindEmbed21DL"] == 5 and info["bindNode24"] == 5
        first = worker.predict(embedding, line)
        again = worker.predict(embedding, line)
        other = worker.predict(embedding, fold)
    finally:
        worker.close()
    for model in MODELS:
        assert first[model].shape == (60, 3)
        assert np.array_equal(first[model], again[model])  # eval mode: no dropout
    assert np.array_equal(first["bindEmbed21DL"], other["bindEmbed21DL"])      # sequence only
    assert not np.array_equal(first["bindNode24"], other["bindNode24"])        # the graph comes from the structure
