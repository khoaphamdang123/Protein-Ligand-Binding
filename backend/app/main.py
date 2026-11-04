"""BindSite backend. Run with:  python -m uvicorn app.main:create_app --factory --port 8000

API contract: integration guide section 5. Additive fields (not in the contract):
`mock`, `timing`, `structure.cached` in /predict; `predictor`, `mock`, `profile`, `min_length` in /health.
"""
import json
import logging
import time
import traceback
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Literal

import httpx
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from . import model_files
from .config import BINDING_TYPES, Settings, apply_offline_environment
from .errors import ApiError, PredictorUnavailable
from .esmfold import EsmFoldClient
from .logging_setup import recent_problems, request_id_var, setup_logging
from .predictor import create_predictor
from .sequence import clean_sequence
from .pdb_utils import read_chain

log = logging.getLogger("bindsite")
client_log = logging.getLogger("bindsite.client")


class PredictRequest(BaseModel):
    sequence: str
    binding_type: Literal["metal", "nuclear", "small"]


class PredictPdbRequest(BaseModel):
    pdb: str
    binding_type: Literal["metal", "nuclear", "small"]


class ClientLogEntry(BaseModel):
    level: Literal["error", "warning", "info"] = "error"
    message: str
    source: str | None = None
    url: str | None = None
    stack: str | None = None
    context: dict | None = None


@dataclass
class AppState:
    settings: Settings
    started: str
    components: dict[str, dict] = field(default_factory=dict)
    manifest: dict | None = None
    model_version: str | None = None
    thresholds: dict[str, float] | None = None
    predictor: object = None
    esmfold: EsmFoldClient | None = None

    def ready(self) -> bool:
        return self.thresholds is not None and all(c["status"] != "error" for c in self.components.values())


def _startup_checks(settings: Settings, esmfold_transport: httpx.BaseTransport | None) -> AppState:
    state = AppState(settings=settings, started=datetime.now(timezone.utc).isoformat(timespec="seconds"))
    log.info("Starting BindSite backend: predictor=%s profile=%s weights=%s final_model=%s",
             settings.predictor, settings.profile, settings.weights_dir, settings.final_model_dir)

    try:
        state.manifest, state.model_version = model_files.load_manifest(settings.final_model_dir)
        state.thresholds = model_files.thresholds(state.manifest, settings.profile)
        state.components["manifest"] = {
            "status": "ok",
            "message": f"model_version {state.model_version[:12]}, profile '{settings.profile}', thresholds "
                       + ", ".join(f"{bt} {t:.4f}" for bt, t in state.thresholds.items()),
        }
    except Exception as exc:
        log.exception("Cannot load manifest.json from %s", settings.final_model_dir)
        state.components["manifest"] = {"status": "error", "message": f"{type(exc).__name__}: {exc}"}

    if state.manifest is not None:
        try:
            started = time.perf_counter()
            result = model_files.verify_final_model(state.manifest, settings.final_model_dir, settings.profile)
            bad = result["missing"] + result["mismatched"]
            if bad:
                log.error("final_model check failed: missing=%s mismatched=%s", result["missing"], result["mismatched"])
            state.components["final_model"] = {
                "status": "error" if bad else "ok",
                "message": (f"{len(result['missing'])} missing, {len(result['mismatched'])} mismatched: {', '.join(bad[:5])}"
                            if bad else f"{result['files_checked']} files of {result['members']} members match "
                            f"manifest checksums ({time.perf_counter() - started:.1f} s)"),
            }
        except Exception as exc:
            log.exception("final_model verification crashed")
            state.components["final_model"] = {"status": "error", "message": f"{type(exc).__name__}: {exc}"}

    for name, status in model_files.check_foundation_files(settings.weights_dir, settings.profile).items():
        state.components[f"weights: {name}"] = status
        if status["status"] != "ok":
            log.error("Foundation weights %s: %s", name, status["message"])

    state.predictor, state.components["predictor"] = create_predictor(
        settings.predictor, settings.profile, settings.weights_dir, settings.final_model_dir)

    state.esmfold = EsmFoldClient(settings.esmfold_url, settings.esmfold_timeout, settings.cache_dir, esmfold_transport)

    problems = [f"{name}: {c['message']}" for name, c in state.components.items() if c["status"] == "error"]
    if problems:
        log.error("Startup finished with %d problem(s): %s", len(problems), " | ".join(problems))
    else:
        log.info("Startup checks passed")
    return state


def create_app(settings: Settings | None = None, esmfold_transport: httpx.BaseTransport | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    apply_offline_environment(settings)
    log_file = setup_logging(settings.log_dir)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.bs = _startup_checks(settings, esmfold_transport)
        yield
        app.state.bs.esmfold.close()
        log.info("Backend stopped")

    app = FastAPI(title="BindSite backend", version="0.1.0", lifespan=lifespan)

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex[:8]
        request_id_var.set(request_id)
        request.state.request_id = request_id
        started = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            log.error("%s %s crashed after %.2f s", request.method, request.url.path, time.perf_counter() - started)
            raise
        response.headers["X-Request-ID"] = request_id
        # Failures are logged with their reason by the handlers below; this is the access line.
        log.info("%s %s -> %d (%.2f s)", request.method, request.url.path, response.status_code,
                 time.perf_counter() - started)
        return response

    def error_response(request: Request, status: int, code: str, message: str) -> JSONResponse:
        request_id = getattr(request.state, "request_id", "-")
        return JSONResponse(status_code=status, content={"detail": message, "code": code, "request_id": request_id},
                            headers={"X-Request-ID": request_id})

    @app.exception_handler(ApiError)
    async def handle_api_error(request: Request, exc: ApiError):
        # 4xx are user input problems (INFO); 5xx are system problems (WARNING, shown in /diagnostics).
        log.log(logging.WARNING if exc.status_code >= 500 else logging.INFO, "%s: %s", exc.code, exc.message)
        return error_response(request, exc.status_code, exc.code, exc.message)

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(request: Request, exc: RequestValidationError):
        messages = []
        for err in exc.errors():
            where = ".".join(str(p) for p in err.get("loc", ()) if p != "body") or "body"
            if err.get("type") == "json_invalid":
                messages.append("request body is not valid JSON")
            elif where == "binding_type":
                messages.append(f"binding_type must be one of: {', '.join(BINDING_TYPES)}")
            else:
                messages.append(f"{where}: {err.get('msg')}")
        message = "Invalid request: " + "; ".join(messages)
        log.warning(message)
        return error_response(request, 400, "REQUEST_INVALID", message)

    @app.exception_handler(Exception)
    async def handle_unexpected(request: Request, exc: Exception):
        log.error("Unhandled error on %s %s:\n%s", request.method, request.url.path,
                  "".join(traceback.format_exception(exc)))
        return error_response(request, 500, "INTERNAL_ERROR",
                              f"Internal server error ({type(exc).__name__}: {exc}). See backend log {log_file}.")

    @app.get("/health")
    def health(request: Request):
        state: AppState = request.app.state.bs
        return {
            "status": "ok" if state.ready() else "degraded",
            "model_version": state.model_version,
            "max_length": settings.max_length,
            "min_length": settings.min_length,
            "predictor": state.predictor.name,
            "mock": state.predictor.is_mock,
            "profile": settings.profile,
        }

    @app.get("/diagnostics")
    def diagnostics(request: Request):
        state: AppState = request.app.state.bs
        report_file = settings.log_dir / "environment_report.json"
        report = None
        if report_file.exists():
            try:
                report = json.loads(report_file.read_text(encoding="utf-8"))
            except Exception as exc:
                log.warning("Cannot read %s: %s", report_file, exc)
                report = {"status": "error", "message": f"Cannot read {report_file.name}: {exc}"}
        components = [{"name": name, **c} for name, c in state.components.items()]
        components.append({"name": "ESMFold API (last call)", **state.esmfold.last_call})
        return {
            "status": "ok" if state.ready() else "degraded",
            "started": state.started,
            "log_file": str(log_file),
            "components": components,
            "recent_problems": list(reversed(recent_problems.records))[:50],
            "environment_report": report,
        }

    @app.post("/predict")
    def predict(body: PredictRequest, request: Request):
        state: AppState = request.app.state.bs
        started = time.perf_counter()
        sequence = clean_sequence(body.sequence, settings.min_length, settings.max_length)
        if state.thresholds is None:
            raise PredictorUnavailable("Model manifest could not be loaded; see /diagnostics.")
        if not state.predictor.is_mock and not state.ready():
            # Corrupted/missing checkpoints or weights would give wrong numbers without any error.
            failed = ", ".join(name for name, c in state.components.items() if c["status"] == "error")
            raise PredictorUnavailable(f"Start-up checks failed ({failed}); refusing to predict. See /diagnostics.")
        threshold = state.thresholds[body.binding_type]

        fold = state.esmfold.fold(sequence)
        predict_started = time.perf_counter()
        probability = state.predictor.predict(sequence, body.binding_type, fold.pdb, threshold)
        predict_seconds = time.perf_counter() - predict_started

        binding = [p >= threshold for p in probability]
        log.info("Predicted %s for %d aa: %d binding residues (%s predictor)",
                 body.binding_type, len(sequence), sum(binding), state.predictor.name)
        return {
            "sequence": sequence,
            "length": len(sequence),
            "binding_type": body.binding_type,
            "profile": settings.profile,
            "model_version": state.model_version,
            "threshold": threshold,
            "probability": probability,
            "binding": binding,
            "binding_residues": [
                {"index": i + 1, "aa": sequence[i], "probability": probability[i]}
                for i, is_binding in enumerate(binding) if is_binding
            ],
            "structure": {"source": "esmatlas", "plddt": fold.plddt, "pdb": fold.pdb, "cached": fold.cached},
            "mock": state.predictor.is_mock,
            "timing": {
                "esmfold_s": round(fold.seconds, 3),
                "predict_s": round(predict_seconds, 3),
                "total_s": round(time.perf_counter() - started, 3),
            },
        }

    @app.post("/predict-pdb")
    def predict_pdb(body: PredictPdbRequest, request: Request):
        """Predict binding residues for an uploaded PDB structure (chain A).

        Skips ESMFold: the uploaded structure is used as-is, so the sequence and
        per-residue confidence (B-factor of CA) are read from the file.
        """
        state: AppState = request.app.state.bs
        started = time.perf_counter()

        if "ATOM" not in body.pdb:
            raise ApiError(400, "PDB_INVALID",
                           "The uploaded file has no ATOM records; it does not look like a PDB structure.")

        chain = read_chain(body.pdb, "A")
        if not chain.sequence:
            raise ApiError(400, "PDB_INVALID",
                           "The uploaded PDB has no residues in chain A. Only chain A is supported.")
        sequence = clean_sequence(chain.sequence, settings.min_length, settings.max_length)

        if state.thresholds is None:
            raise PredictorUnavailable("Model manifest could not be loaded; see /diagnostics.")
        if not state.predictor.is_mock and not state.ready():
            failed = ", ".join(name for name, c in state.components.items() if c["status"] == "error")
            raise PredictorUnavailable(f"Start-up checks failed ({failed}); refusing to predict. See /diagnostics.")
        threshold = state.thresholds[body.binding_type]

        predict_started = time.perf_counter()
        probability = state.predictor.predict(sequence, body.binding_type, body.pdb, threshold)
        predict_seconds = time.perf_counter() - predict_started

        binding = [p >= threshold for p in probability]
        plddt = chain.plddt
        if plddt and max(plddt) > 1.0:
            # ESMFold/AlphaFold-style B-factors are pLDDT on a 0-100 scale; rescale for display.
            plddt = [p / 100.0 for p in plddt]

        log.info("Predicted %s for uploaded PDB (%d aa): %d binding residues (%s predictor)",
                 body.binding_type, len(sequence), sum(binding), state.predictor.name)
        return {
            "sequence": sequence,
            "length": len(sequence),
            "binding_type": body.binding_type,
            "profile": settings.profile,
            "model_version": state.model_version,
            "threshold": threshold,
            "probability": probability,
            "binding": binding,
            "binding_residues": [
                {"index": i + 1, "aa": sequence[i], "probability": probability[i]}
                for i, is_binding in enumerate(binding) if is_binding
            ],
            "structure": {"source": "upload", "plddt": plddt, "pdb": body.pdb, "cached": False},
            "mock": state.predictor.is_mock,
            "timing": {
                "esmfold_s": 0,
                "predict_s": round(predict_seconds, 3),
                "total_s": round(time.perf_counter() - started, 3),
            },
        }

    @app.post("/client-log", status_code=204)
    def receive_client_log(entry: ClientLogEntry):
        level = {"error": logging.ERROR, "warning": logging.WARNING, "info": logging.INFO}[entry.level]
        parts = [entry.message[:2000]]
        if entry.source:
            parts.append(f"source={entry.source[:200]}")
        if entry.url:
            parts.append(f"url={entry.url[:500]}")
        if entry.context:
            parts.append(f"context={json.dumps(entry.context, default=str)[:2000]}")
        if entry.stack:
            parts.append("stack:\n" + entry.stack[:6000])
        client_log.log(level, " | ".join(parts))
        return Response(status_code=204)

    return app
