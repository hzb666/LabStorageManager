# Inventory API 路由：库存管理。
# 关键规则 #2：CAS 编号标准化（数据从订单复制）。
# 所有用户可查看/消耗/新增/编辑/删除分组。
# 路由顺序要求：具名路由必须在 /{inventory_id} 之前，
# 避免路径参数误捕获 "export"、"dashboard" 等字符串。
import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Optional, Dict, Any, Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlmodel import Session, select, func

from app.database import get_db, DBSession
from app.models.inventory import Inventory, InventoryUpdate, InventoryResponse, InventoryStatus
from app.core.auth import get_current_user
from app.core.constants import (
    DEFAULT_PAGE_SIZE,
    LIST_CACHE_TTL_SECONDS,
    MAX_PAGE_SIZE,
    SSEEventType,
    SSERoom,
)
from app.services.sse_manager import sse_manager
from app.core.time_utils import get_utc_now
from app.services.cas_utils import normalize_cas, validate_cas_format
from app.services.cas_utils import BIOLOGICAL_REAGENT_CAS
from app.services.pinyin_utils import compute_pinyin_fields
from app.services.user_utils import batch_get_user_names
from app.services.sql_utils import (
    normalize_search_term,
    order_with_nulls_last,
    order_with_special_last,
)
from app.services.api_utils import clear_cache_by_prefix, get_cached_result, set_cached_result
from app.services.inventory_fts import (
    InventoryFTSError,
    apply_inventory_fts_filter,
    build_inventory_fts_rowid_subquery,
    should_use_inventory_fts,
)
from app.services.inventory_queries import (
    get_regular_inventory_by_id,
    regular_inventory_query,
)
from app.services.search_matchers import (
    CASSearchMode,
    build_cas_search_clause,
    build_text_search_clause,
    classify_cas_search,
    collect_search_fields,
    combine_or_clauses,
    union_id_subqueries,
)
from app.services.spec_utils import parse_specification, SpecificationError, format_specification
from app.services.shelf_utils import normalize_storage_location
from app.api.inventory_extended_routes import register_inventory_extended_routes
from app.api.common_shelf import register_common_shelf
from app.core.request_utils import get_sse_client_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/inventory", tags=["Inventory"])
LIST_CACHE_PREFIX = "list:"
INVENTORY_NOT_FOUND = "Inventory item not found"

# ==================== Search Cache ====================
SEARCH_CACHE: Dict[str, tuple[Any, datetime]] = {}
INVENTORY_SEARCH_SQL_FIELD_MAP = {
    'name': [Inventory.name, Inventory.name_pinyin, Inventory.name_pinyin_initials],
    'cas_number': [Inventory.cas_number],
    'storage_location': [
        Inventory.storage_location,
        Inventory.storage_location_pinyin,
        Inventory.storage_location_pinyin_initials,
    ],
    'brand': [Inventory.brand, Inventory.brand_pinyin, Inventory.brand_pinyin_initials],
    'category': [
        Inventory.category,
        Inventory.category_pinyin,
        Inventory.category_pinyin_initials,
    ],
}

VALID_INVENTORY_SORT_FIELDS = {
    'cas_number',
    'name',
    'category',
    'storage_location',
    'brand',
    'remaining_quantity',
    'remaining_percent',
    'initial_quantity',
    'status',
    'created_at',
}
INVENTORY_SEARCH_FTS_FIELD_MAP = {
    'name': ["name", "name_pinyin", "name_pinyin_initials"],
    'cas_number': ["cas_number"],
    'storage_location': [
        "storage_location",
        "storage_location_pinyin",
        "storage_location_pinyin_initials",
    ],
    'brand': ["brand", "brand_pinyin", "brand_pinyin_initials"],
    'category': ["category", "category_pinyin", "category_pinyin_initials"],
}


@dataclass(frozen=True)
class InventoryFilterOptions:
    # 封装库存列表筛选参数，避免筛选函数参数膨胀并统一调用边界。

    status_filter: Optional[InventoryStatus]
    cas_filter: Optional[str]
    hazardous_only: bool
    search: Optional[str]
    search_field: Optional[str]
    fuzzy: bool


class InventoryListQuery(BaseModel):
    # 定义库存列表查询参数模型，保证路由签名精简且查询契约不变。

    skip: int = 0
    limit: int = min(DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)
    status_filter: Optional[InventoryStatus] = None
    cas_filter: Optional[str] = None
    hazardous_only: bool = False
    search: Optional[str] = Query(default=None, max_length=100)
    search_field: Optional[str] = None
    fuzzy: bool = False
    sort_by: Optional[str] = None
    sort_order: Optional[str] = "desc"

    def to_filter_options(self) -> InventoryFilterOptions:
        # 把路由查询参数转换为筛选参数对象，减少调用方重复拼装。

        return InventoryFilterOptions(
            status_filter=self.status_filter,
            cas_filter=self.cas_filter,
            hazardous_only=self.hazardous_only,
            search=self.search,
            search_field=self.search_field,
            fuzzy=self.fuzzy,
        )


def _compute_remaining_percent(remaining: Optional[float], initial: Optional[float]) -> Optional[float]:
    # 计算库存剩余比例，统一处理空值和零分母。

    if initial is None or initial <= 0:
        return None
    if remaining is None:
        return None
    return remaining / initial


def _get_by_id(db: Session, inventory_id: int) -> Optional[Inventory]:
    # 按库存 ID 查询常规库存记录，复用统一查询入口。

    return get_regular_inventory_by_id(db, inventory_id)


def _clear_list_cache() -> None:
    # 清理库存列表缓存，确保写操作后读请求拿到最新数据。

    cleared_count = clear_cache_by_prefix(SEARCH_CACHE, prefix=LIST_CACHE_PREFIX)
    logger.info(f"Cleared {cleared_count} list cache entries")


def _add_specification(item_dict: dict) -> dict:
    # 为响应补充规格展示字段，避免前端重复拼接。

    initial = item_dict.get("initial_quantity", 0)
    unit = item_dict.get("unit", "")
    item_dict["specification"] = format_specification(initial, unit)
    return item_dict


def _apply_inventory_static_filters(base, *, options: InventoryFilterOptions):
    # 应用与搜索无关的固定筛选条件，先缩小基础结果集。

    if options.status_filter:
        base = base.where(Inventory.status == options.status_filter)
    if options.cas_filter:
        base = base.where(Inventory.cas_number == normalize_cas(options.cas_filter))
    if options.hazardous_only:
        base = base.where(Inventory.is_hazardous.is_(True))
    return base


def _normalize_inventory_search_value(options: InventoryFilterOptions) -> Optional[str]:
    # 标准化搜索词，统一处理 fuzzy 场景和空白输入。

    if not options.search:
        return None
    raw_search = options.search.strip()
    if not raw_search:
        return None
    if options.fuzzy:
        return normalize_search_term(raw_search)
    return raw_search


def _build_inventory_all_fts_subquery(search_value: str):
    # 构建库存 ALL 模式 FTS 子查询，失败时返回 None 并走 LIKE 回退。

    try:
        return build_inventory_fts_rowid_subquery(
            search_value=search_value,
            search_field='all',
            field_map=INVENTORY_SEARCH_FTS_FIELD_MAP,
        )
    except InventoryFTSError as exc:
        logger.warning("Inventory ALL-search FTS fallback to LIKE due to configuration error: %s", exc)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Inventory ALL-search FTS fallback to LIKE due to runtime error: %s", exc)
    return None


def _apply_inventory_single_field_search(
    base,
    *,
    search_field: Optional[str],
    search_value: str,
    fuzzy: bool,
    cas_exact_or_prefix: bool,
):
    # 处理指定字段搜索，优先命中精确 CAS 和 FTS，再回退到 LIKE。

    if search_field == 'cas_number' and cas_exact_or_prefix:
        return base.where(build_cas_search_clause(Inventory.cas_number, search_value, fuzzy=fuzzy))
    if not should_use_inventory_fts(search_value):
        return _apply_inventory_like_filters(
            base,
            search_value=search_value,
            search_field=search_field,
            fuzzy=fuzzy,
        )
    try:
        return apply_inventory_fts_filter(
            base,
            search_value=search_value,
            search_field=search_field,
            field_map=INVENTORY_SEARCH_FTS_FIELD_MAP,
        )
    except InventoryFTSError as exc:
        logger.warning("Inventory FTS fallback to LIKE due to configuration error: %s", exc)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Inventory FTS fallback to LIKE due to runtime error: %s", exc)
    return _apply_inventory_like_filters(
        base,
        search_value=search_value,
        search_field=search_field,
        fuzzy=fuzzy,
    )


def _apply_inventory_all_field_search(
    base,
    *,
    search_value: str,
    fuzzy: bool,
    cas_exact_or_prefix: bool,
):
    # 处理 ALL 搜索模式，能走 FTS 时优先 FTS，否则回退到 LIKE 聚合。

    can_use_fts_all = (not fuzzy) and should_use_inventory_fts(search_value) and not cas_exact_or_prefix
    if can_use_fts_all:
        fts_rowid_subquery = _build_inventory_all_fts_subquery(search_value)
        if fts_rowid_subquery is not None:
            return base.where(Inventory.id.in_(fts_rowid_subquery))
    all_like_subquery = _build_inventory_all_like_subquery(search_value=search_value, fuzzy=fuzzy)
    if all_like_subquery is None:
        return base
    return base.where(Inventory.id.in_(all_like_subquery))


def _build_inventory_all_like_subquery(
    *,
    search_value: str,
    fuzzy: bool,
):
    # 构建 ALL 模式 LIKE 回退子查询，避免大 OR 导致的扫描放大。

    all_candidates = [
        select(Inventory.id).where(
            build_cas_search_clause(Inventory.cas_number, search_value, fuzzy=fuzzy)
        )
    ]
    text_fields = collect_search_fields(
        INVENTORY_SEARCH_SQL_FIELD_MAP,
        exclude_keys={'cas_number'},
    )
    if text_fields:
        all_candidates.append(
            select(Inventory.id).where(
                combine_or_clauses(
                    build_text_search_clause(field, search_value, fuzzy=fuzzy)
                    for field in text_fields
                )
            )
        )
    return union_id_subqueries(all_candidates)


def _apply_inventory_filters(base, *, options: InventoryFilterOptions):
    # 统一应用库存列表筛选，保持搜索语义同时降低主流程复杂度。

    filtered = _apply_inventory_static_filters(base, options=options)
    search_value = _normalize_inventory_search_value(options)
    if not search_value:
        return filtered

    cas_mode, _ = classify_cas_search(search_value, fuzzy=options.fuzzy)
    cas_exact_or_prefix = cas_mode in (CASSearchMode.EXACT, CASSearchMode.PREFIX)
    is_all_field = not options.search_field or options.search_field == 'all'
    if is_all_field:
        return _apply_inventory_all_field_search(
            filtered,
            search_value=search_value,
            fuzzy=options.fuzzy,
            cas_exact_or_prefix=cas_exact_or_prefix,
        )
    return _apply_inventory_single_field_search(
        filtered,
        search_field=options.search_field,
        search_value=search_value,
        fuzzy=options.fuzzy,
        cas_exact_or_prefix=cas_exact_or_prefix,
    )


def _apply_inventory_like_filters(
    base,
    *,
    search_value: str,
    search_field: Optional[str],
    fuzzy: bool,
):
    if search_field and search_field != 'all' and search_field in INVENTORY_SEARCH_SQL_FIELD_MAP:
        if search_field == 'cas_number':
            return base.where(
                build_cas_search_clause(Inventory.cas_number, search_value, fuzzy=fuzzy)
            )
        return base.where(
            combine_or_clauses(
                build_text_search_clause(field, search_value, fuzzy=fuzzy)
                for field in INVENTORY_SEARCH_SQL_FIELD_MAP[search_field]
            )
        )

    all_clauses = []
    for field_key, fields in INVENTORY_SEARCH_SQL_FIELD_MAP.items():
        if field_key == 'cas_number':
            all_clauses.append(
                build_cas_search_clause(Inventory.cas_number, search_value, fuzzy=fuzzy)
            )
            continue
        all_clauses.extend(
            build_text_search_clause(field, search_value, fuzzy=fuzzy)
            for field in fields
        )
    return base.where(combine_or_clauses(all_clauses))


def _build_inventory_order_expr(sort_by: Optional[str], sort_order: Optional[str]):
    # 生成库存列表排序表达式，统一处理中英文与特殊 CAS 排序规则。

    computed_remaining_percent = (
        Inventory.remaining_quantity / func.nullif(Inventory.initial_quantity, 0)
    )

    pinyin_sort_field_map = {
        'name': Inventory.name_pinyin,
        'category': Inventory.category_pinyin,
        'brand': Inventory.brand_pinyin,
        'storage_location': Inventory.storage_location_pinyin,
    }

    sort_field_map = {
        'cas_number': Inventory.cas_number,
        'name': Inventory.name,
        'category': Inventory.category,
        'storage_location': Inventory.storage_location,
        'brand': Inventory.brand,
        'remaining_quantity': Inventory.remaining_quantity,
        # 对历史数据做兜底：当存储列为空时，实时按 remaining/initial 计算用于排序。
        'remaining_percent': func.coalesce(Inventory.remaining_percent, computed_remaining_percent),
        'initial_quantity': Inventory.initial_quantity,
        'status': Inventory.status,
        'created_at': Inventory.created_at,
    }

    sort_direction = sort_order.lower() if sort_order else 'desc'
    pinyin_sort_fields = {'name', 'category', 'brand', 'storage_location'}

    if sort_by in pinyin_sort_fields:
        order_column = pinyin_sort_field_map.get(sort_by)
        # 索引优先：避免使用 `field IS NULL` 表达式，给 SQLite 机会走复合索引排序
        if sort_direction == 'asc':
            return (order_column.asc(),)
        return (order_column.desc(),)
    else:
        order_column = sort_field_map.get(sort_by, Inventory.created_at)

    if sort_by == 'cas_number':
        return order_with_special_last(order_column, BIOLOGICAL_REAGENT_CAS, sort_direction)

    return order_with_nulls_last(order_column, sort_direction)


def _attach_user_names(db: Session, items: list[Inventory]) -> list[dict]:
    # 批量补充借用人等用户名称，避免逐行查询导致额外开销。

    user_ids = set()
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
    result_data = []
    for item in items:
        item_dict = InventoryResponse.model_validate(item).model_dump(mode="json")
        item_dict = _add_specification(item_dict)
        item_dict["borrower_name"] = users_map.get(item.borrower_id)
        item_dict["last_borrower_name"] = users_map.get(item.last_borrower_id)
        item_dict["created_by_name"] = users_map.get(item.created_by_id)
        item_dict["temporary_keeper_name"] = users_map.get(item.temporary_keeper_id)
        result_data.append(item_dict)
    return result_data


def _normalize_update_payload(item: Inventory, update_data: dict) -> bool:
    # 规范化库存更新载荷并处理规格字段，返回是否更新了规格。

    specification_updated = False
    optional_string_fields = ['storage_location', 'category', 'brand', 'english_name', 'alias', 'notes']
    for field in optional_string_fields:
        if field in update_data and update_data[field] == '':
            update_data[field] = None

    if 'cas_number' in update_data and update_data['cas_number']:
        normalized_cas = normalize_cas(update_data['cas_number'])
        if normalized_cas:
            update_data['cas_number'] = normalized_cas

    if 'storage_location' in update_data:
        normalized_storage = normalize_storage_location(update_data['storage_location'])
        update_data['storage_location'] = normalized_storage

    if 'specification' in update_data:
        spec_str = update_data['specification']
        if spec_str:
            quantity, unit = parse_specification(spec_str)
            item.initial_quantity = quantity
            item.unit = unit
            specification_updated = True
        update_data.pop('specification')

    return specification_updated


# Register named/extended routes first to keep path precedence semantics.
register_inventory_extended_routes(router, SEARCH_CACHE, LIST_CACHE_PREFIX)
register_common_shelf(router, MAX_PAGE_SIZE, SEARCH_CACHE, LIST_CACHE_PREFIX)


@router.get("/", dependencies=[Depends(get_current_user)])
def list_inventory(
    db: Annotated[Session, Depends(get_db)],
    query: Annotated[InventoryListQuery, Depends()],
):
    # 按查询参数返回库存列表，并保持缓存与排序行为一致。

    skip = query.skip
    limit = query.limit
    status_filter = query.status_filter
    cas_filter = query.cas_filter
    hazardous_only = query.hazardous_only
    search = query.search
    search_field = query.search_field
    fuzzy = query.fuzzy
    sort_by = query.sort_by
    sort_order = query.sort_order

    cache_key = f"{LIST_CACHE_PREFIX}{skip}:{limit}:{search or ''}:{status_filter or ''}:{cas_filter or ''}:{hazardous_only}:{search_field or ''}:{fuzzy}:{sort_by or ''}:{sort_order or ''}"

    if sort_by and sort_by not in VALID_INVENTORY_SORT_FIELDS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="无效的排序字段")

    is_first_page = skip == 0
    has_search = bool(search or status_filter or cas_filter or hazardous_only or sort_by)
    should_use_cache = is_first_page and not has_search

    if should_use_cache:
        cached = get_cached_result(
            SEARCH_CACHE,
            cache_key,
            now=get_utc_now,
            ttl_seconds=LIST_CACHE_TTL_SECONDS,
        )
        if cached is not None:
            return {
                **cached,
                "skip": skip,
                "limit": limit,
            }

    base = _apply_inventory_filters(
        regular_inventory_query(),
        options=query.to_filter_options(),
    )

    total = db.exec(select(func.count()).select_from(base.subquery())).one()

    order_expr = _build_inventory_order_expr(sort_by, sort_order)

    secondary_order = Inventory.created_at.desc()
    tertiary_order = Inventory.id.desc()

    if limit > 0:
        items = db.exec(base.order_by(*order_expr, secondary_order, tertiary_order).offset(skip).limit(limit)).all()
    else:
        items = db.exec(base.order_by(*order_expr, secondary_order, tertiary_order)).all()

    result_data = _attach_user_names(db, items)

    result = {
        "data": result_data,
        "total": total,
        "skip": skip,
        "limit": limit,
    }

    if should_use_cache:
        cache_data = {
            "data": result["data"],
            "total": result["total"],
        }
        set_cached_result(SEARCH_CACHE, cache_key, cache_data, now=get_utc_now)

    return result

@router.get("/{inventory_id}", response_model=InventoryResponse, dependencies=[Depends(get_current_user)])
def get_inventory(inventory_id: int, db: DBSession):
    item = _get_by_id(db, inventory_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=INVENTORY_NOT_FOUND)
    response = InventoryResponse.model_validate(item).model_dump()
    return _add_specification(response)


@router.put("/{inventory_id}", response_model=InventoryResponse, dependencies=[Depends(get_current_user)])
async def update_inventory(
    inventory_id: int,
    update: InventoryUpdate,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
):
    # 更新库存记录，保持权限、字段标准化与状态联动语义不变。

    item = _get_by_id(db, inventory_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=INVENTORY_NOT_FOUND)

    _ensure_inventory_editable(item)

    update_data = update.model_dump(exclude_unset=True)
    _validate_inventory_update_cas(update_data)

    try:
        specification_updated = _normalize_update_payload(item, update_data)
    except SpecificationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    _apply_inventory_remaining_quantity_update(
        item,
        update_data=update_data,
        specification_updated=specification_updated,
    )

    for field, value in update_data.items():
        setattr(item, field, value)

    _apply_inventory_pinyin_updates(item, update_data=update_data)

    db.commit()
    db.refresh(item)
    _clear_list_cache()

    response = _attach_user_names(db, [item])[0]
    await sse_manager.broadcast(
        SSERoom.INVENTORY,
        SSEEventType.INVENTORY_UPDATED,
        {"id": inventory_id, "item": response},
        actor_client_id=get_sse_client_id(request),
    )
    return response


def _ensure_inventory_editable(item: Inventory) -> None:
    # 校验库存记录可编辑状态，避免借用中数据被直接修改。

    if item.status == InventoryStatus.BORROWED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot edit item while borrowed, please return first",
        )


def _validate_inventory_update_cas(update_data: dict) -> None:
    # 校验并标准化更新载荷中的 CAS，确保写入格式稳定且合法。

    if 'cas_number' not in update_data or not update_data['cas_number']:
        return
    normalized_cas = normalize_cas(update_data['cas_number'])
    is_valid, error_msg = validate_cas_format(normalized_cas)
    if not is_valid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid CAS number: {error_msg}")
    update_data['cas_number'] = normalized_cas


def _apply_inventory_remaining_quantity_update(
    item: Inventory,
    *,
    update_data: dict,
    specification_updated: bool,
) -> None:
    # 处理剩余量与状态联动，保证数量边界和剩余比例语义一致。

    if 'remaining_quantity' not in update_data:
        if specification_updated:
            item.remaining_percent = _compute_remaining_percent(item.remaining_quantity, item.initial_quantity)
        return

    new_remaining = update_data['remaining_quantity']
    initial_quantity = item.initial_quantity
    if (
        new_remaining is not None
        and initial_quantity is not None
        and new_remaining > initial_quantity
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Invalid remaining quantity: {new_remaining} cannot exceed "
                f"initial quantity {initial_quantity}"
            ),
        )

    item.remaining_quantity = new_remaining
    item.remaining_percent = _compute_remaining_percent(item.remaining_quantity, item.initial_quantity)
    if new_remaining is None:
        return
    item.status = InventoryStatus.CONSUMED if new_remaining == 0 else InventoryStatus.IN_STOCK


def _apply_inventory_pinyin_updates(item: Inventory, *, update_data: dict) -> None:
    # 在关键展示字段变更后重算拼音索引，保持搜索和排序结果正确。

    if not any(field in update_data for field in ['name', 'category', 'brand', 'storage_location']):
        return
    pinyin_fields = compute_pinyin_fields(
        name=item.name,
        category=item.category,
        brand=item.brand,
        storage_location=item.storage_location,
    )
    for pinyin_field, pinyin_value in pinyin_fields.items():
        setattr(item, pinyin_field, pinyin_value)


@router.delete("/{inventory_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(get_current_user)])
async def delete_inventory(
    inventory_id: int,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
):
    item = _get_by_id(db, inventory_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=INVENTORY_NOT_FOUND)
    db.delete(item)
    db.commit()
    _clear_list_cache()
    await sse_manager.broadcast(
        SSERoom.INVENTORY,
        SSEEventType.INVENTORY_DELETED,
        {"id": inventory_id},
        actor_client_id=get_sse_client_id(request),
    )
