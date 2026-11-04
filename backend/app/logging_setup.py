"""Logging to console + rotating file, tagged with the current request id.

The last warnings/errors are also kept in memory so /diagnostics (and the UI) can show them.
"""
import contextvars
import logging
import logging.handlers
from collections import deque
from datetime import datetime, timezone
from pathlib import Path

request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")

LOG_FORMAT = "%(asctime)s %(levelname)-7s %(name)s [%(request_id)s] %(message)s"


class _RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_var.get()
        return True


class RecentProblemsHandler(logging.Handler):
    """Keeps the most recent WARNING+ records for the diagnostics endpoint."""

    def __init__(self, capacity: int = 200):
        super().__init__(level=logging.WARNING)
        self.records: deque[dict] = deque(maxlen=capacity)

    def emit(self, record: logging.LogRecord) -> None:
        entry = {
            "time": datetime.fromtimestamp(record.created, timezone.utc).isoformat(timespec="seconds"),
            "level": record.levelname,
            "logger": record.name,
            "request_id": getattr(record, "request_id", "-"),
            "message": record.getMessage(),
        }
        if record.exc_info and record.exc_info[1] is not None:
            entry["exception"] = f"{type(record.exc_info[1]).__name__}: {record.exc_info[1]}"
        self.records.append(entry)


recent_problems = RecentProblemsHandler()


def setup_logging(log_dir: Path) -> Path:
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / "backend.log"

    root = logging.getLogger()
    if any(getattr(h, "_bindsite", False) for h in root.handlers):
        return log_file  # already configured (e.g. uvicorn --reload re-imports)

    formatter = logging.Formatter(LOG_FORMAT)
    request_filter = _RequestIdFilter()

    file_handler = logging.handlers.RotatingFileHandler(log_file, maxBytes=5_000_000, backupCount=5, encoding="utf-8")
    console_handler = logging.StreamHandler()
    for handler in (file_handler, console_handler, recent_problems):
        handler.setFormatter(formatter)
        handler.addFilter(request_filter)
        handler._bindsite = True
        root.addHandler(handler)

    root.setLevel(logging.INFO)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    return log_file
