"""
Lab Storage Manager - Main FastAPI Application
"""
import logging
import traceback
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.core.banner import print_banner
from app.database import init_db
from app.api import users, user_logs, inventory, reagent_orders, consumable_orders, user_sessions, cart_sync, chemical, announcements, error_logs

# Configure logging
logging.basicConfig(
    level=logging.DEBUG if settings.debug else logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


class CachedStaticFiles(StaticFiles):
    """Custom static files with caching headers for images"""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

    async def get_response(self, path: str, scope):
        """Override to add cache headers for static files"""
        response = await super().get_response(path, scope)

        # Add cache headers for static files (images, fonts, etc.)
        # Cache for 10 years (315360000 seconds)
        response.headers["Cache-Control"] = "public, max-age=315360000, immutable"
        response.headers["X-Content-Type-Options"] = "nosniff"

        return response


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler - startup and shutdown events"""
    logger.info("Starting %s v%s", settings.app_name, settings.app_version)
    init_db()
    logger.info("Database initialized (WAL mode enabled)")
    print_banner()
    yield
    logger.info("Shutting down...")


# Create FastAPI application
app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="Laboratory Inventory Management System (LIMS)",
    lifespan=lifespan,
)

# CORS middleware - must be added AFTER exception handlers
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global exception handler for logging 500 errors - must be added BEFORE routes
@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    """Global exception handler to log all unhandled errors"""
    error_trace = traceback.format_exc()
    logger.error(f"Unhandled exception: {exc}\nTraceback: {error_trace}")
    # 生产环境只返回通用错误信息，避免泄露内部细节
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"}
    )

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
app.include_router(chemical.router, prefix="/api")
app.include_router(announcements.router, prefix="/api")
app.include_router(error_logs.router, prefix="/api")


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
        "database": "connected",
    }

# Import models to ensure tables are created
# This is needed for SQLModel to register all models
from app.models import User, Inventory, BorrowLog, ReagentOrder, ConsumableOrder, Announcement  # noqa: E402, F401
