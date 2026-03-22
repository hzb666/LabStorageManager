# app/api/user_logs.py
"""
User Logs API - Admin User Activity Logs
"""
import secrets
import time
from typing import Callable, Optional

import redis
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlmodel import select

from app.core.redis import get_redis, redis_key
from app.core.auth import AdminUser, require_admin
from app.core.constants import (
    DEFAULT_PAGE_SIZE,
    LOG_TOKEN_EXPIRE_HOURS,
    LOG_TOKEN_RATE_LIMIT,
    LOG_TOKEN_RATE_WINDOW,
    MAX_PAGE_SIZE,
    SECONDS_PER_HOUR,
)
from app.core.time_utils import utc_iso_str
from app.database import DBSession
from app.models.user_session import UserSession
from app.services.user_service import get_user_by_id

router = APIRouter(prefix="/admin/users", tags=["User Logs"])

# ==================== Helper Functions ====================

def _check_logs_token_rate_limit(admin_user_id: int) -> None:
    """检查管理员生成日志 token 的速率限制"""
    redis_client = get_redis()
    
    if redis_client is None:
        # Redis 不可用时，跳过速率限制检查（降级处理）
        return
    
    key = redis_key(f"rate_limit:logs_token:{admin_user_id}")
    
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
    
    key = redis_key(f"rate_limit:logs_token:{admin_user_id}")
    
    try:
        pipe = redis_client.pipeline()
        pipe.incr(key)
        pipe.expire(key, LOG_TOKEN_RATE_WINDOW)
        pipe.execute()
    except redis.RedisError:
        pass


def create_log_token(user_id: int, expire_hours: int = LOG_TOKEN_EXPIRE_HOURS) -> str:
    """创建日志访问token，格式：{user_id}_{expires_timestamp}_{random}"""
    expires_at = int(time.time()) + expire_hours * SECONDS_PER_HOUR
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
    log_type: Optional[str] = None  # 日志类型：reagent_order, consumable_order, inventory, borrow, consume, session
    skip: int = 0
    limit: int = DEFAULT_PAGE_SIZE


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


@router.get("/logs/{token}", response_model=dict, dependencies=[Depends(require_admin)])
def get_user_logs(
    token: str,
    db: DBSession,
    keyword: Optional[str] = None,
    log_type: Optional[str] = None,
    skip: int = 0,
    limit: int = DEFAULT_PAGE_SIZE,
):
    """获取用户日志（管理员专属）"""
    # 验证 token（避免重复解析）
    parsed = parse_log_token(token)
    if parsed is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token expired, please regenerate"
        )

    user_id, expires_at = parsed
    if time.time() >= expires_at:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token expired, please regenerate"
        )

    # 分页参数保护：与其他列表接口保持一致，避免异常大页导致性能抖动
    skip = max(skip, 0)
    limit = max(0, min(limit, MAX_PAGE_SIZE))
    
    # 获取用户信息
    user = get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    # 与现有语义保持一致：limit=0 时返回空列表和 total=0
    if limit == 0:
        return {
            "user_id": user_id,
            "username": user.username,
            "data": [],
            "total": 0,
        }

    candidates: list[dict[str, object]] = []

    def add_candidate(time_str: str | None, builder: Callable[[], dict[str, object]]) -> None:
        candidates.append({
            "time": time_str or "",
            "builder": builder,
        })
    
    # 1. 试剂订单
    if log_type is None or log_type == "reagent_order":
        from app.models.reagent_order import ReagentOrder
        query = select(ReagentOrder).where(ReagentOrder.applicant_id == user_id)
        if keyword:
            query = query.where(ReagentOrder.name.contains(keyword))
        orders = db.exec(query.order_by(ReagentOrder.created_at.desc()).offset(skip).limit(limit)).all()
        for o in orders:
            created_at = utc_iso_str(o.created_at)

            def build_reagent_order(o=o, created_at=created_at):
                return {
                    "time": created_at,
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
                        "created_at": created_at,
                        "updated_at": utc_iso_str(o.updated_at),
                    }
                }

            add_candidate(created_at, build_reagent_order)
    
    # 2. 耗材订单
    if log_type is None or log_type == "consumable_order":
        from app.models.consumable_order import ConsumableOrder
        query = select(ConsumableOrder).where(ConsumableOrder.applicant_id == user_id)
        if keyword:
            query = query.where(ConsumableOrder.name.contains(keyword))
        orders = db.exec(query.order_by(ConsumableOrder.created_at.desc()).offset(skip).limit(limit)).all()
        for o in orders:
            created_at = utc_iso_str(o.created_at)

            def build_consumable_order(o=o, created_at=created_at):
                return {
                    "time": created_at,
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
                        "created_at": created_at,
                        "updated_at": utc_iso_str(o.updated_at),
                    }
                }

            add_candidate(created_at, build_consumable_order)
    
    # 3. 库存（入库）
    if log_type is None or log_type == "inventory":
        from app.models.inventory import Inventory
        query = select(Inventory).where(Inventory.created_by_id == user_id)
        if keyword:
            query = query.where(Inventory.name.contains(keyword))
        items = db.exec(query.order_by(Inventory.created_at.desc()).offset(skip).limit(limit)).all()
        for i in items:
            created_at = utc_iso_str(i.created_at)

            def build_inventory(i=i, created_at=created_at):
                return {
                    "time": created_at,
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
                        "created_at": created_at,
                        "updated_at": utc_iso_str(i.updated_at),
                    }
                }

            add_candidate(created_at, build_inventory)
    
    # 4. 借用记录 - 从 BorrowLog 表查询
    if log_type is None or log_type == "borrow":
        from app.models.inventory import Inventory, BorrowLog
        query = select(BorrowLog, Inventory).join(
            Inventory, BorrowLog.inventory_id == Inventory.id
        ).where(
            BorrowLog.borrower_id == user_id,
            BorrowLog.is_consume.is_(False),
        )
        if keyword:
            query = query.where(Inventory.name.contains(keyword))
        logs = db.exec(query.order_by(BorrowLog.borrow_time.desc()).offset(skip).limit(limit)).all()
        for log, inv in logs:
            # 计算归还状态
            is_returned = log.return_time is not None
            return_info = f", 已归还 {log.quantity_returned} {inv.unit or ''}" if is_returned else ", 未归还"

            borrow_time = utc_iso_str(log.borrow_time)

            def build_borrow(log=log, inv=inv, is_returned=is_returned, return_info=return_info, borrow_time=borrow_time):
                return {
                    "time": borrow_time,
                    "type": "borrow",
                    # 展开前显示的模板：显示借了多少、是否已归还、归还多少
                    "detail": f"借用 {inv.name} {log.quantity_borrowed} {inv.unit or ''}{return_info}",
                    "full_data": {
                        "id": log.id,
                        "inventory_id": log.inventory_id,
                        "inventory_name": inv.name,
                        "cas_number": inv.cas_number,
                        "borrow_time": borrow_time,
                        "return_time": utc_iso_str(log.return_time),
                        "quantity_borrowed": log.quantity_borrowed,
                        "quantity_returned": log.quantity_returned,
                        "unit": inv.unit,
                        "notes": log.notes,
                        "is_returned": is_returned,
                        "created_at": utc_iso_str(log.created_at),
                    }
                }

            add_candidate(borrow_time, build_borrow)
    
    # 5. 常用货架拿取记录 - 从 BorrowLog 表查询
    if log_type is None or log_type == "consume":
        from app.models.inventory import Inventory, BorrowLog
        query = select(BorrowLog, Inventory).join(
            Inventory, BorrowLog.inventory_id == Inventory.id
        ).where(
            BorrowLog.borrower_id == user_id,
            BorrowLog.is_consume.is_(True),
        )
        if keyword:
            query = query.where(Inventory.name.contains(keyword))
        logs = db.exec(query.order_by(BorrowLog.borrow_time.desc()).offset(skip).limit(limit)).all()
        for log, inv in logs:
            consume_time = utc_iso_str(log.borrow_time)

            def build_consume(log=log, inv=inv, consume_time=consume_time):
                return {
                    "time": consume_time,
                    "type": "consume",
                    "detail": f"常用货架拿取 {inv.name} 1 瓶",
                    "full_data": {
                        "id": log.id,
                        "inventory_id": log.inventory_id,
                        "inventory_name": inv.name,
                        "cas_number": inv.cas_number,
                        "consume_time": consume_time,
                        "quantity_consumed": log.quantity_borrowed,
                        "unit": inv.unit,
                        "storage_location": inv.storage_location,
                        "notes": log.notes,
                        "created_at": utc_iso_str(log.created_at),
                    }
                }

            add_candidate(consume_time, build_consume)

    # 6. 登录记录
    if log_type is None or log_type == "session":
        query = select(UserSession).where(UserSession.user_id == user_id)
        sessions = db.exec(query.order_by(UserSession.last_active_at.desc()).offset(skip).limit(limit)).all()
        for s in sessions:
            last_active_at = utc_iso_str(s.last_active_at)

            def build_session(s=s, last_active_at=last_active_at):
                return {
                    "time": last_active_at,
                    "type": "session",
                    "detail": f"登录 {s.device_name} {s.ip_address}",
                    "full_data": {
                        "id": s.id,
                        "device_id": s.device_id,
                        "device_name": s.device_name,
                        "ip_address": s.ip_address,
                        "last_ip_address": s.last_ip_address,
                        "user_agent": s.user_agent,
                        "created_at": utc_iso_str(s.created_at),
                        "last_active_at": last_active_at,
                        "expires_at": utc_iso_str(s.expires_at),
                    }
                }

            add_candidate(last_active_at, build_session)

    # 保持原有排序语义（time 降序），仅在最终页面中构造 full_data，减少 CPU 与对象分配
    candidates.sort(key=lambda item: item["time"], reverse=True)
    selected = candidates[:limit]
    results = [item["builder"]() for item in selected]

    return {
        "user_id": user_id,
        "username": user.username,
        "data": results,
        "total": len(candidates)
    }
