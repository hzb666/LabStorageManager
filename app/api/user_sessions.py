# 用户会话与设备管理接口。
import logging
import re
from datetime import datetime
from typing import List, Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field, field_validator
from sqlmodel import Session, select

from app.core.config import settings
from app.core.constants import SECONDS_PER_HOUR
from app.core.auth import AUTH_ERROR_CODE_HEADER, AuthErrorCode, create_access_token
from app.core.request_utils import get_client_ip, get_request_id, get_request_is_cli
from app.core.time_utils import get_utc_now, utc_iso_str
from app.database import get_db
from app.models import BaseResponse
from app.models.user import User
from app.models.user_operation_log import UserOperationAction
from app.models.user_session import UserSession
from app.services.session_service import (
    SessionCacheIdentity,
    StagedSessionRefresh,
    finalize_session_refresh,
    finalize_revoked_sessions,
    refresh_session_expiry,
    revoke_session,
    stage_revoke_user_sessions,
    sync_session_cache,
)
from app.services.user_operation_logger import log_user_operation

from app.api.deps import get_current_session

router = APIRouter(prefix="/sessions", tags=["Sessions"])
logger = logging.getLogger(__name__)


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


class SessionRefreshResponse(BaseResponse):
    message: str
    expires_at: datetime


def _build_session_snapshot(session: UserSession | None) -> dict[str, object]:
    if session is None:
        return {}
    return {
        "session_id": session.id,
        "device_id": session.device_id,
        "device_name": session.device_name,
        "ip_address": session.ip_address,
        "last_ip_address": session.last_ip_address,
        "user_agent": session.user_agent,
        "created_at": utc_iso_str(session.created_at),
        "last_active_at": utc_iso_str(session.last_active_at),
        "expires_at": utc_iso_str(session.expires_at),
    }


def _log_session_operation(
    db: Session,
    *,
    request: Request,
    current_user: User,
    action: UserOperationAction,
    detail: str,
    snapshot: dict[str, object],
) -> None:
    log_user_operation(
        db,
        action=action,
        actor_user_id=current_user.id,
        target_user_id=current_user.id,
        client_ip=get_client_ip(request),
        request_id=get_request_id(request),
        detail=detail,
        snapshot=snapshot,
        is_cli=get_request_is_cli(request),
    )


def _apply_refresh_post_commit_side_effects(
    db: Session,
    *,
    staged_refresh: StagedSessionRefresh,
    identity: SessionCacheIdentity,
) -> UserSession:
    try:
        return finalize_session_refresh(
            db,
            staged=staged_refresh,
            identity=identity,
        )
    except Exception:
        # 提交后副作用失败不应让 refresh 退化成 500；数据库已是新 token 真值。
        logger.exception(
            "Post-commit session refresh side effects failed user_id=%s session_id=%s",
            identity.user_id,
            staged_refresh.session.id,
        )
        return staged_refresh.session


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
    request: Request,
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

    snapshot = _build_session_snapshot(session)
    token_hash = session.token_hash
    revoke_session(db, session, reason="session_kicked", commit=False)
    _log_session_operation(
        db,
        request=request,
        current_user=current_user,
        action=UserOperationAction.DELETE_SESSION,
        detail=f"设备={snapshot.get('device_name') or session_id}",
        snapshot={
            "before": snapshot,
            "after": {},
        },
    )
    db.commit()
    finalize_revoked_sessions([token_hash], reason="session_kicked")
    
    return {"message": "Session deleted successfully"}


@router.delete("/")
def delete_all_sessions(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[tuple[User, UserSession], Depends(get_current_session)]
):
    current_user, current_session = current

    token_hashes = stage_revoke_user_sessions(
        db,
        current_user.id,
        except_token_hash=current_session.token_hash,
    )
    deleted_count = len(token_hashes)
    _log_session_operation(
        db,
        request=request,
        current_user=current_user,
        action=UserOperationAction.DELETE_OTHER_SESSIONS,
        detail=f"数量={deleted_count}",
        snapshot={"count": deleted_count},
    )
    db.commit()
    finalize_revoked_sessions(token_hashes, reason="kick_other_devices")

    return {"message": f"Deleted {deleted_count} sessions"}


@router.post("/refresh", response_model=SessionRefreshResponse)
def refresh_session(
    request: Request,
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
    
    before_snapshot = _build_session_snapshot(session)
    user_role = current_user.role.value if hasattr(current_user.role, "value") else str(current_user.role)
    access_token = create_access_token(
        user_id=current_user.id,
        username=current_user.username,
        role=user_role,
        username_version=current_user.username_version or 1,
    )
    identity = SessionCacheIdentity(
        user_id=current_user.id,
        username=current_user.username,
        is_active=current_user.is_active,
    )

    staged_refresh = refresh_session_expiry(
        db,
        session=session,
        new_token=access_token,
    )
    _log_session_operation(
        db,
        request=request,
        current_user=current_user,
        action=UserOperationAction.REFRESH_SESSION,
        detail=f"设备={staged_refresh.session.device_name}",
        snapshot={
            "before": before_snapshot,
            "after": _build_session_snapshot(staged_refresh.session),
        },
    )
    db.commit()
    refreshed = _apply_refresh_post_commit_side_effects(
        db,
        staged_refresh=staged_refresh,
        identity=identity,
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

    return SessionRefreshResponse(
        message="Session refreshed",
        expires_at=refreshed.expires_at,
    )


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
    http_request: Request,
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[tuple[User, UserSession], Depends(get_current_session)],
    request: SessionUpdateRequest,
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

    before_snapshot = _build_session_snapshot(session)
    session.device_name = request.device_name
    db.add(session)
    _log_session_operation(
        db,
        request=http_request,
        current_user=current_user,
        action=UserOperationAction.UPDATE_SESSION,
        detail=f"设备={session.device_name}",
        snapshot={
            "before": before_snapshot,
            "after": _build_session_snapshot(session),
        },
    )
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
