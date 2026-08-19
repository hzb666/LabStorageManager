"""Background structure-index revision synchronizer and compactor."""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta

from sqlmodel import Session

from app.core.config import settings
from app.core.time_utils import get_display_tzinfo
from app.database import engine
from app.services.structure_index import (
    StructureIndexSnapshot,
    StructureIndexUnavailableError,
    structure_index,
)

logger = logging.getLogger(__name__)
_SCHEDULER_ERROR_RETRY_SECONDS = 30.0


class StructureIndexScheduler:
    """Single-flight background index maintenance per backend process."""

    def __init__(self) -> None:
        self._task: asyncio.Task[None] | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._wakeup: asyncio.Event | None = None
        self._stopping = False

    def start(self) -> None:
        if self._task is not None and not self._task.done():
            return
        if not settings.chem_structure_feature_enabled:
            return
        self._loop = asyncio.get_running_loop()
        self._wakeup = asyncio.Event()
        self._stopping = False
        structure_index.set_change_notifier(self.notify)
        self._task = self._loop.create_task(self._run(), name="structure-index-scheduler")

    async def stop(self) -> None:
        task = self._task
        if task is None:
            return
        self._stopping = True
        self.notify()
        await task
        structure_index.set_change_notifier(None)
        self._task = None
        self._loop = None
        self._wakeup = None

    def notify(self) -> None:
        loop = self._loop
        wakeup = self._wakeup
        if loop is None or wakeup is None or loop.is_closed():
            return
        loop.call_soon_threadsafe(wakeup.set)

    async def run_once(self, *, daily_maintenance: bool = False) -> None:
        await asyncio.to_thread(
            self._sync_or_compact,
            daily_maintenance=daily_maintenance,
        )

    def _sync_or_compact(
        self,
        *,
        daily_maintenance: bool = False,
        now: datetime | None = None,
    ) -> None:
        with Session(engine) as db:
            if not structure_index.is_initialized() and not structure_index.load_snapshot(db):
                structure_index.compact(db)
                return
            snapshot = structure_index.status(db)
            if snapshot.dirty and snapshot.applied_revision == 0 and snapshot.base_count == 0:
                structure_index.compact(db)
                return
            if structure_index.replay_requires_compaction(snapshot):
                structure_index.compact(db)
                return
            try:
                snapshot = structure_index.ensure_current(db)
            except StructureIndexUnavailableError:
                structure_index.compact(db)
                return
            if daily_maintenance and _scheduled_compaction_due(snapshot, now=now):
                structure_index.compact(db)

    async def _run(self) -> None:
        daily_maintenance = False
        while not self._stopping:
            wakeup = self._wakeup
            if wakeup is None:
                return
            wakeup.clear()
            wait_seconds = _seconds_until_next_maintenance(
                settings.chem_structure_index_maintenance_hour
            )
            maintenance_on_timeout = True
            try:
                await self.run_once(daily_maintenance=daily_maintenance)
            except Exception:
                logger.exception("structure_index_scheduler cycle=failed")
                wait_seconds = _SCHEDULER_ERROR_RETRY_SECONDS
                maintenance_on_timeout = False
            daily_maintenance = False
            if self._stopping:
                return
            if wakeup.is_set():
                continue
            try:
                await asyncio.wait_for(
                    wakeup.wait(),
                    timeout=wait_seconds,
                )
            except TimeoutError:
                daily_maintenance = maintenance_on_timeout


def _seconds_until_next_maintenance(
    hour: int,
    *,
    now: datetime | None = None,
) -> float:
    current = now or datetime.now(get_display_tzinfo())
    next_run = current.replace(hour=hour, minute=0, second=0, microsecond=0)
    if next_run <= current:
        next_run += timedelta(days=1)
    return (next_run - current).total_seconds()


def _scheduled_compaction_due(
    snapshot: StructureIndexSnapshot,
    *,
    now: datetime | None = None,
) -> bool:
    has_changes = snapshot.delta_count > 0 or snapshot.tombstone_count > 0
    if not has_changes:
        return False
    delta_threshold = max(
        settings.chem_structure_index_compaction_min_delta,
        int(snapshot.base_count * settings.chem_structure_index_compaction_ratio),
    )
    threshold_reached = (
        snapshot.delta_count >= delta_threshold
        or snapshot.tombstone_count
        >= settings.chem_structure_index_compaction_tombstone_threshold
    )
    current = now or datetime.now(get_display_tzinfo())
    weekly_maintenance_due = (
        current.weekday()
        == settings.chem_structure_index_weekly_maintenance_weekday
    )
    return threshold_reached or weekly_maintenance_due


structure_index_scheduler = StructureIndexScheduler()


def start_structure_index_scheduler() -> None:
    structure_index_scheduler.start()


async def stop_structure_index_scheduler() -> None:
    await structure_index_scheduler.stop()
