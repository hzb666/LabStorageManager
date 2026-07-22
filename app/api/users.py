# 用户认证、会话与资料管理接口。
from dataclasses import dataclass
import hashlib
import logging
import time
from typing import Optional, Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import case
from sqlmodel import Session, select, func, or_
import redis

from app.core.auth import (
    decode_token,
    extract_access_token,
    get_current_user,
    require_admin,
    create_access_token,
    verify_password,
    get_password_hash,
    CurrentUser,
)
from app.core.config import settings
from app.core.constants import (
    LOGIN_WINDOW_SECONDS,
    MAX_LOGIN_ATTEMPTS,
    PASSWORD_MAX_LENGTH,
    PASSWORD_CHANGE_RATE_LIMIT,
    PASSWORD_CHANGE_RATE_WINDOW_SECONDS,
    PASSWORD_MIN_LENGTH,
    PASSWORD_RESET_RATE_LIMIT,
    PASSWORD_RESET_RATE_WINDOW_SECONDS,
    SECONDS_PER_HOUR,
    UNKNOWN_DEVICE,
    USERNAME_MAX_LENGTH,
    USERNAME_MIN_LENGTH,
)
from app.core.time_utils import utc_iso_str
from app.core.request_utils import get_client_ip, get_request_id, get_request_is_cli
from app.core.redis import get_redis, redis_key
from app.database import get_db, DBSession
from app.models.user import (
    PublicUserResponse,
    User,
    UserCreate,
    UserUpdate,
    UserResponse,
    UserRole,
)
from app.models.user_operation_log import UserOperationAction
from app.models.user_session import UserSession
from app.services.image_service import save_avatar, delete_file
from app.services.rate_limit import enforce_rate_limit
from app.services.user_service import get_user_by_username, get_user_by_id
from app.services.pinyin_utils import compute_pinyin_fields
from app.services.search_matchers import build_applicant_id_subquery
from app.services.sql_utils import normalize_search_term
from app.services.session_service import (
    cleanup_expired_sessions,
    SessionCreationRequest,
    SessionCacheIdentity,
    _check_device_limit,
    _check_ip_limit,
    _evict_oldest_session,
    finalize_revoked_sessions,
    stage_create_or_refresh_user_session,
    stage_revoke_user_sessions,
    sync_session_cache,
    LOGIN_ATTEMPTS,
    prune_login_attempts,
    _login_attempts_lock,
)
from app.services.audit_logger import AuditEventContext, log_audit_event
from app.services.user_operation_logger import (
    build_user_snapshot,
    log_user_operation,
    log_user_profile_update,
    log_user_sensitive_update,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/users", tags=["Users"])
DUMMY_PASSWORD_HASH = get_password_hash("constant-timing-placeholder")
CLI_CLIENT_NAME = "cli"
CLI_DEVICE_NAME = "LabStorageManager CLI"


@dataclass
class UserListQuery:
    skip: int = 0
    limit: int = 50
    username: Annotated[Optional[str], Query(max_length=100)] = None
    full_name: Annotated[Optional[str], Query(max_length=100)] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None


class UserListItemResponse(UserResponse):
    last_active_at: str | None = None


class UserListResponse(BaseModel):
    data: list[UserListItemResponse]
    total: int
    total_without_filter: int
    skip: int
    limit: int


def _resolve_request_token_is_cli(request: Request) -> bool:
    token = extract_access_token(request)
    if not token:
        return False
    try:
        payload = decode_token(token)
    except HTTPException:
        return False
    return payload.get("client") == CLI_CLIENT_NAME


def _password_change_rate_limit_key(user_id: int, client_ip: str) -> str:
    return f"user:{user_id}:ip:{client_ip}"


def _password_reset_rate_limit_key(actor_user_id: int, target_user_id: int, client_ip: str) -> str:
    return f"actor:{actor_user_id}:target:{target_user_id}:ip:{client_ip}"


def _apply_user_list_filters(statement, filters: UserListQuery):
    # 角色非法值统一在这里转成 400，避免列表端点散落 try/except。
    if filters.username or filters.full_name:
        conditions = []
        if filters.username:
            conditions.append(User.username.contains(filters.username))
        if filters.full_name:
            conditions.append(User.full_name.contains(filters.full_name))
        statement = statement.where(or_(*conditions))

    if filters.role:
        try:
            statement = statement.where(User.role == UserRole(filters.role))
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid role: {filters.role}. Must be 'admin', 'user' or 'public'"
            ) from exc

    if filters.is_active is not None:
        statement = statement.where(User.is_active == filters.is_active)

    return statement


def _load_user_last_active_map(db: Session, user_ids: list[int]) -> dict[int, object]:
    if not user_ids:
        return {}

    last_active_rows = db.exec(
        select(UserSession.user_id, func.max(UserSession.last_active_at))
        .where(UserSession.user_id.in_(user_ids))
        .group_by(UserSession.user_id)
    ).all()
    return {
        user_id: last_active_at
        for user_id, last_active_at in last_active_rows
        if last_active_at is not None
    }


def _serialize_user_list(
    users: list[User],
    last_active_map: dict[int, object],
) -> list[dict[str, object]]:
    user_responses = []
    for user in users:
        user_dict = UserResponse.model_validate(user).model_dump(mode="json")
        user_dict["last_active_at"] = utc_iso_str(last_active_map.get(user.id))
        user_responses.append(user_dict)
    return user_responses


def _ensure_can_update_user(current_user: User, user_id: int) -> None:
    if current_user.id != user_id and current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot update other users"
        )


def _validate_update_user_fields(current_user: User, user_id: int, update_data: dict) -> None:
    allowed_fields_for_admin = {"username", "full_name", "is_active", "role"}
    allowed_fields_for_user = {"username", "full_name"}
    allowed_fields = allowed_fields_for_admin if current_user.role == UserRole.ADMIN else allowed_fields_for_user
    blocked_fields = sorted(set(update_data.keys()) - allowed_fields)
    if blocked_fields:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Not allowed to update fields: {', '.join(blocked_fields)}"
        )

    if "role" in update_data and current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admin can update role"
        )

    if update_data.get("is_active") is False and current_user.id == user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot deactivate yourself"
        )


def _check_username_change(db: Session, current_user: User, user_id: int, user: User, update_data: dict) -> bool:
    username = update_data.get("username")
    if not username:
        return False

    if current_user.id != user_id and current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot change other users' username"
        )

    existing = get_user_by_username(db, username)
    if existing and existing.id != user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered"
        )

    return user.username != username


def _apply_user_update(user: User, update_data: dict) -> None:
    for field, value in update_data.items():
        setattr(user, field, value)

    full_name = update_data.get("full_name")
    if full_name:
        pinyin_fields = compute_pinyin_fields(full_name=full_name)
        user.full_name_pinyin = pinyin_fields.get("full_name_pinyin")
        user.full_name_pinyin_initials = pinyin_fields.get("full_name_pinyin_initials")


def _resolve_user_revoke_reason(
    *,
    user: User,
    update_data: dict,
    old_role: UserRole,
    old_is_active: bool,
    username_changed: bool,
) -> str | None:
    if username_changed:
        user.username_version = (user.username_version or 0) + 1
        return "username_changed"
    if "role" in update_data and user.role != old_role:
        return "role_changed"
    if "is_active" in update_data and user.is_active != old_is_active and user.is_active is False:
        return "user_deactivated"
    return None


def _audit_sensitive_user_update(
    request: Request,
    current_user: User,
    user: User,
    update_data: dict,
) -> None:
    if not any(field in update_data for field in ("role", "is_active", "username")):
        return

    log_audit_event(
        "update_user_sensitive_fields",
        context=AuditEventContext(
            actor_user_id=current_user.id,
            target_user_id=user.id,
            client_ip=get_client_ip(request),
            request_id=get_request_id(request),
        ),
        detail=f"fields={','.join(sorted(update_data.keys()))}",
    )


def _build_audit_context(
    request: Request,
    *,
    actor_user_id: int | None = None,
    target_user_id: int | None = None,
) -> AuditEventContext:
    return AuditEventContext(
        actor_user_id=actor_user_id,
        target_user_id=target_user_id,
        client_ip=get_client_ip(request),
        request_id=get_request_id(request),
    )

def _rate_limit_key(client_ip: str) -> str:
    return redis_key(f"rate_limit:login:{client_ip}")


def _clear_failed_login_memory(client_ip: str) -> None:
    with _login_attempts_lock:
        LOGIN_ATTEMPTS.pop(client_ip, None)


def _clear_failed_login(client_ip: str) -> None:
    redis_client = get_redis()

    if redis_client is None:
        if settings.use_secure_runtime():
            # 生产环境限流依赖 Redis；Redis 不可用时由前置检查 fail-closed。
            return
        _clear_failed_login_memory(client_ip)
        return

    try:
        redis_client.delete(_rate_limit_key(client_ip))
    except redis.RedisError:
        if not settings.use_secure_runtime():
            _clear_failed_login_memory(client_ip)


def _check_rate_limit(client_ip: str) -> None:
    redis_client = get_redis()

    if redis_client is None:
        if settings.use_secure_runtime():
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Login service temporarily unavailable"
            )
        _check_rate_limit_memory(client_ip)
        return

    key = _rate_limit_key(client_ip)

    try:
        current = redis_client.get(key)

        if current is not None:
            try:
                attempts = int(current)
            except (TypeError, ValueError):
                # 兼容历史/异常脏数据，避免把登录流程放大为 500
                redis_client.delete(key)
                return
            ttl = redis_client.ttl(key)

            if ttl > 0 and attempts >= MAX_LOGIN_ATTEMPTS:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Too many login attempts, please try again in 5 minutes"
                )
    except redis.RedisError:
        if settings.use_secure_runtime():
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Login service temporarily unavailable"
            )
        _check_rate_limit_memory(client_ip)


def _record_failed_login(client_ip: str) -> None:
    redis_client = get_redis()
    if redis_client is None:
        # 生产环境 fail-closed，开发环境使用内存后备
        if settings.use_secure_runtime():
            return
        _record_failed_login_memory(client_ip)
        return

    key = _rate_limit_key(client_ip)
    try:
        current = redis_client.incr(key)
        if current == 1:
            redis_client.expire(key, LOGIN_WINDOW_SECONDS)
    except redis.RedisError:
        if settings.use_secure_runtime():
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Login service temporarily unavailable",
            )
        _record_failed_login_memory(client_ip)

def _check_rate_limit_memory(client_ip: str) -> None:
    current_time = time.time()
    prune_login_attempts(current_time)
    with _login_attempts_lock:
        attempts_data = LOGIN_ATTEMPTS.get(client_ip)
        if attempts_data is None:
            return

        attempts, first_attempt = attempts_data
        if current_time - first_attempt >= LOGIN_WINDOW_SECONDS:
            LOGIN_ATTEMPTS.pop(client_ip, None)
            return

        if attempts >= MAX_LOGIN_ATTEMPTS:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many login attempts, please try again in 5 minutes",
            )


def _record_failed_login_memory(client_ip: str) -> None:
    current_time = time.time()
    prune_login_attempts(current_time)
    with _login_attempts_lock:
        if client_ip not in LOGIN_ATTEMPTS:
            LOGIN_ATTEMPTS[client_ip] = (1, current_time)
        else:
            attempts, first_attempt = LOGIN_ATTEMPTS[client_ip]
            if current_time - first_attempt >= LOGIN_WINDOW_SECONDS:
                LOGIN_ATTEMPTS[client_ip] = (1, current_time)
            else:
                LOGIN_ATTEMPTS[client_ip] = (attempts + 1, first_attempt)


class LoginRequest(BaseModel):
    username: str = Field(min_length=USERNAME_MIN_LENGTH, max_length=USERNAME_MAX_LENGTH)
    password: str = Field(min_length=PASSWORD_MIN_LENGTH, max_length=PASSWORD_MAX_LENGTH)
    device_id: Optional[str] = None  # Client device ID
    device_name: Optional[str] = UNKNOWN_DEVICE  # Client device name


class ChangePasswordRequest(BaseModel):
    old_password: str = Field(min_length=PASSWORD_MIN_LENGTH, max_length=PASSWORD_MAX_LENGTH, description="原密码")
    new_password: str = Field(min_length=PASSWORD_MIN_LENGTH, max_length=PASSWORD_MAX_LENGTH, description="新密码")


class UserSearchItem(BaseModel):
    id: int
    full_name: str
    username: str


@dataclass
class LoginSuccessResult:
    user: User
    access_token: str
    session: UserSession
    expired_token_hashes: list[str]
    evicted_token_hashes: list[str]
    relogin_token_hashes: list[str]
    redis_warning: str | None


class CLILoginResponse(BaseModel):
    access_token: str
    token_type: str
    expires_in: int
    user: UserResponse
    redis_warning: Optional[str] = None


def _get_cli_token_expires_in_seconds() -> int:
    jwt_seconds = settings.access_token_expire_minutes * 60
    session_seconds = settings.session_expire_hours * SECONDS_PER_HOUR
    return min(jwt_seconds, session_seconds)


def _finalize_expired_login_cleanup(expired_token_hashes: list[str]) -> None:
    if not expired_token_hashes:
        return
    try:
        finalize_revoked_sessions(expired_token_hashes, reason="expired_session_cleanup")
    except Exception:
        logger.exception("Post-commit session side effects failed for login cleanup")


def _apply_login_post_commit_side_effects(
    *,
    db: DBSession,
    session: UserSession,
    user: User,
    expired_token_hashes: list[str],
    evicted_token_hashes: list[str],
    relogin_token_hashes: list[str],
) -> None:
    try:
        db.refresh(session)
        _finalize_expired_login_cleanup(expired_token_hashes)
        if evicted_token_hashes:
            finalize_revoked_sessions(evicted_token_hashes, reason="device_limit_evict")
        if relogin_token_hashes:
            finalize_revoked_sessions(relogin_token_hashes, reason="device_relogin")
        sync_session_cache(
            session=session,
            identity=SessionCacheIdentity(
                user_id=user.id,
                username=user.username,
                is_active=True,
            ),
        )
    except Exception:
        # 会话缓存/SSE 通知属于提交后副作用，失败不应回滚登录主流程。
        logger.exception("Post-commit session side effects failed for login user_id=%s", user.id)


def _check_cli_login_rate_limit(client_ip: str, username: str) -> None:
    normalized_username = username.strip().lower()
    enforce_rate_limit(
        scope="cli_login",
        identifier=f"{client_ip}:{normalized_username}",
        limit=settings.cli_login_rate_limit_count,
        window_seconds=settings.cli_login_rate_limit_window_seconds,
    )


def _build_cli_login_forbidden_response(
    *,
    db: DBSession,
    http_request: Request,
    user: User,
    expired_token_hashes: list[str],
) -> None:
    log_user_operation(
        db,
        action=UserOperationAction.LOGIN,
        actor_user_id=user.id,
        target_user_id=user.id,
        outcome="failure",
        client_ip=get_client_ip(http_request),
        request_id=get_request_id(http_request),
        detail="cli_role_forbidden",
        snapshot=build_user_snapshot(user),
        is_cli=True,
    )
    db.commit()
    log_audit_event(
        "login",
        context=_build_audit_context(
            http_request,
            actor_user_id=user.id,
            target_user_id=user.id,
        ),
        outcome="failure",
        detail="cli_role_forbidden",
    )
    _finalize_expired_login_cleanup(expired_token_hashes)
    # 对外仍返回统一认证失败，避免把“密码正确但角色不允许”暴露成在线探测信号。
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )


def _login_user(
    *,
    login_request: LoginRequest,
    http_request: Request,
    db: DBSession,
    token_client: str | None = None,
    cli_user_only: bool = False,
) -> LoginSuccessResult:
    # Web 和 CLI 复用同一条登录事务，避免会话、审计和缓存副作用在两条入口上漂移。
    expired_token_hashes: list[str] = []
    try:
        expired_token_hashes = cleanup_expired_sessions(db, commit=False)
    except Exception:
        # 会话清理是维护任务，不应阻断登录主流程
        db.rollback()
        logger.exception("Session cleanup failed before login, continue with auth flow")

    client_ip = get_client_ip(http_request)
    user_agent = http_request.headers.get("User-Agent", "Unknown")
    if token_client == CLI_CLIENT_NAME:
        _check_cli_login_rate_limit(client_ip, login_request.username)
    else:
        _check_rate_limit(client_ip)

    user = get_user_by_username(db, login_request.username)
    password_hash = user.password_hash if user else DUMMY_PASSWORD_HASH
    password_valid = verify_password(login_request.password, password_hash)

    if not user or not password_valid:
        if token_client != CLI_CLIENT_NAME:
            _record_failed_login(client_ip)
        log_user_operation(
            db,
            action=UserOperationAction.LOGIN,
            actor_user_id=None,
            target_user_id=user.id if user else None,
            outcome="failure",
            client_ip=client_ip,
            request_id=get_request_id(http_request),
            detail=f"username={login_request.username}",
            snapshot={"un": login_request.username},
            is_cli=token_client == CLI_CLIENT_NAME,
        )
        db.commit()
        log_audit_event(
            "login",
            outcome="failure",
            context=_build_audit_context(http_request),
            detail=f"username={login_request.username}",
        )
        _finalize_expired_login_cleanup(expired_token_hashes)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        log_user_operation(
            db,
            action=UserOperationAction.LOGIN,
            actor_user_id=user.id,
            target_user_id=user.id,
            outcome="failure",
            client_ip=client_ip,
            request_id=get_request_id(http_request),
            detail="account_disabled",
            snapshot=build_user_snapshot(user),
            is_cli=token_client == CLI_CLIENT_NAME,
        )
        db.commit()
        log_audit_event(
            "login",
            context=_build_audit_context(
                http_request,
                actor_user_id=user.id,
                target_user_id=user.id,
            ),
            outcome="failure",
            detail="account_disabled",
        )
        _finalize_expired_login_cleanup(expired_token_hashes)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is disabled",
        )

    if cli_user_only and user.role != UserRole.USER:
        # CLI 不承担管理员入口，避免机器调用天然带上更宽的账号自助能力。
        _build_cli_login_forbidden_response(
            db=db,
            http_request=http_request,
            user=user,
            expired_token_hashes=expired_token_hashes,
        )

    if not _check_ip_limit(db, user.id, client_ip):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"IP limit reached ({settings.max_ip_per_user} IPs), please remove other devices first",
        )

    evicted_token_hashes: list[str] = []
    if not _check_device_limit(db, user.id, login_request.device_id):
        evicted_token_hashes = _evict_oldest_session(db, user.id, commit=False)

    user_role = user.role.value if isinstance(user.role, UserRole) else str(user.role)
    access_token = create_access_token(
        user_id=user.id,
        username=user.username,
        role=user_role,
        username_version=user.username_version or 1,
        client=token_client,
    )

    session, relogin_token_hashes = stage_create_or_refresh_user_session(
        db=db,
        request=SessionCreationRequest(
            user_id=user.id,
            username=user.username,
            device_id=login_request.device_id,
            device_name=login_request.device_name or UNKNOWN_DEVICE,
            ip_address=client_ip,
            user_agent=user_agent,
            token=access_token,
        ),
    )

    log_user_operation(
        db,
        action=UserOperationAction.LOGIN,
        actor_user_id=user.id,
        target_user_id=user.id,
        outcome="success",
        client_ip=client_ip,
        request_id=get_request_id(http_request),
        detail=f"device_id={login_request.device_id or '-'}",
        snapshot=build_user_snapshot(user),
        is_cli=token_client == CLI_CLIENT_NAME,
    )
    db.commit()
    log_audit_event(
        "login",
        context=_build_audit_context(
            http_request,
            actor_user_id=user.id,
            target_user_id=user.id,
        ),
        detail=f"device_id={login_request.device_id or '-'}",
    )
    _apply_login_post_commit_side_effects(
        db=db,
        session=session,
        user=user,
        expired_token_hashes=expired_token_hashes,
        evicted_token_hashes=evicted_token_hashes,
        relogin_token_hashes=relogin_token_hashes,
    )
    _clear_failed_login(client_ip)

    redis_warning: str | None = None
    redis_client = get_redis()
    if redis_client is None:
        redis_warning = "unavailable"

    return LoginSuccessResult(
        user=user,
        access_token=access_token,
        session=session,
        expired_token_hashes=expired_token_hashes,
        evicted_token_hashes=evicted_token_hashes,
        relogin_token_hashes=relogin_token_hashes,
        redis_warning=redis_warning,
    )


@router.post("/login")
def login(
    login_request: LoginRequest,
    http_request: Request,
    db: DBSession,
):
    try:
        result = _login_user(
            login_request=login_request,
            http_request=http_request,
            db=db,
        )
        response = {
            "token_type": "bearer",
            "user": UserResponse.model_validate(result.user).model_dump(mode="json"),
            "redis_warning": None,
        }
        json_response = JSONResponse(content=response)
        if result.redis_warning is not None:
            json_response.headers["X-Redis-Status"] = "unavailable"
        json_response.set_cookie(
            key="access_token",
            value=result.access_token,
            httponly=True,
            secure=settings.use_secure_runtime(),  # 非开发环境启用 HTTPS cookie
            samesite="lax",
            max_age=settings.session_expire_hours * SECONDS_PER_HOUR,
            path="/",
        )
        return json_response
    except HTTPException:
        raise
    except Exception:
        # 暴露 request id 方便把前端报错与后端日志串起来。
        request_id = get_request_id(http_request)
        logger.exception("Login error request_id=%s", request_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Login failed",
            headers={"X-Request-ID": request_id},
        )


@router.post("/login/token", response_model=CLILoginResponse)
def login_cli_token(
    login_request: LoginRequest,
    http_request: Request,
    db: DBSession,
):
    cli_request = login_request.model_copy(
        update={
            "device_name": login_request.device_name or CLI_DEVICE_NAME,
            "device_id": login_request.device_id or "cli",
        }
    )
    try:
        result = _login_user(
            login_request=cli_request,
            http_request=http_request,
            db=db,
            token_client=CLI_CLIENT_NAME,
            cli_user_only=True,
        )
        response = CLILoginResponse(
            access_token=result.access_token,
            token_type="bearer",
            expires_in=_get_cli_token_expires_in_seconds(),
            user=UserResponse.model_validate(result.user),
            redis_warning=result.redis_warning,
        )
        json_response = JSONResponse(content=response.model_dump(mode="json"))
        if result.redis_warning is not None:
            json_response.headers["X-Redis-Status"] = "unavailable"
        return json_response
    except HTTPException:
        raise
    except Exception:
        request_id = get_request_id(http_request)
        logger.exception("CLI login error request_id=%s", request_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="CLI login failed",
            headers={"X-Request-ID": request_id},
        )


@router.post("/logout")
def logout(
    http_request: Request,
    db: DBSession,
):
    token = extract_access_token(http_request)
    client_ip = get_client_ip(http_request)
    request_id = get_request_id(http_request)
    actor_user_id: int | None = None
    revoked_token_hashes: list[str] = []
    is_cli = _resolve_request_token_is_cli(http_request)
    if token:
        token_hash = hashlib.sha256(token.encode()).hexdigest()

        # logout 必须同步踢掉 SSE，避免旧页面继续收流。
        session = db.exec(
            select(UserSession).where(UserSession.token_hash == token_hash)
        ).first()
        if session:
            actor_user_id = session.user_id
            revoked_token_hashes.append(session.token_hash)
            db.delete(session)

    response = JSONResponse(content={"message": "Logged out successfully"})

    response.delete_cookie(
        key="access_token",
        path="/",
    )
    log_user_operation(
        db,
        action=UserOperationAction.LOGOUT,
        actor_user_id=actor_user_id,
        target_user_id=actor_user_id,
        outcome="success",
        client_ip=client_ip,
        request_id=request_id,
        is_cli=is_cli,
    )
    db.commit()
    log_audit_event(
        "logout",
        context=AuditEventContext(
            actor_user_id=actor_user_id,
            target_user_id=actor_user_id,
            client_ip=client_ip,
            request_id=request_id,
        ),
    )

    if revoked_token_hashes:
        try:
            finalize_revoked_sessions(revoked_token_hashes, reason="logout")
        except Exception:
            logger.exception("Post-commit session side effects failed for logout user_id=%s", actor_user_id)

    return response


@router.post("/change-password")
def change_password(
    password_request: ChangePasswordRequest,
    http_request: Request,
    current_user: CurrentUser,
    db: DBSession,
):
    client_ip = get_client_ip(http_request)
    enforce_rate_limit(
        scope="change_password",
        identifier=_password_change_rate_limit_key(current_user.id, client_ip),
        limit=PASSWORD_CHANGE_RATE_LIMIT,
        window_seconds=PASSWORD_CHANGE_RATE_WINDOW_SECONDS,
    )

    if not verify_password(password_request.old_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Incorrect old password"
        )

    if verify_password(password_request.new_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password cannot be the same as old password"
        )

    # 在同一事务内提交“密码变更 + 日志 + 会话删除”。
    current_user.password_hash = get_password_hash(password_request.new_password)
    revoked_hashes = stage_revoke_user_sessions(db, current_user.id)
    log_user_operation(
        db,
        action=UserOperationAction.CHANGE_PASSWORD,
        actor_user_id=current_user.id,
        target_user_id=current_user.id,
        outcome="success",
        client_ip=client_ip,
        request_id=get_request_id(http_request),
        snapshot=build_user_snapshot(current_user),
        is_cli=get_request_is_cli(http_request),
    )
    db.commit()
    log_audit_event(
        "change_password",
        context=AuditEventContext(
            actor_user_id=current_user.id,
            target_user_id=current_user.id,
            client_ip=client_ip,
            request_id=get_request_id(http_request),
        ),
    )

    if revoked_hashes:
        try:
            finalize_revoked_sessions(revoked_hashes, reason="password_changed")
        except Exception:
            logger.exception("Post-commit session side effects failed for password change user_id=%s", current_user.id)

    return {"message": "密码修改成功"}


@router.post("/", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def create_user(
    user: UserCreate,
    request: Request,
    current_user: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    existing = get_user_by_username(db, user.username)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered"
        )

    pinyin_fields = compute_pinyin_fields(full_name=user.full_name)

    db_user = User(
        username=user.username,
        password_hash=get_password_hash(user.password),
        full_name=user.full_name,
        role=user.role,
        **pinyin_fields,
    )

    db.add(db_user)
    db.flush()
    log_user_operation(
        db,
        action=UserOperationAction.CREATE_USER,
        actor_user_id=current_user.id,
        target_user_id=db_user.id,
        outcome="success",
        client_ip=get_client_ip(request),
        request_id=get_request_id(request),
        detail=f"role={db_user.role.value if hasattr(db_user.role, 'value') else db_user.role}",
        snapshot=build_user_snapshot(db_user),
        is_cli=get_request_is_cli(request),
    )
    db.commit()
    db.refresh(db_user)

    return db_user


@router.get("/", response_model=UserListResponse)
def list_users(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_admin)],
    filters: Annotated[UserListQuery, Depends()],
):
    # 本人置顶，其余用户按启用状态、角色优先级和用户名稳定排序。
    statement = _apply_user_list_filters(select(User), filters)
    total = db.exec(select(func.count()).select_from(statement.subquery())).one()
    total_without_filter = db.exec(select(func.count()).select_from(User)).one()
    role_priority = case(
        (User.role == UserRole.ADMIN, 0),
        (User.role == UserRole.USER, 1),
        else_=2,
    )
    statement = statement.order_by(
        (User.id == current_user.id).desc(),
        User.is_active.desc(),
        role_priority.asc(),
        User.username.asc(),
    )
    statement = statement.offset(filters.skip).limit(filters.limit)
    users = db.exec(statement).all()
    last_active_map = _load_user_last_active_map(db, [user.id for user in users])

    return {
        "data": _serialize_user_list(users, last_active_map),
        "total": total,
        "total_without_filter": total_without_filter,
        "skip": filters.skip,
        "limit": filters.limit,
    }


@router.get("/search", response_model=list[UserSearchItem], dependencies=[Depends(get_current_user)])
def search_users(
    q: Annotated[str, Query(max_length=100)],
    db: Annotated[Session, Depends(get_db)],
):
    raw_keyword = (q or "").strip()
    keyword = normalize_search_term(raw_keyword)
    if not raw_keyword or not keyword:
        return []

    applicant_id_subquery = build_applicant_id_subquery(raw_keyword, fuzzy=False)

    statement = (
        select(User)
        .where(User.is_active)
        .where(User.role != UserRole.PUBLIC)
        .where(
            (User.username == raw_keyword)
            | User.id.in_(applicant_id_subquery)
        )
        .order_by(func.coalesce(User.full_name_pinyin, User.full_name).asc(), User.id.asc())
    )

    users = db.exec(statement).all()
    return [
        UserSearchItem(id=user.id, full_name=user.full_name, username=user.username)
        for user in users
    ]


@router.get("/me", response_model=UserResponse)
def get_me(current_user: Annotated[User, Depends(get_current_user)]):
    return current_user


@router.get("/{user_id}", response_model=PublicUserResponse, dependencies=[Depends(get_current_user)])
def get_user(
    user_id: int,
    db: Annotated[Session, Depends(get_db)],
):
    user = get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    return PublicUserResponse.model_validate(user)


@router.put("/{user_id}", response_model=UserResponse)
def update_user(
    user_id: int,
    user_update: UserUpdate,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)]
):
    _ensure_can_update_user(current_user, user_id)
    user = get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    before_user = User.model_validate(user)
    update_data = user_update.model_dump(exclude_unset=True)
    update_data.pop("avatar_url", None)
    _validate_update_user_fields(current_user, user_id, update_data)
    username_changed = _check_username_change(db, current_user, user_id, user, update_data)
    old_role = user.role
    old_is_active = user.is_active
    _apply_user_update(user, update_data)
    revoke_reason = _resolve_user_revoke_reason(
        user=user,
        update_data=update_data,
        old_role=old_role,
        old_is_active=old_is_active,
        username_changed=username_changed,
    )

    staged_revoked_hashes: list[str] = []
    if revoke_reason:
        # 先暂存待撤销会话，等主事务提交成功后再删缓存和发 SSE。
        staged_revoked_hashes = stage_revoke_user_sessions(db, user_id)

    detail_fields = ",".join(sorted(update_data.keys()))
    client_ip = get_client_ip(request)
    request_id = get_request_id(request)
    if any(field in update_data for field in ("role", "is_active", "username")):
        log_user_sensitive_update(
            db,
            actor_user_id=current_user.id,
            target_user_id=user.id,
            before_user=before_user,
            after_user=user,
            client_ip=client_ip,
            request_id=request_id,
            detail=f"fields={detail_fields}",
            is_cli=get_request_is_cli(request),
        )
    else:
        log_user_profile_update(
            db,
            actor_user_id=current_user.id,
            target_user_id=user.id,
            before_user=before_user,
            after_user=user,
            client_ip=client_ip,
            request_id=request_id,
            detail=f"fields={detail_fields}",
            is_cli=get_request_is_cli(request),
        )

    db.commit()
    db.refresh(user)

    if revoke_reason:
        finalize_revoked_sessions(staged_revoked_hashes, reason=revoke_reason)
    _audit_sensitive_user_update(request, current_user, user, update_data)

    return user


@router.post("/{user_id}/activate", response_model=UserResponse)
def activate_user(
    user_id: int,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_admin)],
):
    user = get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    if user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User is already active"
        )

    user.is_active = True
    log_user_operation(
        db,
        action=UserOperationAction.ACTIVATE_USER,
        actor_user_id=current_user.id,
        target_user_id=user.id,
        outcome="success",
        client_ip=get_client_ip(request),
        request_id=get_request_id(request),
        snapshot=build_user_snapshot(user),
        is_cli=get_request_is_cli(request),
    )
    db.commit()
    db.refresh(user)

    log_audit_event(
        "activate_user",
        context=_build_audit_context(
            request,
            actor_user_id=current_user.id,
            target_user_id=user.id,
        ),
    )

    return user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_admin)]
):
    user = get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    if user.id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot deactivate yourself"
        )

    user.is_active = False

    staged_revoked_hashes = stage_revoke_user_sessions(db, user_id)
    log_user_operation(
        db,
        action=UserOperationAction.DEACTIVATE_USER,
        actor_user_id=current_user.id,
        target_user_id=user.id,
        outcome="success",
        client_ip=get_client_ip(request),
        request_id=get_request_id(request),
        snapshot=build_user_snapshot(user),
        is_cli=get_request_is_cli(request),
    )
    db.commit()
    finalize_revoked_sessions(staged_revoked_hashes, reason="user_deactivated")

    log_audit_event(
        "deactivate_user",
        context=_build_audit_context(
            request,
            actor_user_id=current_user.id,
            target_user_id=user.id,
        ),
    )


@router.put("/{user_id}/role", response_model=UserResponse)
def update_user_role(
    user_id: int,
    role: str,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_admin)],
):
    user = get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    old_role = user.role
    try:
        user.role = UserRole(role)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid role: {role}. Must be 'admin', 'user' or 'public'"
        )

    staged_revoked_hashes: list[str] = []
    if user.role != old_role:
        staged_revoked_hashes = stage_revoke_user_sessions(db, user_id)

    log_user_operation(
        db,
        action=UserOperationAction.UPDATE_USER_ROLE,
        actor_user_id=current_user.id,
        target_user_id=user.id,
        outcome="success",
        client_ip=get_client_ip(request),
        request_id=get_request_id(request),
        detail=f"new_role={user.role.value if hasattr(user.role, 'value') else user.role}",
        snapshot=build_user_snapshot(user),
        is_cli=get_request_is_cli(request),
    )

    db.commit()
    db.refresh(user)
    finalize_revoked_sessions(staged_revoked_hashes, reason="role_changed")

    log_audit_event(
        "update_user_role",
        context=_build_audit_context(
            request,
            actor_user_id=current_user.id,
            target_user_id=user.id,
        ),
        detail=f"new_role={user.role.value}",
    )

    return user


class ResetPasswordRequest(BaseModel):
    new_password: str = Field(min_length=6, max_length=50, description="新密码")
    old_password: Optional[str] = None  # Required when resetting admin password


@router.post("/{user_id}/reset-password", dependencies=[Depends(require_admin)])
def reset_user_password(
    user_id: int,
    password_request: ResetPasswordRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_admin)],
):
    user = get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    client_ip = get_client_ip(request)
    enforce_rate_limit(
        scope="reset_password",
        identifier=_password_reset_rate_limit_key(current_user.id, user_id, client_ip),
        limit=PASSWORD_RESET_RATE_LIMIT,
        window_seconds=PASSWORD_RESET_RATE_WINDOW_SECONDS,
    )

    # 重置管理员密码需验证当前操作者口令，防止接口变成目标密码探测入口。
    if user.role == UserRole.ADMIN:
        if not password_request.old_password:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Current password required to reset an admin password"
            )
        if not verify_password(password_request.old_password, current_user.password_hash):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Incorrect current password"
            )

    # 在同一事务中提交“密码变更 + 会话删除”，提交成功后再做缓存/SSE 通知。
    user.password_hash = get_password_hash(password_request.new_password)
    staged_revoked_hashes = stage_revoke_user_sessions(db, user.id)
    log_user_operation(
        db,
        action=UserOperationAction.RESET_USER_PASSWORD,
        actor_user_id=current_user.id,
        target_user_id=user.id,
        outcome="success",
        client_ip=client_ip,
        request_id=get_request_id(request),
        snapshot=build_user_snapshot(user),
        is_cli=get_request_is_cli(request),
    )
    db.commit()
    finalize_revoked_sessions(staged_revoked_hashes, reason="password_reset")

    log_audit_event(
        "reset_user_password",
        context=AuditEventContext(
            actor_user_id=current_user.id,
            target_user_id=user.id,
            client_ip=client_ip,
            request_id=get_request_id(request),
        ),
    )

    return {"message": "密码重置成功"}

@router.delete("/{user_id}/avatar", response_model=dict)
def delete_avatar(
    user_id: int,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)]
):
    # 头像属于用户资源，仍沿用“本人或管理员”边界。
    if current_user.id != user_id and current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot delete avatar for other users"
        )

    user = get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    if user.avatar_url:
        delete_file(user.avatar_url, required_subdir="avatars")

    user.avatar_url = None
    log_user_operation(
        db,
        action=UserOperationAction.DELETE_AVATAR,
        actor_user_id=current_user.id,
        target_user_id=user.id,
        outcome="success",
        client_ip=get_client_ip(request),
        request_id=get_request_id(request),
        snapshot=build_user_snapshot(user),
        is_cli=get_request_is_cli(request),
    )
    db.commit()
    db.refresh(user)

    return {"avatar_url": None}


@router.post("/{user_id}/avatar", response_model=dict)
def upload_avatar(
    user_id: int,
    file: UploadFile,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)]
):
    # 新头像落库前先删旧文件，避免静态目录残留孤儿文件。
    if current_user.id != user_id and current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot upload avatar for other users"
        )

    user = get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    client_ip = get_client_ip(request)
    enforce_rate_limit(
        scope="upload_avatar",
        identifier=client_ip,
        limit=settings.upload_rate_limit_count,
        window_seconds=settings.upload_rate_limit_window_seconds,
    )

    if user.avatar_url:
        delete_file(user.avatar_url, required_subdir="avatars")

    avatar_url = save_avatar(file, user_id)

    user.avatar_url = avatar_url
    log_user_operation(
        db,
        action=UserOperationAction.UPLOAD_AVATAR,
        actor_user_id=current_user.id,
        target_user_id=user.id,
        outcome="success",
        client_ip=client_ip,
        request_id=get_request_id(request),
        snapshot=build_user_snapshot(user),
        is_cli=get_request_is_cli(request),
    )
    db.commit()
    db.refresh(user)

    return {"avatar_url": avatar_url}
