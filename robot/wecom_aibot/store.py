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
        with closing(self._connect()) as connection:
            with connection:
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

    def save_response(self, msgid: str, response: dict[str, Any]) -> None:
        if not msgid:
            return
        response_json = json.dumps(response, ensure_ascii=False, separators=(",", ":"))
        with closing(self._connect()) as connection:
            with connection:
                connection.execute(
                    """
                    INSERT OR IGNORE INTO processed_wecom_aibot_message (msgid, response_json)
                    VALUES (?, ?)
                    """,
                    (msgid, response_json),
                )

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self.database_path)
