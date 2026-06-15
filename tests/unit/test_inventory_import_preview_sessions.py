from __future__ import annotations

import os
from uuid import uuid4

import pytest

from app.services.inventory_import_preview_sessions import (
    consume_inventory_import_preview_session,
    create_inventory_import_preview_session,
    get_inventory_import_preview_dir,
    reset_inventory_import_preview_sessions,
)


def _create_temp_import_file() -> str:
    file_path = get_inventory_import_preview_dir() / f"import-preview-{uuid4().hex}.csv"
    file_path.write_text("cas_number,name,specification\n64-17-5,乙醇,500ml\n", encoding="utf-8")
    return str(file_path)


def test_preview_session_can_only_be_consumed_once_by_same_user() -> None:
    file_path = _create_temp_import_file()
    reset_inventory_import_preview_sessions()

    try:
        token = create_inventory_import_preview_session(
            file_path=file_path,
            user_id=7,
            default_storage_location="A-01",
            default_is_hazardous=True,
        )

        session = consume_inventory_import_preview_session(token, user_id=7)

        assert session.file_path == file_path
        assert session.default_storage_location == "A-01"
        assert session.default_is_hazardous is True
        assert os.path.exists(file_path)

        with pytest.raises(ValueError, match="invalid or expired"):
            consume_inventory_import_preview_session(token, user_id=7)
    finally:
        if os.path.exists(file_path):
            os.remove(file_path)
        reset_inventory_import_preview_sessions()


def test_preview_session_rejects_other_user() -> None:
    file_path = _create_temp_import_file()
    reset_inventory_import_preview_sessions()

    try:
        token = create_inventory_import_preview_session(
            file_path=file_path,
            user_id=7,
            default_storage_location=None,
            default_is_hazardous=False,
        )

        with pytest.raises(ValueError, match="invalid or expired"):
            consume_inventory_import_preview_session(token, user_id=8)

        assert os.path.exists(file_path)
    finally:
        if os.path.exists(file_path):
            os.remove(file_path)
        reset_inventory_import_preview_sessions()
