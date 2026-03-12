# app/api/user_logs.py
"""
User Logs API - Admin User Activity Logs
"""
import secrets
import time
from typing import Optional

import redis
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlmodel import select

from app.core.redis import get_redis
from app.core.auth import AdminUser
from app.database import DBSession
from app.models.user_session import UserSession
from app.services.user_service import get_user_by_id

router = APIRouter(prefix="/admin/users", tags=["User Logs"])

# ==================== Constants ====================
LOG_TOKEN_EXPIRE_HOURS = 2  # token有效期2小时

# 日志 Token 生成速率限制
LOG_TOKEN_RATE_LIMIT = 3  # 每分钟最多生成 3 次
LOG_TOKEN_RATE_WINDOW = 30  # 30 秒窗口


# ==================== Helper Functions ====================

def _check_logs_token_rate_limit(admin_user_id: int) -> None:
    """检查管理员生成日志 token 的速率限制"""
    redis_client = get_redis()
    
    if redis_client is None:
        # Redis 不可用时，跳过速率限制检查（降级处理）
        return
    
    key = f"rate_limit:logs_token:{admin_user_id}"
    
    try:
        current = redis_client.get(key)
        
        if current is not None:
            count = int(current)
            ttl = redis_client.ttl(key)
            
            if ttl > 0 and count >= LOG_TOKEN_RATE_LIMIT:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Too many requests, please try again later"
                )
    except redis.RedisError:
        # Redis 错误时，跳过速率限制（降级处理）
        pass


def _record_logs_token_request(admin_user_id: int) -> None:
    """记录日志 token 生成请求"""
    redis_client = get_redis()
    
    if redis_client is None:
        return
    
    key = f"rate_limit:logs_token:{admin_user_id}"
    
    try:
        pipe = redis_client.pipeline()
        pipe.incr(key)
        pipe.expire(key, LOG_TOKEN_RATE_WINDOW)
        pipe.execute()
    except redis.RedisError:
        pass


def create_log_token(user_id: int, expire_hours: int = LOG_TOKEN_EXPIRE_HOURS) -> str:
    """创建日志访问token，格式：{user_id}_{expires_timestamp}_{random}"""
    expires_at = int(time.time()) + expire_hours * 3600
    random_part = secrets.token_hex(8)
    return f"{user_id}_{expires_at}_{random_part}"


def parse_log_token(token: str) -> tuple[int, int] | None:
    """解析token，返回 (user_id, expires_timestamp)，无效返回None"""
    try:
        parts = token.split("_")
        if len(parts) != 3:
            return None
        user_id = int(parts[0])
        expires_at = int(parts[1])
        return (user_id, expires_at)
    except (ValueError, IndexError):
        return None


def is_token_valid(token: str) -> bool:
    """检查token是否有效（未过期）"""
    result = parse_log_token(token)
    if result is None:
        return False
    _, expires_at = result
    return time.time() < expires_at


class LogsQueryParams(BaseModel):
    """日志查询参数"""
    keyword: Optional[str] = None  # 搜索关键词
    log_type: Optional[str] = None  # 日志类型：reagent_order, consumable_order, inventory, borrow, session
    skip: int = 0
    limit: int = 20


# ==================== Routes ====================

@router.post("/{user_id}/logs-token")
def generate_logs_token(
    user_id: int,
    current_user: AdminUser,
    db: DBSession,
):
    """生成用户日志访问token（管理员专属）"""
    # 检查速率限制
    _check_logs_token_rate_limit(current_user.id)
    _record_logs_token_request(current_user.id)
    
    # 检查用户是否存在
    user = get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    # 生成token
    token = create_log_token(user_id)
    
    return {
        "token": token,
        "user_id": user_id,
        "username": user.username,
        "expires_hours": LOG_TOKEN_EXPIRE_HOURS
    }


@router.get("/logs/{token}", response_model=dict)
def get_user_logs(
    token: str,
    current_user: AdminUser,
    db: DBSession,
    keyword: Optional[str] = None,
    log_type: Optional[str] = None,
    skip: int = 0,
    limit: int = 20,
):
    """获取用户日志（管理员专属）"""
    # 验证token
    if not is_token_valid(token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token expired, please regenerate"
        )
    
    user_id, _ = parse_log_token(token)
    
    # 获取用户信息
    user = get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    results = []
    
    # 1. 试剂订单
    if log_type is None or log_type == "reagent_order":
        from app.models.reagent_order import ReagentOrder
        query = select(ReagentOrder).where(ReagentOrder.applicant_id == user_id)
        if keyword:
            query = query.where(ReagentOrder.name.contains(keyword))
        orders = db.exec(query.order_by(ReagentOrder.created_at.desc()).offset(skip).limit(limit)).all()
        for o in orders:
            results.append({
                "time": o.created_at.isoformat() + 'Z' if o.created_at else None,
                "type": "reagent_order",
                # 展开前显示的模板
                "detail": f"申购 {o.name} {o.initial_quantity or ''}{o.unit or ''} x{o.quantity}",
                # 展开后的所有字段
                "full_data": {
                    "id": o.id,
                    "cas_number": o.cas_number,
                    "name": o.name,
                    "english_name": o.english_name,
                    "alias": o.alias,
                    "category": o.category,
                    "brand": o.brand,
                    "initial_quantity": o.initial_quantity,
                    "unit": o.unit,
                    "quantity": o.quantity,
                    "price": o.price,
                    "order_reason": o.order_reason.value if o.order_reason else None,
                    "is_hazardous": o.is_hazardous,
                    "notes": o.notes,
                    "status": o.status.value if o.status else None,
                    "created_at": o.created_at.isoformat() + 'Z' if o.created_at else None,
                    "updated_at": o.updated_at.isoformat() + 'Z' if o.updated_at else None,
                }
            })
    
    # 2. 耗材订单
    if log_type is None or log_type == "consumable_order":
        from app.models.consumable_order import ConsumableOrder
        query = select(ConsumableOrder).where(ConsumableOrder.applicant_id == user_id)
        if keyword:
            query = query.where(ConsumableOrder.name.contains(keyword))
        orders = db.exec(query.order_by(ConsumableOrder.created_at.desc()).offset(skip).limit(limit)).all()
        for o in orders:
            results.append({
                "time": o.created_at.isoformat() + 'Z' if o.created_at else None,
                "type": "consumable_order",
                "detail": f"申购 {o.name} {o.specification or ''} x{o.quantity}",
                "full_data": {
                    "id": o.id,
                    "name": o.name,
                    "english_name": o.english_name,
                    "specification": o.specification,
                    "unit": o.unit,
                    "quantity": o.quantity,
                    "price": o.price,
                    "communication": o.communication,
                    "notes": o.notes,
                    "status": o.status.value if o.status else None,
                    "created_at": o.created_at.isoformat() + 'Z' if o.created_at else None,
                    "updated_at": o.updated_at.isoformat() + 'Z' if o.updated_at else None,
                }
            })
    
    # 3. 库存（入库）
    if log_type is None or log_type == "inventory":
        from app.models.inventory import Inventory
        query = select(Inventory).where(Inventory.created_by_id == user_id)
        if keyword:
            query = query.where(Inventory.name.contains(keyword))
        items = db.exec(query.order_by(Inventory.created_at.desc()).offset(skip).limit(limit)).all()
        for i in items:
            results.append({
                "time": i.created_at.isoformat() + 'Z' if i.created_at else None,
                "type": "inventory",
                "detail": f"入库 {i.name} {i.initial_quantity or ''}{i.unit or ''}",
                "full_data": {
                    "id": i.id,
                    "cas_number": i.cas_number,
                    "name": i.name,
                    "english_name": i.english_name,
                    "alias": i.alias,
                    "category": i.category,
                    "brand": i.brand,
                    "storage_location": i.storage_location,
                    "initial_quantity": i.initial_quantity,
                    "remaining_quantity": i.remaining_quantity,
                    "unit": i.unit,
                    "is_hazardous": i.is_hazardous,
                    "notes": i.notes,
                    "internal_code": i.internal_code,
                    "status": i.status.value if i.status else None,
                    "created_at": i.created_at.isoformat() + 'Z' if i.created_at else None,
                    "updated_at": i.updated_at.isoformat() + 'Z' if i.updated_at else None,
                }
            })
    
    # 4. 借用记录 - 从 BorrowLog 表查询
    if log_type is None or log_type == "borrow":
        from app.models.inventory import Inventory, BorrowLog
        query = select(BorrowLog, Inventory).join(
            Inventory, BorrowLog.inventory_id == Inventory.id
        ).where(BorrowLog.borrower_id == user_id)
        if keyword:
            query = query.where(Inventory.name.contains(keyword))
        logs = db.exec(query.order_by(BorrowLog.borrow_time.desc()).offset(skip).limit(limit)).all()
        for log, inv in logs:
            # 计算归还状态
            is_returned = log.return_time is not None
            return_info = f", 已归还 {log.quantity_returned} {inv.unit or ''}" if is_returned else ", 未归还"
            
            results.append({
                "time": log.borrow_time.isoformat() + 'Z' if log.borrow_time else None,
                "type": "borrow",
                # 展开前显示的模板：显示借了多少、是否已归还、归还多少
                "detail": f"借用 {inv.name} {log.quantity_borrowed} {inv.unit or ''}{return_info}",
                "full_data": {
                    "id": log.id,
                    "inventory_id": log.inventory_id,
                    "inventory_name": inv.name,
                    "cas_number": inv.cas_number,
                    "borrow_time": log.borrow_time.isoformat() + 'Z' if log.borrow_time else None,
                    "return_time": log.return_time.isoformat() + 'Z' if log.return_time else None,
                    "quantity_borrowed": log.quantity_borrowed,
                    "quantity_returned": log.quantity_returned,
                    "unit": inv.unit,
                    "notes": log.notes,
                    "is_returned": is_returned,
                    "created_at": log.created_at.isoformat() + 'Z' if log.created_at else None,
                }
            })
    
    # 5. 登录记录
    if log_type is None or log_type == "session":
        query = select(UserSession).where(UserSession.user_id == user_id)
        sessions = db.exec(query.order_by(UserSession.last_active_at.desc()).offset(skip).limit(limit)).all()
        for s in sessions:
            results.append({
                "time": s.last_active_at.isoformat() + 'Z' if s.last_active_at else None,
                "type": "session",
                "detail": f"登录 {s.device_name} {s.ip_address}",
                "full_data": {
                    "id": s.id,
                    "device_id": s.device_id,
                    "device_name": s.device_name,
                    "ip_address": s.ip_address,
                    "last_ip_address": s.last_ip_address,
                    "user_agent": s.user_agent,
                    "created_at": s.created_at.isoformat() + 'Z' if s.created_at else None,
                    "last_active_at": s.last_active_at.isoformat() + 'Z' if s.last_active_at else None,
                    "expires_at": s.expires_at.isoformat() + 'Z' if s.expires_at else None,
                }
            })
    
    results.sort(key=lambda item: item["time"] or "", reverse=True)
    
    return {
        "user_id": user_id,
        "username": user.username,
        "data": results[:limit],
        "total": len(results)
    }
