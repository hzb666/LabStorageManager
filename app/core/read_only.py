import re

from fastapi import Request
from fastapi.responses import JSONResponse

from app.core.config import settings

CLI_MAINTENANCE_CODE = "CLI_DISABLED_DURING_MAINTENANCE"
CLI_MAINTENANCE_MESSAGE = "系统维护中，CLI 暂不可用，请稍后再试"


_READ_PATHS = (
    re.compile(r"/api/inventory/?"),
    re.compile(r"/api/inventory/export"),
    re.compile(r"/api/inventory/[0-9]+"),
    re.compile(r"/api/inventory/code/[^/]+"),
    re.compile(r"/api/chemical-info/[^/]+"),
)
_AUTH_PATHS = {"/api/users/login", "/api/users/login/token", "/api/users/logout"}
_SYSTEM_PATHS = {
    "/api/users/me", "/api/runtime/cache-version",
}


def is_cli_request(request: Request) -> bool:
    client_marker = request.headers.get("X-LSM-Client", "").strip().casefold()
    user_agent = request.headers.get("User-Agent", "").strip().casefold()
    return client_marker == "cli" or user_agent.startswith("labstoragemanager cli")


def cli_maintenance_response() -> JSONResponse:
    return JSONResponse(
        status_code=503,
        content={"detail": CLI_MAINTENANCE_MESSAGE, "code": CLI_MAINTENANCE_CODE},
    )


def is_read_only_request_allowed(method: str, path: str) -> bool:
    if method == "OPTIONS" or not (path == "/api" or path.startswith("/api/")):
        return True
    if method == "POST" and path in _AUTH_PATHS:
        return True
    if method not in {"GET", "HEAD"}:
        return False
    return path in _SYSTEM_PATHS or any(pattern.fullmatch(path) for pattern in _READ_PATHS)


async def inventory_read_only_middleware(request: Request, call_next):
    if (
        settings.maintenance_mode in {"on", "full"}
        and request.url.path.startswith("/api/")
        and is_cli_request(request)
    ):
        return cli_maintenance_response()

    structure_query = request.url.path.startswith("/api/inventory") and any(
        request.query_params.get(key)
        for key in (
            "structure_query",
            "structure_search_id",
            "structure_match_mode",
            "structure_query_format",
            "structure_only_in_stock",
        )
    )
    if settings.inventory_read_only and (
        structure_query or not is_read_only_request_allowed(request.method, request.url.path)
    ):
        return JSONResponse(
            status_code=503,
            content={"detail": "系统维护中，仅开放库存查询", "code": "INVENTORY_READ_ONLY"},
        )
    return await call_next(request)
