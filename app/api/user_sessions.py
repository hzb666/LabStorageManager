"""
User Sessions API - Device Management
"""
import re
from datetime import datetime
from typing import List, Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field, field_validator
from sqlmodel import Session, select

from app.core.config import settings
from app.core.constants import SECONDS_PER_HOUR
from app.core.auth import AUTH_ERROR_CODE_HEADER, AuthErrorCode, create_access_token
from app.core.time_utils import get_utc_now
from app.database import get_db
from app.models import BaseResponse
from app.models.user import User
from app.models.user_session import UserSession
from app.services.session_service import (
    refresh_session_expiry,
    revoke_session,
    revoke_user_sessions,
    sync_session_cache,
)

# 导入 get_current_session 用于获取当前会话
from app.api.deps import get_current_session

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
    current: Annotated[tuple[User, UserSession], Depends(get_current_session)],
):
    """List all sessions for current user (excluding expired)"""
    current_user, _ = current
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
    current: Annotated[tuple[User, UserSession], Depends(get_current_session)],
):
    """Delete a specific session (kick user off a device)"""
    current_user, _ = current
    session = db.exec(
        select(UserSession)
        .where(UserSession.id == session_id)
        .where(UserSession.user_id == current_user.id)
    ).first()
    
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found"
        )

    revoke_session(db, session, reason="session_kicked", commit=True)
    
    return {"message": "Session deleted successfully"}


@router.delete("/")
def delete_all_sessions(
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[tuple[User, UserSession], Depends(get_current_session)]
):
    """Delete all sessions for current user except the current session"""
    current_user, current_session = current

    deleted_count = revoke_user_sessions(
        db,
        current_user.id,
        reason="kick_other_devices",
        except_token_hash=current_session.token_hash,
    )

    return {"message": f"Deleted {deleted_count} sessions"}


@router.post("/refresh")
def refresh_session(
    response: Response,
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[tuple[User, UserSession], Depends(get_current_session)]
):
    """Refresh current session expiration time"""
    # 解包 tuple
    current_user, current_session = current
    # 获取当前会话（通过 token_hash 精确匹配当前会话）
    session = db.get(UserSession, current_session.id)
    
    if not session:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session has been revoked, please login again",
            headers={
                AUTH_ERROR_CODE_HEADER: AuthErrorCode.SESSION_REVOKED,
                "WWW-Authenticate": "Bearer",
            },
        )
    
    user_role = current_user.role.value if hasattr(current_user.role, "value") else str(current_user.role)
    access_token = create_access_token(
        user_id=current_user.id,
        username=current_user.username,
        role=user_role,
        username_version=current_user.username_version or 1,
    )

    refreshed = refresh_session_expiry(
        db,
        user_id=current_user.id,
        username=current_user.username,
        is_active=current_user.is_active,
        session=session,
        new_token=access_token,
    )

    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        secure=settings.use_secure_runtime(),
        samesite="lax",
        max_age=settings.session_expire_hours * SECONDS_PER_HOUR,
        path="/",
    )

    return {"message": "Session refreshed", "expires_at": refreshed.expires_at}


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
        """设备名白名单清洗，避免依赖可绕过的黑名单替换。"""
        sanitized = re.sub(r"[^0-9A-Za-z\u4e00-\u9fff _\-().#]", "", text)
        sanitized = re.sub(r"\s+", " ", sanitized).strip()
        if not sanitized:
            raise ValueError("Device name contains invalid characters")
        return sanitized


@router.patch("/{session_id}", response_model=SessionResponse)
def update_session(
    session_id: int,
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[tuple[User, UserSession], Depends(get_current_session)],
    request: SessionUpdateRequest
):
    """Update a session's device name"""
    current_user, _ = current
    session = db.exec(
        select(UserSession)
        .where(UserSession.id == session_id)
        .where(UserSession.user_id == current_user.id)
    ).first()

    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found"
        )

    now_utc = get_utc_now()
    if session.expires_at <= now_utc:
        revoke_session(db, session, reason="session_expired_cleanup", commit=True)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired",
            headers={
                AUTH_ERROR_CODE_HEADER: AuthErrorCode.SESSION_EXPIRED,
                "WWW-Authenticate": "Bearer",
            },
        )

    # 更新设备名称
    session.device_name = request.device_name
    db.add(session)
    db.commit()
    db.refresh(session)
    sync_session_cache(
        session=session,
        user_id=current_user.id,
        username=current_user.username,
        is_active=current_user.is_active,
        now_utc=now_utc,
    )

    return session
