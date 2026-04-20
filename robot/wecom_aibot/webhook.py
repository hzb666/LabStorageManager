"""Webhook receiver for Enterprise WeChat intelligent robot API mode."""

from __future__ import annotations

import json
import logging
from contextlib import asynccontextmanager
from functools import lru_cache
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse, PlainTextResponse

from robot.wecom_aibot.config import get_settings
from robot.wecom_aibot.conversation_store import WecomConversationStore
from robot.wecom_aibot.crypto import WecomAesCipher, WecomCryptoError
from robot.wecom_aibot.handler import WecomAibotHandler
from robot.wecom_aibot.llm_planner import build_llm_planner
from robot.wecom_aibot.lsm_orchestrator import LSMRobotOrchestrator
from robot.wecom_aibot.mcp_client import LSMMcpClient
from robot.wecom_aibot.minimax_web_search import build_web_search_client
from robot.wecom_aibot.store import ProcessedMessageStore

logger = logging.getLogger(__name__)


@lru_cache
def get_store() -> ProcessedMessageStore:
    settings = get_settings()
    return ProcessedMessageStore(settings.state_db)


@lru_cache
def get_conversation_store() -> WecomConversationStore:
    settings = get_settings()
    return WecomConversationStore(settings.state_db, **settings.conversation_store_options())


@lru_cache
def get_cipher() -> WecomAesCipher:
    settings = get_settings()
    return WecomAesCipher(
        token=settings.token,
        encoding_aes_key=settings.encoding_aes_key,
        receive_id=settings.receive_id,
    )


@lru_cache
def get_handler() -> WecomAibotHandler:
    settings = get_settings()
    mcp_client = LSMMcpClient(settings.mcp_url, read_timeout_seconds=settings.mcp_timeout_seconds)
    return WecomAibotHandler(
        orchestrator=LSMRobotOrchestrator(
            mcp_client=mcp_client,
            conversation_store=get_conversation_store(),
            llm_planner=build_llm_planner(settings),
            web_search_client=build_web_search_client(settings),
            search_limit=settings.search_limit,
        ),
        store=get_store(),
        welcome_text=settings.welcome_text,
    )


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings = get_settings()
    settings.require_webhook()
    settings.require_token_storage()
    get_store().init()
    get_conversation_store().init()
    yield


app = FastAPI(title="LabStorageManager WeCom AI Bot", lifespan=lifespan)


@app.get("/wecom/aibot/callback", response_class=PlainTextResponse)
async def verify_callback_url(
    msg_signature: str = Query(...),
    timestamp: str = Query(...),
    nonce: str = Query(...),
    echostr: str = Query(...),
) -> str:
    try:
        return get_cipher().verify_url(msg_signature, timestamp, nonce, echostr)
    except WecomCryptoError as exc:
        logger.warning("wecom_aibot_verify_url_failed reason=%s", exc)
        raise HTTPException(status_code=403, detail="Invalid WeCom callback signature") from exc


@app.post("/wecom/aibot/callback")
async def receive_callback(
    request: Request,
    msg_signature: str = Query(...),
    timestamp: str = Query(...),
    nonce: str = Query(...),
) -> JSONResponse:
    settings = get_settings()
    body = await request.body()
    if len(body) > settings.callback_max_body_bytes:
        raise HTTPException(status_code=413, detail="Callback body too large")

    encrypted = _extract_encrypted_body(body)
    try:
        payload = get_cipher().decrypt_callback(
            encrypted,
            signature=msg_signature,
            timestamp=timestamp,
            nonce=nonce,
        )
        response = await get_handler().handle_payload(payload)
        encrypted_response = get_cipher().encrypt_payload(response)
    except WecomCryptoError as exc:
        logger.warning("wecom_aibot_callback_crypto_failed reason=%s", exc)
        raise HTTPException(status_code=403, detail="Invalid WeCom callback signature") from exc

    return JSONResponse(encrypted_response)


def _extract_encrypted_body(body: bytes) -> str:
    try:
        parsed: Any = json.loads(body)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Callback body must be JSON") from exc

    if not isinstance(parsed, dict) or not isinstance(parsed.get("encrypt"), str):
        raise HTTPException(status_code=400, detail="Callback JSON must include encrypt")
    return parsed["encrypt"]
