"""
Database module - SQLModel Engine Configuration
Critical Rule #1: SQLite must enable WAL Mode for concurrency
"""
from sqlmodel import SQLModel, create_engine
from typing import Generator
import os

# Ensure data directory exists
data_dir = os.path.dirname(os.path.dirname(__file__))
db_path = os.path.join(data_dir, "lab_inventory.db")

# Critical: Enable WAL Mode for better concurrency
# WAL (write_to_file-Ahead Logging) allows concurrent reads while writing
sqlite_url = f"sqlite:///{db_path}?mode=wal"

# Create engine with WAL mode
engine = create_engine(
    sqlite_url,
    echo=False,  # Set to True for debugging
    connect_args={"check_same_thread": False}
)


def get_db() -> Generator:
    """Database session dependency for FastAPI"""
    with SQLModelSession() as session:
        yield session


class SQLModelSession(SQLModel):
    """Context manager for database sessions"""
    
    def __init__(self):
        self.session = None
    
    def __enter__(self):
        from sqlmodel import Session
        self.session = Session(self.engine)
        return self.session
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type:
            self.session.rollback()
        else:
            self.session.commit()
        self.session.close()


def init_db() -> None:
    """Initialize database and create all tables"""
    SQLModel.metadata.create_all(engine)


def reset_db() -> None:
    """Drop all tables and recreate (use with caution!)"""
    SQLModel.metadata.drop_all(engine)
    init_db()
