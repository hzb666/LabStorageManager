"""Extended inventory routes extracted from inventory.py to keep modules maintainable."""
import csv
import io
import os
import tempfile
from typing import Any, Annotated, Dict, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select, func

from app.core.auth import CurrentUser, get_current_user
from app.core.config import settings
from app.core.request_utils import get_client_ip
from app.core.time_utils import get_utc_now, to_china_time
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
from app.services.sql_utils import normalize_field_sql, normalize_search_term
from app.services.user_utils import batch_get_user_names

INVENTORY_NOT_FOUND = "Inventory item not found"
ACTUAL_BORROWER_NOTE_PREFIX = "actual_borrower_id:"


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
                detail="生物试剂不支持 CAS 查询",
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
                detail="生物试剂不支持 CAS 查询",
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

        internal_codes = generate_internal_code(db, normalized_cas, item_data.quantity_bottles)

        pinyin_fields = compute_pinyin_fields(
            name=item_data.name,
            category=item_data.category,
            brand=item_data.brand,
            storage_location=item_data.storage_location,
        )

        optional_string_fields = ["storage_location", "category", "brand", "english_name", "alias", "notes"]
        string_fields = empty_to_none(item_data, optional_string_fields)

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
                .where(BorrowLog.inventory_id.in_(inventory_ids), BorrowLog.return_time.is_(None))
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
                    "borrow_time": item.updated_at.isoformat() + 'Z' if item.updated_at else None,
                    "borrower_name": (
                        users_map.get(
                            _parse_actual_borrower_id(latest_logs_by_inventory[item.id].notes)
                        )
                        if item.id in latest_logs_by_inventory
                        else None
                    ) or current_user.full_name,
                    "borrow_days": (now - item.updated_at).days if item.updated_at else 0,
                    "is_overdue": ((now - item.updated_at).days > 3) if item.updated_at else False,
                }
                for item in items
            ],
            "total": len(items),
            "overdue_count": sum(1 for item in items if item.updated_at and (now - item.updated_at).days > 3),
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
                    "name": item.name,
                    "cas_number": item.cas_number,
                    "initial_quantity": item.initial_quantity,
                    "unit": item.unit,
                    "stockin_time": item.created_at.isoformat() + 'Z' if item.created_at else None,
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
        limit: int = min(50, max_page_size),
        status_filter: Optional[InventoryStatus] = None,
        search: Optional[str] = None,
        search_field: Optional[str] = None,
        fuzzy: bool = False,
        sort_by: Optional[str] = None,
        sort_order: Optional[str] = 'desc',
    ):
        del current_user

        base = select(Inventory).where(Inventory.storage_location == "常用货架")

        if status_filter:
            base = base.where(Inventory.status == status_filter)

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

        count_stmt = select(func.count()).select_from(base.subquery())
        total = db.exec(count_stmt).one()

        sortable = {
            'cas_number': Inventory.cas_number,
            'name': Inventory.name,
            'category': Inventory.category,
            'brand': Inventory.brand,
            'status': Inventory.status,
            'created_at': Inventory.created_at,
        }
        order_column = sortable.get(sort_by or '', Inventory.created_at)
        order_expr = order_column.asc() if sort_order == 'asc' else order_column.desc()

        items = db.exec(base.order_by(order_expr, Inventory.id.desc()).offset(skip).limit(limit)).all()

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

        return {
            "data": result_data,
            "total": total,
            "skip": skip,
            "limit": limit,
        }

    @router.get("/import/template")
    def get_import_template(current_user: CurrentUser):
        """Download Excel import template with text format for CAS column"""
        from app.services.excel_service import generate_excel_template

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
            limit=max(3, settings.upload_rate_limit_count // 2),
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

        actual_borrower_id: Optional[int] = None
        if current_user.role == UserRole.PUBLIC:
            actual_borrower_id = borrow_data.actual_borrower_id if borrow_data else None
            if not actual_borrower_id:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="公用账户借用时必须选择借用人")

            actual_borrower = db.get(User, actual_borrower_id)
            if not actual_borrower or not actual_borrower.is_active or actual_borrower.role == UserRole.PUBLIC:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请选择有效借用人")

        from sqlmodel import update as sql_update

        update_statement = (
            sql_update(Inventory)
            .where(Inventory.id == inventory_id)
            .where(Inventory.status == InventoryStatus.IN_STOCK)
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
            .where(BorrowLog.inventory_id == inventory_id, BorrowLog.return_time.is_(None))
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
            if percentage < 20:
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
            .where(BorrowLog.inventory_id == inventory_id)
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
                    "borrow_time": log.borrow_time.isoformat() + 'Z' if log.borrow_time else None,
                    "return_time": log.return_time.isoformat() + 'Z' if log.return_time else None,
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
