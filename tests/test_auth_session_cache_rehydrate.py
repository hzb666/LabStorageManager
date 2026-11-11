"""DB-authoritative session checks and Redis revocation markers."""
from datetime import timedelta
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.core import auth
from app.core.time_utils import get_utc_now
from app.models.user import User, UserRole
from app.models.user_session import UserSession


def records():
    now = get_utc_now()
    user = User(id=1, username='admin', full_name='管理员', role=UserRole.ADMIN,
                is_active=True, password_hash='unused', username_version=1)
    session = UserSession(id=10, user_id=1, device_id='device-1', device_name='Chrome',
        ip_address='127.0.0.1', last_ip_address='127.0.0.1', user_agent='ua', token_hash='hash',
        last_active_at=now, expires_at=now + timedelta(hours=1))
    return user, session


def request():
    return Request({'type': 'http', 'method': 'GET', 'path': '/api/users/me',
        'headers': [(b'cookie', b'access_token=token-value')], 'client': ('127.0.0.1', 1234)})


@pytest.mark.parametrize('condition,allowed', [
    ('active', True), ('missing', False), ('expired', False), ('disabled', False),
    ('wrong_ip', False), ('revoked', False),
])
def test_http_and_sse_validate_the_same_database_truth(condition, allowed, monkeypatch):
    user, session = records()
    if condition == 'expired':
        session.expires_at = get_utc_now() - timedelta(seconds=1)
    if condition == 'disabled':
        user.is_active = False
    if condition == 'wrong_ip':
        session.ip_address = '10.0.0.1'
    monkeypatch.setattr(auth.settings, 'session_strict_ip', True)
    db = MagicMock()
    db.exec.return_value.first.return_value = None if condition == 'missing' else (user, session)
    with patch('app.core.auth.is_session_revoked', return_value=condition == 'revoked'), \
         patch('app.core.auth.decode_token', return_value={'type': 'access', 'sub': '1', 'username_version': 1}), \
         patch('app.core.auth.Session') as factory:
        if allowed:
            assert auth.resolve_current_session(request(), None, db) == (user, session)
        else:
            with pytest.raises(HTTPException):
                auth.resolve_current_session(request(), None, db)
        factory.return_value.__enter__.return_value = db
        assert auth.is_token_session_active('hash', client_ip='127.0.0.1') is allowed
    assert db.exec.call_count == (0 if condition == 'revoked' else 2)


@pytest.mark.parametrize('found', [True, False])
def test_legacy_session_payload_is_never_read_or_written(found):
    user, session = records()
    db, client = MagicMock(), MagicMock()
    db.exec.return_value.first.return_value = (user, session) if found else None
    client.exists.return_value = 0
    client.mget.return_value = ['malformed legacy session', None]
    with patch('app.core.redis.get_redis', return_value=client), \
         patch('app.core.auth.decode_token', return_value={'type': 'access', 'sub': '1', 'username_version': 1}):
        if found:
            assert auth.resolve_current_session(request(), None, db) == (user, session)
        else:
            with pytest.raises(HTTPException) as error:
                auth.resolve_current_session(request(), None, db)
            assert error.value.status_code == 401
    db.exec.assert_called_once()
    client.exists.assert_called_once()
    client.mget.assert_not_called()
    client.get.assert_not_called()
    client.setex.assert_not_called()


@pytest.mark.parametrize('condition,code', [('wrong_user', 'AUTH_SESSION_REVOKED'),
                                          ('old_username', 'AUTH_SESSION_VERSION_MISMATCH')])
def test_http_retains_identity_and_token_version_checks(condition, code):
    user, session = records()
    if condition == 'wrong_user':
        session.user_id = 2
    else:
        user.username_version = 2
    db = MagicMock()
    db.exec.return_value.first.return_value = (user, session)
    with patch('app.core.auth.is_session_revoked', return_value=False), \
         patch('app.core.auth.decode_token', return_value={'type': 'access', 'sub': '1', 'username_version': 1}):
        with pytest.raises(HTTPException) as error:
            auth.resolve_current_session(request(), None, db)
    assert error.value.headers['X-Auth-Error-Code'] == code
