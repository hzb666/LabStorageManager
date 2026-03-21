import hashlib
from datetime import datetime
from typing import Annotated

from fastapi import BackgroundTasks, Depends, HTTPException, Request, status
from sqlmodel import Session, select

from app.core.config import settings
from app.core.constants import ACTIVITY_DEBOUNCE_SECONDS
from app.core.time_utils import get_utc_now
from app.core.redis import cache_session, delete_cached_session, get_cached_session
from app.database import get_db, engine  # 必须引入 engine 供后台任务使用
from app.models.user import User
from app.models.user_session import UserSession

def compute_token_hash(token: str) -> str:
    """计算 Token 的 SHA-256 哈希值"""
    return hashlib.sha256(token.encode()).hexdigest()

def _update_activity_task(session_id: int, current_ip: str) -> None:
    """
    后台同步更新任务：更新最后活跃时间与最后活动 IP。
    由 FastAPI 放入线程池运行，不会阻塞主事件循环。
    （防抖逻辑已前置到主流程，这里直接执行 DB 操作）
    """
    with Session(engine) as db:
        session = db.get(UserSession, session_id)
        if session:
            session.last_active_at = get_utc_now()
            # 如果活动 IP 变了，记录最新的 IP
            if current_ip and session.last_ip_address != current_ip:
                session.last_ip_address = current_ip
            db.add(session)
            db.commit()


def get_current_session(
    request: Request,
    background_tasks: BackgroundTasks,
    db: Annotated[Session, Depends(get_db)]
) -> tuple[User, UserSession]:
    """
    获取当前认证用户和会话
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    # 1. 提取 Token
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header[7:]
    
    if not token:
        raise credentials_exception
    
    # 2. 计算 Hash 并获取 IP
    token_hash = compute_token_hash(token)
    client_ip = request.client.host if request.client else "unknown"
    
    # 3. Redis 缓存优先查询 (0 DB 消耗目标)
    cached_data = get_cached_session(token_hash)
    if cached_data:
        expires_at = datetime.fromisoformat(cached_data["expires_at"])
        if expires_at < get_utc_now():
            delete_cached_session(token_hash)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session expired"
            )
        
        # 严格 IP 绑定检查：对比的是首次登录的 ip_address
        if cached_data.get("ip_address") != client_ip and settings.session_strict_ip:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="IP address changed"
            )
            
        if not cached_data.get("is_active", True):
            delete_cached_session(token_hash)
            raise credentials_exception

        # 从缓存恢复 User 和 Session
        user = User(
            id=cached_data["user_id"],
            username=cached_data["username"],
            is_active=cached_data.get("is_active", True)
        )
        
        session = UserSession(
            id=cached_data.get("session_id"),
            user_id=user.id,
            device_id=cached_data.get("device_id"),
            device_name=cached_data.get("device_name"),
            ip_address=cached_data.get("ip_address"),
            last_ip_address=cached_data.get("last_ip_address", client_ip), # 优先从缓存取
            user_agent=cached_data.get("user_agent", ""),
            token_hash=token_hash,
            expires_at=expires_at,
            last_active_at=datetime.fromisoformat(cached_data["last_active_at"]) if cached_data.get("last_active_at") else None
        )

        # --- 核心优化点：防抖前置 ---
        # 只有距离上次记录超过 5 分钟，或者 IP 发生了变动，才去更新 Redis 和 数据库
        needs_update = False
        now_utc = get_utc_now()
        
        if session.last_active_at:
            if (now_utc - session.last_active_at).total_seconds() >= ACTIVITY_DEBOUNCE_SECONDS:
                needs_update = True
        else:
            needs_update = True
            
        if session.last_ip_address != client_ip:
            needs_update = True

        if needs_update:
            # 1. 触发后台写库任务（此时才触发，极大缓解并发写库问题）
            background_tasks.add_task(_update_activity_task, session.id, client_ip)
            
            # 2. 刷新 Redis 缓存（不仅续期，也更新最后活跃时间和最后 IP）
            cached_data["last_active_at"] = now_utc.isoformat()
            cached_data["last_ip_address"] = client_ip
            cache_session(
                token_hash,
                cached_data,
                int((expires_at - now_utc).total_seconds())
            )
            
            # 同步更新当前流程内存对象的值
            session.last_active_at = now_utc
            session.last_ip_address = client_ip
        
        return user, session

    # 4. 缓存未命中：从数据库查询
    session = db.exec(select(UserSession).where(UserSession.token_hash == token_hash)).first()
    
    if not session:
        raise credentials_exception
    
    if session.expires_at < get_utc_now():
        db.delete(session)
        db.commit()
        raise HTTPException(status_code=401, detail="Session expired")
    
    if session.ip_address != client_ip and settings.session_strict_ip:
        raise HTTPException(status_code=401, detail="IP address changed")

    user = db.get(User, session.user_id)
    if not user or not user.is_active:
        raise credentials_exception
    
    # 缓存未命中时，说明刚登录或者缓存刚过期，直接在当前流程更新
    session.last_active_at = get_utc_now()
    session.last_ip_address = client_ip
    db.add(session)
    db.commit()
    db.refresh(session)
    
    # 5. 回填 Redis 缓存（加入 last_ip_address）
    cache_session(
        token_hash,
        {
            "session_id": session.id,
            "user_id": user.id,
            "username": user.username,
            "is_active": user.is_active,
            "device_id": session.device_id,
            "device_name": session.device_name,
            "ip_address": session.ip_address,
            "last_ip_address": session.last_ip_address, # 缓存 last_ip
            "user_agent": session.user_agent,
            "expires_at": session.expires_at.isoformat(),
            "last_active_at": session.last_active_at.isoformat(),
        },
        int((session.expires_at - get_utc_now()).total_seconds())
    )
    
    return user, session