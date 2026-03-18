"""
Database module - SQLModel Engine Configuration
Critical Rule #1: SQLite must enable WAL Mode for concurrency
"""
import logging
import os
from enum import Enum
from typing import Annotated, Generator

from sqlalchemy import Connection, event, text
from sqlmodel import SQLModel, Session, create_engine, select
from fastapi import Depends

from app.services import pinyin_utils
from app.models.consumable_order import ConsumableOrderStatus
from app.models.inventory import InventoryStatus
from app.models.reagent_order import ReagentOrderReason, ReagentOrderStatus
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


LEGACY_ENUM_COLUMNS: tuple[tuple[str, str, type[Enum]], ...] = (
    ("reagentorder", "status", ReagentOrderStatus),
    ("reagentorder", "order_reason", ReagentOrderReason),
    ("consumableorder", "status", ConsumableOrderStatus),
    ("inventory", "status", InventoryStatus),
    ("users", "role", UserRole),
)


def normalize_legacy_enum_storage(connection: Connection) -> int:
    """
    Normalize legacy enum values stored as enum.value to the current enum.name format.

    Older data may contain lowercase enum values like "pending", while SQLAlchemy now
    reads enum columns using member names such as "PENDING". Startup normalization keeps
    historical data readable without manual SQL fixes.
    """
    updated_rows = 0

    for table_name, column_name, enum_cls in LEGACY_ENUM_COLUMNS:
        for member in enum_cls:
            legacy_value = str(member.value)
            canonical_value = member.name

            if legacy_value == canonical_value:
                continue

            result = connection.execute(
                text(
                    f"""
                    UPDATE {table_name}
                    SET {column_name} = :canonical_value
                    WHERE {column_name} = :legacy_value
                    """
                ),
                {
                    "canonical_value": canonical_value,
                    "legacy_value": legacy_value,
                },
            )
            updated_rows += result.rowcount or 0

    return updated_rows


def init_db() -> None:
    """Initialize database and create all tables"""
    # Ensure all SQLModel tables are registered before create_all.
    # This guarantees fresh database initialization includes the latest columns
    # such as inventory.remaining_percent.
    import app.models  # noqa: F401

    SQLModel.metadata.create_all(engine)
    logger.info("Database tables created / verified")

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
            # Create default admin user
            admin = User(
                username=default_username,
                password_hash=get_password_hash(default_password),
                full_name=default_full_name,
                role=UserRole.ADMIN,
                is_active=True,
                full_name_pinyin=pinyin_utils.to_pinyin(default_full_name)
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
