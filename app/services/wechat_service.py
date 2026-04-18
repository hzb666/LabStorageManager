"""WeChat message handling service."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.models import ProcessedWechatEvent
from app.schemas.wechat import WechatMessage
from app.services.llm_service import LLMService, LLMTimeoutError
from app.services.memory_service import MemoryService
from app.services.reply_service import build_history_context, build_system_prompt

logger = logging.getLogger(__name__)


class WechatService:
    def __init__(self, db: Session, llm_service: LLMService | None = None) -> None:
        self.db = db
        self.llm_service = llm_service or LLMService()
        self.memory_service = MemoryService(db, self.llm_service)

    def _dedupe_key(self, message: WechatMessage) -> str:
        if message.msg_id:
            return f"msg:{message.msg_id}"
        if message.msg_type == "event":
            return f"event:{message.from_user_name}:{message.create_time}:{message.event or ''}"
        return f"fallback:{message.from_user_name}:{message.create_time}:{message.msg_type}"

    def mark_processed(self, message: WechatMessage) -> bool:
        key = self._dedupe_key(message)
        event = ProcessedWechatEvent(dedupe_key=key, openid=message.from_user_name, msg_type=message.msg_type)
        self.db.add(event)
        try:
            self.db.flush()
            return True
        except IntegrityError:
            self.db.rollback()
            logger.info("duplicate wechat event ignored key=%s", key)
            return False

    async def handle_message(self, message: WechatMessage) -> str:
        if not self.mark_processed(message):
            return "这条消息我已经处理过了。"

        user = self.memory_service.get_or_create_user(message.from_user_name)
        user.last_seen_at = datetime.now(timezone.utc)
        session = self.memory_service.get_or_create_active_session(user.id)

        if message.msg_type == "event":
            return self._handle_event(message, user.id)
        if message.msg_type != "text":
            return "目前我先支持文本消息，我们可以先文字聊聊。"

        content = (message.content or "").strip()
        self.memory_service.save_message(
            session_id=session.id,
            user_id=user.id,
            role="user",
            content=content,
            source="wechat",
            wechat_msg_id=message.msg_id,
        )

        memory = self.memory_service.get_memory(user.id)
        recent = self.memory_service.fetch_recent_messages(user.id)
        history = build_history_context(recent[-20:])

        try:
            answer = await self.llm_service.generate_reply(
                system_prompt=build_system_prompt(memory),
                summary=memory.summary_text,
                history=history,
                user_input=content,
            )
        except LLMTimeoutError:
            answer = "已收到，我稍后继续处理。"

        self.memory_service.save_message(
            session_id=session.id,
            user_id=user.id,
            role="assistant",
            content=answer,
            source="wechat",
        )
        await self.memory_service.maybe_update_summary(user.id)
        self.db.add(user)
        self.db.commit()
        return answer

    def _handle_event(self, message: WechatMessage, user_id: int) -> str:
        event = (message.event or "").lower()
        user = self.memory_service.get_or_create_user(message.from_user_name)
        if event == "subscribe":
            user.subscribe_status = "subscribed"
            self.db.add(user)
            self.db.commit()
            return "欢迎关注实验室助手公众号，我们开始聊天吧。"
        if event == "unsubscribe":
            user.subscribe_status = "unsubscribed"
            self.db.add(user)
            self.db.commit()
            return ""
        if event == "click":
            self.memory_service.save_message(
                session_id=self.memory_service.get_or_create_active_session(user_id).id,
                user_id=user_id,
                role="system",
                content=f"菜单点击: {message.event_key or ''}",
                source="wechat",
            )
            self.db.commit()
            return "已收到你的菜单操作。"
        self.db.commit()
        return "事件已收到。"
