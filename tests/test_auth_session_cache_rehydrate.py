from __future__ import annotations

import unittest
from datetime import timedelta
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from starlette.requests import Request

from app.core import auth
from app.core.redis import CachedSessionState
from app.core.time_utils import get_utc_now
from app.models.user import User, UserRole
from app.models.user_session import UserSession


class _FakeExecResult:
    def __init__(self, value) -> None:
        self._value = value

    def first(self):
        return self._value


def _build_active_user() -> User:
    return User(
        id=1,
        username="admin",
        full_name="管理员",
        role=UserRole.ADMIN,
        is_active=True,
        password_hash="hashed",
        username_version=1,
    )


def _build_request(*, token: str = "token-value", client_ip: str = "127.0.0.1") -> Request:
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/api/users/me",
            "headers": [(b"cookie", f"access_token={token}".encode())],
            "client": (client_ip, 12345),
        }
    )


def _build_session(token_hash: str, *, expires_delta: timedelta) -> UserSession:
    now_utc = get_utc_now()
    return UserSession(
        id=10,
        user_id=1,
        device_id="device-1",
        device_name="Chrome",
        ip_address="127.0.0.1",
        last_ip_address="127.0.0.1",
        user_agent="ua",
        token_hash=token_hash,
        last_active_at=now_utc,
        expires_at=now_utc + expires_delta,
    )


def _cache_state(
    session_data: dict | None = None,
    *,
    is_revoked: bool = False,
) -> CachedSessionState:
    return CachedSessionState(session_data=session_data, is_revoked=is_revoked)


class AuthSessionCacheRehydrateTests(unittest.TestCase):
    def test_resolve_current_session_uses_valid_cache_without_session_db_lookup(self) -> None:
        token = "token-value"
        now_utc = get_utc_now()
        user = _build_active_user()
        fake_db = MagicMock()
        fake_db.get.return_value = user
        cached_session = {
            "session_id": 10,
            "user_id": user.id,
            "device_id": "device-1",
            "device_name": "Chrome",
            "ip_address": "127.0.0.1",
            "last_ip_address": "127.0.0.1",
            "user_agent": "ua",
            "expires_at": (now_utc + timedelta(hours=1)).isoformat(),
            "last_active_at": now_utc.isoformat(),
        }

        with (
            patch("app.core.auth.decode_token", return_value={"type": "access", "sub": "1", "username_version": 1}),
            patch("app.core.auth.get_cached_session_state", return_value=_cache_state(cached_session)),
            patch("app.core.auth.delete_cached_session") as delete_cached_session,
            patch("app.core.auth.sync_session_cache") as sync_session_cache,
        ):
            resolved_user, resolved_session = auth.resolve_current_session(
                request=_build_request(token=token),
                background_tasks=None,
                db=fake_db,
            )

        self.assertEqual(resolved_user.id, user.id)
        self.assertEqual(resolved_session.id, cached_session["session_id"])
        fake_db.get.assert_called_once_with(User, user.id)
        fake_db.exec.assert_not_called()
        delete_cached_session.assert_not_called()
        sync_session_cache.assert_not_called()

    def test_resolve_current_session_rejects_revoked_cache_without_db_lookup(self) -> None:
        token = "token-value"
        token_hash = auth._compute_token_hash(token)
        fake_db = MagicMock()

        with (
            patch("app.core.auth.decode_token", return_value={"type": "access", "sub": "1", "username_version": 1}),
            patch("app.core.auth.get_cached_session_state", return_value=_cache_state(is_revoked=True)),
            patch("app.core.auth.delete_cached_session") as delete_cached_session,
        ):
            with self.assertRaises(HTTPException) as exc_info:
                auth.resolve_current_session(
                    request=_build_request(token=token),
                    background_tasks=None,
                    db=fake_db,
                )

        self.assertEqual(exc_info.exception.status_code, 401)
        delete_cached_session.assert_called_once_with(token_hash)
        fake_db.get.assert_not_called()
        fake_db.exec.assert_not_called()

    def test_resolve_current_session_invalidates_wrong_user_cache_then_rehydrates_from_db(self) -> None:
        token = "token-value"
        token_hash = auth._compute_token_hash(token)
        now_utc = get_utc_now()
        user = _build_active_user()
        db_session = _build_session(token_hash, expires_delta=timedelta(hours=1))
        fake_db = MagicMock()
        fake_db.exec.return_value = _FakeExecResult((user, db_session))

        stale_cache = {
            "session_id": 10,
            "user_id": 999,
            "device_id": "device-1",
            "device_name": "Chrome",
            "ip_address": "127.0.0.1",
            "last_ip_address": "127.0.0.1",
            "user_agent": "ua",
            "expires_at": (now_utc + timedelta(hours=1)).isoformat(),
            "last_active_at": now_utc.isoformat(),
        }

        with (
            patch("app.core.auth.decode_token", return_value={"type": "access", "sub": "1", "username_version": 1}),
            patch("app.core.auth.get_cached_session_state", return_value=_cache_state(stale_cache)),
            patch("app.core.auth.delete_cached_session") as delete_cached_session,
            patch("app.core.auth.sync_session_cache") as sync_session_cache,
        ):
            resolved_user, resolved_session = auth.resolve_current_session(
                request=_build_request(token=token),
                background_tasks=None,
                db=fake_db,
            )

        self.assertEqual(resolved_user.id, user.id)
        self.assertEqual(resolved_session.id, db_session.id)
        delete_cached_session.assert_called_once_with(token_hash)
        sync_session_cache.assert_called_once()

    def test_resolve_current_session_rehydrates_after_expired_cached_session(self) -> None:
        token = "token-value"
        token_hash = auth._compute_token_hash(token)
        now_utc = get_utc_now()
        user = _build_active_user()
        db_session = _build_session(token_hash, expires_delta=timedelta(hours=1))
        fake_db = MagicMock()
        fake_db.exec.return_value = _FakeExecResult((user, db_session))
        expired_cache = {
            "session_id": 10,
            "user_id": user.id,
            "device_id": "device-1",
            "device_name": "Chrome",
            "ip_address": "127.0.0.1",
            "last_ip_address": "127.0.0.1",
            "user_agent": "ua",
            "expires_at": (now_utc - timedelta(minutes=1)).isoformat(),
            "last_active_at": now_utc.isoformat(),
        }

        with (
            patch("app.core.auth.decode_token", return_value={"type": "access", "sub": "1", "username_version": 1}),
            patch("app.core.auth.get_cached_session_state", return_value=_cache_state(expired_cache)),
            patch("app.core.auth.delete_cached_session") as delete_cached_session,
            patch("app.core.auth.sync_session_cache") as sync_session_cache,
        ):
            resolved_user, resolved_session = auth.resolve_current_session(
                request=_build_request(token=token),
                background_tasks=None,
                db=fake_db,
            )

        self.assertEqual(resolved_user.id, user.id)
        self.assertEqual(resolved_session.id, db_session.id)
        delete_cached_session.assert_called_once_with(token_hash)
        sync_session_cache.assert_called_once()

    def test_is_token_session_active_rehydrates_cache_on_redis_miss(self) -> None:
        token_hash = "token-hash"
        user = _build_active_user()
        db_session = _build_session(token_hash, expires_delta=timedelta(hours=1))
        fake_db = MagicMock()
        fake_db.exec.return_value = _FakeExecResult((user, db_session))
        fake_session_ctx = MagicMock()
        fake_session_ctx.__enter__.return_value = fake_db
        fake_session_ctx.__exit__.return_value = False

        with (
            patch("app.core.auth.get_cached_session_state", return_value=_cache_state()),
            patch("app.core.auth.Session", return_value=fake_session_ctx),
            patch("app.core.auth.delete_cached_session"),
            patch("app.core.auth.sync_session_cache") as sync_session_cache,
        ):
            is_active = auth.is_token_session_active(token_hash, client_ip="127.0.0.1")

        self.assertTrue(is_active)
        sync_session_cache.assert_called_once()

    def test_is_token_session_active_does_not_rehydrate_expired_session(self) -> None:
        token_hash = "token-hash"
        user = _build_active_user()
        db_session = _build_session(token_hash, expires_delta=timedelta(minutes=-1))
        fake_db = MagicMock()
        fake_db.exec.return_value = _FakeExecResult((user, db_session))
        fake_session_ctx = MagicMock()
        fake_session_ctx.__enter__.return_value = fake_db
        fake_session_ctx.__exit__.return_value = False

        with (
            patch("app.core.auth.get_cached_session_state", return_value=_cache_state()),
            patch("app.core.auth.Session", return_value=fake_session_ctx),
            patch("app.core.auth.delete_cached_session"),
            patch("app.core.auth.sync_session_cache") as sync_session_cache,
        ):
            is_active = auth.is_token_session_active(token_hash, client_ip="127.0.0.1")

        self.assertFalse(is_active)
        sync_session_cache.assert_not_called()

    def test_is_token_session_active_does_not_rehydrate_disabled_user(self) -> None:
        token_hash = "token-hash"
        user = _build_active_user()
        user.is_active = False
        db_session = _build_session(token_hash, expires_delta=timedelta(hours=1))
        fake_db = MagicMock()
        fake_db.exec.return_value = _FakeExecResult((user, db_session))
        fake_session_ctx = MagicMock()
        fake_session_ctx.__enter__.return_value = fake_db
        fake_session_ctx.__exit__.return_value = False

        with (
            patch("app.core.auth.get_cached_session_state", return_value=_cache_state()),
            patch("app.core.auth.Session", return_value=fake_session_ctx),
            patch("app.core.auth.delete_cached_session"),
            patch("app.core.auth.sync_session_cache") as sync_session_cache,
        ):
            is_active = auth.is_token_session_active(token_hash, client_ip="127.0.0.1")

        self.assertFalse(is_active)
        sync_session_cache.assert_not_called()


if __name__ == "__main__":
    unittest.main()
