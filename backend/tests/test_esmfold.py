import hashlib

import httpx
import pytest

from app.errors import EsmFoldError, SequenceError
from app.esmfold import EsmFoldClient, validate_structure
from app.pdb_utils import read_chain

from .conftest import UBIQUITIN, FakeEsmFold


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


def test_api_413_becomes_sequence_too_long(tmp_path, esmfold_returning):
    client = make_client(tmp_path, esmfold_returning(413, "Sequence is longer than 400."))
    with pytest.raises(SequenceError) as exc:
        client.fold(UBIQUITIN)
    assert exc.value.status_code == 413
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
    (httpx.ConnectError("connection refused"), "Cannot reach the ESMFold API"),
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


# ---------------------------------------------------------------------------------------------- local ESMFold first
from .conftest import FakeLocalEsmFold  # noqa: E402


def local_client(tmp_path, fake_api, local):
    return EsmFoldClient("https://esmfold.test/fold", 5.0, tmp_path, fake_api.transport, backoff=0.01, local=local)


def test_local_esmfold_is_preferred_and_cached_with_its_source(tmp_path, esmfold_returning, ubiquitin_pdb):
    api, local = esmfold_returning(), FakeLocalEsmFold(lambda s: ubiquitin_pdb)
    client = local_client(tmp_path, api, local)
    first = client.fold(UBIQUITIN)
    assert first.source == "local" and not first.cached and first.fallback_reason is None
    assert api.calls == [] and local.calls == [UBIQUITIN]
    second = client.fold(UBIQUITIN)
    assert second.cached and second.source == "local" and local.calls == [UBIQUITIN]
    assert client.last_local["status"] == "ok"


@pytest.mark.parametrize("failure", ["oom", "wrong structure"])
def test_local_failure_falls_back_to_the_api(tmp_path, esmfold_returning, ubiquitin_pdb, failure):
    def fold(sequence):
        if failure == "oom":
            raise RuntimeError("GPU out of memory folding 76 aa")
        return ubiquitin_pdb.replace("MET A   1", "ALA A   1")  # chain A no longer matches the sequence

    api = esmfold_returning()
    client = local_client(tmp_path, api, FakeLocalEsmFold(fold))
    result = client.fold(UBIQUITIN)
    assert result.source == "esmatlas" and api.calls == [UBIQUITIN]
    assert "local ESMFold failed" in result.fallback_reason
    assert client.last_local["status"] == "error"
    assert client.fold(UBIQUITIN).source == "esmatlas"  # cached with the source it really came from


def test_local_failure_on_a_long_sequence_does_not_call_the_api(tmp_path, esmfold_returning):
    def fold(sequence):
        raise RuntimeError("GPU out of memory folding 500 aa")

    api = esmfold_returning()
    client = local_client(tmp_path, api, FakeLocalEsmFold(fold))
    with pytest.raises(SequenceError, match="only accepts up to 400 residues") as exc:
        client.fold("A" * 500)
    assert exc.value.status_code == 413 and api.calls == []


def test_cache_entry_without_sidecar_is_labelled_api(tmp_path, esmfold_returning, ubiquitin_pdb):
    (tmp_path / "esmfold").mkdir()
    (tmp_path / "esmfold" / f"{hashlib.sha1(UBIQUITIN.encode()).hexdigest()}.pdb").write_text(ubiquitin_pdb)
    api = esmfold_returning()
    result = local_client(tmp_path, api, None).fold(UBIQUITIN)
    assert result.cached and result.source == "esmatlas" and api.calls == []


def test_cached_api_structure_is_refolded_locally(tmp_path, esmfold_returning, ubiquitin_pdb):
    api = esmfold_returning()
    api_only = local_client(tmp_path, api, None)
    assert api_only.fold(UBIQUITIN).source == "esmatlas"
    local = FakeLocalEsmFold(lambda s: ubiquitin_pdb)
    client = local_client(tmp_path, api, local)
    result = client.fold(UBIQUITIN)
    assert result.source == "local" and not result.cached and local.calls == [UBIQUITIN]
    assert client.fold(UBIQUITIN).cached and len(api.calls) == 1  # now cached as local, API never called again


def test_cached_api_structure_is_the_fallback_when_local_fails(tmp_path, esmfold_returning):
    def fold(sequence):
        raise RuntimeError("GPU out of memory")

    api = esmfold_returning()
    local_client(tmp_path, api, None).fold(UBIQUITIN)
    result = local_client(tmp_path, api, FakeLocalEsmFold(fold)).fold(UBIQUITIN)
    assert result.cached and result.source == "esmatlas" and "GPU out of memory" in result.fallback_reason
    assert len(api.calls) == 1
