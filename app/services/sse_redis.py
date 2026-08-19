"""Redis helpers for SSE fan-out.

This module intentionally wraps the existing synchronous Redis client from
app.core.redis so SSE code can keep one import surface.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from redis.client import PubSub

from app.core.redis import get_redis, redis_key

logger = logging.getLogger(__name__)


class RedisPubSub:
    """Thin wrapper around Redis publish/subscribe for SSE events."""

    @staticmethod
    def publish(channel: str, message: dict[str, Any]) -> int:
        """Publish message JSON to a channel.

        Returns subscriber count reported by Redis.
        """
        redis_client = get_redis()
        if redis_client is None:
            logger.debug("Redis unavailable; skip publish to channel %s", channel)
            return 0

        try:
            payload = json.dumps(message, ensure_ascii=False)
            return int(redis_client.publish(channel, payload))
        except Exception:
            logger.exception("Failed publishing SSE message to %s", channel)
            return 0

    @staticmethod
    def subscribe_patterns(*patterns: str) -> PubSub | None:
        """Subscribe to pub/sub patterns, e.g. lsm:sse:*.

        Returns None when Redis is not available.
        """
        redis_client = get_redis()
        if redis_client is None:
            return None

        try:
            pubsub = redis_client.pubsub(ignore_subscribe_messages=True)
            pubsub.psubscribe(*patterns)
            return pubsub
        except Exception:
            logger.exception("Failed subscribing SSE patterns: %s", patterns)
            return None

    @staticmethod
    def close_pubsub(pubsub: PubSub | None) -> None:
        """Close pubsub safely."""
        if pubsub is None:
            return
        try:
            pubsub.close()
        except Exception:
            logger.exception("Failed closing Redis pubsub")

    @staticmethod
    def next_sequence(room: str) -> int | None:
        """Generate a room-level monotonic sequence via Redis INCR.

        Returns None when Redis is unavailable so caller can use fallback.
        """
        redis_client = get_redis()
        if redis_client is None:
            return None

        try:
            return int(redis_client.incr(redis_key(f"sse:seq:{room}")))
        except Exception:
            logger.exception("Failed to generate Redis sequence for room %s", room)
            return None


redis_pubsub = RedisPubSub()
