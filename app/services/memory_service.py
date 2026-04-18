"""Memory and chat persistence service."""

from __future__ import annotations

from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import ChatMessage, ChatSession, UserMemory, WechatUser
from app.services.llm_service import LLMService


class MemoryService:
    def __init__(self, db: Session, llm_service: LLMService) -> None:
        self.db = db
        self.llm_service = llm_service

    def get_or_create_user(self, openid: str) -> WechatUser:
        user = self.db.scalar(select(WechatUser).where(WechatUser.openid == openid))
        if user:
            return user

        user = WechatUser(openid=openid, subscribe_status="subscribed")
        self.db.add(user)
        self.db.flush()
        memory = UserMemory(
            user_id=user.id,
            profile_json={},
            preference_json={
                "preferred_language": "zh-CN",
                "tone": "concise",
                "frequent_topics": [],
                "lab_or_project": None,
            },
            summary_text="",
        )
        self.db.add(memory)
        self.db.flush()
        return user

    def get_or_create_active_session(self, user_id: int) -> ChatSession:
        session = self.db.scalar(
            select(ChatSession).where(ChatSession.user_id == user_id, ChatSession.status == "active").order_by(desc(ChatSession.id))
        )
        if session:
            return session
        session = ChatSession(user_id=user_id, status="active")
        self.db.add(session)
        self.db.flush()
        return session

    def get_memory(self, user_id: int) -> UserMemory:
        memory = self.db.get(UserMemory, user_id)
        if memory is None:
            memory = UserMemory(user_id=user_id, profile_json={}, preference_json={}, summary_text="")
            self.db.add(memory)
            self.db.flush()
        return memory

    def fetch_recent_messages(self, user_id: int, limit: int | None = None) -> list[ChatMessage]:
        actual_limit = limit or settings.memory_window_size * 2
        stmt = (
            select(ChatMessage)
            .where(ChatMessage.user_id == user_id)
            .order_by(desc(ChatMessage.id))
            .limit(actual_limit)
        )
        return list(reversed(self.db.scalars(stmt).all()))

    def save_message(self, session_id: int, user_id: int, role: str, content: str, source: str = "wechat", wechat_msg_id: str | None = None) -> ChatMessage:
        message = ChatMessage(
            session_id=session_id,
            user_id=user_id,
            role=role,
            content=content,
            source=source,
            wechat_msg_id=wechat_msg_id,
        )
        self.db.add(message)
        self.db.flush()
        return message

    async def maybe_update_summary(self, user_id: int) -> None:
        messages = self.fetch_recent_messages(user_id, limit=200)
        if len(messages) < settings.memory_summary_trigger_count:
            return
        if len(messages) % settings.memory_summary_trigger_count != 0:
            return

        memory = self.get_memory(user_id)
        history = [{"role": m.role, "content": m.content} for m in messages]
        summary = await self.llm_service.summarize_memory(history, memory.summary_text)
        memory.summary_text = summary
        frequent_topics = memory.preference_json.get("frequent_topics", []) if memory.preference_json else []
        memory.preference_json = {
            "preferred_language": "zh-CN",
            "tone": "concise",
            "frequent_topics": frequent_topics,
            "lab_or_project": memory.preference_json.get("lab_or_project") if memory.preference_json else None,
        }
        self.db.add(memory)
        self.db.flush()
