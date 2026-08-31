"""Persistent dedupe storage for intelligent robot callbacks."""

from __future__ import annotations

import json
import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Any


class ProcessedMessageStore:
    """Stores already-produced replies so duplicate callbacks replay the same answer."""

    def __init__(self, database_path: Path) -> None:
        self.database_path = database_path

    def init(self) -> None:
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        with closing(self._connect()) as connection, connection:
            connection.execute("PRAGMA journal_mode=WAL;")
            connection.execute(
                """
                    CREATE TABLE IF NOT EXISTS processed_wecom_aibot_message (
                        msgid TEXT PRIMARY KEY,
                        response_json TEXT NOT NULL,
                        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                    )
                    """
            )

    def get_response(self, msgid: str) -> dict[str, Any] | None:
        if not msgid:
            return None
        with closing(self._connect()) as connection:
            row = connection.execute(
                "SELECT response_json FROM processed_wecom_aibot_message WHERE msgid = ?",
                (msgid,),
            ).fetchone()
        if row is None:
            return None
        payload = json.loads(row[0])
        return payload if isinstance(payload, dict) else None

    def claim_response(self, msgid: str) -> bool:
        """Reserve a message id before slow processing starts."""
        if not msgid:
            return False
        response_json = json.dumps({"status": "processing"}, ensure_ascii=False)
        try:
            with closing(self._connect()) as connection, connection:
                connection.execute(
                    """
                        INSERT INTO processed_wecom_aibot_message (msgid, response_json)
                        VALUES (?, ?)
                        """,
                    (msgid, response_json),
                )
        except sqlite3.IntegrityError:
            return False
        return True

    def save_response(self, msgid: str, response: dict[str, Any]) -> None:
        if not msgid:
            return
        response_json = json.dumps(response, ensure_ascii=False, separators=(",", ":"))
        with closing(self._connect()) as connection, connection:
            cursor = connection.execute(
                "UPDATE processed_wecom_aibot_message SET response_json = ? WHERE msgid = ?",
                (response_json, msgid),
            )
            if cursor.rowcount == 0:
                connection.execute(
                    """
                        INSERT INTO processed_wecom_aibot_message (msgid, response_json)
                        VALUES (?, ?)
                        """,
                    (msgid, response_json),
                )

    def release_response(self, msgid: str) -> None:
        if not msgid:
            return
        with closing(self._connect()) as connection, connection:
            connection.execute(
                "DELETE FROM processed_wecom_aibot_message WHERE msgid = ?",
                (msgid,),
            )

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self.database_path)
