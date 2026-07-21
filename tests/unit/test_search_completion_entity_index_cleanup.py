import sqlite3
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app import search_completion_db as completion_db
from app.api import consumable_orders, reagent_orders_workflow
from app.services import search_completion_entity_index as entity_index


class EntityCompletionIndexVersionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.connection = sqlite3.connect(":memory:")
        self.connection.row_factory = sqlite3.Row
        self.connection.executescript(completion_db._COMPLETION_SCHEMA)

    def tearDown(self) -> None:
        self.connection.close()

    def test_version_mismatch_marks_all_endpoints_stale_once(self) -> None:
        completion_db._ensure_entity_completion_index_version(self.connection)

        stored_version = self.connection.execute(
            "SELECT value FROM search_completion_meta WHERE key = ?",
            (completion_db.ENTITY_INDEX_VERSION_KEY,),
        ).fetchone()[0]
        self.assertEqual(completion_db.ENTITY_INDEX_VERSION, stored_version)

        stale_rows = dict(self.connection.execute(
            "SELECT key, value FROM search_completion_meta WHERE key LIKE 'entity_index_stale:%'"
        ).fetchall())
        self.assertEqual(
            {
                completion_db._entity_completion_stale_key(endpoint): "1"
                for endpoint in completion_db.TARGET_ENDPOINTS
            },
            stale_rows,
        )

        self.connection.execute(
            "UPDATE search_completion_meta SET value = '0' WHERE key LIKE 'entity_index_stale:%'"
        )
        completion_db._ensure_entity_completion_index_version(self.connection)
        remaining_stale = self.connection.execute(
            "SELECT COUNT(*) FROM search_completion_meta "
            "WHERE key LIKE 'entity_index_stale:%' AND value = '1'"
        ).fetchone()[0]
        self.assertEqual(0, remaining_stale)

    def test_rebuild_clears_existing_endpoint_rows_before_marking_fresh(self) -> None:
        endpoint = completion_db.REAGENT_ORDER_COMPLETION_ENDPOINT
        with (
            patch.object(entity_index, "_build_endpoint_rows", return_value=([], 0)),
            patch.object(entity_index, "clear_entity_completion_index") as clear_rows,
            patch.object(entity_index, "bulk_insert_entity_completions") as insert_rows,
            patch.object(entity_index, "clear_entity_completion_index_stale") as clear_stale,
        ):
            entity_index.rebuild_completion_entity_index(object(), endpoint)

        clear_rows.assert_called_once_with(endpoint)
        insert_rows.assert_not_called()
        clear_stale.assert_called_once_with(endpoint)


class EntityCompletionDeleteHelperTests(unittest.TestCase):
    def test_reagent_delete_helper_uses_reagent_identity(self) -> None:
        with patch.object(entity_index, "delete_entity_completions_for_entity") as delete_rows:
            entity_index.delete_reagent_order_entity_completions(42)

        delete_rows.assert_called_once_with(
            completion_db.REAGENT_ORDER_COMPLETION_ENDPOINT,
            "reagent_order",
            "42",
        )

    def test_consumable_delete_helper_uses_consumable_identity(self) -> None:
        with patch.object(entity_index, "delete_entity_completions_for_entity") as delete_rows:
            entity_index.delete_consumable_order_entity_completions(84)

        delete_rows.assert_called_once_with(
            completion_db.CONSUMABLE_ORDER_COMPLETION_ENDPOINT,
            "consumable_order",
            "84",
        )


class EntityCompletionDeleteRoutingTests(unittest.TestCase):
    @staticmethod
    def _run_update(operation, *, context: str) -> None:
        del context
        operation()

    def test_consumable_delete_cache_path_deletes_instead_of_syncing(self) -> None:
        order = SimpleNamespace(id=84)
        with (
            patch.object(consumable_orders, "run_completion_index_update", self._run_update),
            patch.object(consumable_orders, "delete_consumable_order_entity_completions") as delete,
            patch.object(consumable_orders, "sync_consumable_order_entity_completions") as sync,
        ):
            consumable_orders._clear_consumable_order_cache(order, is_delete=True)

        delete.assert_called_once_with(84)
        sync.assert_not_called()

    def test_consumable_update_cache_path_still_syncs(self) -> None:
        order = SimpleNamespace(id=84)
        with (
            patch.object(consumable_orders, "run_completion_index_update", self._run_update),
            patch.object(consumable_orders, "delete_consumable_order_entity_completions") as delete,
            patch.object(consumable_orders, "sync_consumable_order_entity_completions") as sync,
        ):
            consumable_orders._clear_consumable_order_cache(order)

        sync.assert_called_once_with(order, db=None)
        delete.assert_not_called()

    def test_reagent_delete_cache_path_deletes_instead_of_syncing(self) -> None:
        order = SimpleNamespace(id=42)
        with (
            patch.object(reagent_orders_workflow, "run_completion_index_update", self._run_update),
            patch.object(reagent_orders_workflow, "delete_reagent_order_entity_completions") as delete,
            patch.object(reagent_orders_workflow, "sync_reagent_order_entity_completions") as sync,
        ):
            reagent_orders_workflow._clear_reagent_workflow_cache({}, order, is_delete=True)

        delete.assert_called_once_with(42)
        sync.assert_not_called()

    def test_reagent_update_cache_path_still_syncs(self) -> None:
        order = SimpleNamespace(id=42)
        with (
            patch.object(reagent_orders_workflow, "run_completion_index_update", self._run_update),
            patch.object(reagent_orders_workflow, "delete_reagent_order_entity_completions") as delete,
            patch.object(reagent_orders_workflow, "sync_reagent_order_entity_completions") as sync,
        ):
            reagent_orders_workflow._clear_reagent_workflow_cache({}, order)

        sync.assert_called_once_with(order, db=None)
        delete.assert_not_called()


if __name__ == "__main__":
    unittest.main()
