"""End-to-end tests of the HTTP API against the contract in the integration guide (section 5)."""
import hashlib
import logging

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import create_app

from .conftest import FINAL_MODEL_DIR, UBIQUITIN, FakeEsmFold

pytestmark = pytest.mark.skipif(not (FINAL_MODEL_DIR / "manifest.json").exists(), reason="final_model not present")

MANIFEST_SHA1 = hashlib.sha1((FINAL_MODEL_DIR / "manifest.json").read_bytes()).hexdigest() \
    if (FINAL_MODEL_DIR / "manifest.json").exists() else None


@pytest.fixture
def make_client(make_settings, esmfold_returning):
    def _make(fake: FakeEsmFold | None = None, raise_server_exceptions: bool = True, **settings):
        fake = fake or esmfold_returning()
        app = create_app(make_settings(**settings), esmfold_transport=fake.transport)
        return TestClient(app, raise_server_exceptions=raise_server_exceptions), fake

    return _make


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


@pytest.mark.parametrize("binding_type,threshold", [
    ("metal", 0.9148463010787964), ("nuclear", 0.7078787878787879), ("small", 0.4901010101010101)])
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
    client, _ = make_client()
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


@pytest.mark.parametrize("payload,status,code,message", [
    ({"sequence": "MKV", "binding_type": "metal"}, 400, "SEQUENCE_INVALID", "minimum is 30"),
    ({"sequence": UBIQUITIN[:40] + "X", "binding_type": "metal"}, 400, "SEQUENCE_INVALID", "'X' at 41"),
    ({"sequence": "A" * 401, "binding_type": "small"}, 413, "SEQUENCE_TOO_LONG", "maximum is 400"),
    ({"sequence": UBIQUITIN, "binding_type": "zinc"}, 400, "REQUEST_INVALID", "metal, nuclear, small"),
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
    monkeypatch.setitem(__import__("sys").modules, "pbind", None)
    client, fake = make_client(predictor="pbind")
    with client:
        health = client.get("/health").json()
        response = post_predict(client)
        diagnostics = client.get("/diagnostics").json()
    assert health["status"] == "degraded" and health["predictor"] == "pbind" and health["mock"] is False
    assert response.status_code == 503 and response.json()["code"] == "PREDICTOR_UNAVAILABLE"
    predictor = next(c for c in diagnostics["components"] if c["name"] == "predictor")
    assert predictor["status"] == "error" and "cannot import pbind" in predictor["message"]


def test_real_predictor_refuses_when_startup_checks_failed(make_client, monkeypatch):
    import types
    fake_pbind = types.ModuleType("pbind")
    fake_pbind.predict = lambda sequence, **kwargs: {"probability": [0.5] * len(sequence)}
    monkeypatch.setitem(__import__("sys").modules, "pbind", fake_pbind)
    client, _ = make_client(predictor="pbind")
    with client:
        assert post_predict(client).status_code == 200  # all checks pass: real predictor works
        client.app.state.bs.components["final_model"] = {"status": "error", "message": "1 mismatched"}
        response = post_predict(client)
    assert response.status_code == 503
    assert "final_model" in response.json()["detail"]


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
