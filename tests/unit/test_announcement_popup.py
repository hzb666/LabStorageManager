from __future__ import annotations

import unittest
from datetime import UTC, datetime
from unittest.mock import patch

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel
from starlette.requests import Request

import app.models  # noqa: F401 - populate SQLModel metadata for the test database.
from app.api import announcements
from app.db_bootstrap.schema_upgrades import ensure_sqlite_announcement_schema
from app.models.announcement import (
    Announcement,
    AnnouncementCreate,
    AnnouncementResponse,
    AnnouncementUpdate,
)
from app.models.user import User, UserRole


class AnnouncementPopupContractTests(unittest.TestCase):
    def test_announcement_contract_carries_popup_state(self) -> None:
        create_payload = AnnouncementCreate(
            title="系统维护",
            content="今晚进行系统维护",
            is_popup=True,
        )
        response = AnnouncementResponse(
            id=1,
            title=create_payload.title,
            content=create_payload.content,
            images=[],
            is_pinned=False,
            is_visible=True,
            is_popup=True,
            created_by=1,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )

        self.assertTrue(create_payload.is_popup)
        self.assertTrue(response.is_popup)

    def test_existing_announcement_table_gains_popup_column(self) -> None:
        engine = create_engine("sqlite://")
        self.addCleanup(engine.dispose)
        with engine.begin() as connection:
            connection.execute(
                text(
                    """
                    CREATE TABLE announcements (
                        id INTEGER PRIMARY KEY,
                        title VARCHAR(200) NOT NULL,
                        content VARCHAR(10000) NOT NULL
                    )
                    """
                )
            )
            connection.execute(
                text(
                    "INSERT INTO announcements (id, title, content) "
                    "VALUES (1, '旧公告', '已有内容')"
                )
            )

            ensure_sqlite_announcement_schema(connection)

            popup_value = connection.execute(
                text("SELECT is_popup FROM announcements WHERE id = 1")
            ).scalar_one()

        column_names = {column["name"] for column in inspect(engine).get_columns("announcements")}
        self.assertIn("is_popup", column_names)
        self.assertEqual(0, popup_value)

    def test_create_announcement_persists_popup_state(self) -> None:
        engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        self.addCleanup(engine.dispose)
        SQLModel.metadata.create_all(engine)
        with Session(engine) as session:
            admin = User(
                username="admin_popup",
                full_name="Popup Admin",
                role=UserRole.ADMIN,
                is_active=True,
                password_hash="hashed",
                username_version=1,
            )
            session.add(admin)
            session.commit()
            session.refresh(admin)
            request = Request(
                {
                    "type": "http",
                    "method": "POST",
                    "path": "/api/announcements/",
                    "headers": [],
                    "client": ("127.0.0.1", 12345),
                }
            )

            with patch.object(announcements, "_log_announcement_operation"):
                response = announcements.create_announcement(
                    announcement=AnnouncementCreate(
                        title="重要公告",
                        content="请阅读公告",
                        is_popup=True,
                    ),
                    request=request,
                    db=session,
                    current_user=admin,
                )

            persisted = session.get(Announcement, response.id)
            self.assertTrue(response.is_popup)
            self.assertIsNotNone(persisted)
            self.assertTrue(persisted.is_popup)

    def test_updating_popup_refreshes_its_version_timestamp(self) -> None:
        engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        self.addCleanup(engine.dispose)
        SQLModel.metadata.create_all(engine)
        with Session(engine) as session:
            admin = User(
                username="admin_popup_update",
                full_name="Popup Update Admin",
                role=UserRole.ADMIN,
                is_active=True,
                password_hash="hashed",
                username_version=1,
            )
            session.add(admin)
            session.commit()
            session.refresh(admin)
            original_updated_at = datetime(2026, 8, 30, 1, 0, 0, tzinfo=UTC).replace(
                tzinfo=None
            )
            popup = Announcement(
                title="更新前",
                content="公告内容",
                is_popup=True,
                created_by=admin.id,
                updated_at=original_updated_at,
            )
            session.add(popup)
            session.commit()
            session.refresh(popup)
            refreshed_updated_at = datetime(2026, 8, 30, 2, 0, 0, tzinfo=UTC).replace(
                tzinfo=None
            )
            request = Request(
                {
                    "type": "http",
                    "method": "PUT",
                    "path": f"/api/announcements/{popup.id}",
                    "headers": [],
                    "client": ("127.0.0.1", 12345),
                }
            )

            with (
                patch.object(announcements, "_log_announcement_operation"),
                patch.object(announcements, "get_utc_now", return_value=refreshed_updated_at),
            ):
                response = announcements.update_announcement(
                    announcement_id=popup.id,
                    announcement_update=AnnouncementUpdate(title="更新后"),
                    request=request,
                    db=session,
                    current_user=admin,
                )

            self.assertTrue(response.is_popup)
            self.assertEqual(refreshed_updated_at, response.updated_at)
            self.assertNotEqual(original_updated_at, response.updated_at)


if __name__ == "__main__":
    unittest.main()
