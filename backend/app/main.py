"""BindSite backend. Run with:  .venv/bin/python -m uvicorn app.main:create_app --factory --port 8000

API contract: adabind/docs/APP_INTEGRATION.md section 5, with the five ligand classes of adabind
(metal, nuclear, small, dna, rna). Additive fields (not in the contract): `mock`, `timing`, `warnings`,
`structure.cached` in /predict; `predictor`, `mock`, `profile`, `min_length`, `binding_types`, `thresholds`,
`device`, `self_test` in /health. Additive endpoint: POST /predict-pdb (uploaded structure, chain A, no ESMFold).
"""
import json
import logging
import threading
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
from .config import API_MAX_LENGTH, BINDING_TYPES, LOCAL_MAX_LENGTH, Settings, apply_offline_environment
from .errors import ApiError, PredictorUnavailable
from .esmfold import EsmFoldClient
from .esmfold_local import LocalEsmFold
from .esmfold_local import self_test as esmfold_self_test
from .logging_setup import recent_problems, request_id_var, setup_logging
from .pdb_utils import read_chain
from .predictor import SelfTestFailed, create_predictor
from .sequence import clean_sequence

log = logging.getLogger("bindsite")
client_log = logging.getLogger("bindsite.client")


BindingType = Literal["metal", "nuclear", "small", "dna", "rna"]


class PredictRequest(BaseModel):
    sequence: str
    binding_type: BindingType


class PredictPdbRequest(BaseModel):
    pdb: str
    binding_type: BindingType


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

    def max_length(self) -> int:
        """Longest sequence accepted now: local ESMFold folds up to settings.max_length, the API up to 400 aa."""
        local = self.esmfold is not None and self.esmfold.local is not None
        return self.settings.max_length if local else min(self.settings.max_length, API_MAX_LENGTH)

    def structure_source(self) -> str:
        return "local ESMFold, API fallback" if self.esmfold is not None and self.esmfold.local else "ESMFold API"


def _local_esmfold_test(state: AppState) -> None:
    """Load self-hosted ESMFold and check one golden fold; on failure the API becomes the only source."""
    settings, client = state.settings, state.esmfold
    name = "ESMFold (local)"
    try:
        if (settings.golden_dir / "index.json").exists():
            result = esmfold_self_test(client.local, settings.golden_dir)
            if result["ok"]:
                state.components[name] = {"status": "ok", "message": result["message"], "details": result["details"]}
                log.info("Local ESMFold self-test passed: %s", result["message"])
                return
            reason = f"golden fold differs from the training PDB: {result['message']}"
        else:
            client.local.load()
            state.components[name] = {"status": "ok", "message": f"loaded on {client.local.device} (no golden set)"}
            return
    except Exception as exc:
        log.exception("Local ESMFold self-test crashed")
        reason = f"{type(exc).__name__}: {exc}"
    client.local = None  # never fold with a model that failed its check
    log.error("Local ESMFold disabled (%s); structures come from the ESMFold API (max %d aa)", reason, API_MAX_LENGTH)
    state.components[name] = {"status": "warning", "message": f"disabled, using the ESMFold API: {reason}"}


def _startup_self_tests(state: AppState) -> None:
    # One thread, one model at a time: the GPU is shared.
    if state.esmfold.local is not None:
        _local_esmfold_test(state)
    if "self-test" in state.components and state.components["self-test"]["status"] == "running":
        _self_test(state)


def _self_test(state: AppState) -> None:
    """Background start-up self-test of the real predictor (golden set): loads every model once."""
    settings = state.settings
    if not (settings.golden_dir / "index.json").exists():
        state.components["self-test"] = {"status": "warning",
                                         "message": f"golden set not found at {settings.golden_dir}: not run"}
        try:
            state.predictor.start_worker()
        except Exception as exc:
            log.exception("ESM-IF worker failed to start")
            state.components["self-test"] = {"status": "error", "message": f"ESM-IF worker: {exc}"}
        return
    try:
        result = state.predictor.self_test(settings.golden_dir)
        state.components["self-test"] = {"status": "ok", "message": result["message"], "details": result["details"]}
        log.info("Self-test passed: %s", result["message"])
    except SelfTestFailed as exc:
        log.error("Self-test FAILED: %s | %s", exc, exc.details)
        state.components["self-test"] = {"status": "error", "message": f"golden set mismatch: {exc}",
                                         "details": exc.details}
    except Exception as exc:
        log.exception("Self-test crashed")
        state.components["self-test"] = {"status": "error", "message": f"{type(exc).__name__}: {exc}"}


def _startup_checks(settings: Settings, esmfold_transport: httpx.BaseTransport | None,
                    esmif_worker=None, local_esmfold=None) -> AppState:
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

    local = None
    if settings.esmfold_local == "auto":
        local = local_esmfold or LocalEsmFold(settings.esmfold_dir, device=settings.device_for("esmfold"))
        state.components["ESMFold (local)"] = {
            "status": "running" if settings.warmup else "ok",
            "message": (f"loading {settings.esmfold_dir.name} on {local.device} and checking a golden fold"
                        if settings.warmup else f"{settings.esmfold_dir.name} on {local.device}, loads on first use")}
    else:
        state.components["ESMFold (local)"] = {
            "status": "warning",
            "message": f"not used ({settings.esmfold_dir} missing or BINDSITE_ESMFOLD_LOCAL=off): ESMFold API only, "
                       f"max {API_MAX_LENGTH} aa"}
    state.esmfold = EsmFoldClient(settings.esmfold_url, settings.esmfold_timeout, settings.cache_dir, esmfold_transport,
                                  attempts=settings.esmfold_attempts, backoff=settings.esmfold_backoff,
                                  total_timeout=settings.esmfold_total_timeout, local=local)

    state.predictor, state.components["predictor"] = create_predictor(settings, esmif_worker)
    if not state.predictor.is_mock and state.components["predictor"]["status"] == "ok":
        if settings.warmup:
            state.components["self-test"] = {"status": "running", "message": "loading models and checking the "
                                             "golden set (first start: ~30-60 s)"}
        else:
            state.components["self-test"] = {"status": "warning", "message": "disabled (BINDSITE_WARMUP=0): models "
                                             "load on the first request"}
    if settings.warmup:
        # In the background so the server answers /health at once; /predict waits for it (GPU lock).
        threading.Thread(target=_startup_self_tests, args=(state,), daemon=True, name="self-test").start()

    problems = [f"{name}: {c['message']}" for name, c in state.components.items() if c["status"] == "error"]
    if problems:
        log.error("Startup finished with %d problem(s): %s", len(problems), " | ".join(problems))
    else:
        log.info("Startup checks passed")
    return state


def create_app(settings: Settings | None = None, esmfold_transport: httpx.BaseTransport | None = None,
               esmif_worker=None, local_esmfold=None) -> FastAPI:
    settings = settings or Settings.from_env()
    apply_offline_environment(settings)
    log_file = setup_logging(settings.log_dir)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.bs = _startup_checks(settings, esmfold_transport, esmif_worker, local_esmfold)
        yield
        app.state.bs.esmfold.close()
        app.state.bs.predictor.close()
        log.info("Backend stopped")

    app = FastAPI(title="BindSite backend", version="0.2.0", lifespan=lifespan)

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
        self_test = state.components.get("self-test", {}).get("status")
        return {
            "status": "ok" if state.ready() else "degraded",
            "model_version": state.model_version,
            "max_length": state.max_length(),
            "min_length": settings.min_length,
            "predictor": state.predictor.name,
            "mock": state.predictor.is_mock,
            "profile": settings.profile,
            "binding_types": list(BINDING_TYPES),
            "thresholds": state.thresholds,
            "device": getattr(state.predictor, "device", None),
            "devices": settings.all_devices(),
            "structure_source": state.structure_source(),
            "esmfold_local": state.components.get("ESMFold (local)", {}).get("status"),
            "self_test": self_test,
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
        components = [{"name": name, **{k: v for k, v in c.items() if k != "details"}}
                      for name, c in state.components.items()]
        if state.esmfold.local is not None:
            components.append({"name": "ESMFold local (last fold)", **state.esmfold.last_local})
        components.append({"name": "ESMFold API (last call)", **state.esmfold.last_call})
        return {
            "status": "ok" if state.ready() else "degraded",
            "started": state.started,
            "log_file": str(log_file),
            "components": components,
            "recent_problems": list(reversed(recent_problems.records))[:50],
            "environment_report": report,
        }

    def threshold_for(state: AppState, binding_type: str) -> float:
        if state.thresholds is None:
            raise PredictorUnavailable("Model manifest could not be loaded; see /diagnostics.")
        if not state.predictor.is_mock and not state.ready():
            # Corrupted/missing checkpoints or weights would give wrong numbers without any error.
            failed = ", ".join(name for name, c in state.components.items() if c["status"] == "error")
            raise PredictorUnavailable(f"Start-up checks failed ({failed}); refusing to predict. See /diagnostics.")
        return state.thresholds[binding_type]

    def run_prediction(state: AppState, sequence: str, binding_type: str, threshold: float, pdb: str,
                       structure: dict, warnings: list[str], esmfold_seconds: float, started: float,
                       origin: str) -> dict:
        predict_started = time.perf_counter()
        prediction = state.predictor.predict(sequence, binding_type, pdb, threshold)
        probability = prediction.probability
        predict_seconds = time.perf_counter() - predict_started

        binding = [p >= threshold for p in probability]
        log.info("Predicted %s for %s (%d aa): %d binding residues (%s predictor)",
                 binding_type, origin, len(sequence), sum(binding), state.predictor.name)
        return {
            "sequence": sequence,
            "length": len(sequence),
            "binding_type": binding_type,
            "profile": settings.profile,
            "model_version": state.model_version,
            "threshold": threshold,
            "probability": probability,
            "binding": binding,
            "binding_residues": [
                {"index": i + 1, "aa": sequence[i], "probability": probability[i]}
                for i, is_binding in enumerate(binding) if is_binding
            ],
            "structure": structure,
            "mock": state.predictor.is_mock,
            "warnings": prediction.warnings + warnings,
            "timing": {
                "esmfold_s": round(esmfold_seconds, 3),
                "predict_s": round(predict_seconds, 3),
                "total_s": round(time.perf_counter() - started, 3),
                **prediction.timing,
            },
        }

    @app.post("/predict")
    def predict(body: PredictRequest, request: Request):
        state: AppState = request.app.state.bs
        started = time.perf_counter()
        sequence = clean_sequence(body.sequence, settings.min_length, state.max_length(),
                                  limit_reason=f"the structure predictor: {state.structure_source()}")
        threshold = threshold_for(state, body.binding_type)

        fold = state.esmfold.fold(sequence)
        structure = {"source": fold.source, "plddt": fold.plddt, "pdb": fold.pdb, "cached": fold.cached,
                     "fallback_reason": fold.fallback_reason}
        warnings = [f"Structure from the ESMFold API: {fold.fallback_reason}."] if fold.fallback_reason else []
        return run_prediction(state, sequence, body.binding_type, threshold, fold.pdb, structure, warnings,
                              fold.seconds, started, "sequence")

    @app.post("/predict-pdb")
    def predict_pdb(body: PredictPdbRequest, request: Request):
        """Predict binding residues for an uploaded PDB structure (chain A).

        Skips ESMFold: the uploaded structure is used as-is, so the sequence and per-residue confidence (B-factor
        of CA) are read from the file. The length limit is the one of the models (pbind: 30-1000 aa), not the one
        of the ESMFold API.
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
        sequence = clean_sequence(chain.sequence, settings.min_length, LOCAL_MAX_LENGTH,
                                  limit_reason="the AdaBind models")
        threshold = threshold_for(state, body.binding_type)

        plddt = chain.plddt
        if plddt and max(plddt) > 1.0:
            # ESMFold/AlphaFold-style B-factors are pLDDT on a 0-100 scale; rescale for display.
            plddt = [p / 100.0 for p in plddt]
        structure = {"source": "upload", "plddt": plddt, "pdb": body.pdb, "cached": False, "fallback_reason": None}
        return run_prediction(state, sequence, body.binding_type, threshold, body.pdb, structure, [], 0.0, started,
                              "uploaded PDB")

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
