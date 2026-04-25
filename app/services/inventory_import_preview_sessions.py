"""Redis-backed preview-session storage for two-phase inventory imports."""
from __future__ import annotations

from dataclasses import dataclass
import json
from datetime import datetime, timedelta
import logging
from pathlib import Path
import secrets
import tempfile
import threading

import redis

from app.core.constants import EXCEL_FILE_MAX_BYTES, IMPORT_PREVIEW_SESSION_TTL_SECONDS
from app.core.redis import get_redis, redis_key
from app.core.time_utils import get_utc_now, parse_utc_datetime, utc_iso_str

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class InventoryImportPreviewSession:
    token: str
    file_path: str
    file_suffix: str
    user_id: int
    default_storage_location: str | None
    default_is_hazardous: bool
    expires_at: datetime


PREVIEW_SESSION_REDIS_SCOPE = "import_preview_session"
PREVIEW_SESSION_METADATA_PREFIX = "lsm-import-preview-"
PREVIEW_SESSION_DIR_NAME = "lab-storage-manager-inventory-import-preview"
_GETDEL_LUA = """
local v = redis.call('GET', KEYS[1])
if v then
  redis.call('DEL', KEYS[1])
end
return v
"""
_local_preview_sessions: dict[str, InventoryImportPreviewSession] = {}
_local_preview_sessions_lock = threading.Lock()


def get_inventory_import_preview_dir() -> Path:
    preview_dir = Path(tempfile.gettempdir()) / PREVIEW_SESSION_DIR_NAME
    preview_dir.mkdir(parents=True, exist_ok=True)
    return preview_dir


def _resolve_managed_preview_path(file_path: str | Path | None) -> Path | None:
    if not file_path:
        return None
    try:
        preview_dir = get_inventory_import_preview_dir().resolve()
        resolved_path = Path(file_path).resolve(strict=False)
    except OSError:
        logger.warning("Failed to resolve preview file path: %s", file_path)
        return None
    if not resolved_path.is_relative_to(preview_dir):
        logger.warning("Refusing to cleanup unmanaged preview file: %s", file_path)
        return None
    return resolved_path


def _preview_session_key(*, user_id: int, token: str) -> str:
    return redis_key(f"{PREVIEW_SESSION_REDIS_SCOPE}:{user_id}:{token}")


def _preview_session_metadata_path(token: str) -> Path:
    return get_inventory_import_preview_dir() / f"{PREVIEW_SESSION_METADATA_PREFIX}{token}.json"


def _delete_preview_metadata(token: str) -> None:
    try:
        _preview_session_metadata_path(token).unlink(missing_ok=True)
    except OSError:
        logger.warning("Failed to cleanup preview metadata for token=%s", token)


def _write_preview_metadata(session: InventoryImportPreviewSession) -> None:
    payload = {
        "token": session.token,
        "file_path": session.file_path,
        "file_suffix": session.file_suffix,
        "user_id": session.user_id,
        "default_storage_location": session.default_storage_location,
        "default_is_hazardous": session.default_is_hazardous,
        "expires_at": utc_iso_str(session.expires_at),
    }
    metadata_path = _preview_session_metadata_path(session.token)
    metadata_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def _delete_preview_file(file_path: str | None) -> None:
    managed_file_path = _resolve_managed_preview_path(file_path)
    if managed_file_path is None:
        return
    try:
        managed_file_path.unlink(missing_ok=True)
    except OSError:
        logger.warning("Failed to cleanup preview file: %s", file_path)


def _extract_file_path_from_payload(raw_payload: str) -> str | None:
    try:
        payload = json.loads(raw_payload)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None
    file_path = payload.get("file_path")
    return str(file_path) if file_path else None


def _cleanup_expired_local_preview_sessions(*, now_utc: datetime | None = None) -> None:
    current_time = now_utc or get_utc_now()
    expired_tokens: list[str] = []
    expired_file_paths: list[str] = []

    with _local_preview_sessions_lock:
        for token, session in _local_preview_sessions.items():
            if session.expires_at <= current_time:
                expired_tokens.append(token)
                expired_file_paths.append(session.file_path)
        for token in expired_tokens:
            _local_preview_sessions.pop(token, None)
    for file_path in expired_file_paths:
        _delete_preview_file(file_path)


def cleanup_expired_inventory_import_preview_artifacts(*, now_utc: datetime | None = None) -> None:
    current_time = now_utc or get_utc_now()
    for metadata_path in get_inventory_import_preview_dir().glob(f"{PREVIEW_SESSION_METADATA_PREFIX}*.json"):
        try:
            payload = json.loads(metadata_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            metadata_path.unlink(missing_ok=True)
            continue

        if not isinstance(payload, dict):
            metadata_path.unlink(missing_ok=True)
            continue

        token = str(payload.get("token") or metadata_path.stem.removeprefix(PREVIEW_SESSION_METADATA_PREFIX))
        file_path = payload.get("file_path")
        expires_at_raw = payload.get("expires_at")
        expires_at = parse_utc_datetime(expires_at_raw)
        if expires_at is None:
            _delete_preview_file(str(file_path) if file_path else None)
            _delete_preview_metadata(token)
            continue

        managed_file_path = _resolve_managed_preview_path(str(file_path) if file_path else None)
        if expires_at <= current_time or managed_file_path is None or not managed_file_path.exists():
            _delete_preview_file(str(file_path) if file_path else None)
            _delete_preview_metadata(token)


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
        file_path = str(payload["file_path"])
        file_suffix = str(payload.get("file_suffix") or "")
        user_id = int(payload["user_id"])
        default_storage_location = payload.get("default_storage_location")
        if default_storage_location is not None:
            default_storage_location = str(default_storage_location)
        default_is_hazardous = bool(payload["default_is_hazardous"])
        expires_at = parse_utc_datetime(payload["expires_at"])
    except (KeyError, TypeError) as exc:
        raise ValueError("Preview token is invalid or expired") from exc

    if expires_at is None:
        raise ValueError("Preview token is invalid or expired")

    if expires_at <= get_utc_now():
        _delete_preview_file(file_path)
        _delete_preview_metadata(token)
        raise ValueError("Preview token is invalid or expired")

    managed_file_path = _resolve_managed_preview_path(file_path)
    if managed_file_path is None or not managed_file_path.exists():
        _delete_preview_metadata(token)
        raise ValueError("Preview token is invalid or expired")

    return InventoryImportPreviewSession(
        token=token,
        file_path=str(managed_file_path),
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
    cleanup_expired_inventory_import_preview_artifacts()
    source_path = _resolve_managed_preview_path(file_path)
    if source_path is None:
        raise ValueError("Preview source file is not managed")
    if not source_path.exists():
        raise ValueError("Preview source file does not exist")
    if source_path.stat().st_size > EXCEL_FILE_MAX_BYTES:
        raise ValueError("Preview file exceeds size limit")

    file_suffix = source_path.suffix
    token = secrets.token_urlsafe(24)
    expires_at = get_utc_now() + timedelta(seconds=IMPORT_PREVIEW_SESSION_TTL_SECONDS)
    session = InventoryImportPreviewSession(
        token=token,
        file_path=str(source_path),
        file_suffix=file_suffix,
        user_id=user_id,
        default_storage_location=default_storage_location,
        default_is_hazardous=default_is_hazardous,
        expires_at=expires_at,
    )
    # 本机副本始终写入：Redis 短时不可用时仍可确认导入（同实例）。
    _set_local_preview_session(session)
    _write_preview_metadata(session)

    payload = {
        "token": token,
        "user_id": user_id,
        "file_path": str(source_path),
        "file_suffix": file_suffix,
        "default_storage_location": default_storage_location,
        "default_is_hazardous": default_is_hazardous,
        "expires_at": utc_iso_str(expires_at),
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
    cleanup_expired_inventory_import_preview_artifacts()
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
            # Redis 消费成功时清掉本机副本；文件交给调用方在 confirm/discard 时清理。
            with _local_preview_sessions_lock:
                _local_preview_sessions.pop(token, None)
            return session

    return _consume_local_preview_session(token, user_id=user_id)


def discard_inventory_import_preview_session(token: str, *, file_path: str | None = None) -> None:
    managed_file_path = file_path
    with _local_preview_sessions_lock:
        session = _local_preview_sessions.pop(token, None)
        if session is not None:
            managed_file_path = session.file_path

    redis_client = get_redis()
    if redis_client is not None:
        pattern = redis_key(f"{PREVIEW_SESSION_REDIS_SCOPE}:*:{token}")
        try:
            for key in redis_client.scan_iter(match=pattern, count=50):
                raw_payload = redis_client.get(key)
                if managed_file_path is None and raw_payload is not None:
                    managed_file_path = _extract_file_path_from_payload(raw_payload)
                redis_client.delete(key)
        except redis.RedisError:
            pass

    _delete_preview_metadata(token)
    _delete_preview_file(managed_file_path)


def reset_inventory_import_preview_sessions() -> None:
    cleanup_expired_inventory_import_preview_artifacts()
    file_paths: list[str] = []
    with _local_preview_sessions_lock:
        file_paths = [session.file_path for session in _local_preview_sessions.values()]
        tokens = list(_local_preview_sessions.keys())
        _local_preview_sessions.clear()

    redis_client = get_redis()
    if redis_client is not None:
        pattern = redis_key(f"{PREVIEW_SESSION_REDIS_SCOPE}:*")
        try:
            for key in redis_client.scan_iter(match=pattern, count=200):
                raw_payload = redis_client.get(key)
                token = None
                if raw_payload is not None:
                    try:
                        payload = json.loads(raw_payload)
                    except json.JSONDecodeError:
                        payload = None
                    if isinstance(payload, dict):
                        file_path = payload.get("file_path")
                        token = payload.get("token")
                    else:
                        file_path = None
                else:
                    file_path = None
                if file_path:
                    file_paths.append(str(file_path))
                if token:
                    tokens.append(str(token))
                redis_client.delete(key)
        except redis.RedisError:
            pass

    for token in tokens:
        _delete_preview_metadata(token)
    for file_path in file_paths:
        _delete_preview_file(file_path)
