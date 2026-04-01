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
    "/api/inventory/import/preview",
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
# 列表查询缓存 TTL（秒）：用于降低短时间重复查询开销
LIST_CACHE_TTL_SECONDS = 10
CACHE_MAX_ITEMS = 100
CACHE_PRUNE_COUNT = 10

# ==================== Auth and Session ====================
ACTIVITY_DEBOUNCE_SECONDS = 300
BEARER_PREFIX_LEN = 7
MAX_LOGIN_ATTEMPTS = 5
LOGIN_WINDOW_SECONDS = 300
PASSWORD_CHANGE_RATE_LIMIT = 5
PASSWORD_CHANGE_RATE_WINDOW_SECONDS = 300
PASSWORD_RESET_RATE_LIMIT = 5
PASSWORD_RESET_RATE_WINDOW_SECONDS = 300
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
IMPORT_PREVIEW_SESSION_TTL_SECONDS = 15 * 60
IMPORT_UPLOAD_RATE_LIMIT = 3
IMPORT_UPLOAD_RATE_LIMIT_WINDOW_SECONDS = 60
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
# Redis 熔断冷却时长（秒）：连接失败后在冷却期内不重复发起连接
REDIS_COOLDOWN_SECONDS = 60.0
CHEMICAL_INFO_RATE_LIMIT_DELAY_SECONDS = 0.1
CHEMICAL_INFO_PRIMARY_FUTURE_TIMEOUT_SECONDS = 30
CHEMICAL_INFO_FALLBACK_FUTURE_TIMEOUT_SECONDS = 10
CHEMICAL_INFO_CACHE_MAX_SIZE = 1000
# 化学信息缓存 TTL（秒）：命中时避免重复外部请求
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

# ==================== SSE (Server-Sent Events) ====================


class SSEEventType:
    """Event type identifiers broadcast over SSE."""

    INVENTORY_CREATED = "inventory.created"
    INVENTORY_UPDATED = "inventory.updated"
    INVENTORY_DELETED = "inventory.deleted"
    INVENTORY_BORROWED = "inventory.borrowed"
    INVENTORY_RETURNED = "inventory.returned"

    COMMON_SHELF_CREATED = "common_shelf.created"
    COMMON_SHELF_UPDATED = "common_shelf.updated"
    COMMON_SHELF_DELETED = "common_shelf.deleted"

    REAGENT_ORDER_CREATED = "reagent_order.created"
    REAGENT_ORDER_UPDATED = "reagent_order.updated"
    REAGENT_ORDER_DELETED = "reagent_order.deleted"

    CONSUMABLE_ORDER_CREATED = "consumable_order.created"
    CONSUMABLE_ORDER_UPDATED = "consumable_order.updated"
    CONSUMABLE_ORDER_DELETED = "consumable_order.deleted"

    DASHBOARD_UPDATED = "dashboard.updated"


class SSERoom:
    """Room channel names for SSE subscriptions."""

    INVENTORY = "inventory"
    COMMON_SHELF = "common_shelf"
    REAGENT_ORDERS = "reagent_orders"
    CONSUMABLE_ORDERS = "consumable_orders"
    DASHBOARD = "dashboard"


# SSE runtime tuning
# 单连接待发送队列上限：超过后触发慢连接治理逻辑
SSE_CLIENT_QUEUE_MAXSIZE = 200
# 连续队列满阈值：达到后主动断开慢连接，防止持续丢消息与日志风暴
SSE_SLOW_CLIENT_QUEUE_FULL_STREAK_LIMIT = 5
# SSE 心跳间隔（秒）：用于保活并帮助代理/Nginx识别活跃连接
SSE_HEARTBEAT_SECONDS = 25
# Redis pubsub 无法建立订阅时的重试间隔（秒）
SSE_REDIS_SUBSCRIBE_RETRY_SECONDS = 3
# Redis pubsub 本次轮询无消息时的短暂 sleep（秒）
SSE_REDIS_EMPTY_POLL_SLEEP_SECONDS = 0.05
# Redis pubsub get_message 的阻塞超时（秒）
SSE_REDIS_GET_MESSAGE_TIMEOUT_SECONDS = 1.0
# Redis 监听循环异常后的重试间隔（秒）
SSE_REDIS_LISTENER_ERROR_RETRY_SECONDS = 2
# SSE 连接来源标识长度（hex 字符长度的一半字节数）
SSE_ORIGIN_TOKEN_HEX_LENGTH = 12
# SSE 客户端 ID 长度（hex 字符长度的一半字节数）
SSE_CLIENT_ID_TOKEN_HEX_LENGTH = 16
