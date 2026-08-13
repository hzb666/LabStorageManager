from typing import Annotated

from fastapi import BackgroundTasks, Depends, Request
from sqlmodel import Session

from app.core.auth import resolve_current_session
from app.database import get_db
from app.models.user import User
from app.models.user_session import UserSession


def get_current_session(
    request: Request,
    background_tasks: BackgroundTasks,
    db: Annotated[Session, Depends(get_db, scope="function")],
) -> tuple[User, UserSession]:
    """
    Backward-compatible dependency alias.
    Real validation semantics are centralized in app.core.auth.
    """
    return resolve_current_session(request=request, background_tasks=background_tasks, db=db)
