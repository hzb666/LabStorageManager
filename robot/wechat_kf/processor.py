"""Wechat customer service message processing."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
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
from robot.wecom_aibot.intent_utils import BIND_PATTERN, is_help_request, is_unbind_request
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
        self._latest_message_keys: dict[str, str] = {}
        self._pending_messages: dict[str, list[dict[str, Any]]] = {}
        self._inflight_messages: dict[str, tuple[str, list[dict[str, Any]]]] = {}

    async def process_event(self, event: dict[str, Any], base_url: str) -> int:
        token = _first_text(event, "Token", "token")
        if not token:
            logger.warning("wechat_kf_callback_missing_token")
            return 0
        cursor = ""
        synced_messages: list[dict[str, Any]] = []
        open_kfid = _first_text(event, "OpenKfId", "open_kfid") or self.settings.open_kfid
        for _ in range(self.settings.sync_max_pages):
            data = await self.client.sync_msg(
                token=token,
                cursor=cursor,
                open_kfid=open_kfid,
                limit=self.settings.sync_limit,
            )
            messages = data.get("msg_list")
            if isinstance(messages, list):
                synced_messages.extend(message for message in messages if isinstance(message, dict))
            logger.info(
                "wechat_kf_sync_page open_kfid=%s msg_count=%d has_more=%s",
                _safe_id(open_kfid),
                len(messages) if isinstance(messages, list) else 0,
                bool(data.get("has_more")),
            )
            if not data.get("has_more"):
                break
            cursor = str(data.get("next_cursor") or "")
            if not cursor:
                break
        return await self._process_messages(synced_messages, base_url)

    async def _process_messages(self, messages: Any, base_url: str) -> int:
        if not isinstance(messages, list):
            return 0
        sent_count = 0
        for message_group in _customer_message_groups(messages):
            if await self._process_customer_messages(message_group, base_url):
                sent_count += 1
        return sent_count

    async def _process_customer_messages(
        self,
        messages: list[dict[str, Any]],
        base_url: str,
    ) -> bool:
        if not messages:
            return False
        target_message = _reply_message(messages)
        target_key = _message_key(target_message)
        actor = _message_actor(target_message)
        if not self._remember_pending_messages(actor, messages, target_key):
            logger.info("wechat_kf_duplicate_message msgid=%s", _safe_id(target_key))
            return False
        if self.settings.reply_debounce_seconds > 0:
            await asyncio.sleep(self.settings.reply_debounce_seconds)
        if self._latest_message_keys.get(actor) != target_key:
            logger.info("wechat_kf_message_superseded msgid=%s", _safe_id(target_key))
            return False
        reply_messages = self._drain_pending_messages(actor)
        if not reply_messages:
            return False
        reply_message = _reply_message(reply_messages)
        reply_key = _message_key(reply_message)
        self._mark_skipped_messages(reply_messages, keep_key=reply_key)
        self._activate_inflight_messages(actor, reply_key, reply_messages)
        try:
            return await self._process_message(reply_message, base_url)
        finally:
            self._clear_inflight_messages(actor, reply_key)

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
        allowed, rate_limit_reservation = self._reserve_rate_limit(message)
        try:
            if not allowed:
                answer = "请求太频繁，请稍后再试。"
                if self._message_superseded(message):
                    self._save_superseded_message(msgid)
                    return False
                await self._send_answer(message, answer)
                self.processed_store.save_response(msgid, text_reply(answer))
                logger.info("wechat_kf_rate_limited msgid=%s", _safe_id(msgid))
                return True
            payload = to_orchestrator_payload(message)
            answer, should_remember = await self._answer_payload(payload, base_url)
            if self._message_superseded(message):
                self._release_rate_limit(rate_limit_reservation)
                self._save_superseded_message(msgid)
                return False
            await self._send_answer(message, answer)
            if should_remember:
                self.orchestrator.remember_context_turn(
                    text=payload["text"]["content"],
                    payload=payload,
                    reply=answer,
                )
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

    def _remember_pending_messages(
        self,
        actor: str,
        messages: list[dict[str, Any]],
        target_key: str,
    ) -> bool:
        pending = self._pending_messages.setdefault(actor, [])
        pending_keys = {_message_key(message) for message in pending}
        inflight = self._inflight_messages.get(actor)
        if inflight is not None:
            inflight_key, inflight_messages = inflight
            if target_key == inflight_key:
                return False
            for message in inflight_messages:
                msgid = _message_key(message)
                if msgid not in pending_keys:
                    pending.append(message)
                    pending_keys.add(msgid)
        if target_key in pending_keys or self.processed_store.get_response(target_key) is not None:
            return False
        for message in messages:
            msgid = _message_key(message)
            if msgid in pending_keys or self.processed_store.get_response(msgid) is not None:
                continue
            pending.append(message)
            pending_keys.add(msgid)
        self._latest_message_keys[actor] = target_key
        return True

    def _drain_pending_messages(self, actor: str) -> list[dict[str, Any]]:
        messages = self._pending_messages.pop(actor, [])
        return _ordered_messages(messages)

    def _mark_skipped_messages(self, messages: list[dict[str, Any]], *, keep_key: str) -> None:
        for message in messages:
            if _message_key(message) != keep_key:
                self._mark_message_skipped(message)

    def _mark_message_skipped(self, message: dict[str, Any]) -> None:
        msgid = _message_key(message)
        if not self.processed_store.claim_response(msgid):
            logger.info("wechat_kf_duplicate_message msgid=%s", _safe_id(msgid))
            return
        self.processed_store.save_response(msgid, {"status": "skipped_batch_message"})
        logger.info("wechat_kf_batch_message_skipped msgid=%s", _safe_id(msgid))

    def _activate_inflight_messages(
        self,
        actor: str,
        reply_key: str,
        messages: list[dict[str, Any]],
    ) -> None:
        self._inflight_messages[actor] = (reply_key, messages)

    def _clear_inflight_messages(self, actor: str, reply_key: str) -> None:
        inflight = self._inflight_messages.get(actor)
        if inflight is not None and inflight[0] == reply_key:
            self._inflight_messages.pop(actor, None)

    def _message_superseded(self, message: dict[str, Any]) -> bool:
        return self._latest_message_keys.get(_message_actor(message)) != _message_key(message)

    def _save_superseded_message(self, msgid: str) -> None:
        self.processed_store.save_response(msgid, {"status": "superseded_message"})
        logger.info("wechat_kf_message_superseded_before_send msgid=%s", _safe_id(msgid))

    async def _answer_payload(self, payload: dict[str, Any], base_url: str) -> tuple[str, bool]:
        text = payload["text"]["content"].strip()
        actor = payload["from"]["userid"]
        if _should_force_bind_link(text, self.conversation_store.get_binding(actor)):
            return self._build_bind_link_text(actor, base_url), False
        answer = await self.orchestrator.answer(text=text, payload=payload, remember_context=False)
        return answer, True

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

    def _reserve_rate_limit(self, message: dict[str, Any]) -> tuple[bool, int | None]:
        if self.rate_limiter is None:
            return True, None
        actor = _message_actor(message)
        reservation = self.rate_limiter.reserve(actor)
        return reservation is not None, reservation

    def _release_rate_limit(self, reservation: int | None) -> None:
        if reservation is not None and self.rate_limiter is not None:
            self.rate_limiter.release(reservation)

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
    if text in {"绑定状态", "我的绑定"} or is_unbind_request(text):
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


def _customer_message_groups(messages: list[Any]) -> list[list[dict[str, Any]]]:
    groups: dict[str, list[dict[str, Any]]] = {}
    for message in messages:
        if isinstance(message, dict) and is_customer_message(message):
            groups.setdefault(_message_actor(message), []).append(message)
    return [_ordered_messages(group) for group in groups.values()]


def _reply_message(messages: list[dict[str, Any]]) -> dict[str, Any]:
    ordered_messages = _ordered_messages(messages)
    latest_message = ordered_messages[-1]
    if not is_customer_text_message(latest_message):
        return latest_message
    text_parts = [
        str(message["text"]["content"]).strip()
        for message in ordered_messages
        if is_customer_text_message(message) and str(message["text"]["content"]).strip()
    ]
    if not text_parts:
        return latest_message
    return {
        **latest_message,
        "text": {**latest_message["text"], "content": "\n".join(text_parts)},
    }


def _ordered_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    indexed_messages = list(enumerate(messages))
    indexed_messages.sort(key=lambda item: _message_order(item[1], item[0]))
    return [message for _, message in indexed_messages]


def _message_actor(message: dict[str, Any]) -> str:
    return actor_id(str(message["open_kfid"]), str(message["external_userid"]))


def _message_order(message: dict[str, Any], index: int) -> tuple[int, int]:
    value = message.get("send_time") or message.get("create_time") or message.get("msg_time")
    try:
        timestamp = int(value)
    except (TypeError, ValueError):
        timestamp = 0
    return timestamp, index


def _safe_id(value: str) -> str:
    if len(value) <= 10:
        return value
    return value[:6] + "..." + value[-4:]
