"""
Configuration settings for Lab Storage Manager
"""
import logging
import secrets
from functools import lru_cache
from pathlib import Path
from typing import List, Optional

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings
from app.core.constants import CAS_PATTERN, RSA_KEY_SIZE_BITS, RSA_PUBLIC_EXPONENT


logger = logging.getLogger(__name__)


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
    secret_key: str = Field(default="", description="JWT secret key (for HS256 in development)")
    algorithm: str = "RS256"  # Changed from HS256 to RS256 for better security
    access_token_expire_minutes: int = 7 * 24 * 60  # 7 days
    
    # RSA Keys for RS256
    private_key_path: str = Field(default=".keys/private.pem", description="JWT private key path")
    public_key_path: str = Field(default=".keys/public.pem", description="JWT public key path")
    
    # CORS
    cors_origins: List[str] = ["http://localhost:5173", "http://localhost:3000"]
    trust_proxy_headers: bool = Field(
        default=False,
        description="Whether to trust reverse-proxy forwarding headers such as X-Forwarded-For",
    )
    
    # File Upload
    max_file_size_mb: int = 10
    max_upload_request_size_mb: int = 5
    allowed_image_types: tuple = ("image/jpeg", "image/png", "image/webp")
    max_image_width: int = 800
    max_image_height: int = 800
    max_image_size_kb: int = 100  # Critical Rule #3: <100KB
    upload_rate_limit_count: int = 10
    upload_rate_limit_window_seconds: int = 300
    
    # Default Admin
    default_admin_username: str = Field(default="admin", description="Default admin username")
    default_admin_password: str = Field(default="", description="Default admin password (set in production)")
    default_admin_full_name: str = Field(default="系统管理员", description="Default admin full name")
    
    # Session & Device Settings (IP Limit Feature)
    max_ip_per_user: int = Field(default=5, description="Max distinct IPs per user")
    max_device_per_user: int = Field(default=10, description="Max devices per user")
    session_expire_hours: int = Field(default=72, description="Session expiration hours (3 days)")
    session_strict_ip: bool = Field(default=False, description="Whether to enforce IP consistency")

    # Announcement Settings
    max_total_announcements: int = Field(default=10, description="Max announcements per admin")
    max_visible_announcements: int = Field(default=5, description="Max visible announcements per admin")
    
    # Redis Configuration (for session caching)
    redis_host: str = Field(default="localhost", description="Redis host")
    redis_port: int = Field(default=6379, description="Redis port")
    redis_db: int = Field(default=0, description="Redis database number")
    redis_password: Optional[str] = Field(default=None, description="Redis password")
    redis_key_prefix: str = Field(default="lsm", description="Redis key prefix for app namespace")
    
    # CAS Configuration
    cas_pattern: str = CAS_PATTERN
    
    # Niutrans Translation API
    niutrans_appid: str = Field(default="", description="Niutrans API appId")
    niutrans_apikey: str = Field(default="", description="Niutrans API key")
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
    
    @field_validator("algorithm")
    @classmethod
    def validate_algorithm(cls, v: str) -> str:
        """Validate JWT algorithm"""
        if v not in ["HS256", "RS256"]:
            raise ValueError("JWT algorithm must be HS256 or RS256")
        return v
    
    def get_private_key(self) -> str:
        """Load or generate RSA private key"""
        key_path = Path(self.private_key_path)
        if key_path.exists():
            return key_path.read_text(encoding="utf-8")
        
        # Only generate temporary key in explicit development mode
        if self._is_explicit_development():
            logger.warning("No RSA private key found, generating temporary key for development")
            return self._generate_rsa_key_pair()
        
        raise ValueError(
            f"RSA private key not found at {self.private_key_path}. "
            "Please generate keys using: openssl genrsa -out .keys/private.pem 2048"
        )
    
    def _is_explicit_development(self) -> bool:
        """Check if environment is explicitly set to development"""
        return self.env.lower() in ("development", "dev")

    def use_secure_runtime(self) -> bool:
        """Enable production-style transport protections outside local development."""
        return not self._is_explicit_development()
    
    def get_public_key(self) -> str:
        """Load or generate RSA public key"""
        key_path = Path(self.public_key_path)
        if key_path.exists():
            return key_path.read_text(encoding="utf-8")
        
        # Derive from private key only in explicit development mode
        if self._is_explicit_development():
            private_key = self.get_private_key()
            return self._derive_public_key(private_key)
        
        raise ValueError(
            f"RSA public key not found at {self.public_key_path}. "
            "Please generate keys using: openssl rsa -in .keys/private.pem -pubout -out .keys/public.pem"
        )
    
    def _generate_rsa_key_pair(self) -> str:
        """Generate RSA key pair and return private key"""
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        
        private_key = rsa.generate_private_key(
            public_exponent=RSA_PUBLIC_EXPONENT,
            key_size=RSA_KEY_SIZE_BITS
        )
        
        # Save private key
        private_pem = private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption()
        )
        
        # Save public key
        public_key = private_key.public_key()
        public_pem = public_key.public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo
        )
        
        # Ensure directory exists
        key_dir = Path(self.private_key_path).parent
        key_dir.mkdir(parents=True, exist_ok=True)
        
        # Write keys
        Path(self.private_key_path).write_bytes(private_pem)
        Path(self.public_key_path).write_bytes(public_pem)
        
        logger.info(f"Generated RSA key pair at {key_dir}")
        
        return private_pem.decode("utf-8")
    
    def _derive_public_key(self, private_key_pem: str) -> str:
        """Derive public key from private key"""
        from cryptography.hazmat.primitives import serialization
        
        private_key = serialization.load_pem_private_key(
            private_key_pem.encode("utf-8"),
            password=None
        )
        
        public_key = private_key.public_key()
        public_pem = public_key.public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo
        )
        
        return public_pem.decode("utf-8")


@lru_cache()
def get_settings() -> Settings:
    """Get cached settings instance"""
    settings = Settings()

    # 生产环境禁止 HS256，避免对称密钥模式的降级风险
    if settings.use_secure_runtime() and settings.algorithm != "RS256":
        raise ValueError("In production, JWT algorithm must be RS256. HS256 is not allowed.")

    # 开发环境允许 HS256，并自动生成临时密钥
    if settings.algorithm == "HS256" and not settings.secret_key:
        settings.secret_key = secrets.token_urlsafe(32)
    
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
