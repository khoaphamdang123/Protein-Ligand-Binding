"""ESM-IF1 embeddings from the separate ESM-IF environment (numpy<2, fair-esm 2.0.0).

The main environment needs numpy>=2 (the metal checkpoints pickle numpy._core arrays) and fair-esm needs
numpy<2, so ESM-IF runs in its own interpreter: one long-lived worker process (scripts/esmif_worker.py) that
loads the 1.7 GB model once. Requests and answers are JSON lines; the embedding travels as a .npy file.
"""
import json
import logging
import os
import queue
import subprocess
import tempfile
import threading
import time
import uuid
from pathlib import Path

import numpy as np

log = logging.getLogger("bindsite.esmif")

WORKER_SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "esmif_worker.py"
ESMIF_DIM = 512


class EsmIfError(RuntimeError):
    pass


class EsmIfWorker:
    def __init__(self, python: Path, weights: Path, device: str = "", timeout: float = 300.0,
                 startup_timeout: float = 300.0, torch_home: Path | None = None, script: Path = WORKER_SCRIPT):
        self.python = Path(python)
        self.weights = Path(weights)
        self.device = device
        self.timeout = timeout
        self.startup_timeout = startup_timeout
        self.torch_home = torch_home
        self.script = Path(script)
        self.info: dict = {}
        self._proc: subprocess.Popen | None = None
        self._lines: queue.Queue = queue.Queue()
        self._lock = threading.Lock()

    # ------------------------------------------------------------------ lifecycle
    def start(self) -> dict:
        with self._lock:
            return self._start()

    def _start(self) -> dict:
        if self._proc is not None and self._proc.poll() is None:
            return self.info
        if not self.python.exists():
            raise EsmIfError(f"ESM-IF environment not found: {self.python} (run backend/setup_env.sh)")
        if not self.weights.exists():
            raise EsmIfError(f"ESM-IF weights not found: {self.weights}")
        env = dict(os.environ)
        env.pop("PYTHONPATH", None)          # never leak the main environment's packages (numpy 2) into it
        env["PYTHONNOUSERSITE"] = "1"
        if self.torch_home:
            env["TORCH_HOME"] = str(self.torch_home)
        cmd = [str(self.python), "-I", str(self.script), "--weights", str(self.weights)]
        if self.device:
            cmd += ["--device", self.device]
        log.info("Starting ESM-IF worker: %s", " ".join(cmd))
        started = time.perf_counter()
        self._lines = queue.Queue()
        self._proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                      text=True, encoding="utf-8", bufsize=1, env=env)
        threading.Thread(target=self._pump_stdout, args=(self._proc, self._lines), daemon=True,
                         name="esmif-stdout").start()
        threading.Thread(target=self._pump_stderr, args=(self._proc,), daemon=True, name="esmif-stderr").start()

        msg = self._read(self.startup_timeout, "start-up")
        if not msg.get("ready"):
            self._kill()
            raise EsmIfError(f"ESM-IF worker failed to start: {msg.get('error', msg)}")
        self.info = {k: v for k, v in msg.items() if k != "ready"}
        log.info("ESM-IF worker ready in %.1f s: %s", time.perf_counter() - started, self.info)
        return self.info

    def close(self) -> None:
        with self._lock:
            if self._proc is not None and self._proc.poll() is None:
                try:
                    self._proc.stdin.close()
                    self._proc.wait(timeout=10)
                except Exception:
                    self._kill()
            self._proc = None

    @property
    def alive(self) -> bool:
        return self._proc is not None and self._proc.poll() is None

    # ------------------------------------------------------------------ embedding
    def embed(self, chain_pdb: Path, sequence: str) -> np.ndarray:
        """ESM-IF (L, 512) float32 of chain A of ``chain_pdb`` (must match ``sequence`` exactly)."""
        with self._lock:
            for attempt in (1, 2):
                if not self.alive:
                    if attempt == 2 or self._proc is not None:
                        log.warning("ESM-IF worker is not running; restarting it")
                    self._start()
                try:
                    return self._embed(chain_pdb, sequence)
                except _WorkerDied as exc:
                    log.error("ESM-IF worker died (%s)%s", exc, "; retrying once" if attempt == 1 else "")
                    self._kill()
                    if attempt == 2:
                        raise EsmIfError(f"ESM-IF worker died: {exc}") from None
        raise AssertionError("unreachable")

    def _embed(self, chain_pdb: Path, sequence: str) -> np.ndarray:
        with tempfile.TemporaryDirectory(prefix="esmif_") as tmp:
            out = Path(tmp) / "query.ESMIF.npy"
            req_id = uuid.uuid4().hex[:8]
            try:
                self._proc.stdin.write(json.dumps({"id": req_id, "pdb": str(chain_pdb), "sequence": sequence,
                                                   "out": str(out)}) + "\n")
                self._proc.stdin.flush()
            except (BrokenPipeError, OSError) as exc:
                raise _WorkerDied(f"cannot write to the worker ({exc})") from None
            msg = self._read(self.timeout, "embedding")
            if msg.get("id") != req_id:
                raise _WorkerDied(f"answer for request {msg.get('id')!r}, expected {req_id!r}")
            if not msg.get("ok"):
                raise EsmIfError(f"ESM-IF failed: {msg.get('error')}")
            arr = np.load(out)
        if arr.shape != (len(sequence), ESMIF_DIM) or not np.isfinite(arr).all():
            raise EsmIfError(f"ESM-IF returned shape {arr.shape} for {len(sequence)} residues (or NaN/inf)")
        return arr

    # ------------------------------------------------------------------ plumbing
    def _read(self, timeout: float, what: str) -> dict:
        deadline = time.monotonic() + timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                self._kill()
                raise EsmIfError(f"ESM-IF worker {what} timed out after {timeout:.0f} s")
            try:
                line = self._lines.get(timeout=min(remaining, 1.0))
            except queue.Empty:
                if self._proc is None or self._proc.poll() is not None:
                    code = None if self._proc is None else self._proc.returncode
                    raise _WorkerDied(f"exited with code {code} during {what}; see backend log (bindsite.esmif)")
                continue
            if line is None:  # EOF
                continue
            try:
                return json.loads(line)
            except json.JSONDecodeError:
                log.warning("ESM-IF worker wrote a non-protocol line: %s", line.rstrip()[:300])

    @staticmethod
    def _pump_stdout(proc: subprocess.Popen, lines: queue.Queue) -> None:
        for line in proc.stdout:
            lines.put(line)
        lines.put(None)

    @staticmethod
    def _pump_stderr(proc: subprocess.Popen) -> None:
        for line in proc.stderr:
            line = line.rstrip()
            if line:
                log.info("[worker] %s", line[:2000])

    def _kill(self) -> None:
        if self._proc is not None:
            try:
                self._proc.kill()
                self._proc.wait(timeout=10)
            except Exception:
                pass
        self._proc = None


class _WorkerDied(EsmIfError):
    pass
