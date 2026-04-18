from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, JSON, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class UserMemory(Base):
    __tablename__ = "user_memory"

    user_id: Mapped[int] = mapped_column(ForeignKey("wechat_users.id", ondelete="CASCADE"), primary_key=True)
    profile_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    preference_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    summary_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
