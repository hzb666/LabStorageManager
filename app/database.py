"""
Database module - SQLModel Engine Configuration
Critical Rule #1: SQLite must enable WAL Mode for concurrency
"""
from sqlmodel import SQLModel, create_engine, Session
from typing import Generator
import os

# Ensure data directory exists
data_dir = os.path.dirname(os.path.dirname(__file__))
db_path = os.path.join(data_dir, "lab_inventory.db")

# Critical: Enable WAL Mode for better concurrency
# WAL (Write-Ahead Logging) allows concurrent reads while writing
sqlite_url = f"sqlite:///{db_path}?mode=wal"

# Create engine with WAL mode
engine = create_engine(
    sqlite_url,
    echo=False,  # Set to True for debugging
    connect_args={"check_same_thread": False}
)


def get_db() -> Generator[Session, None, None]:
    """Database session dependency for FastAPI"""
    with Session(engine) as session:
        yield session


def init_db() -> None:
    """Initialize database and create all tables"""
    SQLModel.metadata.create_all(engine)


def reset_db() -> None:
    """Drop all tables and recreate (use with caution!)"""
    SQLModel.metadata.drop_all(engine)
    init_db()
