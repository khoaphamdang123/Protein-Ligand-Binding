"""End-to-end tests of the HTTP API against the contract in the integration guide (section 5)."""
import hashlib
import logging
import sys
import time

import numpy as np

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
              local_esmfold=None, baseline_worker=None, alphafold=None, **settings):
        fake = fake or esmfold_returning()
        if alphafold is not None:
            settings.setdefault("alphafold_db", True)
            settings.setdefault("alphafold_db_url", "https://alphafold.test")
        app = create_app(make_settings(**settings), esmfold_transport=fake.transport, esmif_worker=esmif_worker,
                         local_esmfold=local_esmfold, baseline_worker=baseline_worker,
                         alphafold_transport=alphafold.transport if alphafold is not None else None)
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
    (lambda r: httpx.Response(413, text="Sequence is longer than 400."), 502, "HTTP 413"),
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


# ---------------------------------------------------------------------------------------------- structure sources
from .conftest import FakeLocalEsmFold, FakeLocalFold  # noqa: E402


def test_precomputed_structure_is_served_without_folding(make_client, ubiquitin_pdb, tmp_path):
    folder = tmp_path / "esmfold_files"
    folder.mkdir()
    (folder / "P0CG48.pdb").write_text(ubiquitin_pdb)
    local = FakeLocalFold(lambda s: ubiquitin_pdb)
    client, api = make_client(esmfold_files_dir=folder, esmfold_local="auto", local_esmfold=local)
    with client:
        r = post_predict(client).json()
        health = client.get("/health").json()
    assert r["structure"]["source"] == "precomputed" and r["structure"]["detail"] == "P0CG48.pdb"
    assert r["structure"]["cached"] is True and api.calls == [] and local.calls == []
    assert health["structure_sources"]["precomputed"]["count"] == 1
    assert set(health["structure_sources"]) == {"precomputed", "esmatlas", "local"}


def test_local_esmfold_is_used_after_the_api_and_reported(make_client, ubiquitin_pdb):
    local = FakeLocalFold(lambda s: ubiquitin_pdb)
    client, api = make_client(FakeEsmFold(lambda r: httpx.Response(503, text="")), esmfold_local="auto",
                              max_length=1000, local_esmfold=local)
    with client:
        health = client.get("/health").json()
        r = post_predict(client).json()
        diagnostics = client.get("/diagnostics").json()
    assert health["max_length"] == 1000 and health["esmfold_local"] == "ok"
    assert set(health["devices"]) == {"esmfold", "esm2", "prott5", "esmif", "models"}
    assert r["structure"]["source"] == "local" and len(api.calls) == 3 and local.calls == [UBIQUITIN]
    assert "ESMFold API failed" in r["structure"]["fallback_reason"]
    assert any("local ESMFold" in w for w in r["warnings"])
    names = {c["name"] for c in diagnostics["components"]}
    assert {"ESMFold (local)", "ESMFold (precomputed)", "ESMFold local (last fold)", "ESMFold API (last call)"} <= names


def test_cpu_fold_answers_202_then_the_structure(make_client, ubiquitin_pdb):
    """Local ESMFold on the CPU: the request is answered at once (202, still folding); the UI asks again."""
    local = FakeLocalFold(lambda s: ubiquitin_pdb, device="cpu")
    client, api = make_client(FakeEsmFold(lambda r: httpx.Response(503, text="")), esmfold_local="auto",
                              max_length=1000, local_esmfold=local)
    with client:
        first = post_predict(client)
        deadline = time.time() + 10
        while local.calls == [] and time.time() < deadline:
            time.sleep(0.02)
        time.sleep(0.2)
        second = post_predict(client)
    body = first.json()
    assert first.status_code == 202 and body["code"] == "STRUCTURE_FOLDING" and "request_id" in body
    assert body["folding"]["length"] == len(UBIQUITIN) and body["folding"]["device"] == "cpu"
    assert second.status_code == 200 and second.json()["structure"]["source"] == "local"
    assert any("local ESMFold" in w for w in second.json()["warnings"])  # why, kept with the cached structure
    assert len(api.calls) == 3  # the API is not asked again by the second request


def test_no_structure_source_answers_structure_unavailable(make_client):
    local = FakeLocalFold(ready=(False, "GPU busy: 8.5 of 24.0 GB free, ESMFold needs 10 GB"))
    client, _ = make_client(FakeEsmFold(lambda r: httpx.Response(500, text="boom")), esmfold_local="auto",
                            local_esmfold=local)
    with client:
        response = post_predict(client)
        health = client.get("/health").json()
    body = response.json()
    assert response.status_code == 502 and body["code"] == "STRUCTURE_UNAVAILABLE"
    assert "GPU busy" in body["detail"] and "upload" in body["detail"]
    assert health["status"] == "ok" and health["esmfold_local"] == "warning"  # never blocks predictions


@requires_golden
def test_local_esmfold_failing_its_golden_fold_never_folds(make_client, ubiquitin_pdb):
    """A local model that folds the golden protein wrongly is disabled; the service stays up."""
    local = FakeLocalEsmFold(lambda s: ubiquitin_pdb, device="cpu")  # golden sequence != ubiquitin -> wrong chain
    client, api = make_client(esmfold_local="auto", max_length=1000, local_esmfold=local, warmup=True,
                              devices=(("esmfold", "cpu"),))
    with client:
        deadline = time.time() + 60
        while client.get("/health").json()["esmfold_local"] in ("running", None) and time.time() < deadline:
            time.sleep(0.1)
        time.sleep(0.2)
        health = client.get("/health").json()
        r = post_predict(client).json()
    assert health["structure_sources"]["local"]["state"] == "disabled"
    assert health["esmfold_local"] == "error" and health["status"] == "ok"
    assert r["structure"]["source"] == "esmatlas" and api.calls == [UBIQUITIN]


# ---------------------------------------------------------------------------------------------- compare mode
from app.baselines import BaselineError  # noqa: E402

from .conftest import FakeBaselineWorker  # noqa: E402


def post_compare(client, pdb, binding_type="metal", sequence=UBIQUITIN):
    return client.post("/compare", json={"sequence": sequence, "pdb": pdb, "binding_type": binding_type})


@pytest.mark.parametrize("ligand,output,p21,p24", [
    ("metal", "metal", 0.9, 0.6),      # columns: metal, nuclear, small
    ("small", "small", 0.6, 0.9),
    ("dna", "nuclear", 0.2, 0.2),      # no DNA or RNA output: the nucleic-acid column
    ("rna", "nuclear", 0.2, 0.2),
])
def test_compare_returns_the_right_output_of_both_models(make_client, ubiquitin_pdb, ligand, output, p21, p24):
    worker = FakeBaselineWorker()
    client, api = make_client(baseline_worker=worker)
    with client:
        response = post_compare(client, ubiquitin_pdb, ligand)
    assert response.status_code == 200 and api.calls == []  # uses the given structure, folds nothing
    body = response.json()
    assert worker.calls == [((76, 1024), (76, 3))]
    bind21, bind24 = body["models"]["bindEmbed21DL"], body["models"]["bindNode24"]
    assert bind21["output"] == bind24["output"] == output
    assert bind21["threshold"] == bind24["threshold"] == 0.5
    assert bind21["probability"] == [p21] * 76 and bind24["probability"] == [p24] * 76
    assert bind21["binding"] == [p21 >= 0.5] * 76 and bind24["binding"] == [p24 >= 0.5] * 76
    assert set(body["timing"]) == {"alphafold_s", "prott5_s", "models_s", "total_s"}
    assert body["models"]["bindNode24"]["structure"] == {"source": "same", "reason": "AlphaFold DB lookup is off"}


def test_compare_without_the_environment_says_how_to_install_it(make_client, ubiquitin_pdb):
    client, _ = make_client(baseline_worker=FakeBaselineWorker(problem="/x/python not found"))
    with client:
        response = post_compare(client, ubiquitin_pdb)
        health = client.get("/health").json()
    assert response.status_code == 503 and response.json()["code"] == "BASELINES_UNAVAILABLE"
    assert "/x/python not found" in response.json()["detail"]
    assert health["compare"] is False and health["status"] == "ok"  # prediction itself is not affected


def test_compare_rejects_a_structure_of_another_sequence(make_client, ubiquitin_pdb):
    worker = FakeBaselineWorker()
    client, _ = make_client(baseline_worker=worker)
    with client:
        response = post_compare(client, ubiquitin_pdb, sequence=UBIQUITIN[:-1] + "A")
    assert response.status_code == 400 and response.json()["code"] == "PDB_INVALID"
    assert worker.calls == []


def test_compare_reports_a_failing_worker(make_client, ubiquitin_pdb):
    client, _ = make_client(baseline_worker=FakeBaselineWorker(error=BaselineError("baseline worker died")))
    with client:
        response = post_compare(client, ubiquitin_pdb)
    assert response.status_code == 500 and response.json()["code"] == "BASELINES_FAILED"
    assert "worker died" in response.json()["detail"]


def test_health_reports_compare_available(make_client):
    client, _ = make_client(baseline_worker=FakeBaselineWorker())
    with client:
        assert client.get("/health").json()["compare"] is True


# ---------------------------------------------------------------------------------------------- bindNode24 structure
from app.esmfold_local import ca_coords  # noqa: E402

from .conftest import FakeAlphaFoldDB, moved_pdb  # noqa: E402


def test_bindnode24_runs_on_the_alphafold_db_model_when_there_is_one(make_client, ubiquitin_pdb):
    worker, afdb = FakeBaselineWorker(), FakeAlphaFoldDB({UBIQUITIN: moved_pdb(ubiquitin_pdb)})
    client, _ = make_client(baseline_worker=worker, alphafold=afdb)
    with client:
        body = post_compare(client, ubiquitin_pdb).json()
        health = client.get("/health").json()
    assert np.allclose(worker.cas[0], ca_coords(moved_pdb(ubiquitin_pdb)))    # the AlphaFold coordinates
    s = body["models"]["bindNode24"]["structure"]
    assert s["source"] == "alphafold_db" and s["entry"] == "AF-P0CG48-F1" and s["rmsd"] < 0.01
    assert np.allclose(ca_coords(s["pdb"]), ca_coords(ubiquitin_pdb), atol=0.01)  # shown in the frame of the others
    assert len(s["plddt"]) == 76 and max(s["plddt"]) <= 1
    assert body["models"]["bindEmbed21DL"]["structure"] == {"source": "none"}
    assert health["alphafold_db"] is True
    with client:
        own = client.post("/compare", json={"sequence": UBIQUITIN, "pdb": ubiquitin_pdb, "binding_type": "metal",
                                            "accession": "Q99999"}).json()
    assert own["models"]["bindNode24"]["structure"]["entry"] == "AF-Q99999-F1"


def test_bindnode24_falls_back_to_the_prediction_structure(make_client, ubiquitin_pdb):
    worker = FakeBaselineWorker()
    client, _ = make_client(baseline_worker=worker, alphafold=FakeAlphaFoldDB({}))
    with client:
        body = post_compare(client, ubiquitin_pdb).json()
    assert np.allclose(worker.cas[0], ca_coords(ubiquitin_pdb))
    assert body["models"]["bindNode24"]["structure"] == {"source": "same", "reason": "not in AlphaFold DB"}


def test_an_uploaded_structure_is_never_replaced(make_client, ubiquitin_pdb):
    worker, afdb = FakeBaselineWorker(), FakeAlphaFoldDB({UBIQUITIN: moved_pdb(ubiquitin_pdb)})
    client, _ = make_client(baseline_worker=worker, alphafold=afdb)
    with client:
        body = client.post("/compare", json={"sequence": UBIQUITIN, "pdb": ubiquitin_pdb, "binding_type": "metal",
                                             "alphafold": False}).json()
    assert afdb.calls == [] and np.allclose(worker.cas[0], ca_coords(ubiquitin_pdb))
    assert body["models"]["bindNode24"]["structure"]["reason"] == "the structure was uploaded"


def test_cors_allows_only_the_configured_web_origins(make_client):
    """Static hosting: the page on https://site.example calls this API directly (config.json apiBaseUrl)."""
    client, _ = make_client(cors_origins=("https://site.example",))
    with client:
        ok = client.get("/health", headers={"Origin": "https://site.example"})
        other = client.get("/health", headers={"Origin": "https://evil.example"})
        preflight = client.options("/predict", headers={"Origin": "https://site.example",
                                                        "Access-Control-Request-Method": "POST",
                                                        "Access-Control-Request-Headers": "content-type"})
    assert ok.headers["access-control-allow-origin"] == "https://site.example"
    assert "x-request-id" in ok.headers["access-control-expose-headers"].lower()
    assert "access-control-allow-origin" not in other.headers
    assert preflight.status_code == 200 and preflight.headers["access-control-allow-origin"] == "https://site.example"


def test_no_cors_headers_by_default(make_client):
    client, _ = make_client()
    with client:
        r = client.get("/health", headers={"Origin": "https://site.example"})
    assert "access-control-allow-origin" not in r.headers


def test_cors_origins_from_the_environment(monkeypatch):
    from app.config import Settings

    monkeypatch.setenv("BINDSITE_CORS_ORIGINS", " https://a.example/, https://b.example ,,")
    assert Settings.from_env().cors_origins == ("https://a.example", "https://b.example")
