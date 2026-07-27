# Inventory API 路由：库存管理。
# 关键规则 #2：CAS 编号标准化（数据从订单复制）。
# 所有用户可查看/消耗/新增/编辑/删除分组。
# 路由顺序要求：具名路由必须在 /{inventory_id} 之前，
# 避免路径参数误捕获 "export"、"dashboard" 等字符串。
import logging
import time
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Optional, Dict, Any, Annotated, Mapping

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy import case
from sqlmodel import Session, select, func, delete

from app.database import get_db, DBSession
from app.models.inventory import Inventory, InventoryUpdate, InventoryResponse, InventoryStatus
from app.core.api_errors import ApiErrorCode, api_error
from app.core.auth import CurrentSession, get_current_user, require_non_public
from app.core.config import settings
from app.core.constants import (    DEFAULT_PAGE_SIZE,
    LIST_CACHE_TTL_SECONDS,
    MAX_PAGE_SIZE,
    SSEEventType,
    SSERoom,
)
from app.services.sse_manager import sse_manager
from app.core.time_utils import get_utc_now
from app.services.cas_utils import normalize_cas, validate_cas_format
from app.services.cas_utils import BIOLOGICAL_REAGENT_CAS
from app.services.pinyin_utils import compute_pinyin_fields
from app.services.sql_utils import (
    normalize_search_term,
    order_with_nulls_last,
    order_with_special_last,
)
from app.services.api_utils import (
    clear_cache_by_prefix,
    get_cached_result,
    normalize_pagination,
    serialize_inventory_items,
    set_cached_result,
)
from app.services.inventory_fts import (
    InventoryFTSError,
    apply_inventory_fts_filter,
    build_inventory_fts_rowid_subquery,
    should_use_inventory_fts,
)
from app.services.inventory_queries import (
    get_regular_inventory_by_id,
    regular_inventory_query,
)
from app.services.inventory_state_guards import (
    ensure_inventory_deletable,
    ensure_inventory_editable,
)
from app.services.search_matchers import (
    CASSearchMode,
    TextMatchMode,
    build_chunked_in_clause,
    build_cas_search_clause,
    build_segmented_search_log_meta,
    build_text_same_field_segmented_clause,
    build_text_search_clause,
    classify_cas_search,
    collect_search_fields,
    combine_or_clauses,
    build_multi_search_log_meta,
    split_segmented_search_terms,
    split_exact_cas_search_terms,
    union_id_subqueries,
)
from app.services.spec_utils import parse_specification, SpecificationError
from app.services.inventory_operation_logger import (
    log_inventory_delete,
    log_inventory_update,
)
from app.services.shelf_utils import normalize_storage_location
from app.api.inventory_extended_routes import register_inventory_extended_routes
from app.api.inventory_timeline import register_inventory_timeline_routes
from app.core.request_utils import get_request_is_cli, get_sse_client_id
from app.core.db_compat import exec_delete_returning_first
from app.models.user import User
from app.search_completion_db import INVENTORY_COMPLETION_ENDPOINT
from app.services.search_query_log_service import (
    buffer_search_log,
    build_search_log_filters,
    build_search_log_sort,
)
from app.services.search_completion_entity_index import (
    delete_inventory_entity_completions,
    run_completion_index_update,
    sync_inventory_entity_completions,
)
from app.services.structure_cache_tasks import enqueue_structure_cache_resolution
from app.services.structure_index import (
    StructureIndexRevisionChangedError,
    StructureQueryFormat,
    StructureSearchMode,
    structure_index,
)
from app.services.structure_inventory_summary import normalized_inventory_cas_expr
from app.services.structure_search_cache import (
    StructureSearchCacheEntry,
    get_structure_search_cache_entry,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/inventory", tags=["Inventory"])
LIST_CACHE_PREFIX = "list:"
INVENTORY_NOT_FOUND = "Inventory item not found"

# ==================== 搜索缓存 ====================
SEARCH_CACHE: Dict[str, tuple[Any, datetime]] = {}
INVENTORY_CAS_SEARCH_KEYS = frozenset({"cas_number"})
INVENTORY_SEARCH_SQL_FIELD_MAP = {
    "name": [Inventory.name, Inventory.name_pinyin, Inventory.name_pinyin_initials],
    "cas_number": [Inventory.cas_number],
    "storage_location": [
        Inventory.storage_location,
        Inventory.storage_location_pinyin,
        Inventory.storage_location_pinyin_initials,
    ],
    "brand": [Inventory.brand, Inventory.brand_pinyin, Inventory.brand_pinyin_initials],
    "category": [
        Inventory.category,
        Inventory.category_pinyin,
        Inventory.category_pinyin_initials,
    ],
}
INVENTORY_SEGMENTED_SEARCH_FIELD_GROUPS = {
    "name": INVENTORY_SEARCH_SQL_FIELD_MAP["name"],
    "brand": INVENTORY_SEARCH_SQL_FIELD_MAP["brand"],
    "category": INVENTORY_SEARCH_SQL_FIELD_MAP["category"],
    "storage_location": INVENTORY_SEARCH_SQL_FIELD_MAP["storage_location"],
}

VALID_INVENTORY_SORT_FIELDS = {
    "cas_number",
    "name",
    "category",
    "storage_location",
    "brand",
    "remaining_quantity",
    "remaining_percent",
    "initial_quantity",
    "status",
    "created_at",
}
INVENTORY_SEARCH_FTS_FIELD_MAP = {
    "name": ["name", "name_pinyin", "name_pinyin_initials"],
    "cas_number": ["cas_number"],
    "storage_location": [
        "storage_location",
        "storage_location_pinyin",
        "storage_location_pinyin_initials",
    ],
    "brand": ["brand", "brand_pinyin", "brand_pinyin_initials"],
    "category": ["category", "category_pinyin", "category_pinyin_initials"],
}
VISIBLE_STRUCTURE_STATUSES = (
    InventoryStatus.IN_STOCK,
    InventoryStatus.RUN_SHORT,
    InventoryStatus.BORROWED,
)


@dataclass(frozen=True)
class InventoryFilterOptions:
    # 封装库存列表筛选参数，避免筛选函数参数膨胀并统一调用边界。

    status_filter: Optional[InventoryStatus]
    cas_filter: Optional[str]
    hazardous_only: bool
    search: Optional[str]
    search_field: Optional[str]
    fuzzy: bool
    match_mode: TextMatchMode
    structure_cas_numbers: tuple[str, ...] | None
    structure_search_id: Optional[str]
    structure_match_mode: Optional[StructureSearchMode]
    structure_query: Optional[str]
    structure_query_format: Optional[StructureQueryFormat]
    structure_only_in_stock: bool


class InventoryListQuery(BaseModel):
    # 定义库存列表查询参数模型，保证路由签名精简且查询契约不变。

    skip: int = 0
    limit: int = min(DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)
    status_filter: Optional[InventoryStatus] = None
    cas_filter: Optional[str] = None
    hazardous_only: bool = False
    search: Optional[str] = Query(default=None, max_length=20_000)
    search_field: Optional[str] = None
    fuzzy: bool = False
    match_mode: TextMatchMode = TextMatchMode.CONTAINS
    structure_search_id: Optional[str] = Query(default=None, max_length=128)
    structure_match_mode: Optional[StructureSearchMode] = None
    structure_query: Optional[str] = Query(default=None, max_length=20_000)
    structure_query_format: Optional[StructureQueryFormat] = None
    structure_only_in_stock: bool = False
    sort_by: Optional[str] = None
    sort_order: Optional[str] = "desc"

    def to_filter_options(self) -> InventoryFilterOptions:
        # 把路由查询参数转换为筛选参数对象，减少调用方重复拼装。

        return InventoryFilterOptions(
            status_filter=self.status_filter,
            cas_filter=self.cas_filter,
            hazardous_only=self.hazardous_only,
            search=self.search,
            search_field=self.search_field,
            fuzzy=self.fuzzy,
            match_mode=self.match_mode,
            structure_cas_numbers=None,
            structure_search_id=self.structure_search_id,
            structure_match_mode=self.structure_match_mode,
            structure_query=self.structure_query,
            structure_query_format=self.structure_query_format,
            structure_only_in_stock=self.structure_only_in_stock,
        )


def _has_structure_query(options: InventoryFilterOptions) -> bool:
    return bool(
        options.structure_query
        or options.structure_match_mode
        or options.structure_query_format
    )


def _has_structure_filter_options(options: InventoryFilterOptions) -> bool:
    return bool(
        options.structure_cas_numbers is not None
        or options.structure_search_id
        or _has_structure_query(options)
        or options.structure_only_in_stock
    )


def _ensure_structure_filter_enabled(options: InventoryFilterOptions) -> None:
    if _has_structure_filter_options(options) and not settings.chem_structure_feature_enabled:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Structure search feature is disabled",
        )


def _get_structure_search_entry_or_410(
    db: Session,
    search_id: str,
) -> StructureSearchCacheEntry:
    snapshot = structure_index.status(db)
    entry = get_structure_search_cache_entry(
        search_id,
        index_version=snapshot.db_revision,
    )
    if entry is None:
        raise api_error(
            status_code=status.HTTP_410_GONE,
            detail="Structure search result has expired",
            code=ApiErrorCode.STRUCTURE_SEARCH_EXPIRED,
        )
    return entry


def _resolve_inventory_structure_cas_numbers(
    db: Session,
    *,
    options: InventoryFilterOptions,
) -> tuple[str, ...] | None:
    _ensure_structure_filter_enabled(options)
    if options.structure_cas_numbers is not None:
        return options.structure_cas_numbers
    if options.structure_search_id:
        return _get_structure_search_entry_or_410(db, options.structure_search_id).cas_numbers
    if not _has_structure_query(options):
        return None
    if not (
        options.structure_query
        and options.structure_match_mode
        and options.structure_query_format
    ):
        raise api_error(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Structure filter parameters are incomplete",
            code=ApiErrorCode.STRUCTURE_FILTER_INCOMPLETE,
        )

    try:
        for revision_attempt in range(2):
            snapshot = structure_index.ensure_current(db)
            if snapshot.molecule_count <= 0:
                return ()
            try:
                hits = _search_inventory_structure_index(
                    options=options,
                    limit=snapshot.molecule_count,
                    expected_revision=snapshot.applied_revision,
                )
            except StructureIndexRevisionChangedError:
                if revision_attempt == 0:
                    db.rollback()
                    continue
                raise
            break
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RuntimeError as exc:
        logger.warning("Inventory structure filter unavailable: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Structure index is unavailable",
        ) from exc
    return tuple(
        normalized
        for hit in hits
        if (normalized := normalize_cas(hit.cas_number))
    )


def _search_inventory_structure_index(
    *,
    options: InventoryFilterOptions,
    limit: int,
    expected_revision: int,
):
    search_kwargs = {
        "query": options.structure_query or "",
        "query_format": options.structure_query_format or "",
        "limit": limit,
        "expected_revision": expected_revision,
    }
    if options.structure_match_mode == StructureSearchMode.EXACT:
        return structure_index.exact_search(**search_kwargs)
    return structure_index.search(**search_kwargs)


def _resolve_inventory_structure_smiles_by_cas(
    db: Session,
    options: InventoryFilterOptions,
) -> Mapping[str, str]:
    if not options.structure_search_id:
        return {}
    return _get_structure_search_entry_or_410(db, options.structure_search_id).smiles_by_cas


def _compute_remaining_percent(remaining: Optional[float], initial: Optional[float]) -> Optional[float]:
    # 计算库存剩余比例，统一处理空值和零分母。

    if initial is None or initial <= 0:
        return None
    if remaining is None:
        return None
    return remaining / initial


def _get_by_id(db: Session, inventory_id: int) -> Optional[Inventory]:
    # 按库存 ID 查询常规库存记录，复用统一查询入口。

    return get_regular_inventory_by_id(db, inventory_id)


def _clear_list_cache(
    item: Inventory | None = None, *, is_delete: bool = False,
) -> None:
    # 清理库存列表缓存，确保写操作后读请求拿到最新数据。

    cleared_count = clear_cache_by_prefix(SEARCH_CACHE, prefix=LIST_CACHE_PREFIX)
    if item is not None:
        def update_completion_index() -> None:
            if is_delete:
                delete_inventory_entity_completions(item.id)
            else:
                sync_inventory_entity_completions(item)

        run_completion_index_update(
            update_completion_index,
            context="inventory",
            endpoint=INVENTORY_COMPLETION_ENDPOINT,
        )
    logger.info(f"Cleared {cleared_count} list cache entries")


def _apply_inventory_static_filters(base, *, options: InventoryFilterOptions):
    # 应用与搜索无关的固定筛选条件，先缩小基础结果集。

    if options.status_filter:
        base = base.where(Inventory.status == options.status_filter)
    if options.cas_filter:
        base = base.where(Inventory.cas_number == normalize_cas(options.cas_filter))
    if options.hazardous_only:
        base = base.where(Inventory.is_hazardous.is_(True))
    if options.structure_cas_numbers is not None:
        base = base.where(normalized_inventory_cas_expr().in_(options.structure_cas_numbers))
    if options.structure_only_in_stock:
        base = base.where(Inventory.status.in_(VISIBLE_STRUCTURE_STATUSES))
    return base


def _normalize_inventory_search_value(options: InventoryFilterOptions) -> Optional[str]:
    # 标准化搜索词，统一处理 fuzzy 场景和空白输入。

    if not options.search:
        return None
    raw_search = options.search.strip()
    if not raw_search:
        return None
    if options.fuzzy:
        return normalize_search_term(raw_search)
    return raw_search


def _get_inventory_multi_cas_terms(options: InventoryFilterOptions) -> list[str]:
    if options.search_field not in INVENTORY_CAS_SEARCH_KEYS and options.search_field not in {None, "all"}:
        return []
    return split_exact_cas_search_terms(options.search)


def _get_inventory_segmented_terms(options: InventoryFilterOptions) -> list[str]:
    search_field = options.search_field
    disabled = (
        search_field is not None
        and search_field != "all"
        and search_field not in INVENTORY_SEGMENTED_SEARCH_FIELD_GROUPS
    )
    return split_segmented_search_terms(
        options.search,
        match_mode=options.match_mode,
        disabled=disabled,
    )


def _get_inventory_segmented_field_groups(search_field: Optional[str]):
    if search_field and search_field != "all":
        fields = INVENTORY_SEGMENTED_SEARCH_FIELD_GROUPS.get(search_field)
        return [fields] if fields else []
    return list(INVENTORY_SEGMENTED_SEARCH_FIELD_GROUPS.values())


def _apply_inventory_segmented_search(
    base,
    *,
    options: InventoryFilterOptions,
    terms: list[str],
):
    field_groups = _get_inventory_segmented_field_groups(options.search_field)
    if not field_groups:
        return base
    return base.where(
        build_text_same_field_segmented_clause(
            field_groups,
            terms,
            fuzzy=options.fuzzy,
            match_mode=options.match_mode,
        )
    )



def _build_inventory_all_fts_subquery(search_value: str):
    # 构建库存 ALL 模式 FTS 子查询，失败时返回 None 并走 LIKE 回退。

    try:
        return build_inventory_fts_rowid_subquery(
            search_value=search_value,
            search_field="all",
            field_map=INVENTORY_SEARCH_FTS_FIELD_MAP,
        )
    except InventoryFTSError as exc:
        logger.warning("Inventory ALL-search FTS fallback to LIKE due to configuration error: %s", exc)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Inventory ALL-search FTS fallback to LIKE due to runtime error: %s", exc)
    return None


def _apply_inventory_single_field_search(
    base,
    *,
    search_field: Optional[str],
    search_value: str,
    fuzzy: bool,
    match_mode: TextMatchMode,
    cas_exact_or_prefix: bool,
):
    # 处理指定字段搜索，优先命中精确 CAS 和 FTS，再回退到 LIKE。

    if search_field in INVENTORY_CAS_SEARCH_KEYS and (
        cas_exact_or_prefix or match_mode == TextMatchMode.EXACT
    ):
        return base.where(
            build_cas_search_clause(
                Inventory.cas_number,
                search_value,
                fuzzy=fuzzy,
                match_mode=match_mode,
            )
        )
    if match_mode == TextMatchMode.EXACT or not should_use_inventory_fts(search_value):
        return _apply_inventory_like_filters(
            base,
            search_value=search_value,
            search_field=search_field,
            fuzzy=fuzzy,
            match_mode=match_mode,
        )
    try:
        return apply_inventory_fts_filter(
            base,
            search_value=search_value,
            search_field=search_field,
            field_map=INVENTORY_SEARCH_FTS_FIELD_MAP,
        )
    except InventoryFTSError as exc:
        logger.warning("Inventory FTS fallback to LIKE due to configuration error: %s", exc)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Inventory FTS fallback to LIKE due to runtime error: %s", exc)
    return _apply_inventory_like_filters(
        base,
        search_value=search_value,
        search_field=search_field,
        fuzzy=fuzzy,
        match_mode=match_mode,
    )


def _apply_inventory_all_field_search(
    base,
    *,
    search_value: str,
    fuzzy: bool,
    match_mode: TextMatchMode,
    cas_exact_or_prefix: bool,
):
    # 处理 ALL 搜索模式，能走 FTS 时优先 FTS；FTS 不可用时回退到 LIKE 聚合。

    can_use_fts_all = (
        match_mode == TextMatchMode.CONTAINS
        and (not fuzzy)
        and should_use_inventory_fts(search_value)
        and not cas_exact_or_prefix
    )
    if can_use_fts_all:
        fts_rowid_subquery = _build_inventory_all_fts_subquery(search_value)
        if fts_rowid_subquery is not None:
            return base.where(Inventory.id.in_(fts_rowid_subquery))
    all_like_subquery = _build_inventory_all_like_subquery(
        search_value=search_value,
        fuzzy=fuzzy,
        match_mode=match_mode,
    )
    if all_like_subquery is None:
        return base
    return base.where(Inventory.id.in_(all_like_subquery))


def _build_inventory_all_like_subquery(
    *,
    search_value: str,
    fuzzy: bool,
    match_mode: TextMatchMode,
):
    # 构建 ALL 模式 LIKE 回退子查询，避免大 OR 导致的扫描放大。

    all_candidates = [
        select(Inventory.id).where(
            build_cas_search_clause(
                Inventory.cas_number,
                search_value,
                fuzzy=fuzzy,
                match_mode=match_mode,
            )
        )
    ]
    text_fields = collect_search_fields(
        INVENTORY_SEARCH_SQL_FIELD_MAP,
        exclude_keys=set(INVENTORY_CAS_SEARCH_KEYS),
    )
    if text_fields:
        all_candidates.append(
            select(Inventory.id).where(
                combine_or_clauses(
                    build_text_search_clause(
                        field,
                        search_value,
                        fuzzy=fuzzy,
                        match_mode=match_mode,
                    )
                    for field in text_fields
                )
            )
        )
    return union_id_subqueries(all_candidates)


def _apply_inventory_search_term(
    base,
    *,
    options: InventoryFilterOptions,
    search_value: str,
):
    cas_mode, _ = classify_cas_search(search_value, fuzzy=options.fuzzy)
    cas_exact_or_prefix = cas_mode in (CASSearchMode.EXACT, CASSearchMode.PREFIX)
    is_all_field = not options.search_field or options.search_field == "all"

    if is_all_field:
        return _apply_inventory_all_field_search(
            base,
            search_value=search_value,
            fuzzy=options.fuzzy,
            match_mode=options.match_mode,
            cas_exact_or_prefix=cas_exact_or_prefix,
        )

    return _apply_inventory_single_field_search(
        base,
        search_field=options.search_field,
        search_value=search_value,
        fuzzy=options.fuzzy,
        match_mode=options.match_mode,
        cas_exact_or_prefix=cas_exact_or_prefix,
    )


def _apply_inventory_filters(
    base,
    *,
    options: InventoryFilterOptions,
    segmented_terms: list[str] | None = None,
):
    # 统一应用库存列表筛选，保持搜索语义同时降低主流程复杂度。

    filtered = _apply_inventory_static_filters(base, options=options)
    multi_cas_terms = _get_inventory_multi_cas_terms(options)
    if multi_cas_terms:
        return filtered.where(
            build_chunked_in_clause(normalized_inventory_cas_expr(), multi_cas_terms)
        )

    terms = segmented_terms if segmented_terms is not None else _get_inventory_segmented_terms(options)
    if terms:
        return _apply_inventory_segmented_search(
            filtered,
            options=options,
            terms=terms,
        )

    search_value = _normalize_inventory_search_value(options)
    if not search_value:
        return filtered
    return _apply_inventory_search_term(
        filtered,
        options=options,
        search_value=search_value,
    )


def _apply_inventory_like_filters(
    base,
    *,
    search_value: str,
    search_field: Optional[str],
    fuzzy: bool,
    match_mode: TextMatchMode,
):
    if search_field and search_field != "all" and search_field in INVENTORY_SEARCH_SQL_FIELD_MAP:
        if search_field in INVENTORY_CAS_SEARCH_KEYS:
            return base.where(
                build_cas_search_clause(
                    Inventory.cas_number,
                    search_value,
                    fuzzy=fuzzy,
                    match_mode=match_mode,
                )
            )
        return base.where(
            combine_or_clauses(
                build_text_search_clause(
                    field,
                    search_value,
                    fuzzy=fuzzy,
                    match_mode=match_mode,
                )
                for field in INVENTORY_SEARCH_SQL_FIELD_MAP[search_field]
            )
        )

    all_clauses = []
    for field_key, fields in INVENTORY_SEARCH_SQL_FIELD_MAP.items():
        if field_key == "cas_number":
            all_clauses.append(
                build_cas_search_clause(
                    Inventory.cas_number,
                    search_value,
                    fuzzy=fuzzy,
                    match_mode=match_mode,
                )
            )
            continue
        if field_key in INVENTORY_CAS_SEARCH_KEYS:
            continue
        all_clauses.extend(
            build_text_search_clause(
                field,
                search_value,
                fuzzy=fuzzy,
                match_mode=match_mode,
            )
            for field in fields
        )
    return base.where(combine_or_clauses(all_clauses))


def _build_inventory_order_expr(sort_by: Optional[str], sort_order: Optional[str]):
    # 生成库存列表排序表达式，统一处理中英文与特殊 CAS 排序规则。

    computed_remaining_percent = (
        Inventory.remaining_quantity / func.nullif(Inventory.initial_quantity, 0)
    )

    pinyin_sort_field_map = {
        "name": Inventory.name_pinyin,
        "category": Inventory.category_pinyin,
        "brand": Inventory.brand_pinyin,
        "storage_location": Inventory.storage_location_pinyin,
    }

    sort_field_map = {
        "cas_number": Inventory.cas_number,
        "name": Inventory.name,
        "category": Inventory.category,
        "storage_location": Inventory.storage_location,
        "brand": Inventory.brand,
        "remaining_quantity": Inventory.remaining_quantity,
        # 对历史数据做兜底：当存储列为空时，实时按 remaining/initial 计算用于排序。
        "remaining_percent": func.coalesce(Inventory.remaining_percent, computed_remaining_percent),
        "initial_quantity": Inventory.initial_quantity,
        "status": Inventory.status,
        "created_at": Inventory.created_at,
    }

    sort_direction = sort_order.lower() if sort_order else "desc"
    pinyin_sort_fields = {"name", "category", "brand", "storage_location"}

    if sort_by in pinyin_sort_fields:
        order_column = pinyin_sort_field_map.get(sort_by)
        # 索引优先：避免使用 `field IS NULL` 表达式，给 SQLite 机会走复合索引排序
        if sort_direction == "asc":
            return (order_column.asc(),)
        return (order_column.desc(),)
    else:
        order_column = sort_field_map.get(sort_by, Inventory.created_at)

    if sort_by == "cas_number":
        return order_with_special_last(order_column, BIOLOGICAL_REAGENT_CAS, sort_direction)

    return order_with_nulls_last(order_column, sort_direction)


def _build_structure_order_expr(structure_cas_numbers: tuple[str, ...] | None):
    # 结构检索结果已按相似度排序；库存列表在无显式表头排序时保持该顺序。
    if not structure_cas_numbers:
        return None
    order_map = {cas_number: index for index, cas_number in enumerate(structure_cas_numbers)}
    return case(order_map, value=normalized_inventory_cas_expr(), else_=len(order_map)).asc()


def _build_inventory_multi_cas_order_expr(cas_terms: list[str]):
    if not cas_terms:
        return None
    order_map = {cas_number: index for index, cas_number in enumerate(cas_terms)}
    return case(order_map, value=normalized_inventory_cas_expr(), else_=len(order_map)).asc()


def _attach_structure_matched_smiles(
    items: list[dict],
    smiles_by_cas: Mapping[str, str],
) -> list[dict]:
    if not smiles_by_cas:
        return items
    for item in items:
        normalized = normalize_cas(str(item.get("cas_number") or ""))
        if normalized and (smiles := smiles_by_cas.get(normalized)):
            item["structure_matched_smiles"] = smiles
    return items


def _normalize_update_payload(item: Inventory, update_data: dict) -> bool:
    # 规范化库存更新载荷并处理规格字段，返回是否更新了规格。

    specification_updated = False
    optional_string_fields = ["storage_location", "category", "english_name", "alias", "purity", "notes"]
    for field in optional_string_fields:
        if field in update_data and update_data[field] == "":
            update_data[field] = None

    if "cas_number" in update_data and update_data["cas_number"]:
        normalized_cas = normalize_cas(update_data["cas_number"])
        if normalized_cas:
            update_data["cas_number"] = normalized_cas

    if "storage_location" in update_data:
        normalized_storage = normalize_storage_location(update_data["storage_location"])
        update_data["storage_location"] = normalized_storage

    if "specification" in update_data:
        spec_str = update_data["specification"]
        if spec_str:
            quantity, unit = parse_specification(spec_str)
            item.initial_quantity = quantity
            item.unit = unit
            specification_updated = True
        update_data.pop("specification")

    return specification_updated


def _ensure_inventory_required_brand(item: Inventory, update_data: dict) -> None:
    # 库存列表编辑后必须写入有效品牌，兼容旧数据并阻止保存空品牌。

    effective_brand = update_data.get("brand", item.brand)
    if not isinstance(effective_brand, str) or not effective_brand.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="brand is required")
    if "brand" in update_data:
        update_data["brand"] = effective_brand.strip()


# 先注册具名和扩展路由，保持路径优先级。
register_inventory_extended_routes(router, SEARCH_CACHE, LIST_CACHE_PREFIX)
register_inventory_timeline_routes(router)


@router.get("/")
def list_inventory(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    query: Annotated[InventoryListQuery, Depends()],
    current_session: CurrentSession,
):
    # 按查询参数返回库存列表，并保持缓存与排序行为一致。

    _current_user, session = current_session
    started = time.perf_counter()
    skip, limit = normalize_pagination(query.skip, query.limit)
    status_filter = query.status_filter
    cas_filter = query.cas_filter
    hazardous_only = query.hazardous_only
    filter_options = query.to_filter_options()
    resolved_structure_cas_numbers = _resolve_inventory_structure_cas_numbers(
        db,
        options=filter_options,
    )
    filter_options = replace(
        filter_options,
        structure_cas_numbers=resolved_structure_cas_numbers,
    )
    search = query.search
    search_field = query.search_field
    fuzzy = query.fuzzy
    match_mode = query.match_mode
    has_structure_filter = resolved_structure_cas_numbers is not None
    structure_search_id = query.structure_search_id
    structure_match_mode = query.structure_match_mode
    structure_query = query.structure_query
    structure_query_format = query.structure_query_format
    structure_only_in_stock = query.structure_only_in_stock
    sort_by = query.sort_by
    sort_order = query.sort_order

    cache_key = (
        f"{LIST_CACHE_PREFIX}{skip}:{limit}:{search or ''}:{status_filter or ''}:"
        f"{cas_filter or ''}:{hazardous_only}:{search_field or ''}:{fuzzy}:"
        f"{match_mode.value}:{structure_only_in_stock}:"
        f"{structure_search_id or ''}:{structure_match_mode or ''}:"
        f"{structure_query or ''}:{structure_query_format or ''}:"
        f"{sort_by or ''}:{sort_order or ''}"
    )

    if sort_by and sort_by not in VALID_INVENTORY_SORT_FIELDS:
        raise api_error(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid sort field",
            code=ApiErrorCode.INVALID_SORT_FIELD,
        )

    is_first_page = skip == 0
    has_search = bool(
        search
        or status_filter
        or cas_filter
        or hazardous_only
        or has_structure_filter
        or structure_only_in_stock
        or sort_by
    )
    should_use_cache = is_first_page and not has_search

    if should_use_cache:
        cached = get_cached_result(
            SEARCH_CACHE,
            cache_key,
            now=get_utc_now,
            ttl_seconds=LIST_CACHE_TTL_SECONDS,
        )
        if cached is not None:
            return {
                **cached,
                "skip": skip,
                "limit": limit,
            }

    try:
        segmented_terms = _get_inventory_segmented_terms(filter_options)
        base = _apply_inventory_filters(
            regular_inventory_query(),
            options=filter_options,
            segmented_terms=segmented_terms,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    total = db.exec(select(func.count()).select_from(base.subquery())).one()

    multi_cas_terms = _get_inventory_multi_cas_terms(filter_options)
    multi_cas_order_expr = _build_inventory_multi_cas_order_expr(multi_cas_terms)
    structure_order_expr = (
        _build_structure_order_expr(filter_options.structure_cas_numbers)
        if has_structure_filter and not sort_by and multi_cas_order_expr is None
        else None
    )
    order_expr = (
        (multi_cas_order_expr, *_build_inventory_order_expr(sort_by, sort_order))
        if multi_cas_order_expr is not None
        else (
            (structure_order_expr,)
            if structure_order_expr is not None
            else _build_inventory_order_expr(sort_by, sort_order)
        )
    )

    secondary_order = Inventory.created_at.desc()
    tertiary_order = Inventory.id.desc()

    if limit > 0:
        items = db.exec(base.order_by(*order_expr, secondary_order, tertiary_order).offset(skip).limit(limit)).all()
    else:
        items = []

    result_data = _attach_structure_matched_smiles(
        serialize_inventory_items(db, items),
        _resolve_inventory_structure_smiles_by_cas(db, filter_options),
    )

    result = {
        "data": result_data,
        "total": total,
        "skip": skip,
        "limit": limit,
    }
    include_search_options = bool(search and len(search.strip()) >= 2)

    if should_use_cache:
        cache_data = {
            "data": result["data"],
            "total": result["total"],
        }
        set_cached_result(SEARCH_CACHE, cache_key, cache_data, now=get_utc_now)

    buffer_search_log(
        user_id=session.user_id,
        session_id=session.id or 0,
        source="cli" if get_request_is_cli(request) else "web",
        endpoint="/inventory/",
        client_slot="cli" if get_request_is_cli(request) else (get_sse_client_id(request) or "web"),
        raw_query=search,
        filters=build_search_log_filters(
            search_field=search_field if include_search_options else None,
            fuzzy=fuzzy if include_search_options else False,
            match_mode=match_mode if include_search_options else None,
            extra_filters={
                "status_filter": status_filter,
                "cas_filter": cas_filter,
                "hazardous_only": hazardous_only,
                "structure_search_id": structure_search_id,
                "structure_match_mode": structure_match_mode,
                "structure_query": structure_query,
                "structure_query_format": structure_query_format,
                "structure_only_in_stock": structure_only_in_stock,
                **build_multi_search_log_meta(
                    search,
                    enabled=bool(multi_cas_terms),
                ),
                **build_segmented_search_log_meta(
                    segmented_terms,
                    enabled=bool(segmented_terms) and not multi_cas_terms,
                ),
            },
        ),
        has_effective_filter=bool(
            status_filter
            or cas_filter
            or hazardous_only
            or has_structure_filter
            or structure_only_in_stock
        ),
        sort=build_search_log_sort(sort_by=sort_by, sort_order=sort_order),
        result_count=total,
        latency_ms=max(0, int((time.perf_counter() - started) * 1000)),
    )

    return result

@router.get("/{inventory_id}", response_model=InventoryResponse, dependencies=[Depends(get_current_user)])
def get_inventory(inventory_id: int, db: DBSession):
    item = _get_by_id(db, inventory_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=INVENTORY_NOT_FOUND)
    return serialize_inventory_items(db, [item])[0]


@router.put("/{inventory_id}", response_model=InventoryResponse, dependencies=[Depends(get_current_user)])
async def update_inventory(
    inventory_id: int,
    update: InventoryUpdate,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    # 更新库存记录，保持权限、字段标准化与状态联动语义不变。

    item = _get_by_id(db, inventory_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=INVENTORY_NOT_FOUND)
    before_item = Inventory.model_validate(item)

    ensure_inventory_editable(item)

    update_data = update.model_dump(exclude_unset=True)
    _validate_inventory_update_cas(update_data)

    try:
        specification_updated = _normalize_update_payload(item, update_data)
    except SpecificationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    _ensure_inventory_required_brand(item, update_data)

    _apply_inventory_remaining_quantity_update(
        item,
        update_data=update_data,
        specification_updated=specification_updated,
    )

    for field, value in update_data.items():
        setattr(item, field, value)

    _apply_inventory_pinyin_updates(item, update_data=update_data)
    log_inventory_update(
        db,
        before_inventory=before_item,
        after_inventory=item,
        operator_id=current_user.id,
        is_cli=get_request_is_cli(request),
    )

    db.commit()
    db.refresh(item)
    _clear_list_cache(item)

    response = serialize_inventory_items(db, [item])[0]
    await sse_manager.broadcast(
        SSERoom.INVENTORY,
        SSEEventType.INVENTORY_UPDATED,
        {"id": inventory_id, "item": response},
        actor_client_id=get_sse_client_id(request),
    )
    if "cas_number" in update_data:
        enqueue_structure_cache_resolution(
            background_tasks,
            item.cas_number,
            reason="inventory.update",
        )
    return response


def _validate_inventory_update_cas(update_data: dict) -> None:
    # 校验并标准化更新载荷中的 CAS，确保写入格式稳定且合法。

    if "cas_number" not in update_data or not update_data["cas_number"]:
        return
    normalized_cas = normalize_cas(update_data["cas_number"])
    is_valid, error_msg = validate_cas_format(normalized_cas)
    if not is_valid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid CAS number: {error_msg}")
    update_data["cas_number"] = normalized_cas


def _apply_inventory_remaining_quantity_update(
    item: Inventory,
    *,
    update_data: dict,
    specification_updated: bool,
) -> None:
    # 处理剩余量与状态联动，保证数量边界和剩余比例语义一致。

    if "remaining_quantity" not in update_data:
        if specification_updated:
            if (
                item.remaining_quantity is not None
                and item.initial_quantity is not None
                and item.remaining_quantity > item.initial_quantity
            ):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        f"Invalid remaining quantity: {item.remaining_quantity} cannot exceed "
                        f"initial quantity {item.initial_quantity}"
                    ),
                )
            item.remaining_percent = _compute_remaining_percent(item.remaining_quantity, item.initial_quantity)
        return

    new_remaining = update_data["remaining_quantity"]
    initial_quantity = item.initial_quantity
    if (
        new_remaining is not None
        and initial_quantity is not None
        and new_remaining > initial_quantity
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Invalid remaining quantity: {new_remaining} cannot exceed "
                f"initial quantity {initial_quantity}"
            ),
        )

    item.remaining_quantity = new_remaining
    item.remaining_percent = _compute_remaining_percent(item.remaining_quantity, item.initial_quantity)
    if new_remaining is None:
        return
    item.status = InventoryStatus.CONSUMED if new_remaining == 0 else InventoryStatus.IN_STOCK


def _apply_inventory_pinyin_updates(item: Inventory, *, update_data: dict) -> None:
    # 在关键展示字段变更后重算拼音索引，保持搜索和排序结果正确。

    if not any(field in update_data for field in ["name", "category", "brand", "storage_location"]):
        return
    pinyin_fields = compute_pinyin_fields(
        name=item.name,
        category=item.category,
        brand=item.brand,
        storage_location=item.storage_location,
    )
    for pinyin_field, pinyin_value in pinyin_fields.items():
        setattr(item, pinyin_field, pinyin_value)


@router.delete("/{inventory_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_inventory(
    inventory_id: int,
    request: Request,
    current_user: Annotated[User, Depends(require_non_public)],
    db: Annotated[Session, Depends(get_db)],
):
    pending_stockin_clause = (
        Inventory.storage_location.is_(None)
        & Inventory.temporary_keeper_id.is_not(None)
    )
    item = exec_delete_returning_first(
        db,
        delete(Inventory)
        .where(Inventory.id == inventory_id)
        .where(Inventory.status != InventoryStatus.BORROWED)
        .where(~pending_stockin_clause),
        Inventory,
    )
    if not item:
        existing = _get_by_id(db, inventory_id)
        if not existing:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=INVENTORY_NOT_FOUND)
        ensure_inventory_deletable(existing)
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Inventory item cannot be deleted")
    log_inventory_delete(
        db,
        inventory=item,
        operator_id=current_user.id,
        is_cli=get_request_is_cli(request),
    )
    db.commit()
    _clear_list_cache(item, is_delete=True)
    await sse_manager.broadcast(
        SSERoom.INVENTORY,
        SSEEventType.INVENTORY_DELETED,
        {"id": inventory_id},
        actor_client_id=get_sse_client_id(request),
    )
