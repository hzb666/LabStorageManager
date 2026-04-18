"""Database session and engine setup for WeChat bot."""

from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings


def _resolve_database_url() -> str:
    url = (settings.database_url or "").strip()
    if not url:
        return "sqlite:///./wechat_memory.db"
    return url


def _build_connect_args(url: str) -> dict:
    if url.startswith("sqlite"):
        return {"check_same_thread": False}
    return {}


DATABASE_URL = _resolve_database_url()
engine = create_engine(DATABASE_URL, future=True, pool_pre_ping=True, connect_args=_build_connect_args(DATABASE_URL))
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False, class_=Session)


def get_db_session() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
