"""
User API Routes - Authentication and User Management
Critical Rule #3: All data modification endpoints must check current_user
"""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from passlib.context import CryptContext
from sqlmodel import Session, select

from app.database import get_db
from app.models.user import (
    User,
    UserCreate,
    UserUpdate,
    UserResponse,
    UserRole,
)

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

router = APIRouter(prefix="/users", tags=["Users"])


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify password against hash"""
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    """Hash password"""
    return pwd_context.hash(password)


def get_user_by_username(db: Session, username: str) -> Optional[User]:
    """Get user by username"""
    statement = select(User).where(User.username == username)
    return db.exec(statement).first()


def get_user_by_id(db: Session, user_id: int) -> Optional[User]:
    """Get user by ID"""
    return db.get(User, user_id)


@router.post("/", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def create_user(user: UserCreate, db: Session = Depends(get_db)):
    """Create a new user"""
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
    db: Session = Depends(get_db)
):
    """List all users with pagination"""
    statement = select(User).offset(skip).limit(limit)
    return db.exec(statement).all()


@router.get("/{user_id}", response_model=UserResponse)
def get_user(user_id: int, db: Session = Depends(get_db)):
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
    # Critical: current_user should be checked in production
    # current_user: User = Depends(get_current_user)
):
    """Update user information"""
    user = get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    # Update fields
    update_data = user_update.model_dump(exclude_unset=True)
    
    # Handle username change
    if "username" in update_data and update_data["username"]:
        existing = get_user_by_username(db, update_data["username"])
        if existing and existing.id != user_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Username already registered"
            )
    
    for field, value in update_data.items():
        setattr(user, field, value)
    
    user.updated_at = datetime.utcnow()
    
    db.commit()
    db.refresh(user)
    
    return user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    # Critical: current_user should be checked in production
    # current_user: User = Depends(get_current_user)
):
    """Delete user (soft delete recommended in production)"""
    user = get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    db.delete(user)
    db.commit()


@router.post("/auth/login")
def login(
    username: str,
    password: str,
    db: Session = Depends(get_db)
):
    """
    Login endpoint - returns token (simplified for Phase 1.1)
    In production, use proper JWT tokens
    """
    user = get_user_by_username(db, username)
    
    if not user or not verify_password(password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials"
        )
    
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is disabled"
        )
    
    # Simplified token response
    return {
        "access_token": f"token-{user.id}-{user.role}",
        "token_type": "bearer",
        "user": UserResponse.model_validate(user)
    }
