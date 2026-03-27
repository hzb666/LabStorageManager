# app/routers/users.py
"""
User API Routes - Authentication and User Management
Critical Rule #3: All data modification endpoints must check current_user
"""
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
from app.services.audit_logger import log_audit_event

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/users", tags=["Users"])
DUMMY_PASSWORD_HASH = get_password_hash("constant-timing-placeholder")


def _password_change_rate_limit_key(user_id: int, client_ip: str) -> str:
    return f"user:{user_id}:ip:{client_ip}"


def _password_reset_rate_limit_key(actor_user_id: int, target_user_id: int, client_ip: str) -> str:
    return f"actor:{actor_user_id}:target:{target_user_id}:ip:{client_ip}"

def _rate_limit_key(client_ip: str) -> str:
    """生成速率限制的 Redis Key"""
    return redis_key(f"rate_limit:login:{client_ip}")


def _check_rate_limit(client_ip: str) -> None:
    """检查 IP 登录速率限制 (Redis 实现)"""
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
        # 使用 Redis INCR + EXPIRE 实现速率限制
        # 先获取当前值
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
    """记录失败的登录尝试 (Redis 实现)"""
    redis_client = get_redis()
    
    if redis_client is None:
        # 生产环境 fail-closed，开发环境使用内存后备
        if settings.use_secure_runtime():
            return
        _record_failed_login_memory(client_ip)

def _check_rate_limit_memory(client_ip: str) -> None:
    """检查内存后备中的登录失败次数。"""
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
    """记录失败的登录尝试 (内存后备，线程安全)"""
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
    """Login request body"""
    username: str = Field(min_length=USERNAME_MIN_LENGTH, max_length=USERNAME_MAX_LENGTH)
    password: str = Field(min_length=PASSWORD_MIN_LENGTH, max_length=PASSWORD_MAX_LENGTH)
    device_id: Optional[str] = None  # Client device ID
    device_name: Optional[str] = UNKNOWN_DEVICE  # Client device name


class ChangePasswordRequest(BaseModel):
    """Change password request body"""
    old_password: str = Field(min_length=PASSWORD_MIN_LENGTH, max_length=PASSWORD_MAX_LENGTH, description="原密码")
    new_password: str = Field(min_length=PASSWORD_MIN_LENGTH, max_length=PASSWORD_MAX_LENGTH, description="新密码")


class UserSearchItem(BaseModel):
    """User search result item for autocomplete."""
    id: int
    full_name: str


@router.post("/login")
def login(
    login_request: LoginRequest,
    http_request: Request,
    db: DBSession,
):
    """
    Login endpoint - sets JWT token as httpOnly Cookie
    
    Args:
        username: Username
        password: Password
        device_id: Optional device identifier
        device_name: Optional device name
        db: Database session
    
    Returns:
        User info (token is set as httpOnly Cookie)
    """
    try:
        # 清理过期会话
        try:
            cleanup_expired_sessions(db)
        except Exception:
            # 会话清理是维护任务，不应阻断登录主流程
            db.rollback()
            logger.exception("Session cleanup failed before login, continue with auth flow")

        client_ip = get_client_ip(http_request)
        user_agent = http_request.headers.get("User-Agent", "Unknown")
        
        # 检查速率限制
        _check_rate_limit(client_ip)
        
        user = get_user_by_username(db, login_request.username)
        password_hash = user.password_hash if user else DUMMY_PASSWORD_HASH
        password_valid = verify_password(login_request.password, password_hash)

        if not user or not password_valid:
            # 记录失败尝试
            _record_failed_login(client_ip)
            log_audit_event(
                "login",
                outcome="failure",
                client_ip=client_ip,
                request_id=get_request_id(http_request),
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
                outcome="failure",
                actor_user_id=user.id,
                target_user_id=user.id,
                client_ip=client_ip,
                request_id=get_request_id(http_request),
                detail="account_disabled",
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User account is disabled"
            )
        
        # 检查 IP 限制
        if not _check_ip_limit(db, user.id, client_ip):
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"IP limit reached ({settings.max_ip_per_user} IPs), please remove other devices first"
            )
        
        # 检查设备限制，如果超限则踢出旧设备
        if not _check_device_limit(db, user.id, login_request.device_id):
            _evict_oldest_session(db, user.id)
        
        # Create JWT token (include username_version for session invalidation)
        user_role = user.role.value if isinstance(user.role, UserRole) else str(user.role)
        access_token = create_access_token(
            user_id=user.id,
            username=user.username,
            role=user_role,
            username_version=user.username_version or 1
        )
        
        # 创建用户会话（如果 device_id 为空，会在函数内生成唯一的匿名 ID）
        _create_user_session(
            db=db,
            user_id=user.id,
            username=user.username,
            device_id=login_request.device_id,
            device_name=login_request.device_name or UNKNOWN_DEVICE,
            ip_address=client_ip,
            user_agent=user_agent,
            token=access_token
        )
        
        # 设置 httpOnly Cookie
        response = {
            "token_type": "bearer",
            "user": UserResponse.model_validate(user).model_dump(mode='json'),
            "redis_warning": None
        }
        
        # 返回 Response 对象以设置 Cookie
        json_response = JSONResponse(content=response)
        
        # 检查 Redis 是否可用，如果不可用则添加警告
        redis_client = get_redis()
        if redis_client is None:
            # Redis 不可用，添加警告头
            json_response.headers["X-Redis-Status"] = "unavailable"
        
        # 设置 httpOnly Cookie (有效期与 session_expire_hours 一致)
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
            actor_user_id=user.id,
            target_user_id=user.id,
            client_ip=client_ip,
            request_id=get_request_id(http_request),
            detail=f"device_id={login_request.device_id or '-'}",
        )
        
        return json_response
    except HTTPException:
        raise
    except Exception:
        # 记录其他所有异常，并返回可关联追踪的 request id
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
    """Logout endpoint - clears the authentication cookie and session"""
    # 获取 token 并删除会话
    token = extract_access_token(http_request)
    client_ip = get_client_ip(http_request)
    request_id = get_request_id(http_request)
    actor_user_id: int | None = None
    if token:
        token_hash = hashlib.sha256(token.encode()).hexdigest()

        # 从数据库删除会话，并同步断开 SSE
        session = db.exec(
            select(UserSession).where(UserSession.token_hash == token_hash)
        ).first()
        if session:
            actor_user_id = session.user_id
            revoke_session(db, session, reason="logout", commit=True)
    
    response = JSONResponse(content={"message": "Logged out successfully"})
    
    # 清除 Cookie
    response.delete_cookie(
        key="access_token",
        path="/",
    )

    log_audit_event(
        "logout",
        actor_user_id=actor_user_id,
        target_user_id=actor_user_id,
        client_ip=client_ip,
        request_id=request_id,
    )
    
    return response


@router.post("/change-password")
def change_password(
    password_request: ChangePasswordRequest,
    http_request: Request,
    current_user: CurrentUser,
    db: DBSession,
):
    """Change password for current user"""
    client_ip = get_client_ip(http_request)
    enforce_rate_limit(
        scope="change_password",
        identifier=_password_change_rate_limit_key(current_user.id, client_ip),
        limit=PASSWORD_CHANGE_RATE_LIMIT,
        window_seconds=PASSWORD_CHANGE_RATE_WINDOW_SECONDS,
    )

    # Verify old password
    if not verify_password(password_request.old_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Incorrect old password"
        )
    
    # Verify new password is different from old password
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
        actor_user_id=current_user.id,
        target_user_id=current_user.id,
        client_ip=client_ip,
        request_id=get_request_id(http_request),
    )
    
    return {"message": "密码修改成功"}


@router.post("/", response_model=UserResponse, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_admin)])
def create_user(
    user: UserCreate,
    db: Annotated[Session, Depends(get_db)],
):
    """Create a new user (admin only)"""
    # Check if username exists
    existing = get_user_by_username(db, user.username)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered"
        )

    # 计算姓名拼音
    pinyin_fields = compute_pinyin_fields(full_name=user.full_name)

    # Create user
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
    skip: int = 0,
    limit: int = 50,
    username: Annotated[Optional[str], Query(max_length=100)] = None,
    full_name: Annotated[Optional[str], Query(max_length=100)] = None,
    role: Optional[str] = None,
    is_active: Optional[bool] = None,
):
    """List users with optional filters (admin only)
    
    排序规则：
    1. 当前用户置顶
    2. 启用的在前 (is_active DESC)
    3. 管理员在前 (role DESC, admin > user)
    4. 创建时间倒序 (created_at DESC)
    """
    statement = select(User)
    
    # Apply filters if provided - username 和 full_name 使用 OR 关系
    if username or full_name:
        conditions = []
        if username:
            conditions.append(User.username.contains(username))
        if full_name:
            conditions.append(User.full_name.contains(full_name))
        statement = statement.where(or_(*conditions))
    if role:
        try:
            statement = statement.where(User.role == UserRole(role))
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid role: {role}. Must be 'admin', 'user' or 'public'"
            )
    if is_active is not None:
        statement = statement.where(User.is_active == is_active)
    
    # 获取带筛选条件的总数
    total = db.exec(select(func.count()).select_from(statement.subquery())).one()
    
    # 获取不带筛选条件的总数
    total_without_filter = db.exec(select(func.count()).select_from(User)).one()
    
    # 排序逻辑：当前用户置顶 > 启用状态 > 管理员 > 创建时间倒序
    # 使用 CASE 表达式实现当前用户置顶
    current_user_id = current_user.id
    
    # 构建排序：当前用户 first, is_active DESC, role DESC (admin=1 > user=0), created_at DESC
    statement = statement.order_by(
        # 当前用户置顶 (1 表示当前用户，0 表示其他)
        (User.id == current_user_id).desc(),
        # 启用的在前
        User.is_active.desc(),
        # 管理员在前 (将 role 转换为数值进行比较)
        # 注意：需要使用 cast 来进行正确的比较
        # 这里使用字符串比较，'admin' > 'user'
        User.role.desc(),
        # 创建时间倒序
        User.created_at.desc()
    )
    
    statement = statement.offset(skip).limit(limit)
    users = db.exec(statement).all()
    user_ids = [user.id for user in users]
    last_active_map: dict[int, object] = {}

    if user_ids:
        last_active_rows = db.exec(
            select(UserSession.user_id, func.max(UserSession.last_active_at))
            .where(UserSession.user_id.in_(user_ids))
            .group_by(UserSession.user_id)
        ).all()
        last_active_map = {
            user_id: last_active_at
            for user_id, last_active_at in last_active_rows
            if last_active_at is not None
        }
    
    # Get last active time from UserSession for each user
    user_responses = []
    for user in users:
        last_active_at = last_active_map.get(user.id)
        
        user_dict = UserResponse.model_validate(user).model_dump(mode='json')
        user_dict['last_active_at'] = utc_iso_str(last_active_at)
        user_responses.append(user_dict)
    
    return {
        "data": user_responses,
        "total": total,
        "total_without_filter": total_without_filter,
        "skip": skip,
        "limit": limit,
    }


@router.get("/search", response_model=list[UserSearchItem], dependencies=[Depends(get_current_user)])
def search_users(
    q: Annotated[str, Query(max_length=100)],
    db: Annotated[Session, Depends(get_db)],
):
    """Search users for autocomplete by username/full_name/full_name_pinyin/full_name initials."""
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
    """Get current authenticated user"""
    return current_user


@router.get("/{user_id}", response_model=PublicUserResponse, dependencies=[Depends(get_current_user)])
def get_user(
    user_id: int,
    db: Annotated[Session, Depends(get_db)],
):
    """Get user by ID"""
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
    """Update user information (owner or admin only)"""
    # Check permission: user can only update their own profile unless admin
    if current_user.id != user_id and current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot update other users"
        )
    
    user = get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    # Update fields
    update_data = user_update.model_dump(exclude_unset=True)
    update_data.pop("avatar_url", None)

    allowed_fields_for_admin = {"username", "full_name", "is_active", "role"}
    allowed_fields_for_user = {"username", "full_name"}

    allowed_fields = allowed_fields_for_admin if current_user.role == UserRole.ADMIN else allowed_fields_for_user
    blocked_fields = sorted(set(update_data.keys()) - allowed_fields)
    if blocked_fields:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Not allowed to update fields: {', '.join(blocked_fields)}"
        )

    # Security boundary: only admin can modify role
    if "role" in update_data and current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admin can update role"
        )

    if (
        "is_active" in update_data
        and update_data["is_active"] is False
        and current_user.id == user_id
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot deactivate yourself"
        )
    
    # Handle username change (user can change their own username, admin can change any)
    username_changed = False
    if "username" in update_data and update_data["username"]:
        # Only allow username change if:
        # 1. User is changing their own username, OR
        # 2. User is admin
        if current_user.id != user_id and current_user.role != UserRole.ADMIN:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Cannot change other users' username"
            )
        
        existing = get_user_by_username(db, update_data["username"])
        if existing and existing.id != user_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Username already registered"
            )
        
        # Check if username actually changed
        if user.username != update_data["username"]:
            username_changed = True
    
    old_role = user.role
    old_is_active = user.is_active

    for field, value in update_data.items():
        setattr(user, field, value)

    # 如果 full_name 更改了，重新计算拼音
    if "full_name" in update_data and update_data["full_name"]:
        pinyin_fields = compute_pinyin_fields(full_name=update_data["full_name"])
        user.full_name_pinyin = pinyin_fields.get("full_name_pinyin")
        user.full_name_pinyin_initials = pinyin_fields.get("full_name_pinyin_initials")

    revoke_reason: str | None = None
    if username_changed:
        user.username_version = (user.username_version or 0) + 1
        revoke_reason = "username_changed"

    role_changed = "role" in update_data and user.role != old_role
    if role_changed:
        revoke_reason = "role_changed"

    is_active_changed = "is_active" in update_data and user.is_active != old_is_active
    if is_active_changed and user.is_active is False:
        revoke_reason = "user_deactivated"

    staged_revoked_hashes: list[str] = []
    if revoke_reason:
        staged_revoked_hashes = stage_revoke_user_sessions(db, user_id)

    db.commit()
    db.refresh(user)

    if revoke_reason:
        finalize_revoked_sessions(staged_revoked_hashes, reason=revoke_reason)

    if any(field in update_data for field in ("role", "is_active", "username")):
        log_audit_event(
            "update_user_sensitive_fields",
            actor_user_id=current_user.id,
            target_user_id=user.id,
            client_ip=get_client_ip(request),
            request_id=get_request_id(request),
            detail=f"fields={','.join(sorted(update_data.keys()))}",
        )
    
    return user


@router.post("/{user_id}/activate", response_model=UserResponse)
def activate_user(
    user_id: int,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_admin)],
):
    """Activate a user account (admin only)"""
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
        actor_user_id=current_user.id,
        target_user_id=user.id,
        client_ip=get_client_ip(request),
        request_id=get_request_id(request),
    )
    
    return user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_admin)]
):
    """Soft delete user - deactivate account (admin only)"""
    user = get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    # Prevent self-deactivation
    if user.id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot deactivate yourself"
        )

    # Soft delete: set is_active to False
    user.is_active = False

    staged_revoked_hashes = stage_revoke_user_sessions(db, user_id)
    db.commit()
    finalize_revoked_sessions(staged_revoked_hashes, reason="user_deactivated")

    log_audit_event(
        "deactivate_user",
        actor_user_id=current_user.id,
        target_user_id=user.id,
        client_ip=get_client_ip(request),
        request_id=get_request_id(request),
    )


@router.put("/{user_id}/role", response_model=UserResponse)
def update_user_role(
    user_id: int,
    role: str,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_admin)],
):
    """Update user role (admin only)"""
    user = get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    old_role = user.role
    # Validate role
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
        actor_user_id=current_user.id,
        target_user_id=user.id,
        client_ip=get_client_ip(request),
        request_id=get_request_id(request),
        detail=f"new_role={user.role.value}",
    )
    
    return user


class ResetPasswordRequest(BaseModel):
    """Reset password request body (admin only)"""
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
    """Reset user password (admin only)

    - For regular users: no old password required
    - For admin users: old password required
    """
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
        actor_user_id=current_user.id,
        target_user_id=user.id,
        client_ip=client_ip,
        request_id=get_request_id(request),
    )

    return {"message": "密码重置成功"}


# ==================== Avatar Upload ====================

@router.delete("/{user_id}/avatar", response_model=dict)
def delete_avatar(
    user_id: int,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)]
):
    """
    Delete user avatar image.
    用户可以删除自己的头像，管理员可以删除任意用户头像。
    """
    # 权限检查
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
    
    # 如果有旧头像，删除文件
    if user.avatar_url:
        delete_file(user.avatar_url, required_subdir="avatars")
    
    # 清空数据库中的头像 URL
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
    """
    Upload user avatar image.
    用户可以上传自己的头像，管理员可以上传任意用户头像。
    上传新头像时会自动删除旧头像文件。
    """
    # 权限检查：用户只能上传自己的头像，除非是管理员
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

    # 删除旧头像文件（如果存在）
    if user.avatar_url:
        delete_file(user.avatar_url, required_subdir="avatars")

    # 保存新头像
    avatar_url = save_avatar(file, user_id)

    # 更新用户头像 URL
    user.avatar_url = avatar_url
    db.commit()
    db.refresh(user)

    return {"avatar_url": avatar_url}
