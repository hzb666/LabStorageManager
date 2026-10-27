"""在现有 JSON 写接口外统一接入操作凭据，不改各业务处理函数。"""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.exception_handlers import http_exception_handler, request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from starlette.concurrency import run_in_threadpool
from starlette.responses import Response

from app.core.auth import get_current_user
from app.database import DBSession
from app.models.user import User
from app.services.mutation_operations import (
    OPERATION_HEADER,
    RESPONSE_HEADER,
    OperationContext,
    OperationReplay,
    finish_operation,
    operation_status,
    request_fingerprint,
    reserve_operation,
)

router = APIRouter(prefix="/mutation-operations", tags=["Mutation Operations"])
WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
BUSINESS_PREFIXES = (
    "/api/inventory", "/api/reagent-orders", "/api/consumable-orders",
    "/api/common-shelf", "/api/chemical-name-map", "/api/reagent-brands", "/api/announcements",
)


@router.get("/{operation_id}")
def get_operation_status(
    operation_id: str, db: DBSession,
    current_user: Annotated[User, Depends(get_current_user)],
    response: Response,
):
    response.headers["Cache-Control"] = "no-store"
    return operation_status(db, current_user.id, operation_id)


def supports_operation(path: str) -> bool:
    if path.startswith(BUSINESS_PREFIXES):
        return not any(part in path for part in ("/export", "/import/preview", "/upload-image", "/images/"))
    if path.startswith("/api/users"):
        return not any(part in path for part in ("/login", "/logout", "/avatar", "/sessions/refresh"))
    return path.startswith("/api/chem/structures/cache/") and path.endswith("/manual")


async def prepare_operation(
    request: Request, db: DBSession,
    current_user: Annotated[User, Depends(get_current_user)],
) -> None:
    operation_id = request.headers.get(OPERATION_HEADER)
    if not operation_id:
        return
    if request.headers.get("content-type", "application/json").split(";", 1)[0] != "application/json":
        return
    try:
        fingerprint = request_fingerprint(
            request.method, request.url.path.rstrip("/"), request.url.query, await request.body(),
        )
    except ValueError:
        return  # 保留 FastAPI 对非法请求正文的原有校验。
    request.state.mutation_operation = await run_in_threadpool(
        reserve_operation, db, current_user.id, operation_id, fingerprint,
    )


def wrap_operation_handler(handler: Callable[[Request], Awaitable[Response]]):
    async def handle(request: Request) -> Response:
        response = None
        try:
            response = await handler(request)
        except OperationReplay as replay:
            return replay.response
        except HTTPException as exc:
            response = await http_exception_handler(request, exc)
        except RequestValidationError as exc:
            response = await request_validation_exception_handler(request, exc)
        finally:
            context: OperationContext | None = getattr(request.state, "mutation_operation", None)
            if context is not None:
                await run_in_threadpool(finish_operation, context, response)
        if context is not None:
            response.headers[RESPONSE_HEADER] = context.operation_id
        return response
    return handle


class MutationTrackedRoute(APIRoute):
    """通过 FastAPI 的路由扩展点注册，兼容 include_router 的延迟依赖构建。"""

    def __init__(self, path: str, endpoint: Callable, **kwargs):
        full_path = path if path.startswith("/api/") else f"/api{path}"
        self.tracks_operation = supports_operation(full_path) and bool(
            WRITE_METHODS.intersection(kwargs.get("methods") or {"GET"})
        )
        if self.tracks_operation:
            dependencies = list(kwargs.get("dependencies") or [])
            if not any(dependency.dependency is prepare_operation for dependency in dependencies):
                dependencies.append(Depends(prepare_operation))
            kwargs["dependencies"] = dependencies
        super().__init__(path, endpoint, **kwargs)

    def get_route_handler(self):
        handler = super().get_route_handler()
        return wrap_operation_handler(handler) if self.tracks_operation else handler

