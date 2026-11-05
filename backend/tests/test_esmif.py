"""EsmIfWorker: the protocol against a fake worker script, and the real ESM-IF environment on the golden set."""
import json
import sys
import tempfile
import textwrap
from pathlib import Path

import numpy as np
import pytest

from app.esmif import EsmIfError, EsmIfWorker

from .conftest import ESMIF_PYTHON, GOLDEN_DIR, WEIGHTS_DIR, requires_golden

# Fake worker speaking the protocol of scripts/esmif_worker.py. Behaviour per request is chosen by the sequence:
#   "DIE..."  exits mid-request;  "HANG..." never answers;  "BAD..." answers an error;  otherwise ones (L, 512).
FAKE_WORKER = textwrap.dedent('''
    import json, os, sys, time
    import numpy as np
    proto = sys.stdout
    if os.environ.get("FAKE_FAIL_START"):
        proto.write(json.dumps({"ready": False, "error": "no CUDA"}) + "\\n"); proto.flush(); sys.exit(1)
    print("noise on stderr", file=sys.stderr, flush=True)
    proto.write("not json\\n")
    proto.write(json.dumps({"ready": True, "device": "cpu", "pid": os.getpid()}) + "\\n"); proto.flush()
    for line in sys.stdin:
        req = json.loads(line); seq = req["sequence"]
        if seq.startswith("DIE"): sys.exit(3)
        if seq.startswith("HANG"): time.sleep(60)
        if seq.startswith("BAD"):
            proto.write(json.dumps({"id": req["id"], "ok": False, "error": "chain mismatch"}) + "\\n"); proto.flush(); continue
        np.save(req["out"], np.ones((len(seq), 512), np.float32))
        proto.write(json.dumps({"id": req["id"], "ok": True, "shape": [len(seq), 512]}) + "\\n"); proto.flush()
''')


@pytest.fixture
def fake_worker(tmp_path):
    script = tmp_path / "fake_worker.py"
    script.write_text(FAKE_WORKER)
    weights = tmp_path / "weights.pt"
    weights.write_bytes(b"x")

    def _make(**kwargs) -> EsmIfWorker:
        return EsmIfWorker(Path(sys.executable), weights, script=script, **kwargs)

    workers = []
    yield lambda **kw: workers.append(_make(**kw)) or workers[-1]
    for w in workers:
        w.close()


def pdb_file(tmp_path) -> Path:
    fp = tmp_path / "q.pdb"
    fp.write_text("ATOM\n")
    return fp


def test_start_and_embed(fake_worker, tmp_path):
    w = fake_worker()
    info = w.start()
    assert info["device"] == "cpu" and w.alive
    arr = w.embed(pdb_file(tmp_path), "ACDEFGHIK")
    assert arr.shape == (9, 512) and arr.dtype == np.float32
    assert w.embed(pdb_file(tmp_path), "ACD").shape == (3, 512)
    assert w.info["pid"] == info["pid"]  # one process for every request


def test_worker_error_is_reported_and_worker_survives(fake_worker, tmp_path):
    w = fake_worker()
    with pytest.raises(EsmIfError, match="chain mismatch"):
        w.embed(pdb_file(tmp_path), "BADSEQ")
    pid = w.info["pid"]
    assert w.embed(pdb_file(tmp_path), "ACD").shape == (3, 512)
    assert w.info["pid"] == pid


def test_dead_worker_is_restarted(fake_worker, tmp_path):
    w = fake_worker()
    w.start()
    first = w.info["pid"]
    with pytest.raises(EsmIfError, match="died"):
        w.embed(pdb_file(tmp_path), "DIE")  # dies on the request and on the retry
    assert w.embed(pdb_file(tmp_path), "ACD").shape == (3, 512)
    assert w.info["pid"] != first


def test_timeout_kills_the_worker(fake_worker, tmp_path):
    w = fake_worker(timeout=1.5)
    w.start()
    with pytest.raises(EsmIfError, match="timed out"):
        w.embed(pdb_file(tmp_path), "HANG")
    assert not w.alive
    assert w.embed(pdb_file(tmp_path), "ACD").shape == (3, 512)  # next request restarts it


def test_start_failure(fake_worker, monkeypatch):
    monkeypatch.setenv("FAKE_FAIL_START", "1")
    with pytest.raises(EsmIfError, match="failed to start: no CUDA"):
        fake_worker().start()


def test_missing_environment(tmp_path):
    with pytest.raises(EsmIfError, match="ESM-IF environment not found"):
        EsmIfWorker(tmp_path / "nope" / "python", tmp_path / "w.pt").start()


@pytest.mark.skipif(not ESMIF_PYTHON.exists(), reason="backend/.venv-esmif not built")
@requires_golden
def test_real_worker_matches_training_embeddings():
    """The real ESM-IF environment reproduces the training ESM-IF features of two golden proteins.

    On CPU (BINDSITE_DEVICE_ESMIF=cpu works too, and the test does not depend on free GPU memory next to a running
    server); the GPU path is covered by the start-up self-test and scripts/check_environment.py."""
    from pbind.data.structures import normalize_exact_chain_A

    index = json.loads((GOLDEN_DIR / "index.json").read_text())
    entries = sorted(index["proteins"], key=lambda e: e["length"])[:2]
    w = EsmIfWorker(ESMIF_PYTHON, WEIGHTS_DIR / "esm_if1" / "esm_if1_gvp4_t16_142M_UR50.pt", device="cpu",
                    torch_home=WEIGHTS_DIR / "torch_home")
    try:
        for e in entries:
            with tempfile.TemporaryDirectory() as tmp:
                chain = Path(tmp) / "chainA.pdb"
                normalize_exact_chain_A(GOLDEN_DIR / f"{e['prot_id']}.pdb", e["sequence"], chain)
                mine = w.embed(chain, e["sequence"]).astype(np.float64)
            ref = np.load(GOLDEN_DIR / f"{e['prot_id']}.npz")["ESMIF"].astype(np.float64)
            cos = (mine * ref).sum(1) / (np.linalg.norm(mine, axis=1) * np.linalg.norm(ref, axis=1))
            assert cos.min() >= 0.999, (e["prot_id"], cos.min())
    finally:
        w.close()
