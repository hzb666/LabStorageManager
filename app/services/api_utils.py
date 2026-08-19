# API 层无业务语义的通用小工具。

from collections.abc import Callable
from datetime import datetime
from typing import Any

from sqlmodel import Session

from app.core.constants import CACHE_MAX_ITEMS, CACHE_PRUNE_COUNT, MAX_PAGE_SIZE
from app.services.spec_utils import format_specification

CacheStore = dict[str, tuple[Any, datetime]]


def normalize_pagination(skip: int, limit: int) -> tuple[int, int]:
    # 统一分页参数边界：负数回退到 0，limit 最高不超过全局上限。
    return max(skip, 0), max(0, min(limit, MAX_PAGE_SIZE))


def get_cached_result(
    cache_store: CacheStore,
    cache_key: str,
    *,
    now: Callable[[], datetime],
    ttl_seconds: int,
) -> dict[str, Any] | None:
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
    result: dict[str, Any],
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
    keys_to_delete = [key for key in cache_store if key.startswith(prefix)]
    for key in keys_to_delete:
        del cache_store[key]
    return len(keys_to_delete)


def empty_to_none(obj: Any, fields: list[str] | None = None) -> dict:
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


def normalize_optional_text(value: str | None) -> str | None:
    # 规范化可选文本：strip 后空字符串转 None。
    if value is None:
        return None
    stripped = str(value).strip()
    return stripped or None


def add_inventory_specification(item_dict: dict) -> dict:
    # 为库存/订单响应补充规格展示字段。
    initial = item_dict.get("initial_quantity", 0)
    unit = item_dict.get("unit", "")
    item_dict["specification"] = format_specification(initial, unit)
    return item_dict


def serialize_inventory_items(db: Session, items: list) -> list[dict[str, Any]]:
    # 库存列表通用序列化：批量补充用户名和规格字段。
    from app.models.inventory import InventoryResponse
    from app.services.user_utils import batch_get_user_names

    user_ids: set[int] = set()
    for item in items:
        if item.borrower_id:
            user_ids.add(item.borrower_id)
        if item.last_borrower_id:
            user_ids.add(item.last_borrower_id)
        if item.created_by_id:
            user_ids.add(item.created_by_id)
        if item.temporary_keeper_id:
            user_ids.add(item.temporary_keeper_id)

    users_map = batch_get_user_names(db, user_ids)
    result: list[dict[str, Any]] = []
    for item in items:
        item_dict = InventoryResponse.model_validate(item).model_dump(mode="json")
        item_dict["specification"] = format_specification(item.initial_quantity, item.unit)
        item_dict["borrower_name"] = users_map.get(item.borrower_id)
        item_dict["last_borrower_name"] = users_map.get(item.last_borrower_id)
        item_dict["created_by_name"] = users_map.get(item.created_by_id)
        item_dict["temporary_keeper_name"] = users_map.get(item.temporary_keeper_id)
        result.append(item_dict)
    return result
