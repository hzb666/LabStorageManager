"""Common shelf routes for managing grouped inventory items. All users can view/consume/add/edit/delete groups."""
import logging
from decimal import Decimal, InvalidOperation
from typing import Any, Annotated, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlmodel import Session, select, update as sql_update

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
from app.services.common_name_utils import is_std_marked_name, strip_std_name_marker
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
from app.services.spec_utils import (
    SpecificationError,
    UNIT_CANONICAL,
    format_specification,
    parse_specification,
)
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
_DECIMAL_1000 = Decimal("1000")
_DECIMAL_1000000 = Decimal("1000000")
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
    _, normalized_quantity, normalized_unit = _normalize_spec_for_group(item.initial_quantity, item.unit)
    return (
        item.cas_number or "",
        _normalize_brand_for_group(item.brand),
        normalized_quantity if normalized_quantity is not None else -1,
        normalized_unit or "",
        _normalize_storage_for_group(item.storage_location),
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


def _normalize_brand_for_group(brand: Optional[str]) -> str:
    return (brand or "").strip().casefold()


def _normalize_storage_for_group(storage_location: Optional[str]) -> str:
    return (storage_location or "").strip().casefold()


def _format_decimal_number(value: Decimal) -> str:
    normalized = value.normalize()
    number = format(normalized, "f")
    if "." in number:
        number = number.rstrip("0").rstrip(".")
    return number or "0"


def _decimal_from_float(value: Optional[float]) -> Optional[Decimal]:
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None


def _normalize_spec_for_group(
    initial_quantity: Optional[float],
    unit: Optional[str],
) -> tuple[str, Optional[float], Optional[str]]:
    quantity = _decimal_from_float(initial_quantity)
    if quantity is None:
        normalized_unit = UNIT_CANONICAL.get((unit or "").strip().lower(), (unit or "").strip())
        spec_key = f"none|{normalized_unit.casefold()}"
        return spec_key, initial_quantity, normalized_unit or None

    raw_unit = (unit or "").strip()
    canonical_unit = UNIT_CANONICAL.get(raw_unit.lower(), raw_unit)
    unit_lower = canonical_unit.lower()

    converted_value = quantity
    display_unit = canonical_unit

    if unit_lower in {"ml", "l"}:
        ml_value = quantity if unit_lower == "ml" else quantity * _DECIMAL_1000
        if ml_value < _DECIMAL_1000:
            converted_value = ml_value
            display_unit = "mL"
        else:
            converted_value = ml_value / _DECIMAL_1000
            display_unit = "L"
    elif unit_lower in {"mg", "g", "kg"}:
        mg_value = quantity
        if unit_lower == "g":
            mg_value = quantity * _DECIMAL_1000
        elif unit_lower == "kg":
            mg_value = quantity * _DECIMAL_1000000

        if mg_value < _DECIMAL_1000:
            converted_value = mg_value
            display_unit = "mg"
        elif mg_value < _DECIMAL_1000000:
            converted_value = mg_value / _DECIMAL_1000
            display_unit = "g"
        else:
            converted_value = mg_value / _DECIMAL_1000000
            display_unit = "kg"

    spec_key = f"{_format_decimal_number(converted_value)}|{display_unit.casefold()}"
    return spec_key, float(converted_value), display_unit


def _is_item_newer(item: Inventory, current_item: Optional[Inventory]) -> bool:
    if current_item is None:
        return True
    item_time = item.created_at or get_utc_now()
    current_time = current_item.created_at or get_utc_now()
    if item_time != current_time:
        return item_time > current_time
    return (item.id or 0) > (current_item.id or 0)


def _search_name_alias_matched_cas(
    db: Session,
    *,
    search_value: str,
    fuzzy: bool,
) -> set[str]:
    match_query = common_inventory_query().where(
        combine_or_clauses(
            [
                build_text_search_clause(Inventory.name, search_value, fuzzy=fuzzy),
                build_text_search_clause(Inventory.name_pinyin, search_value, fuzzy=fuzzy),
                build_text_search_clause(Inventory.name_pinyin_initials, search_value, fuzzy=fuzzy),
                build_text_search_clause(Inventory.alias, search_value, fuzzy=fuzzy),
            ]
        )
    )
    matched_items = db.exec(match_query).all()
    return {item.cas_number for item in matched_items if item.cas_number}


def _find_common_group_items(
    db: Session,
    sample_item: Inventory,
    *,
    available_only: bool = False,
) -> list[Inventory]:
    query = common_inventory_query().where(
        _same_value_clause(Inventory.cas_number, sample_item.cas_number),
    )
    if available_only:
        query = query.where(Inventory.status.in_(COMMON_SHELF_AVAILABLE_STATUSES))

    candidates = db.exec(query.order_by(Inventory.created_at.asc(), Inventory.id.asc())).all()
    sample_key = _common_group_sort_key(sample_item)
    return [item for item in candidates if _common_group_sort_key(item) == sample_key]


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
    cas_alias_map: dict[str, Inventory] = {}

    for item in items:
        alias = (item.alias or "").strip()
        if not alias or not item.cas_number:
            continue
        current = cas_alias_map.get(item.cas_number)
        if _is_item_newer(item, current):
            cas_alias_map[item.cas_number] = item

    for item in items:
        group_key = _common_group_sort_key(item)
        _, normalized_quantity, normalized_unit = _normalize_spec_for_group(item.initial_quantity, item.unit)
        clean_name = strip_std_name_marker(item.name)
        clean_alias = strip_std_name_marker(item.alias)
        group = grouped.get(group_key)
        if group is None:
            group = {
                "sample_inventory_id": item.id,
                "cas_number": item.cas_number,
                "name": clean_name,
                "english_name": item.english_name,
                "alias": clean_alias,
                "category": item.category,
                "brand": item.brand,
                "storage_location": item.storage_location,
                "initial_quantity": normalized_quantity,
                "unit": normalized_unit,
                "is_hazardous": item.is_hazardous,
                "notes": item.notes,
                "created_at": item.created_at,
                "updated_at": item.updated_at,
                "created_by_id": item.created_by_id,
                "total_bottles": 0,
                "available_bottles": 0,
                "has_running_short": False,
                "group_name_candidates": [],
            }
            grouped[group_key] = group

        group["group_name_candidates"].append(
            {
                "name": clean_name,
                "is_std": is_std_marked_name(item.name),
                "created_at": item.created_at,
                "id": item.id or 0,
            }
        )

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

    for group in grouped.values():
        name_candidates = sorted(
            group.pop("group_name_candidates", []),
            key=lambda entry: (
                entry["created_at"] or get_utc_now(),
                entry["id"],
            ),
            reverse=True,
        )
        std_candidates = [entry for entry in name_candidates if entry["is_std"] and entry["name"]]
        selected_candidate = None
        if std_candidates:
            selected_candidate = std_candidates[0]
        elif name_candidates:
            selected_candidate = name_candidates[0]
        if selected_candidate:
            group["name"] = selected_candidate["name"]

        dedup_names: list[str] = []
        seen_names: set[str] = set()
        for entry in name_candidates:
            normalized_name = (entry["name"] or "").strip()
            if not normalized_name:
                continue
            if normalized_name in seen_names:
                continue
            seen_names.add(normalized_name)
            dedup_names.append(normalized_name)
        group["group_names"] = dedup_names
        group["other_names"] = [name for name in dedup_names if name != group["name"]]

        cas_key = group.get("cas_number")
        alias_source = cas_alias_map.get(cas_key)
        if alias_source:
            group["alias"] = strip_std_name_marker(alias_source.alias)

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
                "group_names": group.get("group_names", []),
                "other_names": group.get("other_names", []),
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

        if search and search_value and search_field in {None, 'all', 'name', 'alias'}:
            cas_set = _search_name_alias_matched_cas(
                db,
                search_value=search_value,
                fuzzy=fuzzy,
            )
            if cas_set:
                expanded_items = db.exec(
                    common_inventory_query()
                    .where(Inventory.cas_number.in_(cas_set))
                    .order_by(Inventory.created_at.desc(), Inventory.id.desc())
                ).all()
                if search_field in {'name', 'alias'}:
                    items = expanded_items
                else:
                    merged_items: dict[int, Inventory] = {item.id: item for item in items if item.id is not None}
                    for expanded_item in expanded_items:
                        if expanded_item.id is not None:
                            merged_items[expanded_item.id] = expanded_item
                    items = list(merged_items.values())

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
            group_available_items = _find_common_group_items(db, sample_item, available_only=True)
            candidate = group_available_items[0] if group_available_items else None

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

        remaining_available = len(_find_common_group_items(db, sample_item, available_only=True))

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

        group_items = _find_common_group_items(db, sample_item)
        group_items.sort(key=lambda item: item.id or 0)
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
                    name=strip_std_name_marker(item.name),
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

        group_items = _find_common_group_items(db, sample_item)
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
