"""Bounded durable scheduler for automatic PubChem structure resolution."""
from __future__ import annotations

import asyncio
import logging
import random
from datetime import datetime

from sqlalchemy import text
from sqlmodel import Session

from app.core.config import settings
from app.core.time_utils import get_utc_now, parse_utc_datetime
from app.database import engine
from app.models.compound_structure import CompoundStructureStatus
from app.services.pubchem_resolver import (
    PubChemRequestRateLimiter,
    PubChemResolver,
    ResolutionOutcome,
    ResolutionOutcomeKind,
    ResolvedStructure,
    create_pubchem_client,
)
from app.services.structure_cache_repo import get_structure_cache, upsert_structure_cache
from app.services.structure_index import structure_index
from app.services.structure_resolution_jobs import (
    ClaimedResolutionJob,
    StructureResolutionLeaseLostError,
    claim_due_resolution_jobs,
    delete_claimed_resolution_job,
    renew_claimed_resolution_job_lease,
    reschedule_claimed_resolution_job,
)
from app.services.structure_search_cache import clear_structure_search_cache

logger = logging.getLogger(__name__)
_SCHEDULER_ERROR_RETRY_SECONDS = 30.0

_TERMINAL_CACHE_STATUSES = {
    CompoundStructureStatus.RESOLVED,
    CompoundStructureStatus.AMBIGUOUS,
    CompoundStructureStatus.NOT_FOUND,
    CompoundStructureStatus.INVALID_CAS,
    CompoundStructureStatus.UNSUPPORTED,
}


class StructureResolutionScheduler:
    """One process scheduler using a global event and SQLite leases."""

    def __init__(self) -> None:
        self._task: asyncio.Task[None] | None = None
        self._wakeup: asyncio.Event | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._stopping = False
        self._pubchem_rate_limiter: PubChemRequestRateLimiter | None = None

    def start(self) -> None:
        if self._task is not None and not self._task.done():
            return
        if not _scheduler_enabled():
            logger.info("structure_resolution_scheduler state=disabled")
            return
        self._loop = asyncio.get_running_loop()
        self._wakeup = asyncio.Event()
        self._stopping = False
        self._task = self._loop.create_task(self._run(), name="structure-resolution-scheduler")
        logger.info("structure_resolution_scheduler state=started")

    async def stop(self) -> None:
        task = self._task
        if task is None:
            return
        self._stopping = True
        self.notify()
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        finally:
            self._task = None
            self._wakeup = None
            self._loop = None
            logger.info("structure_resolution_scheduler state=stopped")

    def notify(self) -> None:
        loop = self._loop
        wakeup = self._wakeup
        if loop is None or wakeup is None or loop.is_closed():
            return
        loop.call_soon_threadsafe(wakeup.set)

    async def run_once(self, *, now: datetime | None = None) -> int:
        """Claim and process one bounded batch, primarily for tests and operations."""
        current_time = now or get_utc_now()
        claimed = await asyncio.to_thread(
            claim_due_resolution_jobs,
            engine,
            now=current_time,
            batch_size=settings.chem_resolution_job_concurrency,
            lease_seconds=settings.chem_resolution_job_lease_seconds,
            max_attempts=len(settings.chem_resolution_retry_delays_seconds) + 1,
        )
        if not claimed:
            return 0
        async with create_pubchem_client(
            timeout_seconds=settings.chem_pubchem_timeout_seconds,
            user_agent=settings.chem_pubchem_user_agent,
        ) as client:
            rate_limiter = self._get_pubchem_rate_limiter()
            resolver = PubChemResolver(
                client,
                min_interval_seconds=rate_limiter.min_interval_seconds,
                max_retries=0,
                rate_limiter=rate_limiter,
            )
            await asyncio.gather(
                *(_process_claimed_job(job, resolver=resolver) for job in claimed)
            )
        return len(claimed)

    def _get_pubchem_rate_limiter(self) -> PubChemRequestRateLimiter:
        min_interval_seconds = 1 / settings.chem_pubchem_rate_limit_per_second
        limiter = self._pubchem_rate_limiter
        if (
            limiter is None
            or limiter.min_interval_seconds != min_interval_seconds
        ):
            limiter = PubChemRequestRateLimiter(
                min_interval_seconds=min_interval_seconds
            )
            self._pubchem_rate_limiter = limiter
        return limiter

    async def _run(self) -> None:
        while not self._stopping:
            wakeup = self._wakeup
            if wakeup is None:
                return
            wakeup.clear()
            try:
                await self.run_once()
                next_due_at = await asyncio.to_thread(_get_next_due_at)
                if self._stopping:
                    return
                if wakeup.is_set():
                    continue
                await self._wait_for_wakeup(
                    _seconds_until(next_due_at, get_utc_now())
                )
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("structure_resolution_scheduler cycle=failed")
                if not self._stopping:
                    await self._wait_for_wakeup(_SCHEDULER_ERROR_RETRY_SECONDS)

    async def _wait_for_wakeup(self, timeout_seconds: float | None) -> bool:
        wakeup = self._wakeup
        if wakeup is None:
            return False
        if timeout_seconds is None:
            await wakeup.wait()
            return True
        try:
            await asyncio.wait_for(
                wakeup.wait(),
                timeout=timeout_seconds,
            )
            return True
        except TimeoutError:
            return False


async def _process_claimed_job(
    claimed: ClaimedResolutionJob,
    *,
    resolver: PubChemResolver,
) -> None:
    stop_renewal = asyncio.Event()
    operation_task = asyncio.create_task(
        _process_current_claim(
            claimed,
            resolver=resolver,
        )
    )
    renewal_task = asyncio.create_task(
        _maintain_claimed_job_lease(claimed, stop=stop_renewal)
    )
    try:
        done, _pending = await asyncio.wait(
            {operation_task, renewal_task},
            return_when=asyncio.FIRST_COMPLETED,
        )
        if operation_task in done:
            await operation_task
            return
        if not await renewal_task:
            raise StructureResolutionLeaseLostError(
                "Structure resolution lease renewal failed"
            )
        await operation_task
    except StructureResolutionLeaseLostError:
        logger.warning(
            "structure_resolution_job outcome=lease_lost cas=%s attempt=%s",
            claimed.cas_number,
            claimed.attempt_count,
        )
    except Exception:
        logger.exception(
            "structure_resolution_job outcome=worker_failed cas=%s attempt=%s",
            claimed.cas_number,
            claimed.attempt_count,
        )
    finally:
        stop_renewal.set()
        if not operation_task.done():
            operation_task.cancel()
        await asyncio.gather(operation_task, renewal_task, return_exceptions=True)


async def _process_current_claim(
    claimed: ClaimedResolutionJob,
    *,
    resolver: PubChemResolver,
) -> None:
    if await asyncio.to_thread(_delete_job_if_cache_terminal, claimed):
        return
    outcome = await _resolve_with_timeout(claimed.cas_number, resolver=resolver)
    if outcome.retryable:
        await asyncio.to_thread(_persist_retryable_outcome, claimed, outcome)
        return
    await asyncio.to_thread(_persist_terminal_outcome, claimed, outcome)


async def _maintain_claimed_job_lease(
    claimed: ClaimedResolutionJob,
    *,
    stop: asyncio.Event,
) -> bool:
    interval_seconds = settings.chem_resolution_job_lease_seconds / 3
    while True:
        try:
            await asyncio.wait_for(stop.wait(), timeout=interval_seconds)
            return True
        except TimeoutError:
            pass
        try:
            renewed = await asyncio.to_thread(
                renew_claimed_resolution_job_lease,
                engine,
                claimed,
                now=get_utc_now(),
                lease_seconds=settings.chem_resolution_job_lease_seconds,
            )
        except Exception:
            logger.exception(
                "structure_resolution_job outcome=lease_renewal_failed cas=%s attempt=%s",
                claimed.cas_number,
                claimed.attempt_count,
            )
            return False
        if not renewed:
            return False


async def _resolve_with_timeout(
    cas_number: str,
    *,
    resolver: PubChemResolver,
) -> ResolutionOutcome:
    try:
        return await asyncio.wait_for(
            _resolve_once(cas_number, resolver=resolver),
            timeout=settings.chem_resolution_job_attempt_timeout_seconds,
        )
    except TimeoutError:
        message = "Structure resolution attempt exceeded the configured timeout"
        return ResolutionOutcome(
            kind=ResolutionOutcomeKind.RETRYABLE_ERROR,
            result=ResolvedStructure(
                cas_number=cas_number,
                status=CompoundStructureStatus.ERROR,
                error_message=message,
            ),
            error_code="attempt_timeout",
            error_message=message,
        )


async def _resolve_once(
    cas_number: str,
    *,
    resolver: PubChemResolver,
) -> ResolutionOutcome:
    return await resolver.resolve_cas_outcome(cas_number)


def _delete_job_if_cache_terminal(claimed: ClaimedResolutionJob) -> bool:
    with Session(engine) as db:
        existing = get_structure_cache(db, claimed.cas_number)
        if existing is None:
            return False
        if not existing.manually_verified and existing.status not in _TERMINAL_CACHE_STATUSES:
            return False
        delete_claimed_resolution_job(db, claimed)
        db.commit()
    logger.info(
        "structure_resolution_job outcome=cache_terminal cas=%s attempt=%s",
        claimed.cas_number,
        claimed.attempt_count,
    )
    return True


def _persist_terminal_outcome(
    claimed: ClaimedResolutionJob,
    outcome: ResolutionOutcome,
) -> None:
    with Session(engine) as db:
        existing = get_structure_cache(db, claimed.cas_number)
        if existing is None or not existing.manually_verified:
            upsert_structure_cache(db, outcome.result.to_cache_write(), skip_manual=True)
        delete_claimed_resolution_job(db, claimed)
        db.commit()
    structure_index.notify_change()
    clear_structure_search_cache()
    logger.info(
        "structure_resolution_job outcome=%s cas=%s attempt=%s",
        outcome.kind.value,
        claimed.cas_number,
        claimed.attempt_count,
    )


def _persist_retryable_outcome(
    claimed: ClaimedResolutionJob,
    outcome: ResolutionOutcome,
) -> None:
    retry_after_seconds = _clamp_retry_after(outcome.retry_after_seconds)
    with Session(engine) as db:
        existing = get_structure_cache(db, claimed.cas_number)
        if existing is not None and existing.manually_verified:
            delete_claimed_resolution_job(db, claimed)
            db.commit()
            return
        upsert_structure_cache(db, outcome.result.to_cache_write(), skip_manual=True)
        job = reschedule_claimed_resolution_job(
            db,
            claimed,
            now=get_utc_now(),
            retry_delays_seconds=settings.chem_resolution_retry_delays_seconds,
            error_code=outcome.error_code or "unexpected_error",
            error_message=outcome.error_message or "Temporary structure resolution failure",
            retry_after_seconds=retry_after_seconds,
            jitter_seconds=_retry_jitter_seconds(),
        )
        db.commit()
        state = job.state.value
        retry_count = job.retry_count
    structure_index.notify_change()
    clear_structure_search_cache()
    logger.warning(
        "structure_resolution_job outcome=%s cas=%s attempt=%s retry_count=%s error_code=%s",
        state,
        claimed.cas_number,
        claimed.attempt_count,
        retry_count,
        outcome.error_code,
    )


def _clamp_retry_after(value: int | None) -> int | None:
    if value is None:
        return None
    return min(
        max(value, settings.chem_resolution_retry_after_min_seconds),
        settings.chem_resolution_retry_after_max_seconds,
    )


def _retry_jitter_seconds(*, random_value: float | None = None) -> int:
    maximum = settings.chem_resolution_retry_jitter_seconds
    if maximum <= 0:
        return 0
    value = random.random() if random_value is None else random_value
    return int(maximum * min(1.0, max(0.0, value)))


def _get_next_due_at() -> datetime | None:
    with engine.connect() as connection:
        value = connection.execute(
            text(
                """
                SELECT MIN(due_at)
                FROM (
                    SELECT next_attempt_at AS due_at
                    FROM structure_resolution_job
                    WHERE state = 'queued' AND next_attempt_at IS NOT NULL
                    UNION ALL
                    SELECT lease_until AS due_at
                    FROM structure_resolution_job
                    WHERE state = 'running' AND lease_until IS NOT NULL
                )
                """
            )
        ).scalar_one_or_none()
    return value if isinstance(value, datetime) else parse_utc_datetime(value)


def _seconds_until(due_at: datetime | None, now: datetime) -> float | None:
    if due_at is None:
        return None
    return max(0.0, (due_at - now).total_seconds())


def _scheduler_enabled() -> bool:
    return (
        settings.chem_structure_feature_enabled
        and settings.chem_resolver_pubchem_enabled
        and settings.chem_resolution_scheduler_enabled
    )


structure_resolution_scheduler = StructureResolutionScheduler()


def start_structure_resolution_scheduler() -> None:
    structure_resolution_scheduler.start()


async def stop_structure_resolution_scheduler() -> None:
    await structure_resolution_scheduler.stop()
