"""A long-lived helper process in another Python environment, spoken to in JSON lines.

Used where a model needs libraries that conflict with the main environment (ESM-IF, the two baselines). The worker
answers one request per line on stdout; everything else it prints goes to stderr and ends up in the backend log.
"""
import json
import logging
import os
import queue
import subprocess
import threading
import time
from pathlib import Path


class WorkerDied(Exception):
    """The process is gone or answered out of step; the next request starts a new one."""


class LineWorker:
    label = "worker"                 # used in messages
    error_type: type = RuntimeError  # what callers catch
    log = logging.getLogger("bindsite.worker")

    def __init__(self, python: Path, script: Path, timeout: float, startup_timeout: float):
        self.python = Path(python)
        self.script = Path(script)
        self.timeout = timeout
        self.startup_timeout = startup_timeout
        self.info: dict = {}
        self._proc: subprocess.Popen | None = None
        self._lines: queue.Queue = queue.Queue()
        self._lock = threading.Lock()

    # ------------------------------------------------------------------ to implement
    def _check_files(self) -> None:
        """Raise error_type when something the worker needs is missing."""

    def _arguments(self) -> list[str]:
        return []

    def _environment(self, env: dict) -> None:
        """Adjust the environment of the worker."""

    # ------------------------------------------------------------------ lifecycle
    def start(self) -> dict:
        with self._lock:
            return self._start()

    def _start(self) -> dict:
        if self._proc is not None and self._proc.poll() is None:
            return self.info
        self._check_files()
        env = dict(os.environ)
        env.pop("PYTHONPATH", None)          # never leak the main environment's packages into it
        env["PYTHONNOUSERSITE"] = "1"
        self._environment(env)
        cmd = [str(self.python), "-I", str(self.script), *self._arguments()]
        self.log.info("Starting %s worker: %s", self.label, " ".join(cmd))
        started = time.perf_counter()
        self._lines = queue.Queue()
        self._proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                      text=True, encoding="utf-8", bufsize=1, env=env)
        threading.Thread(target=self._pump_stdout, args=(self._proc, self._lines), daemon=True,
                         name=f"{self.label}-stdout").start()
        threading.Thread(target=self._pump_stderr, args=(self._proc,), daemon=True, name=f"{self.label}-stderr").start()

        try:
            msg = self._read(self.startup_timeout, "start-up")
        except WorkerDied as exc:
            raise self.error_type(f"{self.label} worker died: {exc}") from None
        if not msg.get("ready"):
            self._kill()
            raise self.error_type(f"{self.label} worker failed to start: {msg.get('error', msg)}")
        self.info = {k: v for k, v in msg.items() if k != "ready"}
        self.log.info("%s worker ready in %.1f s: %s", self.label, time.perf_counter() - started, self.info)
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

    # ------------------------------------------------------------------ requests
    def _with_restart(self, call):
        """Run call() on a live worker; restart it and try once more if it dies on the way."""
        with self._lock:
            for attempt in (1, 2):
                if not self.alive:
                    if attempt == 2 or self._proc is not None:
                        self.log.warning("%s worker is not running; restarting it", self.label)
                    self._start()
                try:
                    return call()
                except WorkerDied as exc:
                    self.log.error("%s worker died (%s)%s", self.label, exc, "; retrying once" if attempt == 1 else "")
                    self._kill()
                    if attempt == 2:
                        raise self.error_type(f"{self.label} worker died: {exc}") from None
        raise AssertionError("unreachable")

    def _request(self, request: dict, what: str) -> dict:
        """Send one request, wait for its answer. Call inside _with_restart."""
        try:
            self._proc.stdin.write(json.dumps(request) + "\n")
            self._proc.stdin.flush()
        except (BrokenPipeError, OSError) as exc:
            raise WorkerDied(f"cannot write to the worker ({exc})") from None
        msg = self._read(self.timeout, what)
        if msg.get("id") != request["id"]:
            raise WorkerDied(f"answer for request {msg.get('id')!r}, expected {request['id']!r}")
        return msg

    # ------------------------------------------------------------------ plumbing
    def _read(self, timeout: float, what: str) -> dict:
        deadline = time.monotonic() + timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                self._kill()
                raise self.error_type(f"{self.label} worker {what} timed out after {timeout:.0f} s")
            try:
                line = self._lines.get(timeout=min(remaining, 1.0))
            except queue.Empty:
                if self._proc is None or self._proc.poll() is not None:
                    code = None if self._proc is None else self._proc.returncode
                    raise WorkerDied(f"exited with code {code} during {what}; see backend log ({self.log.name})")
                continue
            if line is None:  # EOF
                continue
            try:
                return json.loads(line)
            except json.JSONDecodeError:
                self.log.warning("%s worker wrote a non-protocol line: %s", self.label, line.rstrip()[:300])

    @staticmethod
    def _pump_stdout(proc: subprocess.Popen, lines: queue.Queue) -> None:
        for line in proc.stdout:
            lines.put(line)
        lines.put(None)

    def _pump_stderr(self, proc: subprocess.Popen) -> None:
        for line in proc.stderr:
            line = line.rstrip()
            if line:
                self.log.info("[worker] %s", line[:2000])

    def _kill(self) -> None:
        if self._proc is not None:
            try:
                self._proc.kill()
                self._proc.wait(timeout=10)
            except Exception:
                pass
        self._proc = None
