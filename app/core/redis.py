import logging
import threading
from collections.abc import Iterable
from dataclasses import dataclass
from time import monotonic

import redis
from redis.backoff import NoBackoff
from redis.retry import Retry

from app.core.config import settings
from app.core.constants import REDIS_COOLDOWN_SECONDS

logger = logging.getLogger(__name__)

# Redis 客户端单例与断路器状态
_redis_client: redis.Redis | None = None
_retry_at: float = 0.0
_state_lock = threading.Lock()
_probe_lock = threading.Lock()
_raw_prefix = (settings.redis_key_prefix or "lsm").strip(":").strip()
REDIS_KEY_PREFIX = _raw_prefix or "lsm"


@dataclass(frozen=True)
class RedisDeleteByPrefixResult:
    success: bool
    deleted_count: int


def get_redis() -> redis.Redis | None:
    """健康连接直接复用；冷却后只让一个线程探测，其余请求立即降级。"""
    global _redis_client, _retry_at
    with _state_lock:
        if monotonic() < _retry_at:
            return None
        if _redis_client is not None:
            return _redis_client
    if not _probe_lock.acquire(blocking=False):
        return None
    pool = None
    try:
        with _state_lock:
            if monotonic() < _retry_at:
                return None
            if _redis_client is not None:
                return _redis_client
        pool = redis.ConnectionPool(
            host=settings.redis_host,
            port=settings.redis_port,
            db=settings.redis_db,
            password=settings.redis_password if settings.redis_password else None,
            decode_responses=True,
            max_connections=settings.redis_max_connections,
            socket_connect_timeout=settings.redis_socket_connect_timeout,
            socket_timeout=settings.redis_socket_timeout,
            retry=Retry(NoBackoff(), 0),
        )
        client = redis.Redis(connection_pool=pool)
        client.ping()
        with _state_lock:
            _redis_client = client
            _retry_at = 0.0
        pool = None  # 连接池由已安装的客户端持有。
        return client
    except redis.RedisError as error:
        handle_redis_error(error, "连接 Redis")
        return None
    finally:
        try:
            if pool is not None:
                _disconnect_pool(pool)
        finally:
            _probe_lock.release()


def _disconnect_pool(pool, *, inuse_connections: bool = True) -> None:
    try:
        pool.disconnect(inuse_connections=inuse_connections)
    except (redis.RedisError, OSError):
        logger.debug("Redis 连接池清理失败", exc_info=True)


def redis_key(raw_key: str) -> str:
    """Build one app-scoped Redis key with configured prefix."""
    return f"{REDIS_KEY_PREFIX}:{raw_key.lstrip(':')}"


def revoked_session_key(token_hash: str) -> str:
    return redis_key(f"session:revoked:{token_hash}")


def is_session_revoked(token_hash: str) -> bool:
    client = get_redis()
    if client is None:
        return False
    key = revoked_session_key(token_hash)
    try:
        return bool(client.exists(key))
    except redis.RedisError as error:
        handle_redis_error(error, "检查会话撤销标记", key, source=client)
        return False


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


def handle_redis_error(
    error: redis.RedisError, operation: str, key: str = "", *, source=None,
) -> None:
    """统一熔断，并忽略已被替换的旧连接/订阅迟到的错误。"""
    global _redis_client, _retry_at
    with _state_lock:
        client = _redis_client
        if source is not None and source is not client:
            source_pool = getattr(source, "connection_pool", None)
            if client is None or source_pool is None or source_pool is not client.connection_pool:
                return
        _redis_client = None
        _retry_at = monotonic() + REDIS_COOLDOWN_SECONDS
    logger.warning(
        "%s 失败，Redis 熔断 %s 秒 key=%s: %s",
        operation, REDIS_COOLDOWN_SECONDS, _redact_redis_key(key), error,
    )
    if client is not None:
        _disconnect_pool(client.connection_pool, inuse_connections=False)


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
        handle_redis_error(e, "写入 Session 撤销标记", ",".join(keys), source=redis_client)


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
        handle_redis_error(e, "按前缀删除缓存", pattern, source=redis_client)
        return RedisDeleteByPrefixResult(success=False, deleted_count=deleted_count)

    return RedisDeleteByPrefixResult(success=True, deleted_count=deleted_count)
