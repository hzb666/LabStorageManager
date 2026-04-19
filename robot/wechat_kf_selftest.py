"""Self-tests for the WeChat customer service adapter."""

from __future__ import annotations

import asyncio
import base64
import unittest
from pathlib import Path
from typing import Any

from robot.wechat_kf.binding import WechatKfBindStore
from robot.wechat_kf.bind_pages import bind_form_html, bind_success_html
from robot.wechat_kf.config import WechatKfSettings
from robot.wechat_kf.messages import (
    actor_id,
    is_customer_message,
    is_customer_text_message,
    to_orchestrator_payload,
)
from robot.wechat_kf.processor import WechatKfMessageProcessor
from robot.wechat_kf.rate_limit import WechatKfRateLimiter
from robot.wechat_kf.webhook import _extract_encrypted_body, _parse_plaintext
from robot.wecom_aibot.conversation_store import WecomConversationStore
from robot.wecom_aibot.crypto import WecomAesCipher
from robot.wecom_aibot.store import ProcessedMessageStore


def _test_encoding_aes_key() -> str:
    return base64.b64encode(bytes(range(32))).decode("ascii").rstrip("=")


def _remove_sqlite_files(database_path: Path) -> None:
    database_path.unlink(missing_ok=True)
    database_path.with_name(database_path.name + "-wal").unlink(missing_ok=True)
    database_path.with_name(database_path.name + "-shm").unlink(missing_ok=True)


class FakeWechatKfClient:
    def __init__(self, messages: list[dict[str, Any]]) -> None:
        self.messages = messages
        self.sync_calls: list[dict[str, Any]] = []
        self.sent: list[dict[str, str]] = []

    async def sync_msg(
        self,
        *,
        token: str,
        cursor: str = "",
        open_kfid: str = "",
        limit: int = 100,
    ) -> dict[str, Any]:
        self.sync_calls.append(
            {"token": token, "cursor": cursor, "open_kfid": open_kfid, "limit": limit}
        )
        return {"errcode": 0, "msg_list": self.messages, "has_more": False}

    async def send_text(self, *, touser: str, open_kfid: str, content: str) -> dict[str, Any]:
        self.sent.append({"touser": touser, "open_kfid": open_kfid, "content": content})
        return {"errcode": 0}


class FakeOrchestrator:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    async def answer(self, *, text: str, payload: dict[str, Any]) -> str:
        self.calls.append({"text": text, "payload": payload})
        return f"已查询：{text}"


class SlowFakeOrchestrator(FakeOrchestrator):
    async def answer(self, *, text: str, payload: dict[str, Any]) -> str:
        await asyncio.sleep(0.05)
        return await super().answer(text=text, payload=payload)


class WechatKfSelfTest(unittest.TestCase):
    def test_message_conversion_uses_external_user_identity(self) -> None:
        message = _customer_text("m1", "乙醇在哪里")

        payload = to_orchestrator_payload(message)

        self.assertTrue(is_customer_text_message(message))
        self.assertTrue(is_customer_text_message({**message, "origin": "3"}))
        self.assertTrue(is_customer_message({**message, "msgtype": "image", "text": None}))
        self.assertEqual("wxkf:kf:user1", payload["from"]["userid"])
        self.assertEqual("乙醇在哪里", payload["text"]["content"])
        self.assertFalse(is_customer_text_message({**message, "origin": 5}))

    def test_process_event_replies_once_and_skips_duplicate(self) -> None:
        database_path = Path("tmp") / "wechat-kf-process.db"
        _remove_sqlite_files(database_path)
        settings, processor, client, orchestrator, conversation = _processor(database_path)
        conversation.save_binding(
            wecom_userid=actor_id("kf", "user1"),
            username="alice",
            access_token="token",
            user={"username": "alice"},
        )

        first = asyncio.run(processor.process_event({"Token": "sync-token", "OpenKfId": "kf"}, ""))
        second = asyncio.run(processor.process_event({"Token": "sync-token", "OpenKfId": "kf"}, ""))

        self.assertEqual(1, first)
        self.assertEqual(0, second)
        self.assertEqual(settings.sync_limit, client.sync_calls[0]["limit"])
        self.assertEqual([{"touser": "user1", "open_kfid": "kf", "content": "已查询：乙醇在哪里"}], client.sent)
        self.assertEqual(1, len(orchestrator.calls))
        _remove_sqlite_files(database_path)

    def test_customer_image_gets_fixed_text_reply_once(self) -> None:
        database_path = Path("tmp") / "wechat-kf-image.db"
        _remove_sqlite_files(database_path)
        _, processor, client, orchestrator, _ = _processor(database_path)
        client.messages = [_customer_image("img1")]

        first = asyncio.run(processor.process_event({"Token": "sync-token", "OpenKfId": "kf"}, ""))
        second = asyncio.run(processor.process_event({"Token": "sync-token", "OpenKfId": "kf"}, ""))

        self.assertEqual(1, first)
        self.assertEqual(0, second)
        self.assertEqual([{"touser": "user1", "open_kfid": "kf", "content": "目前只支持文字输入"}], client.sent)
        self.assertEqual([], orchestrator.calls)
        _remove_sqlite_files(database_path)

    def test_concurrent_duplicate_callback_sends_one_reply(self) -> None:
        database_path = Path("tmp") / "wechat-kf-concurrent.db"
        _remove_sqlite_files(database_path)
        _, processor, client, orchestrator, conversation = _processor(
            database_path,
            orchestrator=SlowFakeOrchestrator(),
        )
        conversation.save_binding(
            wecom_userid=actor_id("kf", "user1"),
            username="alice",
            access_token="token",
            user={"username": "alice"},
        )

        async def run_duplicate_callbacks() -> list[int]:
            return list(
                await asyncio.gather(
                    processor.process_event({"Token": "sync-token", "OpenKfId": "kf"}, ""),
                    processor.process_event({"Token": "sync-token", "OpenKfId": "kf"}, ""),
                )
            )

        sent_counts = asyncio.run(run_duplicate_callbacks())

        self.assertEqual(1, sum(sent_counts))
        self.assertEqual(1, len(client.sent))
        self.assertEqual(1, len(orchestrator.calls))
        _remove_sqlite_files(database_path)

    def test_unbound_user_gets_web_bind_link(self) -> None:
        database_path = Path("tmp") / "wechat-kf-bind-link.db"
        _remove_sqlite_files(database_path)
        _, processor, client, orchestrator, _ = _processor(database_path)

        sent_count = asyncio.run(processor.process_event({"Token": "sync-token"}, "https://host"))

        self.assertEqual(1, sent_count)
        self.assertIn("请打开下面的链接", client.sent[0]["content"])
        self.assertIn("https://example.test/wechat/kf/bind/", client.sent[0]["content"])
        self.assertEqual([], orchestrator.calls)
        _remove_sqlite_files(database_path)

    def test_bind_store_token_expires_and_can_be_used(self) -> None:
        database_path = Path("tmp") / "wechat-kf-token.db"
        _remove_sqlite_files(database_path)
        store = WechatKfBindStore(database_path, ttl_seconds=60)
        store.init()

        token = store.create("actor")
        active = store.get_active(token.state)
        store.mark_used(token.state)

        self.assertEqual("actor", active.actor_id)
        self.assertIsNone(store.get_active(token.state))
        _remove_sqlite_files(database_path)

    def test_rate_limit_replies_without_calling_orchestrator(self) -> None:
        database_path = Path("tmp") / "wechat-kf-rate-limit.db"
        _remove_sqlite_files(database_path)
        _, processor, client, orchestrator, conversation = _processor(database_path)
        conversation.save_binding(
            wecom_userid=actor_id("kf", "user1"),
            username="alice",
            access_token="token",
            user={"username": "alice"},
        )
        client.messages = [_customer_text(f"m{index}", f"查询乙醇库存{index}") for index in range(1, 5)]

        sent_count = asyncio.run(processor.process_event({"Token": "sync-token", "OpenKfId": "kf"}, ""))

        self.assertEqual(4, sent_count)
        self.assertEqual(3, len(orchestrator.calls))
        self.assertIn("请求太频繁", client.sent[-1]["content"])
        _remove_sqlite_files(database_path)

    def test_callback_body_accepts_json_and_xml_encrypt(self) -> None:
        self.assertEqual("abc", _extract_encrypted_body(b'{"encrypt":"abc"}'))
        self.assertEqual("abc", _extract_encrypted_body(b"<xml><Encrypt>abc</Encrypt></xml>"))

    def test_parse_xml_plaintext_event(self) -> None:
        event = _parse_plaintext(
            "<xml><MsgType>event</MsgType><Event>kf_msg_or_event</Event><Token>t</Token></xml>"
        )

        self.assertEqual("kf_msg_or_event", event["Event"])
        self.assertEqual("t", event["Token"])

    def test_callback_cipher_round_trip_with_xml_plaintext(self) -> None:
        cipher = WecomAesCipher(
            token="token",
            encoding_aes_key=_test_encoding_aes_key(),
            receive_id="corp",
        )
        encrypted = cipher.encrypt_payload(
            {"Event": "kf_msg_or_event", "Token": "sync-token"},
            timestamp="1",
            nonce="n",
        )
        plaintext = cipher.decrypt_plaintext(encrypted["encrypt"])

        self.assertEqual({"Event": "kf_msg_or_event", "Token": "sync-token"}, _parse_plaintext(plaintext))

    def test_bind_form_uses_system_login_visual_structure(self) -> None:
        page = bind_form_html("state-1", "用户名或密码错误")

        self.assertIn("实验室库存管理系统", page)
        self.assertIn("绑定微信客服账号", page)
        self.assertIn('class="login-shell"', page)
        self.assertIn('class="login-card"', page)
        self.assertIn('action="/wechat/kf/bind/state-1"', page)
        self.assertIn("用户名或密码错误", page)

    def test_bind_pages_escape_user_content(self) -> None:
        form_page = bind_form_html('bad"><script>', "<script>alert(1)</script>")
        success_page = bind_success_html({"full_name": "<b>Alice</b>"}, "alice")

        self.assertIn("bad&quot;&gt;&lt;script&gt;", form_page)
        self.assertIn("&lt;script&gt;alert(1)&lt;/script&gt;", form_page)
        self.assertIn("&lt;b&gt;Alice&lt;/b&gt;", success_page)
        self.assertNotIn("<script>alert(1)</script>", form_page)


def _customer_text(msgid: str, content: str) -> dict[str, Any]:
    return {
        "msgid": msgid,
        "origin": 3,
        "msgtype": "text",
        "open_kfid": "kf",
        "external_userid": "user1",
        "text": {"content": content},
    }


def _customer_image(msgid: str) -> dict[str, Any]:
    return {
        "msgid": msgid,
        "origin": 3,
        "msgtype": "image",
        "open_kfid": "kf",
        "external_userid": "user1",
        "image": {"media_id": "media-1"},
    }


def _processor(
    database_path: Path,
    *,
    orchestrator: FakeOrchestrator | None = None,
) -> tuple[
    WechatKfSettings,
    WechatKfMessageProcessor,
    FakeWechatKfClient,
    FakeOrchestrator,
    WecomConversationStore,
]:
    settings = WechatKfSettings(
        corp_id="corp",
        secret="secret",
        token="token",
        encoding_aes_key=_test_encoding_aes_key(),
        open_kfid="kf",
        state_db=database_path,
        bind_base_url="https://example.test",
        _env_file=None,
    )
    conversation = WecomConversationStore(database_path)
    processed = ProcessedMessageStore(database_path)
    bind_store = WechatKfBindStore(database_path, ttl_seconds=600)
    rate_limiter = WechatKfRateLimiter(database_path, max_messages=3, window_seconds=10)
    conversation.init()
    processed.init()
    bind_store.init()
    rate_limiter.init()
    client = FakeWechatKfClient([_customer_text("m1", "乙醇在哪里")])
    orchestrator = orchestrator or FakeOrchestrator()
    processor = WechatKfMessageProcessor(
        settings=settings,
        client=client,
        orchestrator=orchestrator,
        conversation_store=conversation,
        processed_store=processed,
        bind_store=bind_store,
        rate_limiter=rate_limiter,
    )
    return settings, processor, client, orchestrator, conversation


if __name__ == "__main__":
    unittest.main()
