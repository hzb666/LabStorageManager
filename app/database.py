# SQLModel 引擎与 SQLite 初始化。
import logging
import os
from dataclasses import dataclass
from typing import Annotated, Generator

from sqlalchemy import Connection, event, inspect, text
from sqlmodel import SQLModel, Session, create_engine, select
from fastapi import Depends

from app.services import pinyin_utils
from app.models.user import User, UserRole

logger = logging.getLogger(__name__)

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
    cursor.close()


def get_db() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session


# 路由层统一用这个别名拿 DB session。
DBSession = Annotated[Session, Depends(get_db)]


SQLITE_PERFORMANCE_SEARCH_INDEX_UPGRADES: tuple[str, ...] = (
    # Inventory searchable fields (regular/common split by is_common).
    "CREATE INDEX IF NOT EXISTS ix_inventory_is_common_cas_number_created_at_id ON inventory (is_common, cas_number, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_is_common_name_pinyin ON inventory (is_common, name_pinyin DESC, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_is_common_name_pinyin_initials ON inventory (is_common, name_pinyin_initials DESC, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_is_common_category_pinyin ON inventory (is_common, category_pinyin DESC, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_is_common_category_pinyin_initials ON inventory (is_common, category_pinyin_initials DESC, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_is_common_brand_pinyin ON inventory (is_common, brand_pinyin DESC, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_is_common_brand_pinyin_initials ON inventory (is_common, brand_pinyin_initials DESC, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_is_common_storage_location_created_at_id ON inventory (is_common, storage_location, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_is_common_storage_location_pinyin ON inventory (is_common, storage_location_pinyin DESC, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_is_common_storage_location_pinyin_initials ON inventory (is_common, storage_location_pinyin_initials DESC, created_at DESC, id DESC)",
    # Reagent order searchable raw-text and pinyin fields.
    "CREATE INDEX IF NOT EXISTS ix_reagent_order_cas_number_created_at_id ON reagent_order (cas_number, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_reagent_order_name_created_at_id ON reagent_order (name, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_reagent_order_category_created_at_id ON reagent_order (category, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_reagent_order_brand_created_at_id ON reagent_order (brand, created_at DESC, id DESC)",
    # Reagent order searchable pinyin fields.
    "CREATE INDEX IF NOT EXISTS ix_reagent_order_name_pinyin_created_at_id ON reagent_order (name_pinyin, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_reagent_order_name_pinyin_initials_created_at_id ON reagent_order (name_pinyin_initials, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_reagent_order_category_pinyin_created_at_id ON reagent_order (category_pinyin, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_reagent_order_category_pinyin_initials_created_at_id ON reagent_order (category_pinyin_initials, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_reagent_order_brand_pinyin_created_at_id ON reagent_order (brand_pinyin, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_reagent_order_brand_pinyin_initials_created_at_id ON reagent_order (brand_pinyin_initials, created_at DESC, id DESC)",
    # Consumable order searchable raw-text and pinyin fields.
    "CREATE INDEX IF NOT EXISTS ix_consumable_order_name_created_at_id ON consumable_order (name, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_consumable_order_name_pinyin_created_at_id ON consumable_order (name_pinyin, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_consumable_order_name_pinyin_initials_created_at_id ON consumable_order (name_pinyin_initials, created_at DESC, id DESC)",
)


SQLITE_PERFORMANCE_FILTER_SORT_INDEX_UPGRADES: tuple[str, ...] = (
    # Inventory filter/sort and operational paths.
    "CREATE INDEX IF NOT EXISTS ix_inventory_is_common_created_at_id ON inventory (is_common, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_is_common_status_created_at_id ON inventory (is_common, status, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_is_common_remaining_percent_created_at_id ON inventory (is_common, remaining_percent DESC, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_borrower_status_updated_at ON inventory (borrower_id, status, updated_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_is_common_keeper_location_created_at ON inventory (is_common, temporary_keeper_id, storage_location, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_created_by_created_at_id ON inventory (created_by_id, created_at DESC, id DESC)",
    # Borrow log operational queries.
    "CREATE INDEX IF NOT EXISTS ix_borrowlog_borrower_consume_borrow_time ON borrowlog (borrower_id, is_consume, borrow_time DESC)",
    "CREATE INDEX IF NOT EXISTS ix_borrowlog_inventory_consume_return_borrow ON borrowlog (inventory_id, is_consume, return_time, borrow_time DESC)",
    # Reagent/consumable list status + applicant filters.
    "CREATE INDEX IF NOT EXISTS ix_reagent_order_created_at_id ON reagent_order (created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_reagent_order_status_created_at_id ON reagent_order (status, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_reagent_order_applicant_created_at_id ON reagent_order (applicant_id, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_consumable_order_created_at_id ON consumable_order (created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_consumable_order_status_created_at_id ON consumable_order (status, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_consumable_order_applicant_created_at_id ON consumable_order (applicant_id, created_at DESC, id DESC)",
    # Other modules.
    "CREATE INDEX IF NOT EXISTS ix_announcements_pinned_created ON announcements (is_pinned DESC, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_announcements_visible_pinned_created ON announcements (is_visible, is_pinned DESC, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_announcements_creator_visible ON announcements (created_by, is_visible)",
    "CREATE INDEX IF NOT EXISTS ix_users_active_role_created ON users (is_active DESC, role DESC, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_users_role_created_at ON users (role, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_users_full_name_pinyin_id ON users (full_name_pinyin, id)",
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

SQLITE_SAFE_COUNT_STATEMENTS: dict[str, str] = {
    "inventory": "SELECT COUNT(*) FROM inventory",
    "reagent_order": "SELECT COUNT(*) FROM reagent_order",
    "consumable_order": "SELECT COUNT(*) FROM consumable_order",
    "users": "SELECT COUNT(*) FROM users",
    "inventory_fts": "SELECT COUNT(*) FROM inventory_fts",
    "reagent_order_fts": "SELECT COUNT(*) FROM reagent_order_fts",
    "consumable_order_fts": "SELECT COUNT(*) FROM consumable_order_fts",
    "users_fts": "SELECT COUNT(*) FROM users_fts",
}

SQLITE_SAFE_DELETE_STATEMENTS: dict[str, str] = {
    "inventory_fts": "DELETE FROM inventory_fts",
    "reagent_order_fts": "DELETE FROM reagent_order_fts",
    "consumable_order_fts": "DELETE FROM consumable_order_fts",
    "users_fts": "DELETE FROM users_fts",
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
}


@dataclass(frozen=True)
class SQLiteFTSTableConfig:
    source_table: str
    fts_table: str
    setup_statements: tuple[str, ...]
    rebuild_sql: str
    trigger_names: tuple[str, str, str]


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
    for statement in SQLITE_PERFORMANCE_INDEX_UPGRADES:
        connection.execute(text(statement))

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
        connection.execute(text("DROP TABLE IF EXISTS inventory_fts"))
        connection.execute(text("DROP TABLE IF EXISTS reagent_order_fts"))
        connection.execute(text("DROP TABLE IF EXISTS consumable_order_fts"))
        connection.execute(text("DROP TABLE IF EXISTS users_fts"))

    SQLModel.metadata.drop_all(engine)
    init_db()
