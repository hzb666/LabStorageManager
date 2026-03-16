"""
User Sessions API - Device Management
"""
from datetime import datetime, timedelta
from typing import List, Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlmodel import Session, select

from app.core.config import settings
from app.core.time_utils import get_utc_now
from app.core.redis import delete_cached_session
from app.database import get_db
from app.models import BaseResponse
from app.models.user import User
from app.models.user_session import UserSession

# 导入 get_current_session 用于获取当前会话
from app.api.deps import get_current_session

# 直接使用 auth 模块的 get_current_user
from app.core.auth import get_current_user

router = APIRouter(prefix="/sessions", tags=["Sessions"])


class SessionResponse(BaseResponse):
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


@router.get("/", response_model=List[SessionResponse])
def list_sessions(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)]
):
    """List all sessions for current user (excluding expired)"""
    now = get_utc_now()
    sessions = db.exec(
        select(UserSession)
        .where(UserSession.user_id == current_user.id)
        .where(UserSession.expires_at > now)  # 过滤掉过期的会话
        .order_by(UserSession.last_active_at.desc())
    ).all()

    return sessions


@router.delete("/{session_id}")
def delete_session(
    session_id: int,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)]
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
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    current_session: Annotated[UserSession, Depends(get_current_session)]
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
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    current: Annotated[tuple[User, UserSession], Depends(get_current_session)]
):
    """Refresh current session expiration time"""
    # 解包 tuple
    _, current_session = current
    # 获取当前会话（通过 token_hash 精确匹配当前会话）
    session = db.get(UserSession, current_session.id)
    
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No active session"
        )
    
    # 延长会话过期时间
    session.expires_at = get_utc_now() + timedelta(
        hours=settings.session_expire_hours
    )
    db.add(session)
    db.commit()
    
    return {"message": "Session refreshed", "expires_at": session.expires_at}


class SessionUpdateRequest(BaseModel):
    """Request model for updating session"""
    device_name: str = Field(..., min_length=1, max_length=50)

    @field_validator("device_name", mode="before")
    @classmethod
    def normalize_device_name(cls, value: str) -> str:
        """标准化并清洗设备名称：strip + 非空校验 + XSS 过滤"""
        if value is None:
            raise ValueError("Device name is required")
        # 标准化：去除前后空格
        value = value.strip()
        # strip 后再次验证，防止全空格输入
        if not value:
            raise ValueError("Device name cannot be empty after trimming")
        # XSS 过滤：移除危险字符
        return cls._sanitize(value)

    @staticmethod
    def _sanitize(text: str) -> str:
        """XSS 过滤：移除 HTML/JS 危险字符"""
        import html
        # 转义 HTML 实体
        text = html.escape(text)
        # 移除 script 标签（虽然 escape 已经转义了 < 和 >，但额外过滤更安全）
        text = text.replace("<script", "").replace("</script", "")
        text = text.replace("<iframe", "").replace("</iframe", "")
        text = text.replace("javascript:", "")
        text = text.replace("onerror=", "").replace("onclick=", "")
        return text


@router.patch("/{session_id}", response_model=SessionResponse)
def update_session(
    session_id: int,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    request: SessionUpdateRequest
):
    """Update a session's device name"""
    session = db.get(UserSession, session_id)

    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found"
        )

    # 检查 session 是否已过期
    if session.expires_at <= get_utc_now():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session has expired"
        )

    # 只能修改自己的会话
    if session.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot update other user's session"
        )

    # 更新设备名称
    session.device_name = request.device_name
    db.add(session)
    db.commit()
    db.refresh(session)

    return session
