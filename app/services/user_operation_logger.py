"""User operation logging helpers."""
from __future__ import annotations

import json
from typing import Any

from sqlmodel import Session

from app.models.user import User
from app.models.user_operation_log import UserOperationAction, UserOperationLog
from app.services.log_timeline_projection import project_user_operation_log

USER_SNAPSHOT_KEY_MAP = {
    "id": "id",
    "un": "username",
    "fn": "full_name",
    "ro": "role",
    "ac": "is_active",
    "av": "avatar_url",
    "uv": "username_version",
    "cr": "created_at",
    "up": "updated_at",
    "bf": "before",
    "af": "after",
}


def _enum_value(value: Any) -> Any:
    return value.value if hasattr(value, "value") else value


def build_user_snapshot(user: User | None) -> dict[str, Any]:
    """Build a compact user snapshot payload without password fields."""

    if user is None:
        return {}
    return {
        "id": user.id,
        "un": user.username,
        "fn": user.full_name,
        "ro": _enum_value(user.role),
        "ac": user.is_active,
        "av": user.avatar_url,
        "uv": user.username_version,
        "cr": user.created_at.isoformat() if user.created_at else None,
        "up": user.updated_at.isoformat() if user.updated_at else None,
    }


def parse_user_operation_snapshot(snapshot_json: str) -> dict[str, Any]:
    """Parse persisted user operation snapshot JSON safely."""

    try:
        parsed = json.loads(snapshot_json)
    except json.JSONDecodeError:
        return {}
    if not isinstance(parsed, dict):
        return {}

    normalized: dict[str, Any] = {}
    for key, value in parsed.items():
        if key in {"bf", "af"} and isinstance(value, dict):
            nested: dict[str, Any] = {}
            for nested_key, nested_value in value.items():
                nested[USER_SNAPSHOT_KEY_MAP.get(nested_key, nested_key)] = nested_value
            normalized[USER_SNAPSHOT_KEY_MAP.get(key, key)] = nested
            continue
        normalized[USER_SNAPSHOT_KEY_MAP.get(key, key)] = value
    return normalized


def log_user_operation(
    db: Session,
    *,
    action: UserOperationAction,
    actor_user_id: int | None,
    target_user_id: int | None,
    outcome: str = "success",
    client_ip: str | None = None,
    request_id: str | None = None,
    detail: str | None = None,
    snapshot: dict[str, Any] | None = None,
    is_cli: bool,
) -> UserOperationLog:
    """Persist a user operation log entry."""

    payload = snapshot or {}
    log = UserOperationLog(
        actor_user_id=actor_user_id,
        target_user_id=target_user_id,
        action=action,
        outcome=outcome,
        client_ip=client_ip,
        request_id=request_id,
        detail=detail,
        snapshot_json=json.dumps(payload, ensure_ascii=False, sort_keys=True),
    )
    db.add(log)
    db.flush([log])
    project_user_operation_log(db, log=log, is_cli=is_cli)
    return log


def log_user_profile_update(
    db: Session,
    *,
    actor_user_id: int | None,
    target_user_id: int | None,
    before_user: User,
    after_user: User,
    client_ip: str | None,
    request_id: str | None,
    detail: str | None = None,
    is_cli: bool,
) -> UserOperationLog:
    """Persist a user profile update log entry with before/after snapshots."""

    snapshot = {
        "bf": build_user_snapshot(before_user),
        "af": build_user_snapshot(after_user),
    }
    return log_user_operation(
        db,
        action=UserOperationAction.UPDATE_PROFILE,
        actor_user_id=actor_user_id,
        target_user_id=target_user_id,
        outcome="success",
        client_ip=client_ip,
        request_id=request_id,
        detail=detail,
        snapshot=snapshot,
        is_cli=is_cli,
    )


def log_user_sensitive_update(
    db: Session,
    *,
    actor_user_id: int | None,
    target_user_id: int | None,
    before_user: User,
    after_user: User,
    client_ip: str | None,
    request_id: str | None,
    detail: str | None,
    is_cli: bool,
) -> UserOperationLog:
    """Persist a sensitive user update log entry with before/after snapshots."""

    snapshot = {
        "bf": build_user_snapshot(before_user),
        "af": build_user_snapshot(after_user),
    }
    return log_user_operation(
        db,
        action=UserOperationAction.UPDATE_USER_SENSITIVE_FIELDS,
        actor_user_id=actor_user_id,
        target_user_id=target_user_id,
        outcome="success",
        client_ip=client_ip,
        request_id=request_id,
        detail=detail,
        snapshot=snapshot,
        is_cli=is_cli,
    )
