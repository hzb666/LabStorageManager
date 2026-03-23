"""Common shelf routes for managing grouped inventory items."""
import logging
from typing import Any, Annotated, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlmodel import Session, select, func, update as sql_update

from app.core.auth import AdminUser, get_current_user
from app.core.constants import SSEEventType, SSERoom, DEFAULT_PAGE_SIZE
from app.core.time_utils import get_utc_now
from app.database import get_db
from app.models.inventory import (
    BorrowLog,
    Inventory,
    InventoryStatus,
    InventoryUpdate,
    ManualInventoryCreate,
)
from app.models.user import User
from app.services.api_utils import clear_cache_by_prefix
from app.services.cas_utils import normalize_cas, validate_cas_format
from app.services.xlsx_export import export_common_shelf_xlsx
from app.services.inventory_creation import create_manual_inventory_items
from app.services.inventory_fts import (
    InventoryFTSError,
    apply_inventory_fts_filter,
    build_inventory_fts_rowid_subquery,
    should_use_inventory_fts,
)
from app.services.inventory_queries import (
    common_inventory_clause,
    common_inventory_query,
    get_common_inventory_by_id,
)
from app.services.pinyin_utils import compute_pinyin_fields
from app.services.search_matchers import (
    CASSearchMode,
    build_cas_search_clause,
    build_text_search_clause,
    classify_cas_search,
    collect_search_fields,
    combine_or_clauses,
    union_id_subqueries,
)
from app.services.spec_utils import SpecificationError, format_specification, parse_specification
from app.services.shelf_utils import (
    COMMON_SHELF_AVAILABLE_STATUSES,
    is_common_shelf_available_status,
    is_common_shelf_item,
    normalize_storage_location,
)
from app.services.sql_utils import normalize_search_term
from app.services.sse_manager import sse_manager
from app.services.user_utils import batch_get_user_names

INVENTORY_NOT_FOUND = "Inventory item not found"
COMMON_SHELF_CONSUME_NOTE = "common_shelf_consume"
logger = logging.getLogger(__name__)
COMMON_SHELF_SEARCH_SQL_FIELD_MAP = {
    'name': [Inventory.name, Inventory.name_pinyin, Inventory.name_pinyin_initials],
    'alias': [Inventory.alias],
    'cas_number': [Inventory.cas_number],
    'brand': [Inventory.brand, Inventory.brand_pinyin, Inventory.brand_pinyin_initials],
    'category': [
        Inventory.category,
        Inventory.category_pinyin,
        Inventory.category_pinyin_initials,
    ],
    'storage_location': [
        Inventory.storage_location,
        Inventory.storage_location_pinyin,
        Inventory.storage_location_pinyin_initials,
    ],
}
COMMON_SHELF_SEARCH_FTS_FIELD_MAP = {
    'name': ["name", "name_pinyin", "name_pinyin_initials"],
    'alias': ["alias"],
    'cas_number': ["cas_number"],
    'brand': ["brand", "brand_pinyin", "brand_pinyin_initials"],
    'category': ["category", "category_pinyin", "category_pinyin_initials"],
    'storage_location': [
        "storage_location",
        "storage_location_pinyin",
        "storage_location_pinyin_initials",
    ],
}


class CommonShelfConsumeRequest(BaseModel):
    """Request body for consuming one bottle from a common-shelf group."""
    sample_inventory_id: int


def _common_group_sort_key(item: Inventory) -> tuple:
    return (
        item.cas_number or "",
        item.name or "",
        item.brand or "",
        item.initial_quantity if item.initial_quantity is not None else -1,
        item.unit or "",
        item.storage_location or "",
    )


def _derive_common_group_status(available_bottles: int, has_running_short: bool) -> InventoryStatus:
    if available_bottles <= 0:
        return InventoryStatus.CONSUMED
    if has_running_short:
        return InventoryStatus.RUN_SHORT
    return InventoryStatus.IN_STOCK


def _same_value_clause(column, value):
    if value is None:
        return column.is_(None)
    return column == value


def _common_group_match_clauses(item: Inventory) -> list[Any]:
    return [
        common_inventory_clause(),
        _same_value_clause(Inventory.cas_number, item.cas_number),
        _same_value_clause(Inventory.name, item.name),
        _same_value_clause(Inventory.brand, item.brand),
        _same_value_clause(Inventory.initial_quantity, item.initial_quantity),
        _same_value_clause(Inventory.unit, item.unit),
        _same_value_clause(Inventory.storage_location, item.storage_location),
    ]


def _normalize_common_group_update_data(update_data: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(update_data)

    optional_string_fields = ['storage_location', 'category', 'brand', 'english_name', 'alias', 'notes']
    for field in optional_string_fields:
        if field in normalized and normalized[field] == '':
            normalized[field] = None

    if 'cas_number' in normalized and normalized['cas_number']:
        normalized_cas = normalize_cas(normalized['cas_number'])
        if not normalized_cas:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='CAS number is required')
        is_valid, error_msg = validate_cas_format(normalized_cas)
        if not is_valid:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f'Invalid CAS number: {error_msg}',
            )
        normalized['cas_number'] = normalized_cas

    if 'storage_location' in normalized:
        normalized['storage_location'] = normalize_storage_location(normalized['storage_location'])

    for disallowed_field in [
        'status',
        'remaining_quantity',
        'remaining_percent',
        'temporary_keeper_id',
        'source_order_id',
    ]:
        normalized.pop(disallowed_field, None)

    return normalized


def _compute_remaining_percent(remaining: Optional[float], initial: Optional[float]) -> Optional[float]:
    if initial is None or initial <= 0:
        return None
    if remaining is None:
        return None
    return remaining / initial

def _apply_common_shelf_like_filters(
    base,
    *,
    search_value: str,
    search_field: Optional[str],
    fuzzy: bool,
):
    if search_field and search_field != 'all' and search_field in COMMON_SHELF_SEARCH_SQL_FIELD_MAP:
        if search_field == 'cas_number':
            return base.where(
                build_cas_search_clause(Inventory.cas_number, search_value, fuzzy=fuzzy)
            )
        return base.where(
            combine_or_clauses(
                build_text_search_clause(field, search_value, fuzzy=fuzzy)
                for field in COMMON_SHELF_SEARCH_SQL_FIELD_MAP[search_field]
            )
        )

    all_clauses = []
    for field_key, fields in COMMON_SHELF_SEARCH_SQL_FIELD_MAP.items():
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


def _apply_common_shelf_filters(
    base,
    *,
    search_value: str,
    search_field: Optional[str],
    fuzzy: bool,
):
    is_all_field = not search_field or search_field == 'all'
    cas_mode, _ = classify_cas_search(search_value, fuzzy=fuzzy)
    cas_exact_or_prefix = cas_mode in (CASSearchMode.EXACT, CASSearchMode.PREFIX)

    if not is_all_field:
        if search_field == 'cas_number' and cas_exact_or_prefix:
            return base.where(
                build_cas_search_clause(
                    Inventory.cas_number,
                    search_value,
                    fuzzy=fuzzy,
                )
            )

        if not should_use_inventory_fts(search_value):
            return _apply_common_shelf_like_filters(
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
                field_map=COMMON_SHELF_SEARCH_FTS_FIELD_MAP,
            )
        except InventoryFTSError as exc:
            logger.warning(
                "Common shelf FTS fallback to LIKE due to configuration error: %s",
                exc,
            )
            return _apply_common_shelf_like_filters(
                base,
                search_value=search_value,
                search_field=search_field,
                fuzzy=fuzzy,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Common shelf FTS fallback to LIKE due to runtime error: %s",
                exc,
            )
            return _apply_common_shelf_like_filters(
                base,
                search_value=search_value,
                search_field=search_field,
                fuzzy=fuzzy,
            )

    # all 模式：分路召回候选 ID，最后 UNION 去重，避免超大 OR。
    use_fts_all = (not fuzzy) and should_use_inventory_fts(search_value) and not cas_exact_or_prefix
    all_candidates = []

    if use_fts_all:
        try:
            fts_rowid_subquery = build_inventory_fts_rowid_subquery(
                search_value=search_value,
                search_field='all',
                field_map=COMMON_SHELF_SEARCH_FTS_FIELD_MAP,
            )
            all_candidates.append(
                select(Inventory.id).where(Inventory.id.in_(fts_rowid_subquery))
            )
        except InventoryFTSError as exc:
            logger.warning(
                "Common shelf ALL-search FTS fallback to LIKE due to configuration error: %s",
                exc,
            )
            use_fts_all = False
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Common shelf ALL-search FTS fallback to LIKE due to runtime error: %s",
                exc,
            )
            use_fts_all = False

    if not use_fts_all:
        all_candidates.append(
            select(Inventory.id).where(
                build_cas_search_clause(Inventory.cas_number, search_value, fuzzy=fuzzy)
            )
        )
        text_fields = collect_search_fields(
            COMMON_SHELF_SEARCH_SQL_FIELD_MAP,
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


def _group_common_shelf_items(items: list[Inventory]) -> dict[tuple, dict[str, Any]]:
    grouped: dict[tuple, dict[str, Any]] = {}
    for item in items:
        group_key = _common_group_sort_key(item)
        group = grouped.get(group_key)
        if group is None:
            group = {
                "sample_inventory_id": item.id,
                "cas_number": item.cas_number,
                "name": item.name,
                "english_name": item.english_name,
                "alias": item.alias,
                "category": item.category,
                "brand": item.brand,
                "storage_location": item.storage_location,
                "initial_quantity": item.initial_quantity,
                "unit": item.unit,
                "is_hazardous": item.is_hazardous,
                "notes": item.notes,
                "created_at": item.created_at,
                "updated_at": item.updated_at,
                "created_by_id": item.created_by_id,
                "total_bottles": 0,
                "available_bottles": 0,
                "has_running_short": False,
            }
            grouped[group_key] = group

        group["total_bottles"] += 1
        if is_common_shelf_available_status(item.status):
            group["available_bottles"] += 1
        if item.status == InventoryStatus.RUN_SHORT:
            group["has_running_short"] = True

        if item.created_at and (
            group["created_at"] is None or item.created_at > group["created_at"]
        ):
            group["created_at"] = item.created_at
            group["sample_inventory_id"] = item.id
            group["created_by_id"] = item.created_by_id

    return grouped


def _build_common_shelf_rows(
    grouped: dict[tuple, dict[str, Any]],
    *,
    status_filter: Optional[InventoryStatus],
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for group in grouped.values():
        available_bottles = group["available_bottles"]
        row_status = _derive_common_group_status(available_bottles, group["has_running_short"])
        if status_filter and row_status != status_filter:
            continue

        rows.append(
            {
                "id": group["sample_inventory_id"],
                "sample_inventory_id": group["sample_inventory_id"],
                "cas_number": group["cas_number"],
                "name": group["name"],
                "english_name": group["english_name"],
                "alias": group["alias"],
                "category": group["category"],
                "brand": group["brand"],
                "storage_location": group["storage_location"],
                "initial_quantity": group["initial_quantity"],
                "remaining_quantity": available_bottles,
                "unit": group["unit"],
                "is_hazardous": group["is_hazardous"],
                "status": row_status,
                "available_bottles": available_bottles,
                "total_bottles": group["total_bottles"],
                "consumed_bottles": group["total_bottles"] - available_bottles,
                "created_at": group["created_at"],
                "updated_at": group["updated_at"],
                "notes": group["notes"],
                "created_by_id": group["created_by_id"],
                "is_common": True,
                "specification": format_specification(group["initial_quantity"], group["unit"]),
            }
        )

    return rows


def register_common_shelf(
    router: APIRouter,
    max_page_size: int,
    search_cache: Dict[str, tuple[Any, Any]],
    list_cache_prefix: str,
) -> None:
    """Register common shelf routes."""

    @router.get("/common-shelf", dependencies=[Depends(get_current_user)])
    def list_common_shelf(
        db: Annotated[Session, Depends(get_db)],
        skip: int = 0,
        limit: int = min(DEFAULT_PAGE_SIZE, max_page_size),
        status_filter: Optional[InventoryStatus] = None,
        search: Annotated[Optional[str], Query(max_length=100)] = None,
        search_field: Optional[str] = None,
        fuzzy: bool = False,
        sort_by: Optional[str] = None,
        sort_order: Optional[str] = 'desc',
    ):

        base = common_inventory_query()

        if search:
            search_value = normalize_search_term(search.strip()) if fuzzy else search.strip()
            if search_value:
                base = _apply_common_shelf_filters(
                    base,
                    search_value=search_value,
                    search_field=search_field,
                    fuzzy=fuzzy,
                )

        items = db.exec(base.order_by(Inventory.created_at.desc(), Inventory.id.desc())).all()

        grouped = _group_common_shelf_items(items)
        grouped_rows = _build_common_shelf_rows(grouped, status_filter=status_filter)

        sort_reverse = sort_order != 'asc'
        sort_key_map = {
            'cas_number': lambda row: row["cas_number"] or "",
            'name': lambda row: row["name"] or "",
            'category': lambda row: row["category"] or "",
            'brand': lambda row: row["brand"] or "",
            'status': lambda row: row["status"].value if hasattr(row["status"], "value") else str(row["status"]),
            'created_at': lambda row: row["created_at"] or get_utc_now(),
            'available_bottles': lambda row: row["available_bottles"],
            'total_bottles': lambda row: row["total_bottles"],
            'storage_location': lambda row: row["storage_location"] or "",
        }
        sort_key = sort_key_map.get(sort_by or '', sort_key_map['created_at'])
        grouped_rows.sort(key=sort_key, reverse=sort_reverse)

        total = len(grouped_rows)
        paged_rows = grouped_rows[skip:] if limit <= 0 else grouped_rows[skip: skip + limit]

        user_ids = {
            row["created_by_id"]
            for row in paged_rows
            if row.get("created_by_id")
        }
        users_map = batch_get_user_names(db, user_ids)

        for row in paged_rows:
            row["created_by_name"] = users_map.get(row.get("created_by_id"))
            if hasattr(row["status"], "value"):
                row["status"] = row["status"].value

        return {
            "data": paged_rows,
            "total": total,
            "skip": skip,
            "limit": limit,
        }

    @router.post("/common-shelf/consume-one")
    async def consume_one_common_shelf_item(
        payload: CommonShelfConsumeRequest,
        current_user: AdminUser,
        db: Annotated[Session, Depends(get_db)],
    ):
        sample_item = get_common_inventory_by_id(db, payload.sample_inventory_id)
        if not sample_item:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=INVENTORY_NOT_FOUND)
        if not is_common_shelf_item(sample_item):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Item is not on common shelf")

        consumed_item: Optional[Inventory] = None
        consumed_quantity: Optional[float] = None
        now = get_utc_now()

        for _ in range(5):
            candidate = db.exec(
                common_inventory_query()
                .where(
                    *_common_group_match_clauses(sample_item),
                    Inventory.status.in_(COMMON_SHELF_AVAILABLE_STATUSES),
                )
                .order_by(Inventory.created_at.asc(), Inventory.id.asc())
            ).first()

            if not candidate:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No available bottle in this group")

            consumed_quantity = candidate.remaining_quantity or candidate.initial_quantity or 1.0
            update_stmt = (
                sql_update(Inventory)
                .where(Inventory.id == candidate.id)
                .where(common_inventory_clause())
                .where(Inventory.status.in_(COMMON_SHELF_AVAILABLE_STATUSES))
                .values(
                    status=InventoryStatus.CONSUMED,
                    remaining_quantity=0,
                    remaining_percent=0,
                    borrower_id=None,
                    updated_at=now,
                )
            )
            update_result = db.exec(update_stmt)
            db.commit()
            if update_result.rowcount == 0:
                continue

            consumed_item = get_common_inventory_by_id(db, candidate.id)
            break

        if not consumed_item:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Item changed by another request, please retry",
            )

        consume_log = BorrowLog(
            inventory_id=consumed_item.id,
            borrower_id=current_user.id,
            borrow_time=now,
            is_consume=True,
            quantity_borrowed=consumed_quantity or 1.0,
            quantity_returned=0,
            notes=COMMON_SHELF_CONSUME_NOTE,
        )
        db.add(consume_log)
        db.commit()

        remaining_available = db.exec(
            select(func.count())
            .select_from(Inventory)
            .where(*_common_group_match_clauses(sample_item), Inventory.status.in_(COMMON_SHELF_AVAILABLE_STATUSES))
        ).one()

        clear_cache_by_prefix(search_cache, prefix=list_cache_prefix)
        await sse_manager.broadcast(
            SSERoom.COMMON_SHELF,
            SSEEventType.COMMON_SHELF_CONSUMED,
            {"id": payload.sample_inventory_id, "consumed_inventory_id": consumed_item.id},
        )

        return {
            "message": "已拿取一瓶",
            "consumed_inventory_id": consumed_item.id,
            "available_bottles": remaining_available,
        }

    @router.post('/common-shelf/manual-add', response_model=dict)
    async def manual_add_common_shelf_inventory(
        item_data: ManualInventoryCreate,
        current_user: Annotated[User, Depends(get_current_user)],
        db: Annotated[Session, Depends(get_db)],
    ):
        created_items = create_manual_inventory_items(
            db,
            item_data,
            created_by_id=current_user.id,
            is_common=True,
        )

        clear_cache_by_prefix(search_cache, prefix=list_cache_prefix)
        await sse_manager.broadcast(
            SSERoom.COMMON_SHELF,
            SSEEventType.COMMON_SHELF_CREATED,
            {"ids": [item.id for item in created_items]},
        )

        return {
            'message': 'Common shelf stock-in successful',
            'items_created': len(created_items),
            'item_ids': [item.id for item in created_items],
        }

    @router.put('/common-shelf/group/{sample_inventory_id}', response_model=dict, dependencies=[Depends(get_current_user)])
    async def update_common_shelf_group(
        sample_inventory_id: int,
        update: InventoryUpdate,
        db: Annotated[Session, Depends(get_db)],
    ):
        sample_item = get_common_inventory_by_id(db, sample_inventory_id)
        if not sample_item:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=INVENTORY_NOT_FOUND)
        if not is_common_shelf_item(sample_item):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Item is not on common shelf')

        update_data = _normalize_common_group_update_data(update.model_dump(exclude_unset=True))

        is_running_short = update_data.pop('is_running_short', None)

        new_initial_quantity: Optional[float] = None
        new_unit: Optional[str] = None
        if 'specification' in update_data:
            specification = update_data.pop('specification')
            if specification:
                try:
                    new_initial_quantity, new_unit = parse_specification(specification)
                except SpecificationError as e:
                    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

        group_items = db.exec(
            common_inventory_query()
            .where(*_common_group_match_clauses(sample_item))
            .order_by(Inventory.id.asc())
        ).all()
        if not group_items:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Common shelf group not found')

        for item in group_items:
            if item.status == InventoryStatus.BORROWED:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail='Cannot edit item while borrowed, please return first',
                )

            for field, value in update_data.items():
                setattr(item, field, value)

            if new_initial_quantity is not None and new_unit is not None:
                item.initial_quantity = new_initial_quantity
                item.unit = new_unit
                if item.status == InventoryStatus.CONSUMED:
                    item.remaining_quantity = 0
                else:
                    item.remaining_quantity = new_initial_quantity
                item.remaining_percent = _compute_remaining_percent(item.remaining_quantity, item.initial_quantity)

            if any(field in update_data for field in ['name', 'category', 'brand', 'storage_location']):
                pinyin_fields = compute_pinyin_fields(
                    name=item.name,
                    category=item.category,
                    brand=item.brand,
                    storage_location=item.storage_location,
                )
                for pinyin_field, pinyin_value in pinyin_fields.items():
                    setattr(item, pinyin_field, pinyin_value)

            if is_running_short is True and item.status != InventoryStatus.CONSUMED:
                item.status = InventoryStatus.RUN_SHORT
            if is_running_short is False and item.status == InventoryStatus.RUN_SHORT:
                item.status = InventoryStatus.IN_STOCK

        db.commit()
        clear_cache_by_prefix(search_cache, prefix=list_cache_prefix)
        await sse_manager.broadcast(
            SSERoom.COMMON_SHELF,
            SSEEventType.COMMON_SHELF_UPDATED,
            {"id": sample_inventory_id},
        )

        return {
            'message': 'Common shelf group updated',
            'updated_count': len(group_items),
            'sample_inventory_id': sample_inventory_id,
        }

    @router.delete('/common-shelf/group/{sample_inventory_id}', response_model=dict, dependencies=[Depends(get_current_user)])
    async def delete_common_shelf_group(
        sample_inventory_id: int,
        db: Annotated[Session, Depends(get_db)],
    ):
        sample_item = get_common_inventory_by_id(db, sample_inventory_id)
        if not sample_item:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=INVENTORY_NOT_FOUND)
        if not is_common_shelf_item(sample_item):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Item is not on common shelf')

        group_items = db.exec(common_inventory_query().where(*_common_group_match_clauses(sample_item))).all()
        if not group_items:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Common shelf group not found')

        deleted_count = len(group_items)
        for item in group_items:
            db.delete(item)

        db.commit()
        clear_cache_by_prefix(search_cache, prefix=list_cache_prefix)
        await sse_manager.broadcast(
            SSERoom.COMMON_SHELF,
            SSEEventType.COMMON_SHELF_DELETED,
            {"id": sample_inventory_id},
        )

        return {
            'message': 'Common shelf group deleted',
            'deleted_count': deleted_count,
            'sample_inventory_id': sample_inventory_id,
        }

    @router.get("/common-shelf/export", dependencies=[Depends(get_current_user)])
    def export_common_shelf(
        db: Annotated[Session, Depends(get_db)],
    ):
        """Export common shelf items (grouped by sample_inventory_id) as XLSX."""
        base = common_inventory_query()
        items = db.exec(base.order_by(Inventory.created_at.desc(), Inventory.id.desc())).all()
        grouped = _group_common_shelf_items(items)
        export_rows = _build_common_shelf_rows(grouped, status_filter=None)
        return export_common_shelf_xlsx(export_rows)
