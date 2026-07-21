import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from app import search_completion_db as completion_db
from app.services import search_query_log_service


class SearchCompletionMemoryPruningTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "query_logs.db"
        self.path_patch = patch.object(completion_db, "QUERY_LOG_DB_PATH", self.db_path)
        self.path_patch.start()
        with closing(sqlite3.connect(self.db_path)) as connection:
            connection.executescript(completion_db._COMPLETION_SCHEMA)
            connection.commit()

    def tearDown(self) -> None:
        self.path_patch.stop()
        self.temp_dir.cleanup()

    def _insert_memory(
        self,
        *,
        user_id: int,
        query: str,
        frequency: int,
        days_ago: int,
        endpoint: str = "/inventory/",
        search_field: str = "",
    ) -> None:
        with closing(sqlite3.connect(self.db_path)) as connection:
            connection.execute(
                """
                INSERT INTO search_query_memory
                    (user_id, endpoint, search_field, query, normalized_query,
                     frequency, last_used_at)
                VALUES (?, ?, ?, ?, ?, ?, datetime('now', ?))
                """,
                (
                    user_id,
                    endpoint,
                    search_field,
                    query,
                    query.casefold(),
                    frequency,
                    f"-{days_ago} days",
                ),
            )
            connection.commit()

    def _remaining_queries(self) -> set[str]:
        with closing(sqlite3.connect(self.db_path)) as connection:
            return {
                str(row[0])
                for row in connection.execute("SELECT query FROM search_query_memory")
            }

    def test_prune_removes_stale_rows_and_enforces_scope_lfu_limits(self) -> None:
        for query, frequency, days_ago in (
            ("stale", 2, 181),
            ("least-old", 3, 10),
            ("least-new", 3, 1),
            ("middle", 4, 5),
            ("most", 5, 5),
        ):
            self._insert_memory(
                user_id=1,
                query=query,
                frequency=frequency,
                days_ago=days_ago,
            )
        for index in range(4):
            self._insert_memory(
                user_id=completion_db.GLOBAL_MEMORY_USER_ID,
                query=f"global-{index}",
                frequency=index + 1,
                days_ago=index,
            )

        with (
            patch.object(completion_db, "QUERY_MEMORY_PERSONAL_SCOPE_LIMIT", 3),
            patch.object(completion_db, "QUERY_MEMORY_GLOBAL_SCOPE_LIMIT", 2),
            patch.object(completion_db, "QUERY_MEMORY_TOTAL_LIMIT", 20),
        ):
            deleted_rows = completion_db.prune_query_memory_if_due()

        self.assertEqual(4, deleted_rows)
        self.assertEqual(
            {"least-new", "middle", "most", "global-2", "global-3"},
            self._remaining_queries(),
        )

    def test_prune_enforces_total_hard_limit_after_scope_limits(self) -> None:
        for index in range(6):
            self._insert_memory(
                user_id=index + 1,
                query=f"query-{index}",
                frequency=index + 1,
                days_ago=0,
            )

        with (
            patch.object(completion_db, "QUERY_MEMORY_PERSONAL_SCOPE_LIMIT", 10),
            patch.object(completion_db, "QUERY_MEMORY_GLOBAL_SCOPE_LIMIT", 10),
            patch.object(completion_db, "QUERY_MEMORY_TOTAL_LIMIT", 3),
        ):
            deleted_rows = completion_db.prune_query_memory_if_due()

        self.assertEqual(3, deleted_rows)
        self.assertEqual({"query-3", "query-4", "query-5"}, self._remaining_queries())

    def test_prune_is_throttled_for_one_hour(self) -> None:
        self._insert_memory(user_id=1, query="keep", frequency=1, days_ago=0)
        with patch.object(completion_db, "QUERY_MEMORY_TOTAL_LIMIT", 1):
            self.assertEqual(0, completion_db.prune_query_memory_if_due())
            with closing(sqlite3.connect(self.db_path)) as write_connection:
                write_connection.execute("BEGIN IMMEDIATE")
                self.assertIsNone(completion_db.prune_query_memory_if_due())
                write_connection.rollback()
            self._insert_memory(user_id=2, query="overflow", frequency=2, days_ago=0)
            self.assertIsNone(completion_db.prune_query_memory_if_due())

        self.assertEqual({"keep", "overflow"}, self._remaining_queries())


class SearchCompletionMemoryPruningIntegrationTests(unittest.TestCase):
    def test_pruning_failure_does_not_escape_search_log_worker(self) -> None:
        with (
            patch.object(
                search_query_log_service,
                "prune_query_memory_if_due",
                side_effect=sqlite3.OperationalError("locked"),
            ),
            self.assertLogs(search_query_log_service.logger, level="ERROR") as captured_logs,
        ):
            search_query_log_service._prune_query_memory_best_effort()

        self.assertTrue(any("pruning failed" in message for message in captured_logs.output))


if __name__ == "__main__":
    unittest.main()
