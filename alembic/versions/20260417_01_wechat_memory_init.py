"""create wechat memory tables

Revision ID: 20260417_01
Revises: 
Create Date: 2026-04-17
"""

from alembic import op
import sqlalchemy as sa


revision = "20260417_01"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "wechat_users",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("openid", sa.String(length=128), nullable=False),
        sa.Column("unionid", sa.String(length=128), nullable=True),
        sa.Column("nickname", sa.String(length=255), nullable=True),
        sa.Column("subscribe_status", sa.String(length=32), nullable=False, server_default="subscribed"),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("raw_profile_json", sa.Text(), nullable=True),
        sa.UniqueConstraint("openid"),
    )
    op.create_index("ix_wechat_users_openid", "wechat_users", ["openid"])

    op.create_table(
        "chat_sessions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("wechat_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_chat_sessions_user_id", "chat_sessions", ["user_id"])

    op.create_table(
        "chat_messages",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("session_id", sa.Integer(), sa.ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("wechat_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.String(length=32), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False, server_default="wechat"),
        sa.Column("wechat_msg_id", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_chat_messages_session_id", "chat_messages", ["session_id"])
    op.create_index("ix_chat_messages_user_id", "chat_messages", ["user_id"])
    op.create_index("ix_chat_messages_wechat_msg_id", "chat_messages", ["wechat_msg_id"])

    op.create_table(
        "user_memory",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("wechat_users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("profile_json", sa.JSON(), nullable=False),
        sa.Column("preference_json", sa.JSON(), nullable=False),
        sa.Column("summary_text", sa.Text(), nullable=False, server_default=""),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "processed_wechat_events",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("dedupe_key", sa.String(length=255), nullable=False),
        sa.Column("openid", sa.String(length=128), nullable=False),
        sa.Column("msg_type", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("dedupe_key"),
    )
    op.create_index("ix_processed_wechat_events_dedupe_key", "processed_wechat_events", ["dedupe_key"])
    op.create_index("ix_processed_wechat_events_openid", "processed_wechat_events", ["openid"])


def downgrade() -> None:
    op.drop_index("ix_processed_wechat_events_openid", table_name="processed_wechat_events")
    op.drop_index("ix_processed_wechat_events_dedupe_key", table_name="processed_wechat_events")
    op.drop_table("processed_wechat_events")
    op.drop_table("user_memory")
    op.drop_index("ix_chat_messages_wechat_msg_id", table_name="chat_messages")
    op.drop_index("ix_chat_messages_user_id", table_name="chat_messages")
    op.drop_index("ix_chat_messages_session_id", table_name="chat_messages")
    op.drop_table("chat_messages")
    op.drop_index("ix_chat_sessions_user_id", table_name="chat_sessions")
    op.drop_table("chat_sessions")
    op.drop_index("ix_wechat_users_openid", table_name="wechat_users")
    op.drop_table("wechat_users")
