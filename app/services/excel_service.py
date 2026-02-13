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
    Parse Excel file and return DataFrame.
    Supports both .xlsx and .xls formats.
    """
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
    Import inventory items from Excel file.
    
    Expected Excel columns:
    - cas_number: CAS号 (required)
    - name: 名称 (required)
    - alias: 别名 (optional)
    - specification: 规格，如 "500ml" (required)
    - initial_quantity: 初始数量 (required)
    - location: 存放位置 (optional, uses default if not provided)
    - is_hazardous: 是否危险品 (optional, defaults to False)
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
        'alias': ['alias', '别名'],
        'specification': ['specification', '规格', 'spec'],
        'initial_quantity': ['initial_quantity', '初始数量', '数量', 'quantity'],
        'location': ['location', '位置', '存放位置'],
        'is_hazardous': ['is_hazardous', '危险品', '是否危险品'],
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
            is_hazardous = bool(row.get('is_hazardous', default_is_hazardous)) if pd.notna(row.get('is_hazardous')) else default_is_hazardous
            notes = str(row.get('notes', '')).strip() if pd.notna(row.get('notes')) else None
            
            # Generate internal code (1 item per row for direct import)
            internal_codes = generate_internal_code(db, normalized_cas, 1)
            internal_code = internal_codes[0]
            
            # Create inventory item
            inventory = Inventory(
                internal_code=internal_code,
                cas_number=normalized_cas,
                name=str(row['name']).strip(),
                alias=alias,
                location=location,
                initial_quantity=float(row['initial_quantity']),
                remaining_quantity=float(row['initial_quantity']),
                unit=unit,
                is_hazardous=is_hazardous,
                status=InventoryStatus.IN_STOCK,
                notes=notes,
            )
            
            db.add(inventory)
            created_count += 1
            
        except Exception as e:
            errors.append({"row": row_num, "error": str(e)})
    
    db.commit()
    
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
                "field": "cas_number",
                "label": "CAS号",
                "required": True,
                "example": "64-17-5",
                "validation": "格式: XXXXX-XX-X，去除空格"
            },
            {
                "field": "name",
                "label": "名称",
                "required": True,
                "example": "乙醇"
            },
            {
                "field": "alias",
                "label": "别名",
                "required": False,
                "example": "酒精, Ethanol"
            },
            {
                "field": "specification",
                "label": "规格",
                "required": True,
                "example": "500ml",
                "validation": "格式: 数值+单位，如 500ml, 1L, 100g"
            },
            {
                "field": "initial_quantity",
                "label": "初始数量",
                "required": True,
                "example": "500",
                "validation": "正整数或小数"
            },
            {
                "field": "location",
                "label": "存放位置",
                "required": False,
                "example": "302冰箱第二层"
            },
            {
                "field": "is_hazardous",
                "label": "是否危险品",
                "required": False,
                "example": "false",
                "validation": "true/false 或 1/0"
            },
            {
                "field": "notes",
                "label": "备注",
                "required": False,
                "example": "易燃物品"
            }
        ]
    }
