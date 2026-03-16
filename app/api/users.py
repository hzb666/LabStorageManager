# app/routers/users.py
"""
User API Routes - Authentication and User Management
Critical Rule #3: All data modification endpoints must check current_user
"""
import hashlib
import logging
import time
from typing import Optional, Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlmodel import Session, select, func, or_
import redis

from app.core.auth import (
    get_current_user,
    require_admin,
    create_access_token,
    verify_password,
    get_password_hash,
    CurrentUser,
)
from app.core.config import settings
from app.core.redis import delete_cached_session, get_redis
from app.database import get_db, DBSession
from app.models.user import (
    User,
    UserCreate,
    UserUpdate,
    UserResponse,
    UserRole,
)
from app.models.user_session import UserSession
from app.services.image_service import save_avatar, delete_file
from app.services.user_service import get_user_by_username, get_user_by_id
from app.services.pinyin_utils import compute_pinyin_fields
from app.services.sql_utils import normalize_field_sql, normalize_search_term
from app.services.session_service import (
    cleanup_expired_sessions,
    _check_device_limit,
    _check_ip_limit,
    _evict_oldest_session,
    _create_user_session,
    LOGIN_ATTEMPTS,
    _login_attempts_lock,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/users", tags=["Users"])

# ==================== Rate Limiting ====================
# 基于 Redis 的速率限制：记录每个 IP 的登录失败次数
# 使用 Redis 可以支持多实例部署
MAX_LOGIN_ATTEMPTS = 5  # 最多失败 5 次
LOGIN_WINDOW_SECONDS = 300  # 5 分钟内


def _rate_limit_key(client_ip: str) -> str:
    """生成速率限制的 Redis Key"""
    return f"rate_limit:login:{client_ip}"


def _get_client_ip(request: Request) -> str:
    """获取客户端 IP 地址"""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _check_rate_limit(client_ip: str) -> None:
    """检查 IP 登录速率限制 (Redis 实现)"""
    redis_client = get_redis()
    
    if redis_client is None:
        # Redis 不可用时，跳过速率限制检查（降级处理）
        return
    
    key = _rate_limit_key(client_ip)
    
    try:
        # 使用 Redis INCR + EXPIRE 实现速率限制
        # 先获取当前值
        current = redis_client.get(key)
        
        if current is not None:
            attempts = int(current)
            ttl = redis_client.ttl(key)
            
            if ttl > 0 and attempts >= MAX_LOGIN_ATTEMPTS:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Too many login attempts, please try again in 5 minutes"
                )
    except redis.RedisError:
        # Redis 错误时，跳过速率限制（降级处理）
        pass


def _record_failed_login(client_ip: str) -> None:
    """记录失败的登录尝试 (Redis 实现)"""
    redis_client = get_redis()
    
    if redis_client is None:
        # Redis 不可用时，使用内存后备
        _record_failed_login_memory(client_ip)
        return
    
    key = _rate_limit_key(client_ip)
    
    try:
        # 使用 INCR 增加计数，EXPIRE 设置过期时间
        pipe = redis_client.pipeline()
        pipe.incr(key)
        # 设置过期时间（如果尚未设置）
        pipe.expire(key, LOGIN_WINDOW_SECONDS)
        pipe.execute()
    except redis.RedisError:
        # Redis 错误时，使用内存后备
        _record_failed_login_memory(client_ip)


def _reset_login_attempts(client_ip: str) -> None:
    """登录成功后重置计数
    
    直接跳过删除，依赖 Redis key 的 5 分钟 TTL 自动过期。
    这是工程化最优解：减少一次 Redis 操作，同时保持速率限制有效性。
    """
    pass


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
    username: str = Field(min_length=3, max_length=20)
    password: str = Field(min_length=6, max_length=50)
    device_id: Optional[str] = None  # Client device ID
    device_name: Optional[str] = "Unknown Device"  # Client device name


class ChangePasswordRequest(BaseModel):
    """Change password request body"""
    old_password: str = Field(min_length=6, max_length=50, description="原密码")
    new_password: str = Field(min_length=6, max_length=50, description="新密码")


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
        cleanup_expired_sessions(db)

        client_ip = _get_client_ip(http_request)
        user_agent = http_request.headers.get("User-Agent", "Unknown")
        
        # 检查速率限制
        _check_rate_limit(client_ip)
        
        user = get_user_by_username(db, login_request.username)

        if not user or not verify_password(login_request.password, user.password_hash):
            # 记录失败尝试
            _record_failed_login(client_ip)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid credentials",
                headers={"WWW-Authenticate": "Bearer"},
            )
        
        if not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User account is disabled"
            )
        
        # 登录成功，重置速率限制（已优化：跳过 Redis delete，依赖 TTL 自动过期）
        _reset_login_attempts(client_ip)
        
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
        access_token = create_access_token(
            user_id=user.id,
            username=user.username,
            role=user.role.value,
            username_version=user.username_version or 1
        )
        
        # 创建用户会话（如果 device_id 为空，会在函数内生成唯一的匿名 ID）
        _create_user_session(
            db=db,
            user_id=user.id,
            username=user.username,
            device_id=login_request.device_id,
            device_name=login_request.device_name or "Unknown Device",
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
            secure=settings.env != "development",  # 生产环境启用 HTTPS cookie
            samesite="lax",
            max_age=settings.session_expire_hours * 3600,
            path="/",
        )
        
        return json_response
    except HTTPException:
        # 重新抛出 HTTP 异常
        raise
    except Exception:
        # 记录其他所有异常
        logger.exception("Login error")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Login failed"
        )


@router.post("/logout")
def logout(
    http_request: Request,
    db: DBSession,
):
    """Logout endpoint - clears the authentication cookie and session"""
    # 获取 token 并删除会话
    token = http_request.cookies.get("access_token")
    if token:
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        
        # 从数据库删除会话
        session = db.exec(
            select(UserSession).where(UserSession.token_hash == token_hash)
        ).first()
        if session:
            db.delete(session)
            db.commit()
        
        # 从 Redis 删除缓存
        delete_cached_session(token_hash)
    
    response = JSONResponse(content={"message": "Logged out successfully"})
    
    # 清除 Cookie
    response.delete_cookie(
        key="access_token",
        path="/",
    )
    
    return response


@router.post("/change-password")
def change_password(
    password_request: ChangePasswordRequest,
    current_user: CurrentUser,
    db: DBSession,
):
    """Change password for current user"""
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
    
    # Update password
    current_user.password_hash = get_password_hash(password_request.new_password)
    db.commit()
    
    return {"message": "密码修改成功"}


@router.post("/", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def create_user(
    user: UserCreate,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_admin)],
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
    username: Optional[str] = None,
    full_name: Optional[str] = None,
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
    
    # Get last active time from UserSession for each user
    user_responses = []
    for user in users:
        # Get the latest session's last_active_at
        latest_session = db.exec(
            select(UserSession)
            .where(UserSession.user_id == user.id)
            .order_by(UserSession.last_active_at.desc())
            .limit(1)
        ).first()
        
        last_active_at = latest_session.last_active_at if latest_session else None
        
        user_dict = UserResponse.model_validate(user).model_dump(mode='json')
        user_dict['last_active_at'] = last_active_at.isoformat() + 'Z' if last_active_at else None
        user_responses.append(user_dict)
    
    return {
        "data": user_responses,
        "total": total,
        "total_without_filter": total_without_filter,
        "skip": skip,
        "limit": limit,
    }


@router.get("/search", response_model=list[UserSearchItem])
def search_users(
    q: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: CurrentUser,
):
    """Search users for autocomplete by username/full_name/full_name_pinyin."""
    del current_user  # authenticated users only

    keyword = normalize_search_term((q or "").strip())
    if not keyword:
        return []

    search_pattern = f"%{keyword}%"

    statement = (
        select(User)
        .where(User.is_active)
        .where(User.role != UserRole.PUBLIC)
        .where(
            normalize_field_sql(User.username).ilike(search_pattern)
            | normalize_field_sql(User.full_name).ilike(search_pattern)
            | normalize_field_sql(func.coalesce(User.full_name_pinyin, "")).ilike(search_pattern)
        )
        .order_by(func.coalesce(User.full_name_pinyin, User.full_name).asc(), User.id.asc())
    )

    users = db.exec(statement).all()
    return [UserSearchItem(id=user.id, full_name=user.full_name) for user in users]


@router.get("/me", response_model=UserResponse)
def get_me(current_user: Annotated[User, Depends(get_current_user)]):
    """Get current authenticated user"""
    return current_user


@router.get("/{user_id}", response_model=UserResponse)
def get_user(
    user_id: int,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)]
):
    """Get user by ID"""
    user = get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    return user


@router.put("/{user_id}", response_model=UserResponse)
def update_user(
    user_id: int,
    user_update: UserUpdate,
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
    
    # Prevent non-admin users from changing role
    if "role" in update_data and current_user.role != UserRole.ADMIN:
        del update_data["role"]
    
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
    
    for field, value in update_data.items():
        setattr(user, field, value)

    # 如果 full_name 更改了，重新计算拼音
    if "full_name" in update_data and update_data["full_name"]:
        pinyin_fields = compute_pinyin_fields(full_name=update_data["full_name"])
        user.full_name_pinyin = pinyin_fields.get("full_name_pinyin")

    # If username changed, increment version and invalidate all sessions
    if username_changed:
        user.username_version = (user.username_version or 0) + 1
        # Delete all sessions for this user (both DB records and Redis cache)
        sessions = db.exec(
            select(UserSession).where(UserSession.user_id == user_id)
        ).all()
        for session in sessions:
            delete_cached_session(session.token_hash)
            db.delete(session)
    
    db.commit()
    db.refresh(user)
    
    return user


@router.post("/{user_id}/activate", response_model=UserResponse)
def activate_user(
    user_id: int,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_admin)]
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
    
    return user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
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

    # 清理该用户的所有 Redis Session 缓存
    active_sessions = db.exec(
        select(UserSession).where(UserSession.user_id == user_id)
    ).all()

    for session in active_sessions:
        delete_cached_session(session.token_hash)

    db.commit()


@router.put("/{user_id}/role", response_model=UserResponse)
def update_user_role(
    user_id: int,
    role: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_admin)]
):
    """Update user role (admin only)"""
    user = get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    # Validate role
    try:
        user.role = UserRole(role)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid role: {role}. Must be 'admin', 'user' or 'public'"
        )
    
    db.commit()
    db.refresh(user)
    
    return user


class ResetPasswordRequest(BaseModel):
    """Reset password request body (admin only)"""
    new_password: str = Field(min_length=6, max_length=50, description="新密码")
    old_password: Optional[str] = None  # Required when resetting admin password


@router.post("/{user_id}/reset-password")
def reset_user_password(
    user_id: int,
    password_request: ResetPasswordRequest,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_admin)]
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

    # If target user is admin, require old password verification
    if user.role == UserRole.ADMIN:
        if not password_request.old_password:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Old password required to modify admin password"
            )
        # Verify old password
        if not verify_password(password_request.old_password, user.password_hash):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Incorrect old password"
            )
        # Verify new password is different from old password
        if verify_password(password_request.new_password, user.password_hash):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="New password cannot be the same as old password"
            )
    else:
        # For non-admin users, also check if new password is same as old
        if verify_password(password_request.new_password, user.password_hash):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="New password cannot be the same as old password"
            )

    # Update password
    user.password_hash = get_password_hash(password_request.new_password)
    db.commit()

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
        delete_file(user.avatar_url)
    
    # 清空数据库中的头像 URL
    user.avatar_url = None
    db.commit()
    db.refresh(user)
    
    return {"avatar_url": None}


@router.post("/{user_id}/avatar", response_model=dict)
def upload_avatar(
    user_id: int,
    file: UploadFile,
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

    # 删除旧头像文件（如果存在）
    if user.avatar_url:
        delete_file(user.avatar_url)

    # 保存新头像
    avatar_url = save_avatar(file, user_id)

    # 更新用户头像 URL
    user.avatar_url = avatar_url
    db.commit()
    db.refresh(user)

    return {"avatar_url": avatar_url}