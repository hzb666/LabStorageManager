# JWT 鉴权与 session 校验入口。
import hashlib
import logging
from datetime import datetime, timedelta
from typing import Annotated

from fastapi import BackgroundTasks, Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer
from jose import JWTError, jwt
import bcrypt
from sqlmodel import Session, select

from app.core.config import settings
from app.core.constants import ACTIVITY_DEBOUNCE_SECONDS, BEARER_PREFIX_LEN
from app.core.request_utils import get_client_ip
from app.core.time_utils import get_utc_now, parse_utc_datetime
from app.core.redis import delete_cached_session, get_cached_session_state
from app.database import get_db, engine
from app.models.user import User, UserRole
from app.models.user_session import UserSession
from app.services.session_service import SessionCacheIdentity, sync_session_cache

logger = logging.getLogger(__name__)

# HTTP Bearer 鉴权方案
security = HTTPBearer()


AUTH_ERROR_CODE_HEADER = "X-Auth-Error-Code"


class AuthErrorCode:
    MISSING_TOKEN = "AUTH_MISSING_TOKEN"
    INVALID_TOKEN = "AUTH_INVALID_TOKEN"
    USER_NOT_FOUND = "AUTH_USER_NOT_FOUND"
    USER_DISABLED = "AUTH_USER_DISABLED"
    SESSION_REVOKED = "AUTH_SESSION_REVOKED"
    SESSION_EXPIRED = "AUTH_SESSION_EXPIRED"
    SESSION_VERSION_MISMATCH = "AUTH_SESSION_VERSION_MISMATCH"
    SESSION_IP_CHANGED = "AUTH_SESSION_IP_CHANGED"
    SESSION_USER_MISMATCH = "AUTH_SESSION_USER_MISMATCH"


def _auth_exception(
    *,
    status_code: int,
    detail: str,
    code: str,
    include_www_authenticate: bool = False,
) -> HTTPException:
    headers = {AUTH_ERROR_CODE_HEADER: code}
    if include_www_authenticate:
        headers["WWW-Authenticate"] = "Bearer"
    return HTTPException(status_code=status_code, detail=detail, headers=headers)


def _raise_session_revoked() -> None:
    raise _auth_exception(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Session has been revoked, please login again",
        code=AuthErrorCode.SESSION_REVOKED,
        include_www_authenticate=True,
    )


def extract_access_token(request: Request) -> str | None:
    # 先取 cookie，保持浏览器端和 API 客户端共用一套鉴权入口。
    cookie_token = request.cookies.get("access_token")
    if cookie_token:
        return cookie_token

    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        return auth_header[BEARER_PREFIX_LEN:]

    return None


def _compute_token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _parse_cached_datetime(raw_value: object) -> datetime | None:
    return parse_utc_datetime(raw_value)


def _build_cached_session(token_hash: str, cached_data: dict) -> UserSession | None:
    session_id = cached_data.get("session_id")
    user_id = cached_data.get("user_id")
    device_id = cached_data.get("device_id")
    device_name = cached_data.get("device_name")
    ip_address = cached_data.get("ip_address")
    last_ip_address = cached_data.get("last_ip_address")
    user_agent = cached_data.get("user_agent")
    expires_at = _parse_cached_datetime(cached_data.get("expires_at"))
    last_active_at = _parse_cached_datetime(cached_data.get("last_active_at"))

    if not isinstance(session_id, int) or not isinstance(user_id, int):
        return None
    if not all(isinstance(value, str) for value in (device_id, device_name, ip_address, last_ip_address, user_agent)):
        return None
    if not device_id or not device_name or not ip_address or not last_ip_address:
        return None
    if expires_at is None:
        return None

    return UserSession(
        id=session_id,
        user_id=user_id,
        device_id=device_id,
        device_name=device_name,
        ip_address=ip_address,
        last_ip_address=last_ip_address,
        user_agent=user_agent,
        token_hash=token_hash,
        expires_at=expires_at,
        last_active_at=last_active_at or get_utc_now(),
    )


def _should_update_activity(*, session: UserSession, client_ip: str, now_utc: datetime) -> bool:
    if session.last_active_at is None:
        return True
    if (now_utc - session.last_active_at).total_seconds() >= ACTIVITY_DEBOUNCE_SECONDS:
        return True
    return session.last_ip_address != client_ip


def _update_user_activity_task(token_hash: str, client_ip: str) -> None:
    # 活跃度刷新放到后台，避免每个受保护请求都同步写 DB/Redis。
    now_utc = get_utc_now()
    with Session(engine) as db:
        session = db.exec(
            select(UserSession).where(UserSession.token_hash == token_hash)
        ).first()
        if not session:
            delete_cached_session(token_hash)
            return

        if session.expires_at <= now_utc:
            db.delete(session)
            db.commit()
            delete_cached_session(token_hash)
            return

        if not _should_update_activity(session=session, client_ip=client_ip, now_utc=now_utc):
            return

        user = db.get(User, session.user_id)
        if not user:
            db.delete(session)
            db.commit()
            delete_cached_session(token_hash)
            return

        session.last_active_at = now_utc
        session.last_ip_address = client_ip
        db.add(session)
        db.commit()
        db.refresh(session)
        sync_session_cache(
            session=session,
            identity=SessionCacheIdentity(
                user_id=user.id,
                username=user.username,
                is_active=user.is_active,
            ),
            now_utc=now_utc,
        )


def _load_user_and_session_by_token_hash(
    db: Session,
    token_hash: str,
) -> tuple[User, UserSession] | None:
    result = db.exec(
        select(User, UserSession)
        .join(UserSession, UserSession.user_id == User.id)
        .where(UserSession.token_hash == token_hash)
    ).first()
    if result is None:
        return None

    user, session = result
    return user, session


def _resolve_access_identity(request: Request) -> tuple[str, dict, int]:
    token = extract_access_token(request)
    if not token:
        raise _auth_exception(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            code=AuthErrorCode.MISSING_TOKEN,
            include_www_authenticate=True,
        )

    payload = decode_token(token)
    if payload.get("type") != "access":
        raise _auth_exception(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            code=AuthErrorCode.INVALID_TOKEN,
            include_www_authenticate=True,
        )

    try:
        user_id = int(payload.get("sub"))
    except (TypeError, ValueError) as exc:
        raise _auth_exception(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            code=AuthErrorCode.INVALID_TOKEN,
            include_www_authenticate=True,
        ) from exc

    return token, payload, user_id


def _load_cached_session_candidate(
    token_hash: str,
    cached_data: dict | None,
    *,
    user_id: int,
    client_ip: str,
    now_utc: datetime,
) -> UserSession | None:
    # 缓存命中也要做最小可信校验，避免把脏缓存直接当真值。
    if not cached_data:
        return None

    cached_session = _build_cached_session(token_hash, cached_data)
    cached_user_id = cached_data.get("user_id")
    should_invalidate = (
        cached_session is None
        or cached_user_id != user_id
        or cached_session.expires_at <= now_utc
        or (settings.session_strict_ip and cached_session.ip_address != client_ip)
        or cached_data.get("is_active") is False
    )
    if should_invalidate:
        delete_cached_session(token_hash)
        return None

    return cached_session


def _validate_token_username_version(payload: dict, user: User) -> None:
    token_version = payload.get("username_version")
    if token_version is None:
        return

    try:
        token_version_int = int(token_version)
    except (TypeError, ValueError) as exc:
        raise _auth_exception(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            code=AuthErrorCode.INVALID_TOKEN,
            include_www_authenticate=True,
        ) from exc

    if token_version_int != user.username_version:
        raise _auth_exception(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired, please login again",
            code=AuthErrorCode.SESSION_VERSION_MISMATCH,
            include_www_authenticate=True,
        )


def _ensure_active_user(user: User) -> None:
    if not user.is_active:
        raise _auth_exception(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is disabled",
            code=AuthErrorCode.USER_DISABLED,
        )


def _get_cached_session_user_or_raise(db: Session, user_id: int, token_hash: str) -> User:
    user = db.get(User, user_id)
    if user is None:
        delete_cached_session(token_hash)
        raise _auth_exception(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            code=AuthErrorCode.INVALID_TOKEN,
            include_www_authenticate=True,
        )
    return user


def _schedule_activity_refresh(
    *,
    background_tasks: BackgroundTasks | None,
    token_hash: str,
    client_ip: str,
    session: UserSession,
    now_utc: datetime,
) -> None:
    if not _should_update_activity(session=session, client_ip=client_ip, now_utc=now_utc):
        return

    if background_tasks is not None:
        background_tasks.add_task(_update_user_activity_task, token_hash, client_ip)
    else:
        _update_user_activity_task(token_hash, client_ip)


def _delete_session_and_raise(
    db: Session,
    session: UserSession,
    token_hash: str,
    *,
    detail: str,
    code: str,
) -> None:
    db.delete(session)
    db.commit()
    delete_cached_session(token_hash)
    raise _auth_exception(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        code=code,
        include_www_authenticate=True,
    )


def _load_current_session_from_db(
    db: Session,
    *,
    token_hash: str,
    user_id: int,
    client_ip: str,
    now_utc: datetime,
) -> tuple[User, UserSession]:
    loaded = _load_user_and_session_by_token_hash(db, token_hash)
    if loaded is None:
        delete_cached_session(token_hash)
        _raise_session_revoked()

    user, session = loaded
    if user.id != user_id or session.user_id != user_id:
        _delete_session_and_raise(
            db,
            session,
            token_hash,
            detail="Session has been revoked, please login again",
            code=AuthErrorCode.SESSION_REVOKED,
        )

    _ensure_active_user(user)

    if session.expires_at <= now_utc:
        _delete_session_and_raise(
            db,
            session,
            token_hash,
            detail="Session expired",
            code=AuthErrorCode.SESSION_EXPIRED,
        )

    if settings.session_strict_ip and session.ip_address != client_ip:
        _delete_session_and_raise(
            db,
            session,
            token_hash,
            detail="IP address changed",
            code=AuthErrorCode.SESSION_IP_CHANGED,
        )

    return user, session


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(
            plain_password.encode('utf-8'),
            hashed_password.encode('utf-8')
        )
    except (ValueError, TypeError):
        return False


def get_password_hash(password: str) -> str:
    return bcrypt.hashpw(
        password.encode('utf-8'),
        bcrypt.gensalt()
    ).decode('utf-8')


def create_access_token(
    user_id: int,
    username: str,
    role: str,
    username_version: int = 1,
    *,
    client: str | None = None,
) -> str:
    expires_delta = timedelta(minutes=settings.access_token_expire_minutes)
    
    payload = {
        "sub": str(user_id),
        "username": username,
        "role": role,
        "username_version": username_version,
        "type": "access",
        "exp": get_utc_now() + expires_delta,
        "iat": get_utc_now(),
    }
    # `client` 只是服务端签发的来源标记，用于 CLI/Web 分流，不单独授予权限。
    if client:
        payload["client"] = client
    
    # 生产环境必须使用 RS256；HS256 仅保留给开发环境兜底。
    if settings.algorithm == "RS256":
        token = jwt.encode(
            payload,
            settings.get_private_key(),
            algorithm=settings.algorithm
        )
    else:
        # 开发环境下的 HS256 兜底
        token = jwt.encode(
            payload,
            settings.secret_key,
            algorithm=settings.algorithm
        )
    
    return token


def decode_token(token: str) -> dict:
    try:
        # 生产环境必须使用 RS256；HS256 仅保留给开发环境兜底。
        if settings.algorithm == "RS256":
            payload = jwt.decode(
                token,
                settings.get_public_key(),
                algorithms=[settings.algorithm]
            )
        else:
            # 开发环境下的 HS256 兜底
            payload = jwt.decode(
                token,
                settings.secret_key,
                algorithms=[settings.algorithm]
            )
        return payload
    except JWTError as exc:
        raise _auth_exception(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            code=AuthErrorCode.INVALID_TOKEN,
            include_www_authenticate=True,
        ) from exc


def resolve_current_session(
    request: Request,
    background_tasks: BackgroundTasks | None,
    db: Session,
) -> tuple[User, UserSession]:
    # 所有受保护接口统一走这里，保证 token、user、session 的错误语义一致。
    token, payload, user_id = _resolve_access_identity(request)
    request.state.is_cli = payload.get("client") == "cli"

    token_hash = _compute_token_hash(token)
    now_utc = get_utc_now()
    client_ip = get_client_ip(request)
    cache_state = get_cached_session_state(token_hash)
    if cache_state.is_revoked:
        delete_cached_session(token_hash)
        _raise_session_revoked()

    cached_session = _load_cached_session_candidate(
        token_hash,
        cache_state.session_data,
        user_id=user_id,
        client_ip=client_ip,
        now_utc=now_utc,
    )

    if cached_session is not None:
        # 命中 session 缓存后仍补查一次 User，避免用户状态和用户名版本滞后。
        user = _get_cached_session_user_or_raise(db, user_id, token_hash)
        _ensure_active_user(user)
        _validate_token_username_version(payload, user)
        _schedule_activity_refresh(
            background_tasks=background_tasks,
            token_hash=token_hash,
            client_ip=client_ip,
            session=cached_session,
            now_utc=now_utc,
        )
        return user, cached_session

    # 只有缓存缺失或被判定为脏缓存时，才回源查询 session 真值。
    user, session = _load_current_session_from_db(
        db,
        token_hash=token_hash,
        user_id=user_id,
        client_ip=client_ip,
        now_utc=now_utc,
    )
    _validate_token_username_version(payload, user)

    # 缓存缺失时按 DB 真值回填；命中路径只在活跃度变动时写回，避免每次鉴权都写 Redis。
    sync_session_cache(
        session=session,
        identity=SessionCacheIdentity(
            user_id=user.id,
            username=user.username,
            is_active=user.is_active,
        ),
        now_utc=now_utc,
    )

    _schedule_activity_refresh(
        background_tasks=background_tasks,
        token_hash=token_hash,
        client_ip=client_ip,
        session=session,
        now_utc=now_utc,
    )

    return user, session


def get_current_session(
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> tuple[User, UserSession]:
    return resolve_current_session(request=request, background_tasks=background_tasks, db=db)


def is_token_session_active(token_hash: str, *, client_ip: str | None = None) -> bool:
    # SSE 周期复检只关心 session 是否仍可用，不需要完整 user 对象。
    now_utc = get_utc_now()
    cache_state = get_cached_session_state(token_hash)
    if cache_state.is_revoked:
        delete_cached_session(token_hash)
        return False

    cached_data = cache_state.session_data
    if cached_data:
        cached_session = _build_cached_session(token_hash, cached_data)
        if cached_session is None:
            delete_cached_session(token_hash)
        else:
            if cached_session.expires_at <= now_utc:
                delete_cached_session(token_hash)
            elif settings.session_strict_ip and client_ip and cached_session.ip_address != client_ip:
                delete_cached_session(token_hash)
            elif cached_data.get("is_active") is False:
                delete_cached_session(token_hash)
            else:
                return True

    with Session(engine) as db:
        loaded = _load_user_and_session_by_token_hash(db, token_hash)
        if loaded is None:
            delete_cached_session(token_hash)
            return False

        user, session = loaded

        if session.expires_at <= now_utc:
            db.delete(session)
            db.commit()
            delete_cached_session(token_hash)
            return False

        if settings.session_strict_ip and client_ip and session.ip_address != client_ip:
            db.delete(session)
            db.commit()
            delete_cached_session(token_hash)
            return False

        if not user.is_active:
            db.delete(session)
            db.commit()
            delete_cached_session(token_hash)
            return False

        sync_session_cache(
            session=session,
            identity=SessionCacheIdentity(
                user_id=user.id,
                username=user.username,
                is_active=user.is_active,
            ),
            now_utc=now_utc,
        )

    return True


def get_current_user(
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
) -> User:
    user, _ = resolve_current_session(request=request, background_tasks=background_tasks, db=db)
    return user


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required"
        )
    
    return current_user


def require_non_public(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role == UserRole.PUBLIC:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Public account is read-only"
        )

    return current_user


# 常用依赖类型别名，避免在路由里重复写 Depends。
CurrentUser = Annotated[User, Depends(get_current_user)]
AdminUser = Annotated[User, Depends(require_admin)]
NonPublicUser = Annotated[User, Depends(require_non_public)]
CurrentSession = Annotated[tuple[User, UserSession], Depends(get_current_session)]
