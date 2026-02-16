"""
Database module - SQLModel Engine Configuration
Critical Rule #1: SQLite must enable WAL Mode for concurrency
"""
import logging
import os
from typing import Generator

from sqlalchemy import event
from sqlmodel import SQLModel, Session, create_engine

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


def init_db() -> None:
    """Initialize database and create all tables"""
    SQLModel.metadata.create_all(engine)
    logger.info("Database tables created / verified")


def reset_db() -> None:
    """Drop all tables and recreate (use with caution!)"""
    SQLModel.metadata.drop_all(engine)
    init_db()
