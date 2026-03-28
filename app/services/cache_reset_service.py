"""Startup cache reset coordination for versioned invalidation."""
import logging
from dataclasses import dataclass

from sqlmodel import Session

from app.core.config import settings
from app.core.redis import REDIS_KEY_PREFIX, delete_keys_by_prefix
from app.database import engine
from app.models.runtime_state import RuntimeState
from app.services.session_service import revoke_all_sessions

logger = logging.getLogger(__name__)

RUNTIME_CACHE_VERSION_KEY = "startup_cache_version"
CACHE_VERSION_RESET_REASON = "cache_version_changed"


@dataclass(frozen=True)
class CacheResetResult:
    applied: bool
    previous_version: str | None
    current_version: str
    revoked_sessions: int
    redis_cleanup_succeeded: bool
    deleted_redis_keys: int


def _load_runtime_state(session: Session) -> RuntimeState | None:
    return session.get(RuntimeState, RUNTIME_CACHE_VERSION_KEY)


def _persist_runtime_state(
    session: Session,
    *,
    runtime_state: RuntimeState | None,
    current_version: str,
) -> None:
    state = runtime_state or RuntimeState(key=RUNTIME_CACHE_VERSION_KEY)
    state.value = current_version
    session.add(state)
    session.commit()


def apply_startup_cache_reset_if_needed() -> CacheResetResult:
    current_version = settings.cache_version

    with Session(engine) as session:
        runtime_state = _load_runtime_state(session)
        previous_version = runtime_state.value.strip() if runtime_state and runtime_state.value else None
        if previous_version == current_version:
            return CacheResetResult(
                applied=False,
                previous_version=previous_version,
                current_version=current_version,
                revoked_sessions=0,
                redis_cleanup_succeeded=True,
                deleted_redis_keys=0,
            )

        revoked_sessions = revoke_all_sessions(
            session,
            reason=CACHE_VERSION_RESET_REASON,
            commit=True,
        )
        redis_cleanup_result = delete_keys_by_prefix(REDIS_KEY_PREFIX)
        if not redis_cleanup_result.success:
            logger.warning(
                "Startup cache reset paused because Redis cleanup failed: previous=%s current=%s revoked_sessions=%s deleted_redis_keys=%s",
                previous_version or "<unset>",
                current_version,
                revoked_sessions,
                redis_cleanup_result.deleted_count,
            )
            return CacheResetResult(
                applied=False,
                previous_version=previous_version,
                current_version=current_version,
                revoked_sessions=revoked_sessions,
                redis_cleanup_succeeded=False,
                deleted_redis_keys=redis_cleanup_result.deleted_count,
            )

        _persist_runtime_state(
            session,
            runtime_state=runtime_state,
            current_version=current_version,
        )

    logger.warning(
        "Applied startup cache reset due to cache version change: previous=%s current=%s revoked_sessions=%s deleted_redis_keys=%s",
        previous_version or "<unset>",
        current_version,
        revoked_sessions,
        redis_cleanup_result.deleted_count,
    )
    return CacheResetResult(
        applied=True,
        previous_version=previous_version,
        current_version=current_version,
        revoked_sessions=revoked_sessions,
        redis_cleanup_succeeded=True,
        deleted_redis_keys=redis_cleanup_result.deleted_count,
    )
