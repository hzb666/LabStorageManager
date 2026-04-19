"""Wechat customer service message processing."""

from __future__ import annotations

import logging
import hashlib
import json
from typing import Any

from robot.wechat_kf.binding import WechatKfBindStore
from robot.wechat_kf.client import WechatKfApiError, WechatKfClient
from robot.wechat_kf.config import WechatKfSettings
from robot.wechat_kf.messages import (
    actor_id,
    is_customer_message,
    is_customer_text_message,
    to_orchestrator_payload,
)
from robot.wechat_kf.rate_limit import WechatKfRateLimiter
from robot.wecom_aibot.conversation_store import WecomConversationStore
from robot.wecom_aibot.intent_utils import BIND_PATTERN, is_help_request
from robot.wecom_aibot.lsm_orchestrator import LSMRobotOrchestrator
from robot.wecom_aibot.replies import text_reply
from robot.wecom_aibot.store import ProcessedMessageStore

logger = logging.getLogger(__name__)
UNSUPPORTED_MESSAGE_TEXT = "目前只支持文字输入"


class WechatKfMessageProcessor:
    """Syncs WeChat KF messages and replies through the LSM orchestrator."""

    def __init__(
        self,
        *,
        settings: WechatKfSettings,
        client: WechatKfClient,
        orchestrator: LSMRobotOrchestrator,
        conversation_store: WecomConversationStore,
        processed_store: ProcessedMessageStore,
        bind_store: WechatKfBindStore,
        rate_limiter: WechatKfRateLimiter | None = None,
    ) -> None:
        self.settings = settings
        self.client = client
        self.orchestrator = orchestrator
        self.conversation_store = conversation_store
        self.processed_store = processed_store
        self.bind_store = bind_store
        self.rate_limiter = rate_limiter

    async def process_event(self, event: dict[str, Any], base_url: str) -> int:
        token = _first_text(event, "Token", "token")
        if not token:
            logger.warning("wechat_kf_callback_missing_token")
            return 0
        cursor = ""
        sent_count = 0
        open_kfid = _first_text(event, "OpenKfId", "open_kfid") or self.settings.open_kfid
        for _ in range(self.settings.sync_max_pages):
            data = await self.client.sync_msg(
                token=token,
                cursor=cursor,
                open_kfid=open_kfid,
                limit=self.settings.sync_limit,
            )
            messages = data.get("msg_list")
            page_sent_count = await self._process_messages(messages, base_url)
            logger.info(
                "wechat_kf_sync_page open_kfid=%s msg_count=%d sent_count=%d has_more=%s",
                _safe_id(open_kfid),
                len(messages) if isinstance(messages, list) else 0,
                page_sent_count,
                bool(data.get("has_more")),
            )
            sent_count += page_sent_count
            if not data.get("has_more"):
                break
            cursor = str(data.get("next_cursor") or "")
            if not cursor:
                break
        return sent_count

    async def _process_messages(self, messages: Any, base_url: str) -> int:
        if not isinstance(messages, list):
            return 0
        sent_count = 0
        for message in messages:
            if isinstance(message, dict) and await self._process_message(message, base_url):
                sent_count += 1
        return sent_count

    async def _process_message(self, message: dict[str, Any], base_url: str) -> bool:
        if not is_customer_text_message(message):
            if is_customer_message(message):
                return await self._reply_unsupported_message(message)
            logger.info(
                "wechat_kf_skip_message msgid=%s origin=%s msgtype=%s",
                _safe_id(str(message.get("msgid") or "")),
                message.get("origin"),
                message.get("msgtype"),
            )
            return False
        msgid = _message_key(message)
        if not self.processed_store.claim_response(msgid):
            logger.info("wechat_kf_duplicate_message msgid=%s", _safe_id(msgid))
            return False
        try:
            if not self._allow_message(message):
                answer = "请求太频繁，请稍后再试。"
                await self._send_answer(message, answer)
                self.processed_store.save_response(msgid, text_reply(answer))
                logger.info("wechat_kf_rate_limited msgid=%s", _safe_id(msgid))
                return True
            payload = to_orchestrator_payload(message)
            answer = await self._answer_payload(payload, base_url)
            await self._send_answer(message, answer)
            self.processed_store.save_response(msgid, text_reply(answer))
            logger.info("wechat_kf_message_replied msgid=%s", _safe_id(msgid))
            return True
        except Exception:
            self.processed_store.release_response(msgid)
            raise

    async def _reply_unsupported_message(self, message: dict[str, Any]) -> bool:
        msgid = _message_key(message)
        if not self.processed_store.claim_response(msgid):
            logger.info("wechat_kf_duplicate_message msgid=%s", _safe_id(msgid))
            return False
        try:
            await self._send_answer(message, UNSUPPORTED_MESSAGE_TEXT)
            self.processed_store.save_response(msgid, text_reply(UNSUPPORTED_MESSAGE_TEXT))
            logger.info("wechat_kf_unsupported_message_replied msgid=%s", _safe_id(msgid))
            return True
        except Exception:
            self.processed_store.release_response(msgid)
            raise

    async def _answer_payload(self, payload: dict[str, Any], base_url: str) -> str:
        text = payload["text"]["content"].strip()
        actor = payload["from"]["userid"]
        if _should_force_bind_link(text, self.conversation_store.get_binding(actor)):
            return self._build_bind_link_text(actor, base_url)
        return await self.orchestrator.answer(text=text, payload=payload)

    async def _send_answer(self, message: dict[str, Any], answer: str) -> None:
        try:
            await self.client.send_text(
                touser=str(message["external_userid"]),
                open_kfid=str(message["open_kfid"]),
                content=answer,
            )
        except WechatKfApiError:
            logger.exception("wechat_kf_send_message_failed")
            raise

    def _allow_message(self, message: dict[str, Any]) -> bool:
        if self.rate_limiter is None:
            return True
        open_kfid = str(message["open_kfid"])
        external_userid = str(message["external_userid"])
        return self.rate_limiter.allow(actor_id(open_kfid, external_userid))

    def _build_bind_link_text(self, actor: str, base_url: str) -> str:
        bind_token = self.bind_store.create(actor)
        link = _bind_url(self.settings.bind_base_url or base_url, bind_token.state)
        return "\n".join(
            [
                "查询、借用和归还需要先绑定 LabStorageManager 账号。",
                "为保护密码，请打开下面的链接完成绑定：",
                link,
                f"链接 {self.settings.bind_token_ttl_minutes} 分钟内有效。",
            ]
        )


def _should_force_bind_link(text: str, binding: dict[str, Any] | None) -> bool:
    if text in {"绑定状态", "我的绑定", "解绑", "取消绑定"}:
        return False
    if is_help_request(text):
        return False
    return binding is None or bool(BIND_PATTERN.match(text))


def _bind_url(base_url: str, state: str) -> str:
    return base_url.rstrip("/") + f"/wechat/kf/bind/{state}"


def _first_text(payload: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _message_key(message: dict[str, Any]) -> str:
    msgid = str(message.get("msgid") or message.get("msg_id") or "").strip()
    if msgid:
        return msgid
    fingerprint = {
        "open_kfid": message.get("open_kfid"),
        "external_userid": message.get("external_userid"),
        "origin": message.get("origin"),
        "msgtype": message.get("msgtype"),
        "send_time": message.get("send_time") or message.get("create_time") or message.get("msg_time"),
        "text": message.get("text"),
    }
    raw = json.dumps(fingerprint, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return "wechat-kf:" + hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _safe_id(value: str) -> str:
    if len(value) <= 10:
        return value
    return value[:6] + "..." + value[-4:]
