from dataclasses import dataclass
from typing import Annotated

from fastapi import BackgroundTasks, Depends, HTTPException, Request, status
from sqlmodel import Session

from app.core.auth import AUTH_ERROR_CODE_HEADER, AuthErrorCode, resolve_current_session
from app.database import get_db
from app.models.user import User
from app.models.user_session import UserSession


@dataclass(frozen=True)
class SSEAuthFailure:
    reason: str
    code: str


SSECurrentSession = tuple[User, UserSession] | SSEAuthFailure


def _get_sse_auth_reason(code: str) -> str:
    if code == AuthErrorCode.USER_DISABLED:
        return "user_deactivated"
    if code == AuthErrorCode.SESSION_EXPIRED:
        return "session_revalidation_failed"
    return "session_revoked"


def get_current_session(
    request: Request,
    background_tasks: BackgroundTasks,
    db: Annotated[Session, Depends(get_db)],
) -> tuple[User, UserSession]:
    """
    Backward-compatible dependency alias.
    Real validation semantics are centralized in app.core.auth.
    """
    return resolve_current_session(request=request, background_tasks=background_tasks, db=db)


def get_sse_current_session(
    request: Request,
    background_tasks: BackgroundTasks,
    db: Annotated[Session, Depends(get_db, scope="function")],
) -> SSECurrentSession:
    """Resolve SSE auth without turning an invalid session into a reconnecting HTTP error."""
    try:
        return resolve_current_session(request=request, background_tasks=background_tasks, db=db)
    except HTTPException as exc:
        if exc.status_code not in {
            status.HTTP_401_UNAUTHORIZED,
            status.HTTP_403_FORBIDDEN,
        }:
            raise

        code = (exc.headers or {}).get(
            AUTH_ERROR_CODE_HEADER,
            AuthErrorCode.SESSION_REVOKED,
        )
        return SSEAuthFailure(reason=_get_sse_auth_reason(code), code=code)
