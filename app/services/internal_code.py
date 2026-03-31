"""
Internal Code Generator - Generate unique internal codes for inventory items
Format: CAS号-日期(yymmdd)-序号 (e.g., "64175-250113-001")
Sequence: Auto-increment per CAS number group, zero-padded to ensure proper sorting
"""
from datetime import datetime
import re

from sqlalchemy import Integer, cast, func, text
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.models.common_shelf import CommonShelf
from app.core.constants import INTERNAL_CODE_MAX_SEQUENCE, INTERNAL_CODE_SEQUENCE_PAD_WIDTH
from app.core.time_utils import get_utc_now
from app.models.inventory import Inventory

INTERNAL_CODE_CONFLICT_MAX_RETRIES = 3

_SQLITE_CONSTRAINT_UNIQUE = 2067
_SQLITE_CONSTRAINT_PRIMARYKEY = 1555
_INTERNAL_CODE_SEQUENCE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS internal_code_sequences (
    prefix TEXT PRIMARY KEY,
    current_seq INTEGER NOT NULL CHECK(current_seq >= 0),
    updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
)
"""


def _cas_code_fragment(cas_number: str) -> str:
    """Return CAS fragment used in internal_code by removing '-' characters."""
    return cas_number.replace("-", "")


def _date_fragment(created_at: datetime | None = None) -> str:
    """Return the yymmdd fragment used in internal_code."""
    return (created_at or get_utc_now()).strftime("%y%m%d")


def build_internal_code_prefix(cas_number: str, *, created_at: datetime | None = None) -> str:
    """Build internal_code prefix `CASDATE-YYMMDD-` for a CAS/date pair."""
    return f"{_cas_code_fragment(cas_number)}-{_date_fragment(created_at)}-"


def get_max_sequence_for_prefix(session: Session, prefix: str) -> int:
    """Query the current max sequence for an internal_code prefix across both inventory domains."""
    prefix_len = len(prefix)
    max_values: list[int] = []

    inventory_suffix_expr = func.substr(Inventory.internal_code, prefix_len + 1)
    inventory_statement = select(
        func.coalesce(func.max(cast(inventory_suffix_expr, Integer)), 0)
    ).where(Inventory.internal_code.like(f"{prefix}%"))
    max_values.append(int(session.exec(inventory_statement).one() or 0))

    common_suffix_expr = func.substr(CommonShelf.internal_code, prefix_len + 1)
    common_statement = select(
        func.coalesce(func.max(cast(common_suffix_expr, Integer)), 0)
    ).where(CommonShelf.internal_code.like(f"{prefix}%"))
    max_values.append(int(session.exec(common_statement).one() or 0))

    return max(max_values, default=0)


def format_internal_code(prefix: str, sequence: int) -> str:
    """Render a full internal_code with zero-padded numeric suffix."""
    return f"{prefix}{str(sequence).zfill(INTERNAL_CODE_SEQUENCE_PAD_WIDTH)}"


def is_internal_code_unique_violation(exc: IntegrityError) -> bool:
    """Whether an IntegrityError came from an internal_code unique/primary-key constraint."""
    raw_message = str(getattr(exc, "orig", exc)).lower()
    if "internal_code" in raw_message and "unique constraint failed" in raw_message:
        return True

    orig = getattr(exc, "orig", None)
    sqlite_error_name = str(getattr(orig, "sqlite_errorname", "")).upper()
    sqlite_error_code = getattr(orig, "sqlite_errorcode", None)
    if sqlite_error_name in {"SQLITE_CONSTRAINT_UNIQUE", "SQLITE_CONSTRAINT_PRIMARYKEY"}:
        return "internal_code" in raw_message
    if sqlite_error_code in {_SQLITE_CONSTRAINT_UNIQUE, _SQLITE_CONSTRAINT_PRIMARYKEY}:
        return "internal_code" in raw_message
    return False


def _extract_scalar(result_row: object) -> int:
    mapping = getattr(result_row, "_mapping", None)
    if mapping:
        return int(next(iter(mapping.values())))
    if isinstance(result_row, (tuple, list)):
        return int(result_row[0])
    return int(result_row)


def _ensure_internal_code_sequence_table(session: Session) -> None:
    # Use lazy bootstrap so runtime can upgrade old DBs without a separate migration release.
    session.exec(text(_INTERNAL_CODE_SEQUENCE_TABLE_SQL))


def _seed_sequence_prefix(session: Session, *, prefix: str) -> None:
    max_seq = get_max_sequence_for_prefix(session, prefix)
    session.exec(
        text(
            """
            INSERT INTO internal_code_sequences (prefix, current_seq, updated_at)
            VALUES (:prefix, :current_seq, CURRENT_TIMESTAMP)
            ON CONFLICT(prefix) DO NOTHING
            """
        ),
        {"prefix": prefix, "current_seq": max_seq},
    )


def _reserve_sequence_range(
    session: Session,
    *,
    prefix: str,
    quantity: int,
) -> int:
    # Reserve the whole range in one UPDATE ... RETURNING to avoid check-then-insert races.
    _ensure_internal_code_sequence_table(session)
    _seed_sequence_prefix(session, prefix=prefix)
    reserved_row = session.exec(
        text(
            """
            UPDATE internal_code_sequences
            SET current_seq = current_seq + :quantity,
                updated_at = CURRENT_TIMESTAMP
            WHERE prefix = :prefix
              AND current_seq + :quantity <= :max_sequence
            RETURNING current_seq
            """
        ),
        {
            "prefix": prefix,
            "quantity": quantity,
            "max_sequence": INTERNAL_CODE_MAX_SEQUENCE,
        },
    ).first()
    if reserved_row is None:
        raise ValueError("internal code sequence limit reached")
    return _extract_scalar(reserved_row)


def generate_internal_code(
    session: Session,
    cas_number: str,
    quantity: int = 1,
    *,
    created_at: datetime | None = None,
) -> list[str]:
    """
    Generate internal codes for inventory items
    
    Args:
        session: Database session
        cas_number: Normalized CAS number (e.g., "64-17-5")
        quantity: Number of items to generate codes for

    Returns:
        List of internal codes (e.g., ["64175-250113-001", "64175-250113-002"])
    """
    # Validate CAS number to prevent SQL injection
    # CAS should only contain digits and hyphens
    if not re.match(r"^[0-9-]+$", cas_number):
        raise ValueError(f"Invalid CAS number format: {cas_number}")
    if quantity <= 0:
        raise ValueError("quantity must be greater than 0")
    if quantity > INTERNAL_CODE_MAX_SEQUENCE:
        raise ValueError(f"quantity exceeds max sequence capacity: {INTERNAL_CODE_MAX_SEQUENCE}")
    
    date_str = _date_fragment(created_at)
    prefix = build_internal_code_prefix(cas_number, created_at=created_at)
    try:
        end_seq = _reserve_sequence_range(session, prefix=prefix, quantity=quantity)
    except ValueError as exc:
        raise ValueError(
            f"Internal code sequence limit reached for {cas_number} on {date_str}: "
            f"max is {INTERNAL_CODE_MAX_SEQUENCE}"
        ) from exc

    start_seq = end_seq - quantity + 1
    return [format_internal_code(prefix, seq) for seq in range(start_seq, start_seq + quantity)]
