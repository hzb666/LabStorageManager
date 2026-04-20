"""SQLite performance index setup."""
from __future__ import annotations

import logging
import re

from sqlalchemy import Connection, text

logger = logging.getLogger(__name__)

SQLITE_BORROWLOG_INDEX_UPGRADES: tuple[str, ...] = (
    "CREATE INDEX IF NOT EXISTS ix_borrowlog_borrower_borrow_time ON borrowlog (borrower_id, borrow_time DESC)",
    "CREATE INDEX IF NOT EXISTS ix_borrowlog_inventory_borrow_time ON borrowlog (inventory_id, borrow_time DESC)",
)

SQLITE_PERFORMANCE_SEARCH_INDEX_UPGRADES: tuple[str, ...] = (
    # 库存可搜索字段。
    "CREATE INDEX IF NOT EXISTS ix_inventory_cas_number_created_at_id ON inventory (cas_number, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_name_pinyin_created_at_id ON inventory (name_pinyin, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_name_pinyin_initials_created_at_id ON inventory (name_pinyin_initials, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_category_pinyin_created_at_id ON inventory (category_pinyin, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_category_pinyin_initials_created_at_id ON inventory (category_pinyin_initials, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_brand_pinyin_created_at_id ON inventory (brand_pinyin, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_brand_pinyin_initials_created_at_id ON inventory (brand_pinyin_initials, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_storage_location_created_at_id ON inventory (storage_location, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_storage_location_pinyin_created_at_id ON inventory (storage_location_pinyin, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_storage_location_pinyin_initials_created_at_id ON inventory (storage_location_pinyin_initials, created_at DESC, id DESC)",
    # 试剂订单原文与拼音搜索字段。
    "CREATE INDEX IF NOT EXISTS ix_reagent_order_cas_number_created_at_id ON reagent_order (cas_number, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_reagent_order_name_created_at_id ON reagent_order (name, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_reagent_order_category_created_at_id ON reagent_order (category, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_reagent_order_brand_created_at_id ON reagent_order (brand, created_at DESC, id DESC)",
    # 试剂订单拼音搜索字段。
    "CREATE INDEX IF NOT EXISTS ix_reagent_order_name_pinyin_created_at_id ON reagent_order (name_pinyin, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_reagent_order_name_pinyin_initials_created_at_id ON reagent_order (name_pinyin_initials, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_reagent_order_category_pinyin_created_at_id ON reagent_order (category_pinyin, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_reagent_order_category_pinyin_initials_created_at_id ON reagent_order (category_pinyin_initials, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_reagent_order_brand_pinyin_created_at_id ON reagent_order (brand_pinyin, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_reagent_order_brand_pinyin_initials_created_at_id ON reagent_order (brand_pinyin_initials, created_at DESC, id DESC)",
    # 耗材订单原文与拼音搜索字段。
    "CREATE INDEX IF NOT EXISTS ix_consumable_order_name_created_at_id ON consumable_order (name, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_consumable_order_name_pinyin_created_at_id ON consumable_order (name_pinyin, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_consumable_order_name_pinyin_initials_created_at_id ON consumable_order (name_pinyin_initials, created_at DESC, id DESC)",
    # 化学名称映射拼音搜索字段。
    "CREATE INDEX IF NOT EXISTS ix_chemical_name_map_name_pinyin ON chemical_name_map (name_pinyin)",
    "CREATE INDEX IF NOT EXISTS ix_chemical_name_map_name_initials ON chemical_name_map (name_initials)",
    "CREATE INDEX IF NOT EXISTS ix_chemical_name_map_alias_1_pinyin ON chemical_name_map (alias_1_pinyin)",
    "CREATE INDEX IF NOT EXISTS ix_chemical_name_map_alias_1_initials ON chemical_name_map (alias_1_initials)",
    "CREATE INDEX IF NOT EXISTS ix_chemical_name_map_alias_2_pinyin ON chemical_name_map (alias_2_pinyin)",
    "CREATE INDEX IF NOT EXISTS ix_chemical_name_map_alias_2_initials ON chemical_name_map (alias_2_initials)",
    "CREATE INDEX IF NOT EXISTS ix_chemical_name_map_alias_3_pinyin ON chemical_name_map (alias_3_pinyin)",
    "CREATE INDEX IF NOT EXISTS ix_chemical_name_map_alias_3_initials ON chemical_name_map (alias_3_initials)",
)


SQLITE_PERFORMANCE_FILTER_SORT_INDEX_UPGRADES: tuple[str, ...] = (
    # 库存筛选、排序与操作链路。
    "CREATE INDEX IF NOT EXISTS ix_inventory_created_at_id ON inventory (created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_status_created_at_id ON inventory (status, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_remaining_percent_created_at_id ON inventory (remaining_percent DESC, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_borrower_status_updated_at ON inventory (borrower_id, status, updated_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_keeper_location_created_at ON inventory (temporary_keeper_id, storage_location, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_created_by_created_at_id ON inventory (created_by_id, created_at DESC, id DESC)",
    # 库存操作日志审计查询。
    "CREATE INDEX IF NOT EXISTS ix_inventory_operation_log_operator_created_at ON inventory_operation_log (operator_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_operation_log_action_created_at ON inventory_operation_log (action, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_operation_log_created_at ON inventory_operation_log (created_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_operation_log_operator_action_created_at ON inventory_operation_log (operator_id, action, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_operation_log_inventory_created_at ON inventory_operation_log (inventory_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_operation_log_cas_created_at ON inventory_operation_log (cas_number, created_at DESC)",
    # 试剂订单操作日志审计查询。
    "CREATE INDEX IF NOT EXISTS ix_reagent_order_operation_log_actor_created_at ON reagent_order_operation_log (actor_user_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_reagent_order_operation_log_action_created_at ON reagent_order_operation_log (action, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_reagent_order_operation_log_created_at ON reagent_order_operation_log (created_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_reagent_order_operation_log_actor_action_created_at ON reagent_order_operation_log (actor_user_id, action, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_reagent_order_operation_log_order_created_at ON reagent_order_operation_log (order_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_reagent_order_operation_log_applicant_created_at ON reagent_order_operation_log (applicant_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_reagent_order_operation_log_cas_created_at ON reagent_order_operation_log (cas_number, created_at DESC)",
    # 耗材订单操作日志审计查询。
    "CREATE INDEX IF NOT EXISTS ix_consumable_order_operation_log_actor_created_at ON consumable_order_operation_log (actor_user_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_consumable_order_operation_log_action_created_at ON consumable_order_operation_log (action, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_consumable_order_operation_log_created_at ON consumable_order_operation_log (created_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_consumable_order_operation_log_actor_action_created_at ON consumable_order_operation_log (actor_user_id, action, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_consumable_order_operation_log_order_created_at ON consumable_order_operation_log (order_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_consumable_order_operation_log_applicant_created_at ON consumable_order_operation_log (applicant_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_consumable_order_operation_log_name_created_at ON consumable_order_operation_log (order_name, created_at DESC)",
    # 用户操作日志审计查询。
    "CREATE INDEX IF NOT EXISTS ix_user_operation_log_actor_created_at ON user_operation_log (actor_user_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_user_operation_log_target_created_at ON user_operation_log (target_user_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_user_operation_log_action_created_at ON user_operation_log (action, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_user_operation_log_created_at ON user_operation_log (created_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_user_operation_log_actor_action_created_at ON user_operation_log (actor_user_id, action, created_at DESC)",
    # 时间线读模型查询。
    "CREATE INDEX IF NOT EXISTS ix_log_timeline_occurred_at_id ON log_timeline (occurred_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_log_timeline_actor_occurred_at_id ON log_timeline (actor_user_id, occurred_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_log_timeline_subject_occurred_at_id ON log_timeline (subject_user_id, occurred_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_log_timeline_actor_source_table_occurred_at_id ON log_timeline (actor_user_id, source_table, occurred_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_log_timeline_subject_source_table_occurred_at_id ON log_timeline (subject_user_id, source_table, occurred_at DESC, id DESC)",
    "CREATE UNIQUE INDEX IF NOT EXISTS ux_log_timeline_source_table_source_log_id ON log_timeline (source_table, source_log_id)",
    # 借用日志操作查询。
    *SQLITE_BORROWLOG_INDEX_UPGRADES,
    # 试剂/耗材列表的状态与申请人筛选。
    "CREATE INDEX IF NOT EXISTS ix_reagent_order_created_at_id ON reagent_order (created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_reagent_order_status_created_at_id ON reagent_order (status, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_reagent_order_applicant_created_at_id ON reagent_order (applicant_id, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_consumable_order_created_at_id ON consumable_order (created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_consumable_order_status_created_at_id ON consumable_order (status, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_consumable_order_applicant_created_at_id ON consumable_order (applicant_id, created_at DESC, id DESC)",
    # 其他模块。
    "CREATE INDEX IF NOT EXISTS ix_announcements_pinned_created ON announcements (is_pinned DESC, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_announcements_visible_pinned_created ON announcements (is_visible, is_pinned DESC, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_announcements_creator_visible ON announcements (created_by, is_visible)",
    "CREATE INDEX IF NOT EXISTS ix_users_active_role_created ON users (is_active DESC, role DESC, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_users_role_created_at ON users (role, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_users_full_name_pinyin_id ON users (full_name_pinyin, id)",
    # 常用货架筛选与分组。
    "CREATE INDEX IF NOT EXISTS ix_common_shelf_cas_created_at ON common_shelf (cas_number, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_common_shelf_group_created_at ON common_shelf (cas_number, brand_normalized, specification_normalized, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_common_shelf_group_location_created_at ON common_shelf (cas_number, brand_normalized, specification_normalized, storage_location_normalized, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_common_shelf_group_location_pinyin_created_at ON common_shelf (cas_number, brand_normalized, specification_normalized, storage_location_pinyin, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_common_shelf_group_location_pinyin_initials_created_at ON common_shelf (cas_number, brand_normalized, specification_normalized, storage_location_pinyin_initials, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_common_shelf_source_order_created_at ON common_shelf (source_order_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_common_shelf_creator_created_at ON common_shelf (created_by_id, created_at DESC)",
    "CREATE UNIQUE INDEX IF NOT EXISTS ux_common_shelf_group_active_identity ON common_shelf_group (cas_number, brand_normalized, specification_normalized) WHERE is_deleted = 0",
    "CREATE INDEX IF NOT EXISTS ix_common_shelf_group_active_updated_at ON common_shelf_group (is_deleted, updated_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_common_shelf_group_active_cas ON common_shelf_group (is_deleted, cas_number, updated_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_common_shelf_group_identity ON common_shelf_group (cas_number, brand_normalized, specification_normalized)",
    # 化学名称映射筛选。
    "CREATE INDEX IF NOT EXISTS ix_chemical_name_map_category ON chemical_name_map (category)",
    # 常用货架操作日志审计查询。
    "CREATE INDEX IF NOT EXISTS ix_common_shelf_operation_log_operator_created_at ON common_shelf_operation_log (operator_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_common_shelf_operation_log_action_created_at ON common_shelf_operation_log (action, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_common_shelf_operation_log_created_at ON common_shelf_operation_log (created_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_common_shelf_operation_log_operator_action_created_at ON common_shelf_operation_log (operator_id, action, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_common_shelf_operation_log_shelf_created_at ON common_shelf_operation_log (common_shelf_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_common_shelf_operation_log_cas_created_at ON common_shelf_operation_log (cas_number, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_user_sessions_user_last_active ON user_sessions (user_id, last_active_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_user_sessions_user_device ON user_sessions (user_id, device_id)",
    "CREATE INDEX IF NOT EXISTS ix_user_sessions_user_expires ON user_sessions (user_id, expires_at)",
    "CREATE INDEX IF NOT EXISTS ix_user_sessions_user_ip ON user_sessions (user_id, ip_address)",
    "CREATE INDEX IF NOT EXISTS ix_user_sessions_expires_at ON user_sessions (expires_at)",
)


SQLITE_PERFORMANCE_INDEX_UPGRADES: tuple[str, ...] = (
    SQLITE_PERFORMANCE_SEARCH_INDEX_UPGRADES
    + SQLITE_PERFORMANCE_FILTER_SORT_INDEX_UPGRADES
)

def _extract_index_name_from_create_statement(statement: str) -> str | None:
    match = re.search(
        r"CREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+([A-Za-z0-9_]+)",
        statement,
        flags=re.IGNORECASE,
    )
    return match.group(1) if match else None


def _normalize_index_ddl(statement: str) -> str:
    normalized = re.sub(r"\s+", " ", statement.strip())
    normalized = re.sub(r"\s+IF\s+NOT\s+EXISTS\s+", " ", normalized, flags=re.IGNORECASE)
    return normalized.lower()


def _drop_sqlite_index_if_exists(connection: Connection, index_name: str) -> None:
    safe_name = index_name.replace('"', '""')
    connection.execute(text(f'DROP INDEX IF EXISTS "{safe_name}"'))


def _ensure_sqlite_index_statement(connection: Connection, create_statement: str) -> bool:
    index_name = _extract_index_name_from_create_statement(create_statement)
    if not index_name:
        connection.execute(text(create_statement))
        return False

    existing_sql_row = connection.execute(
        text(
            "SELECT sql FROM sqlite_master "
            "WHERE type='index' AND name=:index_name"
        ),
        {"index_name": index_name},
    ).first()
    if existing_sql_row and existing_sql_row[0]:
        existing_sql = str(existing_sql_row[0])
        if _normalize_index_ddl(existing_sql) != _normalize_index_ddl(create_statement):
            _drop_sqlite_index_if_exists(connection, index_name)
            connection.execute(text(create_statement))
            return True

    connection.execute(text(create_statement))
    return False

def ensure_sqlite_performance_indexes(connection: Connection) -> None:
    rebuilt_indexes = 0
    for statement in SQLITE_PERFORMANCE_INDEX_UPGRADES:
        if _ensure_sqlite_index_statement(connection, statement):
            rebuilt_indexes += 1

    if rebuilt_indexes > 0:
        logger.warning(
            "Rebuilt %d SQLite indexes to match expected DDL definitions.",
            rebuilt_indexes,
        )

    # 建索引后立刻刷新统计信息，避免查询计划继续沿用旧分布。
    connection.execute(text("ANALYZE"))
    connection.execute(text("PRAGMA optimize"))
