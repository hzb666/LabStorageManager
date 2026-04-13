# 管理员查看用户多来源操作日志。
import base64
from dataclasses import dataclass
import hashlib
import hmac
import json
import secrets
import time
from typing import Callable, Optional

import redis
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlmodel import select

from app.core.redis import get_redis, redis_key
from app.core.auth import AdminUser, require_admin
from app.core.config import settings
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
from app.models.inventory_operation_log import (
    InventoryOperationAction,
    InventoryOperationLog,
)
from app.models.common_shelf_operation_log import (
    CommonShelfOperationAction,
    CommonShelfOperationLog,
)
from app.models.reagent_order_operation_log import ReagentOrderOperationLog
from app.models.consumable_order_operation_log import ConsumableOrderOperationLog
from app.models.log_timeline import LogTimeline, LogTimelineSourceTable
from app.models.user_operation_log import UserOperationLog
from app.services.order_fts import build_order_fts_rowid_subquery, should_use_order_fts
from app.services.common_shelf_operation_logger import parse_common_shelf_snapshot
from app.services.inventory_operation_logger import parse_inventory_snapshot
from app.services.order_operation_logger import (
    parse_consumable_order_snapshot,
    parse_reagent_order_snapshot,
)
from app.services.sql_utils import normalize_search_term
from app.services.user_operation_logger import parse_user_operation_snapshot
from app.services.user_service import get_user_by_id
from app.services.user_utils import batch_get_user_names

router = APIRouter(prefix="/admin/users", tags=["User Logs"])


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64url_decode(raw: str) -> bytes:
    padding = "=" * ((4 - len(raw) % 4) % 4)
    return base64.urlsafe_b64decode(f"{raw}{padding}")


def _get_logs_token_signing_key() -> bytes:
    if settings.secret_key:
        return settings.secret_key.encode("utf-8")
    return settings.get_private_key().encode("utf-8")


def _sign_logs_token_payload(payload_part: str) -> str:
    digest = hmac.new(
        _get_logs_token_signing_key(),
        payload_part.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    return _b64url_encode(digest)

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
    payload = {
        "uid": user_id,
        "exp": expires_at,
        "rnd": secrets.token_hex(8),
    }
    payload_part = _b64url_encode(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    )
    signature = _sign_logs_token_payload(payload_part)
    return f"{payload_part}.{signature}"


def parse_log_token(token: str) -> tuple[int, int] | None:
    try:
        payload_part, signature = token.split(".", maxsplit=1)
        expected_signature = _sign_logs_token_payload(payload_part)
        if not hmac.compare_digest(signature, expected_signature):
            return None

        payload = json.loads(_b64url_decode(payload_part).decode("utf-8"))
        if not isinstance(payload, dict):
            return None

        user_id = int(payload.get("uid"))
        expires_at = int(payload.get("exp"))
        if user_id <= 0 or expires_at <= 0:
            return None
        return (user_id, expires_at)
    except (ValueError, IndexError, json.JSONDecodeError, UnicodeDecodeError):
        return None


def is_token_valid(token: str) -> bool:
    result = parse_log_token(token)
    if result is None:
        return False
    _, expires_at = result
    return time.time() < expires_at


class LogsQueryParams(BaseModel):
    keyword: Optional[str] = Field(default=None, max_length=100)  # 搜索关键词
    log_type: Optional[str] = None  # 日志类型：reagent_order, consumable_order, inventory, borrow, session
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


@dataclass
class LogsCountContext:
    db: DBSession
    user_id: int
    keyword: str | None


LogsCandidateBuilder = Callable[[LogsCollectContext, list[dict[str, object]]], None]
LogsCounter = Callable[[LogsCountContext], int]


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


REAGENT_ORDER_ACTION_LABELS: dict[str, str] = {
    "create": "创建试剂申购",
    "update": "编辑试剂申购",
    "delete": "删除试剂申购",
    "approve": "审批通过试剂申购",
    "reject": "审批拒绝试剂申购",
}

CONSUMABLE_ORDER_ACTION_LABELS: dict[str, str] = {
    "create": "创建耗材申购",
    "update": "编辑耗材申购",
    "delete": "删除耗材申购",
    "approve": "审批通过耗材申购",
    "reject": "审批拒绝耗材申购",
    "arrival_complete": "确认耗材到货",
}

USER_OPERATION_ACTION_LABELS: dict[str, str] = {
    "login": "用户登录",
    "logout": "用户退出",
    "change_password": "修改密码",
    "update_profile": "修改用户资料",
    "upload_avatar": "上传头像",
    "delete_avatar": "删除头像",
    "create_user": "创建用户",
    "activate_user": "启用用户",
    "deactivate_user": "停用用户",
    "update_user_role": "修改用户角色",
    "reset_user_password": "重置用户密码",
    "update_user_sensitive_fields": "修改用户敏感信息",
}

COMMON_SHELF_ACTION_LABELS: dict[str, str] = {
    "stock_in": "常用货架入库",
    "add_bottles": "常用货架加瓶",
    "remove_one": "常用货架扣减",
    "update_group": "修改常用货架分组",
    "update_item": "修改常用货架条目",
    "merge_group": "合并常用货架分组",
    "delete_group": "删除常用货架分组",
    "export": "导出常用货架",
}


def _build_order_log_keyword_clause(keyword: str):
    return or_(
        ReagentOrderOperationLog.order_name.contains(keyword),
        ReagentOrderOperationLog.cas_number.contains(keyword),
        ReagentOrderOperationLog.snapshot_json.contains(keyword),
        ReagentOrderOperationLog.notes.contains(keyword),
    )


def _build_consumable_order_log_keyword_clause(keyword: str):
    return or_(
        ConsumableOrderOperationLog.order_name.contains(keyword),
        ConsumableOrderOperationLog.specification.contains(keyword),
        ConsumableOrderOperationLog.snapshot_json.contains(keyword),
        ConsumableOrderOperationLog.notes.contains(keyword),
    )


def _build_user_operation_keyword_clause(keyword: str):
    return or_(
        UserOperationLog.detail.contains(keyword),
        UserOperationLog.client_ip.contains(keyword),
        UserOperationLog.request_id.contains(keyword),
        UserOperationLog.snapshot_json.contains(keyword),
    )


def _build_common_shelf_keyword_clause(keyword: str):
    return or_(
        CommonShelfOperationLog.item_name.contains(keyword),
        CommonShelfOperationLog.cas_number.contains(keyword),
        CommonShelfOperationLog.snapshot_json.contains(keyword),
        CommonShelfOperationLog.notes.contains(keyword),
    )


def _append_reagent_order_candidates(context: LogsCollectContext, candidates: list[dict[str, object]]) -> None:
    query = select(ReagentOrderOperationLog).where(
        or_(
            ReagentOrderOperationLog.actor_user_id == context.user_id,
            ReagentOrderOperationLog.applicant_id == context.user_id,
        )
    )
    if context.keyword:
        query = query.where(_build_order_log_keyword_clause(context.keyword))
    logs = context.db.exec(
        query.order_by(ReagentOrderOperationLog.created_at.desc()).offset(context.skip).limit(context.limit)
    ).all()

    actor_ids = {log.actor_user_id for log in logs if log.actor_user_id}
    user_names = batch_get_user_names(context.db, actor_ids)

    for log in logs:
        snapshot = parse_reagent_order_snapshot(log.snapshot_json)
        created_at = utc_iso_str(log.created_at)
        action_value = log.action.value if hasattr(log.action, "value") else str(log.action)
        action_label = REAGENT_ORDER_ACTION_LABELS.get(action_value, action_value)
        actor_name = user_names.get(log.actor_user_id)
        detail_prefix = action_label
        if (
            log.applicant_id == context.user_id
            and log.actor_user_id
            and log.actor_user_id != context.user_id
        ):
            detail_prefix = f"{actor_name or '管理员'}{action_label}"

        def build_reagent_order(
            log=log,
            snapshot=snapshot,
            created_at=created_at,
            detail_prefix=detail_prefix,
            action_value=action_value,
        ):
            before_snapshot = snapshot.get("before")
            after_snapshot = snapshot.get("after")
            display_snapshot = after_snapshot or before_snapshot or snapshot
            quantity = display_snapshot.get("quantity")
            unit = display_snapshot.get("unit")
            return {
                "time": created_at,
                "type": "reagent_order",
                "detail": f"{detail_prefix} {log.order_name} {display_snapshot.get('initial_quantity') or ''}{unit or ''} x{quantity or ''}".strip(),
                "full_data": {
                    "id": log.id,
                    "order_id": log.order_id,
                    "actor_user_id": log.actor_user_id,
                    "applicant_id": log.applicant_id,
                    "action": action_value,
                    "order_name": log.order_name,
                    "cas_number": log.cas_number,
                    "snapshot": snapshot,
                    "before": before_snapshot,
                    "after": after_snapshot,
                    "name": display_snapshot.get("name") or log.order_name,
                    "specification": f"{display_snapshot.get('initial_quantity') or ''} {display_snapshot.get('unit') or ''}".strip(),
                    "quantity": quantity,
                    "brand": display_snapshot.get("brand"),
                    "purity": display_snapshot.get("purity"),
                    "price": display_snapshot.get("price"),
                    "order_reason": display_snapshot.get("order_reason"),
                    "status": display_snapshot.get("status"),
                    "category": display_snapshot.get("category"),
                    "notes": log.notes,
                    "created_at": created_at,
                },
            }

        _append_candidate(candidates, created_at, build_reagent_order)


def _append_consumable_order_candidates(context: LogsCollectContext, candidates: list[dict[str, object]]) -> None:
    query = select(ConsumableOrderOperationLog).where(
        or_(
            ConsumableOrderOperationLog.actor_user_id == context.user_id,
            ConsumableOrderOperationLog.applicant_id == context.user_id,
        )
    )
    if context.keyword:
        query = query.where(_build_consumable_order_log_keyword_clause(context.keyword))
    logs = context.db.exec(
        query.order_by(ConsumableOrderOperationLog.created_at.desc()).offset(context.skip).limit(context.limit)
    ).all()

    actor_ids = {log.actor_user_id for log in logs if log.actor_user_id}
    user_names = batch_get_user_names(context.db, actor_ids)

    for log in logs:
        snapshot = parse_consumable_order_snapshot(log.snapshot_json)
        created_at = utc_iso_str(log.created_at)
        action_value = log.action.value if hasattr(log.action, "value") else str(log.action)
        action_label = CONSUMABLE_ORDER_ACTION_LABELS.get(action_value, action_value)
        actor_name = user_names.get(log.actor_user_id)
        detail_prefix = action_label
        if (
            log.applicant_id == context.user_id
            and log.actor_user_id
            and log.actor_user_id != context.user_id
        ):
            detail_prefix = f"{actor_name or '管理员'}{action_label}"

        def build_consumable_order(
            log=log,
            snapshot=snapshot,
            created_at=created_at,
            detail_prefix=detail_prefix,
            action_value=action_value,
        ):
            before_snapshot = snapshot.get("before")
            after_snapshot = snapshot.get("after")
            return {
                "time": created_at,
                "type": "consumable_order",
                "detail": f"{detail_prefix} {log.order_name} {log.specification or ''} x{snapshot.get('quantity') or ''}".strip(),
                "full_data": {
                    "id": log.id,
                    "order_id": log.order_id,
                    "actor_user_id": log.actor_user_id,
                    "applicant_id": log.applicant_id,
                    "action": action_value,
                    "order_name": log.order_name,
                    "specification": log.specification,
                    "snapshot": snapshot,
                    "before": before_snapshot,
                    "after": after_snapshot,
                    "notes": log.notes,
                    "created_at": created_at,
                },
            }

        _append_candidate(candidates, created_at, build_consumable_order)


def _append_user_operation_candidates(context: LogsCollectContext, candidates: list[dict[str, object]]) -> None:
    query = select(UserOperationLog).where(
        or_(
            UserOperationLog.actor_user_id == context.user_id,
            UserOperationLog.target_user_id == context.user_id,
        )
    )
    if context.keyword:
        query = query.where(_build_user_operation_keyword_clause(context.keyword))
    logs = context.db.exec(
        query.order_by(UserOperationLog.created_at.desc()).offset(context.skip).limit(context.limit)
    ).all()

    user_ids = {
        user_id
        for log in logs
        for user_id in (log.actor_user_id, log.target_user_id)
        if user_id
    }
    user_names = batch_get_user_names(context.db, user_ids)

    for log in logs:
        snapshot = parse_user_operation_snapshot(log.snapshot_json)
        created_at = utc_iso_str(log.created_at)
        action_value = log.action.value if hasattr(log.action, "value") else str(log.action)
        action_label = USER_OPERATION_ACTION_LABELS.get(action_value, action_value)
        actor_name = user_names.get(log.actor_user_id)

        detail = action_label
        if (
            log.target_user_id == context.user_id
            and log.actor_user_id
            and log.actor_user_id != context.user_id
        ):
            detail = f"{actor_name or '管理员'}对你执行: {action_label}"
        if log.detail:
            detail = f"{detail} ({log.detail})"

        def build_user_operation(
            log=log,
            snapshot=snapshot,
            created_at=created_at,
            detail=detail,
            action_value=action_value,
        ):
            return {
                "time": created_at,
                "type": "user",
                "detail": detail,
                "full_data": {
                    "id": log.id,
                    "action": action_value,
                    "actor_user_id": log.actor_user_id,
                    "target_user_id": log.target_user_id,
                    "outcome": log.outcome,
                    "client_ip": log.client_ip,
                    "request_id": log.request_id,
                    "detail": log.detail,
                    "snapshot": snapshot,
                    "created_at": created_at,
                },
            }

        _append_candidate(candidates, created_at, build_user_operation)


def _append_inventory_candidates(context: LogsCollectContext, candidates: list[dict[str, object]]) -> None:
    query = select(InventoryOperationLog).where(
        InventoryOperationLog.operator_id == context.user_id,
        InventoryOperationLog.action == InventoryOperationAction.STOCK_IN,
    )
    if context.keyword:
        query = query.where(InventoryOperationLog.item_name.contains(context.keyword))
    logs = context.db.exec(
        query.order_by(InventoryOperationLog.created_at.desc()).offset(context.skip).limit(context.limit)
    ).all()
    for log in logs:
        snapshot = parse_inventory_snapshot(log.snapshot_json)
        created_at = utc_iso_str(log.created_at)

        def build_inventory(log=log, snapshot=snapshot, created_at=created_at):
            source = snapshot.get("source")
            return {
                "time": created_at,
                "type": "inventory",
                "detail": f"入库 {log.item_name} {snapshot.get('initial_quantity') or ''}{snapshot.get('unit') or ''}",
                "full_data": {
                    "id": log.id,
                    "inventory_id": log.inventory_id,
                    "cas_number": log.cas_number,
                    "name": log.item_name,
                    "english_name": snapshot.get("english_name"),
                    "alias": snapshot.get("alias"),
                    "category": snapshot.get("category"),
                    "brand": snapshot.get("brand"),
                    "purity": snapshot.get("purity"),
                    "storage_location": snapshot.get("storage_location"),
                    "initial_quantity": snapshot.get("initial_quantity"),
                    "remaining_quantity": snapshot.get("remaining_quantity"),
                    "unit": snapshot.get("unit"),
                    "is_hazardous": snapshot.get("is_hazardous"),
                    "notes": snapshot.get("notes"),
                    "internal_code": snapshot.get("internal_code"),
                    "status": snapshot.get("status"),
                    "source": source,
                    "created_at": created_at,
                    "updated_at": snapshot.get("updated_at"),
                }
            }

        _append_candidate(candidates, created_at, build_inventory)


def _append_common_shelf_candidates(context: LogsCollectContext, candidates: list[dict[str, object]]) -> None:
    query = select(CommonShelfOperationLog).where(
        CommonShelfOperationLog.operator_id == context.user_id,
        CommonShelfOperationLog.action != CommonShelfOperationAction.EXPORT,
    )
    if context.keyword:
        query = query.where(_build_common_shelf_keyword_clause(context.keyword))
    logs = context.db.exec(
        query.order_by(CommonShelfOperationLog.created_at.desc()).offset(context.skip).limit(context.limit)
    ).all()
    for log in logs:
        snapshot = parse_common_shelf_snapshot(log.snapshot_json)
        created_at = utc_iso_str(log.created_at)
        action_value = log.action.value if hasattr(log.action, "value") else str(log.action)
        action_label = COMMON_SHELF_ACTION_LABELS.get(action_value, action_value)

        def build_common_shelf(
            log=log,
            snapshot=snapshot,
            created_at=created_at,
            action_value=action_value,
            action_label=action_label,
        ):
            before_snapshot = snapshot.get("before")
            after_snapshot = snapshot.get("after")
            display_snapshot = after_snapshot or before_snapshot or snapshot
            return {
                "time": created_at,
                "type": "common_shelf",
                "detail": f"{action_label} {log.item_name}",
                "full_data": {
                    "id": log.id,
                    "common_shelf_id": log.common_shelf_id,
                    "action": action_value,
                    "cas_number": log.cas_number,
                    "name": log.item_name,
                    "brand": display_snapshot.get("brand"),
                    "purity": display_snapshot.get("purity"),
                    "specification_text": display_snapshot.get("specification_text"),
                    "storage_location": display_snapshot.get("storage_location"),
                    "count": snapshot.get("count"),
                    "location": snapshot.get("location"),
                    "notes": display_snapshot.get("notes"),
                    "before": before_snapshot,
                    "after": after_snapshot,
                    "snapshot": snapshot,
                    "created_at": created_at,
                },
            }

        _append_candidate(candidates, created_at, build_common_shelf)


def _append_borrow_candidates(context: LogsCollectContext, candidates: list[dict[str, object]]) -> None:
    from app.models.inventory import BorrowLog, Inventory

    query = select(BorrowLog, Inventory).join(
        Inventory, BorrowLog.inventory_id == Inventory.id
    ).where(
        BorrowLog.borrower_id == context.user_id,
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


def _append_update_candidates(context: LogsCollectContext, candidates: list[dict[str, object]]) -> None:
    query = select(InventoryOperationLog).where(
        InventoryOperationLog.operator_id == context.user_id,
        InventoryOperationLog.action == InventoryOperationAction.INVENTORY_UPDATE,
    )
    if context.keyword:
        query = query.where(InventoryOperationLog.item_name.contains(context.keyword))
    logs = context.db.exec(
        query.order_by(InventoryOperationLog.created_at.desc()).offset(context.skip).limit(context.limit)
    ).all()
    for log in logs:
        snapshot = parse_inventory_snapshot(log.snapshot_json)
        updated_at = utc_iso_str(log.created_at)
        before_snapshot = snapshot.get("before", {})
        after_snapshot = snapshot.get("after", {})

        def build_update(
            log=log,
            updated_at=updated_at,
            before_snapshot=before_snapshot,
            after_snapshot=after_snapshot,
        ):
            return {
                "time": updated_at,
                "type": "update",
                "detail": f"更新库存 {log.item_name}",
                "full_data": {
                    "id": log.id,
                    "inventory_id": log.inventory_id,
                    "name": log.item_name,
                    "cas_number": log.cas_number,
                    "before": before_snapshot,
                    "after": after_snapshot,
                    "purity": after_snapshot.get("purity"),
                    "created_at": updated_at,
                },
            }

        _append_candidate(candidates, updated_at, build_update)


def _append_delete_candidates(context: LogsCollectContext, candidates: list[dict[str, object]]) -> None:
    query = select(InventoryOperationLog).where(
        InventoryOperationLog.operator_id == context.user_id,
        InventoryOperationLog.action == InventoryOperationAction.INVENTORY_DELETE,
    )
    if context.keyword:
        query = query.where(InventoryOperationLog.item_name.contains(context.keyword))
    logs = context.db.exec(
        query.order_by(InventoryOperationLog.created_at.desc()).offset(context.skip).limit(context.limit)
    ).all()
    for log in logs:
        snapshot = parse_inventory_snapshot(log.snapshot_json)
        deleted_at = utc_iso_str(log.created_at)

        def build_delete(log=log, snapshot=snapshot, deleted_at=deleted_at):
            return {
                "time": deleted_at,
                "type": "delete",
                "detail": f"删除库存 {log.item_name}",
                "full_data": {
                    "id": log.id,
                    "inventory_id": log.inventory_id,
                    "cas_number": log.cas_number,
                    "name": log.item_name,
                    "english_name": snapshot.get("english_name"),
                    "alias": snapshot.get("alias"),
                    "category": snapshot.get("category"),
                    "brand": snapshot.get("brand"),
                    "purity": snapshot.get("purity"),
                    "storage_location": snapshot.get("storage_location"),
                    "initial_quantity": snapshot.get("initial_quantity"),
                    "remaining_quantity": snapshot.get("remaining_quantity"),
                    "unit": snapshot.get("unit"),
                    "is_hazardous": snapshot.get("is_hazardous"),
                    "notes": snapshot.get("notes"),
                    "internal_code": snapshot.get("internal_code"),
                    "status": snapshot.get("status"),
                    "created_at": deleted_at,
                    "updated_at": snapshot.get("updated_at"),
                },
            }

        _append_candidate(candidates, deleted_at, build_delete)


def _apply_export_keyword_filter(query, keyword: str | None):
    if not keyword:
        return query

    # export 详情文本固定包含“导出库存 X 条”，这些关键词应命中全部 export 日志。
    if keyword in "导出库存条":
        return query

    return query.where(
        or_(
            InventoryOperationLog.item_name.contains(keyword),
            InventoryOperationLog.snapshot_json.contains(keyword),
            InventoryOperationLog.notes.contains(keyword),
        )
    )


def _build_session_keyword_clause(keyword: str):
    return or_(
        UserSession.device_name.contains(keyword),
        UserSession.ip_address.contains(keyword),
        UserSession.last_ip_address.contains(keyword),
        UserSession.user_agent.contains(keyword),
    )


def _append_export_candidates(context: LogsCollectContext, candidates: list[dict[str, object]]) -> None:
    query = select(InventoryOperationLog).where(
        InventoryOperationLog.operator_id == context.user_id,
        InventoryOperationLog.action == InventoryOperationAction.INVENTORY_EXPORT,
    )
    query = _apply_export_keyword_filter(query, context.keyword)
    logs = context.db.exec(
        query.order_by(InventoryOperationLog.created_at.desc()).offset(context.skip).limit(context.limit)
    ).all()
    for log in logs:
        snapshot = parse_inventory_snapshot(log.snapshot_json)
        export_time = utc_iso_str(log.created_at)

        def build_export(log=log, snapshot=snapshot, export_time=export_time):
            export_count = snapshot.get("count", 0)
            return {
                "time": export_time,
                "type": "export",
                "detail": f"导出库存 {export_count} 条",
                "full_data": {
                    "id": log.id,
                    "export_scope": "inventory",
                    "count": export_count,
                    "created_at": export_time,
                },
            }

        _append_candidate(candidates, export_time, build_export)

    common_shelf_query = select(CommonShelfOperationLog).where(
        CommonShelfOperationLog.operator_id == context.user_id,
        CommonShelfOperationLog.action == CommonShelfOperationAction.EXPORT,
    )
    if context.keyword:
        if context.keyword not in "导出常用货架条":
            common_shelf_query = common_shelf_query.where(
                CommonShelfOperationLog.snapshot_json.contains(context.keyword)
            )
    common_shelf_logs = context.db.exec(
        common_shelf_query.order_by(CommonShelfOperationLog.created_at.desc())
        .offset(context.skip)
        .limit(context.limit)
    ).all()
    for log in common_shelf_logs:
        snapshot = parse_common_shelf_snapshot(log.snapshot_json)
        export_time = utc_iso_str(log.created_at)

        def build_common_shelf_export(log=log, snapshot=snapshot, export_time=export_time):
            export_count = snapshot.get("count", 0)
            return {
                "time": export_time,
                "type": "export",
                "detail": f"导出常用货架 {export_count} 条",
                "full_data": {
                    "id": log.id,
                    "export_scope": "common_shelf",
                    "count": export_count,
                    "created_at": export_time,
                },
            }

        _append_candidate(candidates, export_time, build_common_shelf_export)


def _append_session_candidates(context: LogsCollectContext, candidates: list[dict[str, object]]) -> None:
    query = select(UserSession).where(UserSession.user_id == context.user_id)
    if context.keyword:
        query = query.where(_build_session_keyword_clause(context.keyword))
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


def _exec_count_query(context: LogsCountContext, query) -> int:
    # COUNT 查询始终返回单行单值；None 兜底是为了兼容极端驱动返回。
    result = context.db.exec(query).one()
    return int(result or 0)


def _count_reagent_order_candidates(context: LogsCountContext) -> int:
    query = select(func.count()).select_from(ReagentOrderOperationLog).where(
        or_(
            ReagentOrderOperationLog.actor_user_id == context.user_id,
            ReagentOrderOperationLog.applicant_id == context.user_id,
        )
    )
    if context.keyword:
        query = query.where(_build_order_log_keyword_clause(context.keyword))
    return _exec_count_query(context, query)


def _count_consumable_order_candidates(context: LogsCountContext) -> int:
    query = select(func.count()).select_from(ConsumableOrderOperationLog).where(
        or_(
            ConsumableOrderOperationLog.actor_user_id == context.user_id,
            ConsumableOrderOperationLog.applicant_id == context.user_id,
        )
    )
    if context.keyword:
        query = query.where(_build_consumable_order_log_keyword_clause(context.keyword))
    return _exec_count_query(context, query)


def _count_inventory_operation_candidates(
    context: LogsCountContext,
    action: InventoryOperationAction,
    apply_keyword: bool,
) -> int:
    query = select(func.count()).select_from(InventoryOperationLog).where(
        InventoryOperationLog.operator_id == context.user_id,
        InventoryOperationLog.action == action,
    )
    if apply_keyword and context.keyword:
        query = query.where(InventoryOperationLog.item_name.contains(context.keyword))
    return _exec_count_query(context, query)


def _count_inventory_candidates(context: LogsCountContext) -> int:
    return _count_inventory_operation_candidates(
        context,
        InventoryOperationAction.STOCK_IN,
        apply_keyword=True,
    )


def _count_common_shelf_candidates(context: LogsCountContext) -> int:
    query = select(func.count()).select_from(CommonShelfOperationLog).where(
        CommonShelfOperationLog.operator_id == context.user_id,
        CommonShelfOperationLog.action != CommonShelfOperationAction.EXPORT,
    )
    if context.keyword:
        query = query.where(_build_common_shelf_keyword_clause(context.keyword))
    return _exec_count_query(context, query)


def _count_borrow_candidates(context: LogsCountContext) -> int:
    from app.models.inventory import BorrowLog, Inventory

    query = select(func.count()).select_from(BorrowLog).join(
        Inventory,
        BorrowLog.inventory_id == Inventory.id,
    ).where(
        BorrowLog.borrower_id == context.user_id,
    )
    if context.keyword:
        query = query.where(Inventory.name.contains(context.keyword))
    return _exec_count_query(context, query)


def _count_update_candidates(context: LogsCountContext) -> int:
    return _count_inventory_operation_candidates(
        context,
        InventoryOperationAction.INVENTORY_UPDATE,
        apply_keyword=True,
    )


def _count_delete_candidates(context: LogsCountContext) -> int:
    return _count_inventory_operation_candidates(
        context,
        InventoryOperationAction.INVENTORY_DELETE,
        apply_keyword=True,
    )


def _count_export_candidates(context: LogsCountContext) -> int:
    inventory_query = select(func.count()).select_from(InventoryOperationLog).where(
        InventoryOperationLog.operator_id == context.user_id,
        InventoryOperationLog.action == InventoryOperationAction.INVENTORY_EXPORT,
    )
    inventory_query = _apply_export_keyword_filter(inventory_query, context.keyword)
    inventory_count = _exec_count_query(context, inventory_query)

    common_shelf_query = select(func.count()).select_from(CommonShelfOperationLog).where(
        CommonShelfOperationLog.operator_id == context.user_id,
        CommonShelfOperationLog.action == CommonShelfOperationAction.EXPORT,
    )
    if context.keyword and context.keyword not in "导出常用货架条":
        common_shelf_query = common_shelf_query.where(
            CommonShelfOperationLog.snapshot_json.contains(context.keyword)
        )
    common_shelf_count = _exec_count_query(context, common_shelf_query)
    return inventory_count + common_shelf_count


def _count_session_candidates(context: LogsCountContext) -> int:
    query = select(func.count()).select_from(UserSession).where(
        UserSession.user_id == context.user_id
    )
    if context.keyword:
        query = query.where(_build_session_keyword_clause(context.keyword))
    return _exec_count_query(context, query)


def _count_user_operation_candidates(context: LogsCountContext) -> int:
    query = select(func.count()).select_from(UserOperationLog).where(
        or_(
            UserOperationLog.actor_user_id == context.user_id,
            UserOperationLog.target_user_id == context.user_id,
        )
    )
    if context.keyword:
        query = query.where(_build_user_operation_keyword_clause(context.keyword))
    return _exec_count_query(context, query)


LOG_TIMELINE_FTS_FIELD_MAP: dict[str, list[str]] = {
    "all": ["search_text", "search_text_pinyin"],
}


@dataclass
class TimelineSourceBundle:
    reagent_logs: dict[int, ReagentOrderOperationLog]
    consumable_logs: dict[int, ConsumableOrderOperationLog]
    inventory_logs: dict[int, InventoryOperationLog]
    common_shelf_logs: dict[int, CommonShelfOperationLog]
    user_logs: dict[int, UserOperationLog]
    borrow_logs: dict[int, tuple[object, object]]
    user_names: dict[int, str]


@dataclass
class TimelineSourceIds:
    reagent_ids: list[int]
    consumable_ids: list[int]
    inventory_ids: list[int]
    common_shelf_ids: list[int]
    user_log_ids: list[int]
    borrow_ids: list[int]


def _build_log_timeline_base_query(user_id: int, log_type: str | None):
    base = select(LogTimeline).where(
        or_(
            LogTimeline.subject_user_id == user_id,
            LogTimeline.actor_user_id == user_id,
        )
    )
    if log_type:
        base = base.where(LogTimeline.log_type == log_type)
    return base


def _apply_log_timeline_keyword_filter(base, keyword: str | None):
    if not keyword:
        return base

    raw_keyword = keyword.strip()
    if not raw_keyword:
        return base

    if should_use_order_fts(raw_keyword):
        rowid_subquery = build_order_fts_rowid_subquery(
            fts_table="log_timeline_fts",
            search_value=raw_keyword,
            search_field="all",
            field_map=LOG_TIMELINE_FTS_FIELD_MAP,
        )
        return base.where(LogTimeline.id.in_(rowid_subquery))

    pinyin_keyword = normalize_search_term(raw_keyword)
    return base.where(
        or_(
            LogTimeline.search_text.contains(raw_keyword),
            LogTimeline.search_text_pinyin.contains(pinyin_keyword or raw_keyword),
        )
    )


def _count_log_timeline_candidates(context: LogsCountContext, log_type: str | None) -> int:
    base = _build_log_timeline_base_query(context.user_id, log_type)
    base = _apply_log_timeline_keyword_filter(base, context.keyword)
    count_query = select(func.count()).select_from(base.subquery())
    return _exec_count_query(context, count_query)


def _load_log_timeline_rows(
    context: LogsCollectContext,
    *,
    log_type: str | None,
    offset: int,
    limit: int,
) -> list[LogTimeline]:
    base = _build_log_timeline_base_query(context.user_id, log_type)
    base = _apply_log_timeline_keyword_filter(base, context.keyword)
    ordered = base.order_by(LogTimeline.occurred_at.desc(), LogTimeline.id.desc())
    if limit > 0:
        ordered = ordered.offset(offset).limit(limit)
    return context.db.exec(ordered).all()


def _collect_timeline_source_ids(rows: list[LogTimeline]) -> TimelineSourceIds:
    reagent_ids: list[int] = []
    consumable_ids: list[int] = []
    inventory_ids: list[int] = []
    common_shelf_ids: list[int] = []
    user_log_ids: list[int] = []
    borrow_ids: list[int] = []

    for row in rows:
        source_table = row.source_table.value if hasattr(row.source_table, "value") else str(row.source_table)
        if source_table == LogTimelineSourceTable.REAGENT_ORDER_OPERATION_LOG.value:
            reagent_ids.append(row.source_log_id)
        elif source_table == LogTimelineSourceTable.CONSUMABLE_ORDER_OPERATION_LOG.value:
            consumable_ids.append(row.source_log_id)
        elif source_table == LogTimelineSourceTable.INVENTORY_OPERATION_LOG.value:
            inventory_ids.append(row.source_log_id)
        elif source_table == LogTimelineSourceTable.COMMON_SHELF_OPERATION_LOG.value:
            common_shelf_ids.append(row.source_log_id)
        elif source_table == LogTimelineSourceTable.USER_OPERATION_LOG.value:
            user_log_ids.append(row.source_log_id)
        elif source_table == LogTimelineSourceTable.BORROWLOG.value:
            borrow_ids.append(row.source_log_id)

    return TimelineSourceIds(
        reagent_ids=reagent_ids,
        consumable_ids=consumable_ids,
        inventory_ids=inventory_ids,
        common_shelf_ids=common_shelf_ids,
        user_log_ids=user_log_ids,
        borrow_ids=borrow_ids,
    )


def _load_logs_by_ids(db: DBSession, model_cls, ids: list[int]) -> dict[int, object]:
    if not ids:
        return {}
    return {
        log.id: log
        for log in db.exec(select(model_cls).where(model_cls.id.in_(ids))).all()
        if log.id is not None
    }


def _load_borrow_logs_by_ids(db: DBSession, ids: list[int]) -> dict[int, tuple[object, object]]:
    if not ids:
        return {}
    from app.models.inventory import BorrowLog, Inventory

    borrow_rows = db.exec(
        select(BorrowLog, Inventory)
        .join(Inventory, BorrowLog.inventory_id == Inventory.id)
        .where(BorrowLog.id.in_(ids))
    ).all()
    return {
        borrow_log.id: (borrow_log, inventory)
        for borrow_log, inventory in borrow_rows
        if borrow_log.id is not None
    }


def _load_timeline_source_bundle(db: DBSession, rows: list[LogTimeline]) -> TimelineSourceBundle:
    source_ids = _collect_timeline_source_ids(rows)

    reagent_logs = {}
    if source_ids.reagent_ids:
        reagent_logs = _load_logs_by_ids(db, ReagentOrderOperationLog, source_ids.reagent_ids)

    consumable_logs = {}
    if source_ids.consumable_ids:
        consumable_logs = _load_logs_by_ids(db, ConsumableOrderOperationLog, source_ids.consumable_ids)

    inventory_logs = {}
    if source_ids.inventory_ids:
        inventory_logs = _load_logs_by_ids(db, InventoryOperationLog, source_ids.inventory_ids)

    common_shelf_logs = {}
    if source_ids.common_shelf_ids:
        common_shelf_logs = _load_logs_by_ids(db, CommonShelfOperationLog, source_ids.common_shelf_ids)

    user_logs = {}
    if source_ids.user_log_ids:
        user_logs = _load_logs_by_ids(db, UserOperationLog, source_ids.user_log_ids)

    borrow_logs = _load_borrow_logs_by_ids(db, source_ids.borrow_ids)

    user_ids: set[int] = set()
    for log in reagent_logs.values():
        if log.actor_user_id:
            user_ids.add(log.actor_user_id)
        if log.applicant_id:
            user_ids.add(log.applicant_id)
    for log in consumable_logs.values():
        if log.actor_user_id:
            user_ids.add(log.actor_user_id)
        if log.applicant_id:
            user_ids.add(log.applicant_id)
    for log in user_logs.values():
        if log.actor_user_id:
            user_ids.add(log.actor_user_id)
        if log.target_user_id:
            user_ids.add(log.target_user_id)

    return TimelineSourceBundle(
        reagent_logs=reagent_logs,
        consumable_logs=consumable_logs,
        inventory_logs=inventory_logs,
        common_shelf_logs=common_shelf_logs,
        user_logs=user_logs,
        borrow_logs=borrow_logs,
        user_names=batch_get_user_names(db, user_ids) if user_ids else {},
    )


def _wrap_rendered_candidate(rendered: dict[str, object]) -> dict[str, object]:
    return {
        "time": rendered["time"],
        "builder": lambda rendered=rendered: rendered,
    }


def _render_reagent_timeline_row(
    timeline_row: LogTimeline,
    log: ReagentOrderOperationLog,
    *,
    user_id: int,
    user_names: dict[int, str],
) -> dict[str, object]:
    snapshot = parse_reagent_order_snapshot(log.snapshot_json)
    created_at = utc_iso_str(log.created_at)
    action_value = log.action.value if hasattr(log.action, "value") else str(log.action)
    action_label = REAGENT_ORDER_ACTION_LABELS.get(action_value, action_value)
    actor_name = user_names.get(log.actor_user_id)
    detail_prefix = action_label
    if (
        log.applicant_id == user_id
        and log.actor_user_id
        and log.actor_user_id != user_id
    ):
        detail_prefix = f"{actor_name or '管理员'}{action_label}"

    before_snapshot = snapshot.get("before")
    after_snapshot = snapshot.get("after")
    display_snapshot = after_snapshot or before_snapshot or snapshot
    quantity = display_snapshot.get("quantity")
    unit = display_snapshot.get("unit")
    return {
        "time": created_at,
        "type": "reagent_order",
        "detail": f"{detail_prefix} {log.order_name} {display_snapshot.get('initial_quantity') or ''}{unit or ''} x{quantity or ''}".strip(),
        "full_data": {
            "id": log.id,
            "order_id": log.order_id,
            "actor_user_id": log.actor_user_id,
            "applicant_id": log.applicant_id,
            "action": action_value,
            "order_name": log.order_name,
            "cas_number": log.cas_number,
            "snapshot": snapshot,
            "before": before_snapshot,
            "after": after_snapshot,
            "name": display_snapshot.get("name") or log.order_name,
            "specification": f"{display_snapshot.get('initial_quantity') or ''} {display_snapshot.get('unit') or ''}".strip(),
            "quantity": quantity,
            "brand": display_snapshot.get("brand"),
            "purity": display_snapshot.get("purity"),
            "price": display_snapshot.get("price"),
            "order_reason": display_snapshot.get("order_reason"),
            "status": display_snapshot.get("status"),
            "category": display_snapshot.get("category"),
            "notes": log.notes,
            "created_at": created_at,
            "is_cli": timeline_row.is_cli,
        },
    }


def _render_consumable_timeline_row(
    timeline_row: LogTimeline,
    log: ConsumableOrderOperationLog,
    *,
    user_id: int,
    user_names: dict[int, str],
) -> dict[str, object]:
    snapshot = parse_consumable_order_snapshot(log.snapshot_json)
    created_at = utc_iso_str(log.created_at)
    action_value = log.action.value if hasattr(log.action, "value") else str(log.action)
    action_label = CONSUMABLE_ORDER_ACTION_LABELS.get(action_value, action_value)
    actor_name = user_names.get(log.actor_user_id)
    detail_prefix = action_label
    if (
        log.applicant_id == user_id
        and log.actor_user_id
        and log.actor_user_id != user_id
    ):
        detail_prefix = f"{actor_name or '管理员'}{action_label}"

    before_snapshot = snapshot.get("before")
    after_snapshot = snapshot.get("after")
    return {
        "time": created_at,
        "type": "consumable_order",
        "detail": f"{detail_prefix} {log.order_name} {log.specification or ''} x{snapshot.get('quantity') or ''}".strip(),
        "full_data": {
            "id": log.id,
            "order_id": log.order_id,
            "actor_user_id": log.actor_user_id,
            "applicant_id": log.applicant_id,
            "action": action_value,
            "order_name": log.order_name,
            "specification": log.specification,
            "snapshot": snapshot,
            "before": before_snapshot,
            "after": after_snapshot,
            "notes": log.notes,
            "created_at": created_at,
            "is_cli": timeline_row.is_cli,
        },
    }


def _render_user_timeline_row(
    timeline_row: LogTimeline,
    log: UserOperationLog,
    *,
    user_id: int,
    user_names: dict[int, str],
) -> dict[str, object]:
    snapshot = parse_user_operation_snapshot(log.snapshot_json)
    created_at = utc_iso_str(log.created_at)
    action_value = log.action.value if hasattr(log.action, "value") else str(log.action)
    action_label = USER_OPERATION_ACTION_LABELS.get(action_value, action_value)
    actor_name = user_names.get(log.actor_user_id)

    detail = action_label
    if (
        log.target_user_id == user_id
        and log.actor_user_id
        and log.actor_user_id != user_id
    ):
        detail = f"{actor_name or '管理员'}对你执行: {action_label}"
    if log.detail:
        detail = f"{detail} ({log.detail})"

    return {
        "time": created_at,
        "type": "user",
        "detail": detail,
        "full_data": {
            "id": log.id,
            "action": action_value,
            "actor_user_id": log.actor_user_id,
            "target_user_id": log.target_user_id,
            "outcome": log.outcome,
            "client_ip": log.client_ip,
            "request_id": log.request_id,
            "detail": log.detail,
            "snapshot": snapshot,
            "created_at": created_at,
            "is_cli": timeline_row.is_cli,
        },
    }


def _render_inventory_timeline_row(
    timeline_row: LogTimeline,
    log: InventoryOperationLog,
) -> dict[str, object]:
    snapshot = parse_inventory_snapshot(log.snapshot_json)
    created_at = utc_iso_str(log.created_at)

    if timeline_row.log_type == "update":
        before_snapshot = snapshot.get("before", {})
        after_snapshot = snapshot.get("after", {})
        return {
            "time": created_at,
            "type": "update",
            "detail": f"更新库存 {log.item_name}",
            "full_data": {
                "id": log.id,
                "inventory_id": log.inventory_id,
                "name": log.item_name,
                "cas_number": log.cas_number,
                "before": before_snapshot,
                "after": after_snapshot,
                "purity": after_snapshot.get("purity"),
                "created_at": created_at,
                "is_cli": timeline_row.is_cli,
            },
        }

    if timeline_row.log_type == "delete":
        return {
            "time": created_at,
            "type": "delete",
            "detail": f"删除库存 {log.item_name}",
            "full_data": {
                "id": log.id,
                "inventory_id": log.inventory_id,
                "cas_number": log.cas_number,
                "name": log.item_name,
                "english_name": snapshot.get("english_name"),
                "alias": snapshot.get("alias"),
                "category": snapshot.get("category"),
                "brand": snapshot.get("brand"),
                "purity": snapshot.get("purity"),
                "storage_location": snapshot.get("storage_location"),
                "initial_quantity": snapshot.get("initial_quantity"),
                "remaining_quantity": snapshot.get("remaining_quantity"),
                "unit": snapshot.get("unit"),
                "is_hazardous": snapshot.get("is_hazardous"),
                "notes": snapshot.get("notes"),
                "internal_code": snapshot.get("internal_code"),
                "status": snapshot.get("status"),
                "created_at": created_at,
                "updated_at": snapshot.get("updated_at"),
                "is_cli": timeline_row.is_cli,
            },
        }

    if timeline_row.log_type == "export":
        export_count = snapshot.get("count", 0)
        return {
            "time": created_at,
            "type": "export",
            "detail": f"导出库存 {export_count} 条",
            "full_data": {
                "id": log.id,
                "export_scope": "inventory",
                "count": export_count,
                "created_at": created_at,
                "is_cli": timeline_row.is_cli,
            },
        }

    source = snapshot.get("source")
    return {
        "time": created_at,
        "type": "inventory",
        "detail": f"入库 {log.item_name} {snapshot.get('initial_quantity') or ''}{snapshot.get('unit') or ''}",
        "full_data": {
            "id": log.id,
            "inventory_id": log.inventory_id,
            "cas_number": log.cas_number,
            "name": log.item_name,
            "english_name": snapshot.get("english_name"),
            "alias": snapshot.get("alias"),
            "category": snapshot.get("category"),
            "brand": snapshot.get("brand"),
            "purity": snapshot.get("purity"),
            "storage_location": snapshot.get("storage_location"),
            "initial_quantity": snapshot.get("initial_quantity"),
            "remaining_quantity": snapshot.get("remaining_quantity"),
            "unit": snapshot.get("unit"),
            "is_hazardous": snapshot.get("is_hazardous"),
            "notes": snapshot.get("notes"),
            "internal_code": snapshot.get("internal_code"),
            "status": snapshot.get("status"),
            "source": source,
            "created_at": created_at,
            "updated_at": snapshot.get("updated_at"),
            "is_cli": timeline_row.is_cli,
        },
    }


def _render_common_shelf_timeline_row(
    timeline_row: LogTimeline,
    log: CommonShelfOperationLog,
) -> dict[str, object]:
    snapshot = parse_common_shelf_snapshot(log.snapshot_json)
    created_at = utc_iso_str(log.created_at)
    action_value = log.action.value if hasattr(log.action, "value") else str(log.action)

    if timeline_row.log_type == "export":
        export_count = snapshot.get("count", 0)
        return {
            "time": created_at,
            "type": "export",
            "detail": f"导出常用货架 {export_count} 条",
            "full_data": {
                "id": log.id,
                "export_scope": "common_shelf",
                "count": export_count,
                "created_at": created_at,
                "is_cli": timeline_row.is_cli,
            },
        }

    action_label = COMMON_SHELF_ACTION_LABELS.get(action_value, action_value)
    before_snapshot = snapshot.get("before")
    after_snapshot = snapshot.get("after")
    display_snapshot = after_snapshot or before_snapshot or snapshot
    return {
        "time": created_at,
        "type": "common_shelf",
        "detail": f"{action_label} {log.item_name}",
        "full_data": {
            "id": log.id,
            "common_shelf_id": log.common_shelf_id,
            "action": action_value,
            "cas_number": log.cas_number,
            "name": log.item_name,
            "brand": display_snapshot.get("brand"),
            "purity": display_snapshot.get("purity"),
            "specification_text": display_snapshot.get("specification_text"),
            "storage_location": display_snapshot.get("storage_location"),
            "count": snapshot.get("count"),
            "location": snapshot.get("location"),
            "notes": display_snapshot.get("notes"),
            "before": before_snapshot,
            "after": after_snapshot,
            "snapshot": snapshot,
            "created_at": created_at,
            "is_cli": timeline_row.is_cli,
        },
    }


def _render_borrow_timeline_row(
    timeline_row: LogTimeline,
    borrow_log,
    inventory,
) -> dict[str, object]:
    is_returned = borrow_log.return_time is not None
    return_info = f", 已归还 {borrow_log.quantity_returned} {inventory.unit or ''}" if is_returned else ", 未归还"
    borrow_time = utc_iso_str(borrow_log.borrow_time)
    return {
        "time": borrow_time,
        "type": "borrow",
        "detail": f"借用 {inventory.name} {borrow_log.quantity_borrowed} {inventory.unit or ''}{return_info}",
        "full_data": {
            "id": borrow_log.id,
            "inventory_id": borrow_log.inventory_id,
            "inventory_name": inventory.name,
            "cas_number": inventory.cas_number,
            "borrow_time": borrow_time,
            "return_time": utc_iso_str(borrow_log.return_time),
            "quantity_borrowed": borrow_log.quantity_borrowed,
            "quantity_returned": borrow_log.quantity_returned,
            "unit": inventory.unit,
            "notes": borrow_log.notes,
            "is_returned": is_returned,
            "created_at": utc_iso_str(borrow_log.created_at),
            "is_cli": timeline_row.is_cli,
        },
    }


def _render_timeline_candidate(
    timeline_row: LogTimeline,
    *,
    bundle: TimelineSourceBundle,
    user_id: int,
) -> dict[str, object] | None:
    source_table = timeline_row.source_table.value if hasattr(timeline_row.source_table, "value") else str(timeline_row.source_table)
    if source_table == LogTimelineSourceTable.REAGENT_ORDER_OPERATION_LOG.value:
        log = bundle.reagent_logs.get(timeline_row.source_log_id)
        if log is None:
            return None
        return _render_reagent_timeline_row(
            timeline_row,
            log,
            user_id=user_id,
            user_names=bundle.user_names,
        )
    if source_table == LogTimelineSourceTable.CONSUMABLE_ORDER_OPERATION_LOG.value:
        log = bundle.consumable_logs.get(timeline_row.source_log_id)
        if log is None:
            return None
        return _render_consumable_timeline_row(
            timeline_row,
            log,
            user_id=user_id,
            user_names=bundle.user_names,
        )
    if source_table == LogTimelineSourceTable.INVENTORY_OPERATION_LOG.value:
        log = bundle.inventory_logs.get(timeline_row.source_log_id)
        if log is None:
            return None
        return _render_inventory_timeline_row(timeline_row, log)
    if source_table == LogTimelineSourceTable.COMMON_SHELF_OPERATION_LOG.value:
        log = bundle.common_shelf_logs.get(timeline_row.source_log_id)
        if log is None:
            return None
        return _render_common_shelf_timeline_row(timeline_row, log)
    if source_table == LogTimelineSourceTable.USER_OPERATION_LOG.value:
        log = bundle.user_logs.get(timeline_row.source_log_id)
        if log is None:
            return None
        return _render_user_timeline_row(
            timeline_row,
            log,
            user_id=user_id,
            user_names=bundle.user_names,
        )
    if source_table == LogTimelineSourceTable.BORROWLOG.value:
        borrow_row = bundle.borrow_logs.get(timeline_row.source_log_id)
        if borrow_row is None:
            return None
        borrow_log, inventory = borrow_row
        return _render_borrow_timeline_row(timeline_row, borrow_log, inventory)
    return None


def _collect_timeline_candidates(
    context: LogsCollectContext,
    *,
    log_type: str | None,
    offset: int,
    limit: int,
) -> list[dict[str, object]]:
    rows = _load_log_timeline_rows(
        context,
        log_type=log_type,
        offset=offset,
        limit=limit,
    )
    if not rows:
        return []

    bundle = _load_timeline_source_bundle(context.db, rows)
    candidates: list[dict[str, object]] = []
    for row in rows:
        rendered = _render_timeline_candidate(row, bundle=bundle, user_id=context.user_id)
        if rendered is None:
            continue
        candidates.append(_wrap_rendered_candidate(rendered))
    return candidates


def _collect_user_logs(
    context: LogsCollectContext,
    log_type: str | None,
) -> list[dict[str, object]]:
    if log_type == "session":
        candidates: list[dict[str, object]] = []
        _append_session_candidates(context, candidates)
        return candidates

    if log_type is None:
        # timeline + session 混排时，先分别取到前 skip+limit 窗口再做全局排序。
        merged_limit = context.skip + context.limit
        timeline_candidates = _collect_timeline_candidates(
            context,
            log_type=None,
            offset=0,
            limit=merged_limit,
        )
        session_candidates: list[dict[str, object]] = []
        _append_session_candidates(
            LogsCollectContext(
                db=context.db,
                user_id=context.user_id,
                keyword=context.keyword,
                skip=0,
                limit=merged_limit,
            ),
            session_candidates,
        )
        candidates = [*timeline_candidates, *session_candidates]
        candidates.sort(key=lambda item: item["time"], reverse=True)
        return candidates

    return _collect_timeline_candidates(
        context,
        log_type=log_type,
        offset=context.skip,
        limit=context.limit,
    )


def _collect_user_logs_total(context: LogsCountContext, log_type: str | None) -> int:
    if log_type == "session":
        return _count_session_candidates(context)
    if log_type is None:
        return _count_log_timeline_candidates(context, None) + _count_session_candidates(context)
    return _count_log_timeline_candidates(context, log_type)


def _slice_candidates_for_response(
    candidates: list[dict[str, object]],
    log_type: str | None,
    skip: int,
    limit: int,
) -> list[dict[str, object]]:
    if log_type is None:
        return candidates[skip : skip + limit]
    return candidates[:limit]

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
    selected = _slice_candidates_for_response(
        candidates=candidates,
        log_type=request.log_type,
        skip=skip,
        limit=limit,
    )
    results = [item["builder"]() for item in selected]
    total = _collect_user_logs_total(
        context=LogsCountContext(
            db=db,
            user_id=user_id,
            keyword=request.keyword,
        ),
        log_type=request.log_type,
    )

    return {
        "user_id": user_id,
        "username": user.username,
        "data": results,
        "total": total,
    }
