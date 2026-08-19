"""
Lightweight rate-limiting helpers with Redis-first storage and in-memory fallback.
"""

import threading
import time
from collections import deque

import redis
from fastapi import HTTPException, status

from app.core.redis import get_redis, redis_key

_fallback_store: dict[str, deque[float]] = {}
_fallback_windows: dict[str, int] = {}
_fallback_lock = threading.Lock()
_fallback_last_sweep = 0.0

FALLBACK_SWEEP_INTERVAL_SECONDS = 60
FALLBACK_MAX_KEYS = 4096


def _prune_fallback_store(now: float) -> None:
    global _fallback_last_sweep

    should_sweep = (
        now - _fallback_last_sweep >= FALLBACK_SWEEP_INTERVAL_SECONDS
        or len(_fallback_store) > FALLBACK_MAX_KEYS
    )
    if not should_sweep:
        return

    expired_keys: list[str] = []
    for key, timestamps in list(_fallback_store.items()):
        window_seconds = _fallback_windows.get(key, 0)
        while window_seconds > 0 and timestamps and now - timestamps[0] >= window_seconds:
            timestamps.popleft()
        if not timestamps:
            expired_keys.append(key)

    for key in expired_keys:
        _fallback_store.pop(key, None)
        _fallback_windows.pop(key, None)

    if len(_fallback_store) > FALLBACK_MAX_KEYS:
        overflow = len(_fallback_store) - FALLBACK_MAX_KEYS
        oldest_keys = sorted(
            _fallback_store,
            key=lambda key: _fallback_store[key][0] if _fallback_store[key] else 0,
        )[:overflow]
        for key in oldest_keys:
            _fallback_store.pop(key, None)
            _fallback_windows.pop(key, None)

    _fallback_last_sweep = now


def _check_local_limit(key: str, limit: int, window_seconds: int) -> None:
    now = time.time()

    with _fallback_lock:
        _fallback_windows[key] = window_seconds
        _prune_fallback_store(now)
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
    key = redis_key(f"rate_limit:{scope}:{identifier}")
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
