from datetime import datetime, timezone


def get_utc_now() -> datetime:
    """
    获取当前标准 UTC 时间，并剥离时区信息（Naive Datetime）。

    原因：
    1. 保证服务器存储的永远是绝对的零时区时间（UTC），避免跨时区部署导致时间错乱。
    2. 使用 .replace(tzinfo=None) 剥离时区信息，完美兼容 SQLite 对无时区时间格式的底层要求。
    """
    return datetime.now(timezone.utc).replace(tzinfo=None)
