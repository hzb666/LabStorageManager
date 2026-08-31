from starlette.requests import Request

from app.api import announcements
from app.models.announcement import Announcement, AnnouncementUpdate
from app.models.user import User, UserRole


def _build_request() -> Request:
    return Request(
        {
            "type": "http",
            "method": "PUT",
            "path": "/api/announcements/1",
            "headers": [],
            "client": ("127.0.0.1", 12345),
        }
    )


def _build_admin_user() -> User:
    return User(
        id=1,
        username="admin",
        full_name="管理员",
        role=UserRole.ADMIN,
        is_active=True,
        password_hash="hashed",
        username_version=1,
    )


class _FakeAnnouncementSession:
    def __init__(self, announcement: Announcement) -> None:
        self.announcement = announcement
        self.committed = False
        self.deleted: Announcement | None = None

    def get(self, model, item_id: int):
        if model is Announcement and item_id == self.announcement.id:
            return self.announcement
        return None

    def commit(self) -> None:
        self.committed = True

    def flush(self) -> None:
        return None

    def refresh(self, _announcement: Announcement) -> None:
        return None

    def delete(self, announcement: Announcement) -> None:
        self.deleted = announcement


def test_update_announcement_deletes_images_removed_from_payload(monkeypatch) -> None:
    deleted_images: list[str] = []
    announcement = Announcement(
        id=1,
        title="旧公告",
        content="正文",
        images=[
            "/static/announcements/keep.png",
            "/static/announcements/remove.png",
        ],
    )
    db = _FakeAnnouncementSession(announcement)
    monkeypatch.setattr(
        announcements,
        "delete_file",
        lambda image_url, required_subdir=None: deleted_images.append(image_url) or True,
    )
    monkeypatch.setattr(announcements, "_log_announcement_operation", lambda *args, **kwargs: None)

    announcements.update_announcement(
        announcement_id=1,
        announcement_update=AnnouncementUpdate(images=["/static/announcements/keep.png"]),
        request=_build_request(),
        db=db,
        current_user=_build_admin_user(),
    )

    assert deleted_images == ["/static/announcements/remove.png"]
    assert announcement.images == ["/static/announcements/keep.png"]
    assert db.committed is True


def test_delete_announcement_deletes_all_attached_images(monkeypatch) -> None:
    deleted_images: list[str] = []
    announcement = Announcement(
        id=1,
        title="待删公告",
        content="正文",
        images=[
            "/static/announcements/one.png",
            "/static/announcements/two.png",
        ],
    )
    db = _FakeAnnouncementSession(announcement)
    monkeypatch.setattr(
        announcements,
        "delete_file",
        lambda image_url, required_subdir=None: deleted_images.append(image_url) or True,
    )
    monkeypatch.setattr(announcements, "_log_announcement_operation", lambda *args, **kwargs: None)

    announcements.delete_announcement(
        announcement_id=1,
        request=_build_request(),
        db=db,
        current_user=_build_admin_user(),
    )

    assert deleted_images == [
        "/static/announcements/one.png",
        "/static/announcements/two.png",
    ]
    assert db.deleted is announcement
    assert db.committed is True
