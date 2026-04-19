"""Application-level handler for WeCom intelligent robot payloads."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from robot.wecom_aibot.lsm_orchestrator import LSMRobotOrchestrator
from robot.wecom_aibot.messages import (
    UnsupportedWecomMessageError,
    is_enter_chat_event,
    parse_text_message,
)
from robot.wecom_aibot.replies import text_reply
from robot.wecom_aibot.store import ProcessedMessageStore

logger = logging.getLogger(__name__)


@dataclass
class WecomAibotHandler:
    orchestrator: LSMRobotOrchestrator
    store: ProcessedMessageStore
    welcome_text: str

    async def handle_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        if is_enter_chat_event(payload):
            return text_reply(self.welcome_text)

        try:
            message = parse_text_message(payload)
        except UnsupportedWecomMessageError:
            return text_reply("目前先支持文字查询。可以发送“查询乙醇库存”或“低库存”。")
        except ValueError:
            logger.warning("wecom_aibot_invalid_text_payload")
            return text_reply("消息格式不完整，请发送文字查询。")

        cached = self.store.get_response(message.msgid)
        if _is_complete_reply(cached):
            return cached
        if message.msgid and not self.store.claim_response(message.msgid):
            cached = self.store.get_response(message.msgid)
            if _is_complete_reply(cached):
                return cached
            return text_reply("正在处理，请稍后。")

        try:
            answer = await self.orchestrator.answer(text=message.content, payload=payload)
            response = text_reply(answer)
        except Exception:
            logger.exception("wecom_aibot_answer_failed msgid=%s", message.msgid)
            response = text_reply("查询失败，请稍后再试。")

        self.store.save_response(message.msgid, response)
        return response


def _is_complete_reply(response: dict[str, Any] | None) -> bool:
    if response is None:
        return False
    return response.get("status") != "processing"
