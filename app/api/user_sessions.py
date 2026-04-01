# 用户会话与设备管理接口。
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
    SessionCacheIdentity,
    refresh_session_expiry,
    revoke_session,
    revoke_user_sessions,
    sync_session_cache,
)

from app.api.deps import get_current_session

router = APIRouter(prefix="/sessions", tags=["Sessions"])


class SessionResponse(BaseResponse):
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
    current_user, _ = current
    now = get_utc_now()
    sessions = db.exec(
        select(UserSession)
        .where(UserSession.user_id == current_user.id)
        .where(UserSession.expires_at > now)
        .order_by(UserSession.last_active_at.desc())
    ).all()

    return sessions


@router.delete("/{session_id}")
def delete_session(
    session_id: int,
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[tuple[User, UserSession], Depends(get_current_session)],
):
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
    current_user, current_session = current
    # 重新从数据库取当前会话，避免依赖依赖项里已过期的快照。
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
        identity=SessionCacheIdentity(
            user_id=current_user.id,
            username=current_user.username,
            is_active=current_user.is_active,
        ),
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
    device_name: str = Field(..., min_length=1, max_length=50)

    @field_validator("device_name", mode="before")
    @classmethod
    def normalize_device_name(cls, value: str) -> str:
        if value is None:
            raise ValueError("Device name is required")
        value = value.strip()
        if not value:
            raise ValueError("Device name cannot be empty after trimming")
        return cls._sanitize(value)

    @staticmethod
    def _sanitize(text: str) -> str:
        # 这里走白名单，避免黑名单替换被变体字符绕过。
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

    session.device_name = request.device_name
    db.add(session)
    db.commit()
    db.refresh(session)
    sync_session_cache(
        session=session,
        identity=SessionCacheIdentity(
            user_id=current_user.id,
            username=current_user.username,
            is_active=current_user.is_active,
        ),
        now_utc=now_utc,
    )

    return session
