# 从 inventory.py 拆出的扩展库存路由，用于降低模块维护复杂度。
import logging
import os
import tempfile
from typing import Any, Annotated, Dict, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlmodel import Session, select, func, update as sql_update

from app.core.auth import CurrentUser, get_current_user, require_admin
from app.core.constants import (
    IMPORT_UPLOAD_RATE_LIMIT,
    IMPORT_UPLOAD_RATE_LIMIT_WINDOW_SECONDS,
    LOW_STOCK_PERCENT,
    OVERDUE_BORROW_DAYS,
    SSEEventType,
    SSERoom,
    TEMPLATE_DOWNLOAD_RATE_LIMIT,
    TEMPLATE_DOWNLOAD_RATE_LIMIT_SCOPE,
    TEMPLATE_DOWNLOAD_WINDOW_SECONDS,
)
from app.services.sse_manager import sse_manager
from app.core.request_utils import get_client_ip, get_request_is_cli, get_sse_client_id
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
from app.services.xlsx_export import export_inventory_xlsx
from app.services.excel_service import validate_uploaded_file
from app.services.inventory_import_preview_sessions import (
    cleanup_expired_inventory_import_preview_artifacts,
    consume_inventory_import_preview_session,
    create_inventory_import_preview_session,
    discard_inventory_import_preview_session,
)
from app.services.inventory_creation import create_manual_inventory_items
from app.services.structure_cache_tasks import enqueue_structure_cache_resolution
from app.services.inventory_operation_logger import (
    SOURCE_MANUAL_ADD,
    log_inventory_export_operation,
    log_stock_in,
)
from app.services.inventory_queries import (
    get_regular_inventory_by_id,
    regular_inventory_query,
)
from app.services.log_timeline_projection import project_borrow_log
from app.services.rate_limit import enforce_rate_limit
from app.services.spec_utils import format_specification
from app.services.user_utils import batch_get_user_names

INVENTORY_NOT_FOUND = "Inventory item not found"
ACTUAL_BORROWER_NOTE_PREFIX = "actual_borrower_id:"
logger = logging.getLogger(__name__)


class InventoryImportQuery(BaseModel):
    # 库存导入接口查询参数，收口路由签名并保持参数语义。

    default_storage_location: Optional[str] = None
    default_is_hazardous: bool = False


class InventoryImportConfirmBody(BaseModel):
    preview_token: str


def _compute_remaining_percent(remaining: Optional[float], initial: Optional[float]) -> Optional[float]:
    if initial is None or initial <= 0:
        return None
    if remaining is None:
        return None
    return remaining / initial


def _get_by_id(db: Session, inventory_id: int) -> Optional[Inventory]:
    return get_regular_inventory_by_id(db, inventory_id)


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
    statement = regular_inventory_query().where(Inventory.internal_code == code)
    return db.exec(statement).first()


def _add_specification(item_dict: dict) -> dict:
    initial = item_dict.get("initial_quantity", 0)
    unit = item_dict.get("unit", "")
    item_dict["specification"] = format_specification(initial, unit)
    return item_dict


def _serialize_inventory_items(db: Session, items: list[Inventory]) -> list[dict[str, Any]]:
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
    serialized_items: list[dict[str, Any]] = []
    for item in items:
        item_dict = InventoryResponse.model_validate(item).model_dump(mode="json")
        item_dict = _add_specification(item_dict)
        item_dict["borrower_name"] = users_map.get(item.borrower_id)
        item_dict["last_borrower_name"] = users_map.get(item.last_borrower_id)
        item_dict["created_by_name"] = users_map.get(item.created_by_id)
        item_dict["temporary_keeper_name"] = users_map.get(item.temporary_keeper_id)
        serialized_items.append(item_dict)
    return serialized_items


def _serialize_inventory_item(db: Session, item: Inventory) -> dict[str, Any]:
    return _serialize_inventory_items(db, [item])[0]


def _register_cas_and_export_routes(router: APIRouter) -> None:
    @router.get("/cas/{cas_number}", dependencies=[Depends(get_current_user)])
    def check_cas_inventory(cas_number: str, db: DBSession):
        normalized_cas = normalize_cas(cas_number)

        if is_special_cas_value(normalized_cas):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Biological reagents do not support CAS query",
            )

        statement = regular_inventory_query().where(
            Inventory.cas_number == normalized_cas,
            Inventory.status != InventoryStatus.CONSUMED,
        ).order_by(Inventory.created_at.desc())

        items = db.exec(statement).all()
        borrowed_user_ids = {
            item.borrower_id
            for item in items
            if item.status == InventoryStatus.BORROWED and item.borrower_id is not None
        }
        users_map = batch_get_user_names(db, borrowed_user_ids)

        total_remaining = sum((item.remaining_quantity or 0) for item in items)
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
                    "brand": item.brand,
                    "storage_location": item.storage_location,
                    "remaining_quantity": item.remaining_quantity,
                    "specification": format_specification(item.initial_quantity, item.unit or ""),
                    "unit": item.unit,
                    "status": item.status,
                    "borrower_id": item.borrower_id,
                    "borrower_name": users_map.get(item.borrower_id),
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
        return _serialize_inventory_item(db, item)

    @router.get("/export", dependencies=[Depends(get_current_user)])
    def export_inventory(
        request: Request,
        current_user: Annotated[User, Depends(get_current_user)],
        db: DBSession,
    ):
        # 导出库存工作簿，仅包含常规库存。
        statement = regular_inventory_query().order_by(Inventory.created_at.desc())
        items = db.exec(statement).all()
        log_inventory_export_operation(
            db,
            operator_id=current_user.id,
            exported_count=len(items),
            is_cli=get_request_is_cli(request),
        )
        db.commit()

        return export_inventory_xlsx(items)


def _register_manual_and_dashboard_routes(
    router: APIRouter,
    search_cache: Dict[str, tuple[Any, Any]],
    list_cache_prefix: str,
) -> None:

    @router.post("/manual-add", response_model=dict)
    async def manual_add_inventory(
        item_data: ManualInventoryCreate,
        request: Request,
        background_tasks: BackgroundTasks,
        current_user: Annotated[User, Depends(get_current_user)],
        db: Annotated[Session, Depends(get_db)],
    ):
        created_items = create_manual_inventory_items(
            db,
            item_data,
            created_by_id=current_user.id,
        )
        for item in created_items:
            log_stock_in(
                db,
                inventory=item,
                operator_id=current_user.id,
                source=SOURCE_MANUAL_ADD,
                is_cli=get_request_is_cli(request),
            )
        db.commit()
        for item in created_items:
            db.refresh(item)

        clear_cache_by_prefix(search_cache, prefix=list_cache_prefix)
        serialized_items = _serialize_inventory_items(db, created_items)
        actor_client_id = get_sse_client_id(request)
        for ci, serialized_item in zip(created_items, serialized_items):
            await sse_manager.broadcast(
                SSERoom.INVENTORY,
                SSEEventType.INVENTORY_CREATED,
                {"id": ci.id, "item": serialized_item},
                actor_client_id=actor_client_id,
            )
        if created_items:
            enqueue_structure_cache_resolution(
                background_tasks,
                created_items[0].cas_number,
                reason="inventory.manual_add",
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
        statement = regular_inventory_query().where(
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
                    "notes": item.notes,
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

    @router.get("/dashboard/admin/borrows", dependencies=[Depends(require_admin)])
    def get_admin_borrows(db: Annotated[Session, Depends(get_db)]):
        statement = regular_inventory_query().where(
            Inventory.status == InventoryStatus.BORROWED,
        ).order_by(Inventory.updated_at.desc())

        items = db.exec(statement).all()
        now = get_utc_now()
        borrower_ids = {item.borrower_id for item in items if item.borrower_id}
        users_map = batch_get_user_names(db, borrower_ids)

        return {
            "data": [
                {
                    "inventory_id": item.id,
                    "name": item.name,
                    "cas_number": item.cas_number,
                    "remaining_quantity": item.remaining_quantity,
                    "unit": item.unit,
                    "notes": item.notes,
                    "borrow_time": utc_iso_str(item.updated_at),
                    "borrower_id": item.borrower_id,
                    "borrower_name": users_map.get(item.borrower_id),
                    "borrow_days": (now - item.updated_at).days if item.updated_at else 0,
                    "is_overdue": (
                        (now - item.updated_at).days > OVERDUE_BORROW_DAYS
                    )
                    if item.updated_at
                    else False,
                }
                for item in items
            ],
            "total": len(items),
            "overdue_count": sum(
                1
                for item in items
                if item.updated_at and (now - item.updated_at).days > OVERDUE_BORROW_DAYS
            ),
        }

    @router.get("/dashboard/pending-stockin")
    def get_pending_stockin(
        current_user: Annotated[User, Depends(get_current_user)],
        db: Annotated[Session, Depends(get_db)],
    ):
        statement = regular_inventory_query().where(
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
                    "english_name": item.english_name,
                    "alias": item.alias,
                    "category": item.category,
                    "brand": item.brand,
                    "purity": item.purity,
                    "specification": format_specification(item.initial_quantity, item.unit),
                    "initial_quantity": item.initial_quantity,
                    "remaining_quantity": item.remaining_quantity,
                    "unit": item.unit,
                    "is_hazardous": item.is_hazardous,
                    "notes": item.notes,
                    "stockin_time": utc_iso_str(item.created_at),
                }
                for item in items
            ],
            "total": len(items),
        }

    @router.get("/dashboard/admin/pending-stockin", dependencies=[Depends(require_admin)])
    def get_admin_pending_stockin(db: Annotated[Session, Depends(get_db)]):
        statement = regular_inventory_query().where(
            Inventory.storage_location.is_(None),
            Inventory.temporary_keeper_id.is_not(None),
        ).order_by(Inventory.created_at.desc())

        items = db.exec(statement).all()
        keeper_ids = {item.temporary_keeper_id for item in items if item.temporary_keeper_id}
        users_map = batch_get_user_names(db, keeper_ids)

        return {
            "data": [
                {
                    "inventory_id": item.id,
                    "order_id": item.source_order_id,
                    "name": item.name,
                    "cas_number": item.cas_number,
                    "english_name": item.english_name,
                    "alias": item.alias,
                    "category": item.category,
                    "brand": item.brand,
                    "purity": item.purity,
                    "specification": format_specification(item.initial_quantity, item.unit),
                    "initial_quantity": item.initial_quantity,
                    "remaining_quantity": item.remaining_quantity,
                    "unit": item.unit,
                    "is_hazardous": item.is_hazardous,
                    "notes": item.notes,
                    "temporary_keeper_id": item.temporary_keeper_id,
                    "temporary_keeper_name": users_map.get(item.temporary_keeper_id),
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
    def _save_import_upload(file: UploadFile) -> str:
        with tempfile.NamedTemporaryFile(delete=False, suffix=file.filename) as tmp_file:
            tmp_file.write(file.file.read())
            return tmp_file.name

    def _format_import_response(
        message: str,
        result: dict[str, Any],
        *,
        preview_token: Optional[str] = None,
    ) -> dict[str, Any]:
        return {
            "message": message,
            "success": result["success"],
            "total_rows": result["total_rows"],
            "valid_rows": result.get("valid_rows", 0),
            "created": result["created"],
            "errors_count": len(result["errors"]),
            "errors": result["errors"] if result["errors"] else None,
            "preview_items": result.get("preview_items") or None,
            "preview_token": preview_token,
        }

    def _enforce_import_upload_rate_limit(request: Request) -> None:
        client_ip = get_client_ip(request)
        enforce_rate_limit(
            scope="import_inventory_upload",
            identifier=client_ip,
            limit=IMPORT_UPLOAD_RATE_LIMIT,
            window_seconds=IMPORT_UPLOAD_RATE_LIMIT_WINDOW_SECONDS,
        )

    @router.get("/import/template")
    def get_import_template(current_user: CurrentUser):
        # 下载导入模板，CAS 列按文本格式保存。
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

    @router.post("/import/preview")
    def preview_inventory_import(
        file: Annotated[UploadFile, File(...)],
        request: Request,
        current_user: Annotated[User, Depends(get_current_user)],
        db: Annotated[Session, Depends(get_db)],
        query: Annotated[InventoryImportQuery, Depends()],
    ):
        from app.services.excel_service import preview_inventory_import_from_excel

        _enforce_import_upload_rate_limit(request)
        validate_uploaded_file(file)
        tmp_file_path = _save_import_upload(file)
        preview_session_owns_file = False

        try:
            result = preview_inventory_import_from_excel(
                db=db,
                file_path=tmp_file_path,
                default_storage_location=query.default_storage_location,
                default_is_hazardous=query.default_is_hazardous,
                user_id=current_user.id,
            )
            preview_token: Optional[str] = None
            if result["success"] and result.get("valid_rows", 0) > 0:
                preview_token = create_inventory_import_preview_session(
                    file_path=tmp_file_path,
                    user_id=current_user.id,
                    default_storage_location=query.default_storage_location,
                    default_is_hazardous=query.default_is_hazardous,
                )
                preview_session_owns_file = True
            return _format_import_response("Preview completed", result, preview_token=preview_token)
        except Exception:
            logger.exception("Preview inventory import failed")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Import preview failed, please check file format",
            )
        finally:
            if not preview_session_owns_file and os.path.exists(tmp_file_path):
                os.remove(tmp_file_path)

    @router.post("/import/confirm")
    def confirm_inventory_import(
        body: InventoryImportConfirmBody,
        request: Request,
        background_tasks: BackgroundTasks,
        current_user: Annotated[User, Depends(get_current_user)],
        db: Annotated[Session, Depends(get_db)],
    ):
        from app.services.excel_service import confirm_inventory_import_from_excel

        preview_session = None
        cleanup_expired_inventory_import_preview_artifacts()

        try:
            preview_session = consume_inventory_import_preview_session(
                body.preview_token,
                user_id=current_user.id,
            )
            result = confirm_inventory_import_from_excel(
                db=db,
                file_path=preview_session.file_path,
                default_storage_location=preview_session.default_storage_location,
                default_is_hazardous=preview_session.default_is_hazardous,
                user_id=current_user.id,
                is_cli=get_request_is_cli(request),
            )
            if result["success"] and result["created"] > 0:
                clear_cache_by_prefix(search_cache, prefix=list_cache_prefix)
                for cas_number in result.get("created_cas_numbers", []):
                    enqueue_structure_cache_resolution(
                        background_tasks,
                        cas_number,
                        reason="inventory.import",
                    )

            return _format_import_response("Import completed", result)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        except Exception:
            logger.exception("Confirm inventory import failed")
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Import failed, please check file format")
        finally:
            if preview_session is not None:
                discard_inventory_import_preview_session(
                    body.preview_token,
                    file_path=preview_session.file_path,
                )

# 解析借用人上下文，保证 public 账号借用时的代借人校验语义不变。
def _resolve_borrower_context(
    db: Session,
    *,
    current_user: User,
    borrow_data: Optional[InventoryBorrowRequest],
) -> tuple[int, Optional[int]]:
    actual_borrower_id: Optional[int] = None
    borrower_id = current_user.id
    if current_user.role != UserRole.PUBLIC:
        return borrower_id, actual_borrower_id

    actual_borrower_id = borrow_data.actual_borrower_id if borrow_data else None
    if not actual_borrower_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Public account must select a borrower when borrowing")

    actual_borrower = db.get(User, actual_borrower_id)
    if not actual_borrower or not actual_borrower.is_active or actual_borrower.role == UserRole.PUBLIC:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Please select a valid borrower")
    return actual_borrower_id, actual_borrower_id


# 统一借用数量计算，避免在借用端点重复判空与正数校验。
def _resolve_borrow_quantity(item: Inventory) -> float:
    borrow_quantity = item.remaining_quantity if item.remaining_quantity is not None else item.initial_quantity
    if borrow_quantity is None or borrow_quantity <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid inventory quantity: cannot borrow item with null or non-positive quantity",
        )
    return borrow_quantity


# 校验归还请求参数与权限，保证原错误语义和顺序一致。
def _validate_return_request(item: Inventory, return_data: InventoryBorrowReturn, current_user: User) -> None:
    if item.status != InventoryStatus.BORROWED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Item is not borrowed, current status: {item.status}",
        )
    if item.borrower_id != current_user.id and current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You are not the borrower of this item")
    if return_data.remaining_quantity is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="remaining_quantity is required",
        )
    if return_data.remaining_quantity < 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="remaining_quantity must be greater than or equal to 0",
        )
    if item.initial_quantity is not None and return_data.remaining_quantity > item.initial_quantity:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Remaining quantity ({return_data.remaining_quantity}) cannot exceed initial quantity ({item.initial_quantity})",
        )


# 获取当前未归还的最近借用日志，确保归还时日志回写口径一致。
def _get_latest_active_borrow_log(db: Session, inventory_id: int) -> Optional[BorrowLog]:
    return db.exec(
        select(BorrowLog)
        .where(
            BorrowLog.inventory_id == inventory_id,
            BorrowLog.return_time.is_(None),
        )
        .order_by(BorrowLog.borrow_time.desc())
    ).first()


def _normalize_return_notes(notes: Optional[str]) -> Optional[str]:
    normalized = (notes or "").strip()
    return normalized or None


# 应用归还后的库存状态变更，并返回低库存提示文案（若有）。
def _apply_return_to_inventory_item(item: Inventory, return_data: InventoryBorrowReturn) -> Optional[str]:
    item.remaining_quantity = return_data.remaining_quantity
    item.remaining_percent = _compute_remaining_percent(item.remaining_quantity, item.initial_quantity)
    item.last_borrower_id = item.borrower_id
    item.borrower_id = None
    if "notes" in return_data.model_fields_set:
        item.notes = _normalize_return_notes(return_data.notes)

    low_quantity_warning = None
    if return_data.remaining_quantity > 0:
        item.status = InventoryStatus.IN_STOCK
        if item.initial_quantity and item.initial_quantity > 0:
            percentage = (return_data.remaining_quantity / item.initial_quantity) * 100
            if percentage < (LOW_STOCK_PERCENT * 100):
                low_quantity_warning = f"剩余量仅剩 {percentage:.1f}%，请及时补充"
    else:
        item.status = InventoryStatus.CONSUMED
    return low_quantity_warning


# 注册借用接口，保持并发借用冲突语义和日志写入行为。
def _register_borrow_route(
    router: APIRouter,
    search_cache: Dict[str, tuple[Any, Any]],
    list_cache_prefix: str,
) -> None:
    # 借用库存项。
    @router.post("/{inventory_id}/borrow", response_model=InventoryResponse)
    async def borrow_item(
        inventory_id: int,
        request: Request,
        current_user: Annotated[User, Depends(get_current_user)],
        db: Annotated[Session, Depends(get_db)],
        borrow_data: Optional[InventoryBorrowRequest] = None,
    ):
        # 借用库存项并写入借用日志。
        item = _get_by_id(db, inventory_id)
        if not item:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=INVENTORY_NOT_FOUND)

        borrower_id, actual_borrower_id = _resolve_borrower_context(
            db,
            current_user=current_user,
            borrow_data=borrow_data,
        )
        borrow_quantity = _resolve_borrow_quantity(item)

        update_statement = (
            sql_update(Inventory)
            .where(Inventory.id == inventory_id)
            .where(Inventory.status == InventoryStatus.IN_STOCK)
            .where(Inventory.temporary_keeper_id.is_(None))
            .values(
                status=InventoryStatus.BORROWED,
                borrower_id=borrower_id,
                updated_at=get_utc_now(),
            )
        )

        result = db.exec(update_statement)
        if result.rowcount == 0:
            latest_item = _get_by_id(db, inventory_id)
            if latest_item and latest_item.temporary_keeper_id is not None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Pending stock-in item cannot be borrowed before stock-in",
                )
            if latest_item and latest_item.status == InventoryStatus.BORROWED:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Item is borrowed by another user, please refresh and retry",
                )
            latest_status = latest_item.status if latest_item else "unknown"
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Cannot borrow, current status: {latest_status}",
            )

        borrow_log = BorrowLog(
            inventory_id=inventory_id,
            borrower_id=borrower_id,
            borrow_time=get_utc_now(),
            quantity_borrowed=borrow_quantity,
            notes=_encode_actual_borrower_notes(actual_borrower_id),
        )
        db.add(borrow_log)
        db.flush([borrow_log])
        project_borrow_log(
            db,
            log=borrow_log,
            inventory=item,
            is_cli=get_request_is_cli(request),
        )
        db.commit()

        db.refresh(item)
        clear_cache_by_prefix(search_cache, prefix=list_cache_prefix)

        response = _serialize_inventory_item(db, item)
        await sse_manager.broadcast(
            SSERoom.INVENTORY,
            SSEEventType.INVENTORY_BORROWED,
            {"id": inventory_id, "item": response},
            actor_client_id=get_sse_client_id(request),
        )
        return response


# 注册归还接口，拆分参数校验与状态计算后保持原响应结构。
def _register_return_route(
    router: APIRouter,
    search_cache: Dict[str, tuple[Any, Any]],
    list_cache_prefix: str,
) -> None:
    # 归还库存项。
    @router.post("/{inventory_id}/return", response_model=dict)
    async def return_item(
        inventory_id: int,
        return_data: InventoryBorrowReturn,
        request: Request,
        current_user: Annotated[User, Depends(get_current_user)],
        db: Annotated[Session, Depends(get_db)],
    ):
        # 归还库存项并更新状态。
        item = _get_by_id(db, inventory_id)
        if not item:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=INVENTORY_NOT_FOUND)

        _validate_return_request(item, return_data, current_user)
        borrow_log = _get_latest_active_borrow_log(db, inventory_id)
        if borrow_log:
            borrow_log.return_time = get_utc_now()
            borrow_log.quantity_returned = return_data.remaining_quantity

        low_quantity_warning = _apply_return_to_inventory_item(item, return_data)
        if borrow_log:
            project_borrow_log(
                db,
                log=borrow_log,
                inventory=item,
                is_cli=get_request_is_cli(request),
            )
        db.commit()
        db.refresh(item)
        clear_cache_by_prefix(search_cache, prefix=list_cache_prefix)
        response = _serialize_inventory_item(db, item)

        await sse_manager.broadcast(
            SSERoom.INVENTORY,
            SSEEventType.INVENTORY_RETURNED,
            {"id": inventory_id, "item": response},
            actor_client_id=get_sse_client_id(request),
        )

        result = dict(response)
        if low_quantity_warning:
            result["warning"] = low_quantity_warning
        return result


# 注册借用历史接口，保留原权限校验和最近 10 条日志返回逻辑。
def _register_borrow_history_route(router: APIRouter) -> None:
    # 返回借用历史。
    @router.get("/{inventory_id}/borrow-history", dependencies=[Depends(get_current_user)])
    def get_borrow_history(
        inventory_id: int,
        current_user: Annotated[User, Depends(get_current_user)],
        db: Annotated[Session, Depends(get_db)],
    ):
        item = _get_by_id(db, inventory_id)
        if not item:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=INVENTORY_NOT_FOUND)

        if current_user.role != UserRole.ADMIN:
            allowed_user_ids = {
                uid for uid in [item.borrower_id, item.last_borrower_id, item.created_by_id] if uid is not None
            }
            if current_user.id not in allowed_user_ids:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="You are not allowed to view this item's borrow history",
                )

        logs = db.exec(
            select(BorrowLog)
            .where(
                BorrowLog.inventory_id == inventory_id,
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


# 汇总借还相关路由注册。
def _register_borrow_return_routes(
    router: APIRouter,
    search_cache: Dict[str, tuple[Any, Any]],
    list_cache_prefix: str,
) -> None:
    _register_borrow_route(router, search_cache, list_cache_prefix)
    _register_return_route(router, search_cache, list_cache_prefix)
    _register_borrow_history_route(router)


def register_inventory_extended_routes(
    router: APIRouter,
    search_cache: Dict[str, tuple[Any, Any]],
    list_cache_prefix: str,
) -> None:
    _register_cas_and_export_routes(router)
    _register_manual_and_dashboard_routes(router, search_cache, list_cache_prefix)
    _register_import_routes(router, search_cache, list_cache_prefix)
    _register_borrow_return_routes(router, search_cache, list_cache_prefix)
