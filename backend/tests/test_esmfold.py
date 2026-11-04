import hashlib

import httpx
import pytest

from app.errors import EsmFoldError, SequenceError
from app.esmfold import EsmFoldClient, validate_structure
from app.pdb_utils import read_chain

from .conftest import UBIQUITIN, FakeEsmFold


def make_client(tmp_path, fake: FakeEsmFold) -> EsmFoldClient:
    return EsmFoldClient("https://esmfold.test/fold", 5.0, tmp_path, fake.transport)


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


@pytest.mark.parametrize("status,text", [(500, "Internal Server Error"), (503, ""), (429, "Too Many Requests")])
def test_api_error_status_becomes_502(tmp_path, esmfold_returning, status, text):
    client = make_client(tmp_path, esmfold_returning(status, text))
    with pytest.raises(EsmFoldError, match=f"HTTP {status}") as exc:
        client.fold(UBIQUITIN)
    assert exc.value.status_code == 502
    assert not list((tmp_path / "esmfold").glob("*.pdb"))


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

    client = make_client(tmp_path, FakeEsmFold(raise_exc))
    with pytest.raises(EsmFoldError, match=message) as err:
        client.fold(UBIQUITIN)
    assert err.value.status_code == 502
    assert client.last_call["status"] == "error"
