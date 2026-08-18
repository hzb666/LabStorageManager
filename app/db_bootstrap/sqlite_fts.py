"""SQLite FTS table, trigger, rebuild, and consistency setup."""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass

from sqlalchemy import Connection, text

from app.core.config import settings

logger = logging.getLogger(__name__)

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
        detail_search_text,
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
            search_text_pinyin,
            detail_search_text
        )
        VALUES (
            NEW.id,
            NEW.search_text,
            NEW.search_text_pinyin,
            NEW.detail_search_text
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
            search_text_pinyin,
            detail_search_text
        )
        VALUES (
            NEW.id,
            NEW.search_text,
            NEW.search_text_pinyin,
            NEW.detail_search_text
        );
    END
    """,
)

SQLITE_LOG_TIMELINE_FTS_REBUILD_SQL = """
INSERT INTO log_timeline_fts(
    rowid,
    search_text,
    search_text_pinyin,
    detail_search_text
)
SELECT
    id,
    search_text,
    search_text_pinyin,
    detail_search_text
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

SQLITE_SAFE_DROP_FTS_TABLE_STATEMENTS: dict[str, str] = {
    "inventory_fts": "DROP TABLE IF EXISTS inventory_fts",
    "reagent_order_fts": "DROP TABLE IF EXISTS reagent_order_fts",
    "consumable_order_fts": "DROP TABLE IF EXISTS consumable_order_fts",
    "users_fts": "DROP TABLE IF EXISTS users_fts",
    "chemical_name_map_fts": "DROP TABLE IF EXISTS chemical_name_map_fts",
    "log_timeline_fts": "DROP TABLE IF EXISTS log_timeline_fts",
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
    column_pairs: tuple[tuple[str, str], ...]
    source_id_column: str = "id"
    auto_rebuild: bool = True


def _sqlite_fts_table_configs() -> tuple[SQLiteFTSTableConfig, ...]:
    return (
        SQLiteFTSTableConfig(
            source_table="inventory",
            fts_table="inventory_fts",
            setup_statements=SQLITE_INVENTORY_FTS_SETUP,
            rebuild_sql=SQLITE_INVENTORY_FTS_REBUILD_SQL,
            trigger_names=(
                "trg_inventory_fts_ai",
                "trg_inventory_fts_ad",
                "trg_inventory_fts_au",
            ),
            column_pairs=(
                ("cas_number", "cas_number"),
                ("name", "name"),
                ("name_pinyin", "name_pinyin"),
                ("name_pinyin_initials", "name_pinyin_initials"),
                ("alias", "alias"),
                ("category", "category"),
                ("category_pinyin", "category_pinyin"),
                ("category_pinyin_initials", "category_pinyin_initials"),
                ("brand", "brand"),
                ("brand_pinyin", "brand_pinyin"),
                ("brand_pinyin_initials", "brand_pinyin_initials"),
                ("storage_location", "storage_location"),
                ("storage_location_pinyin", "storage_location_pinyin"),
                ("storage_location_pinyin_initials", "storage_location_pinyin_initials"),
            ),
        ),
        SQLiteFTSTableConfig(
            source_table="reagent_order",
            fts_table="reagent_order_fts",
            setup_statements=SQLITE_REAGENT_ORDER_FTS_SETUP,
            rebuild_sql=SQLITE_REAGENT_ORDER_FTS_REBUILD_SQL,
            trigger_names=(
                "trg_reagent_order_fts_ai",
                "trg_reagent_order_fts_ad",
                "trg_reagent_order_fts_au",
            ),
            column_pairs=(
                ("cas_number", "cas_number"),
                ("name", "name"),
                ("name_pinyin", "name_pinyin"),
                ("name_pinyin_initials", "name_pinyin_initials"),
                ("brand", "brand"),
                ("brand_pinyin", "brand_pinyin"),
                ("brand_pinyin_initials", "brand_pinyin_initials"),
            ),
        ),
        SQLiteFTSTableConfig(
            source_table="consumable_order",
            fts_table="consumable_order_fts",
            setup_statements=SQLITE_CONSUMABLE_ORDER_FTS_SETUP,
            rebuild_sql=SQLITE_CONSUMABLE_ORDER_FTS_REBUILD_SQL,
            trigger_names=(
                "trg_consumable_order_fts_ai",
                "trg_consumable_order_fts_ad",
                "trg_consumable_order_fts_au",
            ),
            column_pairs=(
                ("name", "name"),
                ("name_pinyin", "name_pinyin"),
                ("name_pinyin_initials", "name_pinyin_initials"),
                ("specification", "specification"),
                ("communication", "communication"),
            ),
        ),
        SQLiteFTSTableConfig(
            source_table="users",
            fts_table="users_fts",
            setup_statements=SQLITE_USERS_FTS_SETUP,
            rebuild_sql=SQLITE_USERS_FTS_REBUILD_SQL,
            trigger_names=(
                "trg_users_fts_ai",
                "trg_users_fts_ad",
                "trg_users_fts_au",
            ),
            column_pairs=(
                ("full_name", "full_name"),
                ("full_name_pinyin", "full_name_pinyin"),
                ("full_name_pinyin_initials", "full_name_pinyin_initials"),
            ),
        ),
        SQLiteFTSTableConfig(
            source_table="chemical_name_map",
            fts_table="chemical_name_map_fts",
            setup_statements=SQLITE_CHEMICAL_NAME_MAP_FTS_SETUP,
            rebuild_sql=SQLITE_CHEMICAL_NAME_MAP_FTS_REBUILD_SQL,
            trigger_names=(
                "trg_chemical_name_map_fts_ai",
                "trg_chemical_name_map_fts_ad",
                "trg_chemical_name_map_fts_au",
            ),
            column_pairs=(
                ("cas_number", "cas_number"),
                ("name", "name"),
                ("english_name", "english_name"),
                ("alias_1", "alias_1"),
                ("alias_2", "alias_2"),
                ("alias_3", "alias_3"),
                ("name_pinyin", "name_pinyin"),
                ("name_initials", "name_initials"),
                ("alias_1_pinyin", "alias_1_pinyin"),
                ("alias_1_initials", "alias_1_initials"),
                ("alias_2_pinyin", "alias_2_pinyin"),
                ("alias_2_initials", "alias_2_initials"),
                ("alias_3_pinyin", "alias_3_pinyin"),
                ("alias_3_initials", "alias_3_initials"),
            ),
        ),
        SQLiteFTSTableConfig(
            source_table="log_timeline",
            fts_table="log_timeline_fts",
            setup_statements=SQLITE_LOG_TIMELINE_FTS_SETUP,
            rebuild_sql=SQLITE_LOG_TIMELINE_FTS_REBUILD_SQL,
            trigger_names=(
                "trg_log_timeline_fts_ai",
                "trg_log_timeline_fts_ad",
                "trg_log_timeline_fts_au",
            ),
            column_pairs=(
                ("search_text", "search_text"),
                ("search_text_pinyin", "search_text_pinyin"),
                ("detail_search_text", "detail_search_text"),
            ),
            auto_rebuild=False,
        ),
    )


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


def _get_safe_drop_fts_table_statement(table_name: str) -> str:
    statement = SQLITE_SAFE_DROP_FTS_TABLE_STATEMENTS.get(table_name)
    if statement is None:
        raise ValueError(f"Unsupported FTS table for drop query: {table_name}")
    return statement


def _get_safe_drop_trigger_statement(trigger_name: str) -> str:
    statement = SQLITE_SAFE_DROP_TRIGGER_STATEMENTS.get(trigger_name)
    if statement is None:
        raise ValueError(f"Unsupported trigger for drop query: {trigger_name}")
    return statement


def _quote_sqlite_identifier(identifier: str) -> str:
    if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", identifier) is None:
        raise ValueError(f"Unsupported SQLite identifier: {identifier}")
    return f'"{identifier}"'


def _build_sqlite_fts_drift_statement(config: SQLiteFTSTableConfig) -> str:
    source_table = _quote_sqlite_identifier(config.source_table)
    fts_table = _quote_sqlite_identifier(config.fts_table)
    source_id_column = _quote_sqlite_identifier(config.source_id_column)
    comparisons = []
    for source_column, fts_column in config.column_pairs:
        source_identifier = _quote_sqlite_identifier(source_column)
        fts_identifier = _quote_sqlite_identifier(fts_column)
        comparisons.append(f"s.{source_identifier} IS NOT f.{fts_identifier}")
    content_clause = " OR ".join(comparisons)
    if content_clause:
        content_clause = f" OR {content_clause}"

    return f"""
    SELECT EXISTS(
        SELECT 1
        FROM {source_table} AS s
        LEFT JOIN {fts_table} AS f ON f.rowid = s.{source_id_column}
        WHERE f.rowid IS NULL{content_clause}
        UNION ALL
        SELECT 1
        FROM {fts_table} AS f
        LEFT JOIN {source_table} AS s ON s.{source_id_column} = f.rowid
        WHERE s.{source_id_column} IS NULL
        LIMIT 1
    )
    """


def _sqlite_fts_has_drift(connection: Connection, config: SQLiteFTSTableConfig) -> bool:
    statement = _build_sqlite_fts_drift_statement(config)
    return bool(connection.execute(text(statement)).scalar_one())

def _sqlite_fts_columns_match(connection: Connection, config: SQLiteFTSTableConfig) -> bool:
    table_info_statement = f"PRAGMA table_info({_quote_sqlite_identifier(config.fts_table)})"
    db_columns = [
        str(row[1])
        for row in connection.execute(text(table_info_statement)).all()
    ]
    expected_columns = [fts_column for _, fts_column in config.column_pairs]
    return db_columns == expected_columns


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

    if table_exists and not _sqlite_fts_columns_match(connection, config):
        drop_table_statement = _get_safe_drop_fts_table_statement(config.fts_table)
        connection.execute(text(drop_table_statement))
        table_exists = False
        logger.info("Recreated %s because FTS columns changed.", config.fts_table)

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
        needs_rebuild = _sqlite_fts_has_drift(connection, config)
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


def check_sqlite_fts_consistency(connection: Connection) -> None:
    mismatch_messages: list[str] = []
    trigger_rows = connection.execute(
        text("SELECT name FROM sqlite_master WHERE type='trigger'")
    ).all()
    actual_triggers = {str(row[0]) for row in trigger_rows}

    for config in _sqlite_fts_table_configs():
        table_exists = connection.execute(
            text(
                "SELECT 1 FROM sqlite_master "
                "WHERE type='table' AND name=:table_name"
            ),
            {"table_name": config.fts_table},
        ).first() is not None
        if not table_exists:
            mismatch_messages.append(f"FTS table {config.fts_table} is missing")
            continue

        table_info_statement = f"PRAGMA table_info({_quote_sqlite_identifier(config.fts_table)})"
        db_columns = [
            str(row[1])
            for row in connection.execute(text(table_info_statement)).all()
        ]
        expected_columns = [fts_column for _, fts_column in config.column_pairs]
        if db_columns != expected_columns:
            mismatch_messages.append(
                f"FTS table {config.fts_table} column mismatch: "
                f"expected={expected_columns}, db={db_columns}"
            )

        missing_triggers = sorted(set(config.trigger_names) - actual_triggers)
        if missing_triggers:
            mismatch_messages.append(
                f"FTS table {config.fts_table} missing triggers: "
                f"{', '.join(missing_triggers)}"
            )

        if _sqlite_fts_has_drift(connection, config):
            mismatch_messages.append(f"FTS table {config.fts_table} data drift detected")

    if mismatch_messages:
        message = " | ".join(mismatch_messages)
        logger.warning(
            "SQLite FTS consistency check found mismatches (%d): %s.",
            len(mismatch_messages),
            message,
        )
        if settings.use_secure_runtime():
            raise RuntimeError(
                "SQLite FTS consistency check failed in secure runtime: "
                f"{message}"
            )
    else:
        logger.info("SQLite FTS consistency check passed for all FTS tables.")


def ensure_sqlite_inventory_fts(connection: Connection) -> None:
    try:
        for config in _sqlite_fts_table_configs():
            _ensure_sqlite_fts_table(connection, config=config)
    except Exception as exc:  # noqa: BLE001
        logger.error(
            "CRITICAL: SQLite FTS initialization failed: %s. "
            "Search functionality may be degraded or unavailable.",
            exc,
        )
        raise RuntimeError("SQLite FTS initialization failed") from exc


def drop_sqlite_fts_objects(connection: Connection) -> None:
    """Drop FTS triggers and virtual tables before a full metadata reset."""
    for statement in SQLITE_SAFE_DROP_TRIGGER_STATEMENTS.values():
        connection.execute(text(statement))
    for statement in SQLITE_SAFE_DROP_FTS_TABLE_STATEMENTS.values():
        connection.execute(text(statement))
