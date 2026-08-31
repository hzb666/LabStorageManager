from __future__ import annotations

import base64
import json
import tempfile
import threading
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from sqlalchemy import event
from sqlmodel import Session, SQLModel, create_engine

import app.models  # noqa: F401
import app.services.structure_index_scheduler as structure_index_scheduler_module
from app.db_bootstrap.structure_index_schema import ensure_structure_index_schema
from app.models.compound_structure import CompoundStructureSource, CompoundStructureStatus
from app.services.structure_cache_repo import StructureCacheWrite, upsert_structure_cache
from app.services.structure_index import (
    StructureQueryFormat,
    SubstructureIndex,
    _snapshot_checksum,
)
from app.services.structure_index_scheduler import StructureIndexScheduler

_BEIJING_TZ = timezone(timedelta(hours=8))


class StructureIndexCompactionTest(unittest.TestCase):
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

    def tearDown(self) -> None:
        self.engine.dispose()
        self._temp_dir.cleanup()

    def _write(self, cas_number: str, smiles: str) -> None:
        with Session(self.engine) as db:
            upsert_structure_cache(
                db,
                StructureCacheWrite(
                    cas_number=cas_number,
                    status=CompoundStructureStatus.RESOLVED,
                    source=CompoundStructureSource.PUBCHEM,
                    smiles_canonical=smiles,
                    smiles_isomeric=smiles,
                ),
                skip_manual=False,
            )
            db.commit()

    def test_snapshot_round_trip_and_corruption_rejection(self) -> None:
        self._write("64-17-5", "CCO")
        index = SubstructureIndex(snapshot_path=self.snapshot_path)
        with Session(self.engine) as db:
            index.compact(db)

        restored = SubstructureIndex(snapshot_path=self.snapshot_path)
        with patch(
            "app.services.structure_index.mol_from_smiles_quiet_h_removal",
            side_effect=AssertionError("snapshot load must reuse serialized library molecules"),
        ), Session(self.engine) as db:
            self.assertTrue(restored.load_snapshot(db))
        self.assertEqual(
            ["64-17-5"],
            [
                hit.cas_number
                for hit in restored.exact_search(
                    query="CCO",
                    query_format=StructureQueryFormat.SMILES,
                    limit=10,
                )
            ],
        )

        self.snapshot_path.write_text('{"checksum":"broken"}', encoding="utf-8")
        rejected = SubstructureIndex(snapshot_path=self.snapshot_path)
        with Session(self.engine) as db:
            self.assertFalse(rejected.load_snapshot(db))

    def test_snapshot_from_another_database_is_rejected(self) -> None:
        self._write("64-17-5", "CCO")
        source_index = SubstructureIndex(snapshot_path=self.snapshot_path)
        with Session(self.engine) as db:
            source_index.compact(db)

        other_path = Path(self._temp_dir.name) / "other.db"
        other_engine = create_engine(
            f"sqlite:///{other_path.as_posix()}",
            connect_args={"check_same_thread": False},
        )
        try:
            SQLModel.metadata.create_all(other_engine)
            with other_engine.begin() as connection:
                ensure_structure_index_schema(connection)
            with Session(other_engine) as db:
                upsert_structure_cache(
                    db,
                    StructureCacheWrite(
                        cas_number="67-56-1",
                        status=CompoundStructureStatus.RESOLVED,
                        source=CompoundStructureSource.PUBCHEM,
                        smiles_canonical="CO",
                        smiles_isomeric="CO",
                    ),
                    skip_manual=False,
                )
                db.commit()

            restored = SubstructureIndex(snapshot_path=self.snapshot_path)
            with Session(other_engine) as db:
                self.assertFalse(restored.load_snapshot(db))
                restored.compact(db)
            self.assertEqual(
                ["67-56-1"],
                [
                    hit.cas_number
                    for hit in restored.exact_search(
                        query="CO",
                        query_format=StructureQueryFormat.SMILES,
                        limit=10,
                    )
                ],
            )
        finally:
            other_engine.dispose()

    def test_corrupt_serialized_library_falls_back_to_compaction(self) -> None:
        self._write("64-17-5", "CCO")
        index = SubstructureIndex(snapshot_path=self.snapshot_path)
        with Session(self.engine) as db:
            index.compact(db)

        document = json.loads(self.snapshot_path.read_text(encoding="utf-8"))
        document["serialized_library"] = base64.b64encode(b"not-an-rdkit-library").decode(
            "ascii"
        )
        payload = {key: value for key, value in document.items() if key != "checksum"}
        document["checksum"] = _snapshot_checksum(payload)
        self.snapshot_path.write_text(
            json.dumps(document, separators=(",", ":")),
            encoding="utf-8",
        )

        recovered = SubstructureIndex(snapshot_path=self.snapshot_path)
        scheduler = StructureIndexScheduler()
        with (
            patch.object(structure_index_scheduler_module, "engine", self.engine),
            patch.object(structure_index_scheduler_module, "structure_index", recovered),
        ):
            scheduler._sync_or_compact()

        self.assertTrue(recovered.is_initialized())
        self.assertEqual(
            ["64-17-5"],
            [
                hit.cas_number
                for hit in recovered.exact_search(
                    query="CCO",
                    query_format=StructureQueryFormat.SMILES,
                    limit=10,
                )
            ],
        )

    def test_compaction_replays_change_committed_after_base_capture(self) -> None:
        self._write("64-17-5", "CCO")
        index = SubstructureIndex(snapshot_path=self.snapshot_path)

        def _concurrent_write() -> None:
            self._write("67-56-1", "CO")

        with Session(self.engine) as db:
            snapshot = index.compact(db, on_base_captured=_concurrent_write)

        self.assertEqual(snapshot.db_revision, snapshot.applied_revision)
        self.assertEqual(1, snapshot.base_count)
        self.assertEqual(1, snapshot.delta_count)
        self.assertEqual(
            ["67-56-1"],
            [
                hit.cas_number
                for hit in index.exact_search(
                    query="CO",
                    query_format=StructureQueryFormat.SMILES,
                    limit=10,
                )
            ],
        )

    def test_invalid_resolved_record_rejects_compaction_and_preserves_old_state(self) -> None:
        self._write("64-17-5", "CCO")
        index = SubstructureIndex(snapshot_path=self.snapshot_path)
        with Session(self.engine) as db:
            before = index.compact(db)

        self._write("67-56-1", "not-valid-smiles")
        with Session(self.engine) as db, self.assertRaises(RuntimeError):
            index.compact(db)

        after = index.status()
        self.assertEqual(before.applied_revision, after.applied_revision)
        self.assertEqual(
            ["64-17-5"],
            [
                hit.cas_number
                for hit in index.exact_search(
                    query="CCO",
                    query_format=StructureQueryFormat.SMILES,
                    limit=10,
                )
            ],
        )

    def test_existing_state_remains_searchable_while_compaction_builds(self) -> None:
        self._write("64-17-5", "CCO")
        index = SubstructureIndex(snapshot_path=self.snapshot_path)
        with Session(self.engine) as db:
            index.compact(db)
        self._write("67-56-1", "CO")

        base_captured = threading.Event()
        release_build = threading.Event()
        failures: list[Exception] = []

        def _compact() -> None:
            try:
                with Session(self.engine) as db:
                    index.compact(
                        db,
                        on_base_captured=lambda: (
                            base_captured.set(),
                            release_build.wait(timeout=5),
                        ),
                    )
            except Exception as exc:
                failures.append(exc)

        thread = threading.Thread(target=_compact)
        thread.start()
        self.assertTrue(base_captured.wait(timeout=5))
        self.assertEqual(
            ["64-17-5"],
            [
                hit.cas_number
                for hit in index.exact_search(
                    query="CCO",
                    query_format=StructureQueryFormat.SMILES,
                    limit=10,
                )
            ],
        )
        release_build.set()
        thread.join(timeout=10)

        self.assertFalse(thread.is_alive())
        self.assertEqual([], failures)
        self.assertEqual(
            ["67-56-1"],
            [
                hit.cas_number
                for hit in index.exact_search(
                    query="CO",
                    query_format=StructureQueryFormat.SMILES,
                    limit=10,
                )
            ],
        )

    def test_large_revision_lag_compacts_without_building_throwaway_delta(self) -> None:
        self._write("64-17-5", "CCO")
        index = SubstructureIndex(snapshot_path=self.snapshot_path)
        with Session(self.engine) as db:
            index.compact(db)
        self._write("67-56-1", "CO")
        self._write("7732-18-5", "O")

        scheduler = StructureIndexScheduler()
        with (
            patch.object(structure_index_scheduler_module, "engine", self.engine),
            patch.object(structure_index_scheduler_module, "structure_index", index),
            patch(
                "app.services.structure_index.settings."
                "chem_structure_index_compaction_min_delta",
                2,
            ),
            patch.object(
                index,
                "ensure_current",
                side_effect=AssertionError("large lag must compact before replay"),
            ),
            patch.object(index, "compact", wraps=index.compact) as compact,
        ):
            scheduler._sync_or_compact()

        compact.assert_called_once()
        self.assertEqual(3, index.status().base_count)

    def test_incremental_changes_wait_for_scheduled_compaction(self) -> None:
        self._write("64-17-5", "CCO")
        index = SubstructureIndex(snapshot_path=self.snapshot_path)
        with Session(self.engine) as db:
            index.compact(db)
        self._write("67-56-1", "CO")

        scheduler = StructureIndexScheduler()
        with (
            patch.object(structure_index_scheduler_module, "engine", self.engine),
            patch.object(structure_index_scheduler_module, "structure_index", index),
            patch.object(
                structure_index_scheduler_module.settings,
                "chem_structure_index_compaction_min_delta",
                2,
            ),
            patch.object(
                structure_index_scheduler_module.settings,
                "chem_structure_index_weekly_maintenance_weekday",
                6,
            ),
            patch.object(index, "compact", wraps=index.compact) as compact,
        ):
            scheduler._sync_or_compact(
                daily_maintenance=True,
                now=datetime(2026, 7, 27, 3, tzinfo=_BEIJING_TZ),
            )
            compact.assert_not_called()
            self.assertEqual(1, index.status().delta_count)

            self._write("7732-18-5", "O")
            scheduler._sync_or_compact()
            compact.assert_not_called()
            self.assertEqual(2, index.status().delta_count)

            scheduler._sync_or_compact(
                daily_maintenance=True,
                now=datetime(2026, 7, 26, 3, tzinfo=_BEIJING_TZ),
            )
            compact.assert_called_once()

        self.assertEqual(3, index.status().base_count)
        self.assertEqual(0, index.status().delta_count)


if __name__ == "__main__":
    unittest.main()
