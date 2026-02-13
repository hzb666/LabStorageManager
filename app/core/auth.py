"""
JWT Authentication Module
Critical Rule #3: All data modification endpoints must check current_user
"""
from datetime import datetime, timedelta
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlmodel import Session

from app.core.config import settings
from app.database import get_db
from app.models.user import User

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# HTTP Bearer token scheme
security = HTTPBearer()


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify password against hash"""
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    """Hash password"""
    return pwd_context.hash(password)


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
        "exp": datetime.utcnow() + expires_delta,
        "iat": datetime.utcnow(),
    }
    
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
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
) -> User:
    """
    Dependency to get current authenticated user from JWT token
    
    Critical Rule #3: All data modification endpoints must check current_user
    
    Args:
        credentials: HTTP Bearer credentials
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
    
    try:
        # Decode token
        payload = decode_token(credentials.credentials)
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
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required"
        )
    
    return current_user
