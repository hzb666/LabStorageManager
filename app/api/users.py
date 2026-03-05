"""
User API Routes - Authentication and User Management
Critical Rule #3: All data modification endpoints must check current_user
"""
import hashlib
import time
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlmodel import Session, select, func
import redis

from app.core.auth import (
    get_current_user,
    require_admin,
    create_access_token,
    verify_password,
    get_password_hash,
)
from app.core.config import settings
from app.core.time_utils import get_utc_now
from app.core.redis import cache_session, delete_cached_session, get_redis
from app.database import get_db
from app.models.user import (
    User,
    UserCreate,
    UserUpdate,
    UserResponse,
    UserRole,
)
from app.models.user_session import UserSession

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
                    detail="登录尝试过多，请 5 分钟后重试"
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
    """登录成功后重置计数 (Redis 实现)"""
    redis_client = get_redis()
    
    if redis_client is None:
        return
    
    key = _rate_limit_key(client_ip)
    
    try:
        redis_client.delete(key)
    except redis.RedisError:
        pass


# ==================== Memory Fallback Rate Limiting ====================
# 内存后备速率限制（Redis 不可用时使用）
LOGIN_ATTEMPTS: Dict[str, tuple[int, float]] = {}  # IP -> (失败次数, 首次失败时间)


def _record_failed_login_memory(client_ip: str) -> None:
    """记录失败的登录尝试 (内存后备)"""
    import time
    current_time = time.time()
    if client_ip not in LOGIN_ATTEMPTS:
        LOGIN_ATTEMPTS[client_ip] = (1, current_time)
    else:
        attempts, first_attempt = LOGIN_ATTEMPTS[client_ip]
        if current_time - first_attempt >= LOGIN_WINDOW_SECONDS:
            LOGIN_ATTEMPTS[client_ip] = (1, current_time)
        else:
            LOGIN_ATTEMPTS[client_ip] = (attempts + 1, first_attempt)


# ==================== Device Session Management ====================

def _check_device_limit(db: Session, user_id: int, device_id: str) -> bool:
    """
    检查设备数量限制
    如果超过限制，返回 False 表示需要踢出旧设备
    """
    if not device_id:
        return True  # 没有 device_id 不限制
    
    # 统计当前用户的设备数（排除当前设备）
    count = db.exec(
        select(func.count(UserSession.id))
        .where(UserSession.user_id == user_id)
        .where(UserSession.device_id != device_id)
    ).one()
    
    return count < settings.max_device_per_user


def _check_ip_limit(db: Session, user_id: int, ip_address: str) -> bool:
    """
    检查 IP 数量限制
    如果超过限制，返回 False
    """
    if not ip_address:
        return True
    
    # 统计当前用户不同 IP 数（排除当前 IP）
    unique_ips = db.exec(
        select(func.count(func.distinct(UserSession.ip_address)))
        .where(UserSession.user_id == user_id)
        .where(UserSession.ip_address != ip_address)
    ).one()
    
    return unique_ips < settings.max_ip_per_user


def _evict_oldest_session(db: Session, user_id: int) -> None:
    """踢出最旧的会话"""
    oldest = db.exec(
        select(UserSession)
        .where(UserSession.user_id == user_id)
        .order_by(UserSession.last_active_at.asc())
        .limit(1)
    ).first()
    
    if oldest:
        # 删除 Redis 缓存
        delete_cached_session(oldest.token_hash)
        # 删除数据库记录
        db.delete(oldest)
        db.commit()


def _create_user_session(
    db: Session,
    user_id: int,
    device_id: str,
    device_name: str,
    ip_address: str,
    user_agent: str,
    token: str
) -> UserSession:
    """创建用户会话"""
    # 计算 token hash
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    
    # 计算过期时间
    expires_at = get_utc_now() + timedelta(hours=settings.session_expire_hours)
    
    # 创建会话
    session = UserSession(
        user_id=user_id,
        device_id=device_id or "unknown",
        device_name=device_name or "Unknown Device",
        ip_address=ip_address,
        last_ip_address=ip_address,
        user_agent=user_agent,
        token_hash=token_hash,
        expires_at=expires_at,
    )
    
    db.add(session)
    db.commit()
    db.refresh(session)
    
    # 缓存到 Redis
    cache_session(
        token_hash,
        {
            "session_id": session.id,
            "user_id": user_id,
            "device_id": device_id,
            "device_name": device_name,
            "ip_address": ip_address,
            "user_agent": user_agent,
            "expires_at": expires_at.isoformat(),
        },
        settings.session_expire_hours * 3600
    )
    
    return session


class LoginRequest(BaseModel):
    """Login request body"""
    username: str
    password: str
    device_id: Optional[str] = None  # Client device ID
    device_name: Optional[str] = "Unknown Device"  # Client device name


class ChangePasswordRequest(BaseModel):
    """Change password request body"""
    old_password: str
    new_password: str


def get_user_by_username(db: Session, username: str) -> Optional[User]:
    """Get user by username"""
    statement = select(User).where(User.username == username)
    result = db.exec(statement).first()
    return result


def get_user_by_id(db: Session, user_id: int) -> Optional[User]:
    """Get user by ID"""
    return db.get(User, user_id)


@router.post("/login")
def login(
    login_request: LoginRequest,
    http_request: Request,
    db: Session = Depends(get_db)
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
    
    # 登录成功，重置速率限制
    _reset_login_attempts(client_ip)
    
    # 检查 IP 限制
    if not _check_ip_limit(db, user.id, client_ip):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"IP 数量已达上限 ({settings.max_ip_per_user}个)，请先移除其他设备"
        )
    
    # 检查设备限制，如果超限则踢出旧设备
    if not _check_device_limit(db, user.id, login_request.device_id):
        _evict_oldest_session(db, user.id)
    
    # Create JWT token
    access_token = create_access_token(
        user_id=user.id,
        username=user.username,
        role=user.role.value
    )
    
    # 创建用户会话
    _create_user_session(
        db=db,
        user_id=user.id,
        device_id=login_request.device_id or "unknown",
        device_name=login_request.device_name or "Unknown Device",
        ip_address=client_ip,
        user_agent=user_agent,
        token=access_token
    )
    
    # 设置 httpOnly Cookie
    response = {
        "token_type": "bearer",
        "user": UserResponse.model_validate(user).model_dump(mode='json')
    }
    
    # 返回 Response 对象以设置 Cookie
    from fastapi.responses import JSONResponse
    json_response = JSONResponse(content=response)
    
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


@router.post("/logout")
def logout(
    http_request: Request,
    db: Session = Depends(get_db)
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
    
    from fastapi.responses import JSONResponse
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
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Change password for current user"""
    # Verify old password
    if not verify_password(password_request.old_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="原密码错误"
        )
    
    # Update password
    current_user.password_hash = get_password_hash(password_request.new_password)
    db.commit()
    
    return {"message": "密码修改成功"}


@router.post("/", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def create_user(
    user: UserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Create a new user (admin only)"""
    # Check if username exists
    existing = get_user_by_username(db, user.username)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered"
        )
    
    # Create user
    db_user = User(
        username=user.username,
        password_hash=get_password_hash(user.password),
        full_name=user.full_name,
        role=user.role,
    )
    
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    
    return db_user


@router.get("/", response_model=dict)
def list_users(
    skip: int = 0,
    limit: int = 50,
    username: Optional[str] = None,
    role: Optional[str] = None,
    is_active: Optional[bool] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """List users with optional filters (admin only)"""
    statement = select(User)
    
    # Apply filters if provided
    if username:
        statement = statement.where(User.username.contains(username))
    if role:
        try:
            statement = statement.where(User.role == UserRole(role))
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid role: {role}. Must be 'admin' or 'user'"
            )
    if is_active is not None:
        statement = statement.where(User.is_active == is_active)
    
    total = db.exec(select(func.count(User.id)).select_from(statement.subquery())).one()
    
    statement = statement.offset(skip).limit(limit).order_by(User.created_at.desc())
    users = db.exec(statement).all()
    
    return {
        "data": [UserResponse.model_validate(user).model_dump(mode='json') for user in users],
        "total": total,
        "skip": skip,
        "limit": limit,
    }


@router.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    """Get current authenticated user"""
    return current_user


@router.get("/{user_id}", response_model=UserResponse)
def get_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
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
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
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
    
    for field, value in update_data.items():
        setattr(user, field, value)
    
    
    db.commit()
    db.refresh(user)
    
    return user


@router.post("/{user_id}/activate", response_model=UserResponse)
def activate_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
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
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
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
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
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
            detail=f"Invalid role: {role}. Must be 'admin' or 'user'"
        )
    
    db.commit()
    db.refresh(user)
    
    return user


class ResetPasswordRequest(BaseModel):
    """Reset password request body (admin only)"""
    new_password: str


@router.post("/{user_id}/reset-password")
def reset_user_password(
    user_id: int,
    password_request: ResetPasswordRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """Reset user password (admin only - no need old password)"""
    user = get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    # Validate password
    if len(password_request.new_password) < 6:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must be at least 6 characters"
        )
    
    # Update password
    user.password_hash = get_password_hash(password_request.new_password)
    db.commit()
    
    return {"message": "密码重置成功"}
