"""
Excel Import Service - Parse Excel files for inventory bulk import
"""
import pandas as pd
from typing import List, Tuple, Optional
from sqlalchemy.orm import Session

from app.models.inventory import Inventory, InventoryStatus
from app.services.cas_utils import normalize_cas, validate_cas_format
from app.services.spec_utils import parse_specification
from app.services.internal_code import generate_internal_code


class ExcelImportError(Exception):
    """Custom exception for Excel import errors"""
    def __init__(self, row: int, message: str):
        self.row = row
        self.message = message
        super().__init__(f"Row {row}: {message}")


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
        return pd.read_csv(file_path, encoding='utf-8-sig', errors='replace')
    return pd.read_excel(file_path)


def validate_row_data(row: dict, row_num: int) -> Tuple[bool, Optional[str]]:
    """
    Validate a single row of Excel data.
    Returns (is_valid, error_message).
    """
    # Required fields
    required_fields = ['cas_number', 'name', 'specification', 'initial_quantity']
    
    for field in required_fields:
        if field not in row or pd.isna(row[field]) or str(row[field]).strip() == '':
            return False, f"Missing required field: {field}"
    
    # Validate CAS format
    cas_raw = str(row['cas_number']).strip()
    normalized_cas = normalize_cas(cas_raw)
    is_valid, error = validate_cas_format(normalized_cas)
    
    if not is_valid:
        return False, f"Invalid CAS format: {error}"
    
    # Validate quantity
    try:
        quantity = float(row['initial_quantity'])
        if quantity <= 0:
            return False, "initial_quantity must be greater than 0"
    except (ValueError, TypeError):
        return False, "invalid initial_quantity"
    
    # Validate specification
    try:
        spec_value, unit = parse_specification(str(row['specification']))
    except ValueError:
        return False, f"Invalid specification format: {row['specification']}"
    
    return True, None


def import_inventory_from_excel(
    db: Session,
    file_path: str,
    default_location: Optional[str] = None,
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
    - location: 存放位置 (optional, uses default if not provided)
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
        'initial_quantity': ['initial_quantity', '初始数量', '数量', 'quantity'],
        'location': ['location', '位置', '存放位置'],
        'is_hazardous': ['is_hazardous', '危险品', '是否危险品'],
        'price': ['price', '单价', '价格'],
        'notes': ['notes', '备注', 'remark']
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
        is_valid, error = validate_row_data(row, row_num)
        if not is_valid:
            errors.append({"row": row_num, "error": error})
            continue
        
        try:
            # Normalize CAS
            normalized_cas = normalize_cas(str(row['cas_number']))
            
            # Parse specification
            spec_value, unit = parse_specification(str(row['specification']))
            
            # Get or use default values
            location = str(row.get('location', '')).strip() if pd.notna(row.get('location')) else default_location
            alias = str(row.get('alias', '')).strip() if pd.notna(row.get('alias')) else None
            english_name = str(row.get('english_name', '')).strip() if pd.notna(row.get('english_name')) else None
            category = str(row.get('category', '')).strip() if pd.notna(row.get('category')) else None
            brand = str(row.get('brand', '')).strip() if pd.notna(row.get('brand')) else None
            is_hazardous = bool(row.get('is_hazardous', default_is_hazardous)) if pd.notna(row.get('is_hazardous')) else default_is_hazardous
            notes = str(row.get('notes', '')).strip() if pd.notna(row.get('notes')) else None
            
            # Parse price
            price = None
            if pd.notna(row.get('price')):
                try:
                    price = float(row.get('price'))
                except (ValueError, TypeError):
                    pass
            
            # Generate internal code (1 item per row for direct import)
            internal_codes = generate_internal_code(db, normalized_cas, 1)
            internal_code = internal_codes[0]
            
            # Create inventory item
            inventory = Inventory(
                internal_code=internal_code,
                cas_number=normalized_cas,
                name=str(row['name']).strip(),
                english_name=english_name,
                alias=alias,
                category=category,
                brand=brand,
                location=location,
                initial_quantity=float(row['initial_quantity']),
                remaining_quantity=float(row['initial_quantity']),
                unit=unit,
                is_hazardous=is_hazardous,
                status=InventoryStatus.IN_STOCK,
                price=price,
                notes=notes,
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
                "description": "格式: XXXXX-XX-X，去除空格，例如 64-17-5"
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
                "description": "格式: 数值+单位，如 500ml, 1L, 100g"
            },
            {
                "name": "initial_quantity",
                "label": "初始数量",
                "required": True,
                "description": "正整数或小数，表示总量"
            },
            {
                "name": "location",
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
                "name": "price",
                "label": "单价(元)",
                "required": False,
                "description": "单价，例如 150.00"
            },
            {
                "name": "notes",
                "label": "备注",
                "required": False,
                "description": "其他需要记录的信息，例如 易燃物品"
            }
        ]
    }
