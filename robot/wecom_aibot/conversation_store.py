"""Persistent bindings and short conversation state for the WeCom robot."""

from __future__ import annotations

import json
import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Any


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

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self.database_path)
