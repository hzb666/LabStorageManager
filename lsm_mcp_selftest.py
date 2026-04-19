"""Small self-tests for the LabStorageManager MCP tool surface."""

from __future__ import annotations

import unittest
from typing import Any

import lsm_mcp.server as server
from lsm_mcp.help_catalog import build_help_result


class LsmMcpSelfTest(unittest.TestCase):
    def test_dashboard_tools_map_to_cli_commands(self) -> None:
        calls: list[tuple[list[str], str | None, bool]] = []
        original = server.run_lsm_cli

        def fake_run_lsm_cli(
            args: list[str],
            *,
            token: str | None = None,
            use_service_token: bool = True,
        ) -> dict[str, Any]:
            calls.append((args, token, use_service_token))
            return {"ok": True, "exit_code": 0, "payload": {"ok": True, "data": {}}}

        server.run_lsm_cli = fake_run_lsm_cli
        try:
            server.inventory_my_borrows("user-token")
            server.inventory_pending_stockin("user-token")
            server.reagent_orders_my("user-token")
            server.consumable_orders_my("user-token")
        finally:
            server.run_lsm_cli = original

        self.assertEqual(
            [
                (["inventory", "my-borrows"], "user-token", False),
                (["inventory", "pending-stockin"], "user-token", False),
                (["reagent-orders", "my"], "user-token", False),
                (["consumable-orders", "my"], "user-token", False),
            ],
            calls,
        )

    def test_help_lists_dashboard_tools(self) -> None:
        result = build_help_result("我的")
        data = result["payload"]["data"]
        names = {item["name"] for item in data["items"]}

        self.assertIn("inventory_my_borrows", names)
        self.assertIn("inventory_pending_stockin", names)
        self.assertIn("reagent_orders_my", names)
        self.assertIn("consumable_orders_my", names)

    def test_help_lists_detail_tools_exposed_by_mcp_server(self) -> None:
        result = build_help_result("")
        data = result["payload"]["data"]
        names = {item["name"] for item in data["items"]}

        self.assertIn("reagent_orders_get_by_id", names)
        self.assertIn("consumable_orders_get_by_id", names)
        self.assertIn("common_shelf_locations", names)


if __name__ == "__main__":
    unittest.main()
