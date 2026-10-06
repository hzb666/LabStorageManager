from __future__ import annotations

import unittest
from datetime import datetime, time

from pydantic import ValidationError

from app.core.config import Settings
from app.services.archive_scheduler import _next_monthly_run_at


class ArchiveSchedulerTest(unittest.TestCase):
    def test_monthly_run_uses_current_month_when_still_upcoming(self) -> None:
        now = datetime(2026, 10, 1, 3, 0)

        self.assertEqual(
            datetime(2026, 10, 1, 3, 30),
            _next_monthly_run_at(now, time(3, 30), 1),
        )

    def test_monthly_run_advances_after_scheduled_time(self) -> None:
        now = datetime(2026, 10, 1, 3, 30)

        self.assertEqual(
            datetime(2026, 11, 1, 3, 30),
            _next_monthly_run_at(now, time(3, 30), 1),
        )

    def test_monthly_run_clamps_to_last_day_of_short_month(self) -> None:
        now = datetime(2027, 2, 1, 0, 0)

        self.assertEqual(
            datetime(2027, 2, 28, 3, 30),
            _next_monthly_run_at(now, time(3, 30), 31),
        )

    def test_monthly_day_and_weekday_are_mutually_exclusive(self) -> None:
        with self.assertRaises(ValidationError):
            Settings(
                _env_file=None,
                archive_run_at_time="03:30",
                archive_run_day=1,
                archive_run_weekday="sun",
            )

    def test_monthly_day_requires_run_time(self) -> None:
        with self.assertRaises(ValidationError):
            Settings(
                _env_file=None,
                archive_run_at_time="",
                archive_run_day=1,
                archive_run_weekday="",
            )


if __name__ == "__main__":
    unittest.main()
