"""Where a sequence's 3D structure comes from, in this order (first one that works wins):

  1. precomputed  ESMFold structures shipped in foundation_models/esmfold_files (the ones the models were trained
                  and evaluated on), found by exact chain-A sequence; then structures folded earlier on this server
                  (backend/cache/esmfold, keyed by sha1(sequence), source kept in a .json sidecar)
  2. esmatlas     the public ESM Atlas API (at most 400 aa), retried on gateway errors / timeouts
  3. local        self-hosted ESMFold v1 (app.esmfold_local.LocalFoldService): on the GPU, only when that GPU has
                  room, within the request; on the CPU (BINDSITE_DEVICE_ESMFOLD=cpu, minutes per protein) as a
                  background job, one at a time: the request answers StructureFolding (HTTP 202) at once and the UI
                  asks again until the folded structure is in the cache
  4. none         StructureUnavailable: the user is asked to fold the sequence elsewhere and upload the PDB

Rules from the integration guide still hold: never hand back another protein's structure (chain A of every
structure, whatever its source, must equal the sequence exactly), and a failed fold is an error, not a guess.
"""
import hashlib
import json
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import httpx

from .config import API_MAX_LENGTH
from .errors import ApiError, EsmFoldError, StructureFolding, StructureUnavailable
from .pdb_utils import read_chain

log = logging.getLogger("bindsite.esmfold")

RETRY_STATUS = frozenset({429, 502, 503, 504})
AA3 = {"ALA": "A", "ARG": "R", "ASN": "N", "ASP": "D", "CYS": "C", "GLN": "Q", "GLU": "E", "GLY": "G", "HIS": "H",
       "ILE": "I", "LEU": "L", "LYS": "K", "MET": "M", "PHE": "F", "PRO": "P", "SER": "S", "THR": "T", "TRP": "W",
       "TYR": "Y", "VAL": "V"}


@dataclass
class FoldResult:
    pdb: str
    plddt: list[float]
    cached: bool
    seconds: float
    source: str = "esmatlas"   # "precomputed" | "esmatlas" (public API) | "local" (self-hosted ESMFold v1)
    fallback_reason: str | None = None  # why an earlier source in the order above was not used
    detail: str | None = None  # e.g. the precomputed file name


@dataclass
class _FoldJob:
    """A queued or running CPU fold. Leaves EsmFoldClient._jobs when it succeeds (the cache then has the
    structure); a failed job stays until the next request for the sequence reports the failure."""
    sequence: str
    queued: float                    # time.time()
    fallback_reason: str | None
    started: float | None = None     # when the fold began, after the jobs ahead of it
    error: str | None = None


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


def _seq_key(sequence: str) -> str:
    return hashlib.sha1(sequence.encode()).hexdigest()


def chain_a_sequence(path: Path) -> str:
    """Chain A sequence from the CA atoms of a PDB file (fast path for indexing thousands of files)."""
    out = []
    with path.open(encoding="utf-8", errors="replace") as f:
        for line in f:
            if line.startswith("ATOM") and line[12:16] == " CA " and line[21] == "A":
                out.append(AA3.get(line[17:20], "X"))
    return "".join(out)


class PrecomputedStructures:
    """ESMFold PDBs computed ahead of time, looked up by exact chain-A sequence.

    The index (sha1(sequence) -> file name) is built in a background thread and saved next to the cache; it is
    rebuilt only when the folder changes (number of files, total size or newest modification time).
    """

    def __init__(self, directory: Path, index_file: Path):
        self.directory = Path(directory)
        self.index_file = Path(index_file)
        self._index: dict[str, str] = {}
        self._ready = threading.Event()
        self.status: dict = {"status": "running", "message": f"indexing {self.directory}"}

    def start(self, background: bool = True) -> None:
        if background:
            threading.Thread(target=self._build, daemon=True, name="precomputed-index").start()
        else:
            self._build()

    def _signature(self) -> list:
        count = size = newest = 0
        with os.scandir(self.directory) as it:
            for e in it:
                if e.name.endswith(".pdb") and e.is_file():
                    st = e.stat()
                    # whole seconds: a Docker image keeps file times to the second only, so the index built
                    # in the image would never match at run time with nanoseconds
                    count, size, newest = count + 1, size + st.st_size, max(newest, st.st_mtime_ns // 1_000_000_000)
        return [str(self.directory), count, size, newest]

    def _build(self) -> None:
        started = time.perf_counter()
        try:
            if not self.directory.is_dir():
                self.status = {"status": "warning", "message": f"{self.directory} not found: no precomputed structures"}
                return
            signature = self._signature()
            if self.index_file.exists():
                saved = json.loads(self.index_file.read_text(encoding="utf-8"))
                if saved.get("signature") == signature:
                    self._index = saved["index"]
                    self._done(started, "loaded index")
                    return
            index, duplicates = {}, 0
            for path in sorted(self.directory.glob("*.pdb")):
                key = _seq_key(chain_a_sequence(path))
                if key in index:
                    duplicates += 1
                else:
                    index[key] = path.name
            self._index = index
            self.index_file.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.index_file.with_suffix(".tmp")
            tmp.write_text(json.dumps({"signature": signature, "index": index}), encoding="utf-8")
            os.replace(tmp, self.index_file)
            self._done(started, f"indexed ({duplicates} duplicate sequences kept once)")
        except Exception as exc:
            log.exception("Cannot index precomputed structures in %s", self.directory)
            self.status = {"status": "error", "message": f"{type(exc).__name__}: {exc}"}
        finally:
            self._ready.set()

    def _done(self, started: float, how: str) -> None:
        self.status = {"status": "ok", "count": len(self._index),
                       "message": f"{len(self._index)} structures in {self.directory.name} "
                                  f"({how}, {time.perf_counter() - started:.1f} s)"}
        log.info("Precomputed structures: %s", self.status["message"])

    def lookup(self, sequence: str, wait: float = 60.0) -> tuple[str, str] | None:
        """(PDB text, file name) of the precomputed structure of `sequence`, or None."""
        self._ready.wait(wait)
        name = self._index.get(_seq_key(sequence))
        if name is None:
            return None
        return (self.directory / name).read_text(encoding="utf-8"), name

    @property
    def count(self) -> int:
        return len(self._index)


class EsmFoldClient:
    def __init__(self, url: str, timeout: float, cache_dir: Path, transport: httpx.BaseTransport | None = None,
                 attempts: int = 3, backoff: float = 3.0, total_timeout: float = 110.0, local=None,
                 precomputed: PrecomputedStructures | None = None):
        self.local = local  # app.esmfold_local.LocalFoldService (or a stand-in with ready() / fold()) or None
        self.precomputed = precomputed
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
        self._jobs: dict[str, _FoldJob] = {}   # CPU folds by sha1(sequence), in queue order
        self._jobs_lock = threading.Lock()
        self._pool: ThreadPoolExecutor | None = None

    def close(self) -> None:
        self._client.close()
        if self._pool is not None:
            self._pool.shutdown(wait=False, cancel_futures=True)

    # ------------------------------------------------------------------ the order of sources
    def fold(self, sequence: str) -> FoldResult:
        started = time.perf_counter()

        hit = self._precomputed(sequence, started) or self._cached(sequence, started)
        if hit is not None:
            return hit

        reasons: list[str] = []
        failed = self._job_status(sequence, started)  # raises StructureFolding while a CPU fold is queued / running
        if isinstance(failed, FoldResult):
            return failed
        if failed:
            reasons.append(f"local ESMFold failed ({failed})")
        if len(sequence) <= API_MAX_LENGTH:
            try:
                return self._fold_api(sequence, started)
            except ApiError as exc:
                reasons.append(f"ESMFold API failed ({exc.message})")
        else:
            reasons.append(f"the ESMFold API accepts at most {API_MAX_LENGTH} residues ({len(sequence)} given)")

        if self.local is None:
            reasons.append("local ESMFold is not set up")
        elif failed:
            pass  # it has just failed for this sequence: report it rather than queue it again
        elif getattr(self.local, "background", False):
            ok, why = self.local.can_queue()
            if not ok:
                reasons.append(f"local ESMFold is not available ({why})")
            else:
                return self._queue(sequence, started, "; ".join(reasons) or None)  # raises StructureFolding
        else:
            ok, why = self.local.ready()
            if not ok:
                reasons.append(f"local ESMFold is not available ({why})")
            else:
                try:
                    return self._fold_local(sequence, started, "; ".join(reasons) or None)
                except Exception as exc:
                    message = getattr(exc, "message", None) or str(exc)
                    self.last_local = {"status": "error", "time": _now(), "message": message}
                    log.error("Local ESMFold failed for %d aa: %s", len(sequence), message)
                    reasons.append(f"local ESMFold failed ({message})")

        raise StructureUnavailable(
            f"No structure for this {len(sequence)}-residue sequence: it is not among the precomputed ESMFold "
            f"structures, {'; '.join(reasons)}. Fold it with ESMFold, ColabFold or AlphaFold and upload the PDB.")

    # ------------------------------------------------------------------ 1. precomputed + earlier folds
    def _precomputed(self, sequence: str, started: float) -> FoldResult | None:
        if self.precomputed is None:
            return None
        found = self.precomputed.lookup(sequence)
        if found is None:
            return None
        pdb, name = found
        try:
            plddt = validate_structure(pdb, sequence)
        except EsmFoldError as exc:
            log.warning("Precomputed structure %s does not match the sequence (%s); ignoring it", name, exc.message)
            return None
        log.info("Precomputed structure %s (%d aa)", name, len(sequence))
        return FoldResult(pdb, plddt, cached=True, seconds=time.perf_counter() - started, source="precomputed",
                          detail=name)

    def _cache_files(self, sequence: str) -> tuple[Path, Path]:
        cache_file = self.cache_dir / f"{_seq_key(sequence)}.pdb"
        return cache_file, cache_file.with_suffix(".json")

    def _cached(self, sequence: str, started: float) -> FoldResult | None:
        cache_file, meta_file = self._cache_files(sequence)
        if not cache_file.exists():
            return None
        pdb = cache_file.read_text(encoding="utf-8")
        try:
            plddt = validate_structure(pdb, sequence)
        except (EsmFoldError, ValueError) as exc:
            log.warning("Cached PDB %s is invalid (%s); folding again", cache_file.name, exc)
            cache_file.unlink(missing_ok=True)
            meta_file.unlink(missing_ok=True)
            return None
        meta = {"source": "esmatlas"}  # entries written before the sidecar existed came from the API
        if meta_file.exists():
            meta.update(json.loads(meta_file.read_text(encoding="utf-8")))
        log.info("ESMFold cache hit %s (%d aa, %s)", cache_file.name, len(sequence), meta["source"])
        return FoldResult(pdb, plddt, cached=True, seconds=time.perf_counter() - started, source=meta["source"],
                          fallback_reason=meta.get("fallback_reason"), detail=meta.get("detail"))

    def _store(self, sequence: str, pdb: str, source: str, **meta) -> None:
        cache_file, meta_file = self._cache_files(sequence)
        tmp = cache_file.with_suffix(".tmp")
        tmp.write_text(pdb, encoding="utf-8")
        meta_file.write_text(json.dumps({"source": source, "time": _now(), **meta}), encoding="utf-8")
        os.replace(tmp, cache_file)  # last: a reader that sees the PDB also sees its sidecar

    # ------------------------------------------------------------------ 2. ESM Atlas API
    def _fold_api(self, sequence: str, started: float) -> FoldResult:
        response = self._post_with_retries(sequence)
        if response.status_code != 200:
            raise self._fail(EsmFoldError(
                f"HTTP {response.status_code}: {response.text.strip()[:200] or '(empty body)'}"))
        pdb = response.text
        try:
            plddt = validate_structure(pdb, sequence)
        except EsmFoldError as exc:
            raise self._fail(exc)
        self._store(sequence, pdb, "esmatlas")
        seconds = time.perf_counter() - started
        self.last_call = {"status": "ok", "time": _now(), "message": f"Folded {len(sequence)} aa in {seconds:.1f} s."}
        log.info("ESMFold API folded %d aa in %.1f s", len(sequence), seconds)
        return FoldResult(pdb, plddt, cached=False, seconds=seconds, source="esmatlas")

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
                error = (EsmFoldError(f"timed out after {per_call:.0f} s"
                                      f"{f', {attempt} attempts' if attempt > 1 else ''}"), exc)
            except httpx.HTTPError as exc:
                error = (EsmFoldError(f"cannot reach it: {type(exc).__name__}: {exc}"), exc)
            else:
                if response.status_code not in RETRY_STATUS:
                    return response
                body = response.text.strip()[:200] or "(empty body)"
                error = (EsmFoldError(f"HTTP {response.status_code}: {body}"
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
        log.error("ESMFold API failed: %s", error.message, exc_info=cause)
        return error

    # ------------------------------------------------------------------ 3. self-hosted ESMFold
    def _fold_local(self, sequence: str, started: float, fallback_reason: str | None) -> FoldResult:
        pdb = self.local.fold(sequence)
        plddt = validate_structure(pdb, sequence)
        seconds = time.perf_counter() - started
        self._store(sequence, pdb, "local")
        self.last_local = {"status": "ok", "time": _now(), "message": f"Folded {len(sequence)} aa in {seconds:.1f} s."}
        log.info("Local ESMFold folded %d aa in %.1f s", len(sequence), seconds)
        return FoldResult(pdb, plddt, cached=False, seconds=seconds, source="local", fallback_reason=fallback_reason)


    # ------------------------------------------------------------------ 3b. local ESMFold on the CPU, in the background
    def _job_status(self, sequence: str, started: float) -> "FoldResult | str | None":
        """The cached structure if a job has just finished, the error of a failed job (once), None without a job;
        raises StructureFolding while one is queued or running."""
        key = _seq_key(sequence)
        with self._jobs_lock:
            job = self._jobs.get(key)
            if job is None:
                return self._cached(sequence, started)  # finished since the cache was looked at
            if job.error is not None:
                del self._jobs[key]
                return job.error
            raise self._folding(key, job)

    def _queue(self, sequence: str, started: float, fallback_reason: str | None) -> FoldResult:
        """Queue a CPU fold and raise StructureFolding; returns only if the structure was cached meanwhile."""
        key = _seq_key(sequence)
        with self._jobs_lock:
            job = self._jobs.get(key)
            if job is None:
                hit = self._cached(sequence, started)
                if hit is not None:  # another request's job finished it meanwhile
                    return hit
                job = self._jobs[key] = _FoldJob(sequence, time.time(), fallback_reason)
                if self._pool is None:
                    self._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="cpu-fold")
                self._pool.submit(self._run_job, key, job)
                log.info("Queued a CPU fold of %d aa (%d ahead): %s", len(sequence), len(self._jobs) - 1,
                         fallback_reason or "-")
            raise self._folding(key, job)

    def _folding(self, key: str, job: _FoldJob) -> StructureFolding:
        now = time.time()
        ahead = sum(1 for k, j in self._jobs.items() if j.queued < job.queued and j.error is None and k != key)
        stage = "folding" if job.started is not None else "queued"
        folding = {"length": len(job.sequence), "stage": stage, "ahead": ahead, "device": "cpu",
                   "waited_s": round(now - job.queued, 1),
                   "folding_s": round(now - job.started, 1) if job.started is not None else 0.0,
                   "fallback_reason": job.fallback_reason}
        where = "folding it" if stage == "folding" else f"queued behind {ahead} other fold{'s' * (ahead != 1)}"
        return StructureFolding(f"Local ESMFold on the CPU is {where} ({len(job.sequence)} aa). This takes "
                                f"minutes; ask again and the structure is used as soon as it is ready.", folding)

    def _run_job(self, key: str, job: _FoldJob) -> None:
        job.started = time.time()
        try:
            ok, why = self.local.ready()  # the first time: load + golden self-test (minutes on the CPU)
            if not ok:
                raise EsmFoldError(f"local ESMFold is not available ({why})")
            t = time.perf_counter()
            pdb = self.local.fold(job.sequence)
            validate_structure(pdb, job.sequence)
            seconds = time.perf_counter() - t
            with self._jobs_lock:
                self._store(job.sequence, pdb, "local", fallback_reason=job.fallback_reason,
                            detail=f"CPU, {seconds:.0f} s")
                self._jobs.pop(key, None)
            self.last_local = {"status": "ok", "time": _now(),
                               "message": f"Folded {len(job.sequence)} aa on the CPU in {seconds:.0f} s."}
            log.info("Local ESMFold folded %d aa on the CPU in %.1f s", len(job.sequence), seconds)
        except Exception as exc:
            message = getattr(exc, "message", None) or str(exc)
            self.last_local = {"status": "error", "time": _now(), "message": message}
            log.error("Local ESMFold failed for %d aa on the CPU: %s", len(job.sequence), message)
            with self._jobs_lock:
                job.error = message


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")
