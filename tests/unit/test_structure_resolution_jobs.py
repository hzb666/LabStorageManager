from __future__ import annotations

import tempfile
import unittest
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

from fastapi import BackgroundTasks
from sqlalchemy import event
from sqlmodel import SQLModel, Session, create_engine

import app.models  # noqa: F401
from app.core.time_utils import get_utc_now
from app.db_bootstrap.structure_index_schema import ensure_structure_index_schema
from app.models.structure_index import StructureResolutionJobState
from app.services.structure_cache_tasks import enqueue_structure_cache_resolution
from app.services.structure_resolution_jobs import (
    claim_due_resolution_jobs,
    enqueue_structure_resolution_job,
    renew_claimed_resolution_job_lease,
    reschedule_claimed_resolution_job,
)

MAX_ATTEMPTS = 4


class StructureResolutionJobsTest(unittest.TestCase):
    def setUp(self) -> None:
        self._temp_dir = tempfile.TemporaryDirectory()
        database_path = Path(self._temp_dir.name) / "resolution-jobs.db"
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

    def test_enqueue_merges_duplicates_and_claim_recovers_expired_lease(self) -> None:
        now = get_utc_now()
        with Session(self.engine) as db:
            self.assertTrue(
                enqueue_structure_resolution_job(
                    db,
                    "58－08–2",
                    trigger_reason="inventory_create",
                    now=now,
                )
            )
            self.assertFalse(
                enqueue_structure_resolution_job(
                    db,
                    "58-08-2",
                    trigger_reason="duplicate",
                    now=now,
                )
            )
            db.commit()

        first_claim = claim_due_resolution_jobs(
            self.engine,
            now=now,
            batch_size=10,
            lease_seconds=30,
            max_attempts=MAX_ATTEMPTS,
        )
        concurrent_claim = claim_due_resolution_jobs(
            self.engine,
            now=now,
            batch_size=10,
            lease_seconds=30,
            max_attempts=MAX_ATTEMPTS,
        )
        recovered_claim = claim_due_resolution_jobs(
            self.engine,
            now=now + timedelta(seconds=31),
            batch_size=10,
            lease_seconds=30,
            max_attempts=MAX_ATTEMPTS,
        )

        self.assertEqual(["58-08-2"], [job.cas_number for job in first_claim])
        self.assertEqual([], concurrent_claim)
        self.assertEqual(["58-08-2"], [job.cas_number for job in recovered_claim])
        self.assertNotEqual(first_claim[0].lease_token, recovered_claim[0].lease_token)
        self.assertEqual(2, recovered_claim[0].attempt_count)
        self.assertEqual(1, recovered_claim[0].retry_count)

    def test_active_lease_renewal_prevents_reclaim_after_original_expiry(self) -> None:
        now = get_utc_now()
        with Session(self.engine) as db:
            enqueue_structure_resolution_job(
                db,
                "58-08-2",
                trigger_reason="inventory_create",
                now=now,
            )
            db.commit()

        claimed = claim_due_resolution_jobs(
            self.engine,
            now=now,
            batch_size=1,
            lease_seconds=30,
            max_attempts=MAX_ATTEMPTS,
        )
        renewed = renew_claimed_resolution_job_lease(
            self.engine,
            claimed[0],
            now=now + timedelta(seconds=20),
            lease_seconds=30,
        )
        duplicate_claim = claim_due_resolution_jobs(
            self.engine,
            now=now + timedelta(seconds=31),
            batch_size=1,
            lease_seconds=30,
            max_attempts=MAX_ATTEMPTS,
        )
        recovered_claim = claim_due_resolution_jobs(
            self.engine,
            now=now + timedelta(seconds=51),
            batch_size=1,
            lease_seconds=30,
            max_attempts=MAX_ATTEMPTS,
        )

        self.assertTrue(renewed)
        self.assertEqual([], duplicate_claim)
        self.assertEqual(1, len(recovered_claim))
        self.assertEqual(2, recovered_claim[0].attempt_count)
        self.assertEqual(1, recovered_claim[0].retry_count)

    def test_expired_leases_cannot_exceed_four_total_attempts(self) -> None:
        now = get_utc_now()
        with Session(self.engine) as db:
            enqueue_structure_resolution_job(
                db,
                "58-08-2",
                trigger_reason="inventory_create",
                now=now,
            )
            db.commit()

        current_time = now
        for expected_attempt in range(1, MAX_ATTEMPTS + 1):
            claimed = claim_due_resolution_jobs(
                self.engine,
                now=current_time,
                batch_size=1,
                lease_seconds=30,
                max_attempts=MAX_ATTEMPTS,
            )
            self.assertEqual(1, len(claimed))
            self.assertEqual(expected_attempt, claimed[0].attempt_count)
            self.assertEqual(expected_attempt - 1, claimed[0].retry_count)
            current_time += timedelta(seconds=31)

        self.assertEqual(
            [],
            claim_due_resolution_jobs(
                self.engine,
                now=current_time,
                batch_size=1,
                lease_seconds=30,
                max_attempts=MAX_ATTEMPTS,
            ),
        )
        with Session(self.engine) as db:
            exhausted = db.get(app.models.StructureResolutionJob, "58-08-2")
            self.assertIsNotNone(exhausted)
            assert exhausted is not None
            self.assertEqual(StructureResolutionJobState.EXHAUSTED, exhausted.state)
            self.assertEqual(MAX_ATTEMPTS, exhausted.attempt_count)
            self.assertEqual(MAX_ATTEMPTS - 1, exhausted.retry_count)
            self.assertEqual("lease_attempt_limit_exhausted", exhausted.last_error_code)

    def test_fourth_failed_attempt_becomes_exhausted(self) -> None:
        now = get_utc_now()
        with Session(self.engine) as db:
            enqueue_structure_resolution_job(
                db,
                "64-17-5",
                trigger_reason="inventory_create",
                now=now,
            )
            db.commit()

        current_time = now
        expected_delays = (60, 300, 1800)
        for attempt in range(4):
            claimed = claim_due_resolution_jobs(
                self.engine,
                now=current_time,
                batch_size=1,
                lease_seconds=30,
                max_attempts=MAX_ATTEMPTS,
            )
            self.assertEqual(1, len(claimed))
            with Session(self.engine, expire_on_commit=False) as db:
                result = reschedule_claimed_resolution_job(
                    db,
                    claimed[0],
                    now=current_time,
                    retry_delays_seconds=expected_delays,
                    error_code="transport_error",
                    error_message="temporary failure",
                    jitter_seconds=0,
                )
                db.commit()

            if attempt < 3:
                self.assertEqual(StructureResolutionJobState.QUEUED, result.state)
                self.assertEqual(attempt + 1, result.retry_count)
                current_time += timedelta(seconds=expected_delays[attempt])
            else:
                self.assertEqual(StructureResolutionJobState.EXHAUSTED, result.state)
                self.assertEqual(3, result.retry_count)
                self.assertIsNone(result.next_attempt_at)

        with Session(self.engine) as db:
            self.assertFalse(
                enqueue_structure_resolution_job(
                    db,
                    "64-17-5",
                    trigger_reason="ordinary_duplicate",
                    now=current_time,
                )
            )
            self.assertTrue(
                enqueue_structure_resolution_job(
                    db,
                    "64-17-5",
                    trigger_reason="admin_requeue",
                    now=current_time,
                    force=True,
                )
            )
            db.commit()
            requeued = db.get(app.models.StructureResolutionJob, "64-17-5")
            self.assertIsNotNone(requeued)
            assert requeued is not None
            self.assertEqual(StructureResolutionJobState.QUEUED, requeued.state)
            self.assertEqual(0, requeued.attempt_count)
            self.assertEqual(0, requeued.retry_count)

    def test_retry_after_overrides_default_delay_without_inline_wait(self) -> None:
        now = get_utc_now()
        with Session(self.engine) as db:
            enqueue_structure_resolution_job(
                db,
                "64-17-5",
                trigger_reason="inventory_create",
                now=now,
            )
            db.commit()
        claimed = claim_due_resolution_jobs(
            self.engine,
            now=now,
            batch_size=1,
            lease_seconds=30,
            max_attempts=MAX_ATTEMPTS,
        )

        with Session(self.engine, expire_on_commit=False) as db:
            result = reschedule_claimed_resolution_job(
                db,
                claimed[0],
                now=now,
                retry_delays_seconds=(60, 300, 1800),
                error_code="http_429",
                error_message="rate limited",
                retry_after_seconds=120,
                jitter_seconds=10,
            )
            db.commit()

        self.assertEqual(now + timedelta(seconds=120), result.next_attempt_at)
        self.assertEqual(1, result.retry_count)

    def test_enqueue_failure_does_not_turn_committed_business_write_into_error(self) -> None:
        with (
            self.assertLogs("app.services.structure_cache_tasks", level="ERROR") as logs,
            patch(
                "app.services.structure_cache_tasks.Session",
                side_effect=RuntimeError("database temporarily locked"),
            ),
        ):
            created = enqueue_structure_cache_resolution(
                BackgroundTasks(),
                "64-17-5",
                reason="inventory.create",
            )

        self.assertFalse(created)
        self.assertIn("enqueue=failed", logs.output[0])

    def test_due_queries_use_separate_queue_and_expired_lease_indexes(self) -> None:
        with self.engine.connect() as connection:
            queued_plan = connection.exec_driver_sql(
                """
                EXPLAIN QUERY PLAN
                SELECT cas_number
                FROM structure_resolution_job
                WHERE state = 'queued' AND next_attempt_at <= CURRENT_TIMESTAMP
                ORDER BY next_attempt_at
                """
            ).all()
            expired_plan = connection.exec_driver_sql(
                """
                EXPLAIN QUERY PLAN
                SELECT cas_number
                FROM structure_resolution_job
                WHERE state = 'running' AND lease_until <= CURRENT_TIMESTAMP
                ORDER BY lease_until
                """
            ).all()
            index_names = {
                str(row[1])
                for row in connection.exec_driver_sql(
                    "PRAGMA index_list(structure_resolution_job)"
                ).all()
            }

        self.assertIn(
            "ix_structure_resolution_job_queued_due",
            " ".join(str(row[-1]) for row in queued_plan),
        )
        self.assertIn(
            "ix_structure_resolution_job_expired_lease",
            " ".join(str(row[-1]) for row in expired_plan),
        )
        self.assertNotIn("ix_structure_resolution_job_due", index_names)


if __name__ == "__main__":
    unittest.main()
