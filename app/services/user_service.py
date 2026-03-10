"""
User Service - User data access layer

This module provides user data query functions used by the API layer.
"""
from typing import Optional

from sqlmodel import Session, select

from app.models.user import User


def get_user_by_username(db: Session, username: str) -> Optional[User]:
    """Get user by username"""
    statement = select(User).where(User.username == username)
    result = db.exec(statement).first()
    return result


def get_user_by_id(db: Session, user_id: int) -> Optional[User]:
    """Get user by ID"""
    return db.get(User, user_id)
