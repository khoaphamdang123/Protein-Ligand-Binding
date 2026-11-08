import hashlib

import httpx
import pytest

from app.errors import EsmFoldError, StructureUnavailable
from app.esmfold import EsmFoldClient, PrecomputedStructures, validate_structure
from app.esmfold_local import LocalFoldService
from app.pdb_utils import read_chain

from .conftest import GOLDEN_DIR, UBIQUITIN, FakeEsmFold, FakeLocalEsmFold, FakeLocalFold, ca_only_pdb, requires_golden


def make_client(tmp_path, fake: FakeEsmFold) -> EsmFoldClient:
    return EsmFoldClient("https://esmfold.test/fold", 5.0, tmp_path, fake.transport, backoff=0.01)


def test_read_chain_of_real_esmfold_output(ubiquitin_pdb):
    chain = read_chain(ubiquitin_pdb, "A")
    assert chain.sequence == UBIQUITIN
    assert len(chain.plddt) == len(UBIQUITIN)
    assert all(0.0 <= p <= 1.0 for p in chain.plddt)
    assert read_chain(ubiquitin_pdb, "B").sequence == ""


def test_validate_structure_accepts_matching_chain(ubiquitin_pdb):
    plddt = validate_structure(ubiquitin_pdb, UBIQUITIN)
    assert plddt == read_chain(ubiquitin_pdb).plddt


def test_validate_structure_rejects_other_protein(ubiquitin_pdb):
    with pytest.raises(EsmFoldError, match="76 residues but the sequence has 75"):
        validate_structure(ubiquitin_pdb, UBIQUITIN[:-1])
    mutated = UBIQUITIN[:4] + "W" + UBIQUITIN[5:]
    with pytest.raises(EsmFoldError, match="first difference at residue 5"):
        validate_structure(ubiquitin_pdb, mutated)


def test_validate_structure_rejects_missing_chain_or_atoms(ubiquitin_pdb):
    chain_b = "\n".join(line[:21] + "B" + line[22:] if line.startswith("ATOM") else line
                        for line in ubiquitin_pdb.splitlines())
    with pytest.raises(EsmFoldError, match="no chain A"):
        validate_structure(chain_b, UBIQUITIN)
    with pytest.raises(EsmFoldError, match="no atom records"):
        validate_structure("Sequence is longer than 400.", UBIQUITIN)


def test_validate_structure_rescales_plddt_on_0_100_scale(ubiquitin_pdb):
    scaled = "\n".join(
        line[:60] + f"{float(line[60:66]) * 100:6.2f}" + line[66:] if line.startswith("ATOM") else line
        for line in ubiquitin_pdb.splitlines()
    )
    plddt = validate_structure(scaled, UBIQUITIN)
    assert plddt == pytest.approx(read_chain(ubiquitin_pdb).plddt, abs=1e-6)


def test_fold_calls_api_once_then_uses_cache(tmp_path, esmfold_returning):
    fake = esmfold_returning()
    client = make_client(tmp_path, fake)

    first = client.fold(UBIQUITIN)
    assert not first.cached and len(first.plddt) == 76
    cache_file = tmp_path / "esmfold" / f"{hashlib.sha1(UBIQUITIN.encode()).hexdigest()}.pdb"
    assert cache_file.read_text() == first.pdb
    assert client.last_call["status"] == "ok"

    second = client.fold(UBIQUITIN)
    assert second.cached and second.pdb == first.pdb
    assert fake.calls == [UBIQUITIN]  # body is the bare sequence


def test_corrupted_cache_entry_is_refetched(tmp_path, esmfold_returning):
    fake = esmfold_returning()
    client = make_client(tmp_path, fake)
    cache_file = tmp_path / "esmfold" / f"{hashlib.sha1(UBIQUITIN.encode()).hexdigest()}.pdb"
    cache_file.write_text("garbage")

    result = client.fold(UBIQUITIN)
    assert not result.cached
    assert len(fake.calls) == 1
    assert cache_file.read_text() == result.pdb


def test_api_413_is_reported_as_no_structure(tmp_path, esmfold_returning):
    client = make_client(tmp_path, esmfold_returning(413, "Sequence is longer than 400."))
    with pytest.raises(StructureUnavailable, match="HTTP 413") as exc:
        client.fold(UBIQUITIN)
    assert exc.value.status_code == 502 and exc.value.code == "STRUCTURE_UNAVAILABLE"
    assert "upload the PDB" in exc.value.message
    assert client.last_call["status"] == "error"


@pytest.mark.parametrize("status,text,calls", [
    (500, "Internal Server Error", 1),            # server bug: not retried
    (503, "", 3), (429, "Too Many Requests", 3),  # gateway / rate limit: retried, then reported
    (504, '{"message": "Endpoint request timed out"}', 3),
])
def test_api_error_status_becomes_502(tmp_path, esmfold_returning, status, text, calls):
    fake = esmfold_returning(status, text)
    client = make_client(tmp_path, fake)
    with pytest.raises(EsmFoldError, match=f"HTTP {status}") as exc:
        client.fold(UBIQUITIN)
    assert exc.value.status_code == 502
    assert len(fake.calls) == calls
    assert not list((tmp_path / "esmfold").glob("*.pdb"))


def test_gateway_timeout_is_retried_until_the_fold_arrives(tmp_path, ubiquitin_pdb):
    """The public API answers 504 after ~30 s, then serves the same fold on a later call."""
    answers = iter([httpx.Response(504, text="Endpoint request timed out"), httpx.Response(200, text=ubiquitin_pdb)])
    fake = FakeEsmFold(lambda r: next(answers))
    client = make_client(tmp_path, fake)
    fold = client.fold(UBIQUITIN)
    assert fold.cached is False and len(fold.plddt) == 76
    assert fake.calls == [UBIQUITIN, UBIQUITIN]
    assert client.last_call["status"] == "ok"


def test_no_retry_without_time_left(tmp_path):
    fake = FakeEsmFold(lambda r: httpx.Response(504, text="Endpoint request timed out"))
    client = EsmFoldClient("https://esmfold.test/fold", 5.0, tmp_path, fake.transport, backoff=0.01, total_timeout=5)
    with pytest.raises(EsmFoldError, match="HTTP 504"):
        client.fold(UBIQUITIN)
    assert len(fake.calls) == 1


def test_wrong_structure_from_api_is_not_cached(tmp_path, ubiquitin_pdb):
    client = make_client(tmp_path, FakeEsmFold(lambda r: httpx.Response(200, text=ubiquitin_pdb)))
    other = UBIQUITIN[:-1] + "A"
    with pytest.raises(EsmFoldError, match="does not match"):
        client.fold(other)
    assert not list((tmp_path / "esmfold").glob("*.pdb"))


@pytest.mark.parametrize("exc,message", [
    (httpx.ReadTimeout("read timed out"), "timed out after 5 s"),
    (httpx.ConnectError("connection refused"), "cannot reach it: ConnectError"),
])
def test_network_failures_become_502(tmp_path, exc, message):
    def raise_exc(request):
        raise exc

    fake = FakeEsmFold(raise_exc)
    client = make_client(tmp_path, fake)
    with pytest.raises(EsmFoldError, match=message) as err:
        client.fold(UBIQUITIN)
    assert err.value.status_code == 502
    assert client.last_call["status"] == "error"
    assert len(fake.calls) == 3


# ---------------------------------------------------------------------------------------------- order of sources
def chain_client(tmp_path, api, local=None, precomputed=None):
    return EsmFoldClient("https://esmfold.test/fold", 5.0, tmp_path, api.transport, backoff=0.01, local=local,
                         precomputed=precomputed)


def precomputed_dir(tmp_path, files: dict[str, str]) -> PrecomputedStructures:
    folder = tmp_path / "esmfold_files"
    folder.mkdir(exist_ok=True)
    for name, text in files.items():
        (folder / name).write_text(text)
    pre = PrecomputedStructures(folder, tmp_path / "index.json")
    pre.start(background=False)
    return pre


def test_precomputed_structure_comes_first(tmp_path, esmfold_returning, ubiquitin_pdb):
    api, local = esmfold_returning(), FakeLocalFold(lambda s: ubiquitin_pdb)
    pre = precomputed_dir(tmp_path, {"P0CG48.pdb": ubiquitin_pdb, "other.pdb": ca_only_pdb("ACDEFGHIK" * 4)})
    assert pre.status["status"] == "ok" and pre.count == 2
    result = chain_client(tmp_path, api, local, pre).fold(UBIQUITIN)
    assert result.source == "precomputed" and result.cached and result.detail == "P0CG48.pdb"
    assert api.calls == [] and local.calls == [] and local.ready_calls == 0
    assert not list((tmp_path / "esmfold").glob("*.pdb"))  # not copied into the fold cache


def test_precomputed_index_is_reused_until_the_folder_changes(tmp_path, ubiquitin_pdb):
    pre = precomputed_dir(tmp_path, {"P0CG48.pdb": ubiquitin_pdb})
    assert "indexed" in pre.status["message"]
    again = PrecomputedStructures(tmp_path / "esmfold_files", tmp_path / "index.json")
    again.start(background=False)
    assert "loaded index" in again.status["message"] and again.lookup(UBIQUITIN)[1] == "P0CG48.pdb"
    (tmp_path / "esmfold_files" / "new.pdb").write_text(ca_only_pdb("MKV" * 12))
    third = PrecomputedStructures(tmp_path / "esmfold_files", tmp_path / "index.json")
    third.start(background=False)
    assert "indexed" in third.status["message"] and third.count == 2 and third.lookup("MKV" * 12)[1] == "new.pdb"


def test_precomputed_index_survives_file_times_cut_to_seconds(tmp_path, ubiquitin_pdb):
    """The Docker image builds the index, then stores file times to the second: the index must still be reused."""
    import os

    pdb = tmp_path / "esmfold_files" / "P0CG48.pdb"
    pdb.parent.mkdir()
    pdb.write_text(ubiquitin_pdb)
    os.utime(pdb, ns=(1_793_976_135_877_684_892, 1_793_976_135_877_684_892))   # as in the build step
    precomputed_dir(tmp_path, {})
    os.utime(pdb, ns=(1_793_976_135_000_000_000, 1_793_976_135_000_000_000))   # as in the exported image
    again = PrecomputedStructures(tmp_path / "esmfold_files", tmp_path / "index.json")
    again.start(background=False)
    assert "loaded index" in again.status["message"] and again.count == 1


def test_missing_precomputed_folder_is_a_warning_not_an_error(tmp_path, esmfold_returning):
    pre = PrecomputedStructures(tmp_path / "nowhere", tmp_path / "index.json")
    pre.start(background=False)
    assert pre.status["status"] == "warning" and pre.lookup(UBIQUITIN) is None
    assert chain_client(tmp_path, esmfold_returning(), None, pre).fold(UBIQUITIN).source == "esmatlas"


def test_api_comes_before_local_esmfold(tmp_path, esmfold_returning, ubiquitin_pdb):
    api, local = esmfold_returning(), FakeLocalFold(lambda s: ubiquitin_pdb)
    client = chain_client(tmp_path, api, local)
    first = client.fold(UBIQUITIN)
    assert first.source == "esmatlas" and api.calls == [UBIQUITIN] and local.calls == []
    second = client.fold(UBIQUITIN)  # earlier fold, from the cache
    assert second.cached and second.source == "esmatlas" and len(api.calls) == 1


def test_local_esmfold_takes_over_when_the_api_fails(tmp_path, esmfold_returning, ubiquitin_pdb):
    api, local = esmfold_returning(503), FakeLocalFold(lambda s: ubiquitin_pdb)
    client = chain_client(tmp_path, api, local)
    result = client.fold(UBIQUITIN)
    assert result.source == "local" and local.calls == [UBIQUITIN] and len(api.calls) == 3
    assert "ESMFold API failed" in result.fallback_reason and "HTTP 503" in result.fallback_reason
    assert client.last_local["status"] == "ok"
    assert client.fold(UBIQUITIN).cached  # cached with its source
    assert client.fold(UBIQUITIN).source == "local"


def test_long_sequence_skips_the_api(tmp_path, esmfold_returning):
    long_seq = "ACDEFGHIKLMNPQRSTVWY" * 25  # 500 aa
    api, local = esmfold_returning(), FakeLocalFold(lambda s: ca_only_pdb(s))
    result = chain_client(tmp_path, api, local).fold(long_seq)
    assert result.source == "local" and api.calls == [] and "at most 400 residues" in result.fallback_reason


def test_no_source_asks_for_an_upload(tmp_path, esmfold_returning):
    api, local = esmfold_returning(503), FakeLocalFold(ready=(False, "GPU busy: 8.5 of 24.0 GB free"))
    with pytest.raises(StructureUnavailable) as exc:
        chain_client(tmp_path, api, local).fold(UBIQUITIN)
    msg = exc.value.message
    assert exc.value.code == "STRUCTURE_UNAVAILABLE" and exc.value.status_code == 502
    assert "not among the precomputed" in msg and "HTTP 503" in msg and "GPU busy" in msg and "upload" in msg
    assert local.calls == []


@pytest.mark.parametrize("failure", ["oom", "wrong structure"])
def test_failing_local_fold_is_reported_not_returned(tmp_path, esmfold_returning, ubiquitin_pdb, failure):
    def fold(sequence):
        if failure == "oom":
            raise RuntimeError("GPU out of memory folding 76 aa")
        return ubiquitin_pdb.replace("MET A   1", "ALA A   1")  # chain A no longer matches the sequence

    client = chain_client(tmp_path, esmfold_returning(500), FakeLocalFold(fold))
    with pytest.raises(StructureUnavailable, match="local ESMFold failed"):
        client.fold(UBIQUITIN)
    assert client.last_local["status"] == "error"
    assert not list((tmp_path / "esmfold").glob("*.pdb"))


def test_cache_entry_without_sidecar_is_labelled_api(tmp_path, esmfold_returning, ubiquitin_pdb):
    (tmp_path / "esmfold").mkdir()
    (tmp_path / "esmfold" / f"{hashlib.sha1(UBIQUITIN.encode()).hexdigest()}.pdb").write_text(ubiquitin_pdb)
    api = esmfold_returning()
    result = chain_client(tmp_path, api).fold(UBIQUITIN)
    assert result.cached and result.source == "esmatlas" and api.calls == []


# ---------------------------------------------------------------------------------------------- GPU gate
def test_local_esmfold_waits_for_a_gpu_with_room(monkeypatch, ubiquitin_pdb):
    import torch

    from app import esmfold_local

    monkeypatch.setattr(torch.cuda, "is_available", lambda: True)
    free = {"gb": 8.5}
    monkeypatch.setattr(esmfold_local, "gpu_free_gb", lambda device: (free["gb"], 24.0))
    model = FakeLocalEsmFold(lambda s: ubiquitin_pdb, device="cuda")
    gate = LocalFoldService(model, golden_dir=None, min_free_gb=10)
    ok, why = gate.ready()
    assert not ok and "GPU busy" in why and not model.loaded and gate.status()["status"] == "warning"
    free["gb"] = 15.0  # the other job finished
    assert gate.ready() == (True, "") and model.loaded and gate.status()["status"] == "ok"


def test_local_esmfold_needs_a_gpu_unless_cpu_is_asked_for(monkeypatch, ubiquitin_pdb):
    model = FakeLocalEsmFold(lambda s: ubiquitin_pdb, device="cpu")
    assert LocalFoldService(model)._has_room() == (False, "no GPU configured")
    assert LocalFoldService(model, explicit_cpu=True).ready() == (True, "")


@requires_golden
def test_local_esmfold_failing_its_golden_fold_is_disabled_for_good(ubiquitin_pdb):
    model = FakeLocalEsmFold(lambda s: ubiquitin_pdb, device="cpu")  # golden sequence != ubiquitin
    gate = LocalFoldService(model, golden_dir=GOLDEN_DIR, explicit_cpu=True)
    ok, why = gate.ready()
    assert not ok and gate.state == "disabled"
    assert gate.ready() == (False, why)  # not retried


# ---------------------------------------------------------------------------------------------- CPU folds, queued
def wait_for(predicate, seconds=5.0):
    import time

    deadline = time.time() + seconds
    while not predicate() and time.time() < deadline:
        time.sleep(0.01)
    assert predicate()


def test_cpu_fold_runs_in_the_background_and_the_next_request_gets_it(tmp_path, esmfold_returning, ubiquitin_pdb):
    import threading

    from app.errors import StructureFolding

    release = threading.Event()
    local = FakeLocalFold(lambda s: release.wait(5) and ubiquitin_pdb, device="cpu")
    api = esmfold_returning(504)
    client = chain_client(tmp_path, api, local)
    with pytest.raises(StructureFolding) as first:
        client.fold(UBIQUITIN)
    assert first.value.status_code == 202 and first.value.code == "STRUCTURE_FOLDING"
    folding = first.value.extra["folding"]
    assert folding["length"] == len(UBIQUITIN) and folding["ahead"] == 0 and folding["device"] == "cpu"
    assert "ESMFold API failed" in folding["fallback_reason"]
    api_calls = len(api.calls)
    wait_for(lambda: local.calls == [UBIQUITIN])
    with pytest.raises(StructureFolding) as again:  # still folding: answered at once, the API is not asked again
        client.fold(UBIQUITIN)
    assert again.value.extra["folding"]["stage"] == "folding" and len(api.calls) == api_calls
    release.set()
    wait_for(lambda: not client._jobs)
    result = client.fold(UBIQUITIN)
    assert result.source == "local" and result.cached and result.detail.startswith("CPU, ")
    assert "ESMFold API failed" in result.fallback_reason and local.calls == [UBIQUITIN]
    assert local.ready_calls == 1  # the job loads the model (ready) on its own thread


def test_cpu_folds_wait_in_line(tmp_path, esmfold_returning, ubiquitin_pdb):
    import threading

    from app.errors import StructureFolding

    release = threading.Event()
    local = FakeLocalFold(lambda s: release.wait(5) and (ubiquitin_pdb if s == UBIQUITIN else ca_only_pdb(s)),
                          device="cpu")
    client = chain_client(tmp_path, esmfold_returning(504), local)
    other = "ACDEFGHIKLMNPQRSTVWY" * 3
    with pytest.raises(StructureFolding):
        client.fold(UBIQUITIN)
    with pytest.raises(StructureFolding) as second:
        client.fold(other)
    assert second.value.extra["folding"]["stage"] == "queued" and second.value.extra["folding"]["ahead"] == 1
    assert "queued behind 1 other fold" in second.value.message
    release.set()
    wait_for(lambda: not client._jobs)
    assert client.fold(other).source == "local" and local.calls == [UBIQUITIN, other]


def test_failed_cpu_fold_is_reported_once_then_tried_again(tmp_path, esmfold_returning):
    from app.errors import StructureFolding

    def boom(sequence):
        raise RuntimeError("CPU out of memory folding 76 aa")

    local = FakeLocalFold(boom, device="cpu")
    client = chain_client(tmp_path, esmfold_returning(504), local)
    with pytest.raises(StructureFolding):
        client.fold(UBIQUITIN)
    wait_for(lambda: all(j.error for j in client._jobs.values()))
    with pytest.raises(StructureUnavailable) as failed:
        client.fold(UBIQUITIN)
    assert "local ESMFold failed (CPU out of memory folding 76 aa)" in failed.value.message
    assert "upload" in failed.value.message
    with pytest.raises(StructureFolding):  # a later request queues it again
        client.fold(UBIQUITIN)


def test_cpu_fold_is_not_queued_when_local_esmfold_is_disabled(tmp_path, esmfold_returning):
    local = FakeLocalFold(ready=(False, "disabled: golden fold differs from the training PDB"), device="cpu")
    client = chain_client(tmp_path, esmfold_returning(504), local)
    with pytest.raises(StructureUnavailable) as err:
        client.fold(UBIQUITIN)
    assert "golden fold differs" in err.value.message and not client._jobs and local.calls == []


def test_cpu_service_can_queue_only_when_cpu_was_asked_for():
    cpu = LocalFoldService(FakeLocalEsmFold(device="cpu"), explicit_cpu=True)
    assert cpu.background and cpu.can_queue() == (True, "")
    assert LocalFoldService(FakeLocalEsmFold(device="cpu")).can_queue() == (False, "no GPU configured")
    assert not LocalFoldService(FakeLocalEsmFold(device="cuda")).background
    cpu.state, cpu.message = "disabled", "disabled: golden fold differs"
    assert cpu.can_queue() == (False, "disabled: golden fold differs")
