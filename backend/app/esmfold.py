"""ESMFold through the public ESM Atlas API (integration guide section 2).

Rules from the guide: API error/timeout -> error (never reuse another PDB); the returned
chain A must match the sequence exactly; PDBs are cached by sha1(sequence).
"""
import hashlib
import logging
import os
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import httpx

from .errors import EsmFoldError, SequenceError
from .pdb_utils import read_chain

log = logging.getLogger("bindsite.esmfold")


@dataclass
class FoldResult:
    pdb: str
    plddt: list[float]
    cached: bool
    seconds: float


def validate_structure(pdb_text: str, sequence: str) -> list[float]:
    """Return per-residue pLDDT (0-1) or raise if chain A does not match `sequence` exactly."""
    if "ATOM" not in pdb_text:
        raise EsmFoldError("ESMFold returned no atom records.")
    chain = read_chain(pdb_text, "A")
    if not chain.sequence:
        raise EsmFoldError("ESMFold structure has no chain A.")
    if len(chain.sequence) != len(sequence):
        raise EsmFoldError(
            f"ESMFold chain A has {len(chain.sequence)} residues but the sequence has {len(sequence)}."
        )
    if chain.sequence != sequence:
        first = next(i for i, (a, b) in enumerate(zip(chain.sequence, sequence)) if a != b)
        raise EsmFoldError(
            f"ESMFold chain A does not match the sequence (first difference at residue {first + 1}: "
            f"structure '{chain.sequence[first]}' vs sequence '{sequence[first]}')."
        )

    plddt = chain.plddt
    if max(plddt) > 1.0:
        # The API serves pLDDT on a 0-1 scale (same as the training data); tolerate a 0-100 scale.
        log.warning("ESMFold pLDDT is on a 0-100 scale (max %.1f); rescaling to 0-1 for display", max(plddt))
        plddt = [p / 100.0 for p in plddt]
    return plddt


class EsmFoldClient:
    def __init__(self, url: str, timeout: float, cache_dir: Path, transport: httpx.BaseTransport | None = None):
        self.url = url
        self.timeout = timeout
        self.cache_dir = cache_dir / "esmfold"
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self._client = httpx.Client(timeout=httpx.Timeout(timeout, connect=15.0), transport=transport)
        self.last_call: dict = {"status": "unknown", "message": "No ESMFold API call yet."}

    def close(self) -> None:
        self._client.close()

    def fold(self, sequence: str) -> FoldResult:
        started = time.perf_counter()
        cache_file = self.cache_dir / f"{hashlib.sha1(sequence.encode()).hexdigest()}.pdb"

        if cache_file.exists():
            pdb = cache_file.read_text(encoding="utf-8")
            try:
                plddt = validate_structure(pdb, sequence)
                log.info("ESMFold cache hit %s (%d aa)", cache_file.name, len(sequence))
                return FoldResult(pdb, plddt, cached=True, seconds=time.perf_counter() - started)
            except EsmFoldError as exc:
                log.warning("Cached PDB %s is invalid (%s); folding again", cache_file.name, exc.message)
                cache_file.unlink(missing_ok=True)

        log.info("Calling ESMFold API for %d aa", len(sequence))
        try:
            response = self._client.post(self.url, content=sequence.encode(), headers={"Content-Type": "text/plain"})
        except httpx.TimeoutException as exc:
            raise self._fail(EsmFoldError(f"ESMFold API timed out after {self.timeout:.0f} s. Try again later."), exc)
        except httpx.HTTPError as exc:
            raise self._fail(EsmFoldError(f"Cannot reach the ESMFold API ({type(exc).__name__}: {exc})."), exc)

        if response.status_code == 413:
            raise self._fail(SequenceError(
                f"The ESMFold API rejected the sequence as too long ({response.text.strip()[:200]}).", too_long=True))
        if response.status_code != 200:
            raise self._fail(EsmFoldError(
                f"ESMFold API returned HTTP {response.status_code}: {response.text.strip()[:200] or '(empty body)'}"))

        pdb = response.text
        try:
            plddt = validate_structure(pdb, sequence)
        except EsmFoldError as exc:
            raise self._fail(exc)

        tmp = cache_file.with_suffix(".tmp")
        tmp.write_text(pdb, encoding="utf-8")
        os.replace(tmp, cache_file)

        seconds = time.perf_counter() - started
        self.last_call = {"status": "ok", "time": _now(), "message": f"Folded {len(sequence)} aa in {seconds:.1f} s."}
        log.info("ESMFold API folded %d aa in %.1f s", len(sequence), seconds)
        return FoldResult(pdb, plddt, cached=False, seconds=seconds)

    def _fail(self, error, cause: Exception | None = None):
        self.last_call = {"status": "error", "time": _now(), "message": error.message}
        log.error("ESMFold failed: %s", error.message, exc_info=cause)
        return error


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")
