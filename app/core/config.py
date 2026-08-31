"""Lab Storage Manager 配置。"""
import json
import logging
import secrets
from datetime import datetime
from datetime import time as datetime_time
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Any

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode

from app.core.constants import RSA_KEY_SIZE_BITS, RSA_PUBLIC_EXPONENT

logger = logging.getLogger(__name__)

ARCHIVE_WEEKDAY_ALIASES = {
    "mon": 0,
    "monday": 0,
    "tue": 1,
    "tuesday": 1,
    "wed": 2,
    "wednesday": 2,
    "thu": 3,
    "thursday": 3,
    "fri": 4,
    "friday": 4,
    "sat": 5,
    "saturday": 5,
    "sun": 6,
    "sunday": 6,
}
LLM_RESPONSE_FORMAT_JSON_OBJECT = "json_object"
LLM_RESPONSE_FORMAT_JSON_SCHEMA = "json_schema"
LLM_RESPONSE_FORMAT_TEXT = "text"
LLM_RESPONSE_FORMAT_VALUES = frozenset(
    {
        LLM_RESPONSE_FORMAT_JSON_OBJECT,
        LLM_RESPONSE_FORMAT_JSON_SCHEMA,
        LLM_RESPONSE_FORMAT_TEXT,
    }
)
DEFAULT_LLM_MAX_COMPLETION_TOKENS = 50_000


class Settings(BaseSettings):
    """从环境变量加载应用配置。"""

    # 应用
    app_name: str = "Lab Storage Manager"
    app_version: str = "1.0.1"
    cache_version: str = ""
    maintenance_mode: bool = Field(
        default=False,
        description="Redirect the frontend to the maintenance page when enabled",
    )
    debug: bool = False
    env: str = "development"  # 生产部署通过 ENV=production 覆盖
    display_utc_offset: str = Field(
        default="+08:00",
        description="Fixed UTC offset used for exports/downloads/non-browser-rendered time text",
    )

    # 数据库
    database_url: str = "sqlite:///./lab_inventory.db"
    query_log_dir: str = Field(default="logs", description="Directory for search query log DB")
    archive_scheduler_enabled: bool = Field(
        default=False,
        description="Enable the in-process periodic SQLite log archive scheduler",
    )
    archive_interval_hours: int = Field(
        default=24,
        ge=1,
        description="Hours between scheduled log archive runs",
    )
    archive_startup_delay_seconds: int = Field(
        default=300,
        ge=0,
        description="Seconds to wait after backend startup before the first archive run",
    )
    archive_run_at_time: datetime_time | None = Field(
        default=None,
        description="Optional local system time for daily archive runs, formatted as HH:MM",
    )
    archive_run_weekday: int | None = Field(
        default=None,
        ge=0,
        le=6,
        description="Optional weekday for archive runs, 0=Monday and 6=Sunday",
    )
    archive_output_dir: str = Field(
        default="logs",
        description="Directory for generated archive database files",
    )

    # JWT 认证
    secret_key: str = Field(default="", description="JWT secret key (for HS256 in development)")
    algorithm: str = "RS256"  # 从 HS256 切到 RS256 以提升安全性
    access_token_expire_minutes: int = 7 * 24 * 60  # 7 天

    # RS256 密钥
    private_key_path: str = Field(default=".keys/private.pem", description="JWT private key path")
    public_key_path: str = Field(default=".keys/public.pem", description="JWT public key path")

    # 跨域配置。
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:3000"]
    trust_proxy_headers: bool = Field(
        default=False,
        description="Whether to trust reverse-proxy forwarding headers such as X-Forwarded-For",
    )

    # 文件上传
    max_file_size_mb: int = 10
    max_upload_request_size_mb: int = 5
    allowed_image_types: Annotated[tuple[str, ...], NoDecode] = (
        "image/jpeg",
        "image/png",
        "image/webp",
    )
    max_image_width: int = 800
    max_image_height: int = 800
    max_image_size_kb: int = 100  # 关键规则 #3：小于 100KB
    upload_rate_limit_count: int = 10
    upload_rate_limit_window_seconds: int = 300
    cli_rate_limit_count: int = Field(default=60, description="Max CLI API requests per window")
    cli_rate_limit_window_seconds: int = Field(default=60, description="CLI API rate-limit window in seconds")
    cli_login_rate_limit_count: int = Field(default=3, description="Max CLI login attempts per window")
    cli_login_rate_limit_window_seconds: int = Field(default=300, description="CLI login rate-limit window in seconds")

    # 默认管理员
    default_admin_username: str = Field(default="admin", description="Default admin username")
    default_admin_password: str = Field(default="", description="Default admin password (set in production)")
    default_admin_full_name: str = Field(default="系统管理员", description="Default admin full name")

    # 会话与设备设置。max_ip_per_user 仅为兼容既有 .env，当前不限制登录 IP 数量。
    max_ip_per_user: int = Field(default=5, description="Deprecated compatibility setting")
    max_device_per_user: int = Field(default=10, description="Max devices per user")
    session_expire_hours: int = Field(default=7 * 24, description="Session expiration hours (7 days)")
    session_strict_ip: bool = Field(default=False, description="Whether to enforce IP consistency")

    # 公告设置
    max_total_announcements: int = Field(default=10, description="Max announcements per admin")
    max_visible_announcements: int = Field(default=5, description="Max visible announcements per admin")

    # Redis 设置（用于会话缓存）
    redis_host: str = Field(default="localhost", description="Redis host")
    redis_port: int = Field(default=6379, description="Redis port")
    redis_db: int = Field(default=0, description="Redis database number")
    redis_password: str | None = Field(default=None, description="Redis password")
    redis_key_prefix: str = Field(default="lsm", description="Redis key prefix for app namespace")
    redis_max_connections: int = Field(
        default=100,
        ge=1,
        description="Maximum Redis connections per application process",
    )

    # 化学结构缓存与检索
    chem_structure_feature_enabled: bool = Field(
        default=True,
        description="Enable local structure cache and substructure search features",
    )
    chem_resolver_pubchem_enabled: bool = Field(
        default=True,
        description="Enable explicit PubChem CAS structure resolution flows",
    )
    chem_pubchem_rate_limit_per_second: float = Field(
        default=2.0,
        gt=0,
        le=5,
        description="Conservative PubChem PUG-REST request rate limit",
    )
    chem_pubchem_timeout_seconds: float = Field(
        default=20.0,
        gt=0,
        description="HTTP timeout for PubChem PUG-REST requests",
    )
    chem_pubchem_max_retries: int = Field(
        default=3,
        ge=0,
        le=5,
        description="Retry count for PubChem 429, 5xx, and timeout failures",
    )
    chem_pubchem_user_agent: str = Field(
        default="LabStorageManager/1.0.1",
        description="User-Agent sent to PubChem PUG-REST",
    )
    chem_resolution_scheduler_enabled: bool = Field(
        default=True,
        description="Enable durable automatic PubChem resolution jobs",
    )
    chem_resolution_retry_delays_seconds: Annotated[tuple[int, ...], NoDecode] = (
        60,
        300,
        1800,
    )
    chem_resolution_retry_after_min_seconds: int = Field(default=1, ge=0, le=3600)
    chem_resolution_retry_after_max_seconds: int = Field(default=3600, ge=1, le=86_400)
    chem_resolution_retry_jitter_seconds: int = Field(default=5, ge=0, le=300)
    chem_resolution_job_concurrency: int = Field(default=2, ge=1, le=8)
    chem_resolution_job_lease_seconds: int = Field(default=120, ge=10, le=3600)
    chem_resolution_job_attempt_timeout_seconds: float = Field(
        default=1800,
        gt=0,
        le=7200,
        description="Hard timeout for one complete durable structure-resolution attempt",
    )
    chem_structure_search_max_results: int = Field(
        default=100,
        ge=1,
        le=1000,
        description="Preview result upper bound returned by structure search APIs",
    )
    chem_structure_search_concurrency: int = Field(
        default=3,
        ge=1,
        le=8,
        description="Maximum concurrent RDKit structure searches per backend process",
    )
    chem_structure_search_cache_ttl_seconds: int = Field(
        default=43_200,
        ge=60,
        le=86_400,
        description="TTL for cached structure search result tokens",
    )
    chem_structure_search_cache_max_entries: int = Field(
        default=128,
        ge=1,
        le=1024,
        description="Maximum in-memory cached structure search result sets",
    )
    chem_structure_index_snapshot_path: str = Field(
        default=".cache/structure-index.snapshot.json",
        description="Persistent RDKit structure index snapshot path",
    )
    chem_structure_index_maintenance_hour: int = Field(default=3, ge=0, le=23)
    chem_structure_index_weekly_maintenance_weekday: int = Field(
        default=6,
        ge=0,
        le=6,
        description="Weekday for subthreshold structure index compaction, 0=Monday and 6=Sunday",
    )
    chem_structure_index_compaction_min_delta: int = Field(default=256, ge=1)
    chem_structure_index_compaction_ratio: float = Field(default=0.05, gt=0, le=1)
    chem_structure_index_compaction_tombstone_threshold: int = Field(default=128, ge=1)

    # 小牛翻译 API
    niutrans_appid: str = Field(default="", description="Niutrans API appId")
    niutrans_apikey: str = Field(default="", description="Niutrans API key")

    # OpenAI-compatible LLM API for procedure reagent extraction
    llm_enabled: bool = Field(default=False, description="Enable external LLM features")
    llm_api_base_url: str = Field(default="", description="OpenAI-compatible API base URL")
    llm_api_key: str = Field(default="", description="OpenAI-compatible API key")
    llm_model: str = Field(default="", description="Model name for procedure extraction")
    llm_timeout_seconds: float = Field(
        default=30.0,
        gt=0,
        description="HTTP timeout for LLM API calls",
    )
    llm_response_format: str = Field(
        default=LLM_RESPONSE_FORMAT_JSON_OBJECT,
        description="LLM response format: json_object, json_schema, or text",
    )
    llm_temperature: float = Field(
        default=0.0,
        ge=0.0,
        le=2.0,
        description="Sampling temperature for LLM extraction",
    )
    llm_max_completion_tokens: int = Field(
        default=DEFAULT_LLM_MAX_COMPLETION_TOKENS,
        ge=1,
        description="Maximum generated tokens for LLM extraction",
    )
    llm_thinking_type: str = Field(
        default="disabled",
        description="Optional thinking.type value for providers such as MiMo; blank omits it",
    )
    llm_parse_retry_count: int = Field(
        default=1,
        ge=0,
        le=3,
        description="Retry count after parseable HTTP responses with invalid LLM JSON",
    )
    procedure_search_rate_limit_count: int = Field(
        default=10,
        ge=1,
        description="Maximum procedure extraction or resolution requests per user and window",
    )
    procedure_search_rate_limit_window_seconds: int = Field(
        default=300,
        ge=1,
        description="Procedure search rate-limit window in seconds",
    )

    # Sentry application monitoring
    sentry_dsn: str = Field(default="", description="Sentry DSN for backend error reporting")
    sentry_environment: str = Field(
        default="",
        description="Sentry environment name; falls back to ENV when blank",
    )
    sentry_traces_sample_rate: float = Field(
        default=0.05,
        ge=0.0,
        le=1.0,
        description="Sentry backend performance tracing sample rate",
    )
    sentry_send_default_pii: bool = Field(
        default=False,
        description="Whether Sentry may send default personally identifiable request data",
    )

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

    @field_validator("archive_run_at_time", mode="before")
    @classmethod
    def parse_archive_run_at_time(cls, value: Any) -> datetime_time | None | Any:
        if value is None or isinstance(value, datetime_time):
            return value
        if not isinstance(value, str):
            return value

        stripped = value.strip()
        if not stripped:
            return None

        for fmt in ("%H:%M", "%H:%M:%S"):
            try:
                return datetime.strptime(stripped, fmt).time()  # noqa: DTZ007
            except ValueError:
                continue
        raise ValueError("ARCHIVE_RUN_AT_TIME must use HH:MM or HH:MM:SS")

    @field_validator("archive_run_weekday", mode="before")
    @classmethod
    def parse_archive_run_weekday(cls, value: Any) -> int | None | Any:
        if value is None or isinstance(value, int):
            return value
        if not isinstance(value, str):
            return value

        stripped = value.strip().lower()
        if not stripped:
            return None
        if stripped in ARCHIVE_WEEKDAY_ALIASES:
            return ARCHIVE_WEEKDAY_ALIASES[stripped]
        if stripped.isdigit():
            return int(stripped)
        raise ValueError("ARCHIVE_RUN_WEEKDAY must use 0-6 or weekday name")

    @field_validator("llm_response_format", mode="before")
    @classmethod
    def parse_llm_response_format(cls, value: Any) -> str | Any:
        if value is None:
            return LLM_RESPONSE_FORMAT_JSON_OBJECT
        if not isinstance(value, str):
            return value
        normalized = value.strip().lower()
        if not normalized:
            return LLM_RESPONSE_FORMAT_JSON_OBJECT
        if normalized not in LLM_RESPONSE_FORMAT_VALUES:
            allowed = ", ".join(sorted(LLM_RESPONSE_FORMAT_VALUES))
            raise ValueError(f"LLM_RESPONSE_FORMAT must be one of: {allowed}")
        return normalized

    @field_validator("llm_thinking_type", mode="before")
    @classmethod
    def parse_llm_thinking_type(cls, value: Any) -> str | Any:
        if value is None:
            return ""
        if not isinstance(value, str):
            return value
        return value.strip().lower()

    @field_validator("display_utc_offset", mode="before")
    @classmethod
    def parse_display_utc_offset(cls, value: Any) -> str:
        if value is None:
            return "+08:00"
        if not isinstance(value, str):
            raise ValueError("DISPLAY_UTC_OFFSET must be a string")  # noqa: TRY004

        stripped = value.strip()
        if not stripped:
            return "+08:00"

        sign = stripped[0]
        if sign not in {"+", "-"}:
            raise ValueError("DISPLAY_UTC_OFFSET must start with + or -")

        body = stripped[1:]
        if ":" in body:
            hour_text, minute_text = body.split(":", 1)
        else:
            hour_text, minute_text = body, "00"

        if not hour_text.isdigit() or not minute_text.isdigit():
            raise ValueError("DISPLAY_UTC_OFFSET must use digits like +8 or +08:00")

        hours = int(hour_text)
        minutes = int(minute_text)
        if hours > 14 or minutes >= 60:
            raise ValueError("DISPLAY_UTC_OFFSET must be within UTC-14:00 to UTC+14:00")
        if hours == 14 and minutes != 0:
            raise ValueError("DISPLAY_UTC_OFFSET must be within UTC-14:00 to UTC+14:00")

        return f"{sign}{hours:02d}:{minutes:02d}"

    @field_validator("allowed_image_types", mode="before")
    @classmethod
    def parse_allowed_image_types(cls, value: Any) -> tuple[str, ...] | Any:
        if not isinstance(value, str):
            return value

        stripped = value.strip()
        if not stripped:
            return ()

        if stripped.startswith("["):
            parsed = json.loads(stripped)
            if not isinstance(parsed, list) or not all(isinstance(item, str) for item in parsed):
                raise ValueError("ALLOWED_IMAGE_TYPES JSON value must be a string array")
            return tuple(item.strip() for item in parsed if item.strip())

        return tuple(item.strip() for item in stripped.split(",") if item.strip())

    @field_validator("chem_resolution_retry_delays_seconds", mode="before")
    @classmethod
    def parse_chem_resolution_retry_delays(cls, value: Any) -> tuple[int, ...] | Any:
        if not isinstance(value, str):
            return value
        stripped = value.strip()
        if not stripped:
            raise ValueError("CHEM_RESOLUTION_RETRY_DELAYS_SECONDS must not be empty")
        raw_values = json.loads(stripped) if stripped.startswith("[") else stripped.split(",")
        if not isinstance(raw_values, list | tuple):
            raise ValueError("CHEM_RESOLUTION_RETRY_DELAYS_SECONDS must be a list")  # noqa: TRY004
        delays = tuple(int(item) for item in raw_values)
        if len(delays) != 3 or any(delay <= 0 for delay in delays):
            raise ValueError("CHEM_RESOLUTION_RETRY_DELAYS_SECONDS must contain 3 positive values")
        return delays

    @model_validator(mode="after")
    def validate_chem_resolution_retry_settings(self) -> "Settings":
        delays = self.chem_resolution_retry_delays_seconds
        if len(delays) != 3 or any(delay <= 0 for delay in delays):
            raise ValueError(
                "CHEM_RESOLUTION_RETRY_DELAYS_SECONDS must contain 3 positive values"
            )
        if (
            self.chem_resolution_retry_after_min_seconds
            > self.chem_resolution_retry_after_max_seconds
        ):
            raise ValueError(
                "CHEM_RESOLUTION_RETRY_AFTER_MIN_SECONDS must not exceed "
                "CHEM_RESOLUTION_RETRY_AFTER_MAX_SECONDS"
            )
        return self

    def get_private_key(self) -> str:
        """Load or generate RSA private key"""
        key_path = Path(self.private_key_path)
        if key_path.exists():
            return key_path.read_text(encoding="utf-8")

        # 仅在显式开发环境生成临时密钥
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

        # 仅在显式开发环境里由私钥派生公钥
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

        # 保存私钥
        private_pem = private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption()
        )

        # 保存公钥
        public_key = private_key.public_key()
        public_pem = public_key.public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo
        )

        # 确保目录存在
        key_dir = Path(self.private_key_path).parent
        key_dir.mkdir(parents=True, exist_ok=True)

        # 写入密钥
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


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance"""
    settings = Settings()
    settings.app_version = settings.app_version.strip() or "1.0.1"
    settings.cache_version = settings.cache_version.strip() or settings.app_version

    # 生产环境禁止 HS256，避免对称密钥模式的降级风险
    if settings.use_secure_runtime() and settings.algorithm != "RS256":
        raise ValueError("In production, JWT algorithm must be RS256. HS256 is not allowed.")

    # 开发环境允许 HS256，并自动生成临时密钥
    if settings.algorithm == "HS256" and not settings.secret_key:
        settings.secret_key = secrets.token_urlsafe(32)

    return settings


# 全局配置实例
settings = get_settings()


# 路径
BASE_DIR = Path(__file__).resolve().parent.parent.parent
STATIC_DIR = BASE_DIR / "static"
UPLOADS_DIR = STATIC_DIR / "uploads"
THUMBNAILS_DIR = STATIC_DIR / "thumbnails"

# 确保目录存在
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
THUMBNAILS_DIR.mkdir(parents=True, exist_ok=True)
