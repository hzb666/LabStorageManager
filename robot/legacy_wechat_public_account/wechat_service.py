"""Wechat bot business logic."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass

from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.core.config import settings
from app.database import engine
from app.models.wechat import (
    CHAT_ROLE_ASSISTANT,
    CHAT_ROLE_USER,
    CHAT_SESSION_STATUS_ACTIVE,
    WECHAT_EVENT_SUBSCRIBE,
    WECHAT_EVENT_UNSUBSCRIBE,
    WECHAT_MSG_EVENT,
    WECHAT_MSG_TEXT,
    ProcessedWechatEvent,
    WechatChatMessage,
    WechatChatSession,
    WechatInboundMessage,
    WechatUser,
    WechatUserMemory,
)
from app.services.wechat_llm_service import DEFAULT_FALLBACK_REPLY, WechatLLMService

logger = logging.getLogger(__name__)

UNSUPPORTED_MESSAGE_REPLY = "暂时只支持文字消息。"
EMPTY_TEXT_REPLY = "请发送文字内容，我会尽量帮你处理。"
SUBSCRIBE_REPLY = "欢迎使用实验室库存助手。"
UNSUBSCRIBE_REPLY = ""


@dataclass(frozen=True)
class WechatHandleResult:
    reply_text: str
    schedule_memory_summary: bool = False
    memory_user_id: int | None = None


class WechatService:
    """Handles idempotent Wechat messages without holding DB locks during LLM calls."""

    def __init__(self, db: Session, llm_service: WechatLLMService | None = None) -> None:
        self.db = db
        self.llm_service = llm_service or WechatLLMService()

    async def handle_message(self, message: WechatInboundMessage) -> WechatHandleResult:
        event = self._begin_event(message)
        if event is None:
            return WechatHandleResult(reply_text=self._get_duplicate_reply(message))

        if message.msg_type == WECHAT_MSG_EVENT:
            return self._handle_event(message, event)
        if message.msg_type != WECHAT_MSG_TEXT:
            return self._finish_event(event, UNSUPPORTED_MESSAGE_REPLY)

        user_input = message.content.strip()
        if not user_input:
            return self._finish_event(event, EMPTY_TEXT_REPLY)

        user, session = self._ensure_user_session(message.from_user_name)
        memory = self._ensure_memory(user.id)
        self._save_message(session.id, user.id, CHAT_ROLE_USER, user_input, message.msg_id)
        self.db.commit()

        history = self._get_recent_history(session.id, exclude_wechat_msg_id=message.msg_id)
        reply = await self._generate_reply(memory.summary_text, history, user_input)
        self._save_message(session.id, user.id, CHAT_ROLE_ASSISTANT, reply, None)
        event.reply_text = reply
        self.db.add(event)
        self.db.commit()
        return WechatHandleResult(
            reply_text=reply,
            schedule_memory_summary=self._should_summarize(session.id),
            memory_user_id=user.id,
        )

    def _begin_event(self, message: WechatInboundMessage) -> ProcessedWechatEvent | None:
        event = ProcessedWechatEvent(
            dedupe_key=_build_dedupe_key(message),
            openid=message.from_user_name,
            msg_type=message.msg_type,
        )
        self.db.add(event)
        try:
            self.db.commit()
        except IntegrityError:
            self.db.rollback()
            return None
        self.db.refresh(event)
        return event

    def _get_duplicate_reply(self, message: WechatInboundMessage) -> str:
        event = self.db.exec(
            select(ProcessedWechatEvent).where(
                ProcessedWechatEvent.dedupe_key == _build_dedupe_key(message)
            )
        ).first()
        return event.reply_text if event and event.reply_text else ""

    def _handle_event(
        self,
        message: WechatInboundMessage,
        event: ProcessedWechatEvent,
    ) -> WechatHandleResult:
        normalized_event = (message.event or "").lower()
        user = self._ensure_user(message.from_user_name)
        if normalized_event == WECHAT_EVENT_UNSUBSCRIBE:
            user.subscribe_status = "unsubscribed"
            return self._finish_event(event, UNSUBSCRIBE_REPLY)
        user.subscribe_status = "subscribed"
        if normalized_event == WECHAT_EVENT_SUBSCRIBE:
            return self._finish_event(event, SUBSCRIBE_REPLY)
        return self._finish_event(event, "")

    def _finish_event(
        self,
        event: ProcessedWechatEvent,
        reply_text: str,
    ) -> WechatHandleResult:
        event.reply_text = reply_text
        self.db.add(event)
        self.db.commit()
        return WechatHandleResult(reply_text=reply_text)

    def _ensure_user_session(self, openid: str) -> tuple[WechatUser, WechatChatSession]:
        user = self._ensure_user(openid)
        statement = select(WechatChatSession).where(
            WechatChatSession.user_id == user.id,
            WechatChatSession.status == CHAT_SESSION_STATUS_ACTIVE,
        )
        session = self.db.exec(statement).first()
        if session:
            return user, session

        session = WechatChatSession(user_id=user.id)
        self.db.add(session)
        try:
            self.db.flush()
        except IntegrityError:
            self.db.rollback()
            return self._ensure_user_session(openid)
        return user, session

    def _ensure_user(self, openid: str) -> WechatUser:
        user = self.db.exec(select(WechatUser).where(WechatUser.openid == openid)).first()
        if user:
            return user

        user = WechatUser(openid=openid)
        self.db.add(user)
        try:
            self.db.flush()
        except IntegrityError:
            self.db.rollback()
            user = self.db.exec(select(WechatUser).where(WechatUser.openid == openid)).first()
            if user:
                return user
            raise
        return user

    def _ensure_memory(self, user_id: int | None) -> WechatUserMemory:
        if user_id is None:
            raise RuntimeError("Wechat user must be flushed before memory creation")
        memory = self.db.get(WechatUserMemory, user_id)
        if memory:
            return memory
        memory = WechatUserMemory(user_id=user_id)
        self.db.add(memory)
        self.db.flush()
        return memory

    def _save_message(
        self,
        session_id: int | None,
        user_id: int | None,
        role: str,
        content: str,
        wechat_msg_id: str | None,
    ) -> None:
        if session_id is None or user_id is None:
            raise RuntimeError("Wechat session and user must be flushed before saving messages")
        self.db.add(
            WechatChatMessage(
                session_id=session_id,
                user_id=user_id,
                role=role,
                content=content,
                wechat_msg_id=wechat_msg_id,
            )
        )

    def _get_recent_history(
        self,
        session_id: int | None,
        *,
        exclude_wechat_msg_id: str | None,
    ) -> list[dict[str, str]]:
        if session_id is None:
            return []
        conditions = [WechatChatMessage.session_id == session_id]
        if exclude_wechat_msg_id:
            conditions.append(
                or_(
                    WechatChatMessage.wechat_msg_id.is_(None),
                    WechatChatMessage.wechat_msg_id != exclude_wechat_msg_id,
                )
            )
        statement = (
            select(WechatChatMessage)
            .where(*conditions)
            .order_by(WechatChatMessage.created_at.desc(), WechatChatMessage.id.desc())
            .limit(settings.wechat_history_message_limit)
        )
        messages = list(reversed(self.db.exec(statement).all()))
        return [{"role": item.role, "content": item.content} for item in messages]

    async def _generate_reply(
        self,
        memory_summary: str,
        history: list[dict[str, str]],
        user_input: str,
    ) -> str:
        try:
            return await asyncio.wait_for(
                self.llm_service.generate_reply(
                    memory_summary=memory_summary,
                    history=history,
                    user_input=user_input,
                ),
                timeout=settings.wechat_passive_reply_timeout_seconds,
            )
        except asyncio.TimeoutError:
            logger.warning("Wechat reply generation exceeded passive reply budget")
            return DEFAULT_FALLBACK_REPLY

    def _should_summarize(self, session_id: int | None) -> bool:
        if session_id is None:
            return False
        count = self.db.exec(
            select(func.count()).select_from(WechatChatMessage).where(
                WechatChatMessage.session_id == session_id
            )
        ).one()
        return count % settings.wechat_memory_summary_every_messages == 0


def summarize_wechat_memory(user_id: int) -> None:
    """Background task entry point for memory summarization."""

    asyncio.run(_summarize_wechat_memory(user_id))


async def _summarize_wechat_memory(user_id: int) -> None:
    with Session(engine) as db:
        memory = db.get(WechatUserMemory, user_id)
        if memory is None:
            return
        messages = _load_recent_message_texts(db, user_id)
        summary = await WechatLLMService().summarize_memory(
            messages=messages,
            previous_summary=memory.summary_text,
        )
        memory.summary_text = summary
        db.add(memory)
        db.commit()


def _load_recent_message_texts(db: Session, user_id: int) -> list[str]:
    statement = (
        select(WechatChatMessage)
        .where(WechatChatMessage.user_id == user_id)
        .order_by(WechatChatMessage.created_at.desc(), WechatChatMessage.id.desc())
        .limit(settings.wechat_memory_history_limit)
    )
    messages = list(reversed(db.exec(statement).all()))
    return [f"{message.role}: {message.content}" for message in messages]


def _build_dedupe_key(message: WechatInboundMessage) -> str:
    if message.msg_id:
        return f"msg:{message.msg_id}"
    if message.msg_type == WECHAT_MSG_EVENT:
        event_key = message.event_key or ""
        return f"event:{message.from_user_name}:{message.create_time}:{message.event}:{event_key}"
    return (
        f"raw:{message.from_user_name}:{message.create_time}:"
        f"{message.msg_type}:{message.raw_payload_hash[:24]}"
    )
