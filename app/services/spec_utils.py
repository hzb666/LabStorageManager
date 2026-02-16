"""
Specification Parser - Parse specification string into (value, unit)
Critical: No unit conversion, case-insensitive, reject invalid format
"""
import re
from typing import Tuple


# Supported units (case-insensitive)
VALID_UNITS = {
    "ml", "l", "g", "kg", "mg", "个", "瓶", "支", "盒", "包", "套"
}


class SpecificationError(ValueError):
    """Domain error for invalid specification format"""
    pass


def parse_specification(spec: str) -> Tuple[float, str]:
    """
    Parse specification string into (numeric_value, unit)
    
    Examples:
        "500ml" -> (500.0, "ml")
        "1L" -> (1.0, "L")
        "100 g" -> (100.0, "g")
    
    Raises:
        SpecificationError: If format is invalid
    """
    if not spec or not spec.strip():
        raise SpecificationError("规格不能为空")
    
    spec = spec.strip().lower()
    
    # Pattern: number + optional space + unit
    pattern = r'^(\d+\.?\d*)\s*([a-zA-Z个瓶支盒包套]+)$'
    match = re.match(pattern, spec, re.IGNORECASE)
    
    if not match:
        raise SpecificationError(
            f"规格格式无效，请输入数字+单位（如：500ml、1L、100g）"
        )
    
    value = float(match.group(1))
    unit = match.group(2).lower()
    
    # Validate unit
    if unit not in VALID_UNITS:
        raise SpecificationError(
            f"不支持的单位：{unit}，支持的单位：{', '.join(sorted(VALID_UNITS))}"
        )
    
    if value <= 0:
        raise SpecificationError("规格数值必须大于0")
    
    return value, unit


def validate_specification(spec: str) -> bool:
    """Validate specification format, return True if valid"""
    try:
        parse_specification(spec)
        return True
    except SpecificationError:
        return False
