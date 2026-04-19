"""Small self-tests for the WeCom AI Bot integration."""

from __future__ import annotations

import base64
import asyncio
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from robot.wecom_aibot.conversation_store import WecomConversationStore
from robot.wecom_aibot.crypto import WecomAesCipher, generate_signature
from robot.wecom_aibot.formatters import build_safe_facts, format_safe_facts, format_tool_result
from robot.wecom_aibot.handler import WecomAibotHandler
from robot.wecom_aibot.llm_planner import (
    ACTION_CALL_TOOL,
    ACTION_START_BORROW,
    ACTION_START_RETURN,
    LSMToolPlan,
)
from robot.wecom_aibot.lsm_orchestrator import LSMRobotOrchestrator
from robot.wecom_aibot.messages import parse_text_message
from robot.wecom_aibot.store import ProcessedMessageStore


def _test_encoding_aes_key() -> str:
    return base64.b64encode(bytes(range(32))).decode("ascii").rstrip("=")


def _remove_sqlite_files(database_path: Path) -> None:
    database_path.unlink(missing_ok=True)
    database_path.with_name(database_path.name + "-wal").unlink(missing_ok=True)
    database_path.with_name(database_path.name + "-shm").unlink(missing_ok=True)


class FakeOrchestrator:
    def __init__(self) -> None:
        self.calls = 0

    async def answer(self, *, text: str, payload: dict) -> str:
        self.calls += 1
        return f"已查询：{text}"


class SlowFakeOrchestrator(FakeOrchestrator):
    async def answer(self, *, text: str, payload: dict) -> str:
        await asyncio.sleep(0.05)
        return await super().answer(text=text, payload=payload)


class FakeMcpClient:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []

    async def call_tool(self, name: str, arguments: dict) -> dict:
        self.calls.append((name, arguments))
        if name == "auth_login":
            return {
                "ok": True,
                "exit_code": 0,
                "payload": {
                    "ok": True,
                    "data": {
                        "access_token": "user-secret-token",
                        "user": {"username": "alice", "full_name": "张三"},
                    },
                },
            }
        if name == "inventory_search_by_name":
            return _ok_data(
                {
                    "items": [
                        {
                            "id": 12,
                            "name": "乙醇",
                            "alias": "酒精",
                            "cas_number": "64-17-5",
                            "remaining_quantity": 300,
                            "unit": "ml",
                            "storage_location": "A-01",
                        }
                    ]
                }
            )
        if name == "inventory_list_low_stock":
            return _ok_data(
                {
                    "items": [
                        {
                            "id": 15,
                            "name": "乙腈",
                            "cas_number": "75-05-8",
                            "remaining_quantity": 40,
                            "remaining_percent": 0.08,
                            "unit": "ml",
                            "storage_location": "C-02",
                        }
                    ],
                    "total": 1,
                }
            )
        if name == "reagent_orders_my":
            return _ok_data(
                {
                    "items": [
                        {
                            "id": 21,
                            "name": "四三苯基膦钯",
                            "cas_number": "14221-01-3",
                            "quantity": 1,
                            "status": "pending",
                        }
                    ],
                    "total": 1,
                }
            )
        if name == "common_shelf_search_by_alias":
            return _ok_data(
                {
                    "groups": [
                        {
                            "group": {
                                "name": "乙醇",
                                "cas_number": "64-17-5",
                                "bottle_count": 2,
                                "storage_location": "公共架 A-01",
                            }
                        }
                    ],
                    "total": 1,
                }
            )
        if name == "inventory_borrow":
            return _ok_data({"message": "ok"})
        if name == "inventory_my_borrows":
            return _ok_data(
                {
                    "items": [
                        {
                            "id": 12,
                            "name": "乙醇",
                            "alias": "酒精",
                            "cas_number": "64-17-5",
                            "remaining_quantity": 300,
                            "unit": "ml",
                            "storage_location": "A-01",
                        }
                    ]
                }
            )
        if name == "inventory_return":
            return _ok_data({"message": "ok"})
        return {"ok": False, "exit_code": 1, "error": {"code": "TEST", "message": "unexpected"}}


class MultiCandidateMcpClient(FakeMcpClient):
    async def call_tool(self, name: str, arguments: dict) -> dict:
        self.calls.append((name, arguments))
        if name == "inventory_search_by_name":
            return _ok_data(
                {
                    "items": [
                        {
                            "id": 12,
                            "name": "乙醇",
                            "english_name": "Ethanol",
                            "alias": "酒精",
                            "cas_number": "64-17-5",
                            "brand": "沪试",
                            "purity": "AR",
                            "specification": "500ml",
                            "remaining_quantity": 300,
                            "unit": "ml",
                            "storage_location": "A-01",
                            "status": "in_stock",
                            "notes": "常用溶剂",
                            "internal_code": "LSM-SECRET-001",
                        },
                        {
                            "id": 13,
                            "name": "乙醇",
                            "cas_number": "64-17-5",
                            "brand": "国药",
                            "purity": "GR",
                            "specification": "2.5L",
                            "remaining_quantity": 1800,
                            "unit": "ml",
                            "storage_location": "B-02",
                            "status": "in_stock",
                            "temporary_keeper_name": "张三",
                        },
                    ],
                    "total": 2,
                }
            )
        if name == "inventory_borrow":
            return _ok_data({"message": "ok"})
        return await super().call_tool(name, arguments)


class BorrowAvailabilityMcpClient(FakeMcpClient):
    async def call_tool(self, name: str, arguments: dict) -> dict:
        self.calls.append((name, arguments))
        if name == "inventory_search_by_name":
            return _ok_data(
                {
                    "items": [
                        {
                            "id": 11,
                            "name": "乙醇已借",
                            "cas_number": "64-17-5",
                            "remaining_quantity": 200,
                            "unit": "ml",
                            "status": "borrowed",
                            "borrower_name": "张三",
                        },
                        {
                            "id": 12,
                            "name": "乙醇耗尽",
                            "cas_number": "64-17-5",
                            "remaining_quantity": 0,
                            "unit": "ml",
                            "status": "consumed",
                        },
                        {
                            "id": 13,
                            "name": "乙醇空瓶",
                            "cas_number": "64-17-5",
                            "remaining_quantity": 0,
                            "unit": "ml",
                            "status": "in_stock",
                        },
                        {
                            "id": 14,
                            "name": "乙醇可借",
                            "cas_number": "64-17-5",
                            "remaining_quantity": 300,
                            "unit": "ml",
                            "status": "in_stock",
                        },
                    ],
                    "total": 4,
                }
            )
        if name == "inventory_borrow":
            return _ok_data({"message": "ok"})
        return await super().call_tool(name, arguments)


class AuthExpiredReadMcpClient(FakeMcpClient):
    async def call_tool(self, name: str, arguments: dict) -> dict:
        self.calls.append((name, arguments))
        if name == "inventory_search_by_name":
            return _auth_expired_result()
        return await super().call_tool(name, arguments)


class AuthExpiredBorrowMcpClient(FakeMcpClient):
    async def call_tool(self, name: str, arguments: dict) -> dict:
        self.calls.append((name, arguments))
        if name == "inventory_search_by_name":
            return _ok_data(
                {
                    "items": [
                        {
                            "id": 12,
                            "name": "乙醇",
                            "cas_number": "64-17-5",
                            "remaining_quantity": 300,
                            "unit": "ml",
                            "storage_location": "A-01",
                        }
                    ]
                }
            )
        if name == "inventory_borrow":
            return _auth_expired_result()
        return await super().call_tool(name, arguments)


class FakeReturnQuantityPlanner:
    def __init__(
        self,
        response: dict | None = None,
        parse_response: dict | None = None,
        plan_response: LSMToolPlan | None = None,
        context_reset_response: dict | None = None,
    ) -> None:
        self.response = response or {
            "ok": True,
            "mode": "used",
            "source_value": 0.02,
            "source_unit": "升",
            "converted_value": 20,
            "target_unit": "mL",
        }
        self.parse_response = parse_response
        self.plan_response = plan_response
        self.context_reset_response = context_reset_response
        self.calls: list[dict] = []
        self.parse_calls: list[str] = []
        self.plan_calls: list[dict] = []
        self.context_reset_calls: list[dict] = []

    async def resolve_return_quantity(
        self,
        *,
        user_text: str,
        raw_arguments: dict,
        inventory_text: str,
        current_remaining: float | None,
        initial_quantity: float | None,
        target_unit: str,
        conversation_context: list[dict[str, str]] | None = None,
    ) -> dict:
        self.calls.append(
            {
                "user_text": user_text,
                "raw_arguments": raw_arguments,
                "inventory_text": inventory_text,
                "current_remaining": current_remaining,
                "initial_quantity": initial_quantity,
                "target_unit": target_unit,
                "conversation_context": conversation_context or [],
            }
        )
        return self.response

    async def plan(
        self,
        user_text: str,
        *,
        conversation_context: list[dict[str, str]] | None = None,
    ):
        self.plan_calls.append(
            {"user_text": user_text, "conversation_context": conversation_context or []}
        )
        return self.plan_response

    async def parse_return_request(
        self,
        *,
        user_text: str,
        conversation_context: list[dict[str, str]] | None = None,
    ) -> dict | None:
        self.parse_calls.append(user_text)
        _ = conversation_context
        if self.parse_response is not None:
            return self.parse_response
        return {
            "keyword": "乙醇",
            "quantity_mode": self.response["mode"],
            "quantity_value": self.response["source_value"],
            "quantity_unit": self.response["source_unit"],
        }

    async def detect_context_reset(
        self,
        *,
        user_text: str,
        conversation_context: list[dict[str, str]],
    ) -> dict | None:
        self.context_reset_calls.append(
            {"user_text": user_text, "conversation_context": conversation_context}
        )
        return self.context_reset_response


def _ok_data(data: dict) -> dict:
    return {"ok": True, "exit_code": 0, "payload": {"ok": True, "data": data}}


def _auth_expired_result() -> dict:
    return {
        "ok": False,
        "exit_code": 2,
        "payload": {
            "ok": False,
            "error": {
                "code": "HTTP_ERROR",
                "message": "Not authenticated",
                "detail": {"code": "AUTH_SESSION_EXPIRED"},
            },
        },
    }


class WecomAibotSelfTest(unittest.TestCase):
    def test_crypto_round_trip(self) -> None:
        cipher = WecomAesCipher(token="token", encoding_aes_key=_test_encoding_aes_key())
        encrypted = cipher.encrypt_payload(
            {"msgtype": "text", "text": {"content": "hello"}},
            timestamp="123",
            nonce="nonce",
        )
        signature = encrypted["msgsignature"]
        payload = cipher.decrypt_callback(
            encrypted["encrypt"],
            signature=signature,
            timestamp="123",
            nonce="nonce",
        )
        self.assertEqual(payload["text"]["content"], "hello")

    def test_signature_generation(self) -> None:
        actual = generate_signature("token", "1", "n", "abc")
        expected = generate_signature("token", "1", "n", "abc")
        self.assertEqual(expected, actual)

    def test_parse_text_message_strips_group_mention(self) -> None:
        message = parse_text_message(
            {
                "msgid": "m1",
                "aibotid": "bot",
                "chattype": "group",
                "chatid": "chat",
                "from": {"userid": "u1"},
                "msgtype": "text",
                "text": {"content": "@实验室库存助手 查询乙醇库存"},
            }
        )
        self.assertEqual(message.content, "查询乙醇库存")
        self.assertEqual(message.userid, "u1")

    def test_processed_message_store_replays_response(self) -> None:
        workspace_tmp = Path("tmp")
        workspace_tmp.mkdir(exist_ok=True)
        database_path = workspace_tmp / "robot-selftest-state.db"
        _remove_sqlite_files(database_path)
        store = ProcessedMessageStore(database_path)
        store.init()
        response = {"msgtype": "text", "text": {"content": "ok"}}
        store.save_response("m1", response)
        self.assertEqual(response, store.get_response("m1"))
        _remove_sqlite_files(database_path)

    def test_conversation_context_keeps_latest_five_and_expires_after_two_hours(self) -> None:
        workspace_tmp = Path("tmp")
        workspace_tmp.mkdir(exist_ok=True)
        database_path = workspace_tmp / "robot-context-state.db"
        _remove_sqlite_files(database_path)
        store = WecomConversationStore(database_path)
        store.init()

        for index in range(6):
            store.append_context_turn("chat:u1", user_text=f"用户{index}", assistant_text=f"回复{index}")

        context = store.get_context("chat:u1")
        self.assertEqual(5, len(context))
        self.assertEqual("用户1", context[0]["user"])
        self.assertEqual("回复5", context[-1]["assistant"])

        connection = store._connect()
        try:
            with connection:
                connection.execute(
                    """
                    UPDATE wecom_aibot_conversation_context
                    SET updated_at = datetime('now', '-3 hours')
                    WHERE chat_key = ?
                    """,
                    ("chat:u1",),
                )
        finally:
            connection.close()

        self.assertEqual([], store.get_context("chat:u1"))
        _remove_sqlite_files(database_path)

    def test_conversation_context_concurrent_appends_keep_all_five_turns(self) -> None:
        workspace_tmp = Path("tmp")
        workspace_tmp.mkdir(exist_ok=True)
        database_path = workspace_tmp / "robot-context-concurrent-state.db"
        _remove_sqlite_files(database_path)
        store = WecomConversationStore(database_path)
        store.init()

        def append_turn(index: int) -> None:
            store.append_context_turn("chat:u1", user_text=f"用户{index}", assistant_text=f"回复{index}")

        with ThreadPoolExecutor(max_workers=5) as executor:
            list(executor.map(append_turn, range(5)))

        context = store.get_context("chat:u1")
        self.assertEqual(5, len(context))
        self.assertEqual({f"用户{index}" for index in range(5)}, {item["user"] for item in context})
        _remove_sqlite_files(database_path)

    def test_handler_replays_duplicate_msgid_without_requery(self) -> None:
        workspace_tmp = Path("tmp")
        workspace_tmp.mkdir(exist_ok=True)
        database_path = workspace_tmp / "robot-handler-state.db"
        _remove_sqlite_files(database_path)
        store = ProcessedMessageStore(database_path)
        store.init()
        orchestrator = FakeOrchestrator()
        handler = WecomAibotHandler(
            orchestrator=orchestrator,
            store=store,
            welcome_text="welcome",
        )
        payload = {
            "msgid": "m2",
            "aibotid": "bot",
            "from": {"userid": "u1"},
            "msgtype": "text",
            "text": {"content": "查询乙醇库存"},
        }

        first = asyncio.run(handler.handle_payload(payload))
        second = asyncio.run(handler.handle_payload(payload))

        self.assertEqual(first, second)
        self.assertEqual(1, orchestrator.calls)
        _remove_sqlite_files(database_path)

    def test_handler_claims_duplicate_msgid_during_processing(self) -> None:
        workspace_tmp = Path("tmp")
        workspace_tmp.mkdir(exist_ok=True)
        database_path = workspace_tmp / "robot-handler-concurrent-state.db"
        _remove_sqlite_files(database_path)
        store = ProcessedMessageStore(database_path)
        store.init()
        orchestrator = SlowFakeOrchestrator()
        handler = WecomAibotHandler(
            orchestrator=orchestrator,
            store=store,
            welcome_text="welcome",
        )
        payload = {
            "msgid": "m-concurrent",
            "aibotid": "bot",
            "from": {"userid": "u1"},
            "msgtype": "text",
            "text": {"content": "确认"},
        }

        async def run_duplicate_callbacks() -> list[dict]:
            return list(
                await asyncio.gather(
                    handler.handle_payload(payload),
                    handler.handle_payload(payload),
                )
            )

        replies = asyncio.run(run_duplicate_callbacks())
        contents = {reply["text"]["content"] for reply in replies}

        self.assertEqual(1, orchestrator.calls)
        self.assertIn("正在处理，请稍后。", contents)
        self.assertIn("已查询：确认", contents)
        _remove_sqlite_files(database_path)

    def test_formatter_hides_internal_code(self) -> None:
        reply = format_tool_result(
            {
                "ok": True,
                "exit_code": 0,
                "payload": {
                    "ok": True,
                    "data": {
                        "name": "乙醇",
                        "cas_number": "64-17-5",
                        "internal_code": "LSM-SECRET-001",
                    },
                },
            },
            title="库存查询结果",
            empty_text="没有查到匹配记录。",
        )

        self.assertIn("乙醇", reply)
        self.assertNotIn("LSM-SECRET-001", reply)

    def test_formatter_shows_inventory_holder_names(self) -> None:
        reply = format_tool_result(
            {
                "ok": True,
                "exit_code": 0,
                "payload": {
                    "ok": True,
                    "data": {
                        "items": [
                            {
                                "id": 12,
                                "name": "乙醇",
                                "cas_number": "64-17-5",
                                "status": "borrowed",
                                "borrower_id": 22,
                                "borrower_name": "胡志斌",
                                "last_borrower_id": 22,
                                "last_borrower_name": "胡志斌",
                            },
                            {
                                "id": 13,
                                "name": "乙腈",
                                "cas_number": "75-05-8",
                                "temporary_keeper_id": 23,
                                "temporary_keeper_name": "张三",
                            },
                        ],
                        "total": 2,
                    },
                },
            },
            title="库存查询结果",
            empty_text="没有查到匹配记录。",
        )

        self.assertIn("状态 已借用", reply)
        self.assertIn("借用人 胡志斌", reply)
        self.assertIn("最近借用人 胡志斌", reply)
        self.assertIn("暂存人 张三", reply)
        self.assertNotIn("borrower_id", reply)
        self.assertNotIn("temporary_keeper_id", reply)

    def test_formatter_keeps_user_facing_fields_and_hides_sensitive_fields(self) -> None:
        result = {
            "ok": True,
            "exit_code": 0,
            "payload": {
                "ok": True,
                "data": {
                    "items": [
                        {
                            "id": 12,
                            "name": "乙醇",
                            "english_name": "Ethanol",
                            "alias": "酒精",
                            "category": "solvent",
                            "cas_number": "64-17-5",
                            "internal_code": "LSM-SECRET-001",
                            "name_pinyin": "yichun",
                            "brand": "沪试",
                            "purity": "AR",
                            "specification": "500ml",
                            "remaining_quantity": 300,
                            "remaining_percent": 0.6,
                            "unit": "ml",
                            "storage_location": "A-01",
                            "notes": "常用溶剂",
                            "created_at": "2026-04-01T00:00:00Z",
                            "updated_at": "2026-04-02T00:00:00Z",
                            "access_token": "secret-token",
                            "stderr": "traceback",
                        }
                    ],
                    "total": 1,
                },
            },
        }

        reply = format_safe_facts(build_safe_facts(result, title="库存查询结果", empty_text="无"))

        self.assertIn("英文名 Ethanol", reply)
        self.assertIn("别名 酒精", reply)
        self.assertIn("分类 solvent", reply)
        self.assertIn("纯度 AR", reply)
        self.assertIn("规格 500ml", reply)
        self.assertIn("剩余量 300ml", reply)
        self.assertIn("剩余比例 60%", reply)
        self.assertIn("备注 常用溶剂", reply)
        self.assertNotIn("LSM-SECRET-001", reply)
        self.assertNotIn("secret-token", reply)
        self.assertNotIn("traceback", reply)
        self.assertNotIn("yichun", reply)

    def test_formatter_expands_common_shelf_group_fields(self) -> None:
        reply = format_tool_result(
            {
                "ok": True,
                "exit_code": 0,
                "payload": {
                    "ok": True,
                    "data": {
                        "groups": [
                            {
                                "group": {
                                    "group_key": "internal-group-key",
                                    "cas_number": "64-17-5",
                                    "brand": "沪试",
                                    "specification_text": "500ml",
                                    "specification_normalized": "500ml",
                                },
                                "display": {
                                    "name": "乙醇",
                                    "english_name": "Ethanol",
                                    "category": "solvent",
                                },
                                "bottle_count": 2,
                                "location_count": 1,
                                "created_at": "2026-04-01T00:00:00Z",
                            }
                        ],
                        "total": 1,
                    },
                },
            },
            title="常用货架查询结果",
            empty_text="无",
        )

        self.assertIn("乙醇", reply)
        self.assertIn("CAS 64-17-5", reply)
        self.assertIn("规格 500ml", reply)
        self.assertIn("瓶数 2瓶", reply)
        self.assertNotIn("internal-group-key", reply)
        self.assertNotIn("normalized", reply)

    def test_binding_is_private_and_does_not_echo_token(self) -> None:
        store_path = Path("tmp") / "robot-binding-state.db"
        _remove_sqlite_files(store_path)
        store = WecomConversationStore(store_path)
        store.init()
        orchestrator = LSMRobotOrchestrator(
            mcp_client=FakeMcpClient(),
            conversation_store=store,
        )

        group_reply = asyncio.run(
            orchestrator.answer(text="绑定 alice secret", payload=_payload(chattype="group"))
        )
        private_reply = asyncio.run(orchestrator.answer(text="绑定 alice secret", payload=_payload()))

        self.assertIn("请私聊", group_reply)
        self.assertIn("绑定成功", private_reply)
        self.assertNotIn("user-secret-token", private_reply)
        self.assertEqual("alice", store.get_binding("u1")["username"])
        _remove_sqlite_files(store_path)

    def test_binding_command_does_not_call_llm_context_reset_with_password(self) -> None:
        store_path = Path("tmp") / "robot-binding-no-llm-state.db"
        _remove_sqlite_files(store_path)
        store = WecomConversationStore(store_path)
        store.init()
        store.append_context_turn("single:single:u1", user_text="查询乙醇", assistant_text="乙醇在 A-01")
        planner = FakeReturnQuantityPlanner(
            context_reset_response={"reset": True, "continue_current_request": False}
        )
        orchestrator = LSMRobotOrchestrator(
            mcp_client=FakeMcpClient(),
            conversation_store=store,
            llm_planner=planner,
        )

        reply = asyncio.run(orchestrator.answer(text="绑定 alice secret", payload=_payload()))

        self.assertIn("绑定成功", reply)
        self.assertEqual([], planner.context_reset_calls)
        context = store.get_context("single:single:u1")
        self.assertEqual([{"user": "查询乙醇", "assistant": "乙醇在 A-01"}], context)
        self.assertNotIn("secret", str(context))
        _remove_sqlite_files(store_path)

    def test_manual_unbind_requires_confirmation(self) -> None:
        store_path = Path("tmp") / "robot-manual-unbind-state.db"
        _remove_sqlite_files(store_path)
        store = WecomConversationStore(store_path)
        store.init()
        orchestrator = LSMRobotOrchestrator(
            mcp_client=FakeMcpClient(),
            conversation_store=store,
        )

        bind_reply = asyncio.run(orchestrator.answer(text="绑定 alice secret", payload=_payload()))
        unbind_reply = asyncio.run(orchestrator.answer(text="解绑", payload=_payload()))

        self.assertIn("绑定成功", bind_reply)
        self.assertIn("确认解除", unbind_reply)
        self.assertEqual("alice", store.get_binding("u1")["username"])

        still_bound_reply = asyncio.run(orchestrator.answer(text="取消", payload=_payload()))
        self.assertEqual("已取消。", still_bound_reply)
        self.assertEqual("alice", store.get_binding("u1")["username"])

        second_unbind_reply = asyncio.run(orchestrator.answer(text="取消绑定", payload=_payload()))
        self.assertIn("确认解除", second_unbind_reply)

        confirm_reply = asyncio.run(orchestrator.answer(text="确认", payload=_payload()))
        self.assertIn("已解除", confirm_reply)
        self.assertIsNone(store.get_binding("u1"))

        query_reply = asyncio.run(orchestrator.answer(text="查询乙醇库存", payload=_payload()))
        self.assertIn("需要先绑定账号", query_reply)
        _remove_sqlite_files(store_path)

    def test_read_query_requires_binding(self) -> None:
        store_path = Path("tmp") / "robot-read-unbound-state.db"
        _remove_sqlite_files(store_path)
        store = WecomConversationStore(store_path)
        store.init()
        mcp = FakeMcpClient()
        orchestrator = LSMRobotOrchestrator(mcp_client=mcp, conversation_store=store)

        reply = asyncio.run(orchestrator.answer(text="查询乙醇库存", payload=_payload()))

        self.assertIn("需要先绑定账号", reply)
        self.assertEqual([], mcp.calls)
        _remove_sqlite_files(store_path)

    def test_bound_read_query_uses_user_token(self) -> None:
        store_path = Path("tmp") / "robot-read-bound-state.db"
        _remove_sqlite_files(store_path)
        store = WecomConversationStore(store_path)
        store.init()
        mcp = FakeMcpClient()
        orchestrator = LSMRobotOrchestrator(mcp_client=mcp, conversation_store=store)
        store.save_binding(
            wecom_userid="u1",
            username="alice",
            access_token="user-secret-token",
            user={"username": "alice"},
        )

        reply = asyncio.run(orchestrator.answer(text="查询乙醇库存", payload=_payload()))

        self.assertIn("乙醇", reply)
        self.assertIn(
            (
                "inventory_search_by_name",
                {"keyword": "乙醇", "limit": 5, "user_token": "user-secret-token"},
            ),
            mcp.calls,
        )
        _remove_sqlite_files(store_path)

    def test_auth_failure_auto_unbinds_read_query(self) -> None:
        store_path = Path("tmp") / "robot-read-auth-expired-state.db"
        _remove_sqlite_files(store_path)
        store = WecomConversationStore(store_path)
        store.init()
        mcp = AuthExpiredReadMcpClient()
        orchestrator = LSMRobotOrchestrator(mcp_client=mcp, conversation_store=store)
        store.save_binding(
            wecom_userid="u1",
            username="alice",
            access_token="expired-token",
            user={"username": "alice"},
        )

        reply = asyncio.run(orchestrator.answer(text="查询乙醇库存", payload=_payload()))

        self.assertEqual("绑定已过期，请重新绑定。", reply)
        self.assertIsNone(store.get_binding("u1"))
        self.assertIn(
            (
                "inventory_search_by_name",
                {"keyword": "乙醇", "limit": 5, "user_token": "expired-token"},
            ),
            mcp.calls,
        )
        _remove_sqlite_files(store_path)

    def test_llm_plan_receives_recent_conversation_context(self) -> None:
        store_path = Path("tmp") / "robot-context-plan-state.db"
        _remove_sqlite_files(store_path)
        store = WecomConversationStore(store_path)
        store.init()
        mcp = FakeMcpClient()
        planner = FakeReturnQuantityPlanner(
            plan_response=LSMToolPlan(
                action=ACTION_CALL_TOOL,
                tool_name="inventory_search_by_name",
                arguments={"keyword": "乙醇", "limit": 5},
                title="库存查询结果",
            )
        )
        orchestrator = LSMRobotOrchestrator(
            mcp_client=mcp,
            conversation_store=store,
            llm_planner=planner,
        )
        store.save_binding(
            wecom_userid="u1",
            username="alice",
            access_token="user-secret-token",
            user={"username": "alice"},
        )
        for index in range(6):
            store.append_context_turn(
                "single:single:u1",
                user_text=f"用户{index}",
                assistant_text=f"回复{index}",
            )

        reply = asyncio.run(orchestrator.answer(text="它在哪里", payload=_payload()))

        self.assertIn("乙醇", reply)
        self.assertEqual("它在哪里", planner.plan_calls[0]["user_text"])
        context = planner.plan_calls[0]["conversation_context"]
        self.assertEqual(5, len(context))
        self.assertEqual("用户1", context[0]["user"])
        self.assertEqual("回复5", context[-1]["assistant"])
        _remove_sqlite_files(store_path)

    def test_llm_plan_routes_existing_read_workflow_without_keyword_rule(self) -> None:
        cases = [
            {
                "name": "low_stock",
                "text": "哪些瓶子快见底了",
                "plan": LSMToolPlan(
                    action=ACTION_CALL_TOOL,
                    tool_name="inventory_list_low_stock",
                    arguments={"limit": 5},
                    title="低库存记录",
                ),
                "expected_call": (
                    "inventory_list_low_stock",
                    {"limit": 5, "user_token": "user-secret-token"},
                ),
                "expected_text": "乙腈",
            },
            {
                "name": "my_reagent_orders",
                "text": "我之前让买的试剂有哪些进展",
                "plan": LSMToolPlan(
                    action=ACTION_CALL_TOOL,
                    tool_name="reagent_orders_my",
                    arguments={},
                    title="我的试剂订单",
                ),
                "expected_call": (
                    "reagent_orders_my",
                    {"user_token": "user-secret-token"},
                ),
                "expected_text": "四三苯基膦钯",
            },
            {
                "name": "common_shelf",
                "text": "公共架上还有酒精吗",
                "plan": LSMToolPlan(
                    action=ACTION_CALL_TOOL,
                    tool_name="common_shelf_search_by_alias",
                    arguments={"keyword": "酒精", "limit": 5},
                    title="常用货架查询结果",
                ),
                "expected_call": (
                    "common_shelf_search_by_alias",
                    {"keyword": "酒精", "limit": 5, "user_token": "user-secret-token"},
                ),
                "expected_text": "乙醇",
            },
        ]

        for case in cases:
            with self.subTest(case=case["name"]):
                store_path = Path("tmp") / f"robot-read-llm-plan-{case['name']}.db"
                _remove_sqlite_files(store_path)
                store = WecomConversationStore(store_path)
                store.init()
                mcp = FakeMcpClient()
                planner = FakeReturnQuantityPlanner(plan_response=case["plan"])
                orchestrator = LSMRobotOrchestrator(
                    mcp_client=mcp,
                    conversation_store=store,
                    llm_planner=planner,
                )
                store.save_binding(
                    wecom_userid="u1",
                    username="alice",
                    access_token="user-secret-token",
                    user={"username": "alice"},
                )

                reply = asyncio.run(orchestrator.answer(text=case["text"], payload=_payload()))

                self.assertIn(case["expected_text"], reply)
                self.assertEqual(case["text"], planner.plan_calls[0]["user_text"])
                self.assertIn(case["expected_call"], mcp.calls)
                _remove_sqlite_files(store_path)

    def test_borrow_requires_confirmed_bound_user_token(self) -> None:
        store_path = Path("tmp") / "robot-borrow-state.db"
        _remove_sqlite_files(store_path)
        store = WecomConversationStore(store_path)
        store.init()
        mcp = FakeMcpClient()
        orchestrator = LSMRobotOrchestrator(mcp_client=mcp, conversation_store=store)
        store.save_binding(
            wecom_userid="u1",
            username="alice",
            access_token="user-secret-token",
            user={"username": "alice"},
        )

        first = asyncio.run(orchestrator.answer(text="借用乙醇", payload=_payload()))
        second = asyncio.run(orchestrator.answer(text="确认", payload=_payload()))

        self.assertIn("确认借用", first)
        self.assertEqual("借用成功。", second)
        self.assertIn(("inventory_borrow", {"inventory_id": 12, "user_token": "user-secret-token"}), mcp.calls)
        _remove_sqlite_files(store_path)

    def test_auth_failure_auto_unbinds_confirmed_write(self) -> None:
        store_path = Path("tmp") / "robot-borrow-auth-expired-state.db"
        _remove_sqlite_files(store_path)
        store = WecomConversationStore(store_path)
        store.init()
        mcp = AuthExpiredBorrowMcpClient()
        orchestrator = LSMRobotOrchestrator(mcp_client=mcp, conversation_store=store)
        store.save_binding(
            wecom_userid="u1",
            username="alice",
            access_token="expired-token",
            user={"username": "alice"},
        )

        first = asyncio.run(orchestrator.answer(text="借用乙醇", payload=_payload()))
        second = asyncio.run(orchestrator.answer(text="确认", payload=_payload()))

        self.assertIn("确认借用", first)
        self.assertEqual("绑定已过期，请重新绑定。", second)
        self.assertIsNone(store.get_binding("u1"))
        self.assertIsNone(store.get_state("single:single:u1"))
        self.assertIn(("inventory_borrow", {"inventory_id": 12, "user_token": "expired-token"}), mcp.calls)
        _remove_sqlite_files(store_path)

    def test_successful_bind_clears_stale_unbind_confirmation_state(self) -> None:
        store_path = Path("tmp") / "robot-bind-clears-unbind-state.db"
        _remove_sqlite_files(store_path)
        store = WecomConversationStore(store_path)
        store.init()
        mcp = FakeMcpClient()
        orchestrator = LSMRobotOrchestrator(mcp_client=mcp, conversation_store=store)
        store.save_binding(
            wecom_userid="u1",
            username="old",
            access_token="old-token",
            user={"username": "old"},
        )

        first = asyncio.run(orchestrator.answer(text="解绑", payload=_payload()))
        second = asyncio.run(orchestrator.answer(text="绑定 alice secret", payload=_payload()))
        third = asyncio.run(orchestrator.answer(text="确认", payload=_payload()))

        self.assertIn("确认解除", first)
        self.assertIn("绑定成功", second)
        self.assertIsNone(store.get_state("single:single:u1"))
        self.assertIsNotNone(store.get_binding("u1"))
        self.assertNotIn("已解除", third)
        _remove_sqlite_files(store_path)

    def test_context_reset_decision_clears_context_and_pending_state(self) -> None:
        store_path = Path("tmp") / "robot-context-reset-state.db"
        _remove_sqlite_files(store_path)
        store = WecomConversationStore(store_path)
        store.init()
        mcp = FakeMcpClient()
        planner = FakeReturnQuantityPlanner(
            context_reset_response={"reset": True, "continue_current_request": False}
        )
        orchestrator = LSMRobotOrchestrator(
            mcp_client=mcp,
            conversation_store=store,
            llm_planner=planner,
        )
        store.save_binding(
            wecom_userid="u1",
            username="alice",
            access_token="user-secret-token",
            user={"username": "alice"},
        )

        first = asyncio.run(orchestrator.answer(text="借用乙醇", payload=_payload()))
        reply = asyncio.run(orchestrator.answer(text="开始一段全新的对话", payload=_payload()))

        self.assertIn("确认借用", first)
        self.assertIn("已开始新对话", reply)
        self.assertEqual([], store.get_context("single:single:u1"))
        self.assertIsNone(store.get_state("single:single:u1"))
        self.assertEqual("开始一段全新的对话", planner.context_reset_calls[0]["user_text"])
        self.assertNotIn("inventory_borrow", [name for name, _ in mcp.calls])
        _remove_sqlite_files(store_path)

    def test_llm_write_plan_starts_borrow_without_keyword_rule(self) -> None:
        store_path = Path("tmp") / "robot-borrow-llm-plan-state.db"
        _remove_sqlite_files(store_path)
        store = WecomConversationStore(store_path)
        store.init()
        mcp = FakeMcpClient()
        planner = FakeReturnQuantityPlanner(
            plan_response=LSMToolPlan(
                action=ACTION_START_BORROW,
                arguments={"keyword": "乙醇"},
            )
        )
        orchestrator = LSMRobotOrchestrator(
            mcp_client=mcp,
            conversation_store=store,
            llm_planner=planner,
        )
        store.save_binding(
            wecom_userid="u1",
            username="alice",
            access_token="user-secret-token",
            user={"username": "alice"},
        )

        first = asyncio.run(orchestrator.answer(text="帮我拿一瓶酒精", payload=_payload()))
        second = asyncio.run(orchestrator.answer(text="确认", payload=_payload()))

        self.assertIn("确认借用", first)
        self.assertEqual("借用成功。", second)
        self.assertIn(
            (
                "inventory_search_by_name",
                {"keyword": "乙醇", "limit": 5, "user_token": "user-secret-token"},
            ),
            mcp.calls,
        )
        self.assertIn(
            ("inventory_borrow", {"inventory_id": 12, "user_token": "user-secret-token"}),
            mcp.calls,
        )
        _remove_sqlite_files(store_path)

    def test_borrow_selection_accepts_natural_number_reply(self) -> None:
        store_path = Path("tmp") / "robot-borrow-natural-selection-state.db"
        _remove_sqlite_files(store_path)
        store = WecomConversationStore(store_path)
        store.init()
        mcp = MultiCandidateMcpClient()
        orchestrator = LSMRobotOrchestrator(mcp_client=mcp, conversation_store=store)
        store.save_binding(
            wecom_userid="u1",
            username="alice",
            access_token="user-secret-token",
            user={"username": "alice"},
        )

        first = asyncio.run(orchestrator.answer(text="借用乙醇", payload=_payload()))
        second = asyncio.run(orchestrator.answer(text="我要借用2", payload=_payload()))
        third = asyncio.run(orchestrator.answer(text="确认", payload=_payload()))

        self.assertIn("品牌 沪试", first)
        self.assertIn("纯度 GR", first)
        self.assertIn("暂存人 张三", first)
        self.assertNotIn("LSM-SECRET-001", first)
        self.assertIn("确认借用", second)
        self.assertIn("品牌 国药", second)
        self.assertEqual("借用成功。", third)
        self.assertIn(
            ("inventory_borrow", {"inventory_id": 13, "user_token": "user-secret-token"}),
            mcp.calls,
        )
        _remove_sqlite_files(store_path)

    def test_borrow_candidates_filter_unborrowable_inventory(self) -> None:
        store_path = Path("tmp") / "robot-borrow-filter-state.db"
        _remove_sqlite_files(store_path)
        store = WecomConversationStore(store_path)
        store.init()
        mcp = BorrowAvailabilityMcpClient()
        orchestrator = LSMRobotOrchestrator(mcp_client=mcp, conversation_store=store)
        store.save_binding(
            wecom_userid="u1",
            username="alice",
            access_token="user-secret-token",
            user={"username": "alice"},
        )

        first = asyncio.run(orchestrator.answer(text="借用乙醇", payload=_payload()))
        second = asyncio.run(orchestrator.answer(text="确认", payload=_payload()))

        self.assertIn("乙醇可借", first)
        self.assertNotIn("乙醇已借", first)
        self.assertNotIn("乙醇耗尽", first)
        self.assertNotIn("乙醇空瓶", first)
        self.assertEqual("借用成功。", second)
        self.assertIn(
            ("inventory_borrow", {"inventory_id": 14, "user_token": "user-secret-token"}),
            mcp.calls,
        )
        _remove_sqlite_files(store_path)

    def test_borrow_selection_rejects_out_of_range_number(self) -> None:
        store_path = Path("tmp") / "robot-borrow-invalid-selection-state.db"
        _remove_sqlite_files(store_path)
        store = WecomConversationStore(store_path)
        store.init()
        mcp = MultiCandidateMcpClient()
        orchestrator = LSMRobotOrchestrator(mcp_client=mcp, conversation_store=store)
        store.save_binding(
            wecom_userid="u1",
            username="alice",
            access_token="user-secret-token",
            user={"username": "alice"},
        )

        first = asyncio.run(orchestrator.answer(text="借用乙醇", payload=_payload()))
        second = asyncio.run(orchestrator.answer(text="借用8", payload=_payload()))

        self.assertIn("找到多个可借用", first)
        self.assertEqual("序号不在候选范围内，请重新选择。", second)
        self.assertNotIn("inventory_borrow", [name for name, _ in mcp.calls])
        _remove_sqlite_files(store_path)

    def test_return_requires_quantity_then_confirm(self) -> None:
        store_path = Path("tmp") / "robot-return-state.db"
        _remove_sqlite_files(store_path)
        store = WecomConversationStore(store_path)
        store.init()
        mcp = FakeMcpClient()
        orchestrator = LSMRobotOrchestrator(mcp_client=mcp, conversation_store=store)
        store.save_binding(
            wecom_userid="u1",
            username="alice",
            access_token="user-secret-token",
            user={"username": "alice"},
        )

        missing = asyncio.run(orchestrator.answer(text="归还乙醇", payload=_payload()))
        first = asyncio.run(orchestrator.answer(text="归还乙醇 用量20", payload=_payload()))
        second = asyncio.run(orchestrator.answer(text="确认", payload=_payload()))

        self.assertIn("需要说明用量", missing)
        self.assertIn("确认归还", first)
        self.assertIn("归还后剩余 280mL", first)
        self.assertEqual("归还成功。", second)
        self.assertIn(
            (
                "inventory_return",
                {"remaining_quantity": 280.0, "inventory_id": 12, "user_token": "user-secret-token"},
            ),
            mcp.calls,
        )
        _remove_sqlite_files(store_path)

    def test_llm_write_plan_starts_return_without_keyword_rule(self) -> None:
        store_path = Path("tmp") / "robot-return-llm-plan-state.db"
        _remove_sqlite_files(store_path)
        store = WecomConversationStore(store_path)
        store.init()
        mcp = FakeMcpClient()
        planner = FakeReturnQuantityPlanner(
            response={
                "ok": True,
                "mode": "used",
                "source_value": 20,
                "source_unit": "毫升",
                "converted_value": 20,
                "target_unit": "mL",
            },
            plan_response=LSMToolPlan(
                action=ACTION_START_RETURN,
                arguments={
                    "keyword": "酒精",
                    "quantity_mode": "used",
                    "quantity_value": 20,
                    "quantity_unit": "毫升",
                },
            ),
        )
        orchestrator = LSMRobotOrchestrator(
            mcp_client=mcp,
            conversation_store=store,
            llm_planner=planner,
        )
        store.save_binding(
            wecom_userid="u1",
            username="alice",
            access_token="user-secret-token",
            user={"username": "alice"},
        )

        first = asyncio.run(orchestrator.answer(text="我把酒精还了，实际消耗二十毫升", payload=_payload()))
        second = asyncio.run(orchestrator.answer(text="确认", payload=_payload()))

        self.assertIn("确认归还", first)
        self.assertIn("用量 20mL", first)
        self.assertIn("归还后剩余 280mL", first)
        self.assertEqual([], planner.parse_calls)
        self.assertEqual("归还成功。", second)
        self.assertIn(
            (
                "inventory_return",
                {"remaining_quantity": 280.0, "inventory_id": 12, "user_token": "user-secret-token"},
            ),
            mcp.calls,
        )
        _remove_sqlite_files(store_path)

    def test_return_uses_llm_unit_conversion_before_confirm(self) -> None:
        store_path = Path("tmp") / "robot-return-llm-unit-state.db"
        _remove_sqlite_files(store_path)
        store = WecomConversationStore(store_path)
        store.init()
        mcp = FakeMcpClient()
        planner = FakeReturnQuantityPlanner()
        orchestrator = LSMRobotOrchestrator(
            mcp_client=mcp,
            conversation_store=store,
            llm_planner=planner,
        )
        store.save_binding(
            wecom_userid="u1",
            username="alice",
            access_token="user-secret-token",
            user={"username": "alice"},
        )

        first = asyncio.run(orchestrator.answer(text="归还乙醇 使用 0.02 升", payload=_payload()))
        second = asyncio.run(orchestrator.answer(text="确认", payload=_payload()))

        self.assertIn("确认归还", first)
        self.assertIn("已换算为 20mL", first)
        self.assertIn("归还后剩余 280mL", first)
        self.assertEqual("mL", planner.calls[0]["target_unit"])
        self.assertEqual("归还成功。", second)
        self.assertIn(
            (
                "inventory_return",
                {"remaining_quantity": 280.0, "inventory_id": 12, "user_token": "user-secret-token"},
            ),
            mcp.calls,
        )
        _remove_sqlite_files(store_path)

    def test_return_llm_handles_chinese_milliliter_used_quantity(self) -> None:
        store_path = Path("tmp") / "robot-return-llm-ml-used-state.db"
        _remove_sqlite_files(store_path)
        store = WecomConversationStore(store_path)
        store.init()
        mcp = FakeMcpClient()
        planner = FakeReturnQuantityPlanner(
            {
                "ok": True,
                "mode": "used",
                "source_value": 20,
                "source_unit": "毫升",
                "converted_value": 20,
                "target_unit": "mL",
            }
        )
        orchestrator = LSMRobotOrchestrator(
            mcp_client=mcp,
            conversation_store=store,
            llm_planner=planner,
        )
        store.save_binding(
            wecom_userid="u1",
            username="alice",
            access_token="user-secret-token",
            user={"username": "alice"},
        )

        first = asyncio.run(orchestrator.answer(text="归还乙醇 用量 20 毫升", payload=_payload()))
        second = asyncio.run(orchestrator.answer(text="确认", payload=_payload()))

        self.assertIn("确认归还", first)
        self.assertIn("用量 20mL", first)
        self.assertIn("归还后剩余 280mL", first)
        self.assertEqual("归还成功。", second)
        self.assertIn(
            (
                "inventory_return",
                {"remaining_quantity": 280.0, "inventory_id": 12, "user_token": "user-secret-token"},
            ),
            mcp.calls,
        )
        _remove_sqlite_files(store_path)

    def test_return_llm_handles_chinese_milliliter_remaining_quantity(self) -> None:
        store_path = Path("tmp") / "robot-return-llm-ml-remaining-state.db"
        _remove_sqlite_files(store_path)
        store = WecomConversationStore(store_path)
        store.init()
        mcp = FakeMcpClient()
        planner = FakeReturnQuantityPlanner(
            {
                "ok": True,
                "mode": "remaining",
                "source_value": 280,
                "source_unit": "毫升",
                "converted_value": 280,
                "target_unit": "mL",
            }
        )
        orchestrator = LSMRobotOrchestrator(
            mcp_client=mcp,
            conversation_store=store,
            llm_planner=planner,
        )
        store.save_binding(
            wecom_userid="u1",
            username="alice",
            access_token="user-secret-token",
            user={"username": "alice"},
        )

        first = asyncio.run(orchestrator.answer(text="归还乙醇 归还量 280 毫升", payload=_payload()))
        second = asyncio.run(orchestrator.answer(text="确认", payload=_payload()))

        self.assertIn("确认归还", first)
        self.assertIn("归还后剩余 280mL", first)
        self.assertEqual("归还成功。", second)
        self.assertIn(
            (
                "inventory_return",
                {"remaining_quantity": 280.0, "inventory_id": 12, "user_token": "user-secret-token"},
            ),
            mcp.calls,
        )
        _remove_sqlite_files(store_path)

    def test_return_llm_parses_natural_language_without_regex_quantity(self) -> None:
        store_path = Path("tmp") / "robot-return-llm-natural-state.db"
        _remove_sqlite_files(store_path)
        store = WecomConversationStore(store_path)
        store.init()
        mcp = FakeMcpClient()
        planner = FakeReturnQuantityPlanner(
            response={
                "ok": True,
                "mode": "used",
                "source_value": 20,
                "source_unit": "毫升",
                "converted_value": 20,
                "target_unit": "mL",
            },
            parse_response={
                "keyword": "酒精",
                "quantity_mode": "used",
                "quantity_value": 20,
                "quantity_unit": "毫升",
            },
        )
        orchestrator = LSMRobotOrchestrator(
            mcp_client=mcp,
            conversation_store=store,
            llm_planner=planner,
        )
        store.save_binding(
            wecom_userid="u1",
            username="alice",
            access_token="user-secret-token",
            user={"username": "alice"},
        )

        first = asyncio.run(orchestrator.answer(text="我把酒精还了，实际消耗二十毫升", payload=_payload()))
        second = asyncio.run(orchestrator.answer(text="确认", payload=_payload()))

        self.assertIn("确认归还", first)
        self.assertIn("用量 20mL", first)
        self.assertIn("归还后剩余 280mL", first)
        self.assertEqual(["我把酒精还了，实际消耗二十毫升"], planner.parse_calls)
        self.assertEqual("归还成功。", second)
        self.assertIn(
            (
                "inventory_return",
                {"remaining_quantity": 280.0, "inventory_id": 12, "user_token": "user-secret-token"},
            ),
            mcp.calls,
        )
        _remove_sqlite_files(store_path)


def _payload(*, chattype: str = "single") -> dict:
    payload = {
        "msgid": "m",
        "aibotid": "bot",
        "from": {"userid": "u1"},
        "msgtype": "text",
        "text": {"content": "x"},
        "chattype": chattype,
    }
    if chattype == "group":
        payload["chatid"] = "g1"
    return payload


if __name__ == "__main__":
    unittest.main()
