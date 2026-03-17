"""
Excel Import Service - Parse Excel files for inventory bulk import
"""
import pandas as pd
from datetime import datetime, date, timedelta
from pathlib import Path
from typing import Tuple, Optional
from sqlalchemy.orm import Session
from fastapi import HTTPException, status, UploadFile
from app.models.inventory import Inventory, InventoryStatus
from app.services.api_utils import empty_to_none
from app.services.cas_utils import normalize_cas, validate_cas_format
from app.services.spec_utils import parse_specification
from app.services.pinyin_utils import compute_pinyin_fields
from app.core.time_utils import get_utc_now


def _compute_remaining_percent(remaining: Optional[float], initial: Optional[float]) -> Optional[float]:
    """Compute remaining percentage for persisted sorting field."""
    if initial is None or initial <= 0:
        return None
    if remaining is None:
        return None
    return remaining / initial


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

# 最大文件大小 (2MB)
MAX_FILE_SIZE = 2 * 1024 * 1024


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
            detail="File size exceeds 2MB limit"
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


def _parse_boolean(value, default: bool = False) -> bool:
    """
    Parse boolean value from various input types.
    Handles: true/false, TRUE/FALSE, 0/1, True/False, empty strings, None, NaN
    
    Args:
        value: The value to parse
        default: Default value if parsing fails or value is empty/null
    
    Returns:
        Boolean value
    """
    # Handle empty/null values (including NaN from pandas)
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return default
    if isinstance(value, str):
        stripped = value.strip()
        if stripped == '':
            return default
        # Parse string boolean representations
        lower = stripped.lower()
        if lower in ('false', '0', 'no', 'n'):
            return False
        if lower in ('true', '1', 'yes', 'y'):
            return True
        # Unknown string - return default
        return default
    # Handle numeric types (but not NaN which is handled above)
    if isinstance(value, (int, float)):
        return bool(value)
    # Handle boolean type
    if isinstance(value, bool):
        return value
    # Fallback
    return default


class ExcelImportError(Exception):
    """Custom exception for Excel import errors"""
    def __init__(self, row: int, message: str):
        self.row = row
        self.message = message
        super().__init__(f"Row {row}: {message}")


def _generate_internal_code_with_tracking(
    db: Session,
    cas_number: str,
    sequence_tracker: dict[tuple[str, str], int],
    created_at: Optional[datetime] = None
) -> str:
    """
    Generate internal code with transaction-level tracking to handle batch imports.
    
    This function solves the problem where multiple rows with the same CAS number
    in a single import transaction would get the same internal_code, causing
    UNIQUE constraint violations.
    
    Args:
        db: Database session
        cas_number: Normalized CAS number
        sequence_tracker: Dictionary tracking next sequence number for each (cas_number, date) pair
        created_at: Optional custom created_at datetime (for backdated imports)
    
    Returns:
        Internal code string (e.g., "10203-08-4-260224-01")
    """
    from sqlmodel import select
    
    # Determine date string - use created_at if provided, otherwise use current date
    if created_at:
        date_str = created_at.strftime("%y%m%d")
    else:
        date_str = get_utc_now().strftime("%y%m%d")
    
    tracker_key = (cas_number, date_str)
    
    # Check if we already have a sequence tracked for this CAS+date in this transaction
    if tracker_key in sequence_tracker:
        # Use the tracked sequence and increment AFTER
        seq = sequence_tracker[tracker_key]
        sequence_tracker[tracker_key] = seq + 1
    else:
        # First time seeing this CAS+date combination in this transaction
        # Query database for existing max sequence using ORM
        prefix = f"{cas_number}-{date_str}-"
        
        statement = select(Inventory).where(
            Inventory.internal_code.like(f"{prefix}%")
        )
        results = db.exec(statement).all()
        
        # Start from max existing + 1, or 1 if none exist
        max_seq = 0
        prefix_len = len(prefix)
        for item in results:
            code_part = item.internal_code[prefix_len:]
            try:
                seq_num = int(code_part)
                if seq_num > max_seq:
                    max_seq = seq_num
            except ValueError:
                continue
        
        seq = max_seq + 1
        # Store next sequence for subsequent calls
        sequence_tracker[tracker_key] = seq + 1
    
    # Generate the internal code
    return f"{cas_number}-{date_str}-{str(seq).zfill(2)}"


def parse_excel_file(file_path: str) -> pd.DataFrame:
    """
    Parse Excel or CSV file and return DataFrame.
    Supports .xlsx, .xls, and .csv formats.
    """
    if file_path.endswith('.csv'):
        # Try multiple encodings for CSV
        for encoding in ['utf-8-sig', 'utf-8', 'gbk', 'gb2312']:
            try:
                return pd.read_csv(file_path, encoding=encoding)
            except UnicodeDecodeError:
                continue
        # Last resort: try with error handling
        return pd.read_csv(file_path, encoding='utf-8-sig', encoding_errors='replace')
    return pd.read_excel(file_path)


def validate_row_data(row: dict) -> Tuple[bool, Optional[str]]:
    """
    Validate a single row of Excel data.
    Returns (is_valid, error_message).
    """
    # Required fields
    required_fields = ['cas_number', 'name', 'specification']
    
    for field in required_fields:
        if field not in row or pd.isna(row[field]) or str(row[field]).strip() == '':
            return False, f"Missing required field: {field}"
    
    # Validate CAS format
    cas_raw = str(row['cas_number']).strip()
    normalized_cas = normalize_cas(cas_raw)
    is_valid, error = validate_cas_format(normalized_cas)
    
    if not is_valid:
        return False, f"Invalid CAS format: {error}"
    
    # Validate specification (will parse to get quantity and unit)
    try:
        _, _ = parse_specification(str(row['specification']))
    except ValueError as e:
        return False, f"Invalid specification format: {str(e)}"
    
    return True, None


def import_inventory_from_excel(
    db: Session,
    file_path: str,
    default_storage_location: Optional[str] = None,
    default_is_hazardous: bool = False,
    user_id: int = 1
) -> dict:
    """
    Import inventory items from Excel or CSV file.
    
    Expected columns:
    - cas_number: CAS号 (required)
    - name: 名称 (required)
    - english_name: 英文名 (optional)
    - alias: 别名 (optional)
    - category: 分类 (optional)
    - brand: 品牌/厂商 (optional)
    - specification: 规格，如 "500ml" (required)
    - initial_quantity: 初始数量 (required)
    - storage_location: 存放位置 (optional, uses default if not provided)
    - is_hazardous: 是否危险品 (optional, defaults to False)
    - price: 单价 (optional)
    - notes: 备注 (optional)
    
    Returns:
    Dictionary with import results:
    - success: True if import completed
    - total_rows: Total rows processed
    - created: Number of items created
    - errors: List of row errors
    """
    # Track sequence numbers within the transaction for same CAS numbers
    # Key: (cas_number, date_str), Value: next sequence number
    sequence_tracker: dict[tuple[str, str], int] = {}
    # Parse Excel file
    try:
        df = parse_excel_file(file_path)
    except Exception as e:
        raise Exception(f"Failed to parse Excel file: {str(e)}")
    
    # Normalize column names (case-insensitive)
    column_mapping = {
        'cas_number': ['cas_number', 'cas', 'cas号'],
        'name': ['name', '名称', '品名'],
        'english_name': ['english_name', '英文名', 'englishname'],
        'alias': ['alias', '别名'],
        'category': ['category', '分类', '类别'],
        'brand': ['brand', '品牌', '厂商', 'manufacturer'],
        'specification': ['specification', '规格', 'spec'],
        'remaining_quantity': ['remaining_quantity', '剩余数量', '剩余量'],
        'storage_location': ['storage_location', 'location', '位置', '存放位置'],
        'is_hazardous': ['is_hazardous', '危险品', '是否危险品'],
        'notes': ['notes', '备注', 'remark'],
        'created_at': ['created_at', '入库时间', '创建时间', 'stock_in_date'],
    }
    
    # Normalize columns
    normalized_df = pd.DataFrame()
    for standard_col, possible_cols in column_mapping.items():
        for col in df.columns:
            if col.lower() in [c.lower() for c in possible_cols]:
                normalized_df[standard_col] = df[col]
                break
    
    # Process each row
    created_count = 0
    errors = []
    
    for idx, row in normalized_df.iterrows():
        row_num = idx + 2  # Excel row number (1-indexed, header at row 1)
        
        # Validate row
        is_valid, error = validate_row_data(row)
        if not is_valid:
            errors.append({"row": row_num, "error": error})
            continue
        
        try:
            # Normalize CAS
            normalized_cas = normalize_cas(str(row['cas_number']))
            
            # Parse specification to get value and unit
            # specification like "500ml" -> initial_quantity=500, unit="mL"
            spec_value, unit = parse_specification(str(row['specification']))
            
            # Get initial_quantity: use spec_value as default
            initial_quantity = spec_value
            
            # Get remaining_quantity: use row value if provided, otherwise default to initial_quantity
            remaining_qty = initial_quantity
            if pd.notna(row.get('remaining_quantity')):
                try:
                    remaining_qty = float(row.get('remaining_quantity'))
                except (ValueError, TypeError):
                    remaining_qty = initial_quantity
            
            # Get or use default values
            # Use empty_to_none to convert empty/whitespace strings to None
            all_optional_fields = {
                'storage_location': row.get('storage_location'),
                'alias': row.get('alias'),
                'english_name': row.get('english_name'),
                'category': row.get('category'),
                'brand': row.get('brand'),
                'notes': row.get('notes'),
            }
            normalized_optional = empty_to_none(all_optional_fields, list(all_optional_fields.keys()))
            storage_location = normalized_optional['storage_location'] or default_storage_location
            alias = normalized_optional['alias']
            english_name = normalized_optional['english_name']
            category = normalized_optional['category']
            brand = normalized_optional['brand']
            notes = normalized_optional['notes']
            
            is_hazardous = _parse_boolean(row.get('is_hazardous'), default_is_hazardous)
            
            # Parse created_at (custom stock-in date)
            created_at = None
            if pd.notna(row.get('created_at')):
                date_value = row.get('created_at')
                try:
                    # Handle multiple date formats:
                    # - String: "2024-01-15", "2024/01/15", "240115", "240101"
                    # - Numeric: Excel date serial (5 digits like 45292), YYYYMMDD (8 digits), YYMMDD (6 digits)
                    date_str = str(date_value).strip()
                    
                    # Try parsing as numeric
                    if date_str.isdigit():
                        if len(date_str) == 5:  # Excel date serial (e.g., 45292 = 2024-01-15)
                            excel_epoch = date(1899, 12, 30)  # Excel epoch
                            date_str = str(excel_epoch + timedelta(days=int(date_str)))
                        elif len(date_str) == 8:  # YYYYMMDD
                            date_str = f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:8]}"
                        elif len(date_str) == 6:  # YYMMDD
                            # Assume 2000s for years 00-99
                            date_str = f"20{date_str[:2]}-{date_str[2:4]}-{date_str[4:6]}"
                    
                    # Convert pandas Timestamp to Python datetime
                    created_at = pd.to_datetime(date_str).to_pydatetime()
                except (ValueError, TypeError):
                    # Invalid date format - skip using custom date, use default
                    pass
            
            # Generate internal code (1 item per row for direct import)
            # Use transaction-level sequence tracking to handle same CAS in batch import
            internal_code = _generate_internal_code_with_tracking(
                db, normalized_cas, sequence_tracker, created_at
            )
            
            # 自动计算拼音字段
            name = str(row['name']).strip()
            pinyin_fields = compute_pinyin_fields(
                name=name,
                category=category,
                brand=brand,
                storage_location=storage_location,
            )
            
            # Create inventory item
            inventory = Inventory(
                internal_code=internal_code,
                cas_number=normalized_cas,
                name=name,
                english_name=english_name,
                alias=alias,
                category=category,
                brand=brand,
                storage_location=storage_location,
                initial_quantity=initial_quantity,
                remaining_quantity=remaining_qty,
                remaining_percent=_compute_remaining_percent(remaining_qty, initial_quantity),
                unit=unit,
                is_hazardous=is_hazardous,
                status=InventoryStatus.IN_STOCK,
                notes=notes,
                created_at=created_at,
                created_by_id=user_id,
                **pinyin_fields,
            )
            
            db.add(inventory)
            created_count += 1
            
        except Exception as e:
            errors.append({"row": row_num, "error": str(e)})
    
    try:
        db.commit()
    except Exception as e:
        db.rollback()
        raise Exception(f"Failed to save imported data: {str(e)}")
    
    return {
        "success": len(errors) == 0,
        "total_rows": len(normalized_df),
        "created": created_count,
        "errors": errors
    }


def generate_import_template() -> dict:
    """
    Generate Excel import template structure.
    Returns column definitions for frontend.
    """
    return {
        "columns": [
            {
                "name": "cas_number",
                "label": "CAS号",
                "required": True,
                "description": "格式: XXXXX-XX-X，例如 64-17-5"
            },
            {
                "name": "name",
                "label": "名称",
                "required": True,
                "description": "化学品中文名称，例如 乙醇"
            },
            {
                "name": "english_name",
                "label": "英文名",
                "required": False,
                "description": "化学品的英文名称，例如 Ethanol"
            },
            {
                "name": "alias",
                "label": "别名",
                "required": False,
                "description": "化学品的别名或俗称，例如 酒精"
            },
            {
                "name": "category",
                "label": "分类",
                "required": False,
                "description": "化学品分类，例如 有机溶剂、酸、碱"
            },
            {
                "name": "brand",
                "label": "品牌/厂商",
                "required": False,
                "description": "品牌或生产厂家，例如 Sigma、阿拉丁"
            },
            {
                "name": "specification",
                "label": "规格",
                "required": True,
                "description": "格式: 数值+单位，如 500ml, 1L, 100g，系统会自动解析出数量和单位"
            },
            {
                "name": "remaining_quantity",
                "label": "剩余数量",
                "required": False,
                "description": "剩余数量（可选），不填则默认等于规格中的数量"
            },
            {
                "name": "storage_location",
                "label": "存放位置",
                "required": False,
                "description": "例如 302冰箱第二层、A-1-1 柜"
            },
            {
                "name": "is_hazardous",
                "label": "是否危险品",
                "required": False,
                "description": "true/false 或 1/0，危险品需要特殊存储"
            },
            {
                "name": "notes",
                "label": "备注",
                "required": False,
                "description": "其他需要记录的信息，例如 易燃物品"
            },
            {
                "name": "created_at",
                "label": "入库日期",
                "required": False,
                "description": "支持格式: YYYY-MM-DD、YYYY/MM/DD、YYMMDD、YYYYMMDD、Excel序列号(如 45292)。留空则使用导入时间"
            }
        ]
    }
