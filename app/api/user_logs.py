# 管理员查看用户多来源操作日志。
import base64
from dataclasses import dataclass
import hashlib
import hmac
import json
import secrets
import time
from typing import Any, Callable, Optional

import redis
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, false, func, or_, true
from sqlmodel import select

from app.core.redis import get_redis, redis_key
from app.core.auth import CurrentUser
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
from app.models.user import User, UserRole
from app.search_query_log_db import (
    SEARCH_LOG_ENDPOINT_LABELS,
    SearchLogRow,
    count_search_log_rows,
    fetch_search_log_rows,
)
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
from app.models.user_operation_log import UserOperationAction, UserOperationLog
from app.services.order_fts import build_order_fts_rowid_subquery, should_use_order_fts
from app.services.pinyin_utils import to_pinyin
from app.services.common_shelf_operation_logger import parse_common_shelf_snapshot
from app.services.inventory_operation_logger import parse_inventory_snapshot
from app.services.order_operation_logger import (
    parse_consumable_order_snapshot,
    parse_reagent_order_snapshot,
)
from app.services.log_timeline_detail_text import (
    COMMON_SHELF_ACTION_LABELS,
    CONSUMABLE_ORDER_ACTION_LABELS,
    REAGENT_ORDER_ACTION_LABELS,
    USER_OPERATION_ACTION_LABELS,
    build_consumable_order_detail_text,
    build_reagent_order_detail_text,
    build_user_operation_detail_text,
    normalize_action_value,
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
    category: Optional[str] = None  # 筛选分类：reagent_order, consumable_order, inventory, borrow, session, other
    skip: int = 0
    limit: int = DEFAULT_PAGE_SIZE


class LogsQueryRequest(BaseModel):
    token: str
    keyword: Optional[str] = Field(default=None, max_length=100)
    category: Optional[str] = None
    include_search_logs: bool = False
    skip: int = 0
    limit: int = DEFAULT_PAGE_SIZE


class LogSummaryTarget(BaseModel):
    target_type: str | None = None
    target_id: int | str | None = None
    target_name: str | None = None
    cas_number: str | None = None
    specification: str | None = None
    quantity: float | int | None = None
    unit: str | None = None


class LogSummaryMetrics(BaseModel):
    count: int | None = None
    result_count: int | None = None
    quantity_borrowed: float | int | None = None
    quantity_returned: float | int | None = None


class LogSummarySourceMeta(BaseModel):
    source: str | None = None
    endpoint: str | None = None
    query_text: str | None = None
    device_name: str | None = None
    ip_address: str | None = None
    export_scope: str | None = None


class LogSummaryData(BaseModel):
    kind: str
    action_code: str | None = None
    actor_name: str | None = None
    actor_is_external: bool | None = None
    targets_viewer: bool | None = None
    target: LogSummaryTarget = Field(default_factory=LogSummaryTarget)
    metrics: LogSummaryMetrics = Field(default_factory=LogSummaryMetrics)
    source_meta: LogSummarySourceMeta = Field(default_factory=LogSummarySourceMeta)
    extra_detail: str | None = None
    is_returned: bool | None = None


class LogItemResponse(BaseModel):
    time: str | None
    type: str
    detail: str
    summary: LogSummaryData | None = None
    full_data: dict[str, Any] | None = None


class LogsQueryResponse(BaseModel):
    user_id: int
    username: str
    data: list[LogItemResponse]
    total: int


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


def _ensure_user_logs_access(current_user: User, target_user_id: int) -> None:
    if current_user.role == UserRole.PUBLIC:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Public users cannot access logs"
        )

    if current_user.role != UserRole.ADMIN and current_user.id != target_user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot access other user's logs"
        )


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


ORDER_EXPORT_SCOPE_LABELS: dict[str, str] = {
    "reagent_orders": "试剂订单",
    "consumable_orders": "耗材订单",
}


def _read_export_count(snapshot: dict[str, object]) -> object:
    return snapshot.get("count", snapshot.get("ct", 0)) or 0


def _build_log_summary_target(
    *,
    target_type: str | None = None,
    target_id: int | str | None = None,
    target_name: str | None = None,
    cas_number: str | None = None,
    specification: str | None = None,
    quantity: float | int | None = None,
    unit: str | None = None,
) -> dict[str, object]:
    return {
        "target_type": target_type,
        "target_id": target_id,
        "target_name": target_name,
        "cas_number": cas_number,
        "specification": specification,
        "quantity": quantity,
        "unit": unit,
    }


def _build_log_summary_metrics(
    *,
    count: int | None = None,
    result_count: int | None = None,
    quantity_borrowed: float | int | None = None,
    quantity_returned: float | int | None = None,
) -> dict[str, object]:
    return {
        "count": count,
        "result_count": result_count,
        "quantity_borrowed": quantity_borrowed,
        "quantity_returned": quantity_returned,
    }


def _build_log_source_meta(
    *,
    source: str | None = None,
    endpoint: str | None = None,
    query_text: str | None = None,
    device_name: str | None = None,
    ip_address: str | None = None,
    export_scope: str | None = None,
) -> dict[str, object]:
    return {
        "source": source,
        "endpoint": endpoint,
        "query_text": query_text,
        "device_name": device_name,
        "ip_address": ip_address,
        "export_scope": export_scope,
    }


def _build_order_export_row(
    *,
    created_at: str,
    export_scope: str,
    log_id: int | None,
    actor_user_id: int | None,
    action_value: str,
    snapshot: dict[str, object],
    is_cli: bool | None = None,
) -> dict[str, object]:
    export_count = _read_export_count(snapshot)
    full_data: dict[str, object] = {
        "id": log_id,
        "actor_user_id": actor_user_id,
        "action": action_value,
        "export_scope": export_scope,
        "count": export_count,
        "snapshot": snapshot,
        "created_at": created_at,
    }
    if is_cli is not None:
        full_data["is_cli"] = is_cli

    return {
        "time": created_at,
        "type": "export",
        "detail": (
            f"导出{ORDER_EXPORT_SCOPE_LABELS.get(export_scope, '订单')} "
            f"{export_count} 条"
        ),
        "summary": {
            "kind": "order_export",
            "action_code": action_value,
            "target": _build_log_summary_target(
                target_type="order_export",
            ),
            "metrics": _build_log_summary_metrics(
                count=int(export_count) if isinstance(export_count, int) else None,
            ),
            "source_meta": _build_log_source_meta(
                export_scope=export_scope,
            ),
        },
        "full_data": full_data,
    }


LOG_TIMELINE_DETAIL_KEYWORDS_BY_CATEGORY: dict[str, tuple[str, ...]] = {
    "reagent_order": (
        "试剂订单",
        "试剂申购",
        "试剂",
    ),
    "consumable_order": (
        "耗材订单",
        "耗材申购",
        "耗材",
    ),
    "inventory": (
        "库存表",
        "库存",
    ),
    "common_shelf": (
        "常用货架",
        "常用",
        "货架",
    ),
    "borrow": ("借用记录",),
    "session": ("会话", "回话", "设备会话", "登录记录"),
    "user": ("用户操作", "用户"),
    "other": ("其他", "品牌", "品牌管理", "CAS 主数据", "公告"),
}

OTHER_USER_OPERATION_ACTION_VALUES: tuple[str, ...] = (
    UserOperationAction.CREATE_REAGENT_BRAND.value,
    UserOperationAction.UPDATE_REAGENT_BRAND.value,
    UserOperationAction.DELETE_REAGENT_BRAND.value,
    UserOperationAction.CREATE_CHEMICAL_NAME_MAP.value,
    UserOperationAction.UPDATE_CHEMICAL_NAME_MAP.value,
    UserOperationAction.DELETE_CHEMICAL_NAME_MAP.value,
    UserOperationAction.CREATE_ANNOUNCEMENT.value,
    UserOperationAction.UPDATE_ANNOUNCEMENT.value,
    UserOperationAction.DELETE_ANNOUNCEMENT.value,
    UserOperationAction.UPDATE_ANNOUNCEMENT_PIN.value,
    UserOperationAction.UPDATE_ANNOUNCEMENT_VISIBILITY.value,
    UserOperationAction.UPLOAD_ANNOUNCEMENT_IMAGE.value,
    UserOperationAction.DELETE_ANNOUNCEMENT_IMAGE.value,
)
SESSION_USER_OPERATION_ACTION_VALUES: tuple[str, ...] = (
    UserOperationAction.DELETE_SESSION.value,
    UserOperationAction.DELETE_OTHER_SESSIONS.value,
    UserOperationAction.REFRESH_SESSION.value,
    UserOperationAction.UPDATE_SESSION.value,
)
NON_USER_OPERATION_ACTION_VALUES: tuple[str, ...] = (
    *OTHER_USER_OPERATION_ACTION_VALUES,
    *SESSION_USER_OPERATION_ACTION_VALUES,
)
SESSION_DETAIL_KEYWORDS: tuple[str, ...] = ("登录", "用户登录", "登录记录")
CLI_LOG_KEYWORDS = {"cli", "[cli]"}


def _is_other_user_operation_action(action_value: str) -> bool:
    return action_value in OTHER_USER_OPERATION_ACTION_VALUES


def _is_session_user_operation_action(action_value: str) -> bool:
    return action_value in SESSION_USER_OPERATION_ACTION_VALUES


def _get_user_operation_log_type(action_value: str) -> str:
    if _is_session_user_operation_action(action_value):
        return "session"
    return "other" if _is_other_user_operation_action(action_value) else "user"


def _matches_detail_keyword(raw_keyword: str, candidates: tuple[str, ...]) -> bool:
    keyword = raw_keyword.strip()
    if not keyword:
        return False

    normalized_keyword = normalize_search_term(keyword)
    for candidate in candidates:
        if keyword in candidate:
            return True
        candidate_pinyin = normalize_search_term(to_pinyin(candidate))
        if normalized_keyword and normalized_keyword in candidate_pinyin:
            return True
    return False


def _matches_cli_log_keyword(raw_keyword: str) -> bool:
    keyword = raw_keyword.strip()
    if not keyword:
        return False

    normalized_keyword = normalize_search_term(keyword).casefold()
    return (
        keyword.casefold() in CLI_LOG_KEYWORDS
        or normalized_keyword == "cli"
        or "命令行" in keyword
    )


def _resolve_log_timeline_detail_types(raw_keyword: str) -> list[str]:
    return [
        category
        for category, keywords in LOG_TIMELINE_DETAIL_KEYWORDS_BY_CATEGORY.items()
        if _matches_detail_keyword(raw_keyword, keywords)
    ]


def _build_session_keyword_clause(keyword: str):
    if _matches_detail_keyword(keyword, SESSION_DETAIL_KEYWORDS):
        return true()

    return or_(
        UserSession.device_name.contains(keyword),
        UserSession.ip_address.contains(keyword),
        UserSession.last_ip_address.contains(keyword),
        UserSession.user_agent.contains(keyword),
    )


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
                "summary": {
                    "kind": "session_login",
                    "action_code": "login",
                    "target": _build_log_summary_target(
                        target_type="session",
                        target_id=session.id,
                    ),
                    "source_meta": _build_log_source_meta(
                        device_name=session.device_name,
                        ip_address=session.ip_address,
                    ),
                },
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


def _parse_search_log_json_object(raw_value: str | None) -> dict[str, object]:
    if not raw_value:
        return {}
    try:
        parsed = json.loads(raw_value)
    except json.JSONDecodeError:
        return {"raw": raw_value}
    if isinstance(parsed, dict):
        return parsed
    return {"value": parsed}


def _resolve_search_log_keyword(keyword: str | None) -> str | None:
    normalized_keyword = (keyword or "").strip()
    return normalized_keyword or None


def _format_search_log_detail(row: SearchLogRow) -> str:
    source_label = "CLI" if row.source == "cli" else "Web"
    endpoint_label = SEARCH_LOG_ENDPOINT_LABELS.get(row.endpoint, row.endpoint)
    query_text = row.query or row.normalized_query
    action_label = "搜索" if query_text else "筛选"
    query_suffix = f"：{query_text}" if query_text else ""
    return f"{source_label}{action_label}{endpoint_label}{query_suffix}，结果 {row.result_count} 条"


def _render_search_log_row(row: SearchLogRow) -> dict[str, object]:
    query_text = row.query or row.normalized_query
    return {
        "time": row.created_at,
        "type": "search",
        "detail": _format_search_log_detail(row),
        "summary": {
            "kind": "search",
            "action_code": "search" if query_text else "filter",
            "target": _build_log_summary_target(
                target_type="search_endpoint",
                target_name=row.endpoint,
            ),
            "metrics": _build_log_summary_metrics(
                result_count=row.result_count,
            ),
            "source_meta": _build_log_source_meta(
                source=row.source,
                endpoint=row.endpoint,
                query_text=query_text,
            ),
        },
        "full_data": {
            "id": row.id,
            "user_id": row.user_id,
            "session_id": row.session_id,
            "source": row.source,
            "endpoint": row.endpoint,
            "query": row.query,
            "normalized_query": row.normalized_query,
            "filters": _parse_search_log_json_object(row.filters_json),
            "sort": _parse_search_log_json_object(row.sort_json),
            "result_count": row.result_count,
            "latency_ms": row.latency_ms,
            "created_at": row.created_at,
            "is_cli": row.source == "cli",
        },
    }


def _append_search_log_candidates(
    context: LogsCollectContext,
    candidates: list[dict[str, object]],
) -> None:
    rows = fetch_search_log_rows(
        user_id=context.user_id,
        keyword=_resolve_search_log_keyword(context.keyword),
        skip=context.skip,
        limit=context.limit,
    )
    for row in rows:
        _append_candidate(candidates, row.created_at, lambda row=row: _render_search_log_row(row))


def _exec_count_query(context: LogsCountContext, query) -> int:
    # COUNT 查询始终返回单行单值；None 兜底是为了兼容极端驱动返回。
    result = context.db.exec(query).one()
    return int(result or 0)


def _count_session_candidates(context: LogsCountContext) -> int:
    query = select(func.count()).select_from(UserSession).where(
        UserSession.user_id == context.user_id
    )
    if context.keyword:
        query = query.where(_build_session_keyword_clause(context.keyword))
    return _exec_count_query(context, query)


def _count_search_log_candidates(context: LogsCountContext) -> int:
    return count_search_log_rows(
        user_id=context.user_id,
        keyword=_resolve_search_log_keyword(context.keyword),
    )


LOG_TIMELINE_FTS_FIELD_MAP: dict[str, list[str]] = {
    "all": ["search_text", "search_text_pinyin", "detail_search_text"],
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


LOG_TIMELINE_CATEGORY_SOURCE_TABLES: dict[str, tuple[LogTimelineSourceTable, ...]] = {
    "reagent_order": (LogTimelineSourceTable.REAGENT_ORDER_OPERATION_LOG,),
    "consumable_order": (LogTimelineSourceTable.CONSUMABLE_ORDER_OPERATION_LOG,),
    "inventory": (LogTimelineSourceTable.INVENTORY_OPERATION_LOG,),
    "common_shelf": (LogTimelineSourceTable.COMMON_SHELF_OPERATION_LOG,),
    "borrow": (LogTimelineSourceTable.BORROWLOG,),
}


def _build_user_operation_action_category_clause(action_values: tuple[str, ...], *, include: bool):
    source_log_ids = select(UserOperationLog.id).where(
        UserOperationLog.action.in_(action_values)
    )
    action_clause = LogTimeline.source_log_id.in_(source_log_ids)
    if not include:
        action_clause = ~action_clause
    return and_(
        LogTimeline.source_table == LogTimelineSourceTable.USER_OPERATION_LOG.value,
        action_clause,
    )


def _build_log_timeline_category_clause(category: str):
    if category == "user":
        return _build_user_operation_action_category_clause(
            NON_USER_OPERATION_ACTION_VALUES,
            include=False,
        )
    if category == "other":
        return _build_user_operation_action_category_clause(
            OTHER_USER_OPERATION_ACTION_VALUES,
            include=True,
        )
    if category == "session":
        return _build_user_operation_action_category_clause(
            SESSION_USER_OPERATION_ACTION_VALUES,
            include=True,
        )

    source_tables = LOG_TIMELINE_CATEGORY_SOURCE_TABLES.get(category)
    if source_tables is None:
        return false()
    return LogTimeline.source_table.in_([source_table.value for source_table in source_tables])


def _apply_log_timeline_category_filter(base, category: str | None):
    if category:
        base = base.where(_build_log_timeline_category_clause(category))
    return base


def _build_log_timeline_subject_query(user_id: int, category: str | None):
    base = select(LogTimeline).where(LogTimeline.subject_user_id == user_id)
    return _apply_log_timeline_category_filter(base, category)


def _build_log_timeline_actor_query(user_id: int, category: str | None):
    base = select(LogTimeline).where(
        LogTimeline.actor_user_id == user_id,
        or_(
            LogTimeline.subject_user_id.is_(None),
            LogTimeline.subject_user_id != user_id,
        ),
    )
    return _apply_log_timeline_category_filter(base, category)


def _build_log_timeline_branch_queries(user_id: int, category: str | None):
    return (
        _build_log_timeline_subject_query(user_id, category),
        _build_log_timeline_actor_query(user_id, category),
    )


def _apply_log_timeline_keyword_filter(base, keyword: str | None):
    if not keyword:
        return base

    raw_keyword = keyword.strip()
    if not raw_keyword:
        return base

    detail_types = _resolve_log_timeline_detail_types(raw_keyword)
    clauses = []

    if should_use_order_fts(raw_keyword):
        rowid_subquery = build_order_fts_rowid_subquery(
            fts_table="log_timeline_fts",
            search_value=raw_keyword,
            search_field="all",
            field_map=LOG_TIMELINE_FTS_FIELD_MAP,
        )
        clauses.append(LogTimeline.id.in_(rowid_subquery))
    else:
        pinyin_keyword = normalize_search_term(raw_keyword)
        clauses.extend(
            (
                LogTimeline.search_text.contains(raw_keyword),
                LogTimeline.search_text_pinyin.contains(pinyin_keyword or raw_keyword),
                LogTimeline.detail_search_text.contains(raw_keyword),
            )
        )

    if detail_types:
        clauses.append(
            or_(*(_build_log_timeline_category_clause(detail_type) for detail_type in detail_types))
        )

    if _matches_cli_log_keyword(raw_keyword):
        clauses.append(LogTimeline.is_cli.is_(True))

    return base.where(or_(*clauses))


def _count_log_timeline_candidates(context: LogsCountContext, category: str | None) -> int:
    total = 0
    for base in _build_log_timeline_branch_queries(context.user_id, category):
        filtered = _apply_log_timeline_keyword_filter(base, context.keyword)
        count_query = select(func.count()).select_from(filtered.subquery())
        total += _exec_count_query(context, count_query)
    return total


def _sort_log_timeline_rows(rows: list[LogTimeline]) -> list[LogTimeline]:
    return sorted(
        rows,
        key=lambda row: (row.occurred_at, row.id or 0),
        reverse=True,
    )


def _load_log_timeline_rows(
    context: LogsCollectContext,
    *,
    category: str | None,
    offset: int,
    limit: int,
) -> list[LogTimeline]:
    window_size = offset + limit
    if window_size <= 0:
        return []

    rows_by_id: dict[int, LogTimeline] = {}
    for base in _build_log_timeline_branch_queries(context.user_id, category):
        filtered = _apply_log_timeline_keyword_filter(base, context.keyword)
        ordered = (
            filtered
            .order_by(LogTimeline.occurred_at.desc(), LogTimeline.id.desc())
            .limit(window_size)
        )
        for row in context.db.exec(ordered).all():
            if row.id is not None:
                rows_by_id[row.id] = row

    merged_rows = _sort_log_timeline_rows(list(rows_by_id.values()))
    return merged_rows[offset:window_size]


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
    action_value = normalize_action_value(log.action)
    action_label = REAGENT_ORDER_ACTION_LABELS.get(action_value, action_value)
    actor_name = user_names.get(log.actor_user_id)
    detail_prefix = action_label
    if (
        log.applicant_id == user_id
        and log.actor_user_id
        and log.actor_user_id != user_id
    ):
        detail_prefix = f"{actor_name or '管理员'}{action_label}"

    if action_value == "export":
        return _build_order_export_row(
            created_at=created_at,
            export_scope="reagent_orders",
            log_id=log.id,
            actor_user_id=log.actor_user_id,
            action_value=action_value,
            snapshot=snapshot,
            is_cli=timeline_row.is_cli,
        )

    before_snapshot = snapshot.get("before")
    after_snapshot = snapshot.get("after")
    display_snapshot = after_snapshot or before_snapshot or snapshot
    quantity = display_snapshot.get("quantity")
    return {
        "time": created_at,
        "type": "reagent_order",
        "detail": build_reagent_order_detail_text(
            detail_prefix,
            log.order_name,
            snapshot,
        ),
        "summary": {
            "kind": "reagent_order_action",
            "action_code": action_value,
            "actor_name": actor_name,
            "actor_is_external": bool(
                log.applicant_id == user_id
                and log.actor_user_id
                and log.actor_user_id != user_id
            ),
            "target": _build_log_summary_target(
                target_type="reagent_order",
                target_id=log.order_id,
                target_name=log.order_name,
                cas_number=log.cas_number,
                specification=(
                    f"{display_snapshot.get('initial_quantity') or ''} "
                    f"{display_snapshot.get('unit') or ''}"
                ).strip()
                or None,
                quantity=quantity,
                unit=display_snapshot.get("unit"),
            ),
        },
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
    action_value = normalize_action_value(log.action)
    action_label = CONSUMABLE_ORDER_ACTION_LABELS.get(action_value, action_value)
    actor_name = user_names.get(log.actor_user_id)
    detail_prefix = action_label
    if (
        log.applicant_id == user_id
        and log.actor_user_id
        and log.actor_user_id != user_id
    ):
        detail_prefix = f"{actor_name or '管理员'}{action_label}"

    if action_value == "export":
        return _build_order_export_row(
            created_at=created_at,
            export_scope="consumable_orders",
            log_id=log.id,
            actor_user_id=log.actor_user_id,
            action_value=action_value,
            snapshot=snapshot,
            is_cli=timeline_row.is_cli,
        )

    before_snapshot = snapshot.get("before")
    after_snapshot = snapshot.get("after")
    return {
        "time": created_at,
        "type": "consumable_order",
        "detail": build_consumable_order_detail_text(
            detail_prefix,
            log.order_name,
            log.specification,
            snapshot,
        ),
        "summary": {
            "kind": "consumable_order_action",
            "action_code": action_value,
            "actor_name": actor_name,
            "actor_is_external": bool(
                log.applicant_id == user_id
                and log.actor_user_id
                and log.actor_user_id != user_id
            ),
            "target": _build_log_summary_target(
                target_type="consumable_order",
                target_id=log.order_id,
                target_name=log.order_name,
                specification=log.specification,
                quantity=(after_snapshot or before_snapshot or snapshot).get("quantity"),
                unit=(after_snapshot or before_snapshot or snapshot).get("unit"),
            ),
        },
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
    action_value = normalize_action_value(log.action)
    action_label = USER_OPERATION_ACTION_LABELS.get(action_value, action_value)
    actor_name = user_names.get(log.actor_user_id)

    detail = action_label
    if (
        log.target_user_id == user_id
        and log.actor_user_id
        and log.actor_user_id != user_id
    ):
        detail = f"{actor_name or '管理员'}对你执行: {action_label}"
    detail = build_user_operation_detail_text(detail, log.detail)

    return {
        "time": created_at,
        "type": _get_user_operation_log_type(action_value),
        "detail": detail,
        "summary": {
            "kind": "user_action",
            "action_code": action_value,
            "actor_name": actor_name,
            "actor_is_external": bool(
                log.target_user_id == user_id
                and log.actor_user_id
                and log.actor_user_id != user_id
            ),
            "targets_viewer": bool(log.target_user_id == user_id),
            "target": _build_log_summary_target(
                target_type="user",
                target_id=log.target_user_id,
            ),
            "extra_detail": log.detail,
        },
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
    action_value = normalize_action_value(log.action)

    if action_value == InventoryOperationAction.INVENTORY_UPDATE.value:
        before_snapshot = snapshot.get("before", {})
        after_snapshot = snapshot.get("after", {})
        return {
            "time": created_at,
            "type": "inventory",
            "detail": f"更新库存 {log.item_name}",
            "summary": {
                "kind": "inventory_action",
                "action_code": action_value,
                "target": _build_log_summary_target(
                    target_type="inventory",
                    target_id=log.inventory_id,
                    target_name=log.item_name,
                    cas_number=log.cas_number,
                ),
            },
            "full_data": {
                "id": log.id,
                "inventory_id": log.inventory_id,
                "action": action_value,
                "name": log.item_name,
                "cas_number": log.cas_number,
                "before": before_snapshot,
                "after": after_snapshot,
                "purity": after_snapshot.get("purity"),
                "created_at": created_at,
                "is_cli": timeline_row.is_cli,
            },
        }

    if action_value == InventoryOperationAction.INVENTORY_DELETE.value:
        return {
            "time": created_at,
            "type": "inventory",
            "detail": f"删除库存 {log.item_name}",
            "summary": {
                "kind": "inventory_action",
                "action_code": action_value,
                "target": _build_log_summary_target(
                    target_type="inventory",
                    target_id=log.inventory_id,
                    target_name=log.item_name,
                    cas_number=log.cas_number,
                ),
            },
            "full_data": {
                "id": log.id,
                "inventory_id": log.inventory_id,
                "action": action_value,
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

    if action_value == InventoryOperationAction.INVENTORY_EXPORT.value:
        export_count = snapshot.get("count", 0)
        return {
            "time": created_at,
            "type": "inventory",
            "detail": f"导出库存 {export_count} 条",
            "summary": {
                "kind": "inventory_action",
                "action_code": action_value,
                "metrics": _build_log_summary_metrics(
                    count=int(export_count) if isinstance(export_count, int) else None,
                ),
                "source_meta": _build_log_source_meta(
                    export_scope="inventory",
                ),
            },
            "full_data": {
                "id": log.id,
                "action": action_value,
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
        "summary": {
            "kind": "inventory_action",
            "action_code": action_value,
            "target": _build_log_summary_target(
                target_type="inventory",
                target_id=log.inventory_id,
                target_name=log.item_name,
                cas_number=log.cas_number,
                quantity=snapshot.get("initial_quantity"),
                unit=snapshot.get("unit"),
            ),
        },
        "full_data": {
            "id": log.id,
            "inventory_id": log.inventory_id,
            "action": action_value,
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
    action_value = normalize_action_value(log.action)

    if action_value == CommonShelfOperationAction.EXPORT.value:
        export_count = snapshot.get("count", 0)
        return {
            "time": created_at,
            "type": "common_shelf",
            "detail": f"导出常用货架 {export_count} 条",
            "summary": {
                "kind": "common_shelf_action",
                "action_code": action_value,
                "metrics": _build_log_summary_metrics(
                    count=int(export_count) if isinstance(export_count, int) else None,
                ),
                "source_meta": _build_log_source_meta(
                    export_scope="common_shelf",
                ),
            },
            "full_data": {
                "id": log.id,
                "action": action_value,
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
        "summary": {
            "kind": "common_shelf_action",
            "action_code": action_value,
            "target": _build_log_summary_target(
                target_type="common_shelf",
                target_id=log.common_shelf_id,
                target_name=log.item_name,
                cas_number=log.cas_number,
                specification=display_snapshot.get("specification_text"),
            ),
        },
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
        "summary": {
            "kind": "borrow_action",
            "action_code": "borrow",
            "target": _build_log_summary_target(
                target_type="inventory",
                target_id=borrow_log.inventory_id,
                target_name=inventory.name,
                cas_number=inventory.cas_number,
                unit=inventory.unit,
            ),
            "metrics": _build_log_summary_metrics(
                quantity_borrowed=borrow_log.quantity_borrowed,
                quantity_returned=borrow_log.quantity_returned,
            ),
            "is_returned": is_returned,
        },
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
    category: str | None,
    offset: int,
    limit: int,
) -> list[dict[str, object]]:
    rows = _load_log_timeline_rows(
        context,
        category=category,
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
    category: str | None,
    include_search_logs: bool,
) -> list[dict[str, object]]:
    if category == "session":
        merged_limit = context.skip + context.limit
        candidates: list[dict[str, object]] = []
        timeline_candidates = _collect_timeline_candidates(
            context,
            category="session",
            offset=0,
            limit=merged_limit,
        )
        _append_session_candidates(
            LogsCollectContext(
                db=context.db,
                user_id=context.user_id,
                keyword=context.keyword,
                skip=0,
                limit=merged_limit,
            ),
            candidates,
        )
        candidates = [*timeline_candidates, *candidates]
        candidates.sort(key=lambda item: item["time"], reverse=True)
        return candidates[context.skip : context.skip + context.limit]

    if category == "search":
        candidates: list[dict[str, object]] = []
        if include_search_logs:
            _append_search_log_candidates(context, candidates)
        return candidates

    if category is None:
        # timeline + session 混排时，先分别取到前 skip+limit 窗口再做全局排序。
        merged_limit = context.skip + context.limit
        timeline_candidates = _collect_timeline_candidates(
            context,
            category=None,
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
        search_candidates: list[dict[str, object]] = []
        if include_search_logs:
            _append_search_log_candidates(
                LogsCollectContext(
                    db=context.db,
                    user_id=context.user_id,
                    keyword=context.keyword,
                    skip=0,
                    limit=merged_limit,
                ),
                search_candidates,
            )
        candidates = [*timeline_candidates, *session_candidates, *search_candidates]
        candidates.sort(key=lambda item: item["time"], reverse=True)
        return candidates

    return _collect_timeline_candidates(
        context,
        category=category,
        offset=context.skip,
        limit=context.limit,
    )


def _collect_user_logs_total(
    context: LogsCountContext,
    category: str | None,
    include_search_logs: bool,
) -> int:
    if category == "session":
        return (
            _count_log_timeline_candidates(context, "session")
            + _count_session_candidates(context)
        )
    if category == "search":
        return _count_search_log_candidates(context) if include_search_logs else 0
    if category is None:
        total = _count_log_timeline_candidates(context, None) + _count_session_candidates(context)
        if include_search_logs:
            return total + _count_search_log_candidates(context)
        return total
    return _count_log_timeline_candidates(context, category)


def _slice_candidates_for_response(
    candidates: list[dict[str, object]],
    category: str | None,
    skip: int,
    limit: int,
) -> list[dict[str, object]]:
    if category is None:
        return candidates[skip : skip + limit]
    return candidates[:limit]

@router.post("/{user_id}/logs-token")
def generate_logs_token(
    user_id: int,
    current_user: CurrentUser,
    db: DBSession,
):
    _ensure_user_logs_access(current_user, user_id)
    # 日志 token 会触发跨表聚合查询，仍要保留基础限流。
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


@router.post("/logs/query", response_model=LogsQueryResponse)
def get_user_logs(
    request: LogsQueryRequest,
    current_user: CurrentUser,
    db: DBSession,
):
    user_id, user = _resolve_logs_query_user(request.token, db)
    _ensure_user_logs_access(current_user, user_id)
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
        category=request.category,
        include_search_logs=request.include_search_logs,
    )
    selected = _slice_candidates_for_response(
        candidates=candidates,
        category=request.category,
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
        category=request.category,
        include_search_logs=request.include_search_logs,
    )

    return {
        "user_id": user_id,
        "username": user.username,
        "data": results,
        "total": total,
    }
