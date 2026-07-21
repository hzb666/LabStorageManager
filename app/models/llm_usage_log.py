"""Durable token usage records for external LLM calls."""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import Index
from sqlmodel import Field, SQLModel

from app.core.time_utils import get_utc_now


class LLMUsageLog(SQLModel, table=True):
    """Record billable token counts without storing prompts or responses."""

    __tablename__ = "llm_usage_log"
    __table_args__ = (
        Index("ix_llm_usage_log_created_at", "created_at"),
        Index("ix_llm_usage_log_user_created_at", "user_id", "created_at"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: Optional[int] = Field(
        default=None,
        foreign_key="users.id",
        ondelete="SET NULL",
    )
    feature: str = Field(max_length=50)
    provider: str = Field(max_length=50)
    model: str = Field(max_length=100)
    attempt: int = Field(ge=1)
    input_tokens: Optional[int] = Field(default=None, ge=0)
    output_tokens: Optional[int] = Field(default=None, ge=0)
    total_tokens: Optional[int] = Field(default=None, ge=0)
    created_at: datetime = Field(default_factory=get_utc_now)
