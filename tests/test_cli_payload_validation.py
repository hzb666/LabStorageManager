import io
import json
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

from pydantic import ValidationError

from app.api.reagent_orders_workflow import ConfirmArrivalRequest, StockInRequest
from app.models.consumable_order import ConsumableOrderCreate, ConsumableOrderUpdate
from app.models.inventory import (
    InventoryBorrowRequest,
    InventoryBorrowReturn,
    InventoryUpdate,
    ManualInventoryCreate,
)
from app.models.reagent_order import (
    ReagentOrderCreate,
    ReagentOrderReason,
    ReagentOrderUpdate,
)
from lsm_cli.client import APIClient, CLILocalInputError, load_json_payload
from lsm_cli.main import REAGENT_ORDER_REASON_CHOICES, main


class CLIPayloadValidationTests(unittest.TestCase):
    def _run_main(self, argv: list[str]) -> tuple[int | None, dict]:
        stdout = io.StringIO()
        with redirect_stdout(stdout):
            try:
                main(argv)
            except SystemExit as exc:
                output = stdout.getvalue().strip()
                payload = json.loads(output) if output else {}
                return exc.code, payload

        return None, json.loads(stdout.getvalue())

    def _run_main_text(self, argv: list[str]) -> tuple[int | None, str]:
        stdout = io.StringIO()
        with redirect_stdout(stdout):
            try:
                main(argv)
            except SystemExit as exc:
                return exc.code, stdout.getvalue()

        return None, stdout.getvalue()

    def test_load_json_payload_rejects_non_object_json(self) -> None:
        for raw in ["[]", '"text"', "null", "1"]:
            with self.subTest(raw=raw):
                with self.assertRaises(CLILocalInputError):
                    load_json_payload(raw, None)

    def test_required_payload_commands_fail_before_network(self) -> None:
        commands = [
            ["inventory", "return", "1"],
            ["inventory", "manual-add"],
            ["inventory", "update", "1"],
            ["reagent-orders", "create"],
            ["reagent-orders", "update", "1"],
            ["reagent-orders", "stock-in", "1"],
            ["consumable-orders", "create"],
            ["consumable-orders", "update", "1"],
        ]

        for argv in commands:
            with self.subTest(argv=argv):
                exit_code, payload = self._run_main(argv)
                self.assertEqual(exit_code, 7)
                self.assertFalse(payload["ok"])
                self.assertEqual(payload["error"]["code"], "INVALID_INPUT")

    @patch("lsm_cli.main.APIClient.request", return_value={"message": "ok"})
    def test_optional_payload_commands_allow_empty_body(self, request_mock) -> None:
        commands = [
            (["inventory", "borrow", "1"], "/inventory/{inventory_id}/borrow"),
            (["reagent-orders", "confirm-arrival", "1"], "/reagent-orders/{order_id}/confirm-arrival"),
        ]

        for argv, _ in commands:
            with self.subTest(argv=argv):
                request_mock.reset_mock()
                exit_code, payload = self._run_main(argv)
                self.assertIsNone(exit_code)
                self.assertTrue(payload["ok"])
                self.assertIsNone(request_mock.call_args.kwargs["json_body"])

    def test_complete_command_rejects_payload_flags(self) -> None:
        exit_code, payload = self._run_main(
            ["consumable-orders", "complete", "42", "--data-json", "{}"]
        )

        self.assertEqual(exit_code, 8)
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["error"]["code"], "ARGPARSE_ERROR")

    @patch("lsm_cli.main.APIClient.request", return_value={"id": 1, "username": "alice"})
    @patch("lsm_cli.main.save_config")
    def test_auth_whoami_with_override_does_not_persist_config(self, save_config_mock, _request_mock) -> None:
        exit_code, payload = self._run_main(["auth", "whoami", "--token", "override-token"])

        self.assertIsNone(exit_code)
        self.assertTrue(payload["ok"])
        save_config_mock.assert_not_called()

    @patch.dict("os.environ", {"LSM_CLI_TOKEN": "env-token"})
    @patch("lsm_cli.main.APIClient.request", return_value={"id": 1, "username": "alice"})
    @patch("lsm_cli.main.save_config")
    def test_auth_whoami_with_env_token_does_not_persist_config(
        self,
        save_config_mock,
        _request_mock,
    ) -> None:
        exit_code, payload = self._run_main(["auth", "whoami"])

        self.assertIsNone(exit_code)
        self.assertTrue(payload["ok"])
        save_config_mock.assert_not_called()

    @patch("lsm_cli.main.APIClient.request", return_value={"message": "logged out"})
    @patch("lsm_cli.main.clear_auth_data")
    def test_auth_logout_with_override_does_not_clear_local_auth(self, clear_auth_data_mock, _request_mock) -> None:
        exit_code, payload = self._run_main(["auth", "logout", "--base-url", "http://127.0.0.1:9999/api"])

        self.assertIsNone(exit_code)
        self.assertTrue(payload["ok"])
        clear_auth_data_mock.assert_not_called()

    @patch.dict("os.environ", {"LSM_CLI_TOKEN": "env-token"})
    @patch("lsm_cli.main.APIClient.request", return_value={"message": "logged out"})
    @patch("lsm_cli.main.clear_auth_data")
    def test_auth_logout_with_env_token_does_not_clear_local_auth(
        self,
        clear_auth_data_mock,
        _request_mock,
    ) -> None:
        exit_code, payload = self._run_main(["auth", "logout"])

        self.assertIsNone(exit_code)
        self.assertTrue(payload["ok"])
        clear_auth_data_mock.assert_not_called()

    @patch(
        "lsm_cli.main.APIClient.request",
        side_effect=Exception("should not reach network"),
    )
    def test_auth_login_rejects_token_override(self, _request_mock) -> None:
        exit_code, payload = self._run_main(
            ["--token", "override-token", "auth", "login", "--username", "alice"]
        )

        self.assertEqual(exit_code, 7)
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["error"]["code"], "INVALID_INPUT")

    def test_auth_login_help_does_not_expose_token_option(self) -> None:
        exit_code, output = self._run_main_text(["auth", "login", "--help"])

        self.assertEqual(exit_code, 0)
        self.assertNotIn("--token", output)

    @patch.dict("os.environ", {"LSM_CLI_TOKEN": "env-token"})
    @patch("lsm_cli.client.load_config", return_value={})
    def test_api_client_uses_env_token(self, _load_config_mock) -> None:
        client = APIClient(base_url="http://127.0.0.1:8000/api")

        self.assertEqual("env-token", client.token)
        self.assertEqual("environment", client.token_source)
        self.assertEqual("Bearer env-token", client.session.headers["Authorization"])

    @patch.dict("os.environ", {"LSM_CLI_TOKEN": "env-token"})
    @patch("lsm_cli.client.load_config", return_value={})
    def test_api_client_can_ignore_env_token(self, _load_config_mock) -> None:
        client = APIClient(base_url="http://127.0.0.1:8000/api", use_env_token=False)

        self.assertIsNone(client.token)
        self.assertEqual("none", client.token_source)
        self.assertNotIn("Authorization", client.session.headers)

    @patch("lsm_cli.main.APIClient.request", return_value={"message": "ok"})
    def test_inventory_update_supports_explicit_field_arguments(self, request_mock) -> None:
        exit_code, payload = self._run_main(
            ["inventory", "update", "1", "--storage-location", "A-02", "--notes", "转移货架"]
        )

        self.assertIsNone(exit_code)
        self.assertTrue(payload["ok"])
        self.assertEqual(request_mock.call_args.kwargs["json_body"], {
            "storage_location": "A-02",
            "notes": "转移货架",
        })

    @patch(
        "lsm_cli.main.APIClient.request",
        side_effect=[
            {"id": 1, "remaining_quantity": 80, "unit": "ml"},
            {"message": "ok"},
        ],
    )
    def test_inventory_return_supports_used_quantity_conversion(self, request_mock) -> None:
        exit_code, payload = self._run_main(
            ["inventory", "return", "1", "--used-quantity", "20"]
        )

        self.assertIsNone(exit_code)
        self.assertTrue(payload["ok"])
        self.assertEqual(request_mock.call_count, 2)
        self.assertEqual(request_mock.call_args.kwargs["json_body"], {
            "remaining_quantity": 60.0,
        })

    def test_inventory_return_rejects_unit_argument(self) -> None:
        exit_code, payload = self._run_main(
            ["inventory", "return", "1", "--remaining-quantity", "10", "--unit", "ml"]
        )

        self.assertEqual(exit_code, 8)
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["error"]["code"], "ARGPARSE_ERROR")

    def test_inventory_return_rejects_unit_in_json_payload(self) -> None:
        exit_code, payload = self._run_main(
            ["inventory", "return", "1", "--data-json", '{"remaining_quantity": 10, "unit": "ml"}']
        )

        self.assertEqual(exit_code, 7)
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["error"]["code"], "INVALID_INPUT")

    def test_resource_id_arguments_reject_non_single_positive_integer(self) -> None:
        cases = [
            ["inventory", "get", "1,2"],
            ["inventory", "borrow", "1-3"],
            ["inventory", "update", "0", "--name", "乙醇"],
            ["reagent-orders", "get", "abc"],
            ["consumable-orders", "complete", "-1"],
        ]

        for argv in cases:
            with self.subTest(argv=argv):
                exit_code, payload = self._run_main(argv)
                self.assertEqual(exit_code, 8)
                self.assertFalse(payload["ok"])
                self.assertEqual(payload["error"]["code"], "ARGPARSE_ERROR")

    def test_list_commands_reject_id_filter_params(self) -> None:
        cases = [
            ["inventory", "list", "--param", "id=12"],
            ["inventory", "list", "--param", "inventory_id=12"],
            ["reagent-orders", "list", "--param", "order_id=12"],
            ["consumable-orders", "list", "--param", "id=12"],
        ]

        for argv in cases:
            with self.subTest(argv=argv):
                exit_code, payload = self._run_main(argv)
                self.assertEqual(exit_code, 7)
                self.assertFalse(payload["ok"])
                self.assertEqual(payload["error"]["code"], "INVALID_INPUT")

    def test_inventory_return_rejects_mixed_remaining_and_used_quantity(self) -> None:
        exit_code, payload = self._run_main(
            ["inventory", "return", "1", "--remaining-quantity", "10", "--used-quantity", "5"]
        )

        self.assertEqual(exit_code, 7)
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["error"]["code"], "INVALID_INPUT")

    @patch("lsm_cli.main.APIClient.request", return_value={"message": "ok"})
    def test_inventory_borrow_accepts_actual_borrower_argument(self, request_mock) -> None:
        exit_code, payload = self._run_main(
            ["inventory", "borrow", "1", "--actual-borrower-id", "12"]
        )

        self.assertIsNone(exit_code)
        self.assertTrue(payload["ok"])
        self.assertEqual(request_mock.call_args.kwargs["json_body"], {"actual_borrower_id": 12})


class CLIRequestModelStrictnessTests(unittest.TestCase):
    def test_cli_request_models_reject_unknown_fields(self) -> None:
        cases = [
            (InventoryBorrowRequest, {"unknown": 1}),
            (InventoryBorrowReturn, {"remaining_quantity": 1, "unit": "mL"}),
            (
                ManualInventoryCreate,
                {
                    "cas_number": "64-17-5",
                    "name": "乙醇",
                    "specification": "500ml",
                    "quantity_bottles": 1,
                    "unknown": 1,
                },
            ),
            (
                InventoryUpdate,
                {
                    "name": "乙醇",
                    "unknown": 1,
                },
            ),
            (
                ReagentOrderCreate,
                {
                    "cas_number": "64-17-5",
                    "name": "乙醇",
                    "specification": "500ml",
                    "quantity": 1,
                    "price": 1.0,
                    "order_reason": "running_out",
                    "unknown": 1,
                },
            ),
            (
                ReagentOrderUpdate,
                {
                    "notes": "ok",
                    "unknown": 1,
                },
            ),
            (
                ConsumableOrderCreate,
                {
                    "name": "手套",
                    "specification": "M",
                    "quantity": 1,
                    "unknown": 1,
                },
            ),
            (
                ConsumableOrderUpdate,
                {
                    "notes": "ok",
                    "unknown": 1,
                },
            ),
            (ConfirmArrivalRequest, {"arrival_notes": "已签收", "unknown": 1}),
            (StockInRequest, {"storage_location": "A-01", "unknown": 1}),
        ]

        for model, payload in cases:
            with self.subTest(model=model.__name__):
                with self.assertRaises(ValidationError):
                    model.model_validate(payload)


class CLIEnumConsistencyTests(unittest.TestCase):
    def test_reagent_order_reason_choices_match_backend_enum(self) -> None:
        self.assertTupleEqual(
            REAGENT_ORDER_REASON_CHOICES,
            tuple(item.value for item in ReagentOrderReason),
        )


if __name__ == "__main__":
    unittest.main()
