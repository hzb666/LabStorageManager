"""Persistent bindings and short conversation state for the WeCom robot."""

from __future__ import annotations

import json
import sqlite3
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

CONTEXT_MAX_TURNS = 5
CONTEXT_TTL_HOURS = 2
CONTEXT_TEXT_LIMIT = 1200


class WecomConversationStore:
    """Stores user bindings and pending confirmation state."""

    def __init__(self, database_path: Path) -> None:
        self.database_path = database_path

    def init(self) -> None:
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        with closing(self._connect()) as connection:
            with connection:
                connection.execute("PRAGMA journal_mode=WAL;")
                connection.execute(
                    """
                    CREATE TABLE IF NOT EXISTS wecom_aibot_user_binding (
                        wecom_userid TEXT PRIMARY KEY,
                        lsm_username TEXT NOT NULL,
                        lsm_user_json TEXT,
                        lsm_access_token TEXT NOT NULL,
                        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                    )
                    """
                )
                connection.execute(
                    """
                    CREATE TABLE IF NOT EXISTS wecom_aibot_conversation_state (
                        chat_key TEXT PRIMARY KEY,
                        state_json TEXT NOT NULL,
                        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                    )
                    """
                )
                connection.execute(
                    """
                    CREATE TABLE IF NOT EXISTS wecom_aibot_conversation_context (
                        chat_key TEXT PRIMARY KEY,
                        context_json TEXT NOT NULL,
                        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                    )
                    """
                )
                connection.execute(
                    """
                    DELETE FROM wecom_aibot_conversation_context
                    WHERE updated_at < datetime('now', '-2 hours')
                    """
                )

    def get_binding(self, wecom_userid: str) -> dict[str, Any] | None:
        with closing(self._connect()) as connection:
            row = connection.execute(
                """
                SELECT lsm_username, lsm_user_json, lsm_access_token
                FROM wecom_aibot_user_binding
                WHERE wecom_userid = ?
                """,
                (wecom_userid,),
            ).fetchone()
        if row is None:
            return None
        user = json.loads(row[1]) if row[1] else {}
        return {"username": row[0], "user": user, "access_token": row[2]}

    def save_binding(
        self,
        *,
        wecom_userid: str,
        username: str,
        access_token: str,
        user: dict[str, Any] | None = None,
    ) -> None:
        user_json = json.dumps(user or {}, ensure_ascii=False, separators=(",", ":"))
        with closing(self._connect()) as connection:
            with connection:
                connection.execute(
                    """
                    INSERT INTO wecom_aibot_user_binding
                      (wecom_userid, lsm_username, lsm_user_json, lsm_access_token)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(wecom_userid) DO UPDATE SET
                      lsm_username = excluded.lsm_username,
                      lsm_user_json = excluded.lsm_user_json,
                      lsm_access_token = excluded.lsm_access_token,
                      updated_at = CURRENT_TIMESTAMP
                    """,
                    (wecom_userid, username, user_json, access_token),
                )

    def delete_binding(self, wecom_userid: str) -> None:
        with closing(self._connect()) as connection:
            with connection:
                connection.execute(
                    "DELETE FROM wecom_aibot_user_binding WHERE wecom_userid = ?",
                    (wecom_userid,),
                )

    def get_state(self, chat_key: str) -> dict[str, Any] | None:
        with closing(self._connect()) as connection:
            row = connection.execute(
                "SELECT state_json FROM wecom_aibot_conversation_state WHERE chat_key = ?",
                (chat_key,),
            ).fetchone()
        if row is None:
            return None
        payload = json.loads(row[0])
        return payload if isinstance(payload, dict) else None

    def save_state(self, chat_key: str, state: dict[str, Any]) -> None:
        state_json = json.dumps(state, ensure_ascii=False, separators=(",", ":"))
        with closing(self._connect()) as connection:
            with connection:
                connection.execute(
                    """
                    INSERT INTO wecom_aibot_conversation_state (chat_key, state_json)
                    VALUES (?, ?)
                    ON CONFLICT(chat_key) DO UPDATE SET
                      state_json = excluded.state_json,
                      updated_at = CURRENT_TIMESTAMP
                    """,
                    (chat_key, state_json),
                )

    def delete_state(self, chat_key: str) -> None:
        with closing(self._connect()) as connection:
            with connection:
                connection.execute(
                    "DELETE FROM wecom_aibot_conversation_state WHERE chat_key = ?",
                    (chat_key,),
                )

    def get_context(self, chat_key: str) -> list[dict[str, str]]:
        with closing(self._connect()) as connection:
            row = connection.execute(
                """
                SELECT context_json, updated_at
                FROM wecom_aibot_conversation_context
                WHERE chat_key = ?
                """,
                (chat_key,),
            ).fetchone()
        if row is None:
            return []
        if _context_expired(str(row[1])):
            self.delete_context(chat_key)
            return []
        try:
            payload = json.loads(row[0])
        except json.JSONDecodeError:
            self.delete_context(chat_key)
            return []
        if not isinstance(payload, list):
            self.delete_context(chat_key)
            return []
        return _normalize_context_turns(payload)

    def append_context_turn(self, chat_key: str, *, user_text: str, assistant_text: str) -> None:
        user_text = _trim_context_text(user_text)
        assistant_text = _trim_context_text(assistant_text)
        if not chat_key or not user_text or not assistant_text:
            return
        with closing(self._connect()) as connection:
            try:
                connection.execute("BEGIN IMMEDIATE")
                turns = _context_turns_from_row(
                    connection.execute(
                        """
                        SELECT context_json, updated_at
                        FROM wecom_aibot_conversation_context
                        WHERE chat_key = ?
                        """,
                        (chat_key,),
                    ).fetchone()
                )
                turns.append({"user": user_text, "assistant": assistant_text})
                context_json = json.dumps(
                    turns[-CONTEXT_MAX_TURNS:],
                    ensure_ascii=False,
                    separators=(",", ":"),
                )
                connection.execute(
                    """
                    INSERT INTO wecom_aibot_conversation_context (chat_key, context_json)
                    VALUES (?, ?)
                    ON CONFLICT(chat_key) DO UPDATE SET
                      context_json = excluded.context_json,
                      updated_at = CURRENT_TIMESTAMP
                    """,
                    (chat_key, context_json),
                )
                connection.commit()
            except Exception:
                connection.rollback()
                raise

    def save_context(self, chat_key: str, turns: list[dict[str, str]]) -> None:
        normalized = _normalize_context_turns(turns)[-CONTEXT_MAX_TURNS:]
        context_json = json.dumps(normalized, ensure_ascii=False, separators=(",", ":"))
        with closing(self._connect()) as connection:
            with connection:
                connection.execute(
                    """
                    INSERT INTO wecom_aibot_conversation_context (chat_key, context_json)
                    VALUES (?, ?)
                    ON CONFLICT(chat_key) DO UPDATE SET
                      context_json = excluded.context_json,
                      updated_at = CURRENT_TIMESTAMP
                    """,
                    (chat_key, context_json),
                )

    def delete_context(self, chat_key: str) -> None:
        with closing(self._connect()) as connection:
            with connection:
                connection.execute(
                    "DELETE FROM wecom_aibot_conversation_context WHERE chat_key = ?",
                    (chat_key,),
                )

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path)
        connection.execute("PRAGMA busy_timeout=1000;")
        return connection


def _context_expired(updated_at: str) -> bool:
    try:
        timestamp = datetime.fromisoformat(updated_at.replace(" ", "T"))
    except ValueError:
        return True
    if timestamp.tzinfo is None:
        timestamp = timestamp.replace(tzinfo=timezone.utc)
    deadline = timestamp + timedelta(hours=CONTEXT_TTL_HOURS)
    return datetime.now(timezone.utc) > deadline


def _normalize_context_turns(value: list[Any]) -> list[dict[str, str]]:
    turns: list[dict[str, str]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        user_text = _trim_context_text(item.get("user"))
        assistant_text = _trim_context_text(item.get("assistant"))
        if user_text and assistant_text:
            turns.append({"user": user_text, "assistant": assistant_text})
    return turns[-CONTEXT_MAX_TURNS:]


def _context_turns_from_row(row: Any) -> list[dict[str, str]]:
    if row is None or _context_expired(str(row[1])):
        return []
    try:
        payload = json.loads(row[0])
    except json.JSONDecodeError:
        return []
    return _normalize_context_turns(payload) if isinstance(payload, list) else []


def _trim_context_text(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip()[:CONTEXT_TEXT_LIMIT]
