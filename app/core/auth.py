"""
JWT Authentication Module
Critical Rule #3: All data modification endpoints must check current_user
"""
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
from app.core.time_utils import get_utc_now
from app.core.redis import get_cached_session, cache_session, delete_cached_session
from app.database import get_db, engine
from app.models.user import User, UserRole
from app.models.user_session import UserSession

logger = logging.getLogger(__name__)

# HTTP Bearer token scheme
security = HTTPBearer()


def _should_skip_activity_update(token_hash: str, client_ip: str) -> bool:
    """
    检查是否应跳过用户活跃时间更新（Redis 层面防抖）
    返回 True 表示跳过，False 表示需要更新
    """
    cached_data = get_cached_session(token_hash)
    if not cached_data:
        return False  # 没有缓存，需要更新
    
    last_active_str = cached_data.get("last_active_at")
    if not last_active_str:
        return False  # 没有活跃时间记录，需要更新
    
    # 检查是否在 5 分钟内已更新
    last_active = datetime.fromisoformat(last_active_str)
    if (get_utc_now() - last_active).total_seconds() < 300:
        return True  # 5 分钟内已更新，跳过
    
    # 检查 IP 是否变化
    if cached_data.get("last_ip_address") != client_ip:
        return False  # IP 变化需要更新
    
    return True  # 超过 5 分钟且 IP 没变，需要更新


def _update_user_activity_task(token_hash: str, client_ip: str) -> None:
    """
    后台任务：更新用户会话的最后活跃时间。
    使用防抖逻辑，只有超过 5 分钟才更新数据库。
    """
    from datetime import datetime

    now_utc = get_utc_now()

    # 优先从 Redis 缓存获取会话信息（减少 DB 查询）
    cached_data = get_cached_session(token_hash)
    if cached_data:
        # 检查是否需要更新
        last_active_str = cached_data.get("last_active_at")
        if last_active_str:
            last_active = datetime.fromisoformat(last_active_str)
            if (now_utc - last_active).total_seconds() < 300:
                # 5 分钟内已更新，不需要再次更新
                return

        # IP 变了也需要更新
        if cached_data.get("last_ip_address") != client_ip:
            pass  # 继续更新
        elif last_active_str:
            # IP 没变且 5 分钟内已更新，跳过
            return

    # 从数据库更新
    with Session(engine) as db:
        session = db.exec(
            select(UserSession).where(UserSession.token_hash == token_hash)
        ).first()

        if not session:
            return

        needs_update = False

        # 检查是否需要更新
        if session.last_active_at:
            if (now_utc - session.last_active_at).total_seconds() >= 300:
                needs_update = True
        else:
            needs_update = True

        # IP 变化也需要更新
        if session.last_ip_address != client_ip:
            needs_update = True

        if needs_update:
            session.last_active_at = now_utc
            session.last_ip_address = client_ip
            db.add(session)
            db.commit()

            # 更新 Redis 缓存
            if cached_data:
                cached_data["last_active_at"] = now_utc.isoformat()
                cached_data["last_ip_address"] = client_ip
                expires_at = datetime.fromisoformat(cached_data["expires_at"])
                ttl = int((expires_at - now_utc).total_seconds())
                if ttl > 0:
                    cache_session(token_hash, cached_data, ttl)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify password against hash"""
    try:
        return bcrypt.checkpw(
            plain_password.encode('utf-8'),
            hashed_password.encode('utf-8')
        )
    except (ValueError, TypeError):
        return False


def get_password_hash(password: str) -> str:
    """Hash password"""
    return bcrypt.hashpw(
        password.encode('utf-8'),
        bcrypt.gensalt()
    ).decode('utf-8')


def create_access_token(user_id: int, username: str, role: str, username_version: int = 1) -> str:
    """
    Create JWT access token
    
    Args:
        user_id: User ID
        username: Username
        role: User role (admin/user)
        username_version: Username version for session invalidation
    
    Returns:
        JWT token string
    """
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
    
    # Use RS256 with private key, or HS256 with secret_key as fallback
    if settings.algorithm == "RS256":
        token = jwt.encode(
            payload,
            settings.get_private_key(),
            algorithm=settings.algorithm
        )
    else:
        # HS256 fallback
        token = jwt.encode(
            payload,
            settings.secret_key,
            algorithm=settings.algorithm
        )
    
    return token


def decode_token(token: str) -> dict:
    """
    Decode and verify JWT token
    
    Args:
        token: JWT token string
    
    Returns:
        Decoded payload dict
    
    Raises:
        HTTPException: If token is invalid or expired
    """
    try:
        # Use RS256 with public key, or HS256 with secret_key as fallback
        if settings.algorithm == "RS256":
            payload = jwt.decode(
                token,
                settings.get_public_key(),
                algorithms=[settings.algorithm]
            )
        else:
            # HS256 fallback
            payload = jwt.decode(
                token,
                settings.secret_key,
                algorithms=[settings.algorithm]
            )
        return payload
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )


def get_current_user(
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
) -> User:
    """
    Dependency to get current authenticated user from JWT token (supports Cookie or Bearer)

    Critical Rule #3: All data modification endpoints must check current_user

    Args:
        request: HTTP request
        background_tasks: FastAPI background tasks for updating user activity
        db: Database session

    Returns:
        Current User object

    Raises:
        HTTPException: If not authenticated
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    # 尝试从 Cookie 或 Authorization header 获取 token
    token = None

    # 1. 优先从 Cookie 获取
    cookie_token = request.cookies.get("access_token")
    if cookie_token:
        token = cookie_token
    else:
        # 2. 从 Authorization header 获取 (Bearer token)
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header[7:]  # 去掉 "Bearer " 前缀

    if not token:
        raise credentials_exception

    try:
        # Decode token
        payload = decode_token(token)
        user_id: str = payload.get("sub")

        if user_id is None:
            raise credentials_exception

    except HTTPException:
        raise credentials_exception

    # Get user from database
    try:
        user_id_int = int(user_id)
        user = db.get(User, user_id_int)

        if user is None:
            raise credentials_exception

        if not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User account is disabled"
            )

        # Check username_version to invalidate sessions when username changes
        token_version = payload.get("username_version")
        if token_version is not None and user.username_version != token_version:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session expired, please login again",
                headers={"WWW-Authenticate": "Bearer"},
            )

        # Check if session still exists in database (for kicked devices)
        token_hash = hashlib.sha256(token.encode()).hexdigest()

        # 优先从 Redis 缓存检查 Session 过期（性能优化 + 安全）
        cached_data = get_cached_session(token_hash)
        if cached_data:
            # 缓存命中：检查 expires_at 是否过期
            cached_expires_at = cached_data.get("expires_at")
            if cached_expires_at:
                try:
                    expires_at = datetime.fromisoformat(cached_expires_at)
                    if expires_at < get_utc_now():
                        delete_cached_session(token_hash)
                        raise HTTPException(
                            status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Session expired",
                            headers={"WWW-Authenticate": "Bearer"},
                        )
                except (ValueError, TypeError):
                    pass  # 格式异常则跳过，继续查 DB

        # 缓存未命中或 Redis 不可用：查询数据库
        session = db.exec(
            select(UserSession).where(UserSession.token_hash == token_hash)
        ).first()
        
        if not session:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session has been revoked, please login again",
                headers={"WWW-Authenticate": "Bearer"},
            )

        # Add background task: update user activity time (with debounce check)
        client_ip = request.client.host if request.client else "unknown"
        if not _should_skip_activity_update(token_hash, client_ip):
            background_tasks.add_task(_update_user_activity_task, token_hash, client_ip)

        return user
    
    except ValueError:
        raise credentials_exception


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    """
    Dependency to require admin role
    
    Args:
        current_user: Current authenticated user
    
    Returns:
        User if admin
    
    Raises:
        HTTPException: If not admin
    """
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required"
        )
    
    return current_user


# Annotated type aliases for dependency injection
# Usage in endpoints:
#   @app.get("/items")
#   def read_items(user: CurrentUser): ...
CurrentUser = Annotated[User, Depends(get_current_user)]
AdminUser = Annotated[User, Depends(require_admin)]
