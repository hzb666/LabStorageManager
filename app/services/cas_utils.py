"""
CAS Number Utilities
Critical Rule #2: All CAS Number inputs must be normalized (remove spaces, uppercase)
This is the foundation for deduplication in the system.
"""
import re

from app.core.constants import CAS_PATTERN

BIOLOGICAL_REAGENT_CAS = "生物试剂"
DASH_TRANSLATION = str.maketrans({
    "－": "-",
    "–": "-",
    "—": "-",
    "‑": "-",
})


def is_special_cas_value(cas: str) -> bool:
    """Return True when value is the special non-CAS token allowed by business rules."""
    return normalize_cas(cas) == BIOLOGICAL_REAGENT_CAS



def normalize_cas(cas: str | None) -> str:
    """
    Normalize CAS number: remove spaces, convert to uppercase.

    Examples:
        "64-17-5" -> "64-17-5"
        "64 - 17 - 5" -> "64-17-5"
        "64- 17-5" -> "64-17-5"

    Args:
        cas: Raw CAS number string

    Returns:
        Normalized CAS number (uppercase, no spaces)
    """
    if not cas:
        return ""

    # 移除空白字符并标准化常见短横线变体。
    normalized = re.sub(r"\s+", "", str(cas).translate(DASH_TRANSLATION)).upper()
    return normalized


def _calculate_cas_check_digit(sequence_number: str) -> int:
    """
    Calculate CAS number check digit.

    The check digit is calculated by:
    1. Taking the sequence number (first two parts of CAS without dash)
    2. Reversing the digits
    3. Multiplying each digit by its position (1, 2, 3, ...)
    4. Summing all products
    5. Taking modulo 10

    Args:
        sequence_number: The first two parts of CAS number (e.g., "6417" from "64-17-5")

    Returns:
        Calculated check digit (0-9)
    """
    digits = list(sequence_number)[::-1]  # Reverse
    total = 0
    for i, digit in enumerate(digits, start=1):
        total += int(digit) * i
    return total % 10


def validate_cas_format(cas: str) -> tuple[bool, str | None]:
    """
    Validate CAS number format and check digit.

    CAS format: XXXXX-XX-X (2-7 digits)-(2 digits)-(1 digit)
    CAS check digit: Calculated from first two parts

    Args:
        cas: CAS number to validate

    Returns:
        Tuple of (is_valid, error_message)
    """
    if not cas:
        return False, "CAS number is required"

    # 入参已由 validate_and_normalize_cas 标准化，可直接比较特殊 CAS。
    if cas == BIOLOGICAL_REAGENT_CAS:
        return True, None

    # 检查基础格式。
    if not re.match(CAS_PATTERN, cas):
        return False, "Invalid CAS format. Expected: XXXXX-XX-X"

    # 拆分并校验结构。
    parts = cas.split("-")
    if len(parts) != 3:
        return False, "Invalid CAS format"

    # 提取 CAS 三段内容。
    first_part = parts[0]  # 2-7 位数字
    second_part = parts[1]  # 2 位数字
    check_digit = parts[2]  # 1 位数字

    # 前两段组合为主体序列。
    sequence_number = first_part + second_part

    # 计算期望校验位。
    expected_check_digit = _calculate_cas_check_digit(sequence_number)
    actual_check_digit = int(check_digit)

    # 校验最后一位。
    if expected_check_digit != actual_check_digit:
        return False, f"Invalid CAS check digit. Expected: {expected_check_digit}"

    return True, None


def is_valid_cas(cas: str | None) -> bool:
    """Return True when the normalized value is a real CAS number with a valid check digit."""
    normalized = normalize_cas(cas)
    if not normalized or normalized == BIOLOGICAL_REAGENT_CAS:
        return False
    is_valid, _error = validate_cas_format(normalized)
    return is_valid


def validate_and_normalize_cas(cas: str) -> tuple[bool, str | None, str]:
    """
    Validate and normalize CAS number in one step.

    Args:
        cas: Raw CAS number string

    Returns:
        Tuple of (is_valid, error_message, normalized_cas)
    """
    normalized = normalize_cas(cas)

    if not normalized:
        return False, "CAS number is required", ""

    is_valid, error = validate_cas_format(normalized)

    if not is_valid:
        return False, error, normalized

    return True, None, normalized


def get_cas_prefix(cas: str) -> str:
    """
    Extract prefix from CAS number for display purposes.

    Args:
        cas: Normalized CAS number

    Returns:
        First part of CAS (e.g., "64" from "64-17-5")
    """
    if not cas:
        return "UNK"
    return cas.split("-")[0].upper()
