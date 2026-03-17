"""
API 通用工具函数。

该模块集中承载 API 层可复用的“非业务”逻辑，目标是减少各路由文件中的重复实现：
1. 列表缓存读写、过期淘汰与前缀清理
2. 请求载荷字段规范化（如空字符串转 None）

设计原则：
- 工具函数必须无业务语义，不依赖具体模型
- 输入输出保持简单，便于在不同 API 文件中直接复用
- 与时间有关的行为通过 now 回调注入，便于测试
"""

from datetime import datetime
from typing import Any, Callable, Dict, Optional


CacheStore = Dict[str, tuple[Any, datetime]]


def get_cached_result(
    cache_store: CacheStore,
    cache_key: str,
    *,
    now: Callable[[], datetime],
    ttl_seconds: int,
) -> Optional[Dict[str, Any]]:
    """读取缓存，若过期则删除后返回 None。"""
    if cache_key not in cache_store:
        return None

    cached_result, cached_time = cache_store[cache_key]
    if (now() - cached_time).total_seconds() < ttl_seconds:
        return cached_result

    del cache_store[cache_key]
    return None


def set_cached_result(
    cache_store: CacheStore,
    cache_key: str,
    result: Dict[str, Any],
    *,
    now: Callable[[], datetime],
    max_items: int = 100,
    prune_count: int = 10,
) -> None:
    """写入缓存并在容量超过阈值时按最旧时间裁剪。"""
    cache_store[cache_key] = (result, now())
    if len(cache_store) <= max_items:
        return

    oldest_keys = sorted(cache_store.keys(), key=lambda key: cache_store[key][1])[:prune_count]
    for key in oldest_keys:
        del cache_store[key]


def clear_cache_by_prefix(cache_store: CacheStore, prefix: str = "list:") -> int:
    """按前缀清理缓存键，返回清理数量。"""
    keys_to_delete = [key for key in cache_store.keys() if key.startswith(prefix)]
    for key in keys_to_delete:
        del cache_store[key]
    return len(keys_to_delete)


def empty_to_none(obj: Any, fields: list[str]) -> dict:
    """将指定字段中的空字符串或纯空格字符串统一转换为 None。

    Args:
        obj: 输入对象，可以是字典或带属性的对象
        fields: 需要处理的字段列表

    Returns:
        处理后的字典，空字符串和纯空格都会转为 None
    """
    result = {}
    for field in fields:
        if isinstance(obj, dict):
            value = obj.get(field)
        else:
            value = getattr(obj, field, None)
        # 空字符串或纯空格都转为 None
        if value is None:
            result[field] = None
        elif isinstance(value, str):
            result[field] = None if not value.strip() else value
        else:
            result[field] = value
    return result