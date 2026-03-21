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

SQLITE_SEARCH_INDEX_UPGRADES: tuple[tuple[str, str, str], ...] = (
    ("ix_inventory_name_pinyin_initials", "inventory", "name_pinyin_initials"),
    ("ix_inventory_category_pinyin_initials", "inventory", "category_pinyin_initials"),
    ("ix_inventory_brand_pinyin_initials", "inventory", "brand_pinyin_initials"),
    ("ix_inventory_storage_location_pinyin_initials", "inventory", "storage_location_pinyin_initials"),
    ("ix_reagent_order_name_pinyin_initials", "reagent_order", "name_pinyin_initials"),
    ("ix_reagent_order_category_pinyin", "reagent_order", "category_pinyin"),
    ("ix_reagent_order_category_pinyin_initials", "reagent_order", "category_pinyin_initials"),
    ("ix_reagent_order_brand_pinyin_initials", "reagent_order", "brand_pinyin_initials"),
    ("ix_consumable_order_name_pinyin_initials", "consumable_order", "name_pinyin_initials"),
    ("ix_users_full_name_pinyin_initials", "users", "full_name_pinyin_initials"),
)

SQLITE_PERFORMANCE_INDEX_UPGRADES: tuple[str, ...] = (
    "CREATE INDEX IF NOT EXISTS ix_inventory_is_common_created_at_id ON inventory (is_common, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_status_created_at_id ON inventory (status, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_borrower_status_updated_at ON inventory (borrower_id, status, updated_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_keeper_location_created_at ON inventory (temporary_keeper_id, storage_location, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_cas_status_created_at ON inventory (cas_number, status, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_created_by_created_at_id ON inventory (created_by_id, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_borrowlog_borrower_consume_borrow_time ON borrowlog (borrower_id, is_consume, borrow_time DESC)",
    "CREATE INDEX IF NOT EXISTS ix_borrowlog_inventory_consume_return_borrow ON borrowlog (inventory_id, is_consume, return_time, borrow_time DESC)",
    "CREATE INDEX IF NOT EXISTS ix_reagent_order_status_created_at_id ON reagent_order (status, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_reagent_order_applicant_created_at_id ON reagent_order (applicant_id, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_consumable_order_status_created_at_id ON consumable_order (status, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS ix_consumable_order_applicant_created_at_id ON consumable_order (applicant_id, created_at DESC, id DESC)",
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

    for statement in SQLITE_PERFORMANCE_INDEX_UPGRADES:
        connection.execute(text(statement))

    return added_columns


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
    SQLModel.metadata.drop_all(engine)
    init_db()
