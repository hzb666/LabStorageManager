from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlmodel import Session

from app.core.config import settings
from app.core.read_only import cli_maintenance_response, is_cli_request
from app.core.time_utils import get_display_timezone_label
from app.models.compound_structure import CompoundStructureCache
from app.models.user import User
from app.read_only.auth import (
    ReadOnlyLoginRequest,
    authenticate_user,
    get_current_user,
    revoke_request_session,
    set_auth_cookie,
    user_response,
)
from app.read_only.database import get_snapshot_db
from app.read_only.inventory import router as inventory_router
from app.read_only.snapshot import verify_snapshot
from app.services.cas_utils import normalize_cas


@asynccontextmanager
async def lifespan(application: FastAPI):
    application.state.snapshot_metadata = verify_snapshot()
    yield


app = FastAPI(
    title=f"{settings.app_name} - Inventory Read Only",
    version=settings.app_version,
    docs_url=None if settings.use_secure_runtime() else "/docs",
    redoc_url=None if settings.use_secure_runtime() else "/redoc",
    openapi_url=None if settings.use_secure_runtime() else "/openapi.json",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Request-ID", "X-Skip-Auth-Invalidation"],
)


@app.middleware("http")
async def enforce_read_only_surface(request: Request, call_next):
    if request.url.path.startswith("/api/") and is_cli_request(request):
        return cli_maintenance_response()
    if (
        request.url.path.startswith("/api/")
        and request.method not in {"GET", "HEAD", "OPTIONS"}
        and request.url.path not in {"/api/users/login", "/api/users/logout"}
    ):
        return JSONResponse(
            status_code=503,
            content={"detail": "系统维护中，仅开放库存查询", "code": "INVENTORY_READ_ONLY"},
        )
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    return response


@app.get("/health")
def health(request: Request):
    metadata = request.app.state.snapshot_metadata
    return {
        "status": "healthy",
        "mode": "inventory_read_only",
        "snapshot_id": metadata.snapshot_id,
        "snapshot_created_at": metadata.created_at,
    }


@app.get("/api/runtime/cache-version")
def runtime_configuration(request: Request, response: Response):
    metadata = request.app.state.snapshot_metadata
    response.headers["Cache-Control"] = "no-store"
    return {
        "cache_version": settings.cache_version,
        "maintenance_mode": False,
        "inventory_read_only": True,
        "snapshot_created_at": metadata.created_at,
        "display_utc_offset": settings.display_utc_offset,
        "display_timezone": get_display_timezone_label(),
    }


@app.post("/api/users/login")
def login(
    body: ReadOnlyLoginRequest,
    request: Request,
    db: Annotated[Session, Depends(get_snapshot_db)],
):
    metadata = request.app.state.snapshot_metadata
    revoke_request_session(request, metadata)
    user, token = authenticate_user(body, request, metadata, db)
    response = JSONResponse({
        "token_type": "bearer",
        "user": user_response(user),
        "redis_warning": None,
    })
    set_auth_cookie(response, token)
    return response


@app.post("/api/users/logout")
def logout(request: Request):
    revoke_request_session(request, request.app.state.snapshot_metadata)
    response = JSONResponse({"message": "Logged out successfully"})
    response.delete_cookie(
        "access_token",
        path="/",
        secure=settings.use_secure_runtime(),
        httponly=True,
        samesite="lax",
    )
    return response


@app.get("/api/users/me")
def current_user(user: Annotated[User, Depends(get_current_user)]):
    return user_response(user)


@app.get("/api/chemical-info/{cas_number}")
def cached_chemical_info(
    cas_number: str,
    _user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_snapshot_db)],
):
    normalized = normalize_cas(cas_number)
    cached = db.get(CompoundStructureCache, normalized)
    return {
        "cas_number": normalized,
        "name": cached.chinese_name if cached else None,
        "english_name": cached.english_name if cached else None,
        "warning": cached.name_error_message if cached else None,
        "smiles": (
            cached.smiles_isomeric or cached.smiles_canonical
            if cached
            else None
        ),
        "chinese_name_is_translated": (
            cached.chinese_name_is_translated if cached else False
        ),
    }


app.include_router(inventory_router, prefix="/api")
