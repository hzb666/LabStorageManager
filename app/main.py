"""
Lab Storage Manager - Main FastAPI Application
"""
import logging
import time
import uuid
from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlparse

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, RedirectResponse

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
from app.core.banner import print_banner
from app.core.request_utils import (
    get_client_ip,
    get_request_id,
    get_sse_client_id,
    reset_current_sse_client_id,
    set_current_sse_client_id,
)
from app.database import init_db
from app.api import users, user_logs, inventory, reagent_orders, consumable_orders, user_sessions, cart_sync, announcements, error_logs, events
from app.services import chemical_info
from app.services.cache_reset_service import apply_startup_cache_reset_if_needed
from app.services.sse_manager import sse_manager


def _get_log_level() -> int:
    """Return runtime log level with quieter defaults for production-like environments."""
    if settings.use_secure_runtime():
        return logging.WARNING
    if settings.debug:
        return logging.DEBUG
    return logging.INFO


# Configure logging
logging.basicConfig(
    level=_get_log_level(),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

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

        # Mask numeric ids and long opaque tokens/UUID-like segments.
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


def _is_upload_request(path: str) -> bool:
    return path in UPLOAD_PATHS or (path.startswith("/api/users/") and path.endswith("/avatar"))


def _get_forwarded_proto(request) -> str:
    """Read proxy scheme only when proxy headers are explicitly trusted."""
    if not settings.trust_proxy_headers:
        return ""
    return request.headers.get("x-forwarded-proto", "").lower()


def _should_skip_https_redirect(path: str) -> bool:
    return path in HTTPS_EXEMPT_PATHS


class CachedStaticFiles(StaticFiles):
    """Custom static files with caching headers for images"""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

    async def get_response(self, path: str, scope):
        """Override to add cache headers for static files"""
        response = await super().get_response(path, scope)

        # Add cache headers for static files (images, fonts, etc.)
        response.headers["Cache-Control"] = f"public, max-age={STATIC_CACHE_MAX_AGE_SECONDS}, immutable"
        _apply_security_headers(response, scope.get("path"))

        return response


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler - startup and shutdown events"""
    logger.info("Starting %s v%s", settings.app_name, settings.app_version)
    init_db()
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
    await sse_manager.stop_listener()
    logger.info("Shutting down...")


# Create FastAPI application
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

    try:
        response = await call_next(request)
    except Exception:
        duration_ms = (time.perf_counter() - started) * 1000
        logger.exception(
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

    logger.log(
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

# CORS middleware - must be added AFTER exception handlers
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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

# Global exception handler for logging 500 errors - must be added BEFORE routes
@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    """Global exception handler to log all unhandled errors"""
    request_id = get_request_id(request)
    log_path = _resolve_request_log_path(request)
    if settings.debug:
        logger.exception("Unhandled exception request_id=%s path=%s", request_id, log_path)
    else:
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
    return response

# Mount static files with caching
STATIC_DIR = Path(__file__).parent.parent / "static"
if STATIC_DIR.exists():
    app.mount("/static", CachedStaticFiles(directory=str(STATIC_DIR)), name="static")


# Include routers
app.include_router(users.router, prefix="/api")
app.include_router(user_logs.router, prefix="/api")
app.include_router(inventory.router, prefix="/api")
app.include_router(reagent_orders.router, prefix="/api")
app.include_router(consumable_orders.router, prefix="/api")
app.include_router(user_sessions.router, prefix="/api/users/me")
app.include_router(cart_sync.router, prefix="/api")
app.include_router(chemical_info.router, prefix="/api")
app.include_router(announcements.router, prefix="/api")
app.include_router(error_logs.router, prefix="/api")
app.include_router(events.router, prefix="/api")


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


@app.get("/api/runtime/cache-version")
def get_runtime_cache_version(response: Response) -> dict[str, str]:
    """Expose current cache invalidation version for frontend startup checks."""
    response.headers["Cache-Control"] = "no-store"
    return {"cache_version": settings.cache_version}

# Import models to ensure tables are created
# This is needed for SQLModel to register all models
from app.models import User, Inventory, BorrowLog, ReagentOrder, ConsumableOrder, Announcement, RuntimeState  # noqa: E402, F401


@app.get("/cart-import")
def cart_import_redirect(request: Request):
    """Redirect extension entry from backend origin to frontend app origin."""
    frontend_origin = settings.cors_origins[0].rstrip("/") if settings.cors_origins else str(request.base_url).rstrip("/")
    query = request.url.query
    target = f"{frontend_origin}/cart-import"
    if query:
        target = f"{target}?{query}"
    return RedirectResponse(url=target, status_code=307)
