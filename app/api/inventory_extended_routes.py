"""Extended inventory routes extracted from inventory.py to keep modules maintainable."""
import os
import tempfile
from typing import Any, Annotated, Dict, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select, func, update as sql_update

from app.core.auth import CurrentUser, get_current_user
from app.core.config import settings
from app.core.constants import (
    LOW_STOCK_PERCENT,
    MIN_IMPORT_RATE_LIMIT,
    OVERDUE_BORROW_DAYS,
    IMPORT_RATE_LIMIT_DIVISOR,
    SSEEventType,
    SSERoom,
    TEMPLATE_DOWNLOAD_RATE_LIMIT,
    TEMPLATE_DOWNLOAD_RATE_LIMIT_SCOPE,
    TEMPLATE_DOWNLOAD_WINDOW_SECONDS,
)
from app.services.sse_manager import sse_manager
from app.core.request_utils import get_client_ip
from app.core.time_utils import get_utc_now, utc_iso_str
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
from app.services.api_utils import clear_cache_by_prefix
from app.services.cas_utils import normalize_cas, is_special_cas_value
from app.services.csv_export import export_inventory_csv
from app.services.excel_service import validate_uploaded_file
from app.services.inventory_creation import create_manual_inventory_items
from app.services.rate_limit import enforce_rate_limit
from app.services.spec_utils import format_specification
from app.services.shelf_utils import is_common_shelf_item
from app.services.user_utils import batch_get_user_names

INVENTORY_NOT_FOUND = "Inventory item not found"
ACTUAL_BORROWER_NOTE_PREFIX = "actual_borrower_id:"


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
    @router.get("/cas/{cas_number}", dependencies=[Depends(get_current_user)])
    def check_cas_inventory(cas_number: str, db: DBSession):
        normalized_cas = normalize_cas(cas_number)

        if is_special_cas_value(normalized_cas):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Biological reagents do not support CAS query",
            )

        statement = select(Inventory).where(
            Inventory.cas_number == normalized_cas,
            Inventory.status != InventoryStatus.CONSUMED,
            Inventory.is_common.is_(False),
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

    @router.get("/cas/{cas_number}/total", dependencies=[Depends(get_current_user)])
    def get_cas_total_quantity(cas_number: str, db: DBSession):
        normalized_cas = normalize_cas(cas_number)

        if is_special_cas_value(normalized_cas):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Biological reagents do not support CAS query",
            )

        statement = select(func.sum(Inventory.remaining_quantity)).where(
            Inventory.cas_number == normalized_cas,
            Inventory.status != InventoryStatus.CONSUMED,
            Inventory.is_common.is_(False),
        )

        total = db.exec(statement).first()

        return {
            "cas_number": normalized_cas,
            "total_remaining": total or 0.0,
        }

    @router.get("/code/{internal_code}", response_model=InventoryResponse, dependencies=[Depends(get_current_user)])
    def get_inventory_by_internal_code(internal_code: str, db: DBSession):
        item = _find_by_code(db, internal_code)
        if not item:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=INVENTORY_NOT_FOUND)
        response = InventoryResponse.model_validate(item).model_dump()
        return _add_specification(response)

    @router.get("/export", dependencies=[Depends(get_current_user)])
    def export_inventory(db: DBSession):
        """Export regular inventory items (excluding common shelf items)."""
        statement = select(Inventory).where(
            Inventory.is_common.is_(False)
        ).order_by(Inventory.created_at.desc())
        items = db.exec(statement).all()

        # Get user map for created_by_id
        user_ids = {item.created_by_id for item in items if item.created_by_id}
        users_map = batch_get_user_names(db, user_ids) if user_ids else {}

        return export_inventory_csv(items, users_map)


def _register_manual_and_dashboard_routes(
    router: APIRouter,
    search_cache: Dict[str, tuple[Any, Any]],
    list_cache_prefix: str,
) -> None:

    @router.post("/manual-add", response_model=dict)
    async def manual_add_inventory(
        item_data: ManualInventoryCreate,
        current_user: Annotated[User, Depends(get_current_user)],
        db: Annotated[Session, Depends(get_db)],
    ):
        created_items = create_manual_inventory_items(
            db,
            item_data,
            created_by_id=current_user.id,
            is_common=False,
        )

        clear_cache_by_prefix(search_cache, prefix=list_cache_prefix)
        for ci in created_items:
            await sse_manager.broadcast(
                SSERoom.INVENTORY,
                SSEEventType.INVENTORY_CREATED,
                {"id": ci.id},
            )

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
            Inventory.is_common.is_(False),
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


def _register_import_routes(
    router: APIRouter,
    search_cache: Dict[str, tuple[Any, Any]],
    list_cache_prefix: str,
) -> None:

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
    async def borrow_item(
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
        response = _add_specification(response)
        await sse_manager.broadcast(
            SSERoom.INVENTORY,
            SSEEventType.INVENTORY_BORROWED,
            {"id": inventory_id, "item": response},
        )
        return response

    @router.post("/{inventory_id}/return", response_model=dict)
    async def return_item(
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

        await sse_manager.broadcast(
            SSERoom.INVENTORY,
            SSEEventType.INVENTORY_RETURNED,
            {"id": inventory_id, "item": item.model_dump()},
        )

        result = item.model_dump()
        if low_quantity_warning:
            result["warning"] = low_quantity_warning
        return result

    @router.get("/{inventory_id}/borrow-history", dependencies=[Depends(get_current_user)])
    def get_borrow_history(
        inventory_id: int,
        db: Annotated[Session, Depends(get_db)],
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
    list_cache_prefix: str,
) -> None:
    _register_cas_and_export_routes(router)
    _register_manual_and_dashboard_routes(router, search_cache, list_cache_prefix)
    _register_import_routes(router, search_cache, list_cache_prefix)
    _register_borrow_return_routes(router, search_cache, list_cache_prefix)
