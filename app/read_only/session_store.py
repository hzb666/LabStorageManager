from __future__ import annotations

import threading
import time
import uuid

import redis
from fastapi import HTTPException, status

from app.core.config import settings
from app.core.redis import get_redis, redis_key

_local_sessions: dict[str, tuple[int, float]] = {}
_local_lock = threading.Lock()


def _session_key(snapshot_id: str, session_id: str) -> str:
    return redis_key(f"read_only_session:{snapshot_id}:{session_id}")


def _local_create(key: str, user_id: int, ttl_seconds: int) -> None:
    now = time.time()
    with _local_lock:
        expired = [
            stored_key
            for stored_key, (_, expires_at) in _local_sessions.items()
            if expires_at <= now
        ]
        for stored_key in expired:
            _local_sessions.pop(stored_key, None)
        _local_sessions[key] = (user_id, now + ttl_seconds)


def _local_validate(key: str, user_id: int) -> bool:
    with _local_lock:
        stored = _local_sessions.get(key)
        if stored is None:
            return False
        stored_user_id, expires_at = stored
        if expires_at <= time.time():
            _local_sessions.pop(key, None)
            return False
        return stored_user_id == user_id


def create_session(snapshot_id: str, user_id: int, ttl_seconds: int) -> str:
    session_id = uuid.uuid4().hex
    key = _session_key(snapshot_id, session_id)
    client = get_redis()
    if client is not None:
        try:
            client.setex(key, ttl_seconds, str(user_id))
            return session_id
        except redis.RedisError:
            pass
    if settings.use_secure_runtime():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Read-only login service temporarily unavailable",
        )
    _local_create(key, user_id, ttl_seconds)
    return session_id


def validate_session(snapshot_id: str, session_id: str, user_id: int) -> bool:
    key = _session_key(snapshot_id, session_id)
    client = get_redis()
    if client is not None:
        try:
            return client.get(key) == str(user_id)
        except redis.RedisError:
            return False
    if settings.use_secure_runtime():
        return False
    return _local_validate(key, user_id)


def revoke_session(snapshot_id: str, session_id: str) -> None:
    key = _session_key(snapshot_id, session_id)
    client = get_redis()
    if client is not None:
        try:
            client.delete(key)
        except redis.RedisError:
            pass
    with _local_lock:
        _local_sessions.pop(key, None)
