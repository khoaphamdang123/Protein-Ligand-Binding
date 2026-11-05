"""Per-residue binding probabilities.

- PbindPredictor: the real LC-Bind / adabind models. One ``pbind.Predictor`` is created at start-up and kept in
  memory (ESM-2, ProtT5, the 140 checkpoints); ESM-IF runs in its own environment through ``EsmIfWorker``.
- MockPredictor: synthetic probabilities in the same format, for UI work on a machine without the models.
  Every response it produces is flagged ``"mock": true``.
"""
import hashlib
import json
import logging
import math
import tempfile
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from .config import BINDING_TYPES, Settings
from .errors import PredictorFailed, PredictorUnavailable
from .gpu import GPU_LOCK

log = logging.getLogger("bindsite.predictor")

# verify_installation.py tolerances (adabind/scripts): recomputed embedding vs training one, end-to-end probability
TOL_COSINE = 0.999
TOL_E2E_MAX = 0.03


@dataclass
class Prediction:
    probability: list[float]
    warnings: list[str] = field(default_factory=list)
    timing: dict[str, float] = field(default_factory=dict)


# ---------------------------------------------------------------------------------------------- mock
# Residues that typically line each site, used only to make mock output look plausible.
_MOCK_PROPENSITY = {
    "metal": {"C": 1.0, "H": 1.0, "D": 0.7, "E": 0.6},
    "nuclear": {"R": 1.0, "K": 1.0, "H": 0.5, "N": 0.4, "S": 0.35, "T": 0.35, "Y": 0.4, "G": 0.3, "Q": 0.3},
    "small": {"W": 0.9, "F": 0.8, "Y": 0.8, "H": 0.7, "C": 0.6, "M": 0.6, "L": 0.5, "I": 0.5, "V": 0.4, "G": 0.4},
}
_MOCK_PROPENSITY["dna"] = _MOCK_PROPENSITY["rna"] = _MOCK_PROPENSITY["nuclear"]
# Fraction of residues the mock marks as binding (close to the class frequencies in DevSet1010).
_MOCK_POSITIVE_FRACTION = {"metal": 0.02, "nuclear": 0.04, "small": 0.06, "dna": 0.04, "rna": 0.03}


class MockPredictor:
    name = "mock"
    is_mock = True

    def predict(self, sequence: str, binding_type: str, pdb: str, threshold: float) -> Prediction:
        seed = int.from_bytes(hashlib.sha1(f"{binding_type}:{sequence}".encode()).digest()[:8], "little")
        rng = np.random.default_rng(seed)
        propensity = _MOCK_PROPENSITY[binding_type]

        score = np.array([propensity.get(aa, 0.0) for aa in sequence]) + rng.normal(0.0, 0.35, len(sequence))
        score = np.convolve(score, [0.25, 0.5, 0.25], mode="same")  # binding sites are local patches

        # Logistic curve whose midpoint (p = threshold) sits at the chosen positive fraction.
        cut = np.quantile(score, 1.0 - _MOCK_POSITIVE_FRACTION[binding_type])
        offset = math.log(threshold / (1.0 - threshold))
        probability = 1.0 / (1.0 + np.exp(-(8.0 * (score - cut) + offset)))
        return Prediction([float(p) for p in probability], ["mock predictor: synthetic probabilities"])

    def close(self) -> None:
        pass


# ---------------------------------------------------------------------------------------------- pbind
class PbindPredictor:
    """``pbind.Predictor`` (adabind) + ESM-IF worker. Thread-safe: one prediction at a time (GPU_LOCK).

    Every model has its own device (Settings.device_for): ESM-2, ProtT5 and the checkpoints each run in a
    ``pbind.Predictor`` created on their device (models load lazily, so a shared instance is used when two devices
    are equal and nothing is loaded twice); ESM-IF runs in the worker on its device.
    """

    name = "pbind"
    is_mock = False
    CACHE_SIZE = 32

    def __init__(self, settings: Settings, esmif_worker=None):
        from pbind.inference.predictor import InputError, Predictor  # ImportError is reported by create_predictor

        from .esmif import EsmIfWorker

        self.settings = settings
        self.profile = settings.profile
        self._InputError = InputError
        self.devices = {k: settings.device_for(k) for k in ("esm2", "prott5", "esmif", "models")}
        instances: dict[str, Predictor] = {}

        def on(device: str) -> Predictor:
            if device not in instances:
                instances[device] = Predictor(final_model_dir=str(settings.final_model_dir),
                                              weights_dir=str(settings.weights_dir), profile=settings.profile,
                                              device=device)
            return instances[device]

        self._pred = on(self.devices["models"])        # features + the 140 checkpoints
        self._pred_esm = on(self.devices["esm2"])
        self._pred_t5 = on(self.devices["prott5"])
        self.device = str(self._pred.device)
        self._esmif = esmif_worker or EsmIfWorker(settings.esmif_python, settings.esmif_weights,
                                                  device=self.devices["esmif"], timeout=settings.esmif_timeout,
                                                  torch_home=settings.torch_home)
        self._lock = GPU_LOCK
        self._emb_cache: OrderedDict[str, dict] = OrderedDict()

    @property
    def model_version(self) -> str:
        return self._pred.model_version

    def start_worker(self) -> dict:
        return self._esmif.start()

    def close(self) -> None:
        self._esmif.close()

    # ------------------------------------------------------------------ embeddings
    def _embeddings(self, sequence: str, pdb: str, needs: tuple[str, ...], timing: dict) -> dict:
        """ESM / PROTT5 (pbind, same code as the training features) and ESMIF (worker), cached per structure."""
        from pbind.data.structures import normalize_exact_chain_A

        key = hashlib.sha1(f"{sequence}\n{pdb}".encode()).hexdigest()
        cached = self._emb_cache.get(key, {})
        self._emb_cache.pop(key, None)
        emb = dict(cached)
        for name in needs:
            if name in emb:
                timing[f"{name.lower()}_s"] = 0.0
                continue
            t0 = time.perf_counter()
            if name == "ESM":
                emb[name] = self._pred_esm.esm2(sequence)
            elif name == "PROTT5":
                emb[name] = self._pred_t5.prott5(sequence)
            elif name == "ESMIF":
                # ESM-IF reads the exact-sequence chain-A copy of the PDB, like pbind and the training features.
                with tempfile.TemporaryDirectory(prefix="bindsite_") as tmp:
                    raw, chain = Path(tmp) / "query.pdb", Path(tmp) / "query_chainA.pdb"
                    raw.write_text(pdb)
                    try:
                        normalize_exact_chain_A(raw, sequence, chain)
                    except Exception as exc:
                        raise PredictorFailed(f"no chain of the PDB matches the sequence exactly ({exc})") from exc
                    emb[name] = self._esmif.embed(chain, sequence)
            timing[f"{name.lower()}_s"] = round(time.perf_counter() - t0, 3)
        self._emb_cache[key] = emb
        while len(self._emb_cache) > self.CACHE_SIZE:
            self._emb_cache.popitem(last=False)
        return {k: emb[k] for k in needs}

    # ------------------------------------------------------------------ prediction
    def _run(self, sequence: str, binding_type: str, pdb: str, embeddings: dict | None = None) -> tuple[dict, dict]:
        timing: dict[str, float] = {}
        emb = embeddings if embeddings is not None else \
            self._embeddings(sequence, pdb, self._pred.needs(binding_type), timing)
        t0 = time.perf_counter()
        out = self._pred.predict(sequence=sequence, binding_type=binding_type, pdb=pdb, embeddings=emb,
                                 return_pdb=False)
        timing["model_s"] = round(time.perf_counter() - t0, 3)
        return out, timing

    def predict(self, sequence: str, binding_type: str, pdb: str, threshold: float) -> Prediction:
        from .esmif import EsmIfError

        with self._lock:
            try:
                out, timing = self._run(sequence, binding_type, pdb)
            except (PredictorFailed, PredictorUnavailable):
                raise
            except EsmIfError as exc:
                log.error("ESM-IF failed for %s (%d aa): %s", binding_type, len(sequence), exc)
                raise PredictorFailed(f"ESM-IF embedding failed: {exc}") from exc
            except self._InputError as exc:
                log.error("pbind rejected the input for %s (%d aa): %s", binding_type, len(sequence), exc)
                raise PredictorFailed(f"pbind rejected the input: {exc}") from exc
            except Exception as exc:
                log.exception("pbind prediction failed for %s (%d aa)", binding_type, len(sequence))
                raise PredictorFailed(f"pbind prediction failed: {type(exc).__name__}: {exc}") from exc

        probability = [float(p) for p in out["probability"]]
        problems = []
        if len(probability) != len(sequence):
            problems.append(f"{len(probability)} probabilities for {len(sequence)} residues")
        if not all(0.0 <= p <= 1.0 for p in probability):
            problems.append("probabilities outside [0, 1] or NaN")
        if abs(float(out["threshold"]) - threshold) > 1e-9:
            problems.append(f"threshold {out['threshold']} differs from manifest {threshold}")
        if out.get("binding_type") != binding_type:
            problems.append(f"pbind answered for {out.get('binding_type')!r}, asked {binding_type!r}")
        if problems:
            message = "pbind returned an invalid result: " + "; ".join(problems)
            log.error(message)
            raise PredictorFailed(message)
        log.info("pbind %s %d aa timing %s", binding_type, len(sequence), timing)
        return Prediction(probability, list(out.get("warnings", [])), timing)

    # ------------------------------------------------------------------ start-up self-test
    def self_test(self, golden_dir: Path) -> dict:
        """Start the ESM-IF worker, load every model, and check one golden protein end to end.

        Embeddings are recomputed here (ESM-2, ProtT5 on this machine, ESM-IF in the worker) from the training PDB
        and compared with the training embeddings (cosine >= 0.999); the final probabilities of metal / nuclear /
        small are compared with the golden reference of this code (``pipeline_<profile>_<task>``: same code on the
        training embeddings), max |diff| <= 0.03 as in verify_installation.py step [4]. The reference is
        ``pipeline_*`` rather than ``training_*`` because the golden set itself differs by 0.06 between the two for
        nuclear on P06956, whatever embeddings are used. dna / rna have no golden reference (the golden set
        predates them): they are run and range-checked.
        """
        with self._lock:
            t_all = time.perf_counter()
            worker = self._esmif.start()
            index = json.loads((golden_dir / "index.json").read_text())
            entry = min(index["proteins"], key=lambda e: e["length"])
            pid, seq = entry["prot_id"], entry["sequence"]
            ref = np.load(golden_dir / f"{pid}.npz")
            pdb = (golden_dir / f"{pid}.pdb").read_text()

            timing: dict[str, float] = {}
            emb = self._embeddings(seq, pdb, ("ESM", "PROTT5", "ESMIF"), timing)
            cosine = {name: _cos_min(emb[name], ref[name]) for name in emb}
            bad = [f"{n} cosine {c:.5f} < {TOL_COSINE}" for n, c in cosine.items() if c < TOL_COSINE]

            diffs, calls = {}, {}
            for task in BINDING_TYPES:
                out, _ = self._run(seq, task, pdb, embeddings=emb)
                p = np.asarray(out["probability"])
                calls[task] = int((p >= out["threshold"]).sum())
                if p.shape != (len(seq),) or not np.all((p >= 0) & (p <= 1)):
                    bad.append(f"{task}: invalid probabilities")
                key = f"pipeline_{self.profile}_{task}"
                if key in ref.files:
                    diffs[task] = float(np.abs(p - ref[key]).max())
                    if diffs[task] > TOL_E2E_MAX:
                        bad.append(f"{task}: max |p - golden| {diffs[task]:.4f} > {TOL_E2E_MAX}")
            seconds = round(time.perf_counter() - t_all, 1)
            details = {"protein": pid, "length": len(seq), "devices": self.devices, "esmif_worker": worker,
                       "embedding_min_cosine": {k: round(v, 6) for k, v in cosine.items()},
                       "max_abs_diff_vs_golden": {k: round(v, 6) for k, v in diffs.items()},
                       "binding_calls": calls, "timing": timing, "seconds": seconds}
            if bad:
                raise SelfTestFailed("; ".join(bad), details)
            devices = ", ".join(f"{k} {v}" for k, v in self.devices.items())
            message = (f"golden {pid} ({len(seq)} aa; {devices}): embeddings cosine ≥ "
                       f"{min(cosine.values()):.5f}, max |p − golden| "
                       + ", ".join(f"{k} {v:.1e}" for k, v in diffs.items())
                       + f"; dna/rna run ({seconds} s incl. model loading)")
            return {"message": message, "details": details}


class SelfTestFailed(RuntimeError):
    def __init__(self, message: str, details: dict):
        super().__init__(message)
        self.details = details


def _cos_min(a, b) -> float:
    a, b = np.asarray(a, np.float64), np.asarray(b, np.float64)
    c = (a * b).sum(1) / (np.linalg.norm(a, axis=1) * np.linalg.norm(b, axis=1) + 1e-12)
    return float(c.min())


# ---------------------------------------------------------------------------------------------- factory
class UnavailablePredictor:
    """Stands in when the configured predictor cannot be created; every request gets a 503."""

    is_mock = False

    def __init__(self, name: str, reason: str):
        self.name = name
        self.reason = reason

    def predict(self, sequence: str, binding_type: str, pdb: str, threshold: float) -> Prediction:
        raise PredictorUnavailable(f"Predictor '{self.name}' is not available: {self.reason}")

    def close(self) -> None:
        pass


def create_predictor(settings: Settings, esmif_worker=None):
    """Return (predictor, component status for /diagnostics)."""
    kind = settings.predictor
    if kind == "mock":
        log.warning("Using the MOCK predictor: probabilities are synthetic (BINDSITE_PREDICTOR=mock)")
        return MockPredictor(), {
            "status": "warning",
            "message": "Mock predictor: probabilities are synthetic. Unset BINDSITE_PREDICTOR (default pbind) "
                       "to use the real models.",
        }
    if kind == "pbind":
        try:
            predictor = PbindPredictor(settings, esmif_worker)
        except Exception as exc:
            reason = f"cannot create pbind.Predictor ({type(exc).__name__}: {exc})"
            log.exception("pbind predictor unavailable")
            return UnavailablePredictor("pbind", reason), {"status": "error", "message": reason}
        devices = ", ".join(f"{k} {v}" for k, v in predictor.devices.items())
        log.info("Using pbind predictor, profile %s, devices %s", settings.profile, devices)
        return predictor, {"status": "ok", "message": f"pbind (adabind), profile '{settings.profile}'; {devices}"}

    reason = f"unknown BINDSITE_PREDICTOR '{kind}' (use 'pbind' or 'mock')"
    log.error(reason)
    return UnavailablePredictor(kind, reason), {"status": "error", "message": reason}
