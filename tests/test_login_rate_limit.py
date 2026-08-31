from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

import redis
from fastapi import HTTPException
from starlette.requests import Request

from app.api import users as users_api
from app.core.constants import LOGIN_WINDOW_SECONDS, MAX_LOGIN_ATTEMPTS
from app.models.user import User, UserRole
from app.models.user_session import UserSession
from app.services import session_service


class _FakeRedis:
    def __init__(self) -> None:
        self.store: dict[str, str] = {}
        self.ttls: dict[str, int] = {}

    def get(self, key: str) -> str | None:
        return self.store.get(key)

    def incr(self, key: str) -> int:
        current = int(self.store.get(key, "0")) + 1
        self.store[key] = str(current)
        return current

    def expire(self, key: str, ttl_seconds: int) -> bool:
        self.ttls[key] = ttl_seconds
        return True

    def ttl(self, key: str) -> int:
        return self.ttls.get(key, -1)

    def delete(self, key: str) -> int:
        deleted = 0
        if key in self.store:
            deleted += 1
            self.store.pop(key, None)
        self.ttls.pop(key, None)
        return deleted


class _BrokenRedis(_FakeRedis):
    def incr(self, key: str) -> int:
        raise redis.RedisError("write failed")


def _build_request(*, client_ip: str = "127.0.0.1") -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/users/login",
            "headers": [(b"user-agent", b"pytest")],
            "client": (client_ip, 12345),
        }
    )


def _build_user() -> User:
    return User(
        id=1,
        username="admin",
        full_name="管理员",
        role=UserRole.ADMIN,
        is_active=True,
        password_hash="hashed-password",
        username_version=1,
    )


class LoginRateLimitTests(unittest.TestCase):
    def setUp(self) -> None:
        users_api.LOGIN_ATTEMPTS.clear()

    def tearDown(self) -> None:
        users_api.LOGIN_ATTEMPTS.clear()

    def test_record_failed_login_uses_redis_incr_and_expire(self) -> None:
        fake_redis = _FakeRedis()
        client_ip = "127.0.0.1"
        key = users_api._rate_limit_key(client_ip)

        with patch("app.api.users.get_redis", return_value=fake_redis):
            users_api._record_failed_login(client_ip)
            users_api._record_failed_login(client_ip)

        self.assertEqual(fake_redis.get(key), "2")
        self.assertEqual(fake_redis.ttl(key), LOGIN_WINDOW_SECONDS)

    def test_check_rate_limit_returns_429_after_threshold(self) -> None:
        fake_redis = _FakeRedis()
        client_ip = "127.0.0.1"
        key = users_api._rate_limit_key(client_ip)
        fake_redis.store[key] = str(MAX_LOGIN_ATTEMPTS)
        fake_redis.ttls[key] = LOGIN_WINDOW_SECONDS

        with patch("app.api.users.get_redis", return_value=fake_redis):
            with self.assertRaises(HTTPException) as exc_info:
                users_api._check_rate_limit(client_ip)

        self.assertEqual(exc_info.exception.status_code, 429)

    def test_login_success_clears_failed_login_counter(self) -> None:
        fake_redis = _FakeRedis()
        client_ip = "127.0.0.1"
        key = users_api._rate_limit_key(client_ip)
        fake_redis.store[key] = "2"
        fake_redis.ttls[key] = LOGIN_WINDOW_SECONDS
        user = _build_user()
        session = UserSession(
            id=10,
            user_id=user.id,
            device_id="device-1",
            device_name="Chrome",
            ip_address=client_ip,
            last_ip_address=client_ip,
            user_agent="pytest",
            token_hash="token-hash",
            expires_at=user.created_at,
        )

        with (
            patch("app.api.users.get_redis", return_value=fake_redis),
            patch("app.api.users.cleanup_expired_sessions", return_value=[]),
            patch("app.api.users.get_user_by_username", return_value=user),
            patch("app.api.users.verify_password", return_value=True),
            patch("app.api.users._check_device_limit", return_value=True),
            patch("app.api.users._evict_oldest_session") as evict_oldest_session,
            patch("app.api.users.create_access_token", return_value="token-value"),
            patch("app.api.users.stage_create_or_refresh_user_session", return_value=(session, [])),
            patch("app.api.users.log_user_operation"),
            patch("app.api.users.log_audit_event"),
            patch("app.api.users._apply_login_post_commit_side_effects"),
        ):
            response = users_api.login(
                login_request=users_api.LoginRequest(
                    username="admin",
                    password="password123",
                    device_id="device-1",
                    device_name="Chrome",
                ),
                http_request=_build_request(client_ip=client_ip),
                db=MagicMock(),
            )

        self.assertEqual(response.status_code, 200)
        self.assertIsNone(fake_redis.get(key))
        evict_oldest_session.assert_not_called()

    def test_login_device_limit_evicts_oldest_session_and_succeeds(self) -> None:
        fake_redis = _FakeRedis()
        client_ip = "192.0.2.6"
        user = _build_user()
        session = UserSession(
            id=11,
            user_id=user.id,
            device_id="device-6",
            device_name="Chrome",
            ip_address=client_ip,
            last_ip_address=client_ip,
            user_agent="pytest",
            token_hash="new-token-hash",
            expires_at=user.created_at,
        )
        fake_db = MagicMock()

        with (
            patch("app.api.users.get_redis", return_value=fake_redis),
            patch("app.api.users.cleanup_expired_sessions", return_value=[]),
            patch("app.api.users.get_user_by_username", return_value=user),
            patch("app.api.users.verify_password", return_value=True),
            patch("app.api.users._check_device_limit", return_value=False),
            patch(
                "app.api.users._evict_oldest_session",
                return_value=["oldest-token-hash"],
            ) as evict_oldest_session,
            patch("app.api.users.create_access_token", return_value="new-token"),
            patch(
                "app.api.users.stage_create_or_refresh_user_session",
                return_value=(session, []),
            ),
            patch("app.api.users.log_user_operation"),
            patch("app.api.users.log_audit_event"),
            patch(
                "app.api.users._apply_login_post_commit_side_effects"
            ) as apply_side_effects,
        ):
            result = users_api._login_user(
                login_request=users_api.LoginRequest(
                    username="admin",
                    password="password123",
                    device_id="device-6",
                    device_name="Chrome",
                ),
                http_request=_build_request(client_ip=client_ip),
                db=fake_db,
            )

        self.assertEqual(result.user.id, user.id)
        evict_oldest_session.assert_called_once_with(fake_db, user.id, commit=False)
        self.assertEqual(
            apply_side_effects.call_args.kwargs["evicted_token_hashes"],
            ["oldest-token-hash"],
        )
        fake_db.commit.assert_called_once()

    def test_missing_device_id_still_obeys_session_limit(self) -> None:
        fake_db = MagicMock()
        fake_db.exec.return_value.one.return_value = 10

        with patch.object(session_service.settings, "max_device_per_user", 10):
            within_limit = session_service._check_device_limit(
                fake_db,
                user_id=1,
                device_id=None,
            )

        self.assertFalse(within_limit)
        fake_db.exec.assert_called_once()

    def test_login_invalid_password_records_failure_without_creating_session(self) -> None:
        fake_redis = _FakeRedis()
        client_ip = "127.0.0.1"
        key = users_api._rate_limit_key(client_ip)
        user = _build_user()
        fake_db = MagicMock()

        with (
            patch("app.api.users.get_redis", return_value=fake_redis),
            patch("app.api.users.cleanup_expired_sessions", return_value=[]),
            patch("app.api.users.get_user_by_username", return_value=user),
            patch("app.api.users.verify_password", return_value=False),
            patch("app.api.users.stage_create_or_refresh_user_session") as create_session,
            patch("app.api.users.create_access_token") as create_access_token,
            patch("app.api.users.log_user_operation") as log_user_operation,
            patch("app.api.users.log_audit_event") as log_audit_event,
        ):
            with self.assertRaises(HTTPException) as exc_info:
                users_api.login(
                    login_request=users_api.LoginRequest(
                        username="admin",
                        password="wrong-password",
                        device_id="device-1",
                        device_name="Chrome",
                    ),
                    http_request=_build_request(client_ip=client_ip),
                    db=fake_db,
                )

        self.assertEqual(exc_info.exception.status_code, 401)
        self.assertEqual(fake_redis.get(key), "1")
        fake_db.commit.assert_called_once()
        log_user_operation.assert_called_once()
        log_audit_event.assert_called_once()
        create_session.assert_not_called()
        create_access_token.assert_not_called()

    def test_login_unknown_user_uses_dummy_hash_and_records_failure(self) -> None:
        fake_redis = _FakeRedis()
        client_ip = "127.0.0.1"
        key = users_api._rate_limit_key(client_ip)
        fake_db = MagicMock()

        with (
            patch("app.api.users.get_redis", return_value=fake_redis),
            patch("app.api.users.cleanup_expired_sessions", return_value=[]),
            patch("app.api.users.get_user_by_username", return_value=None),
            patch("app.api.users.verify_password", return_value=False) as verify_password,
            patch("app.api.users.stage_create_or_refresh_user_session") as create_session,
            patch("app.api.users.create_access_token") as create_access_token,
            patch("app.api.users.log_user_operation") as log_user_operation,
            patch("app.api.users.log_audit_event") as log_audit_event,
        ):
            with self.assertRaises(HTTPException) as exc_info:
                users_api.login(
                    login_request=users_api.LoginRequest(
                        username="missing",
                        password="wrong-password",
                        device_id="device-1",
                        device_name="Chrome",
                    ),
                    http_request=_build_request(client_ip=client_ip),
                    db=fake_db,
                )

        self.assertEqual(exc_info.exception.status_code, 401)
        verify_password.assert_called_once_with("wrong-password", users_api.DUMMY_PASSWORD_HASH)
        self.assertEqual(fake_redis.get(key), "1")
        fake_db.commit.assert_called_once()
        log_user_operation.assert_called_once()
        self.assertIsNone(log_user_operation.call_args.kwargs["target_user_id"])
        log_audit_event.assert_called_once()
        create_session.assert_not_called()
        create_access_token.assert_not_called()

    def test_login_rate_limit_short_circuits_before_user_lookup_and_token_creation(self) -> None:
        fake_redis = _FakeRedis()
        client_ip = "127.0.0.1"
        key = users_api._rate_limit_key(client_ip)
        fake_redis.store[key] = str(MAX_LOGIN_ATTEMPTS)
        fake_redis.ttls[key] = LOGIN_WINDOW_SECONDS

        with (
            patch("app.api.users.get_redis", return_value=fake_redis),
            patch("app.api.users.cleanup_expired_sessions", return_value=[]),
            patch("app.api.users.get_user_by_username") as get_user_by_username,
            patch("app.api.users.verify_password") as verify_password,
            patch("app.api.users.create_access_token") as create_access_token,
            patch("app.api.users.stage_create_or_refresh_user_session") as create_session,
            patch("app.api.users.log_user_operation") as log_user_operation,
            patch("app.api.users.log_audit_event") as log_audit_event,
        ):
            with self.assertRaises(HTTPException) as exc_info:
                users_api.login(
                    login_request=users_api.LoginRequest(
                        username="admin",
                        password="password123",
                        device_id="device-1",
                        device_name="Chrome",
                    ),
                    http_request=_build_request(client_ip=client_ip),
                    db=MagicMock(),
                )

        self.assertEqual(exc_info.exception.status_code, 429)
        get_user_by_username.assert_not_called()
        verify_password.assert_not_called()
        create_access_token.assert_not_called()
        create_session.assert_not_called()
        log_user_operation.assert_not_called()
        log_audit_event.assert_not_called()

    def test_login_disabled_user_is_forbidden_without_incrementing_password_failures(self) -> None:
        fake_redis = _FakeRedis()
        client_ip = "127.0.0.1"
        key = users_api._rate_limit_key(client_ip)
        fake_redis.store[key] = "2"
        fake_redis.ttls[key] = LOGIN_WINDOW_SECONDS
        user = _build_user()
        user.is_active = False
        fake_db = MagicMock()

        with (
            patch("app.api.users.get_redis", return_value=fake_redis),
            patch("app.api.users.cleanup_expired_sessions", return_value=[]),
            patch("app.api.users.get_user_by_username", return_value=user),
            patch("app.api.users.verify_password", return_value=True),
            patch("app.api.users.stage_create_or_refresh_user_session") as create_session,
            patch("app.api.users.create_access_token") as create_access_token,
            patch("app.api.users.log_user_operation") as log_user_operation,
            patch("app.api.users.log_audit_event") as log_audit_event,
        ):
            with self.assertRaises(HTTPException) as exc_info:
                users_api.login(
                    login_request=users_api.LoginRequest(
                        username="admin",
                        password="password123",
                        device_id="device-1",
                        device_name="Chrome",
                    ),
                    http_request=_build_request(client_ip=client_ip),
                    db=fake_db,
                )

        self.assertEqual(exc_info.exception.status_code, 403)
        self.assertEqual(fake_redis.get(key), "2")
        fake_db.commit.assert_called_once()
        log_user_operation.assert_called_once()
        log_audit_event.assert_called_once()
        create_session.assert_not_called()
        create_access_token.assert_not_called()

    def test_redis_unavailable_uses_memory_fallback_in_development(self) -> None:
        client_ip = "127.0.0.1"
        with (
            patch("app.api.users.get_redis", return_value=None),
            patch.object(type(users_api.settings), "use_secure_runtime", return_value=False),
        ):
            for _ in range(MAX_LOGIN_ATTEMPTS):
                users_api._record_failed_login(client_ip)

            with self.assertRaises(HTTPException) as exc_info:
                users_api._check_rate_limit(client_ip)

        self.assertEqual(exc_info.exception.status_code, 429)

    def test_redis_write_failure_fail_closes_in_secure_runtime(self) -> None:
        with (
            patch("app.api.users.get_redis", return_value=_BrokenRedis()),
            patch.object(type(users_api.settings), "use_secure_runtime", return_value=True),
        ):
            with self.assertRaises(HTTPException) as exc_info:
                users_api._record_failed_login("127.0.0.1")

        self.assertEqual(exc_info.exception.status_code, 503)


if __name__ == "__main__":
    unittest.main()
