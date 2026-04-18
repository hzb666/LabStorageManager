"""WebSocket worker for Enterprise WeChat intelligent robot API mode."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from robot.wecom_aibot.config import get_settings
from robot.wecom_aibot.handler import WecomAibotHandler
from robot.wecom_aibot.inventory_answer import InventoryAnswerService
from robot.wecom_aibot.replies import text_reply
from robot.wecom_aibot.store import ProcessedMessageStore

logger = logging.getLogger(__name__)


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    settings = get_settings()
    settings.require_websocket()

    try:
        from wecom_aibot_sdk import WSClient, generate_req_id
    except ModuleNotFoundError as exc:
        raise RuntimeError("Install websocket SDK first: pip install wecom-aibot-sdk") from exc

    store = ProcessedMessageStore(settings.state_db)
    store.init()
    handler = WecomAibotHandler(
        answer_service=InventoryAnswerService(
            search_limit=settings.search_limit,
            low_stock_threshold=settings.low_stock_threshold,
        ),
        store=store,
        welcome_text=settings.welcome_text,
    )

    ws_client = WSClient(bot_id=settings.bot_id, secret=settings.secret, ws_url=settings.ws_url)

    async def on_text(frame: dict[str, Any]) -> None:
        stream_id = generate_req_id("lsm")
        await ws_client.reply_stream(frame, stream_id, "正在查询库存...", False)
        response = handler.handle_payload(frame.get("body", {}))
        await ws_client.reply_stream(frame, stream_id, _extract_text(response), True)

    async def on_enter_chat(frame: dict[str, Any]) -> None:
        await ws_client.reply_welcome(frame, text_reply(settings.welcome_text))

    ws_client.on("authenticated", lambda: logger.info("wecom_aibot_authenticated"))
    ws_client.on("message.text", on_text)
    ws_client.on("event.enter_chat", on_enter_chat)
    await ws_client.connect()
    await asyncio.Event().wait()


def _extract_text(response: dict[str, Any]) -> str:
    text = response.get("text")
    if isinstance(text, dict) and isinstance(text.get("content"), str):
        return text["content"]
    return "已收到。"

