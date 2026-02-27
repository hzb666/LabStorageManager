"""
User Sessions API - Device Management
"""
from datetime import datetime, timedelta, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlmodel import Session, select

from app.core.config import settings
from app.core.redis import delete_cached_session
from app.database import get_db
from app.models.user import User
from app.models.user_session import UserSession


router = APIRouter(prefix="/sessions", tags=["Sessions"])

# 导入 get_current_session 用于获取当前会话
from app.api.deps import get_current_session


class SessionResponse(BaseModel):
    """Session response model"""
    id: int
    device_id: str
    device_name: str
    ip_address: str
    last_ip_address: str
    user_agent: str
    created_at: datetime
    last_active_at: datetime
    expires_at: datetime
    
    class Config:
        from_attributes = True


# 直接使用 auth 模块的 get_current_user
from app.core.auth import get_current_user


@router.get("/", response_model=List[SessionResponse])
def list_sessions(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """List all sessions for current user"""
    sessions = db.exec(
        select(UserSession)
        .where(UserSession.user_id == current_user.id)
        .order_by(UserSession.last_active_at.desc())
    ).all()
    
    return sessions


@router.delete("/{session_id}")
def delete_session(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Delete a specific session (kick user off a device)"""
    session = db.get(UserSession, session_id)
    
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found"
        )
    
    # 只能删除自己的会话
    if session.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot delete other user's session"
        )
    
    # 删除 Redis 缓存
    delete_cached_session(session.token_hash)
    
    # 删除数据库记录
    db.delete(session)
    db.commit()
    
    return {"message": "Session deleted successfully"}


@router.delete("/")
def delete_all_sessions(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_session: UserSession = Depends(get_current_session)
):
    """Delete all sessions for current user except the current session"""
    sessions = db.exec(
        select(UserSession)
        .where(UserSession.user_id == current_user.id)
        .where(UserSession.token_hash != current_session.token_hash)
    ).all()
    
    deleted_count = 0
    for session in sessions:
        # 删除 Redis 缓存
        delete_cached_session(session.token_hash)
        # 删除数据库记录
        db.delete(session)
        deleted_count += 1
    
    db.commit()
    
    return {"message": f"Deleted {deleted_count} sessions"}


@router.post("/refresh")
def refresh_session(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Refresh current session expiration time"""
    # 获取当前用户的最新会话
    session = db.exec(
        select(UserSession)
        .where(UserSession.user_id == current_user.id)
        .order_by(UserSession.last_active_at.desc())
        .limit(1)
    ).first()
    
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No active session"
        )
    
    # 延长会话过期时间
    session.expires_at = datetime.now(timezone.utc) + timedelta(
        hours=settings.session_expire_hours
    )
    db.add(session)
    db.commit()
    
    return {"message": "Session refreshed", "expires_at": session.expires_at}
