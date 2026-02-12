"""
Lab Storage Manager - Main FastAPI Application
Phase 1.1: FastAPI + SQLModel + SQLite with WAL Mode
"""
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.core.config import settings
from app.database import init_db
from app.api import users, orders, inventory


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler - startup and shutdown events"""
    # Startup
    print(f"Starting {settings.app_name} v{settings.app_version}")
    print(f"Database: WAL Mode Enabled")
    
    # Initialize database and create tables
    init_db()
    print("Database initialized successfully")
    
    yield
    
    # Shutdown
    print("Shutting down...")


# Create FastAPI application
app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="Laboratory Inventory Management System (LIMS)",
    lifespan=lifespan,
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files
STATIC_DIR = Path(__file__).parent.parent / "static"
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


# Include routers
app.include_router(users.router, prefix="/api")
app.include_router(orders.router, prefix="/api")
app.include_router(inventory.router, prefix="/api")


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
from app.models import User, Order, Inventory  # noqa: F401
