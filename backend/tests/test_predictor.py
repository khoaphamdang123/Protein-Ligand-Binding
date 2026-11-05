import sys

import numpy as np
import pytest

from app.config import BINDING_TYPES
from app.errors import PredictorFailed, PredictorUnavailable
from app.esmif import EsmIfError
from app.predictor import (MockPredictor, PbindPredictor, Prediction, SelfTestFailed, UnavailablePredictor,
                           create_predictor)

from .conftest import UBIQUITIN, FakeEsmIfWorker, fake_embedding, requires_golden, requires_models

THRESHOLDS = {"metal": 0.9148463010787964, "nuclear": 0.7078787878787879, "small": 0.4901010101010101,
              "dna": 0.5643434343434344, "rna": 0.7771717171717172}


# ---------------------------------------------------------------------------------------------- mock
@pytest.mark.parametrize("binding_type", BINDING_TYPES)
def test_mock_is_deterministic_and_well_formed(binding_type):
    threshold = THRESHOLDS[binding_type]
    first = MockPredictor().predict(UBIQUITIN, binding_type, "", threshold)
    assert isinstance(first, Prediction)
    assert first.probability == MockPredictor().predict(UBIQUITIN, binding_type, "", threshold).probability
    assert len(first.probability) == len(UBIQUITIN)
    assert all(0.0 < p < 1.0 for p in first.probability)
    assert 1 <= sum(p >= threshold for p in first.probability) <= 10


def test_mock_differs_between_binding_types():
    metal = MockPredictor().predict(UBIQUITIN, "metal", "", THRESHOLDS["metal"])
    small = MockPredictor().predict(UBIQUITIN, "small", "", THRESHOLDS["small"])
    assert metal.probability != small.probability


# ---------------------------------------------------------------------------------------------- factory
def test_factory_mock(make_settings):
    predictor, status = create_predictor(make_settings(predictor="mock"))
    assert predictor.is_mock and status["status"] == "warning"


def test_factory_pbind_missing_gives_503_predictor(make_settings, monkeypatch):
    monkeypatch.setitem(sys.modules, "pbind", None)  # import pbind -> ImportError
    monkeypatch.delitem(sys.modules, "pbind.inference.predictor", raising=False)
    monkeypatch.delitem(sys.modules, "pbind.inference", raising=False)
    predictor, status = create_predictor(make_settings(predictor="pbind"))
    assert isinstance(predictor, UnavailablePredictor)
    assert status["status"] == "error" and "cannot create pbind.Predictor" in status["message"]
    with pytest.raises(PredictorUnavailable) as exc:
        predictor.predict(UBIQUITIN, "metal", "", 0.5)
    assert exc.value.status_code == 503


def test_factory_unknown_kind(make_settings):
    predictor, status = create_predictor(make_settings(predictor="magic"))
    assert isinstance(predictor, UnavailablePredictor) and status["status"] == "error"


@requires_models
def test_factory_pbind_bad_model_dir(make_settings, tmp_path):
    predictor, status = create_predictor(make_settings(predictor="pbind", final_model_dir=tmp_path))
    assert isinstance(predictor, UnavailablePredictor) and "manifest.json" in status["message"]


# ---------------------------------------------------------------------------------------------- real pbind
@pytest.fixture
def pbind_predictor(make_settings, monkeypatch):
    """Real pbind.Predictor + the real 140 checkpoints on CPU; ESM-2 / ProtT5 / ESM-IF replaced by fixed arrays
    so the test needs no foundation model (the golden-set test below feeds the training embeddings)."""
    from pbind.inference import predictor as pbind_predictor_module

    calls = {"ESM": 0, "PROTT5": 0}

    def esm2(self, seq):
        calls["ESM"] += 1
        return fake_embedding("ESM", seq)

    def prott5(self, seq):
        calls["PROTT5"] += 1
        return fake_embedding("PROTT5", seq)

    monkeypatch.setattr(pbind_predictor_module.Predictor, "esm2", esm2)
    monkeypatch.setattr(pbind_predictor_module.Predictor, "prott5", prott5)
    worker = FakeEsmIfWorker()
    predictor, status = create_predictor(make_settings(predictor="pbind"), esmif_worker=worker)
    assert status["status"] == "ok", status
    predictor.calls, predictor.worker = calls, worker
    return predictor


@requires_models
@pytest.mark.parametrize("binding_type", BINDING_TYPES)
def test_pbind_predicts_every_binding_type(pbind_predictor, ubiquitin_pdb, binding_type):
    out = pbind_predictor.predict(UBIQUITIN, binding_type, ubiquitin_pdb, THRESHOLDS[binding_type])
    assert len(out.probability) == len(UBIQUITIN)
    assert all(0.0 <= p <= 1.0 for p in out.probability)
    assert {"esm_s", "esmif_s", "model_s"} <= set(out.timing)
    assert ("prott5_s" in out.timing) == (binding_type != "metal")  # metal needs no ProtT5


@requires_models
def test_pbind_reuses_embeddings_across_binding_types(pbind_predictor, ubiquitin_pdb):
    for bt in ("small", "dna", "rna", "metal"):
        pbind_predictor.predict(UBIQUITIN, bt, ubiquitin_pdb, THRESHOLDS[bt])
    assert pbind_predictor.calls == {"ESM": 1, "PROTT5": 1}
    assert pbind_predictor.worker.calls == [UBIQUITIN]


@requires_models
@pytest.mark.parametrize("result,message", [
    ({"probability": [0.1] * 10}, "10 probabilities for 76 residues"),
    ({"probability": [float("nan")] * 76}, "outside"),
    ({"probability": [1.5] * 76}, "outside"),
    ({"probability": [0.1] * 76, "threshold": 0.5}, "differs from manifest"),
    ({"probability": [0.1] * 76, "binding_type": "small"}, "answered for 'small'"),
])
def test_pbind_invalid_results_are_rejected(pbind_predictor, ubiquitin_pdb, result, message):
    full = {"threshold": THRESHOLDS["metal"], "binding_type": "metal", **result}
    pbind_predictor._pred.predict = lambda **kwargs: full
    with pytest.raises(PredictorFailed, match=message):
        pbind_predictor.predict(UBIQUITIN, "metal", ubiquitin_pdb, THRESHOLDS["metal"])


@requires_models
def test_pbind_exception_becomes_predictor_failed(pbind_predictor, ubiquitin_pdb):
    def boom(**kwargs):
        raise RuntimeError("CUDA out of memory")

    pbind_predictor._pred.predict = boom
    with pytest.raises(PredictorFailed, match="RuntimeError: CUDA out of memory") as exc:
        pbind_predictor.predict(UBIQUITIN, "metal", ubiquitin_pdb, THRESHOLDS["metal"])
    assert exc.value.status_code == 500


@requires_models
def test_esmif_failure_becomes_predictor_failed(pbind_predictor, ubiquitin_pdb):
    pbind_predictor.worker.error = EsmIfError("worker exited with code 1")
    with pytest.raises(PredictorFailed, match="ESM-IF embedding failed: worker exited"):
        pbind_predictor.predict(UBIQUITIN, "nuclear", ubiquitin_pdb, THRESHOLDS["nuclear"])


@requires_models
def test_pdb_that_does_not_match_the_sequence_is_refused(pbind_predictor, ubiquitin_pdb):
    other = "M" + UBIQUITIN[1:-1] + "A"
    with pytest.raises(PredictorFailed, match="no chain of the PDB matches the sequence"):
        pbind_predictor.predict(other, "small", ubiquitin_pdb, THRESHOLDS["small"])


# ---------------------------------------------------------------------------------------------- golden set
@requires_models
@requires_golden
@pytest.mark.parametrize("binding_type", ["metal", "nuclear", "small"])
def test_pipeline_reproduces_the_golden_reference(make_settings, golden_protein, binding_type):
    """Training embeddings + training PDB in, the shipped reference out (verify_installation.py step [2])."""
    seq, pdb, ref = golden_protein
    predictor, _ = create_predictor(make_settings(predictor="pbind"), esmif_worker=FakeEsmIfWorker())
    out, _ = predictor._run(seq, binding_type, pdb, embeddings={k: ref[k] for k in ("ESM", "ESMIF", "PROTT5")})
    assert np.abs(np.asarray(out["probability"]) - ref[f"pipeline_final_{binding_type}"]).max() < 1e-4


@requires_models
@requires_golden
def test_self_test_passes_with_training_embeddings_and_fails_with_wrong_ones(make_settings, golden_protein,
                                                                          monkeypatch):
    from pbind.inference import predictor as pbind_predictor_module

    seq, _, ref = golden_protein
    monkeypatch.setattr(pbind_predictor_module.Predictor, "esm2", lambda self, s: ref["ESM"])
    monkeypatch.setattr(pbind_predictor_module.Predictor, "prott5", lambda self, s: ref["PROTT5"])
    worker = FakeEsmIfWorker({seq: ref["ESMIF"]})
    predictor, _ = create_predictor(make_settings(predictor="pbind"), esmif_worker=worker)
    result = predictor.self_test(make_settings().golden_dir)
    assert worker.started == 1
    assert set(result["details"]["max_abs_diff_vs_golden"]) == {"metal", "nuclear", "small"}
    assert set(result["details"]["binding_calls"]) == set(BINDING_TYPES)

    # A wrongly set-up foundation model gives numbers without error: the self-test must catch it.
    monkeypatch.setattr(pbind_predictor_module.Predictor, "esm2", lambda self, s: fake_embedding("ESM", s))
    predictor, _ = create_predictor(make_settings(predictor="pbind"), esmif_worker=FakeEsmIfWorker({seq: ref["ESMIF"]}))
    with pytest.raises(SelfTestFailed, match="ESM cosine"):
        predictor.self_test(make_settings().golden_dir)
