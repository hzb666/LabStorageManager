"""Repository operations for durable structure-resolution jobs."""
from __future__ import annotations

import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import Engine, text
from sqlmodel import Session, func, select

from app.core.time_utils import get_utc_now
from app.models.structure_index import StructureResolutionJob, StructureResolutionJobState
from app.services.cas_utils import normalize_cas


MAX_JOB_ERROR_MESSAGE_LENGTH = 500
LEASE_ATTEMPT_LIMIT_ERROR_CODE = "lease_attempt_limit_exhausted"
LEASE_ATTEMPT_LIMIT_ERROR_MESSAGE = (
    "Structure resolution lease expired after the maximum number of attempts"
)
_EXHAUST_DUE_ATTEMPT_LIMIT_SQL = text(
    """
    UPDATE structure_resolution_job
    SET state = 'exhausted',
        retry_count = CASE
            WHEN retry_count < :max_retries THEN :max_retries
            ELSE retry_count
        END,
        next_attempt_at = NULL,
        lease_token = NULL,
        lease_until = NULL,
        last_error_code = CASE
            WHEN state = 'running' THEN :lease_error_code
            ELSE COALESCE(last_error_code, :attempt_error_code)
        END,
        last_error_message = CASE
            WHEN state = 'running' THEN :lease_error_message
            ELSE COALESCE(last_error_message, :attempt_error_message)
        END,
        updated_at = :now
    WHERE attempt_count >= :max_attempts
    AND (
        (
            state = 'queued'
            AND next_attempt_at IS NOT NULL
            AND next_attempt_at <= :now
        ) OR (
            state = 'running'
            AND lease_until IS NOT NULL
            AND lease_until <= :now
        )
    )
    """
)
_CLAIM_DUE_JOBS_SQL = text(
    """
    UPDATE structure_resolution_job
    SET state = 'running',
        attempt_count = attempt_count + 1,
        retry_count = CASE
            WHEN state = 'running' AND retry_count < :max_retries
            THEN retry_count + 1
            ELSE retry_count
        END,
        lease_token = :lease_token,
        lease_until = :lease_until,
        updated_at = :now
    WHERE cas_number IN (
        SELECT cas_number
        FROM structure_resolution_job
        WHERE (
            (
                state = 'queued'
                AND next_attempt_at IS NOT NULL
                AND next_attempt_at <= :now
            ) OR (
                state = 'running'
                AND lease_until IS NOT NULL
                AND lease_until <= :now
            )
        )
        AND attempt_count < :max_attempts
        ORDER BY
            CASE WHEN next_attempt_at IS NULL THEN lease_until ELSE next_attempt_at END,
            cas_number
        LIMIT :batch_size
    )
    AND (
        (state = 'queued' AND next_attempt_at IS NOT NULL AND next_attempt_at <= :now)
        OR
        (state = 'running' AND lease_until IS NOT NULL AND lease_until <= :now)
    )
    AND attempt_count < :max_attempts
    RETURNING cas_number, attempt_count, retry_count, trigger_reason
    """
)
_RENEW_CLAIMED_JOB_LEASE_SQL = text(
    """
    UPDATE structure_resolution_job
    SET lease_until = :lease_until,
        updated_at = :now
    WHERE cas_number = :cas_number
    AND state = 'running'
    AND lease_token = :lease_token
    RETURNING cas_number
    """
)


@dataclass(frozen=True)
class ClaimedResolutionJob:
    """Immutable lease identity returned by an atomic claim."""

    cas_number: str
    lease_token: str
    attempt_count: int
    retry_count: int
    trigger_reason: str


@dataclass(frozen=True)
class StructureResolutionJobCounts:
    queued: int = 0
    running: int = 0
    exhausted: int = 0


class StructureResolutionLeaseLostError(RuntimeError):
    """Raised when a worker attempts to finish a stale lease."""


def count_structure_resolution_jobs(db: Session) -> StructureResolutionJobCounts:
    """Return observable queue counts without exposing job payloads."""
    counts = dict.fromkeys(StructureResolutionJobState, 0)
    rows = db.exec(
        select(StructureResolutionJob.state, func.count()).group_by(
            StructureResolutionJob.state
        )
    ).all()
    for state, count in rows:
        counts[StructureResolutionJobState(state)] = int(count)
    return StructureResolutionJobCounts(
        queued=counts[StructureResolutionJobState.QUEUED],
        running=counts[StructureResolutionJobState.RUNNING],
        exhausted=counts[StructureResolutionJobState.EXHAUSTED],
    )


def enqueue_structure_resolution_job(
    db: Session,
    cas_number: str,
    *,
    trigger_reason: str,
    now: datetime | None = None,
    force: bool = False,
) -> bool:
    """Create one immediate job or explicitly reset an exhausted job."""
    normalized_cas = normalize_cas(cas_number)
    if not normalized_cas:
        return False
    current_time = now or get_utc_now()
    existing = db.get(StructureResolutionJob, normalized_cas)
    if existing is None:
        db.add(
            StructureResolutionJob(
                cas_number=normalized_cas,
                trigger_reason=trigger_reason[:100],
                next_attempt_at=current_time,
                created_at=current_time,
                updated_at=current_time,
            )
        )
        return True
    if existing.state != StructureResolutionJobState.EXHAUSTED or not force:
        return False

    existing.state = StructureResolutionJobState.QUEUED
    existing.attempt_count = 0
    existing.retry_count = 0
    existing.next_attempt_at = current_time
    existing.lease_token = None
    existing.lease_until = None
    existing.trigger_reason = trigger_reason[:100]
    existing.last_error_code = None
    existing.last_error_message = None
    existing.updated_at = current_time
    return True


def claim_due_resolution_jobs(
    engine: Engine,
    *,
    now: datetime,
    batch_size: int,
    lease_seconds: float,
    max_attempts: int,
) -> list[ClaimedResolutionJob]:
    """Atomically claim a bounded due batch, including expired running leases."""
    if batch_size <= 0:
        return []
    if max_attempts <= 0:
        raise ValueError("max_attempts must be positive")
    if lease_seconds <= 0:
        raise ValueError("lease_seconds must be positive")
    lease_token = secrets.token_hex(16)
    lease_until = now + timedelta(seconds=lease_seconds)
    max_retries = max_attempts - 1
    with engine.begin() as connection:
        connection.execute(
            _EXHAUST_DUE_ATTEMPT_LIMIT_SQL,
            {
                "max_attempts": max_attempts,
                "max_retries": max_retries,
                "lease_error_code": LEASE_ATTEMPT_LIMIT_ERROR_CODE,
                "lease_error_message": LEASE_ATTEMPT_LIMIT_ERROR_MESSAGE,
                "attempt_error_code": "attempt_limit_exhausted",
                "attempt_error_message": "Structure resolution reached the attempt limit",
                "now": now,
            },
        )
        rows = connection.execute(
            _CLAIM_DUE_JOBS_SQL,
            {
                "lease_token": lease_token,
                "lease_until": lease_until,
                "now": now,
                "batch_size": batch_size,
                "max_attempts": max_attempts,
                "max_retries": max_retries,
            },
        ).mappings().all()
    return [
        ClaimedResolutionJob(
            cas_number=str(row["cas_number"]),
            lease_token=lease_token,
            attempt_count=int(row["attempt_count"]),
            retry_count=int(row["retry_count"]),
            trigger_reason=str(row["trigger_reason"]),
        )
        for row in rows
    ]


def renew_claimed_resolution_job_lease(
    engine: Engine,
    claimed: ClaimedResolutionJob,
    *,
    now: datetime,
    lease_seconds: float,
) -> bool:
    """Extend one active lease only when its token is still current."""
    if lease_seconds <= 0:
        raise ValueError("lease_seconds must be positive")
    with engine.begin() as connection:
        renewed = connection.execute(
            _RENEW_CLAIMED_JOB_LEASE_SQL,
            {
                "cas_number": claimed.cas_number,
                "lease_token": claimed.lease_token,
                "lease_until": now + timedelta(seconds=lease_seconds),
                "now": now,
            },
        ).first()
    return renewed is not None


def delete_claimed_resolution_job(
    db: Session,
    claimed: ClaimedResolutionJob,
) -> None:
    """Delete a completed or terminal job only while its lease is current."""
    job = _get_claimed_job(db, claimed)
    db.delete(job)


def reschedule_claimed_resolution_job(
    db: Session,
    claimed: ClaimedResolutionJob,
    *,
    now: datetime,
    retry_delays_seconds: tuple[int, ...],
    error_code: str,
    error_message: str,
    retry_after_seconds: int | None = None,
    jitter_seconds: int = 0,
) -> StructureResolutionJob:
    """Persist the next due time or leave the fourth failed attempt exhausted."""
    job = _get_claimed_job(db, claimed)
    job.last_error_code = error_code[:100]
    job.last_error_message = error_message[:MAX_JOB_ERROR_MESSAGE_LENGTH]
    job.lease_token = None
    job.lease_until = None
    job.updated_at = now

    if job.retry_count >= len(retry_delays_seconds):
        job.state = StructureResolutionJobState.EXHAUSTED
        job.next_attempt_at = None
        return job

    delay_seconds = retry_delays_seconds[job.retry_count]
    if retry_after_seconds is not None:
        delay_seconds = retry_after_seconds
    else:
        delay_seconds += max(0, jitter_seconds)
    job.retry_count += 1
    job.state = StructureResolutionJobState.QUEUED
    job.next_attempt_at = now + timedelta(seconds=delay_seconds)
    return job


def _get_claimed_job(
    db: Session,
    claimed: ClaimedResolutionJob,
) -> StructureResolutionJob:
    job = db.get(StructureResolutionJob, claimed.cas_number)
    if (
        job is None
        or job.state != StructureResolutionJobState.RUNNING
        or job.lease_token != claimed.lease_token
    ):
        raise StructureResolutionLeaseLostError("Structure resolution lease is no longer current")
    return job
