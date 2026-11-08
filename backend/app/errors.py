"""Errors returned to the UI as JSON: {"detail": ..., "code": ..., "request_id": ...}."""


class ApiError(Exception):
    def __init__(self, status_code: int, code: str, message: str, extra: dict | None = None):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.extra = extra or {}  # more fields of the JSON body


class SequenceError(ApiError):
    def __init__(self, message: str, too_long: bool = False):
        super().__init__(413 if too_long else 400, "SEQUENCE_TOO_LONG" if too_long else "SEQUENCE_INVALID", message)


class EsmFoldError(ApiError):
    def __init__(self, message: str):
        super().__init__(502, "ESMFOLD_FAILED", message)


class StructureUnavailable(EsmFoldError):
    """No structure source could give a structure (not precomputed, API failed or too long, no free GPU).
    The UI answers it by offering the PDB upload."""

    def __init__(self, message: str):
        super().__init__(message)
        self.code = "STRUCTURE_UNAVAILABLE"


class StructureFolding(ApiError):
    """Local ESMFold on the CPU is folding this sequence in the background (minutes): not an error. HTTP 202 with
    {"folding": {...}}; the UI sends the same request again until the structure is there (then it is cached)."""

    def __init__(self, message: str, folding: dict):
        super().__init__(202, "STRUCTURE_FOLDING", message, {"folding": folding})


class PredictorUnavailable(ApiError):
    def __init__(self, message: str):
        super().__init__(503, "PREDICTOR_UNAVAILABLE", message)


class PredictorFailed(ApiError):
    def __init__(self, message: str):
        super().__init__(500, "PREDICTOR_FAILED", message)
