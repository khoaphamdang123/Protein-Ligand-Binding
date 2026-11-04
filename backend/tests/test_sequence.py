import pytest

from app.errors import SequenceError
from app.sequence import clean_sequence

from .conftest import UBIQUITIN


def clean(raw: str) -> str:
    return clean_sequence(raw, min_length=30, max_length=400)


def test_plain_sequence_is_returned_unchanged():
    assert clean(UBIQUITIN) == UBIQUITIN


def test_fasta_header_whitespace_and_case_are_normalised():
    raw = f">sp|P0CG48|UBC_HUMAN Polyubiquitin\n  {UBIQUITIN[:30].lower()}\r\n{UBIQUITIN[30:60]} \t\n{UBIQUITIN[60:]}\n\n"
    assert clean(raw) == UBIQUITIN


def test_more_than_one_fasta_record_is_rejected():
    with pytest.raises(SequenceError, match="found 2 FASTA records") as exc:
        clean(f">a\n{UBIQUITIN}\n>b\n{UBIQUITIN}")
    assert exc.value.status_code == 400


@pytest.mark.parametrize("raw", ["", "   \n ", ">header only\n"])
def test_empty_sequence_is_rejected(raw):
    with pytest.raises(SequenceError, match="empty"):
        clean(raw)


@pytest.mark.parametrize("bad", ["X", "U", "B", "Z", "O", "*", "1", "-"])
def test_non_standard_characters_are_rejected_with_position(bad):
    raw = UBIQUITIN[:10] + bad + UBIQUITIN[10:]
    with pytest.raises(SequenceError) as exc:
        clean(raw)
    assert f"'{bad}' at 11" in exc.value.message
    assert exc.value.code == "SEQUENCE_INVALID"


def test_many_invalid_characters_are_summarised():
    with pytest.raises(SequenceError, match=r"\(\+3 more\)"):
        clean("X" * 8 + UBIQUITIN)


def test_length_limits():
    assert clean("A" * 30) == "A" * 30
    assert clean("A" * 400) == "A" * 400
    with pytest.raises(SequenceError, match="minimum is 30") as short:
        clean("A" * 29)
    assert short.value.status_code == 400
    with pytest.raises(SequenceError, match="maximum is 400") as long:
        clean("A" * 401)
    assert long.value.status_code == 413
    assert long.value.code == "SEQUENCE_TOO_LONG"
