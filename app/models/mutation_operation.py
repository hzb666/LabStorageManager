"""可查询、可重放的写入凭据；不存储请求正文。"""
from datetime import datetime

from sqlalchemy import Column, Text
from sqlmodel import Field, SQLModel

from app.core.time_utils import get_utc_now


class MutationOperation(SQLModel, table=True):
    __tablename__ = "mutation_operation"

    user_id: int = Field(primary_key=True)
    operation_id: str = Field(primary_key=True, max_length=64)
    fingerprint: str = Field(max_length=64)
    state: str = Field(default="running", max_length=20)
    status_code: int | None = None
    response_body: str | None = Field(default=None, sa_column=Column(Text))
    response_headers: str = Field(default="{}", sa_column=Column(Text, nullable=False))
    created_at: datetime = Field(default_factory=get_utc_now, index=True)

