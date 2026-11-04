import sys
import types

import pytest

from app.errors import PredictorFailed, PredictorUnavailable
from app.predictor import MockPredictor, PbindPredictor, UnavailablePredictor, create_predictor

from .conftest import UBIQUITIN

THRESHOLDS = {"metal": 0.9148463010787964, "nuclear": 0.7078787878787879, "small": 0.4901010101010101}


@pytest.mark.parametrize("binding_type", THRESHOLDS)
def test_mock_is_deterministic_and_well_formed(binding_type):
    threshold = THRESHOLDS[binding_type]
    first = MockPredictor().predict(UBIQUITIN, binding_type, "", threshold)
    assert first == MockPredictor().predict(UBIQUITIN, binding_type, "", threshold)
    assert len(first) == len(UBIQUITIN)
    assert all(0.0 < p < 1.0 for p in first)
    assert 1 <= sum(p >= threshold for p in first) <= 10


def test_mock_differs_between_binding_types():
    metal = MockPredictor().predict(UBIQUITIN, "metal", "", THRESHOLDS["metal"])
    small = MockPredictor().predict(UBIQUITIN, "small", "", THRESHOLDS["small"])
    assert metal != small


def test_factory_mock():
    predictor, status = create_predictor("mock", "final", None, None)
    assert predictor.is_mock and status["status"] == "warning"


def test_factory_pbind_missing_gives_503_predictor(monkeypatch):
    monkeypatch.setitem(sys.modules, "pbind", None)  # import pbind -> ImportError
    predictor, status = create_predictor("pbind", "final", None, None)
    assert isinstance(predictor, UnavailablePredictor)
    assert status["status"] == "error" and "cannot import pbind" in status["message"]
    with pytest.raises(PredictorUnavailable) as exc:
        predictor.predict(UBIQUITIN, "metal", "", 0.5)
    assert exc.value.status_code == 503


def test_factory_unknown_kind():
    predictor, status = create_predictor("magic", "final", None, None)
    assert isinstance(predictor, UnavailablePredictor) and status["status"] == "error"


def install_fake_pbind(monkeypatch, predict):
    module = types.ModuleType("pbind")
    module.predict = predict
    monkeypatch.setitem(sys.modules, "pbind", module)


def test_pbind_is_called_like_the_integration_guide(monkeypatch, tmp_path):
    calls = []

    def predict(sequence, binding_type, pdb, profile, weights_dir, final_model_dir):
        calls.append((sequence, binding_type, pdb, profile, weights_dir, final_model_dir))
        return {"probability": [0.1] * len(sequence), "threshold": THRESHOLDS[binding_type]}

    install_fake_pbind(monkeypatch, predict)
    predictor, status = create_predictor("pbind", "final", tmp_path / "w", tmp_path / "f")
    assert isinstance(predictor, PbindPredictor) and status["status"] == "ok"
    assert predictor.predict(UBIQUITIN, "metal", "PDB", THRESHOLDS["metal"]) == [0.1] * 76
    assert calls == [(UBIQUITIN, "metal", "PDB", "final", str(tmp_path / "w"), str(tmp_path / "f"))]


@pytest.mark.parametrize("result,message", [
    ({"probability": [0.1] * 10}, "10 probabilities for 76 residues"),
    ({"probability": [float("nan")] * 76}, "outside"),
    ({"probability": [1.5] * 76}, "outside"),
    ({"probability": [0.1] * 76, "threshold": 0.5}, "differs from manifest"),
])
def test_pbind_invalid_results_are_rejected(monkeypatch, result, message):
    install_fake_pbind(monkeypatch, lambda *a, **k: result)
    predictor, _ = create_predictor("pbind", "final", None, None)
    with pytest.raises(PredictorFailed, match=message):
        predictor.predict(UBIQUITIN, "metal", "PDB", THRESHOLDS["metal"])


def test_pbind_exception_becomes_predictor_failed(monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError("CUDA out of memory")

    install_fake_pbind(monkeypatch, boom)
    predictor, _ = create_predictor("pbind", "final", None, None)
    with pytest.raises(PredictorFailed, match="RuntimeError: CUDA out of memory") as exc:
        predictor.predict(UBIQUITIN, "metal", "PDB", THRESHOLDS["metal"])
    assert exc.value.status_code == 500
