"""Wechat customer service message processing."""

from __future__ import annotations

import logging
from typing import Any

from robot.wechat_kf.binding import WechatKfBindStore
from robot.wechat_kf.client import WechatKfApiError, WechatKfClient
from robot.wechat_kf.config import WechatKfSettings
from robot.wechat_kf.messages import is_customer_text_message, to_orchestrator_payload
from robot.wecom_aibot.conversation_store import WecomConversationStore
from robot.wecom_aibot.intent_utils import BIND_PATTERN, HELP_KEYWORDS, has_any
from robot.wecom_aibot.lsm_orchestrator import LSMRobotOrchestrator
from robot.wecom_aibot.replies import text_reply
from robot.wecom_aibot.store import ProcessedMessageStore

logger = logging.getLogger(__name__)


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
    ) -> None:
        self.settings = settings
        self.client = client
        self.orchestrator = orchestrator
        self.conversation_store = conversation_store
        self.processed_store = processed_store
        self.bind_store = bind_store

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
            sent_count += await self._process_messages(data.get("msg_list"), base_url)
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
            return False
        msgid = str(message.get("msgid") or "")
        if self.processed_store.get_response(msgid) is not None:
            return False
        payload = to_orchestrator_payload(message)
        answer = await self._answer_payload(payload, base_url)
        await self._send_answer(message, answer)
        self.processed_store.save_response(msgid, text_reply(answer))
        return True

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
    if has_any(text, HELP_KEYWORDS):
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
