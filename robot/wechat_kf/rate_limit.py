"""SQLite-backed rate limit helpers for WeChat customer service users."""

from __future__ import annotations

import sqlite3
import time
from contextlib import closing
from pathlib import Path


class WechatKfRateLimiter:
    """Limits message processing per WeChat customer identity."""

    def __init__(self, database_path: Path, *, max_messages: int, window_seconds: int) -> None:
        self.database_path = database_path
        self.max_messages = max_messages
        self.window_seconds = window_seconds

    def init(self) -> None:
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        with closing(self._connect()) as connection:
            with connection:
                connection.execute("PRAGMA journal_mode=WAL;")
                connection.execute(
                    """
                    CREATE TABLE IF NOT EXISTS wechat_kf_rate_limit (
                        actor_id TEXT NOT NULL,
                        created_at INTEGER NOT NULL
                    )
                    """
                )
                connection.execute(
                    """
                    CREATE INDEX IF NOT EXISTS ix_wechat_kf_rate_limit_actor_created
                    ON wechat_kf_rate_limit (actor_id, created_at)
                    """
                )

    def allow(self, actor_id: str) -> bool:
        return self.reserve(actor_id) is not None

    def reserve(self, actor_id: str) -> int | None:
        now = int(time.time())
        since = now - self.window_seconds
        with closing(self._connect()) as connection:
            with connection:
                connection.execute(
                    "DELETE FROM wechat_kf_rate_limit WHERE created_at < ?",
                    (since,),
                )
                count = connection.execute(
                    """
                    SELECT COUNT(*)
                    FROM wechat_kf_rate_limit
                    WHERE actor_id = ? AND created_at >= ?
                    """,
                    (actor_id, since),
                ).fetchone()[0]
                if int(count) >= self.max_messages:
                    return None
                cursor = connection.execute(
                    """
                    INSERT INTO wechat_kf_rate_limit (actor_id, created_at)
                    VALUES (?, ?)
                    """,
                    (actor_id, now),
                )
                return int(cursor.lastrowid)

    def release(self, reservation_id: int) -> None:
        """Remove one previously reserved message slot for superseded processing."""
        with closing(self._connect()) as connection:
            with connection:
                connection.execute(
                    "DELETE FROM wechat_kf_rate_limit WHERE rowid = ?",
                    (reservation_id,),
                )

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self.database_path)
