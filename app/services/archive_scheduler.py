"""Periodic log archive scheduler managed by the FastAPI lifespan."""
from __future__ import annotations

import asyncio
import contextlib
import logging
import math
import os
import time
from collections.abc import Callable, Iterator
from datetime import datetime, time as datetime_time, timedelta
from pathlib import Path

from app.archive_logs import resolve_log_archive_output_dir, run_log_archive
from app.archive_query_logs import run_query_log_archive
from app.core.config import settings

logger = logging.getLogger(__name__)

ARCHIVE_LOCK_FILE_NAME = ".archive-scheduler.lock"
ARCHIVE_LOCK_STALE_SECONDS = 6 * 60 * 60

_archive_task: asyncio.Task[None] | None = None
_archive_stop_event: asyncio.Event | None = None
_archive_lock = asyncio.Lock()


class ArchiveProcessLock:
    """Best-effort lock file to avoid duplicate archive runs across workers."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.acquired = False

    def acquire(self) -> bool:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        try:
            self._create_lock_file()
        except FileExistsError:
            if not self._remove_stale_lock():
                return False
            try:
                self._create_lock_file()
            except FileExistsError:
                return False
        self.acquired = True
        return True

    def release(self) -> None:
        if not self.acquired:
            return
        with contextlib.suppress(FileNotFoundError):
            self.path.unlink()
        self.acquired = False

    def _create_lock_file(self) -> None:
        flags = os.O_CREAT | os.O_EXCL | os.O_WRONLY
        fd = os.open(self.path, flags)
        try:
            payload = f"pid={os.getpid()}\ncreated_at={int(time.time())}\n"
            os.write(fd, payload.encode("utf-8"))
        finally:
            os.close(fd)

    def _remove_stale_lock(self) -> bool:
        try:
            age_seconds = time.time() - self.path.stat().st_mtime
        except FileNotFoundError:
            return True
        if age_seconds < ARCHIVE_LOCK_STALE_SECONDS:
            return False
        logger.warning(
            "archive_scheduler_stale_lock path=%s age_seconds=%.0f",
            self.path,
            age_seconds,
        )
        with contextlib.suppress(FileNotFoundError):
            self.path.unlink()
        return True


@contextlib.contextmanager
def _acquire_process_lock(output_dir: Path) -> Iterator[bool]:
    process_lock = ArchiveProcessLock(output_dir / ARCHIVE_LOCK_FILE_NAME)
    acquired = process_lock.acquire()
    try:
        yield acquired
    finally:
        process_lock.release()


def start_archive_scheduler() -> None:
    """Start the archive scheduler if enabled by settings."""
    global _archive_stop_event, _archive_task

    if not settings.archive_scheduler_enabled:
        logger.info("archive_scheduler_skipped enabled=false")
        return
    if _archive_task is not None and not _archive_task.done():
        logger.warning("archive_scheduler_already_running")
        return

    _archive_stop_event = asyncio.Event()
    _archive_task = asyncio.create_task(
        _archive_scheduler_loop(_archive_stop_event),
        name="archive-scheduler",
    )
    if settings.archive_run_at_time is not None:
        if settings.archive_run_weekday is not None:
            logger.info(
                "archive_scheduler_started mode=weekly run_weekday=%s "
                "run_at_time=%s output_dir=%s",
                settings.archive_run_weekday,
                _format_run_at_time(settings.archive_run_at_time),
                settings.archive_output_dir,
            )
        else:
            logger.info(
                "archive_scheduler_started mode=daily run_at_time=%s output_dir=%s",
                _format_run_at_time(settings.archive_run_at_time),
                settings.archive_output_dir,
            )
    else:
        logger.info(
            "archive_scheduler_started mode=interval interval_hours=%s "
            "startup_delay_seconds=%s output_dir=%s",
            settings.archive_interval_hours,
            settings.archive_startup_delay_seconds,
            settings.archive_output_dir,
        )


async def stop_archive_scheduler() -> None:
    """Stop the archive scheduler and wait for any active archive run to finish."""
    global _archive_stop_event, _archive_task

    task = _archive_task
    stop_event = _archive_stop_event
    if task is None:
        return
    if stop_event is not None:
        stop_event.set()
    await task
    _archive_task = None
    _archive_stop_event = None
    logger.info("archive_scheduler_stopped")


async def run_scheduled_archive_once() -> None:
    """Run one archive cycle without raising into the application lifecycle."""
    if _archive_lock.locked():
        logger.warning("archive_scheduler_skip reason=previous_run_active")
        return
    async with _archive_lock:
        try:
            await asyncio.to_thread(_run_archive_batch)
        except Exception:
            logger.exception("archive_scheduler_unexpected_failure")


async def _archive_scheduler_loop(stop_event: asyncio.Event) -> None:
    if settings.archive_run_at_time is not None:
        if settings.archive_run_weekday is not None:
            await _run_weekly_archive_loop(
                stop_event,
                settings.archive_run_at_time,
                settings.archive_run_weekday,
            )
        else:
            await _run_daily_archive_loop(stop_event, settings.archive_run_at_time)
        return

    if await _wait_for_stop(stop_event, settings.archive_startup_delay_seconds):
        return

    while not stop_event.is_set():
        await run_scheduled_archive_once()
        interval_seconds = settings.archive_interval_hours * 60 * 60
        if await _wait_for_stop(stop_event, interval_seconds):
            return


async def _run_daily_archive_loop(
    stop_event: asyncio.Event,
    run_at_time: datetime_time,
) -> None:
    while not stop_event.is_set():
        delay_seconds = _seconds_until_next_daily_run(run_at_time)
        logger.info(
            "archive_scheduler_next_run run_at_time=%s delay_seconds=%s",
            _format_run_at_time(run_at_time),
            delay_seconds,
        )
        if await _wait_for_stop(stop_event, delay_seconds):
            return
        await run_scheduled_archive_once()


async def _run_weekly_archive_loop(
    stop_event: asyncio.Event,
    run_at_time: datetime_time,
    run_weekday: int,
) -> None:
    while not stop_event.is_set():
        delay_seconds = _seconds_until_next_weekly_run(run_at_time, run_weekday)
        logger.info(
            "archive_scheduler_next_run run_weekday=%s run_at_time=%s delay_seconds=%s",
            run_weekday,
            _format_run_at_time(run_at_time),
            delay_seconds,
        )
        if await _wait_for_stop(stop_event, delay_seconds):
            return
        await run_scheduled_archive_once()


def _seconds_until_next_daily_run(run_at_time: datetime_time) -> int:
    now = datetime.now()
    next_run = _next_daily_run_at(now, run_at_time)
    return max(1, math.ceil((next_run - now).total_seconds()))


def _seconds_until_next_weekly_run(run_at_time: datetime_time, run_weekday: int) -> int:
    now = datetime.now()
    next_run = _next_weekly_run_at(now, run_at_time, run_weekday)
    return max(1, math.ceil((next_run - now).total_seconds()))


def _next_daily_run_at(now: datetime, run_at_time: datetime_time) -> datetime:
    next_run = now.replace(
        hour=run_at_time.hour,
        minute=run_at_time.minute,
        second=run_at_time.second,
        microsecond=0,
    )
    if next_run <= now:
        next_run += timedelta(days=1)
    return next_run


def _next_weekly_run_at(
    now: datetime,
    run_at_time: datetime_time,
    run_weekday: int,
) -> datetime:
    next_run = _next_daily_run_at(now, run_at_time)
    days_until_weekday = (run_weekday - next_run.weekday()) % 7
    next_run += timedelta(days=days_until_weekday)
    if next_run <= now:
        next_run += timedelta(days=7)
    return next_run


def _format_run_at_time(run_at_time: datetime_time) -> str:
    return run_at_time.strftime("%H:%M:%S")


async def _wait_for_stop(stop_event: asyncio.Event, seconds: int) -> bool:
    if seconds <= 0:
        return stop_event.is_set()
    try:
        await asyncio.wait_for(stop_event.wait(), timeout=seconds)
        return True
    except TimeoutError:
        return False


def _run_archive_batch() -> None:
    output_dir = resolve_log_archive_output_dir(settings.archive_output_dir)
    with _acquire_process_lock(output_dir) as acquired:
        if not acquired:
            logger.info("archive_scheduler_skip reason=process_lock_held output_dir=%s", output_dir)
            return

        started_at = time.perf_counter()
        failed_jobs = 0
        logger.info("archive_scheduler_run_started output_dir=%s", output_dir)
        for job_name, runner in (
            ("operation_logs", lambda: run_log_archive(output_dir=output_dir, emit_summary=False)),
            (
                "query_logs",
                lambda: run_query_log_archive(output_dir=output_dir, emit_summary=False),
            ),
        ):
            if not _run_archive_job(job_name, runner):
                failed_jobs += 1

        duration_ms = (time.perf_counter() - started_at) * 1000
        if failed_jobs:
            logger.warning(
                "archive_scheduler_run_finished status=failed failed_jobs=%s duration_ms=%.2f",
                failed_jobs,
                duration_ms,
            )
            return
        logger.info("archive_scheduler_run_finished status=ok duration_ms=%.2f", duration_ms)


def _run_archive_job(job_name: str, runner: Callable[[], int]) -> bool:
    started_at = time.perf_counter()
    try:
        exit_code = runner()
    except Exception:
        logger.exception("archive_scheduler_job_failed job=%s", job_name)
        return False

    duration_ms = (time.perf_counter() - started_at) * 1000
    if exit_code != 0:
        logger.error(
            "archive_scheduler_job_failed job=%s exit_code=%s duration_ms=%.2f",
            job_name,
            exit_code,
            duration_ms,
        )
        return False
    logger.info("archive_scheduler_job_finished job=%s duration_ms=%.2f", job_name, duration_ms)
    return True
