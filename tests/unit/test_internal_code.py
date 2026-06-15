from datetime import datetime

import pytest
from sqlalchemy.exc import IntegrityError

from app.services import internal_code
from app.services.internal_code import generate_internal_code, is_internal_code_unique_violation


class _FakeResult:
    def __init__(self, value: object) -> None:
        self._value = value

    def one(self) -> object:
        return self._value

    def first(self) -> object:
        return self._value


class _FakeSession:
    def __init__(self, max_seq: int = 0) -> None:
        self.max_seq = max_seq
        self.last_statement = None

    def exec(self, statement, params=None):
        self.last_statement = statement
        return _FakeResult(self.max_seq)


def test_generate_internal_code_starts_from_one_when_no_existing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(internal_code, "get_utc_now", lambda: datetime(2025, 1, 13))
    session = _FakeSession()
    monkeypatch.setattr(internal_code, "_reserve_sequence_range", lambda *_args, **_kwargs: 2)

    codes = generate_internal_code(session, "64-17-5", quantity=2)

    assert codes == ["64175-250113-001", "64175-250113-002"]


def test_generate_internal_code_uses_reserved_range(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(internal_code, "get_utc_now", lambda: datetime(2025, 1, 13))
    session = _FakeSession()
    monkeypatch.setattr(internal_code, "_reserve_sequence_range", lambda *_args, **_kwargs: 11)

    codes = generate_internal_code(session, "64-17-5", quantity=2)

    assert codes == ["64175-250113-010", "64175-250113-011"]


def test_generate_internal_code_rejects_invalid_cas() -> None:
    session = _FakeSession()
    with pytest.raises(ValueError, match="Invalid CAS number format"):
        generate_internal_code(session, "64-17-5;DROP", quantity=1)


def test_generate_internal_code_rejects_non_positive_quantity() -> None:
    session = _FakeSession()
    with pytest.raises(ValueError, match="quantity must be greater than 0"):
        generate_internal_code(session, "64-17-5", quantity=0)


def test_generate_internal_code_rejects_when_sequence_limit_exceeded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(internal_code, "get_utc_now", lambda: datetime(2025, 1, 13))
    session = _FakeSession()
    monkeypatch.setattr(
        internal_code,
        "_reserve_sequence_range",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(ValueError("internal code sequence limit reached")),
    )

    with pytest.raises(ValueError, match="Internal code sequence limit reached"):
        generate_internal_code(session, "64-17-5", quantity=1)


def test_generate_internal_code_rejects_quantity_above_limit() -> None:
    session = _FakeSession()
    with pytest.raises(ValueError, match="quantity exceeds max sequence capacity"):
        generate_internal_code(session, "64-17-5", quantity=internal_code.INTERNAL_CODE_MAX_SEQUENCE + 1)


class _FakeOrig:
    def __init__(self, message: str, *, error_name: str = "", error_code: int | None = None) -> None:
        self.message = message
        self.sqlite_errorname = error_name
        self.sqlite_errorcode = error_code

    def __str__(self) -> str:
        return self.message


def _build_integrity_error(orig: _FakeOrig) -> IntegrityError:
    return IntegrityError("statement", {"value": "x"}, orig)


def test_is_internal_code_unique_violation_by_message() -> None:
    exc = _build_integrity_error(_FakeOrig("UNIQUE constraint failed: inventory.internal_code"))
    assert is_internal_code_unique_violation(exc) is True


def test_is_internal_code_unique_violation_by_sqlite_code() -> None:
    exc = _build_integrity_error(
        _FakeOrig(
            "constraint failed on common_inventory.internal_code",
            error_name="SQLITE_CONSTRAINT_UNIQUE",
            error_code=2067,
        )
    )
    assert is_internal_code_unique_violation(exc) is True
