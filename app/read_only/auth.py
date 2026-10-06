from __future__ import annotations

from datetime import timedelta

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request, Response, status
from jwt import PyJWTError
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.core.config import settings
from app.core.constants import (
    PASSWORD_MAX_LENGTH,
    PASSWORD_MIN_LENGTH,
    USERNAME_MAX_LENGTH,
    USERNAME_MIN_LENGTH,
)
from app.core.request_utils import get_client_ip
from app.core.time_utils import get_utc_now
from app.models.user import User, UserResponse
from app.read_only.database import get_snapshot_db
from app.read_only.session_store import create_session, revoke_session, validate_session
from app.read_only.snapshot import SnapshotMetadata
from app.services.rate_limit import enforce_rate_limit

READ_ONLY_TOKEN_TYPE = "maintenance_read_only"
DUMMY_PASSWORD_HASH = "$2b$12$.fU8VyfKMbsw1cKFr4iPKOOqBoaMiQku08uyAfQhmpAmboO1nGKa6"


class ReadOnlyLoginRequest(BaseModel):
    username: str = Field(min_length=USERNAME_MIN_LENGTH, max_length=USERNAME_MAX_LENGTH)
    password: str = Field(min_length=PASSWORD_MIN_LENGTH, max_length=PASSWORD_MAX_LENGTH)
    device_id: str | None = None
    device_name: str | None = None


def _auth_error(detail: str, code: str = "AUTH_INVALID_TOKEN") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"X-Auth-Error-Code": code, "WWW-Authenticate": "Bearer"},
    )


def _encode_token(user: User, metadata: SnapshotMetadata, session_id: str) -> str:
    now = get_utc_now()
    role = user.role.value if hasattr(user.role, "value") else str(user.role)
    payload = {
        "sub": str(user.id),
        "username": user.username,
        "username_version": user.username_version or 1,
        "role": role,
        "type": READ_ONLY_TOKEN_TYPE,
        "snapshot_id": metadata.snapshot_id,
        "session_id": session_id,
        "iat": now,
        "exp": now + timedelta(minutes=settings.read_only_token_expire_minutes),
    }
    key = settings.get_private_key() if settings.algorithm == "RS256" else settings.secret_key
    return jwt.encode(payload, key, algorithm=settings.algorithm)


def _decode_token(token: str) -> dict:
    key = settings.get_public_key() if settings.algorithm == "RS256" else settings.secret_key
    try:
        return jwt.decode(token, key, algorithms=[settings.algorithm])
    except PyJWTError as error:
        raise _auth_error("Invalid or expired token") from error


def _extract_token(request: Request) -> str:
    token = request.cookies.get("access_token", "").strip()
    if not token:
        authorization = request.headers.get("Authorization", "")
        scheme, _, credentials = authorization.partition(" ")
        if scheme.lower() == "bearer":
            token = credentials.strip()
    if not token:
        raise _auth_error("Not authenticated", "AUTH_MISSING_TOKEN")
    return token


def resolve_read_only_user(
    request: Request,
    metadata: SnapshotMetadata,
    db: Session,
) -> User:
    payload = _decode_token(_extract_token(request))
    if (
        payload.get("type") != READ_ONLY_TOKEN_TYPE
        or payload.get("snapshot_id") != metadata.snapshot_id
    ):
        raise _auth_error("Session does not belong to the current maintenance snapshot")
    try:
        user_id = int(payload.get("sub", ""))
    except (TypeError, ValueError) as error:
        raise _auth_error("Invalid token identity") from error
    session_id = str(payload.get("session_id") or "")
    if not session_id or not validate_session(metadata.snapshot_id, session_id, user_id):
        raise _auth_error("Read-only session has expired", "AUTH_SESSION_EXPIRED")
    user = db.get(User, user_id)
    if user is None:
        raise _auth_error("User not found", "AUTH_USER_NOT_FOUND")
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is disabled",
            headers={"X-Auth-Error-Code": "AUTH_USER_DISABLED"},
        )
    if (
        payload.get("username") != user.username
        or payload.get("username_version") != (user.username_version or 1)
    ):
        raise _auth_error("User identity has changed", "AUTH_SESSION_VERSION_MISMATCH")
    return user


def get_current_user(
    request: Request,
    db: Session = Depends(get_snapshot_db),  # noqa: B008
) -> User:
    metadata = request.app.state.snapshot_metadata
    return resolve_read_only_user(request, metadata, db)


def authenticate_user(
    body: ReadOnlyLoginRequest,
    request: Request,
    metadata: SnapshotMetadata,
    db: Session,
) -> tuple[User, str]:
    normalized_username = body.username.strip()
    enforce_rate_limit(
        scope="read_only_login",
        identifier=f"{get_client_ip(request)}:{normalized_username.casefold()}",
        limit=5,
        window_seconds=300,
    )
    user = db.exec(select(User).where(User.username == normalized_username)).first()
    password_hash = user.password_hash if user else DUMMY_PASSWORD_HASH
    try:
        password_valid = bcrypt.checkpw(body.password.encode(), password_hash.encode())
    except (TypeError, ValueError):
        password_valid = False
    if user is None or not password_valid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is disabled",
        )
    ttl_seconds = settings.read_only_token_expire_minutes * 60
    session_id = create_session(metadata.snapshot_id, user.id or 0, ttl_seconds)
    return user, _encode_token(user, metadata, session_id)


def revoke_request_session(request: Request, metadata: SnapshotMetadata) -> None:
    try:
        payload = _decode_token(_extract_token(request))
    except HTTPException:
        return
    if (
        payload.get("type") != READ_ONLY_TOKEN_TYPE
        or payload.get("snapshot_id") != metadata.snapshot_id
    ):
        return
    session_id = str(payload.get("session_id") or "")
    if session_id:
        revoke_session(metadata.snapshot_id, session_id)


def user_response(user: User) -> dict:
    return UserResponse.model_validate(user).model_dump(mode="json")


def set_auth_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        secure=settings.use_secure_runtime(),
        samesite="lax",
        max_age=settings.read_only_token_expire_minutes * 60,
        path="/",
    )
