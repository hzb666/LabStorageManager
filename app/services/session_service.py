# 用户 session 管理与缓存同步。
import hashlib
import secrets
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Dict

from sqlmodel import Session, delete, func, select

from app.core.config import settings
from app.core.constants import (
    ANONYMOUS_DEVICE_PREFIX,
    ANONYMOUS_DEVICE_TOKEN_HEX_LENGTH,
    UNKNOWN_DEVICE,
)
from app.core.redis import cache_session, delete_cached_session, delete_cached_sessions
from app.core.time_utils import get_utc_now
from app.models.user_session import UserSession
from app.services.sse_manager import sse_manager


@dataclass(frozen=True)
class SessionCacheIdentity:
    user_id: int
    username: str
    is_active: bool


@dataclass(frozen=True)
class SessionCreationRequest:
    user_id: int
    username: str
    device_id: str
    device_name: str
    ip_address: str
    user_agent: str
    token: str

# ==================== Memory Fallback Rate Limiting ====================
# 内存后备速率限制（Redis 不可用时使用）

LOGIN_ATTEMPTS: Dict[str, tuple[int, float]] = {}  # IP -> (失败次数, 首次失败时间)
_login_attempts_lock = threading.Lock()  # 线程锁，保护并发访问


def _coerce_count(value: object) -> int:
    if value is None:
        return 0
    if isinstance(value, int):
        return value
    if isinstance(value, (tuple, list)):
        if not value:
            return 0
        return int(value[0] or 0)

    mapping = getattr(value, "_mapping", None)
    if mapping:
        first = next(iter(mapping.values()), 0)
        return int(first or 0)

    return int(value)


def cleanup_expired_sessions(db: Session) -> int:
    now = get_utc_now()
    expired_token_hashes = db.exec(
        select(UserSession.token_hash).where(UserSession.expires_at < now)
    ).all()

    if not expired_token_hashes:
        return 0

    delete_cached_sessions(expired_token_hashes)
    db.exec(delete(UserSession).where(UserSession.expires_at < now))
    db.commit()

    return len(expired_token_hashes)


def _session_ttl_seconds(session: UserSession, now_utc: datetime | None = None) -> int:
    base_time = now_utc or get_utc_now()
    return int((session.expires_at - base_time).total_seconds())


def build_session_cache_payload(
    *,
    user_id: int,
    username: str,
    is_active: bool,
    session: UserSession,
) -> dict:
    return {
        "session_id": session.id,
        "user_id": user_id,
        "username": username,
        "is_active": is_active,
        "device_id": session.device_id,
        "device_name": session.device_name,
        "ip_address": session.ip_address,
        "last_ip_address": session.last_ip_address,
        "user_agent": session.user_agent,
        "expires_at": session.expires_at.isoformat(),
        "last_active_at": session.last_active_at.isoformat() if session.last_active_at else None,
    }


def sync_session_cache(
    *,
    session: UserSession,
    identity: SessionCacheIdentity,
    now_utc: datetime | None = None,
) -> None:
    ttl_seconds = _session_ttl_seconds(session, now_utc=now_utc)
    if ttl_seconds <= 0:
        delete_cached_session(session.token_hash)
        return

    cache_session(
        session.token_hash,
        build_session_cache_payload(
            user_id=identity.user_id,
            username=identity.username,
            is_active=identity.is_active,
            session=session,
        ),
        ttl_seconds,
    )


def revoke_session(
    db: Session,
    session: UserSession,
    *,
    reason: str,
    commit: bool = True,
) -> None:
    token_hash = session.token_hash
    db.delete(session)
    if commit:
        db.commit()
        # 先提交数据库，再删缓存/通知 SSE，避免事务回滚时把仍然有效的 session 缓存提前删掉。
        finalize_revoked_sessions([token_hash], reason=reason)


def revoke_user_sessions(
    db: Session,
    user_id: int,
    *,
    reason: str,
    except_token_hash: str | None = None,
    commit: bool = True,
) -> int:
    statement = select(UserSession).where(UserSession.user_id == user_id)
    if except_token_hash:
        statement = statement.where(UserSession.token_hash != except_token_hash)

    sessions = db.exec(statement).all()
    if not sessions:
        return 0

    token_hashes = [session.token_hash for session in sessions]
    for session in sessions:
        db.delete(session)
    if commit:
        db.commit()
        finalize_revoked_sessions(token_hashes, reason=reason)
    return len(token_hashes)


def stage_revoke_user_sessions(
    db: Session,
    user_id: int,
    *,
    except_token_hash: str | None = None,
) -> list[str]:
    # 这里只暂存待删 session，真正的缓存删除和 SSE 通知必须等事务提交成功。
    statement = select(UserSession).where(UserSession.user_id == user_id)
    if except_token_hash:
        statement = statement.where(UserSession.token_hash != except_token_hash)

    sessions = db.exec(statement).all()
    if not sessions:
        return []

    token_hashes = [session.token_hash for session in sessions]
    for session in sessions:
        db.delete(session)
    return token_hashes


def finalize_revoked_sessions(token_hashes: list[str], *, reason: str) -> None:
    if not token_hashes:
        return

    # 缓存删除和 SSE 失效通知都属于“提交成功后的副作用”，集中放在这里统一收口。
    delete_cached_sessions(token_hashes)
    for token_hash in token_hashes:
        sse_manager.notify_session_revoked(token_hash=token_hash, reason=reason)


def refresh_session_expiry(
    db: Session,
    *,
    identity: SessionCacheIdentity,
    session: UserSession,
    new_token: str | None = None,
) -> UserSession:
    now_utc = get_utc_now()
    old_token_hash = session.token_hash
    session.expires_at = now_utc + timedelta(hours=settings.session_expire_hours)
    if new_token:
        session.token_hash = hashlib.sha256(new_token.encode()).hexdigest()
    db.add(session)
    db.commit()
    db.refresh(session)

    if session.token_hash != old_token_hash:
        delete_cached_session(old_token_hash)
        sse_manager.notify_session_revoked(token_hash=old_token_hash, reason="session_refreshed")

    sync_session_cache(
        session=session,
        identity=identity,
        now_utc=now_utc,
    )
    return session


def _check_device_limit(db: Session, user_id: int, device_id: str) -> bool:
    if not device_id:
        return True
    
    count_result = db.exec(
        select(func.count(UserSession.id))
        .where(UserSession.user_id == user_id)
        .where(UserSession.device_id != device_id)
    ).one()
    count = _coerce_count(count_result)
    
    return count < settings.max_device_per_user


def _check_ip_limit(db: Session, user_id: int, ip_address: str) -> bool:
    if not ip_address:
        return True
    
    unique_ips_result = db.exec(
        select(func.count(func.distinct(UserSession.ip_address)))
        .where(UserSession.user_id == user_id)
        .where(UserSession.ip_address != ip_address)
    ).one()
    unique_ips = _coerce_count(unique_ips_result)
    
    return unique_ips < settings.max_ip_per_user


def _evict_oldest_session(db: Session, user_id: int) -> None:
    oldest = db.exec(
        select(UserSession)
        .where(UserSession.user_id == user_id)
        .order_by(UserSession.last_active_at.asc())
        .limit(1)
    ).first()
    
    if oldest:
        revoke_session(db, oldest, reason="device_limit_evict", commit=True)


def _create_user_session(db: Session, request: SessionCreationRequest) -> UserSession:
    # 同设备重复登录直接覆盖旧 token，避免同一设备堆叠无意义 session。
    token_hash = hashlib.sha256(request.token.encode()).hexdigest()

    expires_at = get_utc_now() + timedelta(hours=settings.session_expire_hours)

    existing_session = db.exec(
        select(UserSession)
        .where(UserSession.user_id == request.user_id)
        .where(UserSession.device_id == request.device_id)
    ).first()

    if existing_session:
        old_token_hash = existing_session.token_hash
        existing_session.token_hash = token_hash
        existing_session.ip_address = request.ip_address
        existing_session.last_ip_address = request.ip_address
        existing_session.user_agent = request.user_agent
        existing_session.expires_at = expires_at
        existing_session.last_active_at = get_utc_now()
        db.commit()
        db.refresh(existing_session)
        session = existing_session
        if old_token_hash != token_hash:
            delete_cached_session(old_token_hash)
            sse_manager.notify_session_revoked(token_hash=old_token_hash, reason="device_relogin")
    else:
        final_device_id = (
            request.device_id
            or f"{ANONYMOUS_DEVICE_PREFIX}{secrets.token_hex(ANONYMOUS_DEVICE_TOKEN_HEX_LENGTH)}"
        )
        session = UserSession(
            user_id=request.user_id,
            device_id=final_device_id,
            device_name=request.device_name or UNKNOWN_DEVICE,
            ip_address=request.ip_address,
            last_ip_address=request.ip_address,
            user_agent=request.user_agent,
            token_hash=token_hash,
            expires_at=expires_at,
        )
        db.add(session)
        db.commit()
        db.refresh(session)

    sync_session_cache(
        session=session,
        identity=SessionCacheIdentity(
            user_id=request.user_id,
            username=request.username,
            is_active=True,
        ),
        now_utc=get_utc_now(),
    )

    return session
