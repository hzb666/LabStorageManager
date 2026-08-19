import calendar
from datetime import UTC, datetime, time, timedelta, timezone

from app.core.config import settings


def get_utc_now() -> datetime:
    """
    获取当前标准 UTC 时间，并剥离时区信息（Naive Datetime）。

    原因：
    1. 保证服务器存储的永远是绝对的零时区时间（UTC），避免跨时区部署导致时间错乱。
    2. 使用 .replace(tzinfo=None) 剥离时区信息，完美兼容 SQLite 对无时区时间格式的底层要求。
    """
    return datetime.now(UTC).replace(tzinfo=None)


def _coerce_utc_naive(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is not None:
        return dt.astimezone(UTC).replace(tzinfo=None)
    return dt


def _get_display_offset_delta() -> timedelta:
    offset_text = settings.display_utc_offset
    sign = 1 if offset_text.startswith("+") else -1
    hours_text, minutes_text = offset_text[1:].split(":", 1)
    return timedelta(hours=sign * int(hours_text), minutes=sign * int(minutes_text))


def get_display_timezone_label() -> str:
    return f"UTC{settings.display_utc_offset}"


def get_display_tzinfo() -> timezone:
    return timezone(_get_display_offset_delta(), name=get_display_timezone_label())


def to_display_time(dt: datetime | None) -> datetime | None:
    """
    Convert a stored UTC datetime into the configured fixed display offset.

    Non-browser-rendered outputs (downloads/exports/text reports) should use
    this helper instead of hand-written offset math at call sites.
    """
    normalized = _coerce_utc_naive(dt)
    if normalized is None:
        return None
    return normalized + _get_display_offset_delta()


def get_display_now() -> datetime:
    """
    获取当前 display offset 时间，用于导出等非浏览器转换场景。
    """
    return to_display_time(get_utc_now())


def get_display_day_age_cutoff(days: int, now: datetime | None = None) -> datetime:
    """
    Return the UTC cutoff for records at least `days` display-calendar days old.

    Example with UTC+08: an item created any time on Apr 10 becomes 2 natural
    days old at Apr 12 00:00 display time, so the cutoff is Apr 11 00:00
    display time converted back to UTC.
    """
    if days < 1:
        raise ValueError("days must be at least 1")

    display_now = to_display_time(now or get_utc_now())
    if display_now is None:
        raise ValueError("now must not be None")

    cutoff_display_date = display_now.date() - timedelta(days=days - 1)
    cutoff_display_midnight = datetime.combine(cutoff_display_date, time.min)
    cutoff = normalize_to_utc_naive(cutoff_display_midnight)
    if cutoff is None:
        raise ValueError("cutoff must not be None")
    return cutoff


def is_display_day_age_at_least(
    dt: datetime | None,
    days: int,
    now: datetime | None = None,
) -> bool:
    """Check age using configured display-time natural days, not elapsed hours."""
    normalized = _coerce_utc_naive(dt)
    return normalized is not None and normalized < get_display_day_age_cutoff(days, now)


def normalize_to_utc_naive(dt: datetime | None) -> datetime | None:
    """
    Normalize imported/user-provided datetimes into the project's UTC naive shape.

    - aware datetime: convert to UTC then strip tzinfo
    - naive datetime: interpret as configured display offset, then convert to UTC
    """
    if dt is None:
        return None
    if dt.tzinfo is not None:
        return dt.astimezone(UTC).replace(tzinfo=None)
    return (dt - _get_display_offset_delta()).replace(tzinfo=None)


def to_china_time(dt: datetime | None) -> datetime | None:
    """
    Backward-compatible wrapper for historical China-time helpers.

    Deprecated: use `to_display_time()` instead.
    """
    return to_display_time(dt)


def get_china_now() -> datetime:
    """
    Backward-compatible wrapper for historical China-time helpers.

    Deprecated: use `get_display_now()` instead.
    """
    return get_display_now()


def utc_iso_str(dt: datetime | None) -> str | None:
    """
    将 datetime 格式化为 UTC ISO 字符串并附加 'Z' 后缀。

    用途：后端存储的 UTC 时间加 Z 后缀，让浏览器明确按 UTC 解析，
    避免误认为本地时间。
    如果 datetime 对象有时区信息，会先转换为 UTC 再格式化。
    如果传入 None，返回 None。
    """
    normalized = _coerce_utc_naive(dt)
    if normalized is None:
        return None
    return normalized.replace(tzinfo=UTC).isoformat().replace("+00:00", "Z")


def format_sqlite_datetime(value: datetime) -> str:
    return value.isoformat(sep=" ")


def subtract_months(value: datetime, months: int) -> datetime:
    month = value.month - months
    year = value.year
    while month <= 0:
        month += 12
        year -= 1
    last_day = calendar.monthrange(year, month)[1]
    day = min(value.day, last_day)
    return value.replace(year=year, month=month, day=day)


def parse_utc_datetime(value: object) -> datetime | None:
    """
    Parse a UTC datetime string into the project's naive UTC datetime shape.

    Accepts both the legacy internal form without suffix and the API/cache form
    with a trailing Z, so old Redis/local metadata remains readable.
    """
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = f"{text[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is not None:
        return parsed.astimezone(UTC).replace(tzinfo=None)
    return parsed
