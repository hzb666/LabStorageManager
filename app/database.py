# SQLModel 引擎与 SQLite 初始化。
from __future__ import annotations

import logging
from pathlib import Path
from typing import Annotated, Generator

from fastapi import Depends
from sqlalchemy import event
from sqlalchemy.engine import make_url
from sqlmodel import SQLModel, Session, create_engine, select

from app.core.config import settings
from app.db_bootstrap.schema_consistency import check_sqlite_schema_consistency
from app.db_bootstrap.schema_upgrades import (
    check_sqlite_common_shelf_groups_consistency,
    ensure_sqlite_common_shelf_location_pinyin_columns,
    ensure_sqlite_compound_structure_cache_name_columns,
    ensure_sqlite_inventory_quantity_statuses,
    ensure_sqlite_log_timeline_detail_search_text,
)
from app.db_bootstrap.sqlite_fts import (
    check_sqlite_fts_consistency,
    drop_sqlite_fts_objects,
    ensure_sqlite_inventory_fts,
)
from app.db_bootstrap.sqlite_indexes import ensure_sqlite_performance_indexes
from app.db_bootstrap.structure_index_schema import ensure_structure_index_schema
from app.models.user import User, UserRole
from app.services import pinyin_utils

logger = logging.getLogger(__name__)
PROJECT_ROOT = Path(__file__).resolve().parents[1]


def _resolve_sqlite_database_path(database_url: str) -> Path:
    url = make_url(database_url)
    if url.get_backend_name() != "sqlite":
        raise RuntimeError("Only SQLite DATABASE_URL values are supported")
    if not url.database or url.database == ":memory:":
        raise RuntimeError("A file-backed SQLite DATABASE_URL is required")

    database_path = Path(url.database)
    if not database_path.is_absolute():
        database_path = PROJECT_ROOT / database_path
    return database_path.resolve()


def _build_sqlite_url(database_url: str) -> str:
    database_path = _resolve_sqlite_database_path(database_url)
    database_path.parent.mkdir(parents=True, exist_ok=True)
    return str(make_url(database_url).set(database=database_path.as_posix()))


# 确保数据库文件目录存在。
db_path = str(_resolve_sqlite_database_path(settings.database_url))

sqlite_url = _build_sqlite_url(settings.database_url)

# SQLite 仍使用单文件库，但必须开启 WAL 才能承受并发读写。
engine = create_engine(
    sqlite_url,
    echo=False,
    connect_args={"check_same_thread": False},
    pool_timeout=5,
)


@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    # 每个新连接都显式打开 WAL 和外键校验，避免驱动默认值漂移。
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL;")
    cursor.execute("PRAGMA foreign_keys=ON;")
    cursor.execute("PRAGMA synchronous=NORMAL;")
    cursor.execute("PRAGMA busy_timeout=3000;")
    cursor.close()


def get_db() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session


# 路由层统一用这个别名拿 DB session。
DBSession = Annotated[Session, Depends(get_db)]


def init_db() -> None:
    # create_all 前先导入模型，避免新字段漏进初始化库。
    import app.models  # noqa: F401
    from app.services.log_timeline_consistency import (
        cleanup_orphan_log_timeline_rows,
        ensure_log_timeline_source_delete_triggers,
    )

    SQLModel.metadata.create_all(engine)
    logger.info("Database tables created / verified")

    with engine.begin() as connection:
        ensure_sqlite_common_shelf_location_pinyin_columns(connection)
        ensure_sqlite_log_timeline_detail_search_text(connection)
        ensure_sqlite_compound_structure_cache_name_columns(connection)
        ensure_sqlite_inventory_quantity_statuses(connection)
        ensure_structure_index_schema(connection)
        check_sqlite_common_shelf_groups_consistency(connection)
        ensure_sqlite_performance_indexes(connection)
        ensure_log_timeline_source_delete_triggers(connection)
        cleanup_orphan_log_timeline_rows(connection)
        ensure_sqlite_inventory_fts(connection)
        check_sqlite_fts_consistency(connection)
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
            logger.info("Default admin user created (username: %s)", default_username)
        else:
            logger.info("Admin user already exists, skipping default admin creation")


def reset_db() -> None:
    with engine.begin() as connection:
        drop_sqlite_fts_objects(connection)

    SQLModel.metadata.drop_all(engine)
    init_db()
