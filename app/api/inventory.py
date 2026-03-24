"""
Inventory API Routes - Stock Management
Critical Rule #2: CAS Number normalization (data copied from Order)
All users can view/consume/add/edit/delete groups.
Route ordering: Named routes MUST come before /{inventory_id} to avoid
the path parameter capturing strings like "export", "dashboard", etc.
"""
import logging
from datetime import datetime
from typing import Optional, Dict, Any, Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
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

def _compute_remaining_percent(remaining: Optional[float], initial: Optional[float]) -> Optional[float]:
    if initial is None or initial <= 0:
        return None
    if remaining is None:
        return None
    return remaining / initial


def _get_by_id(db: Session, inventory_id: int) -> Optional[Inventory]:
    return get_regular_inventory_by_id(db, inventory_id)


def _clear_list_cache() -> None:
    cleared_count = clear_cache_by_prefix(SEARCH_CACHE, prefix=LIST_CACHE_PREFIX)
    logger.info(f"Cleared {cleared_count} list cache entries")


def _add_specification(item_dict: dict) -> dict:
    initial = item_dict.get("initial_quantity", 0)
    unit = item_dict.get("unit", "")
    item_dict["specification"] = format_specification(initial, unit)
    return item_dict


def _apply_inventory_filters(
    base,
    *,
    status_filter: Optional[InventoryStatus],
    cas_filter: Optional[str],
    hazardous_only: bool,
    search: Optional[str],
    search_field: Optional[str],
    fuzzy: bool,
):
    if status_filter:
        base = base.where(Inventory.status == status_filter)
    if cas_filter:
        base = base.where(Inventory.cas_number == normalize_cas(cas_filter))
    if hazardous_only:
        base = base.where(Inventory.is_hazardous.is_(True))
    if not search:
        return base

    search_value = normalize_search_term(search.strip()) if fuzzy else search.strip()
    if not search_value:
        return base

    is_all_field = not search_field or search_field == 'all'
    cas_mode, _ = classify_cas_search(search_value, fuzzy=fuzzy)
    cas_exact_or_prefix = cas_mode in (CASSearchMode.EXACT, CASSearchMode.PREFIX)

    if not is_all_field:
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
            return _apply_inventory_like_filters(
                base,
                search_value=search_value,
                search_field=search_field,
                fuzzy=fuzzy,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("Inventory FTS fallback to LIKE due to runtime error: %s", exc)
            return _apply_inventory_like_filters(
                base,
                search_value=search_value,
                search_field=search_field,
                fuzzy=fuzzy,
            )

    # all 模式：分路召回候选 ID，最后 UNION 去重，避免一个超大 OR。
    use_fts_all = (not fuzzy) and should_use_inventory_fts(search_value) and not cas_exact_or_prefix
    all_candidates = []

    if use_fts_all:
        try:
            fts_rowid_subquery = build_inventory_fts_rowid_subquery(
                search_value=search_value,
                search_field='all',
                field_map=INVENTORY_SEARCH_FTS_FIELD_MAP,
            )
            all_candidates.append(
                select(Inventory.id).where(Inventory.id.in_(fts_rowid_subquery))
            )
        except InventoryFTSError as exc:
            logger.warning("Inventory ALL-search FTS fallback to LIKE due to configuration error: %s", exc)
            use_fts_all = False
        except Exception as exc:  # noqa: BLE001
            logger.warning("Inventory ALL-search FTS fallback to LIKE due to runtime error: %s", exc)
            use_fts_all = False

    if not use_fts_all:
        all_candidates.append(
            select(Inventory.id).where(
                build_cas_search_clause(Inventory.cas_number, search_value, fuzzy=fuzzy)
            )
        )
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

    all_id_subquery = union_id_subqueries(all_candidates)
    if all_id_subquery is None:
        return base
    return base.where(Inventory.id.in_(all_id_subquery))


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
        item_dict = InventoryResponse.model_validate(item).model_dump()
        item_dict = _add_specification(item_dict)
        item_dict["borrower_name"] = users_map.get(item.borrower_id)
        item_dict["last_borrower_name"] = users_map.get(item.last_borrower_id)
        item_dict["created_by_name"] = users_map.get(item.created_by_id)
        item_dict["temporary_keeper_name"] = users_map.get(item.temporary_keeper_id)
        result_data.append(item_dict)
    return result_data


def _normalize_update_payload(item: Inventory, update_data: dict) -> bool:
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
    skip: int = 0,
    limit: int = min(DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
    status_filter: Optional[InventoryStatus] = None,
    cas_filter: Optional[str] = None,
    hazardous_only: bool = False,
    search: Annotated[Optional[str], Query(max_length=100)] = None,
    search_field: Optional[str] = None,
    fuzzy: bool = False,
    sort_by: Optional[str] = None,
    sort_order: Optional[str] = 'desc',
):
    """List inventory items with optional filters, pagination, search and sort.
    
    Requires authentication - users must be logged in to view inventory.
    """
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
        status_filter=status_filter,
        cas_filter=cas_filter,
        hazardous_only=hazardous_only,
        search=search,
        search_field=search_field,
        fuzzy=fuzzy,
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
    db: Annotated[Session, Depends(get_db)],
):
    item = _get_by_id(db, inventory_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=INVENTORY_NOT_FOUND)

    if item.status == InventoryStatus.BORROWED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot edit item while borrowed, please return first",
        )

    # Validate CAS check digit if being updated
    update_data = update.model_dump(exclude_unset=True)
    if 'cas_number' in update_data and update_data['cas_number']:
        normalized_cas = normalize_cas(update_data['cas_number'])
        is_valid, error_msg = validate_cas_format(normalized_cas)
        if not is_valid:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid CAS number: {error_msg}")

    try:
        specification_updated = _normalize_update_payload(item, update_data)
    except SpecificationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if 'remaining_quantity' in update_data:
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
        if new_remaining is not None:
            item.status = (
                InventoryStatus.CONSUMED if new_remaining == 0 else InventoryStatus.IN_STOCK
            )
    elif specification_updated:
        item.remaining_percent = _compute_remaining_percent(item.remaining_quantity, item.initial_quantity)

    for field, value in update_data.items():
        setattr(item, field, value)

    if any(field in update_data for field in ['name', 'category', 'brand', 'storage_location']):
        pinyin_fields = compute_pinyin_fields(
            name=item.name,
            category=item.category,
            brand=item.brand,
            storage_location=item.storage_location,
        )
        for pinyin_field, pinyin_value in pinyin_fields.items():
            setattr(item, pinyin_field, pinyin_value)

    db.commit()
    db.refresh(item)
    _clear_list_cache()

    response = InventoryResponse.model_validate(item).model_dump()
    response = _add_specification(response)
    await sse_manager.broadcast(
        SSERoom.INVENTORY,
        SSEEventType.INVENTORY_UPDATED,
        {"id": inventory_id, "item": response},
    )
    return response


@router.delete("/{inventory_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(get_current_user)])
async def delete_inventory(
    inventory_id: int,
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
    )
