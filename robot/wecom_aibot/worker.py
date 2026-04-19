"""WebSocket worker for Enterprise WeChat intelligent robot API mode."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from robot.wecom_aibot.config import get_settings
from robot.wecom_aibot.conversation_store import WecomConversationStore
from robot.wecom_aibot.handler import WecomAibotHandler
from robot.wecom_aibot.llm_planner import build_llm_planner
from robot.wecom_aibot.lsm_orchestrator import LSMRobotOrchestrator
from robot.wecom_aibot.mcp_client import LSMMcpClient
from robot.wecom_aibot.minimax_web_search import build_web_search_client
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
    conversation_store = WecomConversationStore(settings.state_db)
    conversation_store.init()
    mcp_client = LSMMcpClient(settings.mcp_url, read_timeout_seconds=settings.mcp_timeout_seconds)
    handler = WecomAibotHandler(
        orchestrator=LSMRobotOrchestrator(
            mcp_client=mcp_client,
            conversation_store=conversation_store,
            llm_planner=build_llm_planner(settings),
            web_search_client=build_web_search_client(settings),
            search_limit=settings.search_limit,
        ),
        store=store,
        welcome_text=settings.welcome_text,
    )

    ws_client = WSClient(bot_id=settings.bot_id, secret=settings.secret, ws_url=settings.ws_url)

    async def on_text(frame: dict[str, Any]) -> None:
        stream_id = generate_req_id("lsm")
        await ws_client.reply_stream(frame, stream_id, "正在查询...", False)
        response = await handler.handle_payload(frame.get("body", {}))
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
