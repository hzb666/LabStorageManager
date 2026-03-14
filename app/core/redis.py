import json
import logging
import time
from typing import Optional

import redis

from app.core.config import settings

logger = logging.getLogger(__name__)

# Redis 客户端单例与断路器状态
_redis_client: Optional[redis.Redis] = None
_last_error_time: float = 0.0
REDIS_COOLDOWN_SECONDS = 60.0  # 熔断冷却时间：60秒，期间不再尝试连接

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
            socket_connect_timeout=1,
            socket_timeout=1
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

def session_key(token_hash: str) -> str:
    return f"session:{token_hash}"

def _handle_redis_error(e: Exception, operation: str, key: str):
    logger.error(f"{operation} 失败 (Key: {key}): {e}")
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
    redis_client = get_redis()
    if redis_client is None:
        return None

    key = session_key(token_hash)
    try:
        data = redis_client.get(key)
        if data:
            return json.loads(data)
    except redis.RedisError as e:
        _handle_redis_error(e, "读取 Session 缓存", key)
    except json.JSONDecodeError as e:
        logger.error(f"Session 缓存数据损坏 (Key: {key}): {e}")
        delete_cached_session(token_hash)
        
    return None

def delete_cached_session(token_hash: str) -> None:
    redis_client = get_redis()
    if redis_client is None:
        return
        
    key = session_key(token_hash)
    try:
        redis_client.delete(key)
    except redis.RedisError as e:
        _handle_redis_error(e, "删除 Session 缓存", key)