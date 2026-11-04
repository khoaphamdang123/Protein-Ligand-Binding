"""Per-residue binding probabilities.

- PbindPredictor: the real AdaBind models through `pbind.predict` (delivered by the model team).
- MockPredictor: synthetic probabilities in the same format, so the app works end to end before
  pbind exists. Every response it produces is flagged `"mock": true`.
"""
import hashlib
import logging
import math
from pathlib import Path

import numpy as np

from .errors import PredictorFailed, PredictorUnavailable

log = logging.getLogger("bindsite.predictor")

# Residues that typically line each site, used only to make mock output look plausible.
_MOCK_PROPENSITY = {
    "metal": {"C": 1.0, "H": 1.0, "D": 0.7, "E": 0.6},
    "nuclear": {"R": 1.0, "K": 1.0, "H": 0.5, "N": 0.4, "S": 0.35, "T": 0.35, "Y": 0.4, "G": 0.3, "Q": 0.3},
    "small": {"W": 0.9, "F": 0.8, "Y": 0.8, "H": 0.7, "C": 0.6, "M": 0.6, "L": 0.5, "I": 0.5, "V": 0.4, "G": 0.4},
}
# Fraction of residues the mock marks as binding (close to the class frequencies in DevSet1010).
_MOCK_POSITIVE_FRACTION = {"metal": 0.02, "nuclear": 0.04, "small": 0.06}


class MockPredictor:
    name = "mock"
    is_mock = True

    def predict(self, sequence: str, binding_type: str, pdb: str, threshold: float) -> list[float]:
        seed = int.from_bytes(hashlib.sha1(f"{binding_type}:{sequence}".encode()).digest()[:8], "little")
        rng = np.random.default_rng(seed)
        propensity = _MOCK_PROPENSITY[binding_type]

        score = np.array([propensity.get(aa, 0.0) for aa in sequence]) + rng.normal(0.0, 0.35, len(sequence))
        score = np.convolve(score, [0.25, 0.5, 0.25], mode="same")  # binding sites are local patches

        # Logistic curve whose midpoint (p = threshold) sits at the chosen positive fraction.
        cut = np.quantile(score, 1.0 - _MOCK_POSITIVE_FRACTION[binding_type])
        offset = math.log(threshold / (1.0 - threshold))
        probability = 1.0 / (1.0 + np.exp(-(8.0 * (score - cut) + offset)))
        return [float(p) for p in probability]


class PbindPredictor:
    name = "pbind"
    is_mock = False

    def __init__(self, profile: str, weights_dir: Path, final_model_dir: Path):
        from pbind import predict  # ImportError is reported by create_predictor

        self._predict = predict
        self.profile = profile
        self.weights_dir = weights_dir
        self.final_model_dir = final_model_dir

    def predict(self, sequence: str, binding_type: str, pdb: str, threshold: float) -> list[float]:
        try:
            result = self._predict(
                sequence, binding_type=binding_type, pdb=pdb, profile=self.profile,
                weights_dir=str(self.weights_dir), final_model_dir=str(self.final_model_dir),
            )
        except Exception as exc:
            log.exception("pbind.predict failed for %s (%d aa)", binding_type, len(sequence))
            raise PredictorFailed(f"pbind.predict failed: {type(exc).__name__}: {exc}") from exc

        probability = [float(p) for p in result["probability"]]
        problems = []
        if len(probability) != len(sequence):
            problems.append(f"{len(probability)} probabilities for {len(sequence)} residues")
        if not all(0.0 <= p <= 1.0 for p in probability):
            problems.append("probabilities outside [0, 1] or NaN")
        if "threshold" in result and abs(float(result["threshold"]) - threshold) > 1e-9:
            problems.append(f"threshold {result['threshold']} differs from manifest {threshold}")
        if problems:
            message = "pbind returned an invalid result: " + "; ".join(problems)
            log.error(message)
            raise PredictorFailed(message)
        return probability


class UnavailablePredictor:
    """Stands in when the configured predictor cannot be created; every request gets a 503."""

    is_mock = False

    def __init__(self, name: str, reason: str):
        self.name = name
        self.reason = reason

    def predict(self, sequence: str, binding_type: str, pdb: str, threshold: float) -> list[float]:
        raise PredictorUnavailable(f"Predictor '{self.name}' is not available: {self.reason}")


def create_predictor(kind: str, profile: str, weights_dir: Path, final_model_dir: Path):
    """Return (predictor, component status for /diagnostics)."""
    if kind == "mock":
        log.warning("Using the MOCK predictor: probabilities are synthetic until pbind is installed")
        return MockPredictor(), {
            "status": "warning",
            "message": "Mock predictor: probabilities are synthetic. Set BINDSITE_PREDICTOR=pbind once pbind is installed.",
        }
    if kind == "pbind":
        try:
            predictor = PbindPredictor(profile, weights_dir, final_model_dir)
        except Exception as exc:
            reason = f"cannot import pbind ({type(exc).__name__}: {exc})"
            log.exception("pbind predictor unavailable")
            return UnavailablePredictor("pbind", reason), {"status": "error", "message": reason}
        log.info("Using pbind predictor, profile %s", profile)
        return predictor, {"status": "ok", "message": f"pbind, profile '{profile}'"}

    reason = f"unknown BINDSITE_PREDICTOR '{kind}' (use 'mock' or 'pbind')"
    log.error(reason)
    return UnavailablePredictor(kind, reason), {"status": "error", "message": reason}
