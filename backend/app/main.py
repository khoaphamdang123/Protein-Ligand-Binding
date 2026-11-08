"""BindSite backend. Run with:  .venv/bin/python -m uvicorn app.main:create_app --factory --port 8000

API contract: adabind/docs/APP_INTEGRATION.md section 5, with the five ligand classes of adabind
(metal, nuclear, small, dna, rna). Additive fields (not in the contract): `mock`, `timing`, `warnings`,
`structure.cached` in /predict; `predictor`, `mock`, `profile`, `min_length`, `binding_types`, `thresholds`,
`device`, `self_test` in /health. Additive endpoints: POST /predict-pdb (uploaded structure, chain A, no ESMFold) and
POST /compare (bindEmbed21DL and bindNode24 on the sequence and structure of a prediction).
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
from .alphafold_db import AlphaFoldDB
from .baselines import (MODELS as BASELINE_MODELS, OUTPUT_OF_LIGAND, OUTPUTS, THRESHOLD as BASELINE_THRESHOLD,
                        BaselineError, BaselinesFailed, BaselinesUnavailable, BaselineWorker)
from .config import API_MAX_LENGTH, BINDING_TYPES, LOCAL_MAX_LENGTH, Settings, apply_offline_environment
from .errors import ApiError, EsmFoldError, PredictorUnavailable
from .esmfold import EsmFoldClient, PrecomputedStructures, validate_structure
from .esmfold_local import LocalEsmFold, LocalFoldService, ca_coords
from .logging_setup import recent_problems, request_id_var, setup_logging
from .pdb_utils import read_chain, superpose
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


class CompareRequest(BaseModel):
    sequence: str
    pdb: str
    binding_type: BindingType
    alphafold: bool = True   # look the sequence up in AlphaFold DB for bindNode24 (False for an uploaded structure)
    accession: str | None = None   # UniProt accession from the FASTA header: picks that protein's own AlphaFold entry


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
    baselines: BaselineWorker | None = None
    alphafold: AlphaFoldDB | None = None

    def ready(self) -> bool:
        return self.thresholds is not None and all(c["status"] != "error" for c in self.components.values())

    def max_length(self) -> int:
        """Longest sequence accepted: the models' limit. Beyond the API's 400 aa a structure must be precomputed,
        folded locally on a free GPU, or uploaded (the fold step says which)."""
        return self.settings.max_length

    def structure_sources(self) -> dict:
        """Where structures come from, in order, with the current state of each source."""
        pre = self.esmfold.precomputed if self.esmfold else None
        local = self.esmfold.local if self.esmfold else None
        return {
            "precomputed": ({"status": "warning", "message": "not configured"} if pre is None
                            else {**pre.status, "count": pre.count}),
            "esmatlas": {"status": self.esmfold.last_call["status"] if self.esmfold else "unknown",
                         "message": f"ESM Atlas API, up to {API_MAX_LENGTH} residues", "max_length": API_MAX_LENGTH},
            "local": ({"status": "warning", "state": "off", "message": "not set up (BINDSITE_ESMFOLD_LOCAL=off or "
                       "foundation_models/esmfold_v1 missing)"} if local is None else local.status()),
        }

    def structure_source(self) -> str:
        return "precomputed ESMFold, then ESMFold API (<= 400 aa), then local ESMFold on a free GPU"

    def refresh_structure_components(self) -> None:
        # Status only: neither source can make /predict refuse to run (that is reserved for model problems).
        for name, src in (("ESMFold (precomputed)", "precomputed"), ("ESMFold (local)", "local")):
            st = self.structure_sources()[src]
            self.components[name] = {"status": "warning" if st["status"] == "error" else st["status"],
                                     "message": st["message"]}


def _startup_self_tests(state: AppState) -> None:
    # One thread, one model at a time: the GPU is shared. On the GPU, local ESMFold first, to take the room while
    # there is some; on the CPU its load + golden fold take minutes, so the prediction models come first.
    local = state.esmfold.local
    local_first = local is not None and not getattr(local, "background", False)
    if local_first:
        local.ready()  # loads now if the GPU has room ("pre-opened"); asked again on every fold
        state.refresh_structure_components()
    if "self-test" in state.components and state.components["self-test"]["status"] == "running":
        _self_test(state)
    if local is not None and not local_first:
        local.ready()
        state.refresh_structure_components()


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
                    esmif_worker=None, local_esmfold=None, baseline_worker=None,
                    alphafold_transport: httpx.BaseTransport | None = None) -> AppState:
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
        if local_esmfold is not None and hasattr(local_esmfold, "ready"):
            local = local_esmfold  # tests: a stand-in gate
        else:
            model = local_esmfold or LocalEsmFold(settings.esmfold_dir, device=settings.device_for("esmfold"))
            local = LocalFoldService(model, settings.golden_dir, settings.esmfold_min_free_gb,
                                     explicit_cpu=dict(settings.devices).get("esmfold") == "cpu")
    precomputed = None
    if settings.esmfold_files_dir is not None:
        precomputed = PrecomputedStructures(settings.esmfold_files_dir, settings.cache_dir / "esmfold_files_index.json")
        precomputed.start(background=True)
    state.esmfold = EsmFoldClient(settings.esmfold_url, settings.esmfold_timeout, settings.cache_dir, esmfold_transport,
                                  attempts=settings.esmfold_attempts, backoff=settings.esmfold_backoff,
                                  total_timeout=settings.esmfold_total_timeout, local=local, precomputed=precomputed)
    state.refresh_structure_components()
    state.baselines = baseline_worker or BaselineWorker(settings.baselines_python, settings.baselines_dir)
    if settings.alphafold_db:
        state.alphafold = AlphaFoldDB(settings.alphafold_db_url, settings.cache_dir, transport=alphafold_transport)

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
               esmif_worker=None, local_esmfold=None, baseline_worker=None,
               alphafold_transport: httpx.BaseTransport | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    apply_offline_environment(settings)
    log_file = setup_logging(settings.log_dir)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.bs = _startup_checks(settings, esmfold_transport, esmif_worker, local_esmfold, baseline_worker,
                                       alphafold_transport)
        yield
        app.state.bs.esmfold.close()
        app.state.bs.predictor.close()
        app.state.bs.baselines.close()
        if app.state.bs.alphafold:
            app.state.bs.alphafold.close()
        log.info("Backend stopped")

    app = FastAPI(title="BindSite backend", version="0.2.0", lifespan=lifespan)
    if settings.cors_origins:
        # The web page on a static host (config.json "apiBaseUrl": this server) is another origin: allow exactly the
        # origins in BINDSITE_CORS_ORIGINS (comma-separated, e.g. https://user-bindsite.static.hf.space), no cookies.
        from fastapi.middleware.cors import CORSMiddleware

        app.add_middleware(CORSMiddleware, allow_origins=list(settings.cors_origins), allow_methods=["GET", "POST"],
                           allow_headers=["Content-Type", "X-Request-ID"], expose_headers=["X-Request-ID"],
                           max_age=600)

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

    def error_response(request: Request, status: int, code: str, message: str, extra: dict | None = None) -> JSONResponse:
        request_id = getattr(request.state, "request_id", "-")
        return JSONResponse(status_code=status,
                            content={"detail": message, "code": code, "request_id": request_id, **(extra or {})},
                            headers={"X-Request-ID": request_id})

    @app.exception_handler(ApiError)
    async def handle_api_error(request: Request, exc: ApiError):
        # 2xx/4xx are progress or user input problems (INFO); 5xx are system problems (WARNING, in /diagnostics).
        log.log(logging.WARNING if exc.status_code >= 500 else logging.INFO, "%s: %s", exc.code, exc.message)
        return error_response(request, exc.status_code, exc.code, exc.message, exc.extra)

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
        state.refresh_structure_components()
        sources = state.structure_sources()
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
            "structure_sources": sources,
            "esmfold_local": sources["local"]["status"],
            "self_test": self_test,
            "compare": state.baselines.missing() is None,
            "alphafold_db": state.alphafold is not None,
        }

    @app.get("/diagnostics")
    def diagnostics(request: Request):
        state: AppState = request.app.state.bs
        state.refresh_structure_components()
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
                                  limit_reason="the AdaBind models")
        threshold = threshold_for(state, body.binding_type)

        fold = state.esmfold.fold(sequence)
        structure = {"source": fold.source, "plddt": fold.plddt, "pdb": fold.pdb, "cached": fold.cached,
                     "fallback_reason": fold.fallback_reason, "detail": fold.detail}
        warnings = [f"Structure folded by local ESMFold because {fold.fallback_reason}."] if fold.fallback_reason else []
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

    @app.post("/compare")
    def compare(body: CompareRequest, request: Request):
        """bindEmbed21DL and bindNode24 on the sequence of a prediction, with the same ProtT5 embedding.

        bindEmbed21DL uses the sequence only. bindNode24 uses a structure: the AlphaFold DB model of the sequence when
        there is one (its published setting), else the structure of the prediction. Both have one nucleic-acid output,
        shown for DNA and for RNA, and are called at the published 0.5.
        """
        state: AppState = request.app.state.bs
        started = time.perf_counter()
        problem = state.baselines.missing()
        if problem:
            raise BaselinesUnavailable(f"The comparison models are not installed: {problem}.")
        sequence = clean_sequence(body.sequence, settings.min_length, LOCAL_MAX_LENGTH,
                                  limit_reason="the AdaBind models")
        try:
            validate_structure(body.pdb, sequence)
        except EsmFoldError as exc:
            raise ApiError(400, "PDB_INVALID", f"The structure does not match the sequence: {exc.message}") from exc
        ca = ca_coords(body.pdb)
        if len(ca) != len(sequence):
            raise ApiError(400, "PDB_INVALID", f"Chain A has {len(ca)} Cα atoms for {len(sequence)} residues.")

        af_started = time.perf_counter()
        af, af_reason = None, "the structure was uploaded" if not body.alphafold else "AlphaFold DB lookup is off"
        if body.alphafold and state.alphafold is not None:
            af, af_reason = state.alphafold.lookup(sequence, body.accession)
        af_seconds = time.perf_counter() - af_started
        structure_24: dict = {"source": "same", "reason": af_reason}
        ca_24 = ca
        if af is not None:
            ca_24 = ca_coords(af.pdb)
            shown, rmsd = superpose(af.pdb, ca_24, ca)   # same frame as the other viewers; distances unchanged
            structure_24 = {"source": "alphafold_db", "entry": af.entry, "version": af.version, "created": af.created,
                            "page": af.page, "pdb": shown, "plddt": af.plddt, "rmsd": round(rmsd, 2)}

        embedding, prott5_seconds = state.predictor.prott5(sequence, body.pdb)
        models_started = time.perf_counter()
        try:
            out = state.baselines.predict(embedding, ca_24)   # bindEmbed21DL does not look at the structure
        except BaselineError as exc:
            log.error("Baseline models failed (%d aa): %s", len(sequence), exc)
            raise BaselinesFailed(str(exc)) from exc
        output = OUTPUT_OF_LIGAND[body.binding_type]
        column = OUTPUTS.index(output)
        models = {}
        for name in BASELINE_MODELS:
            probability = [float(p) for p in out[name][:, column]]
            models[name] = {"probability": probability, "binding": [p >= BASELINE_THRESHOLD for p in probability],
                            "threshold": BASELINE_THRESHOLD, "output": output}
        models["bindEmbed21DL"]["structure"] = {"source": "none"}
        models["bindNode24"]["structure"] = structure_24
        log.info("Compared %s for %d aa: %s; bindNode24 on %s", body.binding_type, len(sequence),
                 {n: sum(m["binding"]) for n, m in models.items()},
                 af.entry if af else f"the prediction's structure ({af_reason})")
        return {
            "sequence": sequence,
            "binding_type": body.binding_type,
            "models": models,
            "mock": state.predictor.is_mock,
            "timing": {"alphafold_s": round(af_seconds, 3), "prott5_s": prott5_seconds,
                       "models_s": round(time.perf_counter() - models_started, 3),
                       "total_s": round(time.perf_counter() - started, 3)},
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
