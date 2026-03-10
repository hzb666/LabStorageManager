"""
Session Service - User session management layer

This module provides session management functions used by the API layer.
Includes session cleanup, device/IP limits, and session creation.
"""
import hashlib
import secrets
import threading
from datetime import timedelta
from typing import Dict

from sqlmodel import Session, select, func

from app.core.config import settings
from app.core.redis import cache_session, delete_cached_session
from app.core.time_utils import get_utc_now
from app.models.user_session import UserSession

# ==================== Memory Fallback Rate Limiting ====================
# 内存后备速率限制（Redis 不可用时使用）

LOGIN_ATTEMPTS: Dict[str, tuple[int, float]] = {}  # IP -> (失败次数, 首次失败时间)
_login_attempts_lock = threading.Lock()  # 线程锁，保护并发访问


def cleanup_expired_sessions(db: Session) -> int:
    """清理过期的会话，返回删除的数量"""
    now = get_utc_now()
    result = db.exec(
        select(UserSession).where(UserSession.expires_at < now)
    ).all()

    count = 0
    for session in result:
        delete_cached_session(session.token_hash)
        db.delete(session)
        count += 1

    if count > 0:
        db.commit()

    return count


# ==================== Device Session Management ====================

def _check_device_limit(db: Session, user_id: int, device_id: str) -> bool:
    """
    检查设备数量限制
    如果超过限制，返回 False 表示需要踢出旧设备
    """
    if not device_id:
        return True  # 没有 device_id 不限制
    
    # 统计当前用户的设备数（排除当前设备）
    count = db.exec(
        select(func.count(UserSession.id))
        .where(UserSession.user_id == user_id)
        .where(UserSession.device_id != device_id)
    ).one()
    
    return count < settings.max_device_per_user


def _check_ip_limit(db: Session, user_id: int, ip_address: str) -> bool:
    """
    检查 IP 数量限制
    如果超过限制，返回 False
    """
    if not ip_address:
        return True
    
    # 统计当前用户不同 IP 数（排除当前 IP）
    unique_ips = db.exec(
        select(func.count(func.distinct(UserSession.ip_address)))
        .where(UserSession.user_id == user_id)
        .where(UserSession.ip_address != ip_address)
    ).one()
    
    return unique_ips < settings.max_ip_per_user


def _evict_oldest_session(db: Session, user_id: int) -> None:
    """踢出最旧的会话"""
    oldest = db.exec(
        select(UserSession)
        .where(UserSession.user_id == user_id)
        .order_by(UserSession.last_active_at.asc())
        .limit(1)
    ).first()
    
    if oldest:
        # 删除 Redis 缓存
        delete_cached_session(oldest.token_hash)
        # 删除数据库记录
        db.delete(oldest)
        db.commit()


def _create_user_session(
    db: Session,
    user_id: int,
    username: str,
    device_id: str,
    device_name: str,
    ip_address: str,
    user_agent: str,
    token: str
) -> UserSession:
    """创建用户会话，如果已存在相同设备的会话则更新"""
    # 计算 token hash
    token_hash = hashlib.sha256(token.encode()).hexdigest()

    # 计算过期时间
    expires_at = get_utc_now() + timedelta(hours=settings.session_expire_hours)

    # 检查是否已存在相同 user_id 和 device_id 的会话
    # 如果存在则更新，而不是创建新记录
    existing_session = db.exec(
        select(UserSession)
        .where(UserSession.user_id == user_id)
        .where(UserSession.device_id == device_id)
    ).first()

    if existing_session:
        # 更新现有会话
        existing_session.token_hash = token_hash
        existing_session.ip_address = ip_address
        existing_session.last_ip_address = ip_address
        existing_session.user_agent = user_agent
        existing_session.expires_at = expires_at
        existing_session.last_active_at = get_utc_now()
        db.commit()
        db.refresh(existing_session)
        session = existing_session
    else:
        # 创建新会话
        # 如果没有 device_id，生成唯一的匿名设备 ID，避免冲突
        final_device_id = device_id or f"anonymous-{secrets.token_hex(8)}"
        session = UserSession(
            user_id=user_id,
            device_id=final_device_id,
            device_name=device_name or "Unknown Device",
            ip_address=ip_address,
            last_ip_address=ip_address,
            user_agent=user_agent,
            token_hash=token_hash,
            expires_at=expires_at,
        )
        db.add(session)
        db.commit()
        db.refresh(session)
    
    # 缓存到 Redis（使用 session 对象中的实际值，避免 device_id 为 None）
    cache_session(
        token_hash,
        {
            "session_id": session.id,
            "user_id": user_id,
            "username": username,
            "is_active": True,
            "device_id": session.device_id,
            "device_name": session.device_name,
            "ip_address": ip_address,
            "last_ip_address": ip_address,
            "user_agent": user_agent,
            "expires_at": expires_at.isoformat(),
            "last_active_at": session.last_active_at.isoformat(),
        },
        settings.session_expire_hours * 3600
    )
    
    return session
