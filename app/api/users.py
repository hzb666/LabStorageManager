"""
User API Routes - Authentication and User Management
Critical Rule #3: All data modification endpoints must check current_user
"""
from datetime import datetime, timezone
from typing import Dict, List, Optional
import time

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlmodel import Session, select

from app.core.auth import (
    get_current_user,
    require_admin,
    create_access_token,
    verify_password,
    get_password_hash,
)
from app.database import get_db
from app.models.user import (
    User,
    UserCreate,
    UserUpdate,
    UserResponse,
    UserRole,
)

router = APIRouter(prefix="/users", tags=["Users"])

# ==================== Rate Limiting ====================
# 简单内存速率限制：记录每个 IP 的登录失败次数
# 注意：生产环境建议使用 Redis 存储
LOGIN_ATTEMPTS: Dict[str, tuple[int, float]] = {}  # IP -> (失败次数, 首次失败时间)
MAX_LOGIN_ATTEMPTS = 5  # 最多失败 5 次
LOGIN_WINDOW_SECONDS = 300  # 5 分钟内
MAX_CACHE_SIZE = 10000  # 防止内存无限增长


def _get_client_ip(request: Request) -> str:
    """获取客户端 IP 地址"""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _check_rate_limit(client_ip: str) -> None:
    """检查 IP 登录速率限制"""
    # 定期清理过期条目
    _cleanup_old_entries()
    
    if client_ip in LOGIN_ATTEMPTS:
        attempts, first_attempt = LOGIN_ATTEMPTS[client_ip]
        # 检查是否在时间窗口内
        if time.time() - first_attempt < LOGIN_WINDOW_SECONDS:
            if attempts >= MAX_LOGIN_ATTEMPTS:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="登录尝试过多，请 5 分钟后重试"
                )
        else:
            # 时间窗口过期，重置计数
            del LOGIN_ATTEMPTS[client_ip]


def _record_failed_login(client_ip: str) -> None:
    """记录失败的登录尝试"""
    current_time = time.time()
    if client_ip not in LOGIN_ATTEMPTS:
        LOGIN_ATTEMPTS[client_ip] = (1, current_time)
    else:
        attempts, first_attempt = LOGIN_ATTEMPTS[client_ip]
        # 如果时间窗口已过期，重置
        if current_time - first_attempt >= LOGIN_WINDOW_SECONDS:
            LOGIN_ATTEMPTS[client_ip] = (1, current_time)
        else:
            LOGIN_ATTEMPTS[client_ip] = (attempts + 1, first_attempt)


def _reset_login_attempts(client_ip: str) -> None:
    """登录成功后重置计数"""
    if client_ip in LOGIN_ATTEMPTS:
        del LOGIN_ATTEMPTS[client_ip]
    # 顺便清理过期条目
    _cleanup_old_entries()


def _cleanup_old_entries() -> None:
    """清理过期条目防止内存无限增长"""
    current_time = time.time()
    # 清理超过 1 小时的过期条目
    expired_ips = [
        ip for ip, (_, first_attempt) in LOGIN_ATTEMPTS.items()
        if current_time - first_attempt > 3600
    ]
    for ip in expired_ips:
        del LOGIN_ATTEMPTS[ip]
    # 如果缓存过大，随机删除一些旧条目
    if len(LOGIN_ATTEMPTS) > MAX_CACHE_SIZE:
        # 删除最旧的 20%
        ips_to_remove = list(LOGIN_ATTEMPTS.keys())[:MAX_CACHE_SIZE // 5]
        for ip in ips_to_remove:
            del LOGIN_ATTEMPTS[ip]


class LoginRequest(BaseModel):
    """Login request body"""
    username: str
    password: str


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
        db: Database session
    
    Returns:
        User info (token is set as httpOnly Cookie)
    """
    client_ip = _get_client_ip(http_request)
    
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
    
    # Create JWT token
    access_token = create_access_token(
        user_id=user.id,
        username=user.username,
        role=user.role.value
    )
    
    # 设置 httpOnly Cookie
    response = {
        "token_type": "bearer",
        "user": UserResponse.model_validate(user).model_dump(mode='json')
    }
    
    # 返回 Response 对象以设置 Cookie
    from fastapi.responses import JSONResponse
    json_response = JSONResponse(content=response)
    
    # 设置 httpOnly Cookie (有效期 7 天)
    from app.core.config import settings
    json_response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        secure=settings.env != "development",  # 生产环境启用 HTTPS cookie
        samesite="lax",
        max_age=60 * 60 * 24 * 7,  # 7 days
        path="/",
    )
    
    return json_response


@router.post("/logout")
def logout():
    """Logout endpoint - clears the authentication cookie"""
    from fastapi.responses import JSONResponse
    response = JSONResponse(content={"message": "Logged out successfully"})
    
    # 清除 Cookie
    response.delete_cookie(
        key="access_token",
        path="/",
    )
    
    return response


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


@router.get("/", response_model=List[UserResponse])
def list_users(
    skip: int = 0,
    limit: int = 100,
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
    
    statement = statement.offset(skip).limit(limit).order_by(User.created_at.desc())
    return db.exec(statement).all()


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
    
    # Handle username change (admin only)
    if "username" in update_data and update_data["username"]:
        if current_user.role != UserRole.ADMIN:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only admin can change username"
            )
        
        existing = get_user_by_username(db, update_data["username"])
        if existing and existing.id != user_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Username already registered"
            )
    
    for field, value in update_data.items():
        setattr(user, field, value)
    
    user.updated_at = datetime.now(timezone.utc)
    
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
    user.updated_at = datetime.now(timezone.utc)
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
    user.updated_at = datetime.now(timezone.utc)
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
    
    user.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)
    
    return user
