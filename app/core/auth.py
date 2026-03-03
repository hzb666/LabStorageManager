"""
JWT Authentication Module
Critical Rule #3: All data modification endpoints must check current_user
"""
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer
from jose import JWTError, jwt
import bcrypt
from sqlmodel import Session

from app.core.config import settings
from app.database import get_db
from app.models.user import User, UserRole

# HTTP Bearer token scheme
security = HTTPBearer()


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


def create_access_token(user_id: int, username: str, role: str) -> str:
    """
    Create JWT access token
    
    Args:
        user_id: User ID
        username: Username
        role: User role (admin/user)
    
    Returns:
        JWT token string
    """
    expires_delta = timedelta(minutes=settings.access_token_expire_minutes)
    
    payload = {
        "sub": str(user_id),
        "username": username,
        "role": role,
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
    except JWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {str(e)}",
            headers={"WWW-Authenticate": "Bearer"},
        )


def get_current_user(
    request: Request,
    db: Session = Depends(get_db)
) -> User:
    """
    Dependency to get current authenticated user from JWT token (supports Cookie or Bearer)
    
    Critical Rule #3: All data modification endpoints must check current_user
    
    Args:
        request: HTTP request
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
