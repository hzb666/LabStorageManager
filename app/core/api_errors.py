"""Stable API error codes shared by backend response helpers."""

from collections.abc import Mapping

from fastapi import HTTPException


API_ERROR_CODE_HEADER = "X-Error-Code"


class ApiErrorCode:
    INVALID_SORT_FIELD = "INVALID_SORT_FIELD"
    STRUCTURE_SEARCH_EXPIRED = "STRUCTURE_SEARCH_EXPIRED"
    STRUCTURE_FILTER_INCOMPLETE = "STRUCTURE_FILTER_INCOMPLETE"
    INVENTORY_CODE_CONFLICT = "INVENTORY_CODE_CONFLICT"
    COMMON_SHELF_GROUP_CONFLICT = "COMMON_SHELF_GROUP_CONFLICT"
    COMMON_SHELF_CODE_CONFLICT = "COMMON_SHELF_CODE_CONFLICT"
    EXPORT_RATE_LIMITED = "EXPORT_RATE_LIMITED"
    LLM_DISABLED = "LLM_DISABLED"
    LLM_API_NOT_CONFIGURED = "LLM_API_NOT_CONFIGURED"
    LLM_MODEL_NOT_CONFIGURED = "LLM_MODEL_NOT_CONFIGURED"
    LLM_INVALID_JSON = "LLM_INVALID_JSON"
    LLM_REQUEST_TIMEOUT = "LLM_REQUEST_TIMEOUT"
    LLM_REQUEST_FAILED = "LLM_REQUEST_FAILED"
    LLM_RESPONSE_INVALID = "LLM_RESPONSE_INVALID"
    LLM_RESPONSE_FORMAT_CONFIG_INVALID = "LLM_RESPONSE_FORMAT_CONFIG_INVALID"
    LLM_RESPONSE_TRUNCATED = "LLM_RESPONSE_TRUNCATED"
    PROCEDURE_SEARCH_RATE_LIMITED = "PROCEDURE_SEARCH_RATE_LIMITED"


def api_error(
    *,
    status_code: int,
    detail: str,
    code: str,
    headers: Mapping[str, str] | None = None,
) -> HTTPException:
    """Build a backward-compatible HTTP error with a stable machine-readable code."""

    response_headers = dict(headers or {})
    response_headers[API_ERROR_CODE_HEADER] = code
    return HTTPException(status_code=status_code, detail=detail, headers=response_headers)
