"""AlphaFold DB lookup (bindNode24 structure in the compare mode) and the superposition used to show it."""
import numpy as np

from app.alphafold_db import AlphaFoldDB
from app.esmfold_local import ca_coords
from app.pdb_utils import superpose

from .conftest import UBIQUITIN, FakeAlphaFoldDB, moved_pdb


def client(tmp_path, fake):
    return AlphaFoldDB("https://alphafold.test", tmp_path, transport=fake.transport)


def test_found_prefers_the_uniprot_style_entry_and_is_cached(tmp_path, ubiquitin_pdb):
    fake = FakeAlphaFoldDB({UBIQUITIN: moved_pdb(ubiquitin_pdb)})
    model, reason = client(tmp_path, fake).lookup(UBIQUITIN)
    assert reason is None and model.entry == "AF-P0CG48-F1" and model.version == "v6"
    assert fake.calls[-1].endswith("AF-P0CG48-F1-model_v6.pdb")
    assert max(model.plddt) <= 1.0 and len(model.plddt) == 76       # 0-100 file scale read as 0-1
    again, _ = client(tmp_path, fake).lookup(UBIQUITIN)
    assert again.entry == model.entry and len(fake.calls) == 2         # from the disk cache


def test_the_own_accession_wins_and_is_cached_apart(tmp_path, ubiquitin_pdb):
    fake = FakeAlphaFoldDB({UBIQUITIN: moved_pdb(ubiquitin_pdb)})
    own, _ = client(tmp_path, fake).lookup(UBIQUITIN, "q99999")
    assert own.entry == "AF-Q99999-F1"
    other, _ = client(tmp_path, fake).lookup(UBIQUITIN)             # no accession: the oldest UniProt-style entry
    assert other.entry == "AF-P0CG48-F1"
    assert client(tmp_path, fake).lookup(UBIQUITIN, "not an id!")[0].entry == "AF-P0CG48-F1"   # ignored, not trusted


def test_not_found_is_remembered(tmp_path):
    fake = FakeAlphaFoldDB({})
    assert client(tmp_path, fake).lookup(UBIQUITIN) == (None, "not in AlphaFold DB")
    assert client(tmp_path, fake).lookup(UBIQUITIN) == (None, "not in AlphaFold DB")
    assert len(fake.calls) == 1


def test_a_failure_is_not_remembered(tmp_path):
    fake = FakeAlphaFoldDB(status=503)
    model, reason = client(tmp_path, fake).lookup(UBIQUITIN)
    assert model is None and "could not be reached" in reason
    client(tmp_path, fake).lookup(UBIQUITIN)
    assert len(fake.calls) == 2


def test_a_file_of_another_sequence_is_refused(tmp_path, ubiquitin_pdb):
    fake = FakeAlphaFoldDB({UBIQUITIN: moved_pdb(ubiquitin_pdb).replace("MET A   1", "ALA A   1")})
    model, reason = client(tmp_path, fake).lookup(UBIQUITIN)
    assert model is None and "no PDB file that matches" in reason


def test_superpose_brings_a_moved_copy_back_without_changing_its_shape(ubiquitin_pdb):
    moved = moved_pdb(ubiquitin_pdb, plddt_scale=1.0)
    a, b = ca_coords(moved), ca_coords(ubiquitin_pdb)
    assert np.abs(a - b).max() > 5
    back, rmsd = superpose(moved, a, b)
    c = ca_coords(back)
    assert rmsd < 0.01 and np.abs(c - b).max() < 0.01
    dist = lambda x: np.linalg.norm(x[:, None] - x[None], axis=-1)
    assert np.abs(dist(c) - dist(a)).max() < 0.01                     # same graph for bindNode24
