"""
Lab Storage Manager - Main FastAPI Application
"""
import logging
import re
import time
import uuid
from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, PlainTextResponse, RedirectResponse

from app.core.config import settings
from app.core.constants import (
    CSP_BASE_DIRECTIVES,
    CSP_SCRIPT_SRC_DOCS,
    CSP_SCRIPT_SRC_STRICT,
    CSP_STYLE_SRC_WITH_INLINE,
    DOCS_PATH_PREFIXES,
    HSTS_MAX_AGE_SECONDS,
    HTTPS_EXEMPT_PATHS,
    STATIC_CACHE_MAX_AGE_SECONDS,
    UPLOAD_PATHS,
)
from app.core.api_errors import API_ERROR_CODE_HEADER
from app.core.auth import (
    AUTH_ERROR_CODE_HEADER,
    decode_token,
    extract_access_token,
    resolve_current_session,
)
from app.core.banner import print_banner
from app.core.request_utils import (
    get_client_ip,
    get_request_id,
    get_sse_client_id,
    reset_current_sse_client_id,
    set_current_sse_client_id,
)
from app.core.sentry_monitoring import init_sentry
from app.core.time_utils import get_display_timezone_label
from app.database import engine, init_db
from app.api import (
    announcements,
    cart_sync,
    chem,
    chemical_name_map,
    common_shelf,
    consumable_orders,
    dashboard,
    error_logs,
    events,
    inventory,
    procedure_inventory_search,
    reagent_brands,
    reagent_orders,
    search_completions,
    user_logs,
    user_sessions,
    users,
)
from app.services import chemical_info
from app.services.archive_scheduler import start_archive_scheduler, stop_archive_scheduler
from app.services.cache_reset_service import apply_startup_cache_reset_if_needed
from app.services.error_logger import log_error
from app.services.inventory_import_preview_sessions import cleanup_expired_inventory_import_preview_artifacts
from app.services.log_queue import get_request_logger, initialize_async_file_logging, shutdown_async_file_logging
from app.services.rate_limit import enforce_rate_limit
from app.services.search_query_log_service import stop_search_query_log_worker, start_search_query_log_worker
from app.services.sse_manager import sse_manager
from app.services.structure_index import structure_index
from app.search_query_log_db import init_query_log_db
from app.search_completion_db import TARGET_ENDPOINTS, init_search_completion_db
from app.services.search_completion_entity_index import rebuild_completion_entity_index_if_stale
from sqlmodel import Session


LOGIN_PATH = "/login"
ROBOTS_PATH = "/robots.txt"
HEALTH_PATH = "/health"
UNAUTH_REDIRECT_EXEMPT_PATHS = {LOGIN_PATH, ROBOTS_PATH, HEALTH_PATH}
CLI_CLIENT_NAME = "cli"
CLI_ALLOWED_USER_PATHS = {
    "/api/users/login/token",
    "/api/users/logout",
    "/api/users/me",
}
CLI_ALLOWED_ROUTE_PATTERNS: tuple[tuple[str, str], ...] = (
    ("POST", r"^/api/users/login/token$"),
    ("POST", r"^/api/users/logout$"),
    ("GET", r"^/api/users/me$"),
    ("GET", r"^/api/inventory/$"),
    ("GET", r"^/api/inventory/\d+$"),
    ("PUT", r"^/api/inventory/\d+$"),
    ("GET", r"^/api/inventory/cas/[^/]+$"),
    ("GET", r"^/api/inventory/code/[^/]+$"),
    ("GET", r"^/api/inventory/dashboard/my-borrows$"),
    ("GET", r"^/api/inventory/dashboard/pending-stockin$"),
    ("POST", r"^/api/inventory/\d+/borrow$"),
    ("POST", r"^/api/inventory/\d+/return$"),
    ("GET", r"^/api/inventory/\d+/borrow-history$"),
    ("POST", r"^/api/inventory/manual-add$"),
    ("GET", r"^/api/reagent-orders/$"),
    ("POST", r"^/api/reagent-orders/$"),
    ("GET", r"^/api/reagent-orders/\d+$"),
    ("PUT", r"^/api/reagent-orders/\d+$"),
    ("GET", r"^/api/reagent-orders/cas-overview/[^/]+$"),
    ("GET", r"^/api/reagent-orders/dashboard/my-reagent-orders$"),
    ("POST", r"^/api/reagent-orders/\d+/confirm-arrival$"),
    ("POST", r"^/api/reagent-orders/\d+/stock-in$"),
    ("GET", r"^/api/consumable-orders/$"),
    ("POST", r"^/api/consumable-orders/$"),
    ("GET", r"^/api/consumable-orders/\d+$"),
    ("PUT", r"^/api/consumable-orders/\d+$"),
    ("GET", r"^/api/consumable-orders/dashboard/my-consumable-orders$"),
    ("POST", r"^/api/consumable-orders/\d+/complete$"),
    ("GET", r"^/api/common-shelf/groups$"),
    ("GET", r"^/api/common-shelf/groups/[A-Za-z0-9_-]+/locations$"),
    ("POST", r"^/api/common-shelf/manual-add$"),
    ("POST", r"^/api/common-shelf/groups/[A-Za-z0-9_-]+/add-bottles$"),
    ("POST", r"^/api/common-shelf/groups/[A-Za-z0-9_-]+/remove-one$"),
    ("GET", r"^/api/chemical-name-map$"),
)


def _resolve_cli_user_id(request: Request) -> int | None:
    # CLI token 可能通过 header 或 cookie 传入；这里必须和真正鉴权读取的 token 来源保持一致。
    token = extract_access_token(request)
    if not token:
        return None
    try:
        payload = decode_token(token)
    except HTTPException:
        return None
    if payload.get("client") != CLI_CLIENT_NAME:
        return None
    try:
        return int(payload.get("sub"))
    except (TypeError, ValueError):
        return None


def _matches_cli_allowed_route(request: Request) -> bool:
    method = request.method.upper()
    path = request.url.path
    for allowed_method, pattern in CLI_ALLOWED_ROUTE_PATTERNS:
        if method != allowed_method:
            continue
        if re.match(pattern, path):
            return True
    return False


def _is_cli_blocked_request(request: Request) -> bool:
    # CLI 只开放命令层真正需要的 API；新路由默认关闭，避免能力范围悄悄漂移。
    if request.url.path.startswith("/api/users") and request.url.path not in CLI_ALLOWED_USER_PATHS:
        return True
    if not _matches_cli_allowed_route(request):
        return True
    # 文件上传会把 agent 输入扩大成文件系统读写，先统一禁用，后续按场景单独放开。
    content_type = request.headers.get("content-type", "").lower()
    if "multipart/form-data" in content_type:
        return True
    return False


def _get_log_level() -> int:
    """Return runtime log level with quieter defaults for production-like environments."""
    if settings.use_secure_runtime():
        return logging.WARNING
    if settings.debug:
        return logging.DEBUG
    return logging.INFO


# 配置日志
logging.basicConfig(
    level=_get_log_level(),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)
init_sentry()

if settings.use_secure_runtime():
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
else:
    logging.getLogger("uvicorn.access").setLevel(logging.INFO)


def _sanitize_path_for_log(path: str) -> str:
    """Mask likely identifiers in URL path for safer request logs."""
    masked_segments: list[str] = []
    for segment in path.split("/"):
        if not segment:
            masked_segments.append(segment)
            continue

        # 脱敏数字 ID 和较长的 token/UUID 段。
        if segment.isdigit() or (len(segment) >= 16 and any(char.isdigit() for char in segment)):
            masked_segments.append("{id}")
            continue

        masked_segments.append(segment)

    return "/".join(masked_segments)


def _resolve_request_log_path(request: Request) -> str:
    """Prefer route template (e.g. /users/{user_id}) over raw URL path."""
    route = request.scope.get("route")
    route_path = getattr(route, "path", None)
    if isinstance(route_path, str) and route_path:
        return route_path
    return _sanitize_path_for_log(request.url.path)

def _build_content_security_policy(path: str | None) -> str:
    """Build a route-aware CSP so API responses stay strict without breaking docs UI."""
    normalized_path = path or ""
    if normalized_path in set(DOCS_PATH_PREFIXES) or normalized_path.startswith("/docs/"):
        return (
            f"default-src {CSP_BASE_DIRECTIVES['default-src']}; "
            f"base-uri {CSP_BASE_DIRECTIVES['base-uri']}; "
            f"object-src {CSP_BASE_DIRECTIVES['object-src']}; "
            f"frame-ancestors {CSP_BASE_DIRECTIVES['frame-ancestors']}; "
            f"img-src {CSP_BASE_DIRECTIVES['img-src']}; "
            f"style-src {CSP_STYLE_SRC_WITH_INLINE}; "
            f"script-src {CSP_SCRIPT_SRC_DOCS}"
        )

    return (
        f"default-src {CSP_BASE_DIRECTIVES['default-src']}; "
        f"base-uri {CSP_BASE_DIRECTIVES['base-uri']}; "
        f"object-src {CSP_BASE_DIRECTIVES['object-src']}; "
        f"frame-ancestors {CSP_BASE_DIRECTIVES['frame-ancestors']}; "
        f"img-src {CSP_BASE_DIRECTIVES['img-src']}; "
        f"style-src {CSP_STYLE_SRC_WITH_INLINE}; "
        f"script-src {CSP_SCRIPT_SRC_STRICT}"
    )


def _apply_security_headers(response, path: str | None = None) -> None:
    """Apply baseline security headers for all responses."""
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["X-Robots-Tag"] = "noindex, nofollow, noarchive, nosnippet, noimageindex"
    response.headers["Content-Security-Policy"] = _build_content_security_policy(path)
    if settings.use_secure_runtime():
        response.headers["Strict-Transport-Security"] = f"max-age={HSTS_MAX_AGE_SECONDS}; includeSubDomains"


def _is_trusted_web_origin(origin: str | None, fallback_origin: str) -> bool:
    """Validate request origin/referrer against configured trusted origins."""
    if not origin:
        return False

    parsed = urlparse(origin)
    if not parsed.scheme or not parsed.netloc:
        return False

    normalized = f"{parsed.scheme}://{parsed.netloc}".rstrip("/")
    trusted = set(settings.cors_origins)
    trusted.add(fallback_origin.rstrip("/"))
    return normalized in trusted


def _apply_trusted_origin_cors_headers(response: Response, request: Request) -> None:
    """Attach CORS headers to error responses for already trusted frontend origins."""
    origin = request.headers.get("origin")
    fallback_origin = str(request.base_url).rstrip("/")
    if not _is_trusted_web_origin(origin, fallback_origin):
        return

    parsed = urlparse(origin or "")
    normalized_origin = f"{parsed.scheme}://{parsed.netloc}".rstrip("/")
    response.headers["Access-Control-Allow-Origin"] = normalized_origin
    response.headers["Access-Control-Allow-Credentials"] = "true"

    vary = response.headers.get("Vary")
    if not vary:
        response.headers["Vary"] = "Origin"
    elif "origin" not in {value.strip().lower() for value in vary.split(",")}:
        response.headers["Vary"] = f"{vary}, Origin"


def _is_upload_request(path: str) -> bool:
    return path in UPLOAD_PATHS or (path.startswith("/api/users/") and path.endswith("/avatar"))


def _get_forwarded_proto(request) -> str:
    """Read proxy scheme only when proxy headers are explicitly trusted."""
    if not settings.trust_proxy_headers:
        return ""
    return request.headers.get("x-forwarded-proto", "").lower()


def _should_skip_https_redirect(path: str) -> bool:
    return path in HTTPS_EXEMPT_PATHS


def _get_frontend_origin(request: Request) -> str:
    if settings.cors_origins:
        return settings.cors_origins[0].rstrip("/")
    return str(request.base_url).rstrip("/")


def _build_login_redirect_url(request: Request) -> str:
    return f"{_get_frontend_origin(request)}{LOGIN_PATH}"


def _should_bypass_unauth_redirect(path: str) -> bool:
    if path.startswith("/api"):
        return True
    return path in UNAUTH_REDIRECT_EXEMPT_PATHS


def _is_authenticated_request(request: Request) -> bool:
    with Session(engine) as db:
        resolve_current_session(request=request, background_tasks=None, db=db)
    return True


class CachedStaticFiles(StaticFiles):
    """Custom static files with caching headers for images"""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

    async def get_response(self, path: str, scope):
        """Override to add cache headers for static files"""
        response = await super().get_response(path, scope)

        # 为静态文件添加缓存头。
        response.headers["Cache-Control"] = f"public, max-age={STATIC_CACHE_MAX_AGE_SECONDS}, immutable"
        _apply_security_headers(response, scope.get("path"))

        return response


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler - startup and shutdown events"""
    logger.info("Starting %s v%s", settings.app_name, settings.app_version)
    initialize_async_file_logging()
    cleanup_expired_inventory_import_preview_artifacts()
    init_db()
    init_query_log_db()
    init_search_completion_db()
    if settings.chem_structure_feature_enabled:
        with Session(engine) as db:
            structure_index.rebuild(db)
        logger.info("Structure index rebuilt on startup")
    with Session(engine) as db:
        for ep in TARGET_ENDPOINTS:
            rebuild_completion_entity_index_if_stale(db, ep)
    start_search_query_log_worker()
    start_archive_scheduler()
    logger.info("Database initialized (WAL mode enabled)")
    try:
        cache_reset_result = apply_startup_cache_reset_if_needed()
        if cache_reset_result.applied:
            logger.info(
                "Startup cache reset applied for cache version %s",
                cache_reset_result.current_version,
            )
    except Exception:
        logger.exception("Startup cache reset failed; continue without version-based reset")
    print_banner()
    yield
    await stop_archive_scheduler()
    stop_search_query_log_worker()
    shutdown_async_file_logging()
    await sse_manager.stop_listener()
    logger.info("Shutting down...")


# 创建 FastAPI 应用
app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="Laboratory Inventory Management System (LIMS)",
    lifespan=lifespan,
    docs_url=None if settings.use_secure_runtime() else "/docs",
    redoc_url=None if settings.use_secure_runtime() else "/redoc",
    openapi_url=None if settings.use_secure_runtime() else "/openapi.json",
)


@app.middleware("http")
async def sse_client_context_middleware(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    """Expose current request's SSE client id to downstream broadcast code."""
    token = set_current_sse_client_id(get_sse_client_id(request))
    try:
        return await call_next(request)
    finally:
        reset_current_sse_client_id(token)


@app.middleware("http")
async def request_logging_middleware(request: Request, call_next):
    """Add request id and structured request logs with route/path sanitization."""
    request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    request.state.request_id = request_id
    started = time.perf_counter()
    request_logger = get_request_logger()

    try:
        response = await call_next(request)
    except Exception:
        duration_ms = (time.perf_counter() - started) * 1000
        request_logger.exception(
            "request_error request_id=%s method=%s path=%s client_ip=%s duration_ms=%.2f",
            request_id,
            request.method,
            _resolve_request_log_path(request),
            get_client_ip(request),
            duration_ms,
        )
        raise

    duration_ms = (time.perf_counter() - started) * 1000
    status = response.status_code
    log_level = logging.INFO
    if status >= 500:
        log_level = logging.ERROR
    elif status >= 400:
        log_level = logging.WARNING

    request_logger.log(
        log_level,
        "request request_id=%s method=%s path=%s status=%s client_ip=%s duration_ms=%.2f",
        request_id,
        request.method,
        _resolve_request_log_path(request),
        status,
        get_client_ip(request),
        duration_ms,
    )
    response.headers["X-Request-ID"] = request_id
    return response


@app.middleware("http")
async def upload_request_size_middleware(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    """Reject clearly oversized upload requests before route handling."""
    if request.method == "POST" and _is_upload_request(request.url.path):
        content_length = request.headers.get("content-length")
        if content_length:
            try:
                size = int(content_length)
            except ValueError:
                return JSONResponse(status_code=400, content={"detail": "Invalid Content-Length header"})

            max_bytes = settings.max_upload_request_size_mb * 1024 * 1024
            if size > max_bytes:
                return JSONResponse(
                    status_code=413,
                    content={"detail": f"Upload request exceeds {settings.max_upload_request_size_mb}MB limit"},
                )

    return await call_next(request)


@app.middleware("http")
async def https_redirect_middleware(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    """Redirect plain HTTP to HTTPS in non-development environments."""
    if settings.use_secure_runtime():
        forwarded_proto = _get_forwarded_proto(request)
        if (
            request.url.scheme == "http"
            and forwarded_proto != "https"
            and not _should_skip_https_redirect(request.url.path)
        ):
            https_url = request.url.replace(scheme="https")
            return RedirectResponse(url=str(https_url), status_code=307)
    return await call_next(request)


@app.middleware("http")
async def login_redirect_middleware(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    """Redirect unauthenticated browser navigation and static asset requests to login."""
    path = request.url.path
    if _should_bypass_unauth_redirect(path):
        return await call_next(request)

    try:
        _is_authenticated_request(request)
    except HTTPException:
        return RedirectResponse(url=_build_login_redirect_url(request), status_code=302)

    return await call_next(request)


@app.middleware("http")
async def csrf_origin_check_middleware(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    """Protect cookie-authenticated write requests with Origin/Referer validation."""
    unsafe_methods = {"POST", "PUT", "PATCH", "DELETE"}
    if request.method in unsafe_methods and request.url.path.startswith("/api"):
        has_cookie_session = bool(request.cookies.get("access_token"))
        if has_cookie_session:
            origin = request.headers.get("origin")
            referer = request.headers.get("referer")
            fallback_origin = str(request.base_url).rstrip("/")

            origin_ok = _is_trusted_web_origin(origin, fallback_origin)
            referer_ok = _is_trusted_web_origin(referer, fallback_origin)

            if settings.use_secure_runtime() and not (origin_ok or referer_ok):
                return JSONResponse(
                    status_code=403,
                    content={"detail": "CSRF validation failed"},
                )

    return await call_next(request)


@app.middleware("http")
async def cli_guard_middleware(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    """Apply CLI-specific rate limits and block sensitive operations for CLI tokens."""
    cli_user_id = _resolve_cli_user_id(request)
    if cli_user_id is None:
        return await call_next(request)

    if _is_cli_blocked_request(request):
        return JSONResponse(
            status_code=status.HTTP_403_FORBIDDEN,
            content={"detail": "CLI token cannot access this endpoint"},
        )

    # CLI 统一按 user_id 限流，避免同一台机器上的多个普通用户互相抢额度。
    enforce_rate_limit(
        scope="cli_api",
        identifier=str(cli_user_id),
        limit=settings.cli_rate_limit_count,
        window_seconds=settings.cli_rate_limit_window_seconds,
    )
    return await call_next(request)

# CORS 中间件必须放在异常处理器之后。
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=[API_ERROR_CODE_HEADER, AUTH_ERROR_CODE_HEADER, "Retry-After"],
)


@app.middleware("http")
async def security_headers_middleware(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    """
    Attach security headers to every response, including short-circuit responses.

    Must be defined LAST (after other middlewares) to ensure it wraps all response paths
    and adds CSP/HSTS/XFO headers to upload rejection (400/413), HTTPS redirects (307),
    and CSRF failures (403).
    """
    response = await call_next(request)
    _apply_security_headers(response, request.url.path)
    return response

# 全局异常处理器需先于路由注册，用于记录 500 错误。
@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    """Global exception handler to log all unhandled errors"""
    request_id = get_request_id(request)
    log_path = _resolve_request_log_path(request)
    if settings.debug:
        log_error(
            f"Unhandled exception request_id={request_id} path={log_path}",
            exc_info=exc,
        )
        logger.exception("Unhandled exception request_id=%s path=%s", request_id, log_path)
    else:
        log_error(
            f"Unhandled exception request_id={request_id} path={log_path} error={type(exc).__name__}"
        )
        logger.error(
            "Unhandled exception request_id=%s path=%s error=%s",
            request_id,
            log_path,
            type(exc).__name__,
        )
    response = JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"}
    )
    response.headers["X-Request-ID"] = request_id
    _apply_security_headers(response, request.url.path)
    _apply_trusted_origin_cors_headers(response, request)
    return response

# 挂载带缓存策略的静态文件目录。
STATIC_DIR = Path(__file__).parent.parent / "static"
if STATIC_DIR.exists():
    app.mount("/static", CachedStaticFiles(directory=str(STATIC_DIR)), name="static")


# 注册业务路由。
app.include_router(users.router, prefix="/api")
app.include_router(user_logs.router, prefix="/api")
app.include_router(inventory.router, prefix="/api")
app.include_router(procedure_inventory_search.router, prefix="/api")
app.include_router(reagent_orders.router, prefix="/api")
app.include_router(consumable_orders.router, prefix="/api")
app.include_router(dashboard.router, prefix="/api")
app.include_router(user_sessions.router, prefix="/api/users/me")
app.include_router(cart_sync.router, prefix="/api")
app.include_router(chemical_info.router, prefix="/api")
app.include_router(announcements.router, prefix="/api")
app.include_router(error_logs.router, prefix="/api")
app.include_router(events.router, prefix="/api")
app.include_router(common_shelf.router, prefix="/api")
app.include_router(chemical_name_map.router, prefix="/api")
app.include_router(reagent_brands.router, prefix="/api")
app.include_router(chem.router, prefix="/api")
app.include_router(search_completions.router, prefix="/api")


@app.get("/")
def root():
    """Root endpoint - API information"""
    return {
        "name": settings.app_name,
        "version": settings.app_version,
        "status": "running",
        "docs": "/docs",
        "redoc": "/redoc",
    }


@app.get("/health")
def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "version": settings.app_version,
        "cache_version": settings.cache_version,
        "database": "connected",
    }


@app.get(ROBOTS_PATH)
def robots_txt() -> PlainTextResponse:
    """Disallow all crawlers from indexing any environment."""
    return PlainTextResponse("User-agent: *\nDisallow: /\n", media_type="text/plain")


@app.get("/api/runtime/cache-version")
def get_runtime_cache_version(response: Response) -> dict[str, str]:
    """Expose current cache invalidation version for frontend startup checks."""
    response.headers["Cache-Control"] = "no-store"
    return {
        "cache_version": settings.cache_version,
        "display_utc_offset": settings.display_utc_offset,
        "display_timezone": get_display_timezone_label(),
    }

# 导入模型并完成 SQLModel 表注册。
from app.models import (  # noqa: E402, F401
    Announcement,
    BorrowLog,
    ChemicalNameMap,
    CommonShelf,
    CommonShelfGroup,
    CommonShelfOperationLog,
    ConsumableOrder,
    Inventory,
    ReagentBrand,
    ReagentOrder,
    RuntimeState,
    User,
)


@app.get("/cart-import")
def cart_import_redirect(request: Request):
    """Redirect extension entry from backend origin to frontend app origin."""
    frontend_origin = settings.cors_origins[0].rstrip("/") if settings.cors_origins else str(request.base_url).rstrip("/")
    query = request.url.query
    target = f"{frontend_origin}/cart-import"
    if query:
        target = f"{target}?{query}"
    return RedirectResponse(url=target, status_code=307)
