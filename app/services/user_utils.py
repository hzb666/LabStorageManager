"""
User Query Utilities - Batch user lookup for API responses
Eliminates N+1 query problems by caching user information
"""
from typing import Set, Dict, Optional
from sqlmodel import Session, select
from app.models.user import User


def batch_get_user_names(db: Session, user_ids: Set[Optional[int]]) -> Dict[int, str]:
    """
    Batch query user names by IDs.

    Args:
        db: Database session
        user_ids: Set of user IDs to query

    Returns:
        Dict mapping user_id to user display name (full_name or username)
    """
    # Filter out None values
    valid_ids = {uid for uid in user_ids if uid is not None}

    if not valid_ids:
        return {}

    users = db.exec(select(User).where(User.id.in_(valid_ids))).all()
    return {u.id: u.full_name or u.username for u in users}
