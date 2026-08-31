from __future__ import annotations

import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from sqlalchemy import event, text
from sqlmodel import Session, SQLModel, create_engine

import app.api.chem as chem_api
import app.models  # noqa: F401
import app.services.structure_index as structure_index_module
from app.db_bootstrap.structure_index_schema import ensure_structure_index_schema
from app.models.compound_structure import CompoundStructureSource, CompoundStructureStatus
from app.services.structure_cache_repo import StructureCacheWrite, upsert_structure_cache
from app.services.structure_index import (
    StructureIndexRevisionChangedError,
    StructureIndexSnapshot,
    StructureIndexUnavailableError,
    StructureQueryFormat,
    SubstructureIndex,
)


class StructureIndexIncrementalTest(unittest.TestCase):
    def setUp(self) -> None:
        self._temp_dir = tempfile.TemporaryDirectory()
        self.snapshot_path = Path(self._temp_dir.name) / "structure.snapshot.json"
        database_path = Path(self._temp_dir.name) / "structure.db"
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
        self.index = SubstructureIndex(snapshot_path=self.snapshot_path)

    def tearDown(self) -> None:
        self.engine.dispose()
        self._temp_dir.cleanup()

    def _write(
        self,
        cas_number: str,
        status: CompoundStructureStatus,
        smiles: str | None,
    ) -> None:
        with Session(self.engine) as db:
            upsert_structure_cache(
                db,
                StructureCacheWrite(
                    cas_number=cas_number,
                    status=status,
                    source=CompoundStructureSource.PUBCHEM,
                    smiles_canonical=smiles,
                    smiles_isomeric=smiles,
                ),
                skip_manual=False,
            )
            db.commit()

    def _exact_cas(self, smiles: str) -> list[str]:
        return [
            hit.cas_number
            for hit in self.index.exact_search(
                query=smiles,
                query_format=StructureQueryFormat.SMILES,
                limit=100,
            )
        ]

    def test_crud_events_update_delta_without_full_cache_scan(self) -> None:
        self._write("64-17-5", CompoundStructureStatus.RESOLVED, "CCO")
        with Session(self.engine) as db:
            self.index.rebuild(db)
        self.assertEqual(["64-17-5"], self._exact_cas("CCO"))

        self._write("64-17-5", CompoundStructureStatus.RESOLVED, "CCCO")
        with patch(
            "app.services.structure_index._load_resolved_records",
            side_effect=AssertionError("incremental apply must not scan the full cache"),
        ), Session(self.engine) as db:
            snapshot = self.index.ensure_current(db)
        self.assertEqual(snapshot.db_revision, snapshot.applied_revision)
        self.assertEqual([], self._exact_cas("CCO"))
        self.assertEqual(["64-17-5"], self._exact_cas("CCCO"))

        self._write("64-17-5", CompoundStructureStatus.NOT_FOUND, None)
        with Session(self.engine) as db:
            self.index.ensure_current(db)
        self.assertEqual([], self._exact_cas("CCCO"))

        self._write("67-56-1", CompoundStructureStatus.RESOLVED, "CO")
        with Session(self.engine) as db:
            self.index.ensure_current(db)
        self.assertEqual(["67-56-1"], self._exact_cas("CO"))

        with self.engine.begin() as connection:
            connection.execute(
                text("DELETE FROM compound_structure_cache WHERE cas_number = '67-56-1'")
            )
        with Session(self.engine) as db:
            self.index.ensure_current(db)
        self.assertEqual([], self._exact_cas("CO"))

    def test_revision_gap_is_rejected_without_request_path_rebuild(self) -> None:
        self._write("64-17-5", CompoundStructureStatus.RESOLVED, "CCO")
        with Session(self.engine) as db:
            self.index.rebuild(db)
        self._write("67-56-1", CompoundStructureStatus.RESOLVED, "CO")
        with self.engine.begin() as connection:
            connection.execute(text("DELETE FROM structure_index_change WHERE revision = 2"))

        with patch(
            "app.services.structure_index._load_resolved_records",
            side_effect=AssertionError("revision barrier must not rebuild on the request path"),
        ), Session(self.engine) as db, self.assertRaises(StructureIndexUnavailableError):
            self.index.ensure_current(db)

    def test_change_replay_crosses_fixed_batch_boundaries(self) -> None:
        self._write("64-17-5", CompoundStructureStatus.RESOLVED, "CCO")
        with Session(self.engine) as db:
            self.index.rebuild(db)
        for smiles in ("CO", "CCO", "CCCO", "CCCCO", "CCCCCO"):
            self._write("64-17-5", CompoundStructureStatus.RESOLVED, smiles)

        with (
            patch.object(structure_index_module, "_INDEX_EVENT_BATCH_SIZE", 2),
            Session(self.engine) as db,
        ):
            snapshot = self.index.ensure_current(db)

        self.assertEqual(6, snapshot.applied_revision)
        self.assertEqual(["64-17-5"], self._exact_cas("CCCCCO"))

    def test_concurrent_revision_barriers_never_publish_an_older_revision(self) -> None:
        self._write("64-17-5", CompoundStructureStatus.RESOLVED, "CCO")
        with Session(self.engine) as db:
            self.index.rebuild(db)
        self._write("64-17-5", CompoundStructureStatus.RESOLVED, "CCCO")

        first_build_entered = threading.Event()
        release_first_build = threading.Event()
        second_finished = threading.Event()
        block_lock = threading.Lock()
        blocked_once = False
        original_build_library = structure_index_module._build_library

        def _blocking_build(records):
            nonlocal blocked_once
            with block_lock:
                should_block = not blocked_once
                if should_block:
                    blocked_once = True
            if should_block:
                first_build_entered.set()
                self.assertTrue(release_first_build.wait(timeout=5))
            return original_build_library(records)

        def _sync_index(done: threading.Event | None = None) -> None:
            with Session(self.engine) as db:
                self.index.ensure_current(db)
            if done is not None:
                done.set()

        with patch("app.services.structure_index._build_library", side_effect=_blocking_build):
            first = threading.Thread(target=_sync_index)
            first.start()
            self.assertTrue(first_build_entered.wait(timeout=5))
            self._write("67-56-1", CompoundStructureStatus.RESOLVED, "CO")
            second = threading.Thread(target=_sync_index, args=(second_finished,))
            second.start()
            time.sleep(0.05)
            self.assertFalse(second_finished.is_set())
            release_first_build.set()
            first.join(timeout=5)
            second.join(timeout=5)

        with Session(self.engine) as db:
            snapshot = self.index.status(db)
        self.assertEqual(snapshot.db_revision, snapshot.applied_revision)
        self.assertEqual(3, snapshot.applied_revision)

    def test_search_rejects_state_newer_than_expected_revision(self) -> None:
        self._write("64-17-5", CompoundStructureStatus.RESOLVED, "CCO")
        with Session(self.engine) as db:
            first = self.index.rebuild(db)
        self._write("67-56-1", CompoundStructureStatus.RESOLVED, "CO")
        with Session(self.engine) as db:
            self.index.ensure_current(db)

        with self.assertRaises(StructureIndexRevisionChangedError):
            self.index.search(
                query="CO",
                query_format=StructureQueryFormat.SMILES,
                limit=10,
                expected_revision=first.applied_revision,
            )

    def test_api_revision_retry_releases_stale_sqlite_read_snapshot(self) -> None:
        self._write("64-17-5", CompoundStructureStatus.RESOLVED, "CCO")
        with Session(self.engine) as db:
            self.index.rebuild(db)

        original_exact_search = self.index.exact_search
        raced = False

        def _race_then_search(**kwargs):
            nonlocal raced
            if not raced:
                raced = True
                self._write("67-56-1", CompoundStructureStatus.RESOLVED, "CO")
                with Session(self.engine) as concurrent_db:
                    self.index.ensure_current(concurrent_db)
            return original_exact_search(**kwargs)

        payload = chem_api.SubstructureSearchRequest(
            query="CO",
            format=StructureQueryFormat.SMILES,
            match_mode=chem_api.StructureSearchMode.EXACT,
            limit=10,
            only_in_stock=False,
        )
        mock_request = MagicMock()
        mock_user = MagicMock()
        mock_user_session = MagicMock()
        mock_user_session.user_id = 1
        mock_user_session.id = 1
        mock_current_session = (mock_user, mock_user_session)

        with (
            patch.object(chem_api, "structure_index", self.index),
            patch.object(self.index, "exact_search", side_effect=_race_then_search),
            patch("app.api.chem.get_request_is_cli", return_value=False),
            patch("app.api.chem.get_sse_client_id", return_value=None),
            Session(self.engine) as db,
        ):
            response = chem_api.search_substructure(mock_request, payload, db, mock_current_session)

        self.assertTrue(raced)
        self.assertEqual(2, response.index.applied_revision)
        self.assertEqual(["67-56-1"], [result.cas_number for result in response.results])

    def test_incremental_search_matches_fresh_rebuild_across_query_modes(self) -> None:
        fixtures = (
            ("108-95-2", "Oc1ccccc1"),
            ("108-88-3", "Cc1ccccc1"),
            ("64-17-5", "CCO"),
            ("593-60-2", "F[C@H](Cl)Br"),
        )
        for cas_number, smiles in fixtures:
            self._write(cas_number, CompoundStructureStatus.RESOLVED, smiles)
        with Session(self.engine) as db:
            self.index.rebuild(db)

        self._write("64-17-5", CompoundStructureStatus.RESOLVED, "CCCO")
        self._write("67-56-1", CompoundStructureStatus.RESOLVED, "CO")
        with Session(self.engine) as db:
            incremental_snapshot = self.index.ensure_current(db)
            rebuilt = SubstructureIndex(
                snapshot_path=Path(self._temp_dir.name) / "fresh.snapshot.json"
            )
            rebuilt_snapshot = rebuilt.rebuild(db)

        cases = (
            ("c1ccccc1", StructureQueryFormat.SMARTS, False, None, 100),
            ("Cc1ccccc1", StructureQueryFormat.SMILES, True, None, 100),
            ("F[C@H](Cl)Br", StructureQueryFormat.SMILES, True, None, 100),
            (
                "c1ccccc1",
                StructureQueryFormat.SMARTS,
                False,
                {"108-88-3"},
                1,
            ),
        )
        for query, query_format, exact, allowed, limit in cases:
            with self.subTest(query=query, exact=exact, allowed=allowed, limit=limit):
                method = self.index.exact_search if exact else self.index.search
                rebuilt_method = rebuilt.exact_search if exact else rebuilt.search
                incremental_hits = method(
                    query=query,
                    query_format=query_format,
                    limit=limit,
                    allowed_cas_numbers=allowed,
                    expected_revision=incremental_snapshot.applied_revision,
                )
                rebuilt_hits = rebuilt_method(
                    query=query,
                    query_format=query_format,
                    limit=limit,
                    allowed_cas_numbers=allowed,
                    expected_revision=rebuilt_snapshot.applied_revision,
                )
                self.assertEqual(rebuilt_hits, incremental_hits)

    def test_limit_is_applied_after_global_base_and_delta_sort(self) -> None:
        self._write("64-17-5", CompoundStructureStatus.RESOLVED, "CCO")
        with Session(self.engine) as db:
            self.index.rebuild(db)
        self._write("67-56-1", CompoundStructureStatus.RESOLVED, "CO")
        with Session(self.engine) as db:
            snapshot = self.index.ensure_current(db)

        hits = self.index.search(
            query="CO",
            query_format=StructureQueryFormat.SMARTS,
            limit=1,
            expected_revision=snapshot.applied_revision,
        )

        self.assertEqual(["67-56-1"], [hit.cas_number for hit in hits])

    def test_status_without_queue_query_does_not_report_false_zero_counts(self) -> None:
        response = chem_api._serialize_index_status(
            StructureIndexSnapshot(
                version=1,
                dirty=False,
                molecule_count=0,
            )
        )

        self.assertIsNone(response.resolution_jobs_queued)
        self.assertIsNone(response.resolution_jobs_running)
        self.assertIsNone(response.resolution_jobs_exhausted)


if __name__ == "__main__":
    unittest.main()
