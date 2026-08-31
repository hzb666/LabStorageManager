"""One-time web binding tokens for WeChat customer service users."""

from __future__ import annotations

import secrets
import sqlite3
import time
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class BindToken:
    state: str
    actor_id: str
    expires_at: int


class WechatKfBindStore:
    """Stores one-time binding links in the robot state database."""

    def __init__(self, database_path: Path, ttl_seconds: int) -> None:
        self.database_path = database_path
        self.ttl_seconds = ttl_seconds

    def init(self) -> None:
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        with closing(self._connect()) as connection, connection:
            connection.execute("PRAGMA journal_mode=WAL;")
            connection.execute(
                """
                    CREATE TABLE IF NOT EXISTS wechat_kf_bind_token (
                        state TEXT PRIMARY KEY,
                        actor_id TEXT NOT NULL,
                        expires_at INTEGER NOT NULL,
                        used_at INTEGER
                    )
                    """
            )

    def create(self, actor_id: str) -> BindToken:
        self.prune_expired()
        state = secrets.token_urlsafe(24)
        expires_at = int(time.time()) + self.ttl_seconds
        with closing(self._connect()) as connection, connection:
            connection.execute(
                """
                    INSERT INTO wechat_kf_bind_token (state, actor_id, expires_at)
                    VALUES (?, ?, ?)
                    """,
                (state, actor_id, expires_at),
            )
        return BindToken(state=state, actor_id=actor_id, expires_at=expires_at)

    def get_active(self, state: str) -> BindToken | None:
        with closing(self._connect()) as connection:
            row = connection.execute(
                """
                SELECT state, actor_id, expires_at
                FROM wechat_kf_bind_token
                WHERE state = ? AND used_at IS NULL AND expires_at >= ?
                """,
                (state, int(time.time())),
            ).fetchone()
        if row is None:
            return None
        return BindToken(state=row[0], actor_id=row[1], expires_at=row[2])

    def mark_used(self, state: str) -> None:
        with closing(self._connect()) as connection, connection:
            connection.execute(
                "UPDATE wechat_kf_bind_token SET used_at = ? WHERE state = ?",
                (int(time.time()), state),
            )

    def prune_expired(self) -> None:
        with closing(self._connect()) as connection, connection:
            connection.execute(
                "DELETE FROM wechat_kf_bind_token WHERE expires_at < ? OR used_at IS NOT NULL",
                (int(time.time()),),
            )

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self.database_path)
