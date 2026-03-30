"""Redis-backed preview-session storage for two-phase inventory imports."""
from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass
import json
from datetime import datetime, timedelta
import logging
from pathlib import Path
import secrets
import threading

import redis

from app.core.constants import IMPORT_PREVIEW_SESSION_TTL_SECONDS
from app.core.redis import get_redis, redis_key
from app.core.time_utils import get_utc_now

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class InventoryImportPreviewSession:
    token: str
    file_bytes: bytes
    file_suffix: str
    user_id: int
    default_storage_location: str | None
    default_is_hazardous: bool
    expires_at: datetime


PREVIEW_SESSION_REDIS_SCOPE = "import_preview_session"
_GETDEL_LUA = """
local v = redis.call('GET', KEYS[1])
if v then
  redis.call('DEL', KEYS[1])
end
return v
"""
_local_preview_sessions: dict[str, InventoryImportPreviewSession] = {}
_local_preview_sessions_lock = threading.Lock()


def _preview_session_key(*, user_id: int, token: str) -> str:
    return redis_key(f"{PREVIEW_SESSION_REDIS_SCOPE}:{user_id}:{token}")


def _cleanup_expired_local_preview_sessions(*, now_utc: datetime | None = None) -> None:
    current_time = now_utc or get_utc_now()
    expired_tokens: list[str] = []

    with _local_preview_sessions_lock:
        for token, session in _local_preview_sessions.items():
            if session.expires_at <= current_time:
                expired_tokens.append(token)
        for token in expired_tokens:
            _local_preview_sessions.pop(token, None)


def _set_local_preview_session(session: InventoryImportPreviewSession) -> None:
    _cleanup_expired_local_preview_sessions()
    with _local_preview_sessions_lock:
        _local_preview_sessions[session.token] = session


def _consume_local_preview_session(token: str, *, user_id: int) -> InventoryImportPreviewSession:
    _cleanup_expired_local_preview_sessions()
    with _local_preview_sessions_lock:
        session = _local_preview_sessions.get(token)
        if session is None:
            raise ValueError("Preview token is invalid or expired")
        if session.user_id != user_id:
            raise ValueError("Preview token is invalid or expired")
        _local_preview_sessions.pop(token, None)
    return session


def _parse_preview_session(
    *,
    token: str,
    raw_payload: str,
) -> InventoryImportPreviewSession:
    try:
        payload = json.loads(raw_payload)
    except json.JSONDecodeError as exc:
        raise ValueError("Preview token is invalid or expired") from exc

    if not isinstance(payload, dict):
        raise ValueError("Preview token is invalid or expired")

    try:
        encoded_file = str(payload["file_b64"])
        file_bytes = base64.b64decode(encoded_file, validate=True)
        file_suffix = str(payload.get("file_suffix") or "")
        user_id = int(payload["user_id"])
        default_storage_location = payload.get("default_storage_location")
        if default_storage_location is not None:
            default_storage_location = str(default_storage_location)
        default_is_hazardous = bool(payload["default_is_hazardous"])
        expires_at = datetime.fromisoformat(str(payload["expires_at"]))
    except (KeyError, TypeError, ValueError, binascii.Error) as exc:
        raise ValueError("Preview token is invalid or expired") from exc

    if expires_at <= get_utc_now():
        raise ValueError("Preview token is invalid or expired")

    return InventoryImportPreviewSession(
        token=token,
        file_bytes=file_bytes,
        file_suffix=file_suffix,
        user_id=user_id,
        default_storage_location=default_storage_location,
        default_is_hazardous=default_is_hazardous,
        expires_at=expires_at,
    )


def create_inventory_import_preview_session(
    *,
    file_path: str,
    user_id: int,
    default_storage_location: str | None,
    default_is_hazardous: bool,
) -> str:
    file_bytes = Path(file_path).read_bytes()
    file_suffix = Path(file_path).suffix
    token = secrets.token_urlsafe(24)
    expires_at = get_utc_now() + timedelta(seconds=IMPORT_PREVIEW_SESSION_TTL_SECONDS)
    session = InventoryImportPreviewSession(
        token=token,
        file_bytes=file_bytes,
        file_suffix=file_suffix,
        user_id=user_id,
        default_storage_location=default_storage_location,
        default_is_hazardous=default_is_hazardous,
        expires_at=expires_at,
    )
    # 始终保留本机副本：Redis 短时不可用时仍可确认导入（同实例）。
    _set_local_preview_session(session)

    payload = {
        "user_id": user_id,
        "file_b64": base64.b64encode(file_bytes).decode("ascii"),
        "file_suffix": file_suffix,
        "default_storage_location": default_storage_location,
        "default_is_hazardous": default_is_hazardous,
        "expires_at": expires_at.isoformat(),
    }
    redis_client = get_redis()
    if redis_client is not None:
        key = _preview_session_key(user_id=user_id, token=token)
        try:
            redis_client.setex(key, IMPORT_PREVIEW_SESSION_TTL_SECONDS, json.dumps(payload, ensure_ascii=False))
        except redis.RedisError as exc:
            logger.warning("Preview session fallback to local memory: %s", exc)

    return token


def consume_inventory_import_preview_session(
    token: str,
    *,
    user_id: int,
) -> InventoryImportPreviewSession:
    redis_client = get_redis()
    if redis_client is not None:
        key = _preview_session_key(user_id=user_id, token=token)
        try:
            getdel = getattr(redis_client, "getdel", None)
            if callable(getdel):
                raw_payload = getdel(key)
            else:
                raw_payload = redis_client.eval(_GETDEL_LUA, 1, key)
        except (redis.RedisError, AttributeError, TypeError) as exc:
            logger.warning("Consume preview session fallback to local memory: %s", exc)
            raw_payload = None

        if raw_payload is not None:
            session = _parse_preview_session(token=token, raw_payload=raw_payload)
            if session.user_id != user_id:
                # user_id 已编码在 key 中，这里仅做防御式校验。
                raise ValueError("Preview token is invalid or expired")
            # Redis 消费成功时清掉本机副本，避免重复占用内存。
            with _local_preview_sessions_lock:
                _local_preview_sessions.pop(token, None)
            return session

    return _consume_local_preview_session(token, user_id=user_id)


def discard_inventory_import_preview_session(token: str) -> None:
    with _local_preview_sessions_lock:
        _local_preview_sessions.pop(token, None)

    redis_client = get_redis()
    if redis_client is not None:
        pattern = redis_key(f"{PREVIEW_SESSION_REDIS_SCOPE}:*:{token}")
        try:
            for key in redis_client.scan_iter(match=pattern, count=50):
                redis_client.delete(key)
        except redis.RedisError:
            return


def reset_inventory_import_preview_sessions() -> None:
    with _local_preview_sessions_lock:
        _local_preview_sessions.clear()

    redis_client = get_redis()
    if redis_client is not None:
        pattern = redis_key(f"{PREVIEW_SESSION_REDIS_SCOPE}:*")
        try:
            for key in redis_client.scan_iter(match=pattern, count=200):
                redis_client.delete(key)
        except redis.RedisError:
            return
