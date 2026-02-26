"""
Inventory API Routes - Stock Management
Critical Rule #2: CAS Number normalization (data copied from Order)

Route ordering: Named routes MUST come before /{inventory_id} to avoid
the path parameter capturing strings like "export", "dashboard", etc.
"""
import csv
import io
from pypinyin import lazy_pinyin
import logging
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select, func, case

from app.database import get_db
from app.models.inventory import (
    Inventory,
    InventoryUpdate,
    InventoryResponse,
    InventoryStatus,
    InventoryBorrowReturn,
    BorrowLog,
    ManualInventoryCreate,
)
from app.models.user import User, UserRole
from app.core.auth import get_current_user, require_admin
from app.services.cas_utils import normalize_cas
from app.services.internal_code import generate_internal_code
from app.services.spec_utils import parse_specification, SpecificationError

logger = logging.getLogger(__name__)


def _to_pinyin_sort_key(text: str) -> str:
    """
    将文本转换为拼音排序键
    用于中文按拼音排序，将中文转换为对应的拼音字母序列
    """
    if not text:
        return ''
    # 使用 lazpinyin 获取拼音首字母，风格为普通风格（不带声调）
    pinyin_list = lazy_pinyin(text, style=0)  # Style 0 = NORMAL
    return ''.join(pinyin_list)

router = APIRouter(prefix="/inventory", tags=["Inventory"])

# ==================== File Upload Security ====================
# 允许的文件扩展名
ALLOWED_EXTENSIONS = {".xlsx", ".xls", ".csv"}

# 允许的 MIME 类型
ALLOWED_MIME_TYPES = {
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel",
    ".csv": "text/csv",
}

# 文件魔数（文件头签名）
FILE_MAGIC_BYTES = {
    ".xlsx": b"PK\x03\x04",  # ZIP-based (Office Open XML)
    ".xls": b"\xd0\xcf\x11\xe0",  # OLE2 compound document
    ".csv": b"",  # CSV is text, no magic bytes needed
}

# 最大文件大小 (10MB)
MAX_FILE_SIZE = 10 * 1024 * 1024


def validate_uploaded_file(file: UploadFile) -> None:
    """
    验证上传的文件类型和内容
    包括：文件扩展名、MIME类型、文件魔数、文件大小
    """
    # 1. 检查文件扩展名
    ext = Path(file.filename).suffix.lower() if file.filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid file type. Only .xlsx, .xls, .csv are allowed"
        )

    # 2. 检查文件大小
    file.file.seek(0, 2)  # Seek to end
    file_size = file.file.tell()
    file.file.seek(0)  # Reset to start

    if file_size > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File size exceeds 10MB limit"
        )

    if file_size == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File is empty"
        )

    # 3. 检查文件魔数
    header = file.file.read(8)
    file.file.seek(0)  # Reset to start

    if ext == ".xlsx":
        # XLSX is ZIP-based, check for PK\x03\x04
        if not header.startswith(b"PK\x03\x04"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid XLSX file format"
            )
    elif ext == ".xls":
        # XLS is OLE2 compound document
        if not header.startswith(b"\xd0\xcf\x11\xe0"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid XLS file format"
            )
    # CSV doesn't need magic bytes check (it's plain text)

# ==================== Search Cache ====================
# 简单内存缓存，用于减少重复搜索查询
SEARCH_CACHE: Dict[str, tuple[Any, datetime]] = {}
CACHE_TTL_SECONDS = 60  # 缓存有效期60秒


def _get_cached_result(cache_key: str) -> Optional[Dict[str, Any]]:
    """从缓存获取结果"""
    if cache_key in SEARCH_CACHE:
        cached_result, cached_time = SEARCH_CACHE[cache_key]
        if (datetime.now() - cached_time).total_seconds() < CACHE_TTL_SECONDS:
            return cached_result
        else:
            # 缓存过期，删除
            del SEARCH_CACHE[cache_key]
    return None


def _set_cached_result(cache_key: str, result: Dict[str, Any]) -> None:
    """设置缓存结果"""
    SEARCH_CACHE[cache_key] = (result, datetime.now())
    # 简单清理：只保留最近100个缓存项
    if len(SEARCH_CACHE) > 100:
        # 删除最旧的10个
        oldest_keys = sorted(SEARCH_CACHE.keys(), key=lambda k: SEARCH_CACHE[k][1])[:10]
        for key in oldest_keys:
            del SEARCH_CACHE[key]


def _clear_list_cache() -> None:
    """清除所有列表缓存（当库存数据发生变化时调用）"""
    # 清除所有以 "list:" 开头的缓存键
    keys_to_delete = [key for key in SEARCH_CACHE.keys() if key.startswith("list:")]
    for key in keys_to_delete:
        del SEARCH_CACHE[key]
    logger.info(f"Cleared {len(keys_to_delete)} list cache entries")


# ==================== Helper Functions ====================

# HTML特殊空格字符映射 - 用于模糊搜索标准化
SPECIAL_SPACE_CHARS = {
    '\u00A0': '',  # NBSP (non-breaking space)
    '\u2002': '',  # EN SPACE
    '\u2003': '',  # EM SPACE
    '\u2009': '',  # THIN SPACE
    '\u200C': '',  # ZWNJ (zero-width non-joiner)
    '\u200D': '',  # ZWJ (zero-width joiner)
}


def normalize_search_term(search_term: str) -> str:
    """
    标准化搜索词：移除所有特殊空格字符和常见分隔符
    用于模糊搜索匹配
    """
    if not search_term:
        return search_term
    
    normalized = search_term
    # 移除HTML特殊空格字符
    for char, replacement in SPECIAL_SPACE_CHARS.items():
        normalized = normalized.replace(char, replacement)
    # 移除常见分隔符
    normalized = normalized.replace(" ", "").replace("-", "").replace("_", "")
    
    return normalized


def _normalize_field_sql(field, sql_func):
    """
    构建标准化字段的SQL表达式
    移除所有特殊空格字符和常见分隔符后进行匹配
    """
    # 依次移除：连字符、常见空格、特殊空格字符、下划线
    normalized = sql_func.replace(field, '-', '')
    normalized = sql_func.replace(normalized, ' ', '')
    normalized = sql_func.replace(normalized, '\u00A0', '')  # NBSP
    normalized = sql_func.replace(normalized, '\u2002', '')  # EN SPACE
    normalized = sql_func.replace(normalized, '\u2003', '')  # EM SPACE
    normalized = sql_func.replace(normalized, '\u2009', '')  # THIN SPACE
    normalized = sql_func.replace(normalized, '\u200C', '')  # ZWNJ
    normalized = sql_func.replace(normalized, '\u200D', '')  # ZWJ
    normalized = sql_func.replace(normalized, '_', '')
    return normalized

def _get_by_id(db: Session, inventory_id: int) -> Optional[Inventory]:
    """Get inventory item by ID"""
    return db.get(Inventory, inventory_id)


def _find_by_code(db: Session, code: str) -> Optional[Inventory]:
    """Get inventory item by internal code"""
    statement = select(Inventory).where(Inventory.internal_code == code)
    return db.exec(statement).first()


def _add_specification(item_dict: dict) -> dict:
    """Add computed specification field to inventory response dict"""
    initial = item_dict.get("initial_quantity", 0)
    unit = item_dict.get("unit", "")
    # Format: "500 ml" or "250.5 ml" (no trailing zeros, space between number and unit)
    if initial == int(initial):
        # No decimal part, show as integer
        formatted = f"{int(initial)} {unit}"
    else:
        # Has decimal part, keep the decimal without trailing zeros
        formatted = f"{float(initial)} {unit}"
    item_dict["specification"] = formatted if initial else None
    return item_dict


def _add_user_names(db: Session, item_dict: dict) -> dict:
    """Add user names to inventory response dict"""
    # Get borrower name
    if item_dict.get("borrower_id"):
        borrower = db.get(User, item_dict["borrower_id"])
        item_dict["borrower_name"] = borrower.full_name or borrower.username if borrower else None
    else:
        item_dict["borrower_name"] = None
    
    # Get last borrower name
    if item_dict.get("last_borrower_id"):
        last_borrower = db.get(User, item_dict["last_borrower_id"])
        item_dict["last_borrower_name"] = last_borrower.full_name or last_borrower.username if last_borrower else None
    else:
        item_dict["last_borrower_name"] = None
    
    # Get created by name
    if item_dict.get("created_by_id"):
        created_by = db.get(User, item_dict["created_by_id"])
        item_dict["created_by_name"] = created_by.full_name or created_by.username if created_by else None
    else:
        item_dict["created_by_name"] = None
    
    return item_dict


# ==================== Named Routes (BEFORE /{id}) ====================

# --- CAS Queries ---

@router.get("/cas/{cas_number}")
def check_cas_inventory(
    cas_number: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Check CAS number inventory status.
    Returns all inventory items with this CAS number.
    """
    normalized_cas = normalize_cas(cas_number)

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
def get_cas_total_quantity(
    cas_number: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get total remaining quantity for a CAS number."""
    normalized_cas = normalize_cas(cas_number)

    statement = select(
        func.sum(Inventory.remaining_quantity)
    ).where(
        Inventory.cas_number == normalized_cas,
        Inventory.status != InventoryStatus.CONSUMED,
    )

    total = db.exec(statement).first()

    return {
        "cas_number": normalized_cas,
        "total_remaining": total or 0.0,
    }


# --- Code Lookup ---

@router.get("/code/{internal_code}", response_model=InventoryResponse)
def get_inventory_by_internal_code(
    internal_code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get inventory item by internal code"""
    item = _find_by_code(db, internal_code)
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Inventory item not found",
        )
    response = InventoryResponse.model_validate(item).model_dump()
    return _add_specification(response)


# --- Export ---

@router.get("/export")
def export_inventory(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Export inventory items as a downloadable CSV file."""
    statement = select(Inventory).order_by(Inventory.created_at.desc())
    items = db.exec(statement).all()

    output = io.StringIO()
    # UTF-8 BOM for Excel compatibility
    output.write("\ufeff")
    writer = csv.writer(output)

    writer.writerow([
        "CAS号", "名称", "英文名", "别名", "分类", "品牌",
        "位置", "初始数量", "剩余数量", "单位", "状态",
        "是否危险品", "入库时间", "备注",
    ])

    for item in items:
        writer.writerow([
            item.cas_number,
            item.name,
            item.english_name or "",
            item.alias or "",
            item.category or "",
            item.brand or "",
            item.storage_location or "",
            item.initial_quantity,
            item.remaining_quantity,
            item.unit,
            item.status.value if hasattr(item.status, "value") else item.status,
            "是" if item.is_hazardous else "否",
            item.created_at.strftime("%Y-%m-%d %H:%M:%S") if item.created_at else "",
            item.notes or "",
        ])

    output.seek(0)
    filename = f"inventory_export_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.csv"

    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


# --- Manual Add ---

@router.post("/manual-add", response_model=dict)
def manual_add_inventory(
    item_data: ManualInventoryCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Manually add inventory items without going through the order process.
    Creates N items where N = quantity_bottles.
    """
    normalized_cas = normalize_cas(item_data.cas_number)

    if not normalized_cas or len(normalized_cas.split("-")) < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid CAS format",
        )

    try:
        per_bottle_value, unit = parse_specification(item_data.specification)
    except SpecificationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    internal_codes = generate_internal_code(db, normalized_cas, item_data.quantity_bottles)

    created_items = []
    for internal_code in internal_codes:
        db_inventory = Inventory(
            internal_code=internal_code,
            cas_number=normalized_cas,
            name=item_data.name,
            english_name=item_data.english_name,
            alias=item_data.alias,
            category=item_data.category,
            brand=item_data.brand,
            storage_location=item_data.storage_location,
            initial_quantity=per_bottle_value,
            remaining_quantity=per_bottle_value,
            unit=unit,
            is_hazardous=item_data.is_hazardous,
            notes=item_data.notes,
            status=InventoryStatus.IN_STOCK,
            created_by_id=current_user.id,
        )
        db.add(db_inventory)
        created_items.append(db_inventory)

    db.commit()
    for item in created_items:
        db.refresh(item)

    return {
        "message": "Manual stock-in successful",
        "items_created": len(created_items),
        "item_ids": [item.id for item in created_items],
    }


# --- Dashboard APIs ---

@router.get("/dashboard/my-borrows")
def get_my_borrows(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get items borrowed by current user."""
    statement = select(Inventory).where(
        Inventory.status == InventoryStatus.BORROWED,
        Inventory.borrower_id == current_user.id,
    ).order_by(Inventory.updated_at.desc())

    items = db.exec(statement).all()
    # Use naive UTC to match SQLite's timezone-naive datetimes
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    return {
        "data": [
            {
                "inventory_id": item.id,
                "name": item.name,
                "cas_number": item.cas_number,
                "remaining_quantity": item.remaining_quantity,
                "unit": item.unit,
                "borrow_time": item.updated_at,
                "borrow_days": (now - item.updated_at).days if item.updated_at else 0,
                "is_overdue": ((now - item.updated_at).days > 3) if item.updated_at else False,
            }
            for item in items
        ],
        "total": len(items),
        "overdue_count": sum(
            1 for item in items
            if item.updated_at and (now - item.updated_at).days > 3
        ),
    }


@router.get("/dashboard/pending-stockin")
def get_pending_stockin(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get items pending storage_location assignment (temporary keeper = current user)."""
    statement = select(Inventory).where(
        Inventory.storage_location is None,
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
                "stockin_time": item.created_at,
            }
            for item in items
        ],
        "total": len(items),
    }


# --- Excel Import APIs ---

@router.get("/import/template")
def get_import_template():
    """Get Excel import template structure for frontend."""
    from app.services.excel_service import generate_import_template
    return generate_import_template()


@router.post("/import")
def import_inventory(
    file: UploadFile = File(...),
    default_storage_location: Optional[str] = None,
    default_is_hazardous: bool = False,
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Import inventory items from Excel file (admin only)."""
    from app.services.excel_service import import_inventory_from_excel

    # 验证上传文件（扩展名、MIME类型、文件魔数、大小）
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
            user_id=admin_user.id,
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
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Import failed: {str(e)}",
        )
    finally:
        if os.path.exists(tmp_file_path):
            os.remove(tmp_file_path)


# ==================== Generic / ID-based Routes ====================

@router.get("/")
def list_inventory(
    skip: int = 0,
    limit: int = 0,  # 0 表示不分页，返回全部数据
    status_filter: Optional[InventoryStatus] = None,
    cas_filter: Optional[str] = None,
    hazardous_only: bool = False,
    search: Optional[str] = None,
    search_field: Optional[str] = None,  # 精确搜索指定字段
    fuzzy: bool = False,                  # 模糊搜索（忽略空格和连字符）
    sort_by: Optional[str] = None,       # 排序字段
    sort_order: Optional[str] = 'desc',   # 排序方向：asc 或 desc
    db: Session = Depends(get_db),
):
    """List inventory with optional filters and pagination"""
    # 生成缓存key（包含所有搜索参数，包括分页和排序）
    cache_key = f"list:{skip}:{limit}:{search or ''}:{status_filter or ''}:{cas_filter or ''}:{hazardous_only}:{search_field or ''}:{fuzzy}:{sort_by or ''}:{sort_order or ''}"
    
    # 尝试从缓存获取（仅当是不分页查询或第一页时）
    if limit == 0 or skip == 0:
        cached = _get_cached_result(cache_key)
        if cached is not None:
            # 返回缓存结果，但更新分页参数
            return {
                **cached,
                "skip": skip,
                "limit": limit,
            }
    
    base = select(Inventory)

    if status_filter:
        base = base.where(Inventory.status == status_filter)
    if cas_filter:
        base = base.where(Inventory.cas_number == normalize_cas(cas_filter))
    if hazardous_only:
        base = base.where(Inventory.is_hazardous is True)
    if search:
        # 模糊搜索：移除空格和连字符后进行标准化匹配
        if fuzzy:
            # 使用Python函数标准化搜索词（移除特殊空格字符和常见分隔符）
            search_normalized = normalize_search_term(search.strip())
            
            # 使用 SQL REPLACE 函数对数据库字段进行标准化后再匹配
            # 这样可以匹配 "64-17-5"、"64 17 5"、"64 17 5" 等格式
            from sqlmodel import func as sql_func
            
            # 定义标准化字段的辅助函数
            def norm_field(field):
                f = sql_func.replace(field, '-', '')
                f = sql_func.replace(f, ' ', '')
                f = sql_func.replace(f, '\u00A0', '')  # NBSP
                f = sql_func.replace(f, '\u2002', '')  # EN SPACE
                f = sql_func.replace(f, '\u2003', '')  # EM SPACE
                f = sql_func.replace(f, '\u2009', '')  # THIN SPACE
                f = sql_func.replace(f, '\u200C', '')  # ZWNJ
                f = sql_func.replace(f, '\u200D', '')  # ZWJ
                f = sql_func.replace(f, '_', '')
                return f
            
            base = base.where(
                (norm_field(Inventory.cas_number).ilike(f"%{search_normalized}%")) |
                (norm_field(Inventory.name).ilike(f"%{search_normalized}%")) |
                (norm_field(Inventory.storage_location).ilike(f"%{search_normalized}%")) |
                (norm_field(Inventory.brand).ilike(f"%{search_normalized}%")) |
                (norm_field(Inventory.category).ilike(f"%{search_normalized}%"))
            )
        else:
            search_pattern = f"%{search}%"
            
            # 精确搜索指定字段
            if search_field and search_field != 'all':
                field_map = {
                    'name': Inventory.name,
                    'cas_number': Inventory.cas_number,
                    'storage_location': Inventory.storage_location,
                    'brand': Inventory.brand,
                    'category': Inventory.category,
                }
                if search_field in field_map:
                    base = base.where(field_map[search_field].ilike(search_pattern))
                else:
                    # 未知字段，回退到搜索所有字段
                    base = base.where(
                        (Inventory.name.ilike(search_pattern)) |
                        (Inventory.cas_number.ilike(search_pattern)) |
                        (Inventory.storage_location.ilike(search_pattern)) |
                        (Inventory.brand.ilike(search_pattern)) |
                        (Inventory.category.ilike(search_pattern))
                    )
            else:
                # 默认：搜索所有字段
                base = base.where(
                    (Inventory.name.ilike(search_pattern)) |
                    (Inventory.cas_number.ilike(search_pattern)) |
                    (Inventory.storage_location.ilike(search_pattern)) |
                    (Inventory.brand.ilike(search_pattern)) |
                    (Inventory.category.ilike(search_pattern))
                )

    total = db.exec(select(func.count()).select_from(base.subquery())).one()
    
    # 构建排序表达式
    # 支持的排序字段映射
    # 使用 CASE 表达式处理 initial_quantity 为 0 的情况，避免除零错误
    from sqlmodel import case as sql_case
    
    # 计算剩余百分比（处理除零情况）
    remaining_percent_expr = sql_case(
        (Inventory.initial_quantity > 0, Inventory.remaining_quantity * 1.0 / Inventory.initial_quantity),
        else_=0
    )
    
    sort_field_map = {
        'cas_number': Inventory.cas_number,
        'name': Inventory.name,
        'category': Inventory.category,
        'storage_location': Inventory.storage_location,
        'brand': Inventory.brand,
        'remaining_quantity': Inventory.remaining_quantity,
        'remaining_percent': remaining_percent_expr,
        'initial_quantity': Inventory.initial_quantity,
        'status': Inventory.status,
        'created_at': Inventory.created_at,
        'updated_at': Inventory.updated_at,
    }
    
    # 确定排序字段和方向
    order_column = sort_field_map.get(sort_by, Inventory.created_at)
    order_direction = sort_order.lower() if sort_order else 'desc'
    
    # 中文拼音排序字段列表
    pinyin_sort_fields = {'name', 'category', 'brand', 'alias'}
    
    # 判断是否需要使用拼音排序
    use_pinyin_sort = sort_by in pinyin_sort_fields
    
    logger.info(f"[SORT DEBUG] sort_by={sort_by}, sort_order={sort_order}, order_column={order_column}, order_direction={order_direction}, use_pinyin_sort={use_pinyin_sort}")
    
    if use_pinyin_sort:
        # 中文拼音排序：先按拼音键排序
        pinyin_key_field = f"{sort_by}_pinyin"
        logger.info(f"[PINYIN SORT] Using pinyin sorting for field: {sort_by}")
    
    if order_direction == 'asc':
        order_expr = order_column.asc()
    else:
        order_expr = order_column.desc()
    
    # 如果 limit 为 0，不使用分页，返回全部数据
    # 如果需要拼音排序，先获取全部数据再在 Python 中排序
    if limit == 0 or use_pinyin_sort:
        items = db.exec(base.order_by(order_expr)).all()
        if use_pinyin_sort:
            # Python 端拼音排序
            logger.info(f"[PINYIN SORT] Performing Python-side pinyin sorting for field: {sort_by}")
            reverse = order_direction == 'desc'
            # 使用 pypinyin 转换键进行排序
            items = sorted(items, key=lambda x: _to_pinyin_sort_key(getattr(x, sort_by) or ''), reverse=reverse)
            # 如果有 limit，应用分页
            if limit > 0:
                items = items[skip:skip + limit]
    elif limit > 0:
        items = db.exec(base.order_by(order_expr).offset(skip).limit(limit)).all()
    else:
        items = db.exec(base.order_by(order_expr)).all()

    result = {
        "data": [
            _add_user_names(db, _add_specification(InventoryResponse.model_validate(i).model_dump()))
            for i in items
        ],
        "total": total,
        "skip": skip,
        "limit": limit,
    }
    
    # 缓存查询结果（不分页或第一页时缓存）
    if limit == 0 or skip == 0:
        # 缓存时不包含分页参数
        cache_data = {
            "data": result["data"],
            "total": result["total"],
        }
        _set_cached_result(cache_key, cache_data)
    
    return result


@router.get("/{inventory_id}", response_model=InventoryResponse)
def get_inventory(inventory_id: int, db: Session = Depends(get_db)):
    """Get inventory item by ID"""
    item = _get_by_id(db, inventory_id)
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Inventory item not found",
        )
    response = InventoryResponse.model_validate(item).model_dump()
    return _add_specification(response)


@router.put("/{inventory_id}", response_model=InventoryResponse)
def update_inventory(
    inventory_id: int,
    update: InventoryUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update inventory information"""
    item = _get_by_id(db, inventory_id)
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Inventory item not found",
        )

    update_data = update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(item, field, value)

    item.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(item)
    response = InventoryResponse.model_validate(item).model_dump()
    return _add_specification(response)


@router.delete("/{inventory_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_inventory(
    inventory_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Delete inventory item (admin only, prefer status change)"""
    item = _get_by_id(db, inventory_id)
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Inventory item not found",
        )
    db.delete(item)
    db.commit()


@router.post("/{inventory_id}/borrow", response_model=InventoryResponse)
def borrow_item(
    inventory_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Borrow an inventory item. Creates BorrowLog record."""
    item = _get_by_id(db, inventory_id)
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Inventory item not found",
        )

    if item.status != InventoryStatus.IN_STOCK:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot borrow item with status: {item.status}",
        )

    borrow_log = BorrowLog(
        inventory_id=inventory_id,
        borrower_id=current_user.id,
        borrow_time=datetime.now(timezone.utc),
        quantity_borrowed=item.remaining_quantity,
    )
    db.add(borrow_log)

    item.status = InventoryStatus.BORROWED
    item.borrower_id = current_user.id
    item.updated_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(item)
    
    # 清除列表缓存，确保借用人后立即查询到最新数据
    _clear_list_cache()
    
    response = InventoryResponse.model_validate(item).model_dump()
    return _add_specification(response)


@router.post("/{inventory_id}/return", response_model=dict)
def return_item(
    inventory_id: int,
    return_data: InventoryBorrowReturn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return a borrowed item. Returns low quantity warning if remaining < 20%."""
    item = _get_by_id(db, inventory_id)
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Inventory item not found",
        )

    if item.status != InventoryStatus.BORROWED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Item is not borrowed, current status: {item.status}",
        )

    if item.borrower_id != current_user.id and current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not the borrower of this item",
        )

    if return_data.remaining_quantity > item.initial_quantity:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"剩余量 ({return_data.remaining_quantity}) 不能超过初始量 ({item.initial_quantity})",
        )

    # Update BorrowLog
    borrow_log = db.exec(
        select(BorrowLog)
        .where(BorrowLog.inventory_id == inventory_id, BorrowLog.return_time.is_(None))
        .order_by(BorrowLog.borrow_time.desc())
    ).first()

    if borrow_log:
        borrow_log.return_time = datetime.now(timezone.utc)
        borrow_log.quantity_returned = return_data.remaining_quantity

    # Update item
    item.remaining_quantity = return_data.remaining_quantity
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

    item.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(item)
    
    # 清除列表缓存，确保归还后立即查询到最新数据
    _clear_list_cache()
    
    result = item.model_dump()
    if low_quantity_warning:
        result["warning"] = low_quantity_warning
    return result


@router.get("/{inventory_id}/borrow-history")
def get_borrow_history(
    inventory_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get borrow history for an inventory item (last 10 records)."""
    item = _get_by_id(db, inventory_id)
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Inventory item not found",
        )

    logs = db.exec(
        select(BorrowLog)
        .where(BorrowLog.inventory_id == inventory_id)
        .order_by(BorrowLog.borrow_time.desc())
        .limit(10)
    ).all()

    return {
        "inventory_id": inventory_id,
        "name": item.name,
        "history": [
            {
                "id": log.id,
                "borrower_id": log.borrower_id,
                "borrow_time": log.borrow_time,
                "return_time": log.return_time,
                "quantity_borrowed": log.quantity_borrowed,
                "quantity_returned": log.quantity_returned,
            }
            for log in logs
        ],
    }
