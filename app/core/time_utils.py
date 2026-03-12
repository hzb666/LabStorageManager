from datetime import datetime, timezone, timedelta


def get_utc_now() -> datetime:
    """
    获取当前标准 UTC 时间，并剥离时区信息（Naive Datetime）。

    原因：
    1. 保证服务器存储的永远是绝对的零时区时间（UTC），避免跨时区部署导致时间错乱。
    2. 使用 .replace(tzinfo=None) 剥离时区信息，完美兼容 SQLite 对无时区时间格式的底层要求。
    """
    return datetime.now(timezone.utc).replace(tzinfo=None)


def to_china_time(dt: datetime) -> datetime:
    """
    将UTC时间转换为中国时区时间(UTC+8)。
    
    用于导出Excel/CSV时显示本地时间。
    如果datetime对象有时区信息，先转换为UTC，再加8小时。
    如果是naive datetime，直接加8小时（假设存储的是UTC时间）。
    """
    if dt is None:
        return None
    # 先转为UTC再转换，确保正确处理
    if dt.tzinfo is not None:
        # 如果有时区信息，先转为UTC
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    # 加8小时
    return dt + timedelta(hours=8)


def get_china_now() -> datetime:
    """
    获取当前中国时区时间(UTC+8)，用于导出等需要显示本地时间的场景。
    """
    return get_utc_now() + timedelta(hours=8)
