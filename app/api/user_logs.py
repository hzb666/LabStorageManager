# 管理员查看用户多来源操作日志。
from dataclasses import dataclass
import secrets
import time
from typing import Callable, Optional

import redis
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
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
from app.services.inventory_queries import (
    common_inventory_clause,
    regular_inventory_clause,
    regular_inventory_query,
)
from app.services.user_service import get_user_by_id

router = APIRouter(prefix="/admin/users", tags=["User Logs"])

def _check_logs_token_rate_limit(admin_user_id: int) -> None:
    redis_client = get_redis()
    
    if redis_client is None:
        # 排查链路不能被 Redis 可用性阻断，缺少限流时退化为放行。
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
        # 限流失败时维持功能可用，避免管理员无法拉取排查日志。
        pass


def _record_logs_token_request(admin_user_id: int) -> None:
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
    expires_at = int(time.time()) + expire_hours * SECONDS_PER_HOUR
    random_part = secrets.token_hex(8)
    return f"{user_id}_{expires_at}_{random_part}"


def parse_log_token(token: str) -> tuple[int, int] | None:
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
    result = parse_log_token(token)
    if result is None:
        return False
    _, expires_at = result
    return time.time() < expires_at


class LogsQueryParams(BaseModel):
    keyword: Optional[str] = Field(default=None, max_length=100)  # 搜索关键词
    log_type: Optional[str] = None  # 日志类型：reagent_order, consumable_order, inventory, borrow, consume, session
    skip: int = 0
    limit: int = DEFAULT_PAGE_SIZE


class LogsQueryRequest(BaseModel):
    token: str
    keyword: Optional[str] = Field(default=None, max_length=100)
    log_type: Optional[str] = None
    skip: int = 0
    limit: int = DEFAULT_PAGE_SIZE


@dataclass
class LogsCollectContext:
    db: DBSession
    user_id: int
    keyword: str | None
    skip: int
    limit: int


def _resolve_logs_query_user(token: str, db: DBSession):
    # 日志查询依赖短期 token，不复用主登录态，避免把管理员权限泄漏给前端二次请求。
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

    user = get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    return user_id, user


def _normalize_logs_pagination(skip: int, limit: int) -> tuple[int, int]:
    return max(skip, 0), max(0, min(limit, MAX_PAGE_SIZE))


def _append_candidate(
    candidates: list[dict[str, object]],
    time_str: str | None,
    builder: Callable[[], dict[str, object]],
) -> None:
    candidates.append(
        {
            "time": time_str or "",
            "builder": builder,
        }
    )


def _append_reagent_order_candidates(context: LogsCollectContext, candidates: list[dict[str, object]]) -> None:
    from app.models.reagent_order import ReagentOrder

    query = select(ReagentOrder).where(ReagentOrder.applicant_id == context.user_id)
    if context.keyword:
        query = query.where(ReagentOrder.name.contains(context.keyword))
    orders = context.db.exec(
        query.order_by(ReagentOrder.created_at.desc()).offset(context.skip).limit(context.limit)
    ).all()
    for order in orders:
        created_at = utc_iso_str(order.created_at)

        def build_reagent_order(order=order, created_at=created_at):
            return {
                "time": created_at,
                "type": "reagent_order",
                "detail": f"申购 {order.name} {order.initial_quantity or ''}{order.unit or ''} x{order.quantity}",
                "full_data": {
                    "id": order.id,
                    "cas_number": order.cas_number,
                    "name": order.name,
                    "english_name": order.english_name,
                    "alias": order.alias,
                    "category": order.category,
                    "brand": order.brand,
                    "initial_quantity": order.initial_quantity,
                    "unit": order.unit,
                    "quantity": order.quantity,
                    "price": order.price,
                    "order_reason": order.order_reason.value if order.order_reason else None,
                    "is_hazardous": order.is_hazardous,
                    "notes": order.notes,
                    "status": order.status.value if order.status else None,
                    "created_at": created_at,
                    "updated_at": utc_iso_str(order.updated_at),
                }
            }

        _append_candidate(candidates, created_at, build_reagent_order)


def _append_consumable_order_candidates(context: LogsCollectContext, candidates: list[dict[str, object]]) -> None:
    from app.models.consumable_order import ConsumableOrder

    query = select(ConsumableOrder).where(ConsumableOrder.applicant_id == context.user_id)
    if context.keyword:
        query = query.where(ConsumableOrder.name.contains(context.keyword))
    orders = context.db.exec(
        query.order_by(ConsumableOrder.created_at.desc()).offset(context.skip).limit(context.limit)
    ).all()
    for order in orders:
        created_at = utc_iso_str(order.created_at)

        def build_consumable_order(order=order, created_at=created_at):
            return {
                "time": created_at,
                "type": "consumable_order",
                "detail": f"申购 {order.name} {order.specification or ''} x{order.quantity}",
                "full_data": {
                    "id": order.id,
                    "name": order.name,
                    "english_name": order.english_name,
                    "specification": order.specification,
                    "unit": order.unit,
                    "quantity": order.quantity,
                    "price": order.price,
                    "communication": order.communication,
                    "notes": order.notes,
                    "status": order.status.value if order.status else None,
                    "created_at": created_at,
                    "updated_at": utc_iso_str(order.updated_at),
                }
            }

        _append_candidate(candidates, created_at, build_consumable_order)


def _append_inventory_candidates(context: LogsCollectContext, candidates: list[dict[str, object]]) -> None:
    from app.models.inventory import Inventory

    query = regular_inventory_query().where(Inventory.created_by_id == context.user_id)
    if context.keyword:
        query = query.where(Inventory.name.contains(context.keyword))
    items = context.db.exec(
        query.order_by(Inventory.created_at.desc()).offset(context.skip).limit(context.limit)
    ).all()
    for inventory in items:
        created_at = utc_iso_str(inventory.created_at)

        def build_inventory(inventory=inventory, created_at=created_at):
            return {
                "time": created_at,
                "type": "inventory",
                "detail": f"入库 {inventory.name} {inventory.initial_quantity or ''}{inventory.unit or ''}",
                "full_data": {
                    "id": inventory.id,
                    "cas_number": inventory.cas_number,
                    "name": inventory.name,
                    "english_name": inventory.english_name,
                    "alias": inventory.alias,
                    "category": inventory.category,
                    "brand": inventory.brand,
                    "storage_location": inventory.storage_location,
                    "initial_quantity": inventory.initial_quantity,
                    "remaining_quantity": inventory.remaining_quantity,
                    "unit": inventory.unit,
                    "is_hazardous": inventory.is_hazardous,
                    "notes": inventory.notes,
                    "internal_code": inventory.internal_code,
                    "status": inventory.status.value if inventory.status else None,
                    "created_at": created_at,
                    "updated_at": utc_iso_str(inventory.updated_at),
                }
            }

        _append_candidate(candidates, created_at, build_inventory)


def _append_borrow_candidates(context: LogsCollectContext, candidates: list[dict[str, object]]) -> None:
    from app.models.inventory import BorrowLog, Inventory

    query = select(BorrowLog, Inventory).join(
        Inventory, BorrowLog.inventory_id == Inventory.id
    ).where(
        BorrowLog.borrower_id == context.user_id,
        BorrowLog.is_consume.is_(False),
        regular_inventory_clause(),
    )
    if context.keyword:
        query = query.where(Inventory.name.contains(context.keyword))
    logs = context.db.exec(
        query.order_by(BorrowLog.borrow_time.desc()).offset(context.skip).limit(context.limit)
    ).all()
    for log, inventory in logs:
        is_returned = log.return_time is not None
        return_info = f", 已归还 {log.quantity_returned} {inventory.unit or ''}" if is_returned else ", 未归还"
        borrow_time = utc_iso_str(log.borrow_time)

        def build_borrow(
            log=log,
            inventory=inventory,
            is_returned=is_returned,
            return_info=return_info,
            borrow_time=borrow_time,
        ):
            return {
                "time": borrow_time,
                "type": "borrow",
                "detail": f"借用 {inventory.name} {log.quantity_borrowed} {inventory.unit or ''}{return_info}",
                "full_data": {
                    "id": log.id,
                    "inventory_id": log.inventory_id,
                    "inventory_name": inventory.name,
                    "cas_number": inventory.cas_number,
                    "borrow_time": borrow_time,
                    "return_time": utc_iso_str(log.return_time),
                    "quantity_borrowed": log.quantity_borrowed,
                    "quantity_returned": log.quantity_returned,
                    "unit": inventory.unit,
                    "notes": log.notes,
                    "is_returned": is_returned,
                    "created_at": utc_iso_str(log.created_at),
                }
            }

        _append_candidate(candidates, borrow_time, build_borrow)


def _append_consume_candidates(context: LogsCollectContext, candidates: list[dict[str, object]]) -> None:
    from app.models.inventory import BorrowLog, Inventory

    query = select(BorrowLog, Inventory).join(
        Inventory, BorrowLog.inventory_id == Inventory.id
    ).where(
        BorrowLog.borrower_id == context.user_id,
        BorrowLog.is_consume.is_(True),
        common_inventory_clause(),
    )
    if context.keyword:
        query = query.where(Inventory.name.contains(context.keyword))
    logs = context.db.exec(
        query.order_by(BorrowLog.borrow_time.desc()).offset(context.skip).limit(context.limit)
    ).all()
    for log, inventory in logs:
        consume_time = utc_iso_str(log.borrow_time)

        def build_consume(log=log, inventory=inventory, consume_time=consume_time):
            return {
                "time": consume_time,
                "type": "consume",
                "detail": f"常用货架拿取 {inventory.name} 1 瓶",
                "full_data": {
                    "id": log.id,
                    "inventory_id": log.inventory_id,
                    "inventory_name": inventory.name,
                    "cas_number": inventory.cas_number,
                    "consume_time": consume_time,
                    "quantity_consumed": log.quantity_borrowed,
                    "unit": inventory.unit,
                    "storage_location": inventory.storage_location,
                    "notes": log.notes,
                    "created_at": utc_iso_str(log.created_at),
                }
            }

        _append_candidate(candidates, consume_time, build_consume)


def _append_session_candidates(context: LogsCollectContext, candidates: list[dict[str, object]]) -> None:
    query = select(UserSession).where(UserSession.user_id == context.user_id)
    sessions = context.db.exec(
        query.order_by(UserSession.last_active_at.desc()).offset(context.skip).limit(context.limit)
    ).all()
    for session in sessions:
        last_active_at = utc_iso_str(session.last_active_at)

        def build_session(session=session, last_active_at=last_active_at):
            return {
                "time": last_active_at,
                "type": "session",
                "detail": f"登录 {session.device_name} {session.ip_address}",
                "full_data": {
                    "id": session.id,
                    "device_id": session.device_id,
                    "device_name": session.device_name,
                    "ip_address": session.ip_address,
                    "last_ip_address": session.last_ip_address,
                    "user_agent": session.user_agent,
                    "created_at": utc_iso_str(session.created_at),
                    "last_active_at": last_active_at,
                    "expires_at": utc_iso_str(session.expires_at),
                }
            }

        _append_candidate(candidates, last_active_at, build_session)


_LOG_QUERY_BUILDERS = {
    "reagent_order": _append_reagent_order_candidates,
    "consumable_order": _append_consumable_order_candidates,
    "inventory": _append_inventory_candidates,
    "borrow": _append_borrow_candidates,
    "consume": _append_consume_candidates,
    "session": _append_session_candidates,
}


def _collect_user_logs(
    context: LogsCollectContext,
    log_type: str | None,
) -> list[dict[str, object]]:
    candidates: list[dict[str, object]] = []
    builders = _LOG_QUERY_BUILDERS.values() if log_type is None else (_LOG_QUERY_BUILDERS.get(log_type),)

    for builder in builders:
        if builder is None:
            continue
        builder(context, candidates)

    candidates.sort(key=lambda item: item["time"], reverse=True)
    return candidates

@router.post("/{user_id}/logs-token")
def generate_logs_token(
    user_id: int,
    current_user: AdminUser,
    db: DBSession,
):
    # 管理员生成日志 token 会触发跨表聚合查询，仍要保留基础限流。
    _check_logs_token_rate_limit(current_user.id)
    _record_logs_token_request(current_user.id)
    
    user = get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    token = create_log_token(user_id)
    
    return {
        "token": token,
        "user_id": user_id,
        "username": user.username,
        "expires_hours": LOG_TOKEN_EXPIRE_HOURS
    }


@router.post("/logs/query", response_model=dict, dependencies=[Depends(require_admin)])
def get_user_logs(
    request: LogsQueryRequest,
    db: DBSession,
):
    user_id, user = _resolve_logs_query_user(request.token, db)
    skip, limit = _normalize_logs_pagination(request.skip, request.limit)

    # 保持既有语义：limit=0 只返回用户信息，不触发聚合查询。
    if limit == 0:
        return {
            "user_id": user_id,
            "username": user.username,
            "data": [],
            "total": 0,
        }

    candidates = _collect_user_logs(
        context=LogsCollectContext(
            db=db,
            user_id=user_id,
            keyword=request.keyword,
            skip=skip,
            limit=limit,
        ),
        log_type=request.log_type,
    )
    selected = candidates[:limit]
    results = [item["builder"]() for item in selected]

    return {
        "user_id": user_id,
        "username": user.username,
        "data": results,
        "total": len(candidates)
    }
