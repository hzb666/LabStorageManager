"""
Inventory API Routes - Stock Management
Critical Rule #2: CAS Number normalization (data copied from Order)

Route ordering: Named routes MUST come before /{inventory_id} to avoid
the path parameter capturing strings like "export", "dashboard", etc.
"""
import logging
from datetime import datetime
from typing import Optional, Dict, Any, Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select, func

from app.database import get_db, DBSession
from app.models.inventory import Inventory, InventoryUpdate, InventoryResponse, InventoryStatus
from app.models.user import User
from app.core.auth import get_current_user, require_admin, CurrentUser
from app.core.time_utils import get_utc_now
from app.services.cas_utils import normalize_cas
from app.services.pinyin_utils import compute_pinyin_fields
from app.services.user_utils import batch_get_user_names
from app.services.sql_utils import normalize_field_sql, normalize_search_term, order_with_nulls_last
from app.services.api_utils import clear_cache_by_prefix, get_cached_result, set_cached_result
from app.services.spec_utils import parse_specification, SpecificationError, format_specification
from app.api.inventory_extended_routes import register_inventory_extended_routes

logger = logging.getLogger(__name__)

MAX_PAGE_SIZE = 100
router = APIRouter(prefix="/inventory", tags=["Inventory"])
LIST_CACHE_PREFIX = "list:"
INVENTORY_NOT_FOUND = "Inventory item not found"

# ==================== Search Cache ====================
SEARCH_CACHE: Dict[str, tuple[Any, datetime]] = {}
CACHE_TTL_SECONDS = 10


def _build_search_clause(field, pattern: str, *, fuzzy: bool):
    column = func.coalesce(field, "")
    if fuzzy:
        return normalize_field_sql(column).ilike(pattern)
    return column.ilike(pattern)


def _combine_search_clauses(clauses: list[Any]):
    expr = clauses[0]
    for clause in clauses[1:]:
        expr = expr | clause
    return expr


def _compute_remaining_percent(remaining: Optional[float], initial: Optional[float]) -> Optional[float]:
    if initial is None or initial <= 0:
        return None
    if remaining is None:
        return None
    return remaining / initial


def _get_by_id(db: Session, inventory_id: int) -> Optional[Inventory]:
    return db.get(Inventory, inventory_id)


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
        base = base.where(Inventory.is_hazardous is True)
    if not search:
        return base

    search_value = normalize_search_term(search.strip()) if fuzzy else search.strip()
    if not search_value:
        return base

    search_pattern = f"%{search_value}%"
    field_map = {
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

    if search_field and search_field != 'all' and search_field in field_map:
        clauses = [
            _build_search_clause(field, search_pattern, fuzzy=fuzzy)
            for field in field_map[search_field]
        ]
        return base.where(_combine_search_clauses(clauses))

    all_clauses = []
    for fields in field_map.values():
        all_clauses.extend(
            _build_search_clause(field, search_pattern, fuzzy=fuzzy)
            for field in fields
        )
    return base.where(_combine_search_clauses(all_clauses))


def _build_inventory_order_expr(sort_by: Optional[str], sort_order: Optional[str]):
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
        'remaining_percent': Inventory.remaining_percent,
        'initial_quantity': Inventory.initial_quantity,
        'status': Inventory.status,
        'created_at': Inventory.created_at,
        'updated_at': Inventory.updated_at,
    }

    sort_direction = sort_order.lower() if sort_order else 'desc'
    pinyin_sort_fields = {'name', 'category', 'brand', 'storage_location'}

    if sort_by in pinyin_sort_fields:
        order_column = pinyin_sort_field_map.get(sort_by)
    else:
        order_column = sort_field_map.get(sort_by, Inventory.created_at)

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


def _normalize_update_payload(item: Inventory, update_data: dict) -> None:
    optional_string_fields = ['storage_location', 'category', 'brand', 'english_name', 'alias', 'notes']
    for field in optional_string_fields:
        if field in update_data and update_data[field] == '':
            update_data[field] = None

    if 'cas_number' in update_data and update_data['cas_number']:
        normalized_cas = normalize_cas(update_data['cas_number'])
        if normalized_cas:
            update_data['cas_number'] = normalized_cas

    if 'specification' in update_data and update_data['specification']:
        spec_str = update_data['specification']
        quantity, unit = parse_specification(spec_str)
        item.initial_quantity = quantity
        item.unit = unit
        update_data.pop('specification')


# Register named/extended routes first to keep path precedence semantics.
register_inventory_extended_routes(router, SEARCH_CACHE, MAX_PAGE_SIZE, LIST_CACHE_PREFIX)


@router.get("/")
def list_inventory(
    current_user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
    skip: int = 0,
    limit: int = min(50, MAX_PAGE_SIZE),
    status_filter: Optional[InventoryStatus] = None,
    cas_filter: Optional[str] = None,
    hazardous_only: bool = False,
    search: Optional[str] = None,
    search_field: Optional[str] = None,
    fuzzy: bool = False,
    sort_by: Optional[str] = None,
    sort_order: Optional[str] = 'desc',
):
    """List inventory items with optional filters, pagination, search and sort.
    
    Requires authentication - users must be logged in to view inventory.
    """
    cache_key = f"{LIST_CACHE_PREFIX}{skip}:{limit}:{search or ''}:{status_filter or ''}:{cas_filter or ''}:{hazardous_only}:{search_field or ''}:{fuzzy}:{sort_by or ''}:{sort_order or ''}"

    is_first_page = skip == 0
    has_search = bool(search or status_filter or cas_filter or hazardous_only or sort_by)
    should_use_cache = is_first_page and not has_search

    if should_use_cache:
        cached = get_cached_result(
            SEARCH_CACHE,
            cache_key,
            now=get_utc_now,
            ttl_seconds=CACHE_TTL_SECONDS,
        )
        if cached is not None:
            return {
                **cached,
                "skip": skip,
                "limit": limit,
            }

    base = _apply_inventory_filters(
        select(Inventory),
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


@router.get("/{inventory_id}", response_model=InventoryResponse)
def get_inventory(inventory_id: int, db: DBSession, _: CurrentUser):
    item = _get_by_id(db, inventory_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=INVENTORY_NOT_FOUND)
    response = InventoryResponse.model_validate(item).model_dump()
    return _add_specification(response)


@router.put("/{inventory_id}", response_model=InventoryResponse)
def update_inventory(
    inventory_id: int,
    update: InventoryUpdate,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    item = _get_by_id(db, inventory_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=INVENTORY_NOT_FOUND)

    if item.status == InventoryStatus.BORROWED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot edit item while borrowed, please return first",
        )

    update_data = update.model_dump(exclude_unset=True)

    try:
        _normalize_update_payload(item, update_data)
    except SpecificationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if 'remaining_quantity' in update_data:
        new_remaining = update_data['remaining_quantity']
        item.remaining_quantity = new_remaining

    if 'specification' in update_data or 'remaining_quantity' in update_data:
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
    return _add_specification(response)


@router.delete("/{inventory_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_inventory(
    inventory_id: int,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_admin)],
):
    item = _get_by_id(db, inventory_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=INVENTORY_NOT_FOUND)
    db.delete(item)
    db.commit()
    _clear_list_cache()
