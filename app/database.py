# SQLModel 引擎与 SQLite 初始化。
import logging
import os
import re
from dataclasses import dataclass
from typing import Annotated, Generator

from sqlalchemy import Connection, event, inspect, text
from sqlmodel import SQLModel, Session, create_engine, select
from fastapi import Depends

from app.services import pinyin_utils
from app.models.user import User, UserRole

logger = logging.getLogger(__name__)

SQLITE_BORROWLOG_INDEX_UPGRADES: tuple[str, ...] = (
    "CREATE INDEX IF NOT EXISTS ix_borrowlog_borrower_borrow_time ON borrowlog (borrower_id, borrow_time DESC)",
    "CREATE INDEX IF NOT EXISTS ix_borrowlog_inventory_borrow_time ON borrowlog (inventory_id, borrow_time DESC)",
)

# 确保数据库文件目录存在。
data_dir = os.path.dirname(os.path.dirname(__file__))
db_path = os.path.join(data_dir, "lab_inventory.db")

sqlite_url = f"sqlite:///{db_path}"

# SQLite 仍使用单文件库，但必须开启 WAL 才能承受并发读写。
engine = create_engine(
    sqlite_url,
    echo=False,
    connect_args={"check_same_thread": False},
)


@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    # 每个新连接都显式打开 WAL 和外键校验，避免驱动默认值漂移。
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL;")
    cursor.execute("PRAGMA foreign_keys=ON;")
    cursor.execute("PRAGMA synchronous=NORMAL;")
    cursor.execute("PRAGMA busy_timeout=1000;")
    cursor.close()


def get_db() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session


# 路由层统一用这个别名拿 DB session。
DBSession = Annotated[Session, Depends(get_db)]


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
    "CREATE INDEX IF NOT EXISTS ix_log_timeline_log_type_occurred_at_id ON log_timeline (log_type, occurred_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_log_timeline_actor_occurred_at_id ON log_timeline (actor_user_id, occurred_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_log_timeline_subject_occurred_at_id ON log_timeline (subject_user_id, occurred_at DESC, id DESC)",
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
    "CREATE INDEX IF NOT EXISTS ix_common_shelf_source_order_created_at ON common_shelf (source_order_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_common_shelf_creator_created_at ON common_shelf (created_by_id, created_at DESC)",
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

SQLITE_INVENTORY_OPERATION_LOG_INDEX_UPGRADES: tuple[str, ...] = (
    "CREATE INDEX IF NOT EXISTS ix_inventory_operation_log_operator_created_at ON inventory_operation_log (operator_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_operation_log_action_created_at ON inventory_operation_log (action, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_operation_log_operator_action_created_at ON inventory_operation_log (operator_id, action, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_operation_log_inventory_created_at ON inventory_operation_log (inventory_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_operation_log_cas_created_at ON inventory_operation_log (cas_number, created_at DESC)",
)

SQLITE_INVENTORY_FTS_SETUP: tuple[str, ...] = (
    """
    CREATE VIRTUAL TABLE IF NOT EXISTS inventory_fts USING fts5(
        cas_number,
        name,
        name_pinyin,
        name_pinyin_initials,
        alias,
        category,
        category_pinyin,
        category_pinyin_initials,
        brand,
        brand_pinyin,
        brand_pinyin_initials,
        storage_location,
        storage_location_pinyin,
        storage_location_pinyin_initials,
        tokenize='trigram'
    )
    """,
    """
    CREATE TRIGGER IF NOT EXISTS trg_inventory_fts_ai
    AFTER INSERT ON inventory
    BEGIN
        INSERT INTO inventory_fts(
            rowid,
            cas_number,
            name,
            name_pinyin,
            name_pinyin_initials,
            alias,
            category,
            category_pinyin,
            category_pinyin_initials,
            brand,
            brand_pinyin,
            brand_pinyin_initials,
            storage_location,
            storage_location_pinyin,
            storage_location_pinyin_initials
        )
        VALUES (
            NEW.id,
            NEW.cas_number,
            NEW.name,
            NEW.name_pinyin,
            NEW.name_pinyin_initials,
            NEW.alias,
            NEW.category,
            NEW.category_pinyin,
            NEW.category_pinyin_initials,
            NEW.brand,
            NEW.brand_pinyin,
            NEW.brand_pinyin_initials,
            NEW.storage_location,
            NEW.storage_location_pinyin,
            NEW.storage_location_pinyin_initials
        );
    END
    """,
    """
    CREATE TRIGGER IF NOT EXISTS trg_inventory_fts_ad
    AFTER DELETE ON inventory
    BEGIN
        DELETE FROM inventory_fts WHERE rowid = OLD.id;
    END
    """,
    """
    CREATE TRIGGER IF NOT EXISTS trg_inventory_fts_au
    AFTER UPDATE ON inventory
    BEGIN
        DELETE FROM inventory_fts WHERE rowid = OLD.id;
        INSERT INTO inventory_fts(
            rowid,
            cas_number,
            name,
            name_pinyin,
            name_pinyin_initials,
            alias,
            category,
            category_pinyin,
            category_pinyin_initials,
            brand,
            brand_pinyin,
            brand_pinyin_initials,
            storage_location,
            storage_location_pinyin,
            storage_location_pinyin_initials
        )
        VALUES (
            NEW.id,
            NEW.cas_number,
            NEW.name,
            NEW.name_pinyin,
            NEW.name_pinyin_initials,
            NEW.alias,
            NEW.category,
            NEW.category_pinyin,
            NEW.category_pinyin_initials,
            NEW.brand,
            NEW.brand_pinyin,
            NEW.brand_pinyin_initials,
            NEW.storage_location,
            NEW.storage_location_pinyin,
            NEW.storage_location_pinyin_initials
        );
    END
    """,
)

SQLITE_INVENTORY_FTS_REBUILD_SQL = """
INSERT INTO inventory_fts(
    rowid,
    cas_number,
    name,
    name_pinyin,
    name_pinyin_initials,
    alias,
    category,
    category_pinyin,
    category_pinyin_initials,
    brand,
    brand_pinyin,
    brand_pinyin_initials,
    storage_location,
    storage_location_pinyin,
    storage_location_pinyin_initials
)
SELECT
    id,
    cas_number,
    name,
    name_pinyin,
    name_pinyin_initials,
    alias,
    category,
    category_pinyin,
    category_pinyin_initials,
    brand,
    brand_pinyin,
    brand_pinyin_initials,
    storage_location,
    storage_location_pinyin,
    storage_location_pinyin_initials
FROM inventory
"""

SQLITE_REAGENT_ORDER_FTS_SETUP: tuple[str, ...] = (
    """
    CREATE VIRTUAL TABLE IF NOT EXISTS reagent_order_fts USING fts5(
        cas_number,
        name,
        name_pinyin,
        name_pinyin_initials,
        category,
        category_pinyin,
        category_pinyin_initials,
        brand,
        brand_pinyin,
        brand_pinyin_initials,
        tokenize='trigram'
    )
    """,
    """
    CREATE TRIGGER IF NOT EXISTS trg_reagent_order_fts_ai
    AFTER INSERT ON reagent_order
    BEGIN
        INSERT INTO reagent_order_fts(
            rowid,
            cas_number,
            name,
            name_pinyin,
            name_pinyin_initials,
            category,
            category_pinyin,
            category_pinyin_initials,
            brand,
            brand_pinyin,
            brand_pinyin_initials
        )
        VALUES (
            NEW.id,
            NEW.cas_number,
            NEW.name,
            NEW.name_pinyin,
            NEW.name_pinyin_initials,
            NEW.category,
            NEW.category_pinyin,
            NEW.category_pinyin_initials,
            NEW.brand,
            NEW.brand_pinyin,
            NEW.brand_pinyin_initials
        );
    END
    """,
    """
    CREATE TRIGGER IF NOT EXISTS trg_reagent_order_fts_ad
    AFTER DELETE ON reagent_order
    BEGIN
        DELETE FROM reagent_order_fts WHERE rowid = OLD.id;
    END
    """,
    """
    CREATE TRIGGER IF NOT EXISTS trg_reagent_order_fts_au
    AFTER UPDATE ON reagent_order
    BEGIN
        DELETE FROM reagent_order_fts WHERE rowid = OLD.id;
        INSERT INTO reagent_order_fts(
            rowid,
            cas_number,
            name,
            name_pinyin,
            name_pinyin_initials,
            category,
            category_pinyin,
            category_pinyin_initials,
            brand,
            brand_pinyin,
            brand_pinyin_initials
        )
        VALUES (
            NEW.id,
            NEW.cas_number,
            NEW.name,
            NEW.name_pinyin,
            NEW.name_pinyin_initials,
            NEW.category,
            NEW.category_pinyin,
            NEW.category_pinyin_initials,
            NEW.brand,
            NEW.brand_pinyin,
            NEW.brand_pinyin_initials
        );
    END
    """,
)

SQLITE_REAGENT_ORDER_FTS_REBUILD_SQL = """
INSERT INTO reagent_order_fts(
    rowid,
    cas_number,
    name,
    name_pinyin,
    name_pinyin_initials,
    category,
    category_pinyin,
    category_pinyin_initials,
    brand,
    brand_pinyin,
    brand_pinyin_initials
)
SELECT
    id,
    cas_number,
    name,
    name_pinyin,
    name_pinyin_initials,
    category,
    category_pinyin,
    category_pinyin_initials,
    brand,
    brand_pinyin,
    brand_pinyin_initials
FROM reagent_order
"""

SQLITE_CONSUMABLE_ORDER_FTS_SETUP: tuple[str, ...] = (
    """
    CREATE VIRTUAL TABLE IF NOT EXISTS consumable_order_fts USING fts5(
        name,
        name_pinyin,
        name_pinyin_initials,
        specification,
        communication,
        tokenize='trigram'
    )
    """,
    """
    CREATE TRIGGER IF NOT EXISTS trg_consumable_order_fts_ai
    AFTER INSERT ON consumable_order
    BEGIN
        INSERT INTO consumable_order_fts(
            rowid,
            name,
            name_pinyin,
            name_pinyin_initials,
            specification,
            communication
        )
        VALUES (
            NEW.id,
            NEW.name,
            NEW.name_pinyin,
            NEW.name_pinyin_initials,
            NEW.specification,
            NEW.communication
        );
    END
    """,
    """
    CREATE TRIGGER IF NOT EXISTS trg_consumable_order_fts_ad
    AFTER DELETE ON consumable_order
    BEGIN
        DELETE FROM consumable_order_fts WHERE rowid = OLD.id;
    END
    """,
    """
    CREATE TRIGGER IF NOT EXISTS trg_consumable_order_fts_au
    AFTER UPDATE ON consumable_order
    BEGIN
        DELETE FROM consumable_order_fts WHERE rowid = OLD.id;
        INSERT INTO consumable_order_fts(
            rowid,
            name,
            name_pinyin,
            name_pinyin_initials,
            specification,
            communication
        )
        VALUES (
            NEW.id,
            NEW.name,
            NEW.name_pinyin,
            NEW.name_pinyin_initials,
            NEW.specification,
            NEW.communication
        );
    END
    """,
)

SQLITE_CONSUMABLE_ORDER_FTS_REBUILD_SQL = """
INSERT INTO consumable_order_fts(
    rowid,
    name,
    name_pinyin,
    name_pinyin_initials,
    specification,
    communication
)
SELECT
    id,
    name,
    name_pinyin,
    name_pinyin_initials,
    specification,
    communication
FROM consumable_order
"""

SQLITE_USERS_FTS_SETUP: tuple[str, ...] = (
    """
    CREATE VIRTUAL TABLE IF NOT EXISTS users_fts USING fts5(
        full_name,
        full_name_pinyin,
        full_name_pinyin_initials,
        tokenize='trigram'
    )
    """,
    """
    CREATE TRIGGER IF NOT EXISTS trg_users_fts_ai
    AFTER INSERT ON users
    BEGIN
        INSERT INTO users_fts(
            rowid,
            full_name,
            full_name_pinyin,
            full_name_pinyin_initials
        )
        VALUES (
            NEW.id,
            NEW.full_name,
            NEW.full_name_pinyin,
            NEW.full_name_pinyin_initials
        );
    END
    """,
    """
    CREATE TRIGGER IF NOT EXISTS trg_users_fts_ad
    AFTER DELETE ON users
    BEGIN
        DELETE FROM users_fts WHERE rowid = OLD.id;
    END
    """,
    """
    CREATE TRIGGER IF NOT EXISTS trg_users_fts_au
    AFTER UPDATE ON users
    BEGIN
        DELETE FROM users_fts WHERE rowid = OLD.id;
        INSERT INTO users_fts(
            rowid,
            full_name,
            full_name_pinyin,
            full_name_pinyin_initials
        )
        VALUES (
            NEW.id,
            NEW.full_name,
            NEW.full_name_pinyin,
            NEW.full_name_pinyin_initials
        );
    END
    """,
)

SQLITE_USERS_FTS_REBUILD_SQL = """
INSERT INTO users_fts(
    rowid,
    full_name,
    full_name_pinyin,
    full_name_pinyin_initials
)
SELECT
    id,
    full_name,
    full_name_pinyin,
    full_name_pinyin_initials
FROM users
"""

SQLITE_CHEMICAL_NAME_MAP_FTS_SETUP: tuple[str, ...] = (
    """
    CREATE VIRTUAL TABLE IF NOT EXISTS chemical_name_map_fts USING fts5(
        cas_number,
        name,
        english_name,
        alias_1,
        alias_2,
        alias_3,
        name_pinyin,
        name_initials,
        alias_1_pinyin,
        alias_1_initials,
        alias_2_pinyin,
        alias_2_initials,
        alias_3_pinyin,
        alias_3_initials,
        tokenize='trigram'
    )
    """,
    """
    CREATE TRIGGER IF NOT EXISTS trg_chemical_name_map_fts_ai
    AFTER INSERT ON chemical_name_map
    BEGIN
        INSERT INTO chemical_name_map_fts(
            rowid,
            cas_number,
            name,
            english_name,
            alias_1,
            alias_2,
            alias_3,
            name_pinyin,
            name_initials,
            alias_1_pinyin,
            alias_1_initials,
            alias_2_pinyin,
            alias_2_initials,
            alias_3_pinyin,
            alias_3_initials
        )
        VALUES (
            NEW.id,
            NEW.cas_number,
            NEW.name,
            NEW.english_name,
            NEW.alias_1,
            NEW.alias_2,
            NEW.alias_3,
            NEW.name_pinyin,
            NEW.name_initials,
            NEW.alias_1_pinyin,
            NEW.alias_1_initials,
            NEW.alias_2_pinyin,
            NEW.alias_2_initials,
            NEW.alias_3_pinyin,
            NEW.alias_3_initials
        );
    END
    """,
    """
    CREATE TRIGGER IF NOT EXISTS trg_chemical_name_map_fts_ad
    AFTER DELETE ON chemical_name_map
    BEGIN
        DELETE FROM chemical_name_map_fts WHERE rowid = OLD.id;
    END
    """,
    """
    CREATE TRIGGER IF NOT EXISTS trg_chemical_name_map_fts_au
    AFTER UPDATE ON chemical_name_map
    BEGIN
        DELETE FROM chemical_name_map_fts WHERE rowid = OLD.id;
        INSERT INTO chemical_name_map_fts(
            rowid,
            cas_number,
            name,
            english_name,
            alias_1,
            alias_2,
            alias_3,
            name_pinyin,
            name_initials,
            alias_1_pinyin,
            alias_1_initials,
            alias_2_pinyin,
            alias_2_initials,
            alias_3_pinyin,
            alias_3_initials
        )
        VALUES (
            NEW.id,
            NEW.cas_number,
            NEW.name,
            NEW.english_name,
            NEW.alias_1,
            NEW.alias_2,
            NEW.alias_3,
            NEW.name_pinyin,
            NEW.name_initials,
            NEW.alias_1_pinyin,
            NEW.alias_1_initials,
            NEW.alias_2_pinyin,
            NEW.alias_2_initials,
            NEW.alias_3_pinyin,
            NEW.alias_3_initials
        );
    END
    """,
)

SQLITE_CHEMICAL_NAME_MAP_FTS_REBUILD_SQL = """
INSERT INTO chemical_name_map_fts(
    rowid,
    cas_number,
    name,
    english_name,
    alias_1,
    alias_2,
    alias_3,
    name_pinyin,
    name_initials,
    alias_1_pinyin,
    alias_1_initials,
    alias_2_pinyin,
    alias_2_initials,
    alias_3_pinyin,
    alias_3_initials
)
SELECT
    id,
    cas_number,
    name,
    english_name,
    alias_1,
    alias_2,
    alias_3,
    name_pinyin,
    name_initials,
    alias_1_pinyin,
    alias_1_initials,
    alias_2_pinyin,
    alias_2_initials,
    alias_3_pinyin,
    alias_3_initials
FROM chemical_name_map
"""

SQLITE_LOG_TIMELINE_FTS_SETUP: tuple[str, ...] = (
    """
    CREATE VIRTUAL TABLE IF NOT EXISTS log_timeline_fts USING fts5(
        search_text,
        search_text_pinyin,
        tokenize='trigram'
    )
    """,
    """
    CREATE TRIGGER IF NOT EXISTS trg_log_timeline_fts_ai
    AFTER INSERT ON log_timeline
    BEGIN
        INSERT INTO log_timeline_fts(
            rowid,
            search_text,
            search_text_pinyin
        )
        VALUES (
            NEW.id,
            NEW.search_text,
            NEW.search_text_pinyin
        );
    END
    """,
    """
    CREATE TRIGGER IF NOT EXISTS trg_log_timeline_fts_ad
    AFTER DELETE ON log_timeline
    BEGIN
        DELETE FROM log_timeline_fts WHERE rowid = OLD.id;
    END
    """,
    """
    CREATE TRIGGER IF NOT EXISTS trg_log_timeline_fts_au
    AFTER UPDATE ON log_timeline
    BEGIN
        DELETE FROM log_timeline_fts WHERE rowid = OLD.id;
        INSERT INTO log_timeline_fts(
            rowid,
            search_text,
            search_text_pinyin
        )
        VALUES (
            NEW.id,
            NEW.search_text,
            NEW.search_text_pinyin
        );
    END
    """,
)

SQLITE_LOG_TIMELINE_FTS_REBUILD_SQL = """
INSERT INTO log_timeline_fts(
    rowid,
    search_text,
    search_text_pinyin
)
SELECT
    id,
    search_text,
    search_text_pinyin
FROM log_timeline
"""

SQLITE_SAFE_COUNT_STATEMENTS: dict[str, str] = {
    "inventory": "SELECT COUNT(*) FROM inventory",
    "inventory_operation_log": "SELECT COUNT(*) FROM inventory_operation_log",
    "reagent_order": "SELECT COUNT(*) FROM reagent_order",
    "consumable_order": "SELECT COUNT(*) FROM consumable_order",
    "users": "SELECT COUNT(*) FROM users",
    "chemical_name_map": "SELECT COUNT(*) FROM chemical_name_map",
    "log_timeline": "SELECT COUNT(*) FROM log_timeline",
    "inventory_fts": "SELECT COUNT(*) FROM inventory_fts",
    "reagent_order_fts": "SELECT COUNT(*) FROM reagent_order_fts",
    "consumable_order_fts": "SELECT COUNT(*) FROM consumable_order_fts",
    "users_fts": "SELECT COUNT(*) FROM users_fts",
    "chemical_name_map_fts": "SELECT COUNT(*) FROM chemical_name_map_fts",
    "log_timeline_fts": "SELECT COUNT(*) FROM log_timeline_fts",
}

SQLITE_SAFE_DELETE_STATEMENTS: dict[str, str] = {
    "inventory_fts": "DELETE FROM inventory_fts",
    "reagent_order_fts": "DELETE FROM reagent_order_fts",
    "consumable_order_fts": "DELETE FROM consumable_order_fts",
    "users_fts": "DELETE FROM users_fts",
    "chemical_name_map_fts": "DELETE FROM chemical_name_map_fts",
    "log_timeline_fts": "DELETE FROM log_timeline_fts",
}

SQLITE_SAFE_DROP_TRIGGER_STATEMENTS: dict[str, str] = {
    "trg_inventory_fts_ai": "DROP TRIGGER IF EXISTS trg_inventory_fts_ai",
    "trg_inventory_fts_ad": "DROP TRIGGER IF EXISTS trg_inventory_fts_ad",
    "trg_inventory_fts_au": "DROP TRIGGER IF EXISTS trg_inventory_fts_au",
    "trg_reagent_order_fts_ai": "DROP TRIGGER IF EXISTS trg_reagent_order_fts_ai",
    "trg_reagent_order_fts_ad": "DROP TRIGGER IF EXISTS trg_reagent_order_fts_ad",
    "trg_reagent_order_fts_au": "DROP TRIGGER IF EXISTS trg_reagent_order_fts_au",
    "trg_consumable_order_fts_ai": "DROP TRIGGER IF EXISTS trg_consumable_order_fts_ai",
    "trg_consumable_order_fts_ad": "DROP TRIGGER IF EXISTS trg_consumable_order_fts_ad",
    "trg_consumable_order_fts_au": "DROP TRIGGER IF EXISTS trg_consumable_order_fts_au",
    "trg_users_fts_ai": "DROP TRIGGER IF EXISTS trg_users_fts_ai",
    "trg_users_fts_ad": "DROP TRIGGER IF EXISTS trg_users_fts_ad",
    "trg_users_fts_au": "DROP TRIGGER IF EXISTS trg_users_fts_au",
    "trg_chemical_name_map_fts_ai": "DROP TRIGGER IF EXISTS trg_chemical_name_map_fts_ai",
    "trg_chemical_name_map_fts_ad": "DROP TRIGGER IF EXISTS trg_chemical_name_map_fts_ad",
    "trg_chemical_name_map_fts_au": "DROP TRIGGER IF EXISTS trg_chemical_name_map_fts_au",
    "trg_log_timeline_fts_ai": "DROP TRIGGER IF EXISTS trg_log_timeline_fts_ai",
    "trg_log_timeline_fts_ad": "DROP TRIGGER IF EXISTS trg_log_timeline_fts_ad",
    "trg_log_timeline_fts_au": "DROP TRIGGER IF EXISTS trg_log_timeline_fts_au",
}

@dataclass(frozen=True)
class SQLiteFTSTableConfig:
    source_table: str
    fts_table: str
    setup_statements: tuple[str, ...]
    rebuild_sql: str
    trigger_names: tuple[str, str, str]
    auto_rebuild: bool = True


def _get_safe_count_statement(table_name: str) -> str:
    statement = SQLITE_SAFE_COUNT_STATEMENTS.get(table_name)
    if statement is None:
        raise ValueError(f"Unsupported table for count query: {table_name}")
    return statement


def _get_safe_delete_statement(table_name: str) -> str:
    statement = SQLITE_SAFE_DELETE_STATEMENTS.get(table_name)
    if statement is None:
        raise ValueError(f"Unsupported table for delete query: {table_name}")
    return statement


def _get_safe_drop_trigger_statement(trigger_name: str) -> str:
    statement = SQLITE_SAFE_DROP_TRIGGER_STATEMENTS.get(trigger_name)
    if statement is None:
        raise ValueError(f"Unsupported trigger for drop query: {trigger_name}")
    return statement


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


def check_sqlite_schema_consistency(connection: Connection) -> None:
    inspector = inspect(connection)
    metadata = SQLModel.metadata

    mismatch_messages: list[str] = []

    for table_name, table in metadata.tables.items():
        if not inspector.has_table(table_name):
            mismatch_messages.append(f"table {table_name} is missing in database")
            continue

        db_columns = {column["name"] for column in inspector.get_columns(table_name)}
        model_columns = {column.name for column in table.columns}

        missing_columns = sorted(model_columns - db_columns)
        extra_columns = sorted(db_columns - model_columns)
        if missing_columns:
            mismatch_messages.append(
                f"table {table_name} missing columns: {', '.join(missing_columns)}"
            )
        if extra_columns:
            mismatch_messages.append(
                f"table {table_name} has extra columns: {', '.join(extra_columns)}"
            )

        expected_indexes = {
            index.name: [column.name for column in index.columns]
            for index in table.indexes
            if index.name
        }
        actual_indexes = {
            index["name"]: index.get("column_names") or []
            for index in inspector.get_indexes(table_name)
            if index.get("name")
        }

        missing_indexes = sorted(set(expected_indexes) - set(actual_indexes))
        extra_indexes = sorted(
            index_name
            for index_name in (set(actual_indexes) - set(expected_indexes))
            if not index_name.startswith("sqlite_autoindex_")
        )
        if missing_indexes:
            mismatch_messages.append(
                f"table {table_name} missing indexes: {', '.join(missing_indexes)}"
            )
        if extra_indexes:
            mismatch_messages.append(
                f"table {table_name} has extra indexes: {', '.join(extra_indexes)}"
            )

        common_indexes = sorted(set(expected_indexes) & set(actual_indexes))
        for index_name in common_indexes:
            expected_columns = expected_indexes[index_name]
            actual_columns = actual_indexes[index_name]
            if expected_columns != actual_columns:
                mismatch_messages.append(
                    f"table {table_name} index {index_name} column mismatch: "
                    f"model={expected_columns}, db={actual_columns}"
                )

    if mismatch_messages:
        logger.warning(
            "SQLite schema consistency check found mismatches (%d): %s. "
            "Manual migration is required.",
            len(mismatch_messages),
            " | ".join(mismatch_messages),
        )
    else:
        logger.info("SQLite schema consistency check passed for all SQLModel tables.")


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


def _ensure_sqlite_fts_table(
    connection: Connection,
    *,
    config: SQLiteFTSTableConfig,
) -> None:
    table_exists = connection.execute(
        text(
            "SELECT 1 FROM sqlite_master "
            "WHERE type='table' AND name=:table_name"
        ),
        {"table_name": config.fts_table},
    ).first() is not None

    for trigger_name in config.trigger_names:
        drop_statement = _get_safe_drop_trigger_statement(trigger_name)
        connection.execute(text(drop_statement))

    for statement in config.setup_statements:
        connection.execute(text(statement))

    if not config.auto_rebuild:
        return

    source_count_statement = _get_safe_count_statement(config.source_table)
    fts_count_statement = _get_safe_count_statement(config.fts_table)
    source_count = connection.execute(text(source_count_statement)).scalar_one()
    fts_count = connection.execute(text(fts_count_statement)).scalar_one()
    needs_rebuild = (not table_exists) or (source_count != fts_count)
    if not needs_rebuild:
        return

    delete_statement = _get_safe_delete_statement(config.fts_table)
    connection.execute(text(delete_statement))
    connection.execute(text(config.rebuild_sql))
    fts_count_after = connection.execute(text(fts_count_statement)).scalar_one()
    logger.info(
        "Rebuilt %s data (%s rows=%s, fts rows before=%s, after=%s)",
        config.fts_table,
        config.source_table,
        source_count,
        fts_count,
        fts_count_after,
    )


def ensure_sqlite_inventory_fts(connection: Connection) -> None:
    try:
        _ensure_sqlite_fts_table(
            connection,
            config=SQLiteFTSTableConfig(
                source_table="inventory",
                fts_table="inventory_fts",
                setup_statements=SQLITE_INVENTORY_FTS_SETUP,
                rebuild_sql=SQLITE_INVENTORY_FTS_REBUILD_SQL,
                trigger_names=(
                    "trg_inventory_fts_ai",
                    "trg_inventory_fts_ad",
                    "trg_inventory_fts_au",
                ),
            ),
        )
        _ensure_sqlite_fts_table(
            connection,
            config=SQLiteFTSTableConfig(
                source_table="reagent_order",
                fts_table="reagent_order_fts",
                setup_statements=SQLITE_REAGENT_ORDER_FTS_SETUP,
                rebuild_sql=SQLITE_REAGENT_ORDER_FTS_REBUILD_SQL,
                trigger_names=(
                    "trg_reagent_order_fts_ai",
                    "trg_reagent_order_fts_ad",
                    "trg_reagent_order_fts_au",
                ),
            ),
        )
        _ensure_sqlite_fts_table(
            connection,
            config=SQLiteFTSTableConfig(
                source_table="consumable_order",
                fts_table="consumable_order_fts",
                setup_statements=SQLITE_CONSUMABLE_ORDER_FTS_SETUP,
                rebuild_sql=SQLITE_CONSUMABLE_ORDER_FTS_REBUILD_SQL,
                trigger_names=(
                    "trg_consumable_order_fts_ai",
                    "trg_consumable_order_fts_ad",
                    "trg_consumable_order_fts_au",
                ),
            ),
        )
        _ensure_sqlite_fts_table(
            connection,
            config=SQLiteFTSTableConfig(
                source_table="users",
                fts_table="users_fts",
                setup_statements=SQLITE_USERS_FTS_SETUP,
                rebuild_sql=SQLITE_USERS_FTS_REBUILD_SQL,
                trigger_names=(
                    "trg_users_fts_ai",
                    "trg_users_fts_ad",
                    "trg_users_fts_au",
                ),
            ),
        )
        _ensure_sqlite_fts_table(
            connection,
            config=SQLiteFTSTableConfig(
                source_table="chemical_name_map",
                fts_table="chemical_name_map_fts",
                setup_statements=SQLITE_CHEMICAL_NAME_MAP_FTS_SETUP,
                rebuild_sql=SQLITE_CHEMICAL_NAME_MAP_FTS_REBUILD_SQL,
                trigger_names=(
                    "trg_chemical_name_map_fts_ai",
                    "trg_chemical_name_map_fts_ad",
                    "trg_chemical_name_map_fts_au",
                ),
            ),
        )
        _ensure_sqlite_fts_table(
            connection,
            config=SQLiteFTSTableConfig(
                source_table="log_timeline",
                fts_table="log_timeline_fts",
                setup_statements=SQLITE_LOG_TIMELINE_FTS_SETUP,
                rebuild_sql=SQLITE_LOG_TIMELINE_FTS_REBUILD_SQL,
                trigger_names=(
                    "trg_log_timeline_fts_ai",
                    "trg_log_timeline_fts_ad",
                    "trg_log_timeline_fts_au",
                ),
                auto_rebuild=False,
            ),
        )
    except Exception as exc:  # noqa: BLE001
        logger.error(
            "CRITICAL: SQLite FTS initialization failed: %s. "
            "Search functionality may be degraded or unavailable.",
            exc,
        )
        raise RuntimeError("SQLite FTS initialization failed") from exc


def init_db() -> None:
    # create_all 前先导入模型，避免新字段漏进初始化库。
    import app.models  # noqa: F401

    SQLModel.metadata.create_all(engine)
    logger.info("Database tables created / verified")

    with engine.begin() as connection:
        ensure_sqlite_performance_indexes(connection)
        ensure_sqlite_inventory_fts(connection)
        check_sqlite_schema_consistency(connection)

    _create_default_admin()


def _create_default_admin() -> None:
    from app.core.auth import get_password_hash
    from app.core.config import get_settings
    
    settings = get_settings()
    
    default_username = settings.default_admin_username
    default_password = settings.default_admin_password
    default_full_name = settings.default_admin_full_name
    
    if not default_password:
        raise ValueError(
            "DEFAULT_ADMIN_PASSWORD must be set. "
            "Set in .env for production or .env.local for development."
        )
    
    with Session(engine) as session:
        statement = select(User).where(User.role == UserRole.ADMIN)
        admin_exists = session.exec(statement).first()
        
        if admin_exists is None:
            pinyin_fields = pinyin_utils.compute_pinyin_fields(full_name=default_full_name)
            admin = User(
                username=default_username,
                password_hash=get_password_hash(default_password),
                full_name=default_full_name,
                role=UserRole.ADMIN,
                is_active=True,
                **pinyin_fields,
            )
            session.add(admin)
            session.commit()
            logger.info(f"Default admin user created (username: {default_username})")
        else:
            logger.info("Admin user already exists, skipping default admin creation")


def reset_db() -> None:
    with engine.begin() as connection:
        connection.execute(text("DROP TRIGGER IF EXISTS trg_inventory_fts_ai"))
        connection.execute(text("DROP TRIGGER IF EXISTS trg_inventory_fts_ad"))
        connection.execute(text("DROP TRIGGER IF EXISTS trg_inventory_fts_au"))
        connection.execute(text("DROP TRIGGER IF EXISTS trg_reagent_order_fts_ai"))
        connection.execute(text("DROP TRIGGER IF EXISTS trg_reagent_order_fts_ad"))
        connection.execute(text("DROP TRIGGER IF EXISTS trg_reagent_order_fts_au"))
        connection.execute(text("DROP TRIGGER IF EXISTS trg_consumable_order_fts_ai"))
        connection.execute(text("DROP TRIGGER IF EXISTS trg_consumable_order_fts_ad"))
        connection.execute(text("DROP TRIGGER IF EXISTS trg_consumable_order_fts_au"))
        connection.execute(text("DROP TRIGGER IF EXISTS trg_users_fts_ai"))
        connection.execute(text("DROP TRIGGER IF EXISTS trg_users_fts_ad"))
        connection.execute(text("DROP TRIGGER IF EXISTS trg_users_fts_au"))
        connection.execute(text("DROP TRIGGER IF EXISTS trg_chemical_name_map_fts_ai"))
        connection.execute(text("DROP TRIGGER IF EXISTS trg_chemical_name_map_fts_ad"))
        connection.execute(text("DROP TRIGGER IF EXISTS trg_chemical_name_map_fts_au"))
        connection.execute(text("DROP TRIGGER IF EXISTS trg_log_timeline_fts_ai"))
        connection.execute(text("DROP TRIGGER IF EXISTS trg_log_timeline_fts_ad"))
        connection.execute(text("DROP TRIGGER IF EXISTS trg_log_timeline_fts_au"))
        connection.execute(text("DROP TABLE IF EXISTS inventory_fts"))
        connection.execute(text("DROP TABLE IF EXISTS reagent_order_fts"))
        connection.execute(text("DROP TABLE IF EXISTS consumable_order_fts"))
        connection.execute(text("DROP TABLE IF EXISTS users_fts"))
        connection.execute(text("DROP TABLE IF EXISTS chemical_name_map_fts"))
        connection.execute(text("DROP TABLE IF EXISTS log_timeline_fts"))

    SQLModel.metadata.drop_all(engine)
    init_db()
