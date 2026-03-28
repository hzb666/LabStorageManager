# 用户认证、会话与资料管理接口。
from dataclasses import dataclass
import hashlib
import logging
import time
from typing import Optional, Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlmodel import Session, select, func, or_
import redis

from app.core.auth import (
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
from app.core.request_utils import get_client_ip, get_request_id
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
    _check_device_limit,
    _check_ip_limit,
    _evict_oldest_session,
    _create_user_session,
    finalize_revoked_sessions,
    revoke_session,
    stage_revoke_user_sessions,
    LOGIN_ATTEMPTS,
    _login_attempts_lock,
)
from app.services.audit_logger import AuditEventContext, log_audit_event

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/users", tags=["Users"])
DUMMY_PASSWORD_HASH = get_password_hash("constant-timing-placeholder")


@dataclass
class UserListQuery:
    skip: int = 0
    limit: int = 50
    username: Annotated[Optional[str], Query(max_length=100)] = None
    full_name: Annotated[Optional[str], Query(max_length=100)] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None


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


def _serialize_user_list(users: list[User], last_active_map: dict[int, object]) -> list[dict]:
    user_responses = []
    for user in users:
        user_dict = UserResponse.model_validate(user).model_dump(mode='json')
        user_dict['last_active_at'] = utc_iso_str(last_active_map.get(user.id))
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

def _check_rate_limit_memory(client_ip: str) -> None:
    current_time = time.time()
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


@router.post("/login")
def login(
    login_request: LoginRequest,
    http_request: Request,
    db: DBSession,
):
    try:
        # 维护任务失败不能放大成登录失败，只做回滚和记录。
        try:
            cleanup_expired_sessions(db)
        except Exception:
            # 会话清理是维护任务，不应阻断登录主流程
            db.rollback()
            logger.exception("Session cleanup failed before login, continue with auth flow")

        client_ip = get_client_ip(http_request)
        user_agent = http_request.headers.get("User-Agent", "Unknown")
        
        _check_rate_limit(client_ip)
        
        user = get_user_by_username(db, login_request.username)
        password_hash = user.password_hash if user else DUMMY_PASSWORD_HASH
        password_valid = verify_password(login_request.password, password_hash)

        if not user or not password_valid:
            _record_failed_login(client_ip)
            log_audit_event(
                "login",
                outcome="failure",
                context=_build_audit_context(http_request),
                detail=f"username={login_request.username}",
            )
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid credentials",
                headers={"WWW-Authenticate": "Bearer"},
            )
        
        if not user.is_active:
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
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User account is disabled"
            )
        
        if not _check_ip_limit(db, user.id, client_ip):
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"IP limit reached ({settings.max_ip_per_user} IPs), please remove other devices first"
            )
        
        # 新设备登录前先淘汰最旧会话，保持既有设备上限策略。
        if not _check_device_limit(db, user.id, login_request.device_id):
            _evict_oldest_session(db, user.id)
        
        user_role = user.role.value if isinstance(user.role, UserRole) else str(user.role)
        access_token = create_access_token(
            user_id=user.id,
            username=user.username,
            role=user_role,
            username_version=user.username_version or 1
        )
        
        _create_user_session(
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
        
        response = {
            "token_type": "bearer",
            "user": UserResponse.model_validate(user).model_dump(mode='json'),
            "redis_warning": None
        }
        
        json_response = JSONResponse(content=response)
        
        redis_client = get_redis()
        if redis_client is None:
            json_response.headers["X-Redis-Status"] = "unavailable"
        
        json_response.set_cookie(
            key="access_token",
            value=access_token,
            httponly=True,
            secure=settings.use_secure_runtime(),  # 非开发环境启用 HTTPS cookie
            samesite="lax",
            max_age=settings.session_expire_hours * SECONDS_PER_HOUR,
            path="/",
        )

        log_audit_event(
            "login",
            context=_build_audit_context(
                http_request,
                actor_user_id=user.id,
                target_user_id=user.id,
            ),
            detail=f"device_id={login_request.device_id or '-'}",
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


@router.post("/logout")
def logout(
    http_request: Request,
    db: DBSession,
):
    token = extract_access_token(http_request)
    client_ip = get_client_ip(http_request)
    request_id = get_request_id(http_request)
    actor_user_id: int | None = None
    if token:
        token_hash = hashlib.sha256(token.encode()).hexdigest()

        # logout 必须同步踢掉 SSE，避免旧页面继续收流。
        session = db.exec(
            select(UserSession).where(UserSession.token_hash == token_hash)
        ).first()
        if session:
            actor_user_id = session.user_id
            revoke_session(db, session, reason="logout", commit=True)
    
    response = JSONResponse(content={"message": "Logged out successfully"})
    
    response.delete_cookie(
        key="access_token",
        path="/",
    )

    log_audit_event(
        "logout",
        context=AuditEventContext(
            actor_user_id=actor_user_id,
            target_user_id=actor_user_id,
            client_ip=client_ip,
            request_id=request_id,
        ),
    )
    
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
    
    # 先在同一事务中提交“密码变更 + 会话删除”，再做缓存/SSE 通知。
    current_user.password_hash = get_password_hash(password_request.new_password)
    revoked_hashes = stage_revoke_user_sessions(db, current_user.id)
    db.commit()
    finalize_revoked_sessions(revoked_hashes, reason="password_changed")

    log_audit_event(
        "change_password",
        context=AuditEventContext(
            actor_user_id=current_user.id,
            target_user_id=current_user.id,
            client_ip=client_ip,
            request_id=get_request_id(http_request),
        ),
    )
    
    return {"message": "密码修改成功"}


@router.post("/", response_model=UserResponse, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_admin)])
def create_user(
    user: UserCreate,
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
    db.commit()
    db.refresh(db_user)

    return db_user


@router.get("/", response_model=dict)
def list_users(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_admin)],
    filters: Annotated[UserListQuery, Depends()],
):
    # 保持原排序语义：本人置顶，再按启用状态、角色、创建时间排序。
    statement = _apply_user_list_filters(select(User), filters)
    total = db.exec(select(func.count()).select_from(statement.subquery())).one()
    total_without_filter = db.exec(select(func.count()).select_from(User)).one()
    statement = statement.order_by(
        (User.id == current_user.id).desc(),
        User.is_active.desc(),
        User.role.desc(),
        User.created_at.desc()
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
    return [UserSearchItem(id=user.id, full_name=user.full_name) for user in users]


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

    # 重置管理员密码时，要求当前操作者再次验证自己的口令，而不是目标管理员旧口令。
    # 否则该接口会退化成“在线探测目标管理员密码是否正确”的 oracle。
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
    db.commit()
    db.refresh(user)

    return {"avatar_url": avatar_url}
