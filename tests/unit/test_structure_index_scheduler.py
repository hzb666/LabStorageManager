from __future__ import annotations

import asyncio
import unittest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

from app.services.structure_index_scheduler import (
    StructureIndexScheduler,
    _seconds_until_next_maintenance,
)


class StructureIndexSchedulerTest(unittest.IsolatedAsyncioTestCase):
    async def test_notification_during_cycle_is_not_cleared_before_wait(self) -> None:
        scheduler = StructureIndexScheduler()
        scheduler._loop = asyncio.get_running_loop()
        scheduler._wakeup = asyncio.Event()
        second_cycle = asyncio.Event()
        cycle_count = 0

        async def _run_once(*, daily_maintenance: bool = False) -> None:
            nonlocal cycle_count
            self.assertFalse(daily_maintenance)
            cycle_count += 1
            if cycle_count == 1:
                scheduler.notify()
                return
            second_cycle.set()
            scheduler._stopping = True

        run_once = AsyncMock(side_effect=_run_once)
        with (
            patch.object(scheduler, "run_once", run_once),
            patch(
                "app.services.structure_index_scheduler."
                "_seconds_until_next_maintenance",
                return_value=10,
            ),
        ):
            task = asyncio.create_task(scheduler._run())
            await asyncio.wait_for(second_cycle.wait(), timeout=1)
            await asyncio.wait_for(task, timeout=1)

        self.assertEqual(2, run_once.await_count)

    def test_next_daily_maintenance_uses_configured_local_hour(self) -> None:
        now = datetime(2026, 7, 27, 2, 30, tzinfo=timezone.utc)
        self.assertEqual(
            30 * 60,
            _seconds_until_next_maintenance(3, now=now),
        )
        self.assertEqual(
            24 * 60 * 60,
            _seconds_until_next_maintenance(
                3,
                now=datetime(2026, 7, 27, 3, 0, tzinfo=timezone.utc),
            ),
        )

    async def test_transient_cycle_failure_retries_without_daily_compaction(self) -> None:
        scheduler = StructureIndexScheduler()
        scheduler._loop = asyncio.get_running_loop()
        scheduler._wakeup = asyncio.Event()
        second_cycle = asyncio.Event()
        daily_flags: list[bool] = []

        async def _run_once(*, daily_maintenance: bool = False) -> None:
            daily_flags.append(daily_maintenance)
            if len(daily_flags) == 1:
                raise RuntimeError("database is locked")
            second_cycle.set()
            scheduler._stopping = True

        with (
            patch.object(scheduler, "run_once", side_effect=_run_once),
            patch(
                "app.services.structure_index_scheduler."
                "_SCHEDULER_ERROR_RETRY_SECONDS",
                0.01,
            ),
        ):
            task = asyncio.create_task(scheduler._run())
            await asyncio.wait_for(second_cycle.wait(), timeout=1)
            await asyncio.wait_for(task, timeout=1)

        self.assertEqual([False, False], daily_flags)


if __name__ == "__main__":
    unittest.main()
