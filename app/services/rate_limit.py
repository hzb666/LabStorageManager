"""
Lightweight rate-limiting helpers with Redis-first storage and in-memory fallback.
"""

import threading
import time
from collections import deque

import redis
from fastapi import HTTPException, status

from app.core.redis import get_redis


_fallback_store: dict[str, deque[float]] = {}
_fallback_lock = threading.Lock()


def _check_local_limit(key: str, limit: int, window_seconds: int) -> None:
    now = time.time()

    with _fallback_lock:
        timestamps = _fallback_store.setdefault(key, deque())
        while timestamps and now - timestamps[0] >= window_seconds:
            timestamps.popleft()

        if len(timestamps) >= limit:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Too many requests, please retry after {window_seconds} seconds",
            )

        timestamps.append(now)


def enforce_rate_limit(scope: str, identifier: str, limit: int, window_seconds: int) -> None:
    """
    Enforce a simple fixed-window rate limit.
    """
    key = f"rate_limit:{scope}:{identifier}"
    redis_client = get_redis()

    if redis_client is None:
        _check_local_limit(key, limit, window_seconds)
        return

    try:
        current = redis_client.incr(key)
        if current == 1:
            redis_client.expire(key, window_seconds)

        if current > limit:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Too many requests, please retry after {window_seconds} seconds",
            )
    except redis.RedisError:
        _check_local_limit(key, limit, window_seconds)
