"""Application-wide constants.

Keep cross-module constants in a single place to avoid magic numbers and
string drift.
"""

from datetime import date

# ==================== HTTP Security ====================
HSTS_MAX_AGE_SECONDS = 31_536_000
STATIC_CACHE_MAX_AGE_SECONDS = 315_360_000
UPLOAD_PATHS = (
    "/api/announcements/upload-image",
    "/api/inventory/import",
)
HTTPS_EXEMPT_PATHS = {"/health"}

CSP_BASE_DIRECTIVES = {
    "default-src": "'self'",
    "base-uri": "'self'",
    "object-src": "'none'",
    "frame-ancestors": "'none'",
    "img-src": "'self' data: https:",
}
CSP_STYLE_SRC_WITH_INLINE = "'self' 'unsafe-inline'"
CSP_SCRIPT_SRC_STRICT = "'self'"
CSP_SCRIPT_SRC_DOCS = "'self' 'unsafe-inline'"
DOCS_PATH_PREFIXES = ("/docs", "/redoc")

# ==================== Pagination and Cache ====================
MAX_PAGE_SIZE = 100
DEFAULT_PAGE_SIZE = 50
LIST_CACHE_TTL_SECONDS = 10
CACHE_MAX_ITEMS = 100
CACHE_PRUNE_COUNT = 10

# ==================== Auth and Session ====================
ACTIVITY_DEBOUNCE_SECONDS = 300
BEARER_PREFIX_LEN = 7
MAX_LOGIN_ATTEMPTS = 5
LOGIN_WINDOW_SECONDS = 300
SECONDS_PER_HOUR = 3600
UNKNOWN_DEVICE = "Unknown Device"
ANONYMOUS_DEVICE_PREFIX = "anonymous-"
ANONYMOUS_DEVICE_TOKEN_HEX_LENGTH = 8

# ==================== User Validation ====================
USERNAME_MIN_LENGTH = 3
USERNAME_MAX_LENGTH = 20
PASSWORD_MIN_LENGTH = 6
PASSWORD_MAX_LENGTH = 50

# ==================== Inventory and Orders ====================
OVERDUE_BORROW_DAYS = 3
LOW_STOCK_PERCENT = 0.20
LOW_STOCK_PERCENT_DISPLAY = 20
MAX_BOTTLES_PER_IMPORT = 99
MAX_ORDER_QUANTITY = 99
TRANSLATED_NAME_SUFFIX = "（译）"

# ==================== Upload and Image ====================
DEFAULT_IMAGE_MAX_MB = 1.0
ANNOUNCEMENT_IMAGE_MAX_MB = 5.0
AVATAR_MAX_SIZE_MB = 5.0
AVATAR_MAX_WIDTH = 200
AVATAR_MAX_HEIGHT = 200
DIRECTORY_STORAGE_MAX_MB = 50
IMAGE_QUALITY_DEFAULT = 85
IMAGE_QUALITY_MIN = 30
UPLOAD_FILENAME_UUID_PREFIX_LEN = 8
TIMESTAMP_FILENAME_FORMAT = "%Y%m%d_%H%M%S"

# ==================== Import and Excel ====================
EXCEL_FILE_MAX_BYTES = 2 * 1024 * 1024
EXCEL_DATE_EPOCH = date(1899, 12, 30)
EXCEL_RED_FONT_COLOR = "FF0000"
INTERNAL_CODE_SEQUENCE_PAD_WIDTH = 3
INTERNAL_CODE_MAX_SEQUENCE = (10 ** INTERNAL_CODE_SEQUENCE_PAD_WIDTH) - 1

# ==================== Logs ====================
LOG_TOKEN_EXPIRE_HOURS = 2
LOG_TOKEN_RATE_LIMIT = 3
LOG_TOKEN_RATE_WINDOW = 30
LOG_FILE_MAX_BYTES = 5 * 1024 * 1024
DEFAULT_LOG_LINES = 100
DEFAULT_LOG_HOURS = 24

# ==================== Timezone ====================
CHINA_UTC_OFFSET_HOURS = 8

# ==================== Network and External Calls ====================
REDIS_SOCKET_CONNECT_TIMEOUT_SECONDS = 1
REDIS_SOCKET_TIMEOUT_SECONDS = 1
CHEMICAL_INFO_RATE_LIMIT_DELAY_SECONDS = 0.1
CHEMICAL_INFO_PRIMARY_FUTURE_TIMEOUT_SECONDS = 30
CHEMICAL_INFO_FALLBACK_FUTURE_TIMEOUT_SECONDS = 10
CHEMICAL_INFO_CACHE_MAX_SIZE = 1000
CHEMICAL_INFO_CACHE_TTL_SECONDS = 3600
MIN_REQUEST_TIMEOUT_SECONDS = 0.1  # requests 库最小超时要求

# ==================== Import/Rate-limit policy ====================
IMPORT_RATE_LIMIT_DIVISOR = 2
MIN_IMPORT_RATE_LIMIT = 3
TEMPLATE_DOWNLOAD_RATE_LIMIT = 1
TEMPLATE_DOWNLOAD_WINDOW_SECONDS = 2
TEMPLATE_DOWNLOAD_RATE_LIMIT_SCOPE = "download_inventory_import_template"

# ==================== Security and Validation ====================
CAS_PATTERN = r"^\d{2,7}-\d{2}-\d$"
SPEC_PATTERN = r"^(\d+(?:\.\d+)?)\s*([a-zA-Zμ个瓶支盒包套]+)$"
INVALID_FILENAME_SEGMENTS = ("..",)
INVALID_FILENAME_PREFIX = "/"

# ==================== Crypto ====================
RSA_PUBLIC_EXPONENT = 65537
RSA_KEY_SIZE_BITS = 2048
