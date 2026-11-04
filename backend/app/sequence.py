"""Input sequence cleaning/validation (integration guide section 5)."""
from .errors import SequenceError

STANDARD_AA = frozenset("ACDEFGHIKLMNPQRSTVWY")


def clean_sequence(raw: str, min_length: int, max_length: int) -> str:
    """Strip one optional FASTA header and all whitespace, uppercase, then validate."""
    lines = (raw or "").strip().splitlines()
    headers = [line for line in lines if line.lstrip().startswith(">")]
    if len(headers) > 1:
        raise SequenceError(f"Only one sequence per request is supported (found {len(headers)} FASTA records).")

    sequence = "".join("".join(line for line in lines if not line.lstrip().startswith(">")).split()).upper()
    if not sequence:
        raise SequenceError("Sequence is empty.")

    invalid = [(i + 1, aa) for i, aa in enumerate(sequence) if aa not in STANDARD_AA]
    if invalid:
        shown = ", ".join(f"'{aa}' at {pos}" for pos, aa in invalid[:5])
        more = f" (+{len(invalid) - 5} more)" if len(invalid) > 5 else ""
        raise SequenceError(
            f"Sequence may only contain the 20 standard amino acids (ACDEFGHIKLMNPQRSTVWY). "
            f"Found {shown}{more}. Non-standard residues such as X, U, B, Z, O are not supported."
        )

    if len(sequence) < min_length:
        raise SequenceError(f"Sequence has {len(sequence)} residues; the minimum is {min_length}.")
    if len(sequence) > max_length:
        raise SequenceError(
            f"Sequence has {len(sequence)} residues; the maximum is {max_length} "
            f"(limit of the ESMFold API used to predict the structure).",
            too_long=True,
        )
    return sequence
