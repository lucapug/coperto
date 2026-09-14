"""Domain errors and their mapping to the contract's ServiceError responses.

openapi.yaml: `code: validation` -> 422, `code: conflict` -> 409, unknown
ids -> 404. Malformed request bodies also return the ServiceError body so
every error the frontend can receive has the same shape.
"""

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .models import ErrorCode

STATUS_BY_CODE = {
    ErrorCode.validation: 422,
    ErrorCode.conflict: 409,
    ErrorCode.not_found: 404,
}


class ServiceError(Exception):
    def __init__(self, message: str, code: ErrorCode = ErrorCode.validation) -> None:
        super().__init__(message)
        self.message = message
        self.code = code


def error_response(message: str, code: ErrorCode) -> JSONResponse:
    return JSONResponse(
        status_code=STATUS_BY_CODE[code],
        content={"code": code.value, "message": message},
    )


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ServiceError)
    async def service_error_handler(_request: Request, exc: ServiceError) -> JSONResponse:
        return error_response(exc.message, exc.code)

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(
        _request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        errors = exc.errors()
        first = errors[0] if errors else {"loc": (), "msg": "Invalid request body"}
        loc = ".".join(str(part) for part in first["loc"] if part != "body")
        message = f"{loc}: {first['msg']}" if loc else str(first["msg"])
        return error_response(message, ErrorCode.validation)
