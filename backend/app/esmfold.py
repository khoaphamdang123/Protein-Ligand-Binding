"""ESMFold structures (integration guide section 2): self-hosted ESMFold v1 first, the public ESM Atlas API as
fallback (and the only source when foundation_models/esmfold_v1 is absent or BINDSITE_ESMFOLD_LOCAL=off).

Rules from the guide: fold error/timeout -> error (never reuse another PDB); chain A of every structure, local or
API, must match the sequence exactly; PDBs are cached by sha1(sequence), with their source in a .json sidecar.

The public API is flaky under load: its gateway answers 504 after ~30 s, and asking again for the same
sequence usually succeeds (the fold finishes server-side). Gateway errors (429/502/503/504), timeouts and
connection errors are therefore retried a few times within a total time budget; every answer is still
validated against the sequence, so a retry can never hand back another protein's structure.
"""
import hashlib
import json
import logging
import os
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import httpx

from .config import API_MAX_LENGTH
from .errors import EsmFoldError, SequenceError
from .pdb_utils import read_chain

log = logging.getLogger("bindsite.esmfold")

RETRY_STATUS = frozenset({429, 502, 503, 504})


@dataclass
class FoldResult:
    pdb: str
    plddt: list[float]
    cached: bool
    seconds: float
    source: str = "esmatlas"   # "local" (self-hosted ESMFold v1) | "esmatlas" (public API)
    fallback_reason: str | None = None  # why the API was used although local ESMFold is configured


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
    def __init__(self, url: str, timeout: float, cache_dir: Path, transport: httpx.BaseTransport | None = None,
                 attempts: int = 3, backoff: float = 3.0, total_timeout: float = 110.0, local=None):
        self.local = local  # app.esmfold_local.LocalEsmFold or None
        self.url = url
        self.timeout = timeout
        self.attempts = max(1, attempts)
        self.backoff = backoff
        self.total_timeout = total_timeout
        self.cache_dir = cache_dir / "esmfold"
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self._client = httpx.Client(timeout=httpx.Timeout(timeout, connect=15.0), transport=transport)
        self.last_call: dict = {"status": "unknown", "message": "No ESMFold API call yet."}
        self.last_local: dict = {"status": "unknown", "message": "No local fold yet."}

    def close(self) -> None:
        self._client.close()

    def fold(self, sequence: str) -> FoldResult:
        started = time.perf_counter()
        cache_file = self.cache_dir / f"{hashlib.sha1(sequence.encode()).hexdigest()}.pdb"

        meta_file = cache_file.with_suffix(".json")

        cached_api = None  # an API structure kept as the fallback while local ESMFold refolds the sequence
        if cache_file.exists():
            pdb = cache_file.read_text(encoding="utf-8")
            try:
                plddt = validate_structure(pdb, sequence)
                source = "esmatlas"  # entries written before the sidecar existed came from the API
                if meta_file.exists():
                    source = json.loads(meta_file.read_text(encoding="utf-8")).get("source", source)
                hit = FoldResult(pdb, plddt, cached=True, seconds=time.perf_counter() - started, source=source)
                if source == "local" or self.local is None:
                    log.info("ESMFold cache hit %s (%d aa, %s)", cache_file.name, len(sequence), source)
                    return hit
                # Local ESMFold is the preferred source: replace the API structure with a local fold.
                log.info("Cached PDB %s came from the API; refolding with local ESMFold", cache_file.name)
                cached_api = hit
            except (EsmFoldError, ValueError) as exc:
                log.warning("Cached PDB %s is invalid (%s); folding again", cache_file.name, exc)
                cache_file.unlink(missing_ok=True)
                meta_file.unlink(missing_ok=True)

        fallback_reason = None
        if self.local is not None:
            try:
                pdb = self.local.fold(sequence)
                plddt = validate_structure(pdb, sequence)
            except Exception as exc:
                fallback_reason = f"local ESMFold failed ({getattr(exc, 'message', None) or exc})"
                self.last_local = {"status": "error", "time": _now(), "message": fallback_reason}
                log.error("Local ESMFold failed for %d aa, falling back to the API: %s", len(sequence), exc)
                if cached_api is not None:
                    cached_api.fallback_reason = fallback_reason
                    return cached_api
            else:
                seconds = time.perf_counter() - started
                self._store(cache_file, meta_file, pdb, "local")
                self.last_local = {"status": "ok", "time": _now(),
                                   "message": f"Folded {len(sequence)} aa in {seconds:.1f} s."}
                log.info("Local ESMFold folded %d aa in %.1f s", len(sequence), seconds)
                return FoldResult(pdb, plddt, cached=False, seconds=seconds, source="local")
            if len(sequence) > API_MAX_LENGTH:
                raise SequenceError(f"{fallback_reason[0].upper()}{fallback_reason[1:]}, and the ESMFold API fallback "
                                    f"only accepts up to {API_MAX_LENGTH} residues ({len(sequence)} given).",
                                    too_long=True)

        response = self._post_with_retries(sequence)

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

        self._store(cache_file, meta_file, pdb, "esmatlas")
        seconds = time.perf_counter() - started
        self.last_call = {"status": "ok", "time": _now(), "message": f"Folded {len(sequence)} aa in {seconds:.1f} s."}
        log.info("ESMFold API folded %d aa in %.1f s", len(sequence), seconds)
        return FoldResult(pdb, plddt, cached=False, seconds=seconds, source="esmatlas", fallback_reason=fallback_reason)

    @staticmethod
    def _store(cache_file: Path, meta_file: Path, pdb: str, source: str) -> None:
        tmp = cache_file.with_suffix(".tmp")
        tmp.write_text(pdb, encoding="utf-8")
        os.replace(tmp, cache_file)
        meta_file.write_text(json.dumps({"source": source, "time": _now()}), encoding="utf-8")

    def _post_with_retries(self, sequence: str) -> httpx.Response:
        deadline = time.monotonic() + self.total_timeout
        for attempt in range(1, self.attempts + 1):
            remaining = deadline - time.monotonic()
            per_call = max(5.0, min(self.timeout, remaining))
            log.info("Calling ESMFold API for %d aa (attempt %d/%d)", len(sequence), attempt, self.attempts)
            error = None
            try:
                response = self._client.post(self.url, content=sequence.encode(), headers={"Content-Type": "text/plain"},
                                             timeout=httpx.Timeout(per_call, connect=min(15.0, per_call)))
            except httpx.TimeoutException as exc:
                error = (EsmFoldError(f"ESMFold API timed out after {per_call:.0f} s"
                                      f"{f' ({attempt} attempts)' if attempt > 1 else ''}. Try again later."), exc)
            except httpx.HTTPError as exc:
                error = (EsmFoldError(f"Cannot reach the ESMFold API ({type(exc).__name__}: {exc})."), exc)
            else:
                if response.status_code not in RETRY_STATUS:
                    return response
                body = response.text.strip()[:200] or "(empty body)"
                error = (EsmFoldError(f"ESMFold API returned HTTP {response.status_code}: {body}"
                                      f"{f' (after {attempt} attempts)' if attempt > 1 else ''}"), None)
            # Retry only if a next attempt still has a useful amount of time left.
            if attempt < self.attempts and deadline - time.monotonic() - self.backoff >= 10.0:
                log.warning("ESMFold API attempt %d/%d failed (%s); retrying in %.0f s",
                            attempt, self.attempts, error[0].message, self.backoff)
                time.sleep(self.backoff)
                continue
            raise self._fail(*error)
        raise AssertionError("unreachable")

    def _fail(self, error, cause: Exception | None = None):
        self.last_call = {"status": "error", "time": _now(), "message": error.message}
        log.error("ESMFold failed: %s", error.message, exc_info=cause)
        return error


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")
