"""Small self-tests for the LabStorageManager MCP tool surface."""

from __future__ import annotations

import unittest
from typing import Any
from unittest.mock import patch

import lsm_mcp.cli_runner as cli_runner
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

    def test_cli_runner_passes_token_through_environment(self) -> None:
        calls: dict[str, Any] = {}
        original = cli_runner._run_command

        def fake_run_command(
            command: list[str],
            *,
            timeout_seconds: float,
            input_text: str | None = None,
            extra_env: dict[str, str] | None = None,
        ) -> dict[str, Any]:
            calls["command"] = command
            calls["timeout_seconds"] = timeout_seconds
            calls["input_text"] = input_text
            calls["extra_env"] = extra_env
            return {"ok": True, "exit_code": 0, "payload": {"ok": True, "data": {}}}

        cli_runner._run_command = fake_run_command
        try:
            cli_runner.run_lsm_cli(["inventory", "list"], token="user-secret-token")
        finally:
            cli_runner._run_command = original

        self.assertNotIn("user-secret-token", calls["command"])
        self.assertNotIn("--token", calls["command"])
        self.assertEqual({"LSM_CLI_TOKEN": "user-secret-token"}, calls["extra_env"])

    def test_cli_runner_subprocess_env_drops_inherited_cli_token(self) -> None:
        with patch.dict("os.environ", {"LSM_CLI_TOKEN": "leaked-parent-token"}):
            env = cli_runner._build_subprocess_env()

        self.assertNotIn("LSM_CLI_TOKEN", env)

    def test_cli_runner_subprocess_env_keeps_explicit_cli_token(self) -> None:
        with patch.dict("os.environ", {"LSM_CLI_TOKEN": "leaked-parent-token"}):
            env = cli_runner._build_subprocess_env({"LSM_CLI_TOKEN": "explicit-token"})

        self.assertEqual("explicit-token", env["LSM_CLI_TOKEN"])

    def test_cli_runner_invalid_json_error_does_not_return_raw_output(self) -> None:
        result = cli_runner._parse_process_output(
            exit_code=1,
            stdout="traceback with secret-token",
            stderr="stderr with internal path",
        )

        self.assertFalse(result["ok"])
        self.assertEqual("INVALID_JSON_STDOUT", result["error"]["code"])
        self.assertNotIn("detail", result["error"])
        self.assertNotIn("traceback with secret-token", str(result))
        self.assertNotIn("stderr with internal path", str(result))

    def test_cli_runner_returns_safe_diagnostic_for_structured_business_error(self) -> None:
        payload = {
            "ok": False,
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "remaining_quantity is required",
                "detail": {
                    "status_code": 422,
                    "detail": [
                        {
                            "loc": ["body", "remaining_quantity"],
                            "msg": "Field required",
                            "type": "missing",
                            "input": "secret-token",
                        }
                    ],
                },
            },
        }

        result = cli_runner._parse_process_output(
            exit_code=7,
            stdout=cli_runner.json.dumps(payload),
            stderr="raw implementation detail",
        )

        self.assertFalse(result["ok"])
        self.assertEqual(7, result["exit_code"])
        self.assertEqual(
            {
                "ok": False,
                "error": {
                    "code": "VALIDATION_ERROR",
                    "message": "参数不完整或格式不正确",
                    "category": "validation",
                    "retryable": False,
                    "llm_hint": "请根据 fields 修正参数；如果缺少必要字段，请向用户追问。",
                    "status_code": 422,
                    "fields": [
                        {
                            "name": "remaining_quantity",
                            "reason": "missing",
                            "message": "Field required",
                        }
                    ],
                },
            },
            result["payload"],
        )
        self.assertEqual("", result["stderr"])
        self.assertNotIn("raw implementation detail", str(result))
        self.assertNotIn("secret-token", str(result))

    def test_cli_runner_timeout_error_does_not_return_raw_stderr(self) -> None:
        def fake_run(*_args, **_kwargs):
            raise cli_runner.subprocess.TimeoutExpired(
                cmd=["python", "-m", "lsm_cli"],
                timeout=1,
                output="stdout secret",
                stderr="stderr secret",
            )

        with patch.object(cli_runner.subprocess, "run", fake_run):
            result = cli_runner._run_command(
                ["python", "-m", "lsm_cli"],
                timeout_seconds=1,
            )

        self.assertFalse(result["ok"])
        self.assertEqual("CLI_TIMEOUT", result["error"]["code"])
        self.assertEqual({"timeout_seconds": 1}, result["error"]["detail"])
        self.assertNotIn("stdout secret", str(result))
        self.assertNotIn("stderr secret", str(result))


if __name__ == "__main__":
    unittest.main()
