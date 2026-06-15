import pytest

from app.services.cas_utils import (
    BIOLOGICAL_REAGENT_CAS,
    get_cas_prefix,
    is_valid_cas,
    is_special_cas_value,
    normalize_cas,
    validate_and_normalize_cas,
    validate_cas_format,
)


def test_normalize_cas_removes_spaces_tabs_and_uppercases() -> None:
    assert normalize_cas("  ab - 12 - 3 \t") == "AB-12-3"


def test_normalize_cas_replaces_full_width_and_unicode_dashes() -> None:
    assert normalize_cas("58－08–2") == "58-08-2"


def test_is_special_cas_value_accepts_surrounding_spaces() -> None:
    assert is_special_cas_value("  生物试剂  ") is True


def test_validate_cas_format_accepts_special_business_value() -> None:
    is_valid, error = validate_cas_format(BIOLOGICAL_REAGENT_CAS)
    assert is_valid is True
    assert error is None


def test_validate_cas_format_rejects_invalid_pattern() -> None:
    is_valid, error = validate_cas_format("64-175")
    assert is_valid is False
    assert error == "Invalid CAS format. Expected: XXXXX-XX-X"


def test_validate_cas_format_rejects_wrong_check_digit() -> None:
    # 64-17-5 is valid; intentionally use wrong check digit 6
    is_valid, error = validate_cas_format("64-17-6")
    assert is_valid is False
    assert error == "Invalid CAS check digit. Expected: 5"


def test_is_valid_cas_rejects_special_business_value() -> None:
    assert is_valid_cas("58-08-2") is True
    assert is_valid_cas(BIOLOGICAL_REAGENT_CAS) is False


def test_validate_and_normalize_cas_returns_normalized_value_on_error() -> None:
    is_valid, error, normalized = validate_and_normalize_cas(" 64 - 17 - 6 ")
    assert is_valid is False
    assert error == "Invalid CAS check digit. Expected: 5"
    assert normalized == "64-17-6"


@pytest.mark.parametrize(
    ("raw_cas", "expected_prefix"),
    [
        ("64-17-5", "64"),
        ("abc-12-3", "ABC"),
        ("", "UNK"),
    ],
)
def test_get_cas_prefix(raw_cas: str, expected_prefix: str) -> None:
    assert get_cas_prefix(raw_cas) == expected_prefix
