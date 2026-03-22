"""
Database module - SQLModel Engine Configuration
Critical Rule #1: SQLite must enable WAL Mode for concurrency
"""
import logging
import os
from typing import Annotated, Generator

from sqlalchemy import Connection, event, inspect, text
from sqlmodel import SQLModel, Session, create_engine, select
from fastapi import Depends

from app.services import pinyin_utils
from app.models.user import User, UserRole

logger = logging.getLogger(__name__)

# Ensure data directory exists
data_dir = os.path.dirname(os.path.dirname(__file__))
db_path = os.path.join(data_dir, "lab_inventory.db")

sqlite_url = f"sqlite:///{db_path}"

# Create engine
engine = create_engine(
    sqlite_url,
    echo=False,
    connect_args={"check_same_thread": False},
)


@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    """Critical Rule #1: Enable WAL mode on every new connection."""
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL;")
    cursor.execute("PRAGMA foreign_keys=ON;")
    cursor.close()


def get_db() -> Generator[Session, None, None]:
    """Database session dependency for FastAPI"""
    with Session(engine) as session:
        yield session


# Annotated type alias for database session dependency
# Usage: def endpoint(db: DBSession): ...
DBSession = Annotated[Session, Depends(get_db)]


SQLITE_SEARCH_COLUMN_UPGRADES: dict[str, tuple[tuple[str, str], ...]] = {
    "inventory": (
        ("name_pinyin_initials", "VARCHAR(200)"),
        ("category_pinyin_initials", "VARCHAR(200)"),
        ("brand_pinyin_initials", "VARCHAR(200)"),
        ("storage_location_pinyin_initials", "VARCHAR(200)"),
    ),
    "reagent_order": (
        ("name_pinyin_initials", "VARCHAR(200)"),
        ("category_pinyin", "VARCHAR(200)"),
        ("category_pinyin_initials", "VARCHAR(200)"),
        ("brand_pinyin_initials", "VARCHAR(200)"),
    ),
    "consumable_order": (
        ("name_pinyin_initials", "VARCHAR(200)"),
    ),
    "users": (
        ("full_name_pinyin_initials", "VARCHAR(200)"),
    ),
}

SQLITE_SEARCH_INDEX_UPGRADES: tuple[tuple[str, str, str], ...] = ()


SQLITE_DEPRECATED_INDEX_DROPS: tuple[str, ...] = (
    # Inventory single-column indexes covered by composite indexes.
    "DROP INDEX IF EXISTS ix_inventory_cas_number",
    "DROP INDEX IF EXISTS ix_inventory_name",
    "DROP INDEX IF EXISTS ix_inventory_category",
    "DROP INDEX IF EXISTS ix_inventory_brand",
    "DROP INDEX IF EXISTS ix_inventory_storage_location",
    "DROP INDEX IF EXISTS ix_inventory_is_common",
    "DROP INDEX IF EXISTS ix_inventory_status",
    "DROP INDEX IF EXISTS ix_inventory_borrower_id",
    "DROP INDEX IF EXISTS ix_inventory_temporary_keeper_id",
    "DROP INDEX IF EXISTS ix_inventory_created_by_id",
    "DROP INDEX IF EXISTS ix_inventory_created_at",
    "DROP INDEX IF EXISTS ix_inventory_name_pinyin",
    "DROP INDEX IF EXISTS ix_inventory_name_pinyin_initials",
    "DROP INDEX IF EXISTS ix_inventory_category_pinyin",
    "DROP INDEX IF EXISTS ix_inventory_category_pinyin_initials",
    "DROP INDEX IF EXISTS ix_inventory_brand_pinyin",
    "DROP INDEX IF EXISTS ix_inventory_brand_pinyin_initials",
    "DROP INDEX IF EXISTS ix_inventory_storage_location_pinyin",
    "DROP INDEX IF EXISTS ix_inventory_storage_location_pinyin_initials",
    # Recreate these indexes with created_at/id suffix for pinyin sort tie-breakers.
    "DROP INDEX IF EXISTS ix_inventory_is_common_name_pinyin",
    "DROP INDEX IF EXISTS ix_inventory_is_common_name_pinyin_initials",
    "DROP INDEX IF EXISTS ix_inventory_is_common_category_pinyin",
    "DROP INDEX IF EXISTS ix_inventory_is_common_category_pinyin_initials",
    "DROP INDEX IF EXISTS ix_inventory_is_common_brand_pinyin",
    "DROP INDEX IF EXISTS ix_inventory_is_common_brand_pinyin_initials",
    "DROP INDEX IF EXISTS ix_inventory_is_common_storage_location_pinyin",
    "DROP INDEX IF EXISTS ix_inventory_is_common_storage_location_pinyin_initials",
    # Historical residual indexes from earlier is_common rollout.
    "DROP INDEX IF EXISTS ix_inventory_is_common_cas_number",
    "DROP INDEX IF EXISTS ix_inventory_is_common_name",
    "DROP INDEX IF EXISTS ix_inventory_is_common_alias",
    "DROP INDEX IF EXISTS ix_inventory_is_common_category",
    "DROP INDEX IF EXISTS ix_inventory_is_common_brand",
    "DROP INDEX IF EXISTS ix_inventory_is_common_storage_location",
    # Borrow log single-column indexes covered by composite indexes.
    "DROP INDEX IF EXISTS ix_borrowlog_inventory_id",
    "DROP INDEX IF EXISTS ix_borrowlog_borrower_id",
    # Reagent order pinyin single-column indexes covered by composite indexes.
    "DROP INDEX IF EXISTS ix_reagent_order_name_pinyin",
    "DROP INDEX IF EXISTS ix_reagent_order_name_pinyin_initials",
    "DROP INDEX IF EXISTS ix_reagent_order_category_pinyin",
    "DROP INDEX IF EXISTS ix_reagent_order_category_pinyin_initials",
    "DROP INDEX IF EXISTS ix_reagent_order_brand_pinyin",
    "DROP INDEX IF EXISTS ix_reagent_order_brand_pinyin_initials",
    "DROP INDEX IF EXISTS ix_reagent_order_created_at",
    # Consumable order pinyin single-column indexes covered by composite indexes.
    "DROP INDEX IF EXISTS ix_consumable_order_name_pinyin",
    "DROP INDEX IF EXISTS ix_consumable_order_name_pinyin_initials",
    "DROP INDEX IF EXISTS ix_consumable_order_created_at",
    # Users pinyin single-column indexes covered by composite/low-value historical leftovers.
    "DROP INDEX IF EXISTS ix_users_full_name_pinyin",
    "DROP INDEX IF EXISTS ix_users_full_name_pinyin_initials",
)

SQLITE_PERFORMANCE_SEARCH_INDEX_UPGRADES: tuple[str, ...] = (
    # Inventory searchable fields (regular/common split by is_common).
    "CREATE INDEX IF NOT EXISTS ix_inventory_is_common_cas_number_created_at_id ON inventory (is_common, cas_number, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_is_common_name_created_at_id ON inventory (is_common, name, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_is_common_name_pinyin ON inventory (is_common, name_pinyin DESC, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_is_common_name_pinyin_initials ON inventory (is_common, name_pinyin_initials DESC, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_is_common_alias_created_at_id ON inventory (is_common, alias, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_is_common_category_created_at_id ON inventory (is_common, category, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_is_common_category_pinyin ON inventory (is_common, category_pinyin DESC, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_is_common_category_pinyin_initials ON inventory (is_common, category_pinyin_initials DESC, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_is_common_brand_created_at_id ON inventory (is_common, brand, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_is_common_brand_pinyin ON inventory (is_common, brand_pinyin DESC, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_is_common_brand_pinyin_initials ON inventory (is_common, brand_pinyin_initials DESC, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_is_common_storage_location_created_at_id ON inventory (is_common, storage_location, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_is_common_storage_location_pinyin ON inventory (is_common, storage_location_pinyin DESC, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_is_common_storage_location_pinyin_initials ON inventory (is_common, storage_location_pinyin_initials DESC, created_at DESC, id DESC)",
    # Reagent order searchable pinyin fields.
    "CREATE INDEX IF NOT EXISTS ix_reagent_order_name_pinyin_created_at_id ON reagent_order (name_pinyin, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_reagent_order_name_pinyin_initials_created_at_id ON reagent_order (name_pinyin_initials, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_reagent_order_category_pinyin_created_at_id ON reagent_order (category_pinyin, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_reagent_order_category_pinyin_initials_created_at_id ON reagent_order (category_pinyin_initials, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_reagent_order_brand_pinyin_created_at_id ON reagent_order (brand_pinyin, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_reagent_order_brand_pinyin_initials_created_at_id ON reagent_order (brand_pinyin_initials, created_at DESC, id DESC)",
    # Consumable order searchable pinyin fields.
    "CREATE INDEX IF NOT EXISTS ix_consumable_order_name_pinyin_created_at_id ON consumable_order (name_pinyin, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_consumable_order_name_pinyin_initials_created_at_id ON consumable_order (name_pinyin_initials, created_at DESC, id DESC)",
)


SQLITE_PERFORMANCE_FILTER_SORT_INDEX_UPGRADES: tuple[str, ...] = (
    # Inventory filter/sort and operational paths.
    "CREATE INDEX IF NOT EXISTS ix_inventory_is_common_created_at_id ON inventory (is_common, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_is_common_status_created_at_id ON inventory (is_common, status, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_status_created_at_id ON inventory (status, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_borrower_status_updated_at ON inventory (borrower_id, status, updated_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_keeper_location_created_at ON inventory (temporary_keeper_id, storage_location, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_cas_status_created_at ON inventory (cas_number, status, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_alias_created_at ON inventory (alias, created_at DESC)",
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


def check_sqlite_schema_consistency(connection: Connection) -> None:
    """
    Check whether SQLite schema matches SQLModel definitions.

    This function only checks and logs; it does not mutate schema.
    """
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


def ensure_sqlite_search_columns(connection: Connection) -> int:
    """Add newly introduced search columns/indexes for existing SQLite databases."""
    added_columns = 0

    for table_name, columns in SQLITE_SEARCH_COLUMN_UPGRADES.items():
        existing_columns = {
            row[1]
            for row in connection.execute(text(f"PRAGMA table_info({table_name})"))
        }

        for column_name, column_type in columns:
            if column_name in existing_columns:
                continue

            connection.execute(
                text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_type}")
            )
            added_columns += 1
            logger.info("Added SQLite search column %s.%s", table_name, column_name)

    for index_name, table_name, column_name in SQLITE_SEARCH_INDEX_UPGRADES:
        connection.execute(
            text(f"CREATE INDEX IF NOT EXISTS {index_name} ON {table_name} ({column_name})")
        )

    for statement in SQLITE_DEPRECATED_INDEX_DROPS:
        connection.execute(text(statement))

    for statement in SQLITE_PERFORMANCE_INDEX_UPGRADES:
        connection.execute(text(statement))

    # Refresh planner statistics so SQLite can pick the intended composite indexes
    # after large index upgrades (especially the is_common + created_at/id paths).
    connection.execute(text("ANALYZE"))
    connection.execute(text("PRAGMA optimize"))

    return added_columns


def ensure_sqlite_inventory_fts(connection: Connection) -> None:
    """Create inventory FTS table/triggers for fast substring search."""
    try:
        table_exists = connection.execute(
            text(
                "SELECT 1 FROM sqlite_master "
                "WHERE type='table' AND name='inventory_fts'"
            )
        ).first() is not None

        connection.execute(text("DROP TRIGGER IF EXISTS trg_inventory_fts_ai"))
        connection.execute(text("DROP TRIGGER IF EXISTS trg_inventory_fts_ad"))
        connection.execute(text("DROP TRIGGER IF EXISTS trg_inventory_fts_au"))

        for statement in SQLITE_INVENTORY_FTS_SETUP:
            connection.execute(text(statement))

        inventory_count = connection.execute(text("SELECT COUNT(*) FROM inventory")).scalar_one()
        fts_count = connection.execute(text("SELECT COUNT(*) FROM inventory_fts")).scalar_one()
        needs_rebuild = (not table_exists) or (inventory_count != fts_count)
        if needs_rebuild:
            connection.execute(text("DELETE FROM inventory_fts"))
            connection.execute(
                text(
                    """
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
                )
            )
            fts_count_after = connection.execute(text("SELECT COUNT(*) FROM inventory_fts")).scalar_one()
            logger.info(
                "Rebuilt inventory_fts data (inventory rows=%s, fts rows before=%s, after=%s)",
                inventory_count,
                fts_count,
                fts_count_after,
            )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Inventory FTS initialization skipped: %s", exc)


def init_db() -> None:
    """Initialize database and create all tables"""
    # Ensure all SQLModel tables are registered before create_all.
    # This guarantees fresh database initialization includes the latest columns
    # such as inventory.remaining_percent.
    import app.models  # noqa: F401

    SQLModel.metadata.create_all(engine)
    logger.info("Database tables created / verified")

    with engine.begin() as connection:
        ensure_sqlite_search_columns(connection)
        ensure_sqlite_inventory_fts(connection)
        check_sqlite_schema_consistency(connection)

    # Create default admin user if no users exist
    _create_default_admin()


def _create_default_admin() -> None:
    """确保始终至少有一个管理员账户"""
    # Import here to avoid circular import
    from app.core.auth import get_password_hash
    from app.core.config import get_settings
    
    settings = get_settings()
    
    # Get config or use defaults
    default_username = settings.default_admin_username
    default_password = settings.default_admin_password
    default_full_name = settings.default_admin_full_name
    
    # Always require password from environment variable
    if not default_password:
        raise ValueError(
            "DEFAULT_ADMIN_PASSWORD must be set. "
            "Set in .env for production or .env.local for development."
        )
    
    with Session(engine) as session:
        # Check if any admin users exist (only check for admins, not all users)
        statement = select(User).where(User.role == UserRole.ADMIN)
        admin_exists = session.exec(statement).first()
        
        if admin_exists is None:
            pinyin_fields = pinyin_utils.compute_pinyin_fields(full_name=default_full_name)
            # Create default admin user
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
    """Drop all tables and recreate (use with caution!)"""
    with engine.begin() as connection:
        connection.execute(text("DROP TRIGGER IF EXISTS trg_inventory_fts_ai"))
        connection.execute(text("DROP TRIGGER IF EXISTS trg_inventory_fts_ad"))
        connection.execute(text("DROP TRIGGER IF EXISTS trg_inventory_fts_au"))
        connection.execute(text("DROP TABLE IF EXISTS inventory_fts"))

    SQLModel.metadata.drop_all(engine)
    init_db()
