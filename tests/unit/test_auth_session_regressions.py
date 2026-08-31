from __future__ import annotations

import unittest
from datetime import timedelta
from unittest.mock import MagicMock, patch

from fastapi import BackgroundTasks, HTTPException
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine
from starlette.requests import Request

from app.api import users as users_api
from app.core import auth
from app.core.redis import CachedSessionState
from app.core.time_utils import get_utc_now
from app.models.user import User, UserRole, UserUpdate
from app.models.user_session import UserSession


class _FakeExecResult:
    def __init__(self, value) -> None:
        self._value = value

    def first(self):
        return self._value


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


def _cache_state(
    session_data: dict | None = None,
    *,
    is_revoked: bool = False,
) -> CachedSessionState:
    return CachedSessionState(session_data=session_data, is_revoked=is_revoked)


class AuthSessionRegressionTests(unittest.TestCase):
    def test_resolve_current_session_does_not_dirty_request_session_when_scheduling_activity_refresh(self) -> None:
        token = "token-value"
        token_hash = auth._compute_token_hash(token)
        now_utc = get_utc_now()
        engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        SQLModel.metadata.create_all(engine, tables=[User.__table__, UserSession.__table__])

        with Session(engine) as db:
            user = User(
                username="admin",
                full_name="管理员",
                role=UserRole.ADMIN,
                is_active=True,
                password_hash="hashed",
                username_version=1,
            )
            db.add(user)
            db.commit()
            db.refresh(user)

            user_session = UserSession(
                user_id=user.id,
                device_id="device-1",
                device_name="Chrome",
                ip_address="127.0.0.1",
                last_ip_address="127.0.0.1",
                user_agent="ua",
                token_hash=token_hash,
                last_active_at=now_utc - timedelta(seconds=auth.ACTIVITY_DEBOUNCE_SECONDS + 5),
                expires_at=now_utc + timedelta(hours=1),
            )
            db.add(user_session)
            db.commit()

            background_tasks = BackgroundTasks()
            with (
                patch(
                    "app.core.auth.decode_token",
                    return_value={"type": "access", "sub": str(user.id), "username_version": 1},
                ),
                patch("app.core.auth.get_cached_session_state", return_value=_cache_state()),
                patch("app.core.auth.sync_session_cache"),
            ):
                resolved_user, resolved_session = auth.resolve_current_session(
                    request=_build_request(token=token),
                    background_tasks=background_tasks,
                    db=db,
                )

            self.assertEqual(resolved_user.id, user.id)
            self.assertEqual(resolved_session.id, user_session.id)
            self.assertEqual(len(background_tasks.tasks), 1)
            self.assertFalse(
                db.dirty,
                "调度后台活跃度刷新后，不应让当前请求的 ORM Session 残留待 flush 的 user_sessions 更新",
            )

    def test_resolve_current_session_falls_back_to_db_when_cache_is_stale(self) -> None:
        token = "token-value"
        token_hash = auth._compute_token_hash(token)
        now_utc = get_utc_now()
        user = User(
            id=1,
            username="admin",
            full_name="管理员",
            role=UserRole.ADMIN,
            is_active=True,
            password_hash="hashed",
            username_version=1,
        )
        db_session = UserSession(
            id=10,
            user_id=1,
            device_id="device-1",
            device_name="Chrome",
            ip_address="127.0.0.1",
            last_ip_address="127.0.0.1",
            user_agent="ua",
            token_hash=token_hash,
            last_active_at=now_utc,
            expires_at=now_utc + timedelta(hours=1),
        )
        fake_db = MagicMock()
        fake_db.get.return_value = user
        fake_db.exec.return_value = _FakeExecResult((user, db_session))

        with (
            patch("app.core.auth.decode_token", return_value={"type": "access", "sub": "1", "username_version": 1}),
            patch(
                "app.core.auth.get_cached_session_state",
                return_value=_cache_state(
                    {
                        "session_id": 10,
                        "user_id": 1,
                        "device_id": "device-1",
                        "device_name": "Chrome",
                        "ip_address": "127.0.0.1",
                        "last_ip_address": "127.0.0.1",
                        "user_agent": "ua",
                        "expires_at": (now_utc - timedelta(minutes=1)).isoformat(),
                        "last_active_at": now_utc.isoformat(),
                    }
                ),
            ),
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

    def test_is_token_session_active_falls_back_to_db_when_cache_is_stale(self) -> None:
        token_hash = "token-hash"
        now_utc = get_utc_now()
        db_session = UserSession(
            id=10,
            user_id=1,
            device_id="device-1",
            device_name="Chrome",
            ip_address="127.0.0.1",
            last_ip_address="127.0.0.1",
            user_agent="ua",
            token_hash=token_hash,
            last_active_at=now_utc,
            expires_at=now_utc + timedelta(hours=1),
        )
        user = User(
            id=1,
            username="admin",
            full_name="管理员",
            role=UserRole.ADMIN,
            is_active=True,
            password_hash="hashed",
            username_version=1,
        )
        fake_db = MagicMock()
        fake_db.exec.return_value = _FakeExecResult((user, db_session))
        fake_db.get.return_value = user
        fake_session_ctx = MagicMock()
        fake_session_ctx.__enter__.return_value = fake_db
        fake_session_ctx.__exit__.return_value = False

        with (
            patch(
                "app.core.auth.get_cached_session_state",
                return_value=_cache_state(
                    {
                        "session_id": 10,
                        "user_id": 1,
                        "device_id": "device-1",
                        "device_name": "Chrome",
                        "ip_address": "127.0.0.1",
                        "last_ip_address": "127.0.0.1",
                        "user_agent": "ua",
                        "expires_at": (now_utc - timedelta(minutes=1)).isoformat(),
                        "last_active_at": now_utc.isoformat(),
                    }
                ),
            ),
            patch("app.core.auth.delete_cached_session") as delete_cached_session,
            patch("app.core.auth.Session", return_value=fake_session_ctx),
        ):
            is_active = auth.is_token_session_active(token_hash, client_ip="127.0.0.1")

        self.assertTrue(is_active)
        delete_cached_session.assert_called_once_with(token_hash)


class UpdateUserRegressionTests(unittest.TestCase):
    def test_update_user_rejects_self_deactivation(self) -> None:
        current_user = User(
            id=1,
            username="admin",
            full_name="管理员",
            role=UserRole.ADMIN,
            is_active=True,
            password_hash="hashed",
            username_version=1,
        )

        with (
            patch("app.api.users.get_user_by_id", return_value=current_user),
            patch("app.api.users.get_user_by_username"),self.assertRaises(HTTPException) as exc_info
        ):
            users_api.update_user(
                user_id=1,
                user_update=UserUpdate(is_active=False),
                request=_build_request(),
                db=MagicMock(),
                current_user=current_user,
            )

        self.assertEqual(exc_info.exception.status_code, 400)
        self.assertEqual(exc_info.exception.detail, "Cannot deactivate yourself")


class PasswordSecurityRegressionTests(unittest.TestCase):
    def test_change_password_enforces_rate_limit_before_password_check(self) -> None:
        current_user = User(
            id=1,
            username="admin",
            full_name="管理员",
            role=UserRole.ADMIN,
            is_active=True,
            password_hash="hashed",
            username_version=1,
        )

        with (
            patch("app.api.users.enforce_rate_limit") as enforce_rate_limit,
            patch(
                "app.api.users.verify_password",
                side_effect=lambda plain, hashed: plain == "old-pass" and hashed == "hashed",
            ),
            patch("app.api.users.get_password_hash", return_value="new-hash"),
            patch("app.api.users.stage_revoke_user_sessions", return_value=[]),
            patch("app.api.users.finalize_revoked_sessions"),
            patch("app.api.users.log_user_operation"),
        ):
            users_api.change_password(
                password_request=users_api.ChangePasswordRequest(
                    old_password="old-pass",
                    new_password="new-pass",
                ),
                http_request=_build_request(),
                current_user=current_user,
                db=MagicMock(),
            )

        enforce_rate_limit.assert_called_once()

    def test_reset_admin_password_validates_actor_password_not_target_password(self) -> None:
        current_user = User(
            id=1,
            username="actor-admin",
            full_name="管理员A",
            role=UserRole.ADMIN,
            is_active=True,
            password_hash="actor-hash",
            username_version=1,
        )
        target_user = User(
            id=2,
            username="target-admin",
            full_name="管理员B",
            role=UserRole.ADMIN,
            is_active=True,
            password_hash="target-hash",
            username_version=1,
        )
        fake_db = MagicMock()

        with (
            patch("app.api.users.get_user_by_id", return_value=target_user),
            patch("app.api.users.enforce_rate_limit"),
            patch(
                "app.api.users.verify_password",
                side_effect=lambda plain, hashed: plain == "actor-pass" and hashed == "actor-hash",
            ) as verify_password,
            patch("app.api.users.get_password_hash", return_value="new-hash"),
            patch("app.api.users.stage_revoke_user_sessions", return_value=[]),
            patch("app.api.users.finalize_revoked_sessions"),
            patch("app.api.users.log_user_operation"),
        ):
            result = users_api.reset_user_password(
                user_id=2,
                password_request=users_api.ResetPasswordRequest(
                    old_password="actor-pass",
                    new_password="brand-new-pass",
                ),
                request=_build_request(),
                db=fake_db,
                current_user=current_user,
            )

        self.assertEqual(result, {"message": "密码重置成功"})
        verify_password.assert_any_call("actor-pass", "actor-hash")
        self.assertEqual(target_user.password_hash, "new-hash")

    def test_reset_password_enforces_rate_limit_before_password_check(self) -> None:
        current_user = User(
            id=1,
            username="actor-admin",
            full_name="管理员A",
            role=UserRole.ADMIN,
            is_active=True,
            password_hash="actor-hash",
            username_version=1,
        )
        target_user = User(
            id=2,
            username="target-admin",
            full_name="管理员B",
            role=UserRole.ADMIN,
            is_active=True,
            password_hash="target-hash",
            username_version=1,
        )

        with (
            patch("app.api.users.get_user_by_id", return_value=target_user),
            patch("app.api.users.enforce_rate_limit") as enforce_rate_limit,
            patch(
                "app.api.users.verify_password",
                side_effect=lambda plain, hashed: plain == "actor-pass" and hashed == "actor-hash",
            ),
            patch("app.api.users.get_password_hash", return_value="new-hash"),
            patch("app.api.users.stage_revoke_user_sessions", return_value=[]),
            patch("app.api.users.finalize_revoked_sessions"),
            patch("app.api.users.log_user_operation"),
        ):
            users_api.reset_user_password(
                user_id=2,
                password_request=users_api.ResetPasswordRequest(
                    old_password="actor-pass",
                    new_password="brand-new-pass",
                ),
                request=_build_request(),
                db=MagicMock(),
                current_user=current_user,
            )

        enforce_rate_limit.assert_called_once()


if __name__ == "__main__":
    unittest.main()
