from __future__ import annotations

import json
import tempfile
import unittest
from dataclasses import replace
from datetime import timedelta
from pathlib import Path
from unittest.mock import MagicMock, patch

from fastapi import APIRouter, BackgroundTasks, HTTPException
from starlette.requests import Request

from app.api import inventory_extended_routes
from app.core.time_utils import get_utc_now
from app.models.user import User, UserRole
from app.services import inventory_import_preview_sessions as preview_sessions


class _FakeRedis:
    def __init__(self) -> None:
        self.store: dict[str, str] = {}

    def setex(self, key: str, _ttl_seconds: int, value: str) -> bool:
        self.store[key] = value
        return True

    def getdel(self, key: str) -> str | None:
        return self.store.pop(key, None)

    def eval(self, _script: str, _num_keys: int, key: str) -> str | None:
        return self.getdel(key)

    def delete(self, *keys: str) -> int:
        deleted = 0
        for key in keys:
            if key in self.store:
                deleted += 1
                self.store.pop(key, None)
        return deleted

    def scan_iter(self, match: str, count: int = 50):
        del count
        pattern = match.replace("*", "")
        for key in list(self.store):
            if key.startswith(pattern):
                yield key


def _create_import_file() -> str:
    file = tempfile.NamedTemporaryFile(
        delete=False,
        suffix=".csv",
        dir=preview_sessions.get_inventory_import_preview_dir(),
    )
    file.write("cas_number,name,specification\n64-17-5,乙醇,500ml\n".encode())
    file.close()
    return file.name


def _build_confirm_endpoint():
    router = APIRouter()
    inventory_extended_routes._register_import_routes(router, {}, "inventory:list")
    for route in router.routes:
        if getattr(route, "path", "") == "/import/confirm":
            return route.endpoint
    raise AssertionError("confirm endpoint not found")


def _build_confirm_request() -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/inventory/import/confirm",
            "headers": [],
            "client": ("127.0.0.1", 12345),
        }
    )


class InventoryImportPreviewSessionStorageTests(unittest.TestCase):
    def setUp(self) -> None:
        preview_sessions.reset_inventory_import_preview_sessions()
        self.created_files: list[str] = []

    def tearDown(self) -> None:
        for path in self.created_files:
            Path(path).unlink(missing_ok=True)
        preview_sessions.reset_inventory_import_preview_sessions()

    def _get_preview_file_path(self, token: str) -> str:
        session = preview_sessions._local_preview_sessions.get(token)
        preview_file_path = getattr(session, "file_path", None)
        if preview_file_path is None:
            self.fail("Preview session should persist file_path metadata instead of raw file bytes")
        return preview_file_path

    def test_create_preview_session_keeps_only_metadata_in_redis(self) -> None:
        file_path = _create_import_file()
        self.created_files.append(file_path)
        fake_redis = _FakeRedis()

        with patch("app.services.inventory_import_preview_sessions.get_redis", return_value=fake_redis):
            token = preview_sessions.create_inventory_import_preview_session(
                file_path=file_path,
                user_id=7,
                default_storage_location="A-01",
                default_is_hazardous=True,
            )

        raw_payload = next(iter(fake_redis.store.values()))
        payload = json.loads(raw_payload)

        self.assertIn(token, preview_sessions._local_preview_sessions)
        self.assertIn("file_path", payload)
        self.assertNotIn("file_b64", payload)
        self.assertTrue(Path(payload["file_path"]).exists())

    def test_confirm_inventory_import_cleans_preview_temp_file(self) -> None:
        file_path = _create_import_file()
        self.created_files.append(file_path)
        with patch("app.services.inventory_import_preview_sessions.get_redis", return_value=None):
            token = preview_sessions.create_inventory_import_preview_session(
                file_path=file_path,
                user_id=7,
                default_storage_location="A-01",
                default_is_hazardous=False,
            )
        preview_file_path = self._get_preview_file_path(token)
        endpoint = _build_confirm_endpoint()
        current_user = User(
            id=7,
            username="operator",
            full_name="操作员",
            role=UserRole.USER,
            is_active=True,
            password_hash="hashed",
            username_version=1,
        )

        with (
            patch("app.services.inventory_import_preview_sessions.get_redis", return_value=None),
            patch("app.services.excel_service.confirm_inventory_import_from_excel") as confirm_import,
            patch("app.api.inventory_extended_routes.clear_cache_by_prefix"),
        ):
            confirm_import.return_value = {
                "success": True,
                "total_rows": 1,
                "created": 1,
                "errors": [],
            }
            response = endpoint(
                body=inventory_extended_routes.InventoryImportConfirmBody(preview_token=token),
                request=_build_confirm_request(),
                background_tasks=BackgroundTasks(),
                current_user=current_user,
                db=MagicMock(),
            )

        self.assertTrue(response["success"])
        self.assertFalse(Path(preview_file_path).exists())

    def test_confirm_with_wrong_user_does_not_delete_owner_preview_file(self) -> None:
        file_path = _create_import_file()
        self.created_files.append(file_path)
        with patch("app.services.inventory_import_preview_sessions.get_redis", return_value=None):
            token = preview_sessions.create_inventory_import_preview_session(
                file_path=file_path,
                user_id=7,
                default_storage_location="A-01",
                default_is_hazardous=False,
            )
        preview_file_path = self._get_preview_file_path(token)
        endpoint = _build_confirm_endpoint()
        wrong_user = User(
            id=8,
            username="other-user",
            full_name="其他用户",
            role=UserRole.USER,
            is_active=True,
            password_hash="hashed",
            username_version=1,
        )

        with self.assertRaises(HTTPException) as exc_info:
            endpoint(
                body=inventory_extended_routes.InventoryImportConfirmBody(preview_token=token),
                request=_build_confirm_request(),
                background_tasks=BackgroundTasks(),
                current_user=wrong_user,
                db=MagicMock(),
            )

        self.assertEqual(exc_info.exception.status_code, 400)
        self.assertTrue(Path(preview_file_path).exists())

    def test_discard_preview_session_cleans_temp_file(self) -> None:
        file_path = _create_import_file()
        self.created_files.append(file_path)
        with patch("app.services.inventory_import_preview_sessions.get_redis", return_value=None):
            token = preview_sessions.create_inventory_import_preview_session(
                file_path=file_path,
                user_id=7,
                default_storage_location=None,
                default_is_hazardous=False,
            )
        preview_file_path = self._get_preview_file_path(token)

        with patch("app.services.inventory_import_preview_sessions.get_redis", return_value=None):
            preview_sessions.discard_inventory_import_preview_session(token)

        self.assertFalse(Path(preview_file_path).exists())

    def test_expired_preview_session_cleans_temp_file(self) -> None:
        file_path = _create_import_file()
        self.created_files.append(file_path)
        with patch("app.services.inventory_import_preview_sessions.get_redis", return_value=None):
            token = preview_sessions.create_inventory_import_preview_session(
                file_path=file_path,
                user_id=7,
                default_storage_location=None,
                default_is_hazardous=False,
            )
        session = preview_sessions._local_preview_sessions[token]
        preview_file_path = self._get_preview_file_path(token)
        preview_sessions._local_preview_sessions[token] = replace(
            session,
            expires_at=get_utc_now() - timedelta(seconds=1),
        )

        with (
            patch("app.services.inventory_import_preview_sessions.get_redis", return_value=None),
            self.assertRaises(ValueError),
        ):
            preview_sessions.consume_inventory_import_preview_session(token, user_id=7)

        self.assertFalse(Path(preview_file_path).exists())

    def test_expired_preview_artifacts_cleanup_survives_restart(self) -> None:
        file_path = _create_import_file()
        self.created_files.append(file_path)
        token = preview_sessions.create_inventory_import_preview_session(
            file_path=file_path,
            user_id=7,
            default_storage_location=None,
            default_is_hazardous=False,
        )
        preview_file_path = file_path

        preview_sessions._local_preview_sessions.clear()
        preview_metadata_file = preview_sessions._preview_session_metadata_path(token)
        payload = json.loads(preview_metadata_file.read_text(encoding="utf-8"))
        payload["expires_at"] = (get_utc_now() - timedelta(seconds=1)).isoformat()
        preview_metadata_file.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

        preview_sessions.cleanup_expired_inventory_import_preview_artifacts()

        self.assertFalse(Path(preview_file_path).exists())
        self.assertFalse(preview_metadata_file.exists())

    def test_cleanup_refuses_unmanaged_preview_file_from_metadata(self) -> None:
        outside_file = tempfile.NamedTemporaryFile(delete=False, suffix=".csv")
        outside_file.write(b"cas_number,name,specification\n64-17-5,x,1ml\n")
        outside_file.close()
        self.created_files.append(outside_file.name)
        token = "unsafe-token"
        metadata_path = preview_sessions._preview_session_metadata_path(token)
        metadata_path.write_text(
            json.dumps(
                {
                    "token": token,
                    "file_path": outside_file.name,
                    "file_suffix": ".csv",
                    "user_id": 7,
                    "default_storage_location": None,
                    "default_is_hazardous": False,
                    "expires_at": (get_utc_now() - timedelta(seconds=1)).isoformat(),
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

        preview_sessions.cleanup_expired_inventory_import_preview_artifacts()

        self.assertTrue(Path(outside_file.name).exists())
        self.assertFalse(metadata_path.exists())

    def test_import_upload_suffix_uses_allowed_extension_only(self) -> None:
        upload = MagicMock(filename="../../evil.csv")

        self.assertEqual(".csv", inventory_extended_routes._get_import_upload_suffix(upload))

    def test_import_upload_suffix_rejects_unknown_extension(self) -> None:
        upload = MagicMock(filename="inventory.exe")

        with self.assertRaises(HTTPException) as exc_info:
            inventory_extended_routes._get_import_upload_suffix(upload)

        self.assertEqual(400, exc_info.exception.status_code)


if __name__ == "__main__":
    unittest.main()
