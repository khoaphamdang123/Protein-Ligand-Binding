"""Errors returned to the UI as JSON: {"detail": ..., "code": ..., "request_id": ...}."""


class ApiError(Exception):
    def __init__(self, status_code: int, code: str, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


class SequenceError(ApiError):
    def __init__(self, message: str, too_long: bool = False):
        super().__init__(413 if too_long else 400, "SEQUENCE_TOO_LONG" if too_long else "SEQUENCE_INVALID", message)


class EsmFoldError(ApiError):
    def __init__(self, message: str):
        super().__init__(502, "ESMFOLD_FAILED", message)


class PredictorUnavailable(ApiError):
    def __init__(self, message: str):
        super().__init__(503, "PREDICTOR_UNAVAILABLE", message)


class PredictorFailed(ApiError):
    def __init__(self, message: str):
        super().__init__(500, "PREDICTOR_FAILED", message)
