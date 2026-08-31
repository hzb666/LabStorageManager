from __future__ import annotations

import asyncio
import tempfile
import time
import unittest
from datetime import timedelta
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch

import httpx
from sqlalchemy import event
from sqlmodel import Session, SQLModel, create_engine

import app.models
from app.core.time_utils import get_utc_now
from app.db_bootstrap.structure_index_schema import ensure_structure_index_schema
from app.models.compound_structure import CompoundStructureStatus
from app.models.structure_index import StructureResolutionJob
from app.services.pubchem_resolver import (
    ResolutionOutcome,
    ResolutionOutcomeKind,
    ResolvedStructure,
)
from app.services.structure_cache_repo import StructureCacheWrite, upsert_structure_cache
from app.services.structure_resolution_jobs import (
    claim_due_resolution_jobs,
    enqueue_structure_resolution_job,
)
from app.services.structure_resolution_scheduler import (
    StructureResolutionScheduler,
    _retry_jitter_seconds,
)


class _TimedNotFoundClient:
    def __init__(self) -> None:
        self.request_times: list[float] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, _exc_type, _exc, _traceback) -> None:
        return None

    async def get(self, url: str) -> httpx.Response:
        self.request_times.append(time.perf_counter())
        request = httpx.Request("GET", url)
        return httpx.Response(status_code=404, request=request)


class StructureResolutionSchedulerTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self._temp_dir = tempfile.TemporaryDirectory()
        database_path = Path(self._temp_dir.name) / "scheduler.db"
        self.engine = create_engine(
            f"sqlite:///{database_path.as_posix()}",
            connect_args={"check_same_thread": False},
        )

        @event.listens_for(self.engine, "connect")
        def _set_pragmas(dbapi_connection, _connection_record) -> None:
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

        SQLModel.metadata.create_all(self.engine)
        with self.engine.begin() as connection:
            ensure_structure_index_schema(connection)

    def tearDown(self) -> None:
        self.engine.dispose()
        self._temp_dir.cleanup()

    async def test_future_job_wait_is_only_persisted_state(self) -> None:
        now = get_utc_now()
        with Session(self.engine) as db:
            enqueue_structure_resolution_job(
                db,
                "64-17-5",
                trigger_reason="inventory_create",
                now=now,
            )
            job = db.get(StructureResolutionJob, "64-17-5")
            assert job is not None
            job.next_attempt_at = now + timedelta(minutes=1)
            db.commit()

        resolver = AsyncMock()
        scheduler = StructureResolutionScheduler()
        tasks_before = set(asyncio.all_tasks())
        with (
            patch("app.services.structure_resolution_scheduler.engine", self.engine),
            patch("app.services.structure_resolution_scheduler._resolve_once", resolver),
        ):
            processed = await scheduler.run_once(now=now)
        tasks_after = set(asyncio.all_tasks())

        self.assertEqual(0, processed)
        resolver.assert_not_awaited()
        self.assertEqual(tasks_before, tasks_after)
        self.assertEqual(0, self.engine.pool.checkedout())
        with Session(self.engine) as db:
            persisted = db.get(StructureResolutionJob, "64-17-5")
            self.assertIsNotNone(persisted)

    async def test_terminal_outcome_is_persisted_and_job_is_deleted(self) -> None:
        now = get_utc_now()
        with Session(self.engine) as db:
            enqueue_structure_resolution_job(
                db,
                "64-17-5",
                trigger_reason="inventory_create",
                now=now,
            )
            db.commit()
        outcome = ResolutionOutcome(
            kind=ResolutionOutcomeKind.TERMINAL_AMBIGUOUS,
            result=ResolvedStructure(
                cas_number="64-17-5",
                status=CompoundStructureStatus.AMBIGUOUS,
            ),
        )
        resolver = AsyncMock(return_value=outcome)
        scheduler = StructureResolutionScheduler()

        with (
            patch("app.services.structure_resolution_scheduler.engine", self.engine),
            patch("app.services.structure_resolution_scheduler._resolve_once", resolver),
        ):
            processed = await scheduler.run_once(now=now)

        self.assertEqual(1, processed)
        resolver.assert_awaited_once()
        self.assertEqual(("64-17-5",), resolver.await_args.args)
        self.assertIn("resolver", resolver.await_args.kwargs)
        with Session(self.engine) as db:
            self.assertIsNone(db.get(StructureResolutionJob, "64-17-5"))
            cache = db.get(app.models.CompoundStructureCache, "64-17-5")
            self.assertIsNotNone(cache)
            assert cache is not None
            self.assertEqual(CompoundStructureStatus.AMBIGUOUS, cache.status)
            meta = db.get(app.models.StructureIndexMeta, 1)
            self.assertIsNotNone(meta)
            assert meta is not None
            self.assertEqual(1, meta.current_revision)
            self.assertIsNotNone(db.get(app.models.StructureIndexChange, 1))

    async def test_long_attempt_renews_lease_and_cannot_be_claimed_twice(self) -> None:
        now = get_utc_now()
        with Session(self.engine) as db:
            enqueue_structure_resolution_job(
                db,
                "64-17-5",
                trigger_reason="inventory_create",
                now=now,
            )
            db.commit()
        duplicate_claims = []

        async def _slow_resolution(cas_number: str, **_kwargs):
            await asyncio.sleep(0.18)
            duplicate_claims.extend(
                await asyncio.to_thread(
                    claim_due_resolution_jobs,
                    self.engine,
                    now=get_utc_now(),
                    batch_size=1,
                    lease_seconds=0.1,
                    max_attempts=4,
                )
            )
            return ResolutionOutcome(
                kind=ResolutionOutcomeKind.TERMINAL_NOT_FOUND,
                result=ResolvedStructure(
                    cas_number=cas_number,
                    status=CompoundStructureStatus.NOT_FOUND,
                ),
            )

        scheduler = StructureResolutionScheduler()
        with (
            patch("app.services.structure_resolution_scheduler.engine", self.engine),
            patch(
                "app.services.structure_resolution_scheduler._resolve_once",
                side_effect=_slow_resolution,
            ),
            patch(
                "app.services.structure_resolution_scheduler.settings."
                "chem_resolution_job_lease_seconds",
                0.1,
            ),
            patch(
                "app.services.structure_resolution_scheduler.settings."
                "chem_resolution_job_attempt_timeout_seconds",
                1.0,
            ),
            patch(
                "app.services.structure_resolution_scheduler.settings."
                "chem_resolution_job_concurrency",
                1,
            ),
        ):
            processed = await scheduler.run_once(now=now)

        self.assertEqual(1, processed)
        self.assertEqual([], duplicate_claims)
        with Session(self.engine) as db:
            self.assertIsNone(db.get(StructureResolutionJob, "64-17-5"))

    async def test_attempt_timeout_is_persisted_as_bounded_retry(self) -> None:
        now = get_utc_now()
        with Session(self.engine) as db:
            enqueue_structure_resolution_job(
                db,
                "64-17-5",
                trigger_reason="inventory_create",
                now=now,
            )
            db.commit()

        async def _never_finishes(*_args, **_kwargs):
            await asyncio.Event().wait()

        scheduler = StructureResolutionScheduler()
        with (
            patch("app.services.structure_resolution_scheduler.engine", self.engine),
            patch(
                "app.services.structure_resolution_scheduler._resolve_once",
                side_effect=_never_finishes,
            ),
            patch(
                "app.services.structure_resolution_scheduler.settings."
                "chem_resolution_job_attempt_timeout_seconds",
                0.01,
            ),
            patch(
                "app.services.structure_resolution_scheduler.settings."
                "chem_resolution_retry_jitter_seconds",
                0,
            ),
        ):
            self.assertEqual(1, await scheduler.run_once(now=now))

        with Session(self.engine) as db:
            job = db.get(StructureResolutionJob, "64-17-5")
            self.assertIsNotNone(job)
            assert job is not None
            self.assertEqual(1, job.attempt_count)
            self.assertEqual(1, job.retry_count)
            self.assertEqual("attempt_timeout", job.last_error_code)

    async def test_manual_protected_cache_deletes_job_without_external_attempt(self) -> None:
        now = get_utc_now()
        with Session(self.engine) as db:
            upsert_structure_cache(
                db,
                StructureCacheWrite(
                    cas_number="64-17-5",
                    status=CompoundStructureStatus.RESOLVED,
                    smiles_canonical="CCO",
                    manually_verified=True,
                ),
                skip_manual=False,
            )
            enqueue_structure_resolution_job(
                db,
                "64-17-5",
                trigger_reason="inventory_create",
                now=now,
            )
            db.commit()
        resolver = AsyncMock()
        scheduler = StructureResolutionScheduler()

        with (
            patch("app.services.structure_resolution_scheduler.engine", self.engine),
            patch("app.services.structure_resolution_scheduler._resolve_once", resolver),
        ):
            self.assertEqual(1, await scheduler.run_once(now=now))

        resolver.assert_not_awaited()
        with Session(self.engine) as db:
            self.assertIsNone(db.get(StructureResolutionJob, "64-17-5"))

    async def test_idle_scheduler_waits_for_notification_without_polling(self) -> None:
        scheduler = StructureResolutionScheduler()
        second_cycle = asyncio.Event()
        cycle_count = 0

        async def _run_cycle(*, now=None) -> int:
            nonlocal cycle_count
            cycle_count += 1
            if cycle_count == 2:
                second_cycle.set()
            return 0

        run_once = AsyncMock(side_effect=_run_cycle)
        next_due = Mock(return_value=None)
        with (
            patch("app.services.structure_resolution_scheduler.engine", self.engine),
            patch.object(StructureResolutionScheduler, "run_once", run_once),
            patch("app.services.structure_resolution_scheduler._get_next_due_at", next_due),
        ):
            scheduler.start()
            await asyncio.sleep(0.05)
            self.assertEqual(1, run_once.await_count)
            scheduler.notify()
            await asyncio.wait_for(second_cycle.wait(), timeout=1)
            await scheduler.stop()

        self.assertEqual(2, run_once.await_count)
        self.assertEqual(2, next_due.call_count)
        self.assertEqual(0, self.engine.pool.checkedout())

    async def test_stop_cancels_active_resolution_cycle_without_waiting_for_timeout(self) -> None:
        scheduler = StructureResolutionScheduler()
        cycle_started = asyncio.Event()

        async def _blocked_cycle(*, now=None) -> int:
            cycle_started.set()
            await asyncio.Event().wait()
            return 0

        with (
            patch("app.services.structure_resolution_scheduler._scheduler_enabled", return_value=True),
            patch.object(scheduler, "run_once", side_effect=_blocked_cycle),
        ):
            scheduler.start()
            await asyncio.wait_for(cycle_started.wait(), timeout=1)
            await asyncio.wait_for(scheduler.stop(), timeout=0.5)

        self.assertIsNone(scheduler._task)
        self.assertEqual(0, self.engine.pool.checkedout())

    async def test_transient_due_query_failure_does_not_kill_scheduler(self) -> None:
        scheduler = StructureResolutionScheduler()
        second_cycle = asyncio.Event()
        cycle_count = 0

        async def _run_cycle(*, now=None) -> int:
            nonlocal cycle_count
            cycle_count += 1
            if cycle_count == 2:
                scheduler._stopping = True
                second_cycle.set()
            return 0

        next_due = Mock(side_effect=[RuntimeError("database is locked"), None])
        with (
            patch("app.services.structure_resolution_scheduler.engine", self.engine),
            patch("app.services.structure_resolution_scheduler._scheduler_enabled", return_value=True),
            patch.object(scheduler, "run_once", side_effect=_run_cycle),
            patch("app.services.structure_resolution_scheduler._get_next_due_at", next_due),
            patch(
                "app.services.structure_resolution_scheduler."
                "_SCHEDULER_ERROR_RETRY_SECONDS",
                0.01,
            ),
        ):
            scheduler.start()
            await asyncio.wait_for(second_cycle.wait(), timeout=1)
            await scheduler.stop()

        self.assertEqual(2, cycle_count)
        self.assertEqual(2, next_due.call_count)
        self.assertEqual(0, self.engine.pool.checkedout())

    async def test_concurrent_jobs_share_pubchem_request_rate_limiter(self) -> None:
        now = get_utc_now()
        with Session(self.engine) as db:
            enqueue_structure_resolution_job(
                db,
                "64-17-5",
                trigger_reason="inventory_create",
                now=now,
            )
            enqueue_structure_resolution_job(
                db,
                "67-56-1",
                trigger_reason="inventory_create",
                now=now,
            )
            enqueue_structure_resolution_job(
                db,
                "7732-18-5",
                trigger_reason="inventory_create",
                now=now,
            )
            db.commit()

        client = _TimedNotFoundClient()
        scheduler = StructureResolutionScheduler()
        with (
            patch("app.services.structure_resolution_scheduler.engine", self.engine),
            patch(
                "app.services.structure_resolution_scheduler.create_pubchem_client",
                return_value=client,
            ),
            patch(
                "app.services.structure_resolution_scheduler.settings."
                "chem_pubchem_rate_limit_per_second",
                50.0,
            ),
            patch(
                "app.services.structure_resolution_scheduler.settings."
                "chem_resolution_job_concurrency",
                2,
            ),
        ):
            self.assertEqual(2, await scheduler.run_once(now=now))
            self.assertEqual(1, await scheduler.run_once(now=now))

        self.assertEqual(6, len(client.request_times))
        request_gaps = [
            current - previous
            for previous, current in zip(
                client.request_times,
                client.request_times[1:],
            )
        ]
        self.assertTrue(all(gap >= 0.015 for gap in request_gaps), request_gaps)

    def test_retry_jitter_is_injectable_and_can_be_fixed_to_zero(self) -> None:
        with patch(
            "app.services.structure_resolution_scheduler.settings."
            "chem_resolution_retry_jitter_seconds",
            10,
        ):
            self.assertEqual(0, _retry_jitter_seconds(random_value=0))
            self.assertEqual(10, _retry_jitter_seconds(random_value=1))


if __name__ == "__main__":
    unittest.main()
