# API 层无业务语义的通用小工具。

from datetime import datetime
from typing import Any, Callable, Dict, Optional
from app.core.constants import CACHE_MAX_ITEMS, CACHE_PRUNE_COUNT


CacheStore = Dict[str, tuple[Any, datetime]]


def get_cached_result(
    cache_store: CacheStore,
    cache_key: str,
    *,
    now: Callable[[], datetime],
    ttl_seconds: int,
) -> Optional[Dict[str, Any]]:
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
) -> None:
    cache_store[cache_key] = (result, now())
    if len(cache_store) <= CACHE_MAX_ITEMS:
        return

    oldest_keys = sorted(cache_store.keys(), key=lambda key: cache_store[key][1])[:CACHE_PRUNE_COUNT]
    for key in oldest_keys:
        del cache_store[key]


def clear_cache_by_prefix(cache_store: CacheStore, prefix: str = "list:") -> int:
    keys_to_delete = [key for key in cache_store.keys() if key.startswith(prefix)]
    for key in keys_to_delete:
        del cache_store[key]
    return len(keys_to_delete)


def empty_to_none(obj: Any, fields: Optional[list[str]] = None) -> dict:
    if isinstance(obj, dict):
        source = dict(obj)
    elif hasattr(obj, "model_dump"):
        source = obj.model_dump()
    else:
        source = dict(vars(obj))

    target_fields = fields if fields is not None else list(source.keys())
    result = dict(source)

    for field in target_fields:
        value = source.get(field)
        # 空字符串或纯空格都转为 None，同时统一去掉首尾空格
        if value is None:
            result[field] = None
        elif isinstance(value, str):
            stripped = value.strip()
            result[field] = None if not stripped else stripped
        else:
            result[field] = value
    return result
