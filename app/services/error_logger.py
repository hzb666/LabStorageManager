"""后端错误日志收集服务。"""
import logging
import re
from collections import deque
from datetime import UTC, datetime, timedelta
from pathlib import Path

from app.core.constants import DEFAULT_LOG_HOURS, DEFAULT_LOG_LINES
from app.core.time_utils import to_display_time

# 敏感关键词列表（用于日志脱敏）
SENSITIVE_KEYWORDS = [
    "password", "passwd", "pwd", "secret", "token", "api_key", "apikey",
    "access_token", "refresh_token", "jwt", "authorization", "auth",
    "private_key", "public_key", "secret_key", "encryption_key",
    "credential", "client_secret", "connection_string", "database_url",
    "smtp_password", "mail_password", "redis_password",
]

# 日志目录
LOG_DIR = Path(__file__).parent.parent.parent / "logs"
LOG_FILE = LOG_DIR / "error.log"
ERROR_LOG_TIMESTAMP_FORMAT = "%Y-%m-%d %H:%M:%S"
ERROR_LOG_TIMESTAMP_PATTERN = re.compile(
    r"^(?P<timestamp>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})(?P<suffix>.*)$"
)

# 确保日志目录存在
LOG_DIR.mkdir(parents=True, exist_ok=True)


def get_error_logger() -> logging.Logger:
    """获取错误日志记录器"""
    logger = logging.getLogger("error_logger")

    # 避免重复添加handler
    if logger.handlers and not all(isinstance(handler, logging.NullHandler) for handler in logger.handlers):
        return logger
    logger.handlers = [handler for handler in logger.handlers if not isinstance(handler, logging.NullHandler)]

    try:
        from app.services.log_queue import get_async_file_logger

        return get_async_file_logger(
            logger_name="error_logger",
            file_path=LOG_FILE,
            level=logging.ERROR,
            datefmt="%Y-%m-%d %H:%M:%S",
            backup_count=5,
        )
    except OSError:
        logger.handlers = [handler for handler in logger.handlers if handler.__class__.__name__ != "QueueHandler"]
        logger.addHandler(logging.NullHandler())
        logger.propagate = False
    return logger


def sanitize_log_content(content: str) -> str:
    """
    对日志内容进行脱敏处理

    移除敏感信息如密码、token、密钥等
    """
    sanitized = content

    # 替换敏感键值对 - 使用更精确的正则避免误伤
    for keyword in SENSITIVE_KEYWORDS:
        # 匹配 key=value 或 key: value，并尽量避免误伤普通单词。
        pattern = rf"(?:^|\s|[\"'])({keyword})(?:[=:]\s*)[^\s,}}]+"
        sanitized = re.sub(
            pattern,
            r"\1***",
            sanitized,
            flags=re.IGNORECASE
        )

        # 替换JSON中的敏感字段
        pattern = rf'"{keyword}"\s*:\s*"[^"]+"'
        sanitized = re.sub(
            pattern,
            r'"\1": "***"',
            sanitized,
            flags=re.IGNORECASE
        )

    # 替换明显的Base64编码的token（长字符串）
    pattern = r"(eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+)"
    sanitized = re.sub(pattern, "***JWT_TOKEN***", sanitized)

    return sanitized


def _convert_log_timestamp_to_display_time(line: str) -> str:
    """
    将错误日志行首的服务器本地时间转换为配置的展示时区时间。

    日志文件里的时间戳由 logging.Formatter 按服务器本地时区写入，
    bug report 下载时需要统一显示为 DISPLAY_UTC_OFFSET 对应时间。
    """
    match = ERROR_LOG_TIMESTAMP_PATTERN.match(line)
    if match is None:
        return line

    timestamp_text = match.group("timestamp")
    try:
        local_naive = datetime.strptime(timestamp_text, ERROR_LOG_TIMESTAMP_FORMAT)  # noqa: DTZ007
    except ValueError:
        return line

    local_tzinfo = datetime.now().astimezone().tzinfo
    if local_tzinfo is None:
        return line

    utc_naive = (
        local_naive
        .replace(tzinfo=local_tzinfo)
        .astimezone(UTC)
        .replace(tzinfo=None)
    )
    display_time = to_display_time(utc_naive)
    if display_time is None:
        return line

    return f"{display_time.strftime(ERROR_LOG_TIMESTAMP_FORMAT)}{match.group('suffix')}"


def _format_error_log_line(line: str) -> str:
    return sanitize_log_content(_convert_log_timestamp_to_display_time(line))


def _is_error_log_line(line: str) -> bool:
    return "[ERROR]" in line


def get_recent_error_logs(lines: int = DEFAULT_LOG_LINES) -> list[str]:
    """
    获取最近的错误日志

    Args:
        lines: 返回的日志行数

    Returns:
        错误日志列表（已脱敏）
    """
    if not LOG_FILE.exists():
        return []

    try:
        if lines <= 0:
            return []

        recent_lines: deque[str] = deque(maxlen=lines)
        with open(LOG_FILE, "r", encoding="utf-8") as f:
            for line in f:
                if _is_error_log_line(line):
                    recent_lines.append(line)

        # 对每行进行脱敏处理
        sanitized_lines = [_format_error_log_line(line) for line in recent_lines]

        return sanitized_lines

    except Exception as e:  # noqa: BLE001 - log reads must fail closed.
        logger = get_error_logger()
        logger.error(f"Failed to read error logs: {e}")
        return []


def get_error_logs_since(hours: int = DEFAULT_LOG_HOURS) -> list[str]:
    """
    获取指定时间范围内的错误日志

    Args:
        hours: 小时数

    Returns:
        错误日志列表（已脱敏）
    """
    if not LOG_FILE.exists():
        return []

    try:
        # 解析时间并过滤
        cutoff_time = datetime.now() - timedelta(hours=hours)  # noqa: DTZ005
        recent_errors = []

        with open(LOG_FILE, "r", encoding="utf-8") as f:
            for line in f:
                if not _is_error_log_line(line):
                    continue

                try:
                    # 提取时间戳 (格式: 2024-01-01 12:00:00)
                    time_str = line.split("[")[0].strip()
                    log_time = datetime.strptime(time_str, ERROR_LOG_TIMESTAMP_FORMAT)  # noqa: DTZ007

                    if log_time >= cutoff_time:
                        recent_errors.append(_format_error_log_line(line))
                except (ValueError, IndexError):
                    # 时间解析失败时返回该行
                    recent_errors.append(_format_error_log_line(line))

        return recent_errors

    except Exception as e:  # noqa: BLE001 - log reads must fail closed.
        logger = get_error_logger()
        logger.error(f"Failed to read error logs: {e}")
        return []


def log_error(message: str, exc_info: Exception | None = None) -> None:
    """
    记录错误日志

    Args:
        message: 错误消息
        exc_info: 异常信息（可选）
    """
    logger = get_error_logger()

    if exc_info:
        logger.error(message, exc_info=True)  # noqa: LOG014 - preserve exception logging behavior.
    else:
        logger.error(message)


def clear_old_logs(days: int = 7) -> int:
    """
    清理旧的日志文件

    Args:
        days: 保留天数

    Returns:
        删除的日志行数
    """
    if not LOG_FILE.exists():
        return 0

    try:
        cutoff_time = datetime.now() - timedelta(days=days)  # noqa: DTZ005
        deleted_count = 0
        tmp_file = LOG_FILE.with_suffix(f"{LOG_FILE.suffix}.tmp")

        with (
            open(LOG_FILE, "r", encoding="utf-8") as source,
            open(tmp_file, "w", encoding="utf-8") as target,
        ):
            for line in source:
                if not _is_error_log_line(line):
                    target.write(line)
                    continue

                try:
                    time_str = line.split("[")[0].strip()
                    log_time = datetime.strptime(time_str, ERROR_LOG_TIMESTAMP_FORMAT)  # noqa: DTZ007

                    if log_time >= cutoff_time:
                        target.write(line)
                    else:
                        deleted_count += 1
                except (ValueError, IndexError):
                    target.write(line)

        tmp_file.replace(LOG_FILE)

        return deleted_count

    except Exception as e:  # noqa: BLE001 - log cleanup must not propagate.
        logger = get_error_logger()
        logger.error(f"Failed to clear old logs: {e}")
        return 0
