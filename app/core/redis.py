import json
import logging
import time
from dataclasses import dataclass
from typing import Iterable, Optional

import redis

from app.core.config import settings
from app.core.constants import (
    REDIS_COOLDOWN_SECONDS,
    REDIS_SOCKET_CONNECT_TIMEOUT_SECONDS,
    REDIS_SOCKET_TIMEOUT_SECONDS,
)

logger = logging.getLogger(__name__)

# Redis 客户端单例与断路器状态
_redis_client: Optional[redis.Redis] = None
_last_error_time: float = 0.0
_raw_prefix = (settings.redis_key_prefix or "lsm").strip(":").strip()
REDIS_KEY_PREFIX = _raw_prefix or "lsm"


@dataclass(frozen=True)
class RedisDeleteByPrefixResult:
    success: bool
    deleted_count: int


@dataclass(frozen=True)
class CachedSessionState:
    session_data: Optional[dict]
    is_revoked: bool


def get_redis() -> Optional[redis.Redis]:
    """获取 Redis 客户端（带简易熔断机制）"""
    global _redis_client, _last_error_time

    if _redis_client is not None:
        return _redis_client

    if time.time() - _last_error_time < REDIS_COOLDOWN_SECONDS:
        return None

    try:
        pool = redis.ConnectionPool(
            host=settings.redis_host,
            port=settings.redis_port,
            db=settings.redis_db,
            password=settings.redis_password if settings.redis_password else None,
            decode_responses=True,
            socket_connect_timeout=REDIS_SOCKET_CONNECT_TIMEOUT_SECONDS,
            socket_timeout=REDIS_SOCKET_TIMEOUT_SECONDS,
        )
        client = redis.Redis(connection_pool=pool)
        client.ping()

        _redis_client = client
        _last_error_time = 0.0
        return _redis_client

    except (redis.ConnectionError, redis.TimeoutError) as e:
        logger.warning(f"Redis 连接失败，触发熔断 {REDIS_COOLDOWN_SECONDS} 秒: {e}")
        _redis_client = None
        _last_error_time = time.time()
        return None


def redis_key(raw_key: str) -> str:
    """Build one app-scoped Redis key with configured prefix."""
    return f"{REDIS_KEY_PREFIX}:{raw_key.lstrip(':')}"


def session_key(token_hash: str) -> str:
    return redis_key(f"session:{token_hash}")


def revoked_session_key(token_hash: str) -> str:
    return redis_key(f"session:revoked:{token_hash}")


def _redact_redis_key(key: str) -> str:
    if not key:
        return ""

    keys = key.split(",")
    if len(keys) > 1:
        return f"<{len(keys)} redis keys>"

    parts = key.split(":")
    if "session" not in parts:
        return key

    session_index = parts.index("session")
    return ":".join([*parts[: session_index + 1], "<redacted>"])


def _handle_redis_error(e: Exception, operation: str, key: str):
    logger.error("%s 失败 key=%s: %s", operation, _redact_redis_key(key), e)
    global _redis_client, _last_error_time
    _redis_client = None
    _last_error_time = time.time()


def cache_session(token_hash: str, session_data: dict, ttl_seconds: int) -> None:
    redis_client = get_redis()
    if redis_client is None:
        return

    key = session_key(token_hash)
    try:
        redis_client.setex(key, ttl_seconds, json.dumps(session_data, default=str))
    except redis.RedisError as e:
        _handle_redis_error(e, "写入 Session 缓存", key)
    except TypeError as e:
        logger.error(f"Session 数据序列化失败: {e}")


def get_cached_session(token_hash: str) -> Optional[dict]:
    return get_cached_session_state(token_hash).session_data


def get_cached_session_state(token_hash: str) -> CachedSessionState:
    redis_client = get_redis()
    if redis_client is None:
        return CachedSessionState(session_data=None, is_revoked=False)

    cache_key = session_key(token_hash)
    revoked_key = revoked_session_key(token_hash)
    try:
        cached_payload, revoked_marker = redis_client.mget([cache_key, revoked_key])
        session_data = None
        if cached_payload:
            session_data = json.loads(cached_payload)
        return CachedSessionState(
            session_data=session_data,
            is_revoked=bool(revoked_marker),
        )
    except redis.RedisError as e:
        _handle_redis_error(e, "读取 Session 缓存状态", f"{cache_key},{revoked_key}")
    except json.JSONDecodeError as e:
        logger.error("Session 缓存数据损坏 key=%s: %s", _redact_redis_key(cache_key), e)
        delete_cached_session(token_hash)

    return CachedSessionState(session_data=None, is_revoked=False)


def delete_cached_session(token_hash: str) -> None:
    redis_client = get_redis()
    if redis_client is None:
        return

    key = session_key(token_hash)
    try:
        redis_client.delete(key)
    except redis.RedisError as e:
        _handle_redis_error(e, "删除 Session 缓存", key)


def delete_cached_sessions(token_hashes: Iterable[str]) -> None:
    redis_client = get_redis()
    if redis_client is None:
        return

    keys = [session_key(token_hash) for token_hash in token_hashes]
    if not keys:
        return

    try:
        redis_client.delete(*keys)
    except redis.RedisError as e:
        _handle_redis_error(e, "批量删除 Session 缓存", ",".join(keys))


def mark_revoked_sessions(token_hashes: Iterable[str], *, ttl_seconds: int) -> None:
    if ttl_seconds <= 0:
        return

    redis_client = get_redis()
    if redis_client is None:
        return

    keys = [revoked_session_key(token_hash) for token_hash in token_hashes]
    if not keys:
        return

    try:
        pipeline = redis_client.pipeline(transaction=False)
        for key in keys:
            pipeline.setex(key, ttl_seconds, "1")
        pipeline.execute()
    except redis.RedisError as e:
        _handle_redis_error(e, "写入 Session 撤销标记", ",".join(keys))


def delete_keys_by_prefix(prefix: str) -> RedisDeleteByPrefixResult:
    redis_client = get_redis()
    if redis_client is None:
        return RedisDeleteByPrefixResult(success=False, deleted_count=0)

    normalized_prefix = prefix.strip()
    if not normalized_prefix:
        return RedisDeleteByPrefixResult(success=True, deleted_count=0)

    deleted_count = 0
    batch: list[str] = []
    pattern = f"{normalized_prefix}:*"

    try:
        for key in redis_client.scan_iter(match=pattern, count=200):
            batch.append(key)
            if len(batch) < 200:
                continue

            deleted_count += int(redis_client.delete(*batch) or 0)
            batch.clear()

        if batch:
            deleted_count += int(redis_client.delete(*batch) or 0)
    except redis.RedisError as e:
        _handle_redis_error(e, "按前缀删除缓存", pattern)
        return RedisDeleteByPrefixResult(success=False, deleted_count=deleted_count)

    return RedisDeleteByPrefixResult(success=True, deleted_count=deleted_count)
