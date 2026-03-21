"""Extended inventory routes extracted from inventory.py to keep modules maintainable."""
import csv
import io
import os
import tempfile
from typing import Any, Annotated, Dict, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlmodel import Session, select, func

from app.core.auth import CurrentUser, get_current_user
from app.core.config import settings
from app.core.constants import (
    DEFAULT_PAGE_SIZE,
    LOW_STOCK_PERCENT,
    MIN_IMPORT_RATE_LIMIT,
    OVERDUE_BORROW_DAYS,
    IMPORT_RATE_LIMIT_DIVISOR,
    TEMPLATE_DOWNLOAD_RATE_LIMIT,
    TEMPLATE_DOWNLOAD_RATE_LIMIT_SCOPE,
    TEMPLATE_DOWNLOAD_WINDOW_SECONDS,
)
from app.core.request_utils import get_client_ip
from app.core.time_utils import get_utc_now, to_china_time, utc_iso_str
from app.database import DBSession, get_db
from app.models.inventory import (
    BorrowLog,
    Inventory,
    InventoryBorrowRequest,
    InventoryBorrowReturn,
    InventoryResponse,
    InventoryStatus,
    ManualInventoryCreate,
)
from app.models.user import User, UserRole
from app.services.api_utils import clear_cache_by_prefix, empty_to_none
from app.services.cas_utils import normalize_cas, validate_cas_format, is_special_cas_value
from app.services.csv_utils import escape_csv_formula
from app.services.excel_service import validate_uploaded_file
from app.services.internal_code import generate_internal_code
from app.services.pinyin_utils import compute_pinyin_fields
from app.services.rate_limit import enforce_rate_limit
from app.services.spec_utils import SpecificationError, format_specification, parse_specification
from app.services.shelf_utils import (
    is_common_shelf_available_status,
    is_common_shelf_item,
    normalize_storage_location,
)
from app.services.sql_utils import normalize_field_sql, normalize_search_term
from app.services.user_utils import batch_get_user_names

INVENTORY_NOT_FOUND = "Inventory item not found"
ACTUAL_BORROWER_NOTE_PREFIX = "actual_borrower_id:"
COMMON_SHELF_CONSUME_NOTE = "common_shelf_consume"


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


def _derive_common_group_status(available_bottles: int) -> InventoryStatus:
    return InventoryStatus.IN_STOCK if available_bottles > 0 else InventoryStatus.CONSUMED


def _same_value_clause(column, value):
    if value is None:
        return column.is_(None)
    return column == value


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


def _encode_actual_borrower_notes(actual_borrower_id: Optional[int]) -> Optional[str]:
    if actual_borrower_id is None:
        return None
    return f"{ACTUAL_BORROWER_NOTE_PREFIX}{actual_borrower_id}"


def _parse_actual_borrower_id(notes: Optional[str]) -> Optional[int]:
    if not notes or not notes.startswith(ACTUAL_BORROWER_NOTE_PREFIX):
        return None
    raw_id = notes[len(ACTUAL_BORROWER_NOTE_PREFIX):].strip()
    if not raw_id.isdigit():
        return None
    return int(raw_id)


def _find_by_code(db: Session, code: str) -> Optional[Inventory]:
    statement = select(Inventory).where(Inventory.internal_code == code)
    return db.exec(statement).first()


def _add_specification(item_dict: dict) -> dict:
    initial = item_dict.get("initial_quantity", 0)
    unit = item_dict.get("unit", "")
    item_dict["specification"] = format_specification(initial, unit)
    return item_dict


def _register_cas_and_export_routes(router: APIRouter) -> None:
    @router.get("/cas/{cas_number}")
    def check_cas_inventory(cas_number: str, current_user: CurrentUser, db: DBSession):
        normalized_cas = normalize_cas(cas_number)

        if is_special_cas_value(normalized_cas):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Biological reagents do not support CAS query",
            )

        statement = select(Inventory).where(
            Inventory.cas_number == normalized_cas,
            Inventory.status != InventoryStatus.CONSUMED,
        ).order_by(Inventory.created_at.desc())

        items = db.exec(statement).all()

        total_remaining = sum(item.remaining_quantity for item in items)
        borrowed_count = sum(1 for item in items if item.status == InventoryStatus.BORROWED)
        in_stock_count = sum(1 for item in items if item.status == InventoryStatus.IN_STOCK)

        return {
            "cas_number": normalized_cas,
            "exists_in_inventory": len(items) > 0,
            "total_remaining": total_remaining,
            "in_stock_count": in_stock_count,
            "borrowed_count": borrowed_count,
            "items": [
                {
                    "id": item.id,
                    "name": item.name,
                    "storage_location": item.storage_location,
                    "remaining_quantity": item.remaining_quantity,
                    "unit": item.unit,
                    "status": item.status,
                    "borrower_id": item.borrower_id,
                }
                for item in items
            ],
        }

    @router.get("/cas/{cas_number}/total")
    def get_cas_total_quantity(cas_number: str, current_user: CurrentUser, db: DBSession):
        normalized_cas = normalize_cas(cas_number)

        if is_special_cas_value(normalized_cas):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Biological reagents do not support CAS query",
            )

        statement = select(func.sum(Inventory.remaining_quantity)).where(
            Inventory.cas_number == normalized_cas,
            Inventory.status != InventoryStatus.CONSUMED,
        )

        total = db.exec(statement).first()

        return {
            "cas_number": normalized_cas,
            "total_remaining": total or 0.0,
        }

    @router.get("/code/{internal_code}", response_model=InventoryResponse)
    def get_inventory_by_internal_code(internal_code: str, current_user: CurrentUser, db: DBSession):
        item = _find_by_code(db, internal_code)
        if not item:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=INVENTORY_NOT_FOUND)
        response = InventoryResponse.model_validate(item).model_dump()
        return _add_specification(response)

    @router.get("/export")
    def export_inventory(current_user: CurrentUser, db: DBSession):
        statement = select(Inventory).order_by(Inventory.created_at.desc())
        items = db.exec(statement).all()

        output = io.StringIO()
        output.write("\ufeff")
        writer = csv.writer(output)

        writer.writerow(
            [
                "CAS号",
                "名称",
                "英文名",
                "别名",
                "分类",
                "品牌",
                "位置",
                "初始数量",
                "剩余数量",
                "单位",
                "状态",
                "是否危险品",
                "入库时间",
                "备注",
            ]
        )

        for item in items:
            writer.writerow(
                [
                escape_csv_formula(item.cas_number),
                escape_csv_formula(item.name),
                escape_csv_formula(item.english_name or ""),
                escape_csv_formula(item.alias or ""),
                escape_csv_formula(item.category or ""),
                escape_csv_formula(item.brand or ""),
                escape_csv_formula(item.storage_location or ""),
                    item.initial_quantity,
                    item.remaining_quantity,
                    item.unit,
                    item.status.value if hasattr(item.status, "value") else item.status,
                    "是" if item.is_hazardous else "否",
                    to_china_time(item.created_at).strftime("%Y-%m-%d %H:%M:%S") if item.created_at else "",
                escape_csv_formula(item.notes or ""),
            ]
            )

        output.seek(0)
        filename = f"inventory_export_{get_utc_now().strftime('%Y%m%d_%H%M%S')}.csv"

        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f"attachment; filename={filename}"},
        )


def _register_manual_and_dashboard_routes(
    router: APIRouter,
    search_cache: Dict[str, tuple[Any, Any]],
    list_cache_prefix: str,
) -> None:

    @router.post("/manual-add", response_model=dict)
    def manual_add_inventory(
        item_data: ManualInventoryCreate,
        current_user: Annotated[User, Depends(get_current_user)],
        db: Annotated[Session, Depends(get_db)],
    ):
        normalized_cas = normalize_cas(item_data.cas_number)

        if not normalized_cas:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CAS number is required")

        is_valid, error_msg = validate_cas_format(normalized_cas)
        if not is_valid:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid CAS number: {error_msg}")

        try:
            per_bottle_value, unit = parse_specification(item_data.specification)
        except SpecificationError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

        try:
            internal_codes = generate_internal_code(db, normalized_cas, item_data.quantity_bottles)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

        optional_string_fields = ["storage_location", "category", "brand", "english_name", "alias", "notes"]
        string_fields = empty_to_none(item_data, optional_string_fields)
        normalized_storage_location = normalize_storage_location(string_fields["storage_location"])
        string_fields["storage_location"] = normalized_storage_location

        pinyin_fields = compute_pinyin_fields(
            name=item_data.name,
            category=item_data.category,
            brand=item_data.brand,
            storage_location=normalized_storage_location,
        )

        created_items = []
        for internal_code in internal_codes:
            db_inventory = Inventory(
                internal_code=internal_code,
                cas_number=normalized_cas,
                name=item_data.name,
                english_name=string_fields["english_name"],
                alias=string_fields["alias"],
                category=string_fields["category"],
                brand=string_fields["brand"],
                storage_location=string_fields["storage_location"],
                is_common=False,
                initial_quantity=per_bottle_value,
                remaining_quantity=per_bottle_value,
                remaining_percent=1,
                unit=unit,
                is_hazardous=item_data.is_hazardous,
                notes=string_fields["notes"],
                status=InventoryStatus.IN_STOCK,
                created_by_id=current_user.id,
                **pinyin_fields,
            )
            db.add(db_inventory)
            created_items.append(db_inventory)

        db.commit()
        for item in created_items:
            db.refresh(item)

        clear_cache_by_prefix(search_cache, prefix=list_cache_prefix)

        return {
            "message": "Manual stock-in successful",
            "items_created": len(created_items),
            "item_ids": [item.id for item in created_items],
        }

    @router.get("/dashboard/my-borrows")
    def get_my_borrows(
        current_user: Annotated[User, Depends(get_current_user)],
        db: Annotated[Session, Depends(get_db)],
    ):
        statement = select(Inventory).where(
            Inventory.status == InventoryStatus.BORROWED,
            Inventory.borrower_id == current_user.id,
        ).order_by(Inventory.updated_at.desc())

        items = db.exec(statement).all()
        now = get_utc_now()

        inventory_ids = [item.id for item in items]
        latest_logs_by_inventory: dict[int, BorrowLog] = {}
        actual_borrower_ids: set[int] = set()

        if inventory_ids:
            borrow_logs = db.exec(
                select(BorrowLog)
                .where(
                    BorrowLog.inventory_id.in_(inventory_ids),
                    BorrowLog.is_consume.is_(False),
                    BorrowLog.return_time.is_(None),
                )
                .order_by(BorrowLog.borrow_time.desc())
            ).all()

            for log in borrow_logs:
                if log.inventory_id in latest_logs_by_inventory:
                    continue
                latest_logs_by_inventory[log.inventory_id] = log
                actual_borrower_id = _parse_actual_borrower_id(log.notes)
                if actual_borrower_id:
                    actual_borrower_ids.add(actual_borrower_id)

        users_map = batch_get_user_names(db, actual_borrower_ids)

        return {
            "data": [
                {
                    "inventory_id": item.id,
                    "name": item.name,
                    "cas_number": item.cas_number,
                    "remaining_quantity": item.remaining_quantity,
                    "unit": item.unit,
                    "borrow_time": utc_iso_str(item.updated_at),
                    "borrower_name": (
                        users_map.get(
                            _parse_actual_borrower_id(latest_logs_by_inventory[item.id].notes)
                        )
                        if item.id in latest_logs_by_inventory
                        else None
                    ) or current_user.full_name,
                    "borrow_days": (now - item.updated_at).days if item.updated_at else 0,
                    "is_overdue": ((now - item.updated_at).days > OVERDUE_BORROW_DAYS) if item.updated_at else False,
                }
                for item in items
            ],
            "total": len(items),
            "overdue_count": sum(1 for item in items if item.updated_at and (now - item.updated_at).days > OVERDUE_BORROW_DAYS),
        }

    @router.get("/dashboard/pending-stockin")
    def get_pending_stockin(
        current_user: Annotated[User, Depends(get_current_user)],
        db: Annotated[Session, Depends(get_db)],
    ):
        statement = select(Inventory).where(
            Inventory.storage_location.is_(None),
            Inventory.temporary_keeper_id == current_user.id,
        ).order_by(Inventory.created_at.desc())

        items = db.exec(statement).all()

        return {
            "data": [
                {
                    "inventory_id": item.id,
                    "order_id": item.source_order_id,
                    "name": item.name,
                    "cas_number": item.cas_number,
                    "initial_quantity": item.initial_quantity,
                    "unit": item.unit,
                    "stockin_time": utc_iso_str(item.created_at),
                }
                for item in items
            ],
            "total": len(items),
        }


def _register_common_shelf_and_import_routes(
    router: APIRouter,
    max_page_size: int,
    search_cache: Dict[str, tuple[Any, Any]],
    list_cache_prefix: str,
) -> None:

    @router.get("/common-shelf")
    def list_common_shelf(
        current_user: Annotated[User, Depends(get_current_user)],
        db: Annotated[Session, Depends(get_db)],
        skip: int = 0,
        limit: int = min(DEFAULT_PAGE_SIZE, max_page_size),
        status_filter: Optional[InventoryStatus] = None,
        search: Optional[str] = None,
        search_field: Optional[str] = None,
        fuzzy: bool = False,
        sort_by: Optional[str] = None,
        sort_order: Optional[str] = 'desc',
    ):
        del current_user

        base = select(Inventory).where(Inventory.is_common.is_(True))

        if search:
            search_value = normalize_search_term(search.strip()) if fuzzy else search.strip()
            if search_value:
                keyword = f"%{search_value}%"
                field_map = {
                    'name': [Inventory.name, Inventory.name_pinyin, Inventory.name_pinyin_initials],
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
                if search_field and search_field != 'all' and search_field in field_map:
                    base = base.where(
                        _combine_search_clauses([
                            _build_search_clause(field, keyword, fuzzy=fuzzy)
                            for field in field_map[search_field]
                        ])
                    )
                else:
                    all_clauses = []
                    for fields in field_map.values():
                        all_clauses.extend(
                            _build_search_clause(field, keyword, fuzzy=fuzzy)
                            for field in fields
                        )
                    base = base.where(_combine_search_clauses(all_clauses))

        items = db.exec(base.order_by(Inventory.created_at.desc(), Inventory.id.desc())).all()

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
                }
                grouped[group_key] = group

            group["total_bottles"] += 1
            if is_common_shelf_available_status(item.status):
                group["available_bottles"] += 1

            if item.created_at and group["created_at"] and item.created_at > group["created_at"]:
                group["created_at"] = item.created_at
                group["sample_inventory_id"] = item.id
                group["created_by_id"] = item.created_by_id
            elif group["created_at"] is None and item.created_at is not None:
                group["created_at"] = item.created_at
                group["sample_inventory_id"] = item.id
                group["created_by_id"] = item.created_by_id

        grouped_rows: list[dict[str, Any]] = []
        for group in grouped.values():
            available_bottles = group["available_bottles"]
            row_status = _derive_common_group_status(available_bottles)
            if status_filter:
                if row_status != status_filter:
                    continue

            grouped_rows.append(
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
    def consume_one_common_shelf_item(
        payload: CommonShelfConsumeRequest,
        current_user: Annotated[User, Depends(get_current_user)],
        db: Annotated[Session, Depends(get_db)],
    ):
        sample_item = db.get(Inventory, payload.sample_inventory_id)
        if not sample_item:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=INVENTORY_NOT_FOUND)
        if not is_common_shelf_item(sample_item):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Item is not on common shelf")

        from sqlmodel import update as sql_update

        consumed_item: Optional[Inventory] = None
        consumed_quantity: Optional[float] = None
        now = get_utc_now()

        for _ in range(5):
            candidate = db.exec(
                select(Inventory)
                .where(
                    Inventory.is_common.is_(True),
                    Inventory.status == InventoryStatus.IN_STOCK,
                    _same_value_clause(Inventory.cas_number, sample_item.cas_number),
                    _same_value_clause(Inventory.name, sample_item.name),
                    _same_value_clause(Inventory.brand, sample_item.brand),
                    _same_value_clause(Inventory.initial_quantity, sample_item.initial_quantity),
                    _same_value_clause(Inventory.unit, sample_item.unit),
                    _same_value_clause(Inventory.storage_location, sample_item.storage_location),
                )
                .order_by(Inventory.created_at.asc(), Inventory.id.asc())
            ).first()

            if not candidate:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No available bottle in this group")

            consumed_quantity = candidate.remaining_quantity or candidate.initial_quantity or 1.0
            update_stmt = (
                sql_update(Inventory)
                .where(Inventory.id == candidate.id)
                .where(Inventory.is_common.is_(True))
                .where(Inventory.status == InventoryStatus.IN_STOCK)
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

            consumed_item = db.get(Inventory, candidate.id)
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
            .where(
                Inventory.is_common.is_(True),
                Inventory.status == InventoryStatus.IN_STOCK,
                _same_value_clause(Inventory.cas_number, sample_item.cas_number),
                _same_value_clause(Inventory.name, sample_item.name),
                _same_value_clause(Inventory.brand, sample_item.brand),
                _same_value_clause(Inventory.initial_quantity, sample_item.initial_quantity),
                _same_value_clause(Inventory.unit, sample_item.unit),
                _same_value_clause(Inventory.storage_location, sample_item.storage_location),
            )
        ).one()

        clear_cache_by_prefix(search_cache, prefix=list_cache_prefix)

        return {
            "message": "已拿取一瓶",
            "consumed_inventory_id": consumed_item.id,
            "available_bottles": remaining_available,
        }

    @router.get("/import/template")
    def get_import_template(current_user: CurrentUser):
        """Download Excel import template with text format for CAS column"""
        from app.services.excel_service import generate_excel_template

        enforce_rate_limit(
            scope=TEMPLATE_DOWNLOAD_RATE_LIMIT_SCOPE,
            identifier=f"user:{current_user.id}",
            limit=TEMPLATE_DOWNLOAD_RATE_LIMIT,
            window_seconds=TEMPLATE_DOWNLOAD_WINDOW_SECONDS,
        )

        excel_content = generate_excel_template()
        filename = "inventory_import_template.xlsx"

        return StreamingResponse(
            iter([excel_content]),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={filename}"},
        )

    @router.post("/import")
    def import_inventory(
        file: Annotated[UploadFile, File(...)],
        request: Request,
        current_user: Annotated[User, Depends(get_current_user)],
        db: Annotated[Session, Depends(get_db)],
        default_storage_location: Optional[str] = None,
        default_is_hazardous: bool = False,
    ):
        from app.services.excel_service import import_inventory_from_excel

        client_ip = get_client_ip(request)
        enforce_rate_limit(
            scope="import_inventory",
            identifier=client_ip,
            limit=max(MIN_IMPORT_RATE_LIMIT, settings.upload_rate_limit_count // IMPORT_RATE_LIMIT_DIVISOR),
            window_seconds=settings.upload_rate_limit_window_seconds,
        )

        validate_uploaded_file(file)

        with tempfile.NamedTemporaryFile(delete=False, suffix=file.filename) as tmp_file:
            tmp_file.write(file.file.read())
            tmp_file_path = tmp_file.name

        try:
            result = import_inventory_from_excel(
                db=db,
                file_path=tmp_file_path,
                default_storage_location=default_storage_location,
                default_is_hazardous=default_is_hazardous,
                user_id=current_user.id,
            )

            return {
                "message": "Import completed",
                "success": result["success"],
                "total_rows": result["total_rows"],
                "created": result["created"],
                "errors_count": len(result["errors"]),
                "errors": result["errors"] if result["errors"] else None,
            }
        except Exception as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Import failed: {str(e)}")
        finally:
            if os.path.exists(tmp_file_path):
                os.remove(tmp_file_path)

        # 导入成功后清理列表缓存，确保前端获取最新数据
        clear_cache_by_prefix(search_cache, prefix=list_cache_prefix)


def _register_borrow_return_routes(
    router: APIRouter,
    search_cache: Dict[str, tuple[Any, Any]],
    list_cache_prefix: str,
) -> None:

    @router.post("/{inventory_id}/borrow", response_model=InventoryResponse)
    def borrow_item(
        inventory_id: int,
        current_user: Annotated[User, Depends(get_current_user)],
        db: Annotated[Session, Depends(get_db)],
        borrow_data: Optional[InventoryBorrowRequest] = None,
    ):
        item = db.get(Inventory, inventory_id)
        if not item:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=INVENTORY_NOT_FOUND)
        if is_common_shelf_item(item):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Common shelf items do not support borrow workflow",
            )

        actual_borrower_id: Optional[int] = None
        if current_user.role == UserRole.PUBLIC:
            actual_borrower_id = borrow_data.actual_borrower_id if borrow_data else None
            if not actual_borrower_id:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Public account must select a borrower when borrowing")

            actual_borrower = db.get(User, actual_borrower_id)
            if not actual_borrower or not actual_borrower.is_active or actual_borrower.role == UserRole.PUBLIC:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Please select a valid borrower")

        from sqlmodel import update as sql_update

        update_statement = (
            sql_update(Inventory)
            .where(Inventory.id == inventory_id)
            .where(Inventory.status == InventoryStatus.IN_STOCK)
            .where(Inventory.is_common.is_(False))
            .values(
                status=InventoryStatus.BORROWED,
                borrower_id=current_user.id,
                updated_at=get_utc_now(),
            )
        )

        result = db.exec(update_statement)
        db.commit()

        if result.rowcount == 0:
            db.refresh(item)
            if item.status == InventoryStatus.BORROWED:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Item is borrowed by another user, please refresh and retry",
                )
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Cannot borrow, current status: {item.status}")

        borrow_log = BorrowLog(
            inventory_id=inventory_id,
            borrower_id=current_user.id,
            borrow_time=get_utc_now(),
            is_consume=False,
            quantity_borrowed=item.remaining_quantity,
            notes=_encode_actual_borrower_notes(actual_borrower_id),
        )
        db.add(borrow_log)
        db.commit()

        db.refresh(item)
        clear_cache_by_prefix(search_cache, prefix=list_cache_prefix)

        response = InventoryResponse.model_validate(item).model_dump()
        return _add_specification(response)

    @router.post("/{inventory_id}/return", response_model=dict)
    def return_item(
        inventory_id: int,
        return_data: InventoryBorrowReturn,
        current_user: Annotated[User, Depends(get_current_user)],
        db: Annotated[Session, Depends(get_db)],
    ):
        item = _get_by_id(db, inventory_id)
        if not item:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=INVENTORY_NOT_FOUND)

        if item.status != InventoryStatus.BORROWED:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Item is not borrowed, current status: {item.status}",
            )

        if item.borrower_id != current_user.id and current_user.role != UserRole.ADMIN:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You are not the borrower of this item")

        if return_data.remaining_quantity > item.initial_quantity:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Remaining quantity ({return_data.remaining_quantity}) cannot exceed initial quantity ({item.initial_quantity})",
            )

        borrow_log = db.exec(
            select(BorrowLog)
            .where(
                BorrowLog.inventory_id == inventory_id,
                BorrowLog.is_consume.is_(False),
                BorrowLog.return_time.is_(None),
            )
            .order_by(BorrowLog.borrow_time.desc())
        ).first()

        if borrow_log:
            borrow_log.return_time = get_utc_now()
            borrow_log.quantity_returned = return_data.remaining_quantity

        item.remaining_quantity = return_data.remaining_quantity
        item.remaining_percent = _compute_remaining_percent(item.remaining_quantity, item.initial_quantity)
        item.unit = return_data.unit if return_data.unit else item.unit
        item.last_borrower_id = item.borrower_id
        item.borrower_id = None

        low_quantity_warning = None
        if return_data.remaining_quantity > 0:
            item.status = InventoryStatus.IN_STOCK
            percentage = (return_data.remaining_quantity / item.initial_quantity) * 100
            if percentage < (LOW_STOCK_PERCENT * 100):
                low_quantity_warning = f"剩余量仅剩 {percentage:.1f}%，请及时补充"
        else:
            item.status = InventoryStatus.CONSUMED

        db.commit()
        db.refresh(item)
        clear_cache_by_prefix(search_cache, prefix=list_cache_prefix)

        result = item.model_dump()
        if low_quantity_warning:
            result["warning"] = low_quantity_warning
        return result

    @router.get("/{inventory_id}/borrow-history")
    def get_borrow_history(
        inventory_id: int,
        db: Annotated[Session, Depends(get_db)],
        current_user: Annotated[User, Depends(get_current_user)],
    ):
        item = _get_by_id(db, inventory_id)
        if not item:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=INVENTORY_NOT_FOUND)

        logs = db.exec(
            select(BorrowLog)
            .where(
                BorrowLog.inventory_id == inventory_id,
                BorrowLog.is_consume.is_(False),
            )
            .order_by(BorrowLog.borrow_time.desc())
            .limit(10)
        ).all()

        actual_borrower_ids = {
            actual_borrower_id
            for log in logs
            for actual_borrower_id in [_parse_actual_borrower_id(log.notes)]
            if actual_borrower_id
        }
        users_map = batch_get_user_names(db, actual_borrower_ids)

        return {
            "inventory_id": inventory_id,
            "name": item.name,
            "history": [
                {
                    "id": log.id,
                    "borrower_id": log.borrower_id,
                    "borrow_time": utc_iso_str(log.borrow_time),
                    "return_time": utc_iso_str(log.return_time),
                    "quantity_borrowed": log.quantity_borrowed,
                    "quantity_returned": log.quantity_returned,
                    "actual_borrower_id": _parse_actual_borrower_id(log.notes),
                    "actual_borrower_name": users_map.get(_parse_actual_borrower_id(log.notes)),
                }
                for log in logs
            ],
        }


def register_inventory_extended_routes(
    router: APIRouter,
    search_cache: Dict[str, tuple[Any, Any]],
    max_page_size: int,
    list_cache_prefix: str,
) -> None:
    _register_cas_and_export_routes(router)
    _register_manual_and_dashboard_routes(router, search_cache, list_cache_prefix)
    _register_common_shelf_and_import_routes(router, max_page_size, search_cache, list_cache_prefix)
    _register_borrow_return_routes(router, search_cache, list_cache_prefix)
