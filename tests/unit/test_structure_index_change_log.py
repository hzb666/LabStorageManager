from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from sqlalchemy import event, text
from sqlalchemy.exc import IntegrityError
from sqlmodel import SQLModel, create_engine

import app.models  # noqa: F401
from app.db_bootstrap.structure_index_schema import ensure_structure_index_schema


class StructureIndexChangeLogTest(unittest.TestCase):
    def setUp(self) -> None:
        self._temp_dir = tempfile.TemporaryDirectory()
        database_path = Path(self._temp_dir.name) / "structure-index.db"
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
            ensure_structure_index_schema(connection)

    def tearDown(self) -> None:
        self.engine.dispose()
        self._temp_dir.cleanup()

    def test_structure_mutations_create_contiguous_after_image_events(self) -> None:
        with self.engine.begin() as connection:
            connection.execute(
                text(
                    """
                    INSERT INTO compound_structure_cache
                        (cas_number, status, smiles_canonical, smiles_isomeric, source,
                         confidence, candidate_count, chinese_name_is_translated,
                         manually_verified, created_at, updated_at)
                    VALUES
                        ('64-17-5', 'resolved', 'CCO', 'CCO', 'pubchem',
                         100, 1, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    """
                )
            )
            connection.execute(
                text(
                    """
                    UPDATE compound_structure_cache
                    SET english_name = 'ethanol'
                    WHERE cas_number = '64-17-5'
                    """
                )
            )
            connection.execute(
                text(
                    """
                    UPDATE compound_structure_cache
                    SET smiles_canonical = 'CCCO'
                    WHERE cas_number = '64-17-5'
                    """
                )
            )
            connection.execute(
                text(
                    """
                    UPDATE compound_structure_cache
                    SET status = 'not_found', smiles_canonical = NULL, smiles_isomeric = NULL
                    WHERE cas_number = '64-17-5'
                    """
                )
            )
            connection.execute(
                text(
                    """
                    UPDATE compound_structure_cache
                    SET cas_number = '67-56-1', status = 'resolved', smiles_canonical = 'CO'
                    WHERE cas_number = '64-17-5'
                    """
                )
            )
            connection.execute(
                text("DELETE FROM compound_structure_cache WHERE cas_number = '67-56-1'")
            )

        with self.engine.connect() as connection:
            revision = connection.execute(
                text("SELECT current_revision FROM structure_index_meta WHERE id = 1")
            ).scalar_one()
            events = connection.execute(
                text(
                    """
                    SELECT revision, cas_number, operation, status, smiles_canonical
                    FROM structure_index_change
                    ORDER BY revision
                    """
                )
            ).all()

        self.assertEqual(6, revision)
        self.assertEqual([1, 2, 3, 4, 5, 6], [row.revision for row in events])
        self.assertEqual(
            [
                ("64-17-5", "add_or_update", "resolved", "CCO"),
                ("64-17-5", "add_or_update", "resolved", "CCCO"),
                ("64-17-5", "add_or_update", "not_found", None),
                ("64-17-5", "delete", None, None),
                ("67-56-1", "add_or_update", "resolved", "CO"),
                ("67-56-1", "delete", None, None),
            ],
            [
                (row.cas_number, row.operation, row.status, row.smiles_canonical)
                for row in events
            ],
        )

    def test_bootstrap_assigns_one_stable_database_generation(self) -> None:
        with self.engine.begin() as connection:
            before = connection.execute(
                text("SELECT generation_id FROM structure_index_meta WHERE id = 1")
            ).scalar_one()
            ensure_structure_index_schema(connection)
            after = connection.execute(
                text("SELECT generation_id FROM structure_index_meta WHERE id = 1")
            ).scalar_one()

        self.assertEqual(32, len(before))
        self.assertEqual(before, after)

    def test_rolled_back_write_does_not_advance_revision(self) -> None:
        connection = self.engine.connect()
        transaction = connection.begin()
        connection.execute(
            text(
                """
                INSERT INTO compound_structure_cache
                    (cas_number, status, confidence, candidate_count,
                     chinese_name_is_translated, manually_verified, created_at, updated_at)
                VALUES
                    ('58-08-2', 'pending', 0, 0, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                """
            )
        )
        transaction.rollback()
        connection.close()

        with self.engine.connect() as check:
            self.assertEqual(
                0,
                check.execute(
                    text("SELECT current_revision FROM structure_index_meta WHERE id = 1")
                ).scalar_one(),
            )
            self.assertEqual(
                0,
                check.execute(text("SELECT COUNT(*) FROM structure_index_change")).scalar_one(),
            )

    def test_missing_meta_aborts_source_write_instead_of_silently_losing_event(self) -> None:
        with self.engine.begin() as connection:
            connection.execute(text("DELETE FROM structure_index_meta WHERE id = 1"))

        with self.assertRaises(IntegrityError):
            with self.engine.begin() as connection:
                connection.execute(
                    text(
                        """
                        INSERT INTO compound_structure_cache
                            (cas_number, status, confidence, candidate_count,
                             chinese_name_is_translated, manually_verified,
                             created_at, updated_at)
                        VALUES
                            ('64-17-5', 'pending', 0, 0, 0, 0,
                             CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                        """
                    )
                )

        with self.engine.connect() as connection:
            self.assertEqual(
                0,
                connection.execute(
                    text(
                        "SELECT COUNT(*) FROM compound_structure_cache "
                        "WHERE cas_number = '64-17-5'"
                    )
                ).scalar_one(),
            )

    def test_bootstrap_replaces_drifted_trigger_definition(self) -> None:
        with self.engine.begin() as connection:
            connection.exec_driver_sql("DROP TRIGGER trg_structure_cache_index_ai")
            connection.exec_driver_sql(
                """
                CREATE TRIGGER trg_structure_cache_index_ai
                AFTER INSERT ON compound_structure_cache
                BEGIN
                    SELECT 1;
                END
                """
            )
            ensure_structure_index_schema(connection)
            connection.execute(
                text(
                    """
                    INSERT INTO compound_structure_cache
                        (cas_number, status, confidence, candidate_count,
                         chinese_name_is_translated, manually_verified,
                         created_at, updated_at)
                    VALUES
                        ('64-17-5', 'pending', 0, 0, 0, 0,
                         CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    """
                )
            )

        with self.engine.connect() as connection:
            self.assertEqual(
                1,
                connection.execute(
                    text("SELECT current_revision FROM structure_index_meta WHERE id = 1")
                ).scalar_one(),
            )


if __name__ == "__main__":
    unittest.main()
