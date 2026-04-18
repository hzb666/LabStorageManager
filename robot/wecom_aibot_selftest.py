"""Small self-tests for the WeCom AI Bot integration."""

from __future__ import annotations

import base64
import unittest
from pathlib import Path

from robot.wecom_aibot.crypto import WecomAesCipher, generate_signature
from robot.wecom_aibot.messages import parse_text_message
from robot.wecom_aibot.store import ProcessedMessageStore


def _test_encoding_aes_key() -> str:
    return base64.b64encode(bytes(range(32))).decode("ascii").rstrip("=")


def _remove_sqlite_files(database_path: Path) -> None:
    database_path.unlink(missing_ok=True)
    database_path.with_name(database_path.name + "-wal").unlink(missing_ok=True)
    database_path.with_name(database_path.name + "-shm").unlink(missing_ok=True)


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


if __name__ == "__main__":
    unittest.main()
