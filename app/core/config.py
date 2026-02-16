"""
Configuration settings for Lab Storage Manager
"""
import logging
import os
from functools import lru_cache
from pathlib import Path
from typing import List, Optional

from pydantic import Field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables"""
    
    # Application
    app_name: str = "Lab Storage Manager"
    app_version: str = "0.1.0"
    debug: bool = False
    env: str = "development"  # development or production
    
    # Database
    database_url: str = "sqlite:///./lab_inventory.db"
    
    # JWT Authentication
    secret_key: str = Field(default="", description="JWT secret key")
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 30 * 24 * 60  # 30 days
    
    # CORS
    cors_origins: List[str] = ["http://localhost:5173", "http://localhost:3000"]
    
    # File Upload
    max_file_size_mb: int = 10
    allowed_image_types: tuple = ("image/jpeg", "image/png", "image/webp")
    max_image_width: int = 800
    max_image_height: int = 800
    max_image_size_kb: int = 100  # Critical Rule #3: <100KB
    
    # CAS Configuration
    cas_pattern: str = r"^\d{2,7}-\d{2}-\d$"
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache()
def get_settings() -> Settings:
    """Get cached settings instance"""
    settings = Settings()
    # Validate secret_key in production
    if not settings.secret_key:
        if settings.env == "production":
            raise ValueError("SECRET_KEY must be set in production environment")
        # Use a default key only in development
        settings.secret_key = "dev-secret-key-do-not-use-in-production-12345"
    return settings


# Global settings instance
settings = get_settings()


# Paths
BASE_DIR = Path(__file__).resolve().parent.parent.parent
STATIC_DIR = BASE_DIR / "static"
UPLOADS_DIR = STATIC_DIR / "uploads"
THUMBNAILS_DIR = STATIC_DIR / "thumbnails"

# Ensure directories exist
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
THUMBNAILS_DIR.mkdir(parents=True, exist_ok=True)
