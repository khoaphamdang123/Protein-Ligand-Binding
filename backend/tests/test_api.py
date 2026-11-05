"""End-to-end tests of the HTTP API against the contract in the integration guide (section 5)."""
import hashlib
import logging
import sys
import time

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import create_app

from .conftest import FINAL_MODEL_DIR, UBIQUITIN, FakeEsmFold, FakeEsmIfWorker, fake_embedding, requires_golden

pytestmark = pytest.mark.skipif(not (FINAL_MODEL_DIR / "manifest.json").exists(), reason="final_model not present")

MANIFEST_SHA1 = hashlib.sha1((FINAL_MODEL_DIR / "manifest.json").read_bytes()).hexdigest() \
    if (FINAL_MODEL_DIR / "manifest.json").exists() else None


@pytest.fixture
def make_client(make_settings, esmfold_returning):
    def _make(fake: FakeEsmFold | None = None, raise_server_exceptions: bool = True, esmif_worker=None,
              local_esmfold=None, **settings):
        fake = fake or esmfold_returning()
        app = create_app(make_settings(**settings), esmfold_transport=fake.transport, esmif_worker=esmif_worker,
                         local_esmfold=local_esmfold)
        return TestClient(app, raise_server_exceptions=raise_server_exceptions), fake

    return _make


@pytest.fixture
def fake_foundation_models(monkeypatch):
    """Real pbind + checkpoints, but fixed ESM-2 / ProtT5 arrays (no 5 GB of foundation weights in unit tests)."""
    from pbind.inference import predictor as pbind_predictor_module

    monkeypatch.setattr(pbind_predictor_module.Predictor, "esm2", lambda self, s: fake_embedding("ESM", s))
    monkeypatch.setattr(pbind_predictor_module.Predictor, "prott5", lambda self, s: fake_embedding("PROTT5", s))


def post_predict(client, sequence=UBIQUITIN, binding_type="metal"):
    return client.post("/predict", json={"sequence": sequence, "binding_type": binding_type})


def post_predict_pdb(client, pdb, binding_type="metal"):
    return client.post("/predict-pdb", json={"pdb": pdb, "binding_type": binding_type})


def test_health_contract(make_client):
    client, _ = make_client()
    with client:
        body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["model_version"] == MANIFEST_SHA1
    assert body["max_length"] == 400
    assert body["predictor"] == "mock" and body["mock"] is True
    assert body["binding_types"] == ["metal", "nuclear", "small", "dna", "rna"]
    assert set(body["thresholds"]) == set(body["binding_types"])


@pytest.mark.parametrize("binding_type,threshold", [
    ("metal", 0.9148463010787964), ("nuclear", 0.7078787878787879), ("small", 0.4901010101010101),
    ("dna", 0.5643434343434344), ("rna", 0.7771717171717172)])
def test_predict_contract(make_client, binding_type, threshold):
    client, fake = make_client()
    with client:
        response = post_predict(client, f">ubiquitin\n{UBIQUITIN.lower()}", binding_type)
    assert response.status_code == 200, response.text
    assert response.headers["X-Request-ID"]
    r = response.json()

    assert r["sequence"] == UBIQUITIN and r["length"] == 76
    assert r["binding_type"] == binding_type and r["profile"] == "final"
    assert r["model_version"] == MANIFEST_SHA1
    assert r["threshold"] == threshold
    assert len(r["probability"]) == len(r["binding"]) == len(r["structure"]["plddt"]) == 76
    assert r["binding"] == [p >= threshold for p in r["probability"]]
    assert r["binding_residues"] == [
        {"index": i + 1, "aa": UBIQUITIN[i], "probability": r["probability"][i]}
        for i in range(76) if r["binding"][i]
    ]
    assert r["structure"]["source"] == "esmatlas"
    assert r["structure"]["pdb"].startswith("HEADER")
    assert all(0.0 <= p <= 1.0 for p in r["structure"]["plddt"])
    assert r["mock"] is True
    assert set(r["timing"]) == {"esmfold_s", "predict_s", "total_s"}
    assert fake.calls == [UBIQUITIN]


def test_same_input_gives_same_result_and_folds_once(make_client):
    client, fake = make_client()
    with client:
        first = post_predict(client).json()
        second = post_predict(client).json()
    assert first["probability"] == second["probability"]
    assert second["structure"]["cached"] is True
    assert len(fake.calls) == 1


def test_predict_pdb_contract(make_client, ubiquitin_pdb):
    client, fake = make_client()
    with client:
        response = post_predict_pdb(client, ubiquitin_pdb)
    assert response.status_code == 200, response.text
    r = response.json()

    assert r["sequence"] == UBIQUITIN and r["length"] == 76
    assert r["binding_type"] == "metal" and r["profile"] == "final"
    assert r["model_version"] == MANIFEST_SHA1
    assert len(r["probability"]) == len(r["binding"]) == len(r["structure"]["plddt"]) == 76
    assert r["binding"] == [p >= r["threshold"] for p in r["probability"]]
    assert r["binding_residues"] == [
        {"index": i + 1, "aa": UBIQUITIN[i], "probability": r["probability"][i]}
        for i in range(76) if r["binding"][i]
    ]
    assert r["structure"]["source"] == "upload"
    assert r["structure"]["pdb"] == ubiquitin_pdb
    assert all(0.0 <= p <= 1.0 for p in r["structure"]["plddt"])
    assert r["mock"] is True
    assert r["timing"]["esmfold_s"] == 0
    assert fake.calls == []  # an uploaded structure never goes to ESMFold


@pytest.mark.parametrize("pdb,message", [
    ("HEADER demo\nEND\n", "no ATOM records"),
    ("ATOM      1  N   MET B   1       0.000   0.000   0.000  1.00  0.90           N\n", "no residues in chain A"),
])
def test_predict_pdb_invalid(make_client, pdb, message):
    client, _ = make_client()
    with client:
        response = post_predict_pdb(client, pdb)
    body = response.json()
    assert response.status_code == 400, body
    assert body["code"] == "PDB_INVALID" and message in body["detail"]


def test_predict_pdb_length_limit_is_the_models_not_the_api(make_client):
    """No ESMFold for an upload: 401-1000 aa pass even with the API-only limit of 400, above 1000 is refused."""
    def pdb_of(n):
        return "".join(f"ATOM  {i + 1:5d}  CA  ALA A{i + 1:4d}    {0:8.3f}{0:8.3f}{0:8.3f}  1.00 90.00           C\n"
                       for i in range(n))

    client, _ = make_client()
    with client:
        ok = post_predict_pdb(client, pdb_of(450))
        too_long = post_predict_pdb(client, pdb_of(1001))
    assert ok.status_code == 200, ok.text
    assert ok.json()["structure"]["plddt"][0] == 0.9  # 0-100 B-factors are rescaled to 0-1
    assert too_long.status_code == 413 and "limit of the AdaBind models" in too_long.json()["detail"]


def test_real_predictor_answers_an_uploaded_pdb(make_client, fake_foundation_models, ubiquitin_pdb):
    worker = FakeEsmIfWorker()
    client, api = make_client(predictor="pbind", esmif_worker=worker)
    with client:
        response = post_predict_pdb(client, ubiquitin_pdb, "small")
    r = response.json()
    assert response.status_code == 200, r
    assert r["mock"] is False and r["structure"]["source"] == "upload" and len(r["probability"]) == 76
    assert {"esm_s", "prott5_s", "esmif_s", "model_s"} <= set(r["timing"])
    assert worker.calls == [UBIQUITIN] and api.calls == []


@pytest.mark.parametrize("payload,status,code,message", [
    ({"sequence": "MKV", "binding_type": "metal"}, 400, "SEQUENCE_INVALID", "minimum is 30"),
    ({"sequence": UBIQUITIN[:40] + "X", "binding_type": "metal"}, 400, "SEQUENCE_INVALID", "'X' at 41"),
    ({"sequence": "A" * 401, "binding_type": "small"}, 413, "SEQUENCE_TOO_LONG", "maximum is 400"),
    ({"sequence": UBIQUITIN, "binding_type": "zinc"}, 400, "REQUEST_INVALID", "metal, nuclear, small, dna, rna"),
    ({"binding_type": "metal"}, 400, "REQUEST_INVALID", "sequence: Field required"),
])
def test_invalid_requests(make_client, payload, status, code, message):
    client, fake = make_client()
    with client:
        response = client.post("/predict", json=payload)
    body = response.json()
    assert response.status_code == status, body
    assert body["code"] == code and message in body["detail"]
    assert body["request_id"] == response.headers["X-Request-ID"]
    assert fake.calls == []  # nothing invalid reaches ESMFold


def test_body_that_is_not_json(make_client):
    client, _ = make_client()
    with client:
        response = client.post("/predict", content=b"not json", headers={"Content-Type": "application/json"})
    assert response.status_code == 400
    assert "not valid JSON" in response.json()["detail"]


def connect_timeout(request):
    raise httpx.ConnectTimeout("timeout")


@pytest.mark.parametrize("responder,status,message", [
    (lambda r: httpx.Response(500, text="boom"), 502, "HTTP 500"),
    (lambda r: httpx.Response(413, text="Sequence is longer than 400."), 413, "too long"),
    (connect_timeout, 502, "timed out"),
])
def test_esmfold_failures(make_client, responder, status, message):
    client, _ = make_client(FakeEsmFold(responder))
    with client:
        response = post_predict(client)
        diagnostics = client.get("/diagnostics").json()
    assert response.status_code == status
    assert message in response.json()["detail"]
    last_call = next(c for c in diagnostics["components"] if c["name"] == "ESMFold API (last call)")
    assert last_call["status"] == "error"


def test_pbind_not_installed_gives_503_and_degraded_health(make_client, monkeypatch):
    monkeypatch.setitem(sys.modules, "pbind", None)
    monkeypatch.delitem(sys.modules, "pbind.inference.predictor", raising=False)
    monkeypatch.delitem(sys.modules, "pbind.inference", raising=False)
    client, fake = make_client(predictor="pbind")
    with client:
        health = client.get("/health").json()
        response = post_predict(client)
        diagnostics = client.get("/diagnostics").json()
    assert health["status"] == "degraded" and health["predictor"] == "pbind" and health["mock"] is False
    assert response.status_code == 503 and response.json()["code"] == "PREDICTOR_UNAVAILABLE"
    predictor = next(c for c in diagnostics["components"] if c["name"] == "predictor")
    assert predictor["status"] == "error" and "cannot create pbind.Predictor" in predictor["message"]


@pytest.mark.parametrize("binding_type", ["metal", "nuclear", "small", "dna", "rna"])
def test_real_predictor_answers_the_contract(make_client, fake_foundation_models, binding_type):
    worker = FakeEsmIfWorker()
    client, _ = make_client(predictor="pbind", esmif_worker=worker)
    with client:
        health = client.get("/health").json()
        response = post_predict(client, binding_type=binding_type)
    assert health["mock"] is False and health["predictor"] == "pbind" and health["device"] == "cpu"
    r = response.json()
    assert response.status_code == 200, r
    assert r["mock"] is False and r["binding_type"] == binding_type
    assert len(r["probability"]) == 76 and r["binding"] == [p >= r["threshold"] for p in r["probability"]]
    assert isinstance(r["warnings"], list)
    assert {"esmfold_s", "predict_s", "total_s", "esm_s", "esmif_s", "model_s"} <= set(r["timing"])
    assert worker.calls == [UBIQUITIN]
    assert worker.closed  # the worker is stopped with the server


def test_real_predictor_refuses_when_startup_checks_failed(make_client, fake_foundation_models):
    client, _ = make_client(predictor="pbind", esmif_worker=FakeEsmIfWorker())
    with client:
        assert post_predict(client).status_code == 200  # all checks pass: real predictor works
        client.app.state.bs.components["final_model"] = {"status": "error", "message": "1 mismatched"}
        response = post_predict(client)
    assert response.status_code == 503
    assert "final_model" in response.json()["detail"]


def _wait_self_test(client, timeout=300):
    deadline = time.time() + timeout
    while time.time() < deadline:
        health = client.get("/health").json()
        if health["self_test"] != "running":
            return health
        time.sleep(0.2)
    raise AssertionError("self-test did not finish")


@requires_golden
def test_failed_self_test_blocks_predictions(make_client, fake_foundation_models):
    """Wrong embeddings (here: random ESM-2) give numbers without error; the start-up self-test catches it."""
    client, _ = make_client(predictor="pbind", esmif_worker=FakeEsmIfWorker(), warmup=True)
    with client:
        health = _wait_self_test(client)
        response = post_predict(client)
        diagnostics = client.get("/diagnostics").json()
    assert health["self_test"] == "error" and health["status"] == "degraded"
    assert response.status_code == 503 and "self-test" in response.json()["detail"]
    self_test = next(c for c in diagnostics["components"] if c["name"] == "self-test")
    assert "golden set mismatch" in self_test["message"] and "details" not in self_test


def test_missing_model_directory_is_reported(make_client, tmp_path):
    client, fake = make_client(final_model_dir=tmp_path / "nowhere")
    with client:
        health = client.get("/health").json()
        response = post_predict(client)
        diagnostics = client.get("/diagnostics").json()
    assert health["status"] == "degraded" and health["model_version"] is None
    assert response.status_code == 503
    manifest = next(c for c in diagnostics["components"] if c["name"] == "manifest")
    assert manifest["status"] == "error" and "manifest.json" in manifest["message"]
    assert any(p["level"] == "ERROR" and "manifest.json" in p["message"] for p in diagnostics["recent_problems"])
    assert fake.calls == []


def test_unexpected_exception_returns_json_500(make_client):
    client, _ = make_client(raise_server_exceptions=False)
    with client:
        def explode(*args, **kwargs):
            raise RuntimeError("feature extraction exploded")

        client.app.state.bs.predictor.predict = explode
        response = post_predict(client)
    body = response.json()
    assert response.status_code == 500
    assert body["code"] == "INTERNAL_ERROR" and "feature extraction exploded" in body["detail"]
    assert body["request_id"]


def test_client_log_is_written_to_backend_log(make_client, caplog):
    client, _ = make_client()
    with client, caplog.at_level(logging.INFO, logger="bindsite.client"):
        response = client.post("/client-log", json={
            "level": "error", "message": "NGL failed to load PDB", "source": "prediction-viewer",
            "url": "http://127.0.0.1:4200/predict", "stack": "Error: x\n at y", "context": {"length": 76},
        })
        bad = client.post("/client-log", json={"level": "fatal", "message": "x"})
    assert response.status_code == 204
    assert bad.status_code == 400
    record = next(r for r in caplog.records if r.name == "bindsite.client")
    assert record.levelno == logging.ERROR
    assert "NGL failed to load PDB" in record.getMessage() and "source=prediction-viewer" in record.getMessage()


def test_diagnostics_lists_every_startup_check(make_client):
    client, _ = make_client()
    with client:
        diagnostics = client.get("/diagnostics").json()
    names = {c["name"] for c in diagnostics["components"]}
    assert {"manifest", "final_model", "predictor", "ESMFold API (last call)"} <= names
    assert {"weights: ESM-2 650M", "weights: ProtT5-XL half", "weights: ESM-IF1"} <= names
    assert diagnostics["log_file"].endswith("backend.log")


# ---------------------------------------------------------------------------------------------- local ESMFold
from .conftest import FakeLocalEsmFold  # noqa: E402


def test_local_esmfold_is_used_and_reported(make_client, ubiquitin_pdb):
    local = FakeLocalEsmFold(lambda s: ubiquitin_pdb)
    client, api = make_client(esmfold_local="auto", max_length=1000, local_esmfold=local)
    with client:
        health = client.get("/health").json()
        r = post_predict(client).json()
        diagnostics = client.get("/diagnostics").json()
    assert health["max_length"] == 1000 and health["structure_source"] == "local ESMFold, API fallback"
    assert set(health["devices"]) == {"esmfold", "esm2", "prott5", "esmif", "models"}
    assert r["structure"]["source"] == "local" and api.calls == [] and local.calls == [UBIQUITIN]
    names = {c["name"] for c in diagnostics["components"]}
    assert {"ESMFold (local)", "ESMFold local (last fold)", "ESMFold API (last call)"} <= names


def test_api_fallback_is_flagged_in_the_answer(make_client):
    def fold(sequence):
        raise RuntimeError("GPU out of memory")

    client, api = make_client(esmfold_local="auto", max_length=1000, local_esmfold=FakeLocalEsmFold(fold))
    with client:
        r = post_predict(client).json()
    assert r["structure"]["source"] == "esmatlas" and api.calls == [UBIQUITIN]
    assert "GPU out of memory" in r["structure"]["fallback_reason"]
    assert any("ESMFold API" in w for w in r["warnings"])


@requires_golden
def test_local_esmfold_failing_its_self_test_is_disabled(make_client, ubiquitin_pdb):
    """A local model that folds the golden protein wrongly is never used; the API (max 400 aa) takes over."""
    local = FakeLocalEsmFold(lambda s: ubiquitin_pdb)  # golden sequence != ubiquitin -> wrong chain
    client, api = make_client(esmfold_local="auto", max_length=1000, local_esmfold=local, warmup=True)
    with client:
        deadline = time.time() + 60
        while client.get("/health").json()["esmfold_local"] == "running" and time.time() < deadline:
            time.sleep(0.1)
        health = client.get("/health").json()
        r = post_predict(client).json()
    assert health["esmfold_local"] == "warning" and health["max_length"] == 400
    assert health["status"] == "ok"  # the API fallback keeps the service up
    assert r["structure"]["source"] == "esmatlas" and api.calls == [UBIQUITIN]
