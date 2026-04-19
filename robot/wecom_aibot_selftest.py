"""Small self-tests for the WeCom AI Bot integration."""

from __future__ import annotations

import base64
import asyncio
import unittest
from pathlib import Path

from robot.wecom_aibot.conversation_store import WecomConversationStore
from robot.wecom_aibot.crypto import WecomAesCipher, generate_signature
from robot.wecom_aibot.formatters import format_tool_result
from robot.wecom_aibot.handler import WecomAibotHandler
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
                            "cas_number": "64-17-5",
                            "remaining_quantity": 300,
                            "unit": "ml",
                            "storage_location": "A-01",
                        }
                    ]
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


def _ok_data(data: dict) -> dict:
    return {"ok": True, "exit_code": 0, "payload": {"ok": True, "data": data}}


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
        self.assertEqual("归还成功。", second)
        self.assertIn(
            (
                "inventory_return",
                {"used_quantity": 20.0, "inventory_id": 12, "user_token": "user-secret-token"},
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
