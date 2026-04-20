"""Webhook server for WeChat customer service entry."""

from __future__ import annotations

import json
import logging
import xml.etree.ElementTree as ET
from contextlib import asynccontextmanager
from functools import lru_cache
from typing import Any

from fastapi import BackgroundTasks, FastAPI, Form, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, PlainTextResponse

from robot.wechat_kf.binding import WechatKfBindStore
from robot.wechat_kf.bind_pages import bind_form_html, bind_success_html
from robot.wechat_kf.client import WechatKfClient
from robot.wechat_kf.config import get_settings
from robot.wechat_kf.processor import WechatKfMessageProcessor
from robot.wechat_kf.rate_limit import WechatKfRateLimiter
from robot.wecom_aibot.config import get_settings as get_aibot_settings
from robot.wecom_aibot.conversation_store import WecomConversationStore
from robot.wecom_aibot.crypto import WecomAesCipher, WecomCryptoError, verify_signature
from robot.wecom_aibot.intent_utils import payload_data, result_ok
from robot.wecom_aibot.llm_planner import build_llm_planner
from robot.wecom_aibot.lsm_orchestrator import LSMRobotOrchestrator
from robot.wecom_aibot.mcp_client import LSMMcpClient
from robot.wecom_aibot.minimax_web_search import build_web_search_client
from robot.wecom_aibot.store import ProcessedMessageStore

logger = logging.getLogger(__name__)


@lru_cache
def get_conversation_store() -> WecomConversationStore:
    settings = get_settings()
    return WecomConversationStore(settings.state_db)


@lru_cache
def get_processed_store() -> ProcessedMessageStore:
    settings = get_settings()
    return ProcessedMessageStore(settings.state_db)


@lru_cache
def get_bind_store() -> WechatKfBindStore:
    settings = get_settings()
    return WechatKfBindStore(settings.state_db, settings.bind_token_ttl_minutes * 60)


@lru_cache
def get_rate_limiter() -> WechatKfRateLimiter:
    settings = get_settings()
    return WechatKfRateLimiter(
        settings.state_db,
        max_messages=settings.rate_limit_max_messages,
        window_seconds=settings.rate_limit_window_seconds,
    )


@lru_cache
def get_cipher() -> WecomAesCipher:
    settings = get_settings()
    return WecomAesCipher(
        token=settings.token,
        encoding_aes_key=settings.encoding_aes_key,
        receive_id=settings.callback_receive_id,
    )


@lru_cache
def get_mcp_client() -> LSMMcpClient:
    settings = get_aibot_settings()
    return LSMMcpClient(settings.mcp_url, read_timeout_seconds=settings.mcp_timeout_seconds)


@lru_cache
def get_client() -> WechatKfClient:
    settings = get_settings()
    settings.require_api()
    return WechatKfClient(
        corp_id=settings.corp_id,
        secret=settings.secret,
        api_base_url=settings.api_base_url,
    )


@lru_cache
def get_processor() -> WechatKfMessageProcessor:
    aibot_settings = get_aibot_settings()
    return WechatKfMessageProcessor(
        settings=get_settings(),
        client=get_client(),
        orchestrator=LSMRobotOrchestrator(
            mcp_client=get_mcp_client(),
            conversation_store=get_conversation_store(),
            llm_planner=build_llm_planner(aibot_settings),
            web_search_client=build_web_search_client(aibot_settings),
            search_limit=aibot_settings.search_limit,
        ),
        conversation_store=get_conversation_store(),
        processed_store=get_processed_store(),
        bind_store=get_bind_store(),
        rate_limiter=get_rate_limiter(),
    )


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings = get_settings()
    settings.require_webhook()
    get_processed_store().init()
    get_conversation_store().init()
    get_bind_store().init()
    get_rate_limiter().init()
    yield


app = FastAPI(title="LabStorageManager WeChat KF", lifespan=lifespan)


@app.get("/wechat/kf/callback", response_class=PlainTextResponse)
async def verify_callback_url(
    msg_signature: str = Query(...),
    timestamp: str = Query(...),
    nonce: str = Query(...),
    echostr: str = Query(...),
) -> str:
    try:
        return get_cipher().verify_url(msg_signature, timestamp, nonce, echostr)
    except WecomCryptoError as exc:
        logger.warning("wechat_kf_verify_url_failed reason=%s", exc)
        raise HTTPException(status_code=403, detail="Invalid WeChat KF signature") from exc


@app.post("/wechat/kf/callback", response_class=PlainTextResponse)
async def receive_callback(
    request: Request,
    background_tasks: BackgroundTasks,
    msg_signature: str = Query(...),
    timestamp: str = Query(...),
    nonce: str = Query(...),
) -> str:
    body = await _read_limited_body(request)
    encrypted = _extract_encrypted_body(body)
    try:
        event = _decrypt_callback(encrypted, msg_signature, timestamp, nonce)
    except WecomCryptoError as exc:
        logger.warning("wechat_kf_callback_crypto_failed reason=%s", exc)
        raise HTTPException(status_code=403, detail="Invalid WeChat KF signature") from exc
    except (json.JSONDecodeError, ET.ParseError, ValueError) as exc:
        logger.warning("wechat_kf_callback_parse_failed type=%s", type(exc).__name__)
        raise HTTPException(status_code=400, detail="Invalid WeChat KF callback payload") from exc
    if _event_name(event) == "kf_msg_or_event":
        background_tasks.add_task(_process_callback_event, event, _request_base_url(request))
    return "success"


@app.get("/wechat/kf/bind/{state}", response_class=HTMLResponse)
async def bind_form(state: str) -> str:
    token = get_bind_store().get_active(state)
    if token is None:
        raise HTTPException(status_code=404, detail="Binding link expired")
    return bind_form_html(state, "")


@app.post("/wechat/kf/bind/{state}", response_class=HTMLResponse)
async def submit_bind_form(
    state: str,
    username: str = Form(...),
    password: str = Form(...),
) -> str:
    token = get_bind_store().get_active(state)
    if token is None:
        raise HTTPException(status_code=404, detail="Binding link expired")
    clean_username = username.strip()
    result = await get_mcp_client().call_tool(
        "auth_login",
        {"username": clean_username, "password": password},
    )
    if not result_ok(result):
        return bind_form_html(state, _bind_error_message(result))
    data = payload_data(result)
    if not isinstance(data, dict) or not isinstance(data.get("access_token"), str):
        logger.warning("wechat_kf_bind_login_missing_token")
        return bind_form_html(state, "绑定失败，请稍后再试。")
    user = data.get("user") if isinstance(data.get("user"), dict) else {}
    get_conversation_store().save_binding(
        wecom_userid=token.actor_id,
        username=clean_username,
        access_token=data["access_token"],
        user=user,
    )
    get_bind_store().mark_used(state)
    return bind_success_html(user, clean_username)


def _bind_error_message(result: dict[str, Any]) -> str:
    code, message = _bind_error_fields(result)
    exit_code = _bind_exit_code(result)
    text = f"{code} {message}".lower()
    logger.info(
        "wechat_kf_bind_login_failed exit_code=%s code=%s",
        exit_code if exit_code is not None else "",
        code or "",
    )

    if code in {
        "CLI_TIMEOUT",
        "EMPTY_MCP_RESULT",
        "EMPTY_STDOUT",
        "INVALID_JSON_SHAPE",
        "INVALID_JSON_STDOUT",
        "NETWORK_ERROR",
    }:
        return "绑定服务暂时不可用，请稍后再试。"
    if exit_code == 5 or "too many login attempts" in text or "ip limit reached" in text:
        return "登录尝试过于频繁，请稍后再试。"
    if exit_code == 3 or "account is disabled" in text or "account_disabled" in text:
        return "账号已禁用或无权用于机器人绑定，请联系管理员。"
    if exit_code == 7 or "validation" in text:
        return "用户名或密码格式不符合要求。"
    if exit_code == 2 or "invalid credentials" in text:
        return "绑定失败，请检查用户名或密码。"
    return "绑定失败，请稍后再试。"


def _bind_error_fields(result: dict[str, Any]) -> tuple[str, str]:
    payload = result.get("payload")
    payload_error = payload.get("error") if isinstance(payload, dict) else None
    top_error = result.get("error")
    error = payload_error if isinstance(payload_error, dict) else top_error
    if not isinstance(error, dict):
        return "", ""

    code = error.get("code")
    message = error.get("message")
    detail = error.get("detail")
    if isinstance(detail, dict):
        detail_value = detail.get("detail")
        if isinstance(detail_value, str):
            message = f"{message or ''} {detail_value}".strip()
    if isinstance(detail, list):
        message = f"{message or ''} validation".strip()
    return (code if isinstance(code, str) else "", message if isinstance(message, str) else "")


def _bind_exit_code(result: dict[str, Any]) -> int | None:
    exit_code = result.get("exit_code")
    return exit_code if isinstance(exit_code, int) else None


async def _read_limited_body(request: Request) -> bytes:
    body = await request.body()
    if len(body) > get_settings().callback_max_body_bytes:
        raise HTTPException(status_code=413, detail="Callback body too large")
    return body


def _decrypt_callback(encrypted: str, signature: str, timestamp: str, nonce: str) -> dict[str, Any]:
    settings = get_settings()
    verify_signature(settings.token, signature, timestamp, nonce, encrypted)
    plaintext = get_cipher().decrypt_plaintext(encrypted)
    return _parse_plaintext(plaintext)


async def _process_callback_event(event: dict[str, Any], base_url: str) -> None:
    try:
        sent_count = await get_processor().process_event(event, base_url)
    except Exception:
        logger.exception("wechat_kf_process_event_failed")
        return
    logger.info("wechat_kf_callback_processed sent_count=%d", sent_count)


def _extract_encrypted_body(body: bytes) -> str:
    json_value = _extract_json_encrypt(body)
    if json_value:
        return json_value
    xml_value = _extract_xml_encrypt(body)
    if xml_value:
        return xml_value
    raise HTTPException(status_code=400, detail="Callback body must include Encrypt")


def _extract_json_encrypt(body: bytes) -> str:
    try:
        parsed = json.loads(body)
    except json.JSONDecodeError:
        return ""
    if isinstance(parsed, dict):
        value = parsed.get("encrypt") or parsed.get("Encrypt")
        return value if isinstance(value, str) else ""
    return ""


def _extract_xml_encrypt(body: bytes) -> str:
    try:
        root = ET.fromstring(body)
    except ET.ParseError:
        return ""
    value = root.findtext("Encrypt")
    return value.strip() if isinstance(value, str) else ""


def _parse_plaintext(plaintext: str) -> dict[str, Any]:
    text = plaintext.strip()
    if text.startswith("<"):
        return _xml_to_dict(ET.fromstring(text))
    parsed = json.loads(text)
    if not isinstance(parsed, dict):
        raise ValueError("decrypted callback must be a JSON object")
    return parsed


def _xml_to_dict(root: ET.Element) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    for child in root:
        if list(child):
            payload[child.tag] = _xml_to_dict(child)
        else:
            payload[child.tag] = child.text or ""
    return payload


def _event_name(event: dict[str, Any]) -> str:
    value = event.get("Event") or event.get("event")
    return value if isinstance(value, str) else ""


def _request_base_url(request: Request) -> str:
    return str(request.base_url).rstrip("/")
