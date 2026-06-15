from datetime import datetime, timezone

from app.core import time_utils


def test_to_display_time_uses_configured_offset(monkeypatch) -> None:
    monkeypatch.setattr(time_utils.settings, "display_utc_offset", "-08:00")

    result = time_utils.to_display_time(datetime(2026, 4, 24, 8, 0, 0))

    assert result == datetime(2026, 4, 24, 0, 0, 0)


def test_normalize_to_utc_naive_assumes_display_offset_for_naive_datetime(monkeypatch) -> None:
    monkeypatch.setattr(time_utils.settings, "display_utc_offset", "+08:00")

    result = time_utils.normalize_to_utc_naive(datetime(2026, 4, 24, 8, 0, 0))

    assert result == datetime(2026, 4, 24, 0, 0, 0)


def test_normalize_to_utc_naive_preserves_aware_datetime_absolute_time(monkeypatch) -> None:
    monkeypatch.setattr(time_utils.settings, "display_utc_offset", "+08:00")
    aware_datetime = datetime(2026, 4, 24, 9, 30, 0, tzinfo=timezone.utc)

    result = time_utils.normalize_to_utc_naive(aware_datetime)

    assert result == datetime(2026, 4, 24, 9, 30, 0)


def test_utc_iso_str_returns_utc_suffix_for_naive_datetime() -> None:
    result = time_utils.utc_iso_str(datetime(2026, 4, 24, 8, 0, 0))

    assert result == "2026-04-24T08:00:00Z"
