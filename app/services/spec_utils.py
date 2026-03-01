"""
Specification Parser - Parse specification string into (value, unit)
Critical: No unit conversion, case-insensitive, reject invalid format
"""
import re
from typing import Tuple, Optional


# Canonical unit form mapping (lowercase -> display form)
UNIT_CANONICAL: dict[str, str] = {
    "ml": "mL",
    "l": "L",
    "g": "g",
    "kg": "kg",
    "mg": "mg",
    "个": "个",
    "瓶": "瓶",
    "支": "支",
    "盒": "盒",
    "包": "包",
    "套": "套",
}

VALID_UNITS = set(UNIT_CANONICAL.keys())


class SpecificationError(ValueError):
    """Domain error for invalid specification format"""
    pass


def format_specification(initial_quantity: Optional[float], unit: str) -> Optional[str]:
    """
    Format specification from initial_quantity and unit.
    
    Args:
        initial_quantity: The numeric value (e.g., 500)
        unit: The unit string (e.g., "mL")
    
    Returns:
        Formatted string like "500 mL" or "250.5 mL", or None if no quantity
    
    Examples:
        - (500, "mL") -> "500 mL"
        - (250.5, "mL") -> "250.5 mL"
        - (1, "L") -> "1 L"
        - (0, "mL") -> None
    """
    if not initial_quantity:
        return None
    
    # Normalize unit to canonical form (e.g., "ml" -> "mL")
    normalized_unit = UNIT_CANONICAL.get(unit.lower(), unit)
    
    # Format number: integer without decimals, float with decimals
    if initial_quantity == int(initial_quantity):
        formatted = f"{int(initial_quantity)} {normalized_unit}"
    else:
        formatted = f"{float(initial_quantity)} {normalized_unit}"
    
    return formatted


def parse_specification(spec: str) -> Tuple[float, str]:
    """
    Parse specification string into (numeric_value, canonical_unit)
    
    Examples:
        "500ml" -> (500.0, "mL")
        "1L"    -> (1.0, "L")
        "100 g" -> (100.0, "g")
    
    Raises:
        SpecificationError: If format is invalid
    """
    if not spec or not spec.strip():
        raise SpecificationError("规格不能为空")
    
    spec = spec.strip()
    
    # Pattern: number + optional space + unit
    # Use (\d+(?:\.\d+)?) to avoid matching invalid formats like "1.5.5"
    pattern = r'^(\d+(?:\.\d+)?)\s*([a-zA-Zμ个瓶支盒包套]+)$'
    match = re.match(pattern, spec)
    
    if not match:
        raise SpecificationError(
            "规格格式无效，请输入数字+单位（如：500ml、1L、100g）"
        )
    
    value = float(match.group(1))
    raw_unit = match.group(2).lower()
    
    if raw_unit not in VALID_UNITS:
        raise SpecificationError(
            f"不支持的单位：{match.group(2)}，支持的单位：{', '.join(sorted(UNIT_CANONICAL.values()))}"
        )
    
    if value <= 0:
        raise SpecificationError("规格数值必须大于0")
    
    return value, UNIT_CANONICAL[raw_unit]


def validate_specification(spec: str) -> bool:
    """Validate specification format, return True if valid"""
    try:
        parse_specification(spec)
        return True
    except SpecificationError:
        return False
