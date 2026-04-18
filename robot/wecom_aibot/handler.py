"""Application-level handler for WeCom intelligent robot payloads."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from robot.wecom_aibot.inventory_answer import InventoryAnswerService
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
    answer_service: InventoryAnswerService
    store: ProcessedMessageStore
    welcome_text: str

    def handle_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        if is_enter_chat_event(payload):
            return text_reply(self.welcome_text)

        try:
            message = parse_text_message(payload)
        except UnsupportedWecomMessageError:
            return text_reply("目前先支持文字查询。可以发送“查询乙醇库存”或“低库存”。")

        cached = self.store.get_response(message.msgid)
        if cached is not None:
            return cached

        try:
            response = text_reply(self.answer_service.answer(message.content))
        except Exception:
            logger.exception("wecom_aibot_inventory_answer_failed msgid=%s", message.msgid)
            response = text_reply("库存查询失败，请稍后再试。")

        self.store.save_response(message.msgid, response)
        return response

