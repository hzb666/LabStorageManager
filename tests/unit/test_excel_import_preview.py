from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path
from uuid import uuid4

import pandas as pd
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.core import time_utils
from app.models.inventory import Inventory
from app.services import excel_service
from app.services.excel_service import (
    confirm_inventory_import_from_excel,
    preview_inventory_import_from_excel,
)


def _write_import_csv(tmp_path: Path, rows: list[dict]) -> str:
    file_path = tmp_path / "inventory-import.csv"
    pd.DataFrame(rows).to_csv(file_path, index=False, encoding="utf-8-sig")
    return str(file_path)


def _create_import_file(rows: list[dict]) -> str:
    file_path = Path.cwd() / "tests" / "unit" / f"inventory-import-{uuid4().hex}.csv"
    pd.DataFrame(rows).to_csv(file_path, index=False, encoding="utf-8-sig")
    return str(file_path)


def _build_session() -> Session:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    return Session(engine)


def test_preview_inventory_import_collects_all_row_errors(
    monkeypatch,
) -> None:
    file_path = _create_import_file(
        [
            {"cas_number": "64-17-5", "name": "", "specification": "500ml"},
            {
                "cas_number": "64-17-5",
                "name": "乙醇",
                "specification": "500ml",
                "remaining_quantity": "600",
            },
            {"cas_number": "64-17-5", "name": "触发构建失败", "specification": "500ml"},
            {
                "cas_number": "64-17-5",
                "name": "丙酮",
                "specification": "500ml",
                "brand": "Sigma",
                "category": "溶剂",
                "storage_location": "A-01",
                "remaining_quantity": "200",
            },
        ],
    )

    original_build = excel_service._build_inventory_from_import_row

    def fake_build(context, row):
        if str(row["name"]).strip() == "触发构建失败":
            raise ValueError("构建失败")
        return original_build(context, row)

    monkeypatch.setattr(excel_service, "_build_inventory_from_import_row", fake_build)

    try:
        with _build_session() as db:
            result = preview_inventory_import_from_excel(
                db=db,
                file_path=file_path,
                user_id=1,
            )

            assert result["success"] is False
            assert result["created"] == 0
            assert result["total_rows"] == 4
            assert result["preview_items"] == [
                {
                    "row": 5,
                    "cas_number": "64-17-5",
                    "name": "丙酮",
                    "brand": "Sigma",
                    "category": "溶剂",
                    "specification": "500 mL",
                    "remaining_quantity": 200.0,
                    "storage_location": "A-01",
                }
            ]
            assert result["errors"] == [
                {"row": 2, "error": "Missing required field: name"},
                {
                    "row": 3,
                    "error": "Invalid remaining_quantity: 600.0 cannot exceed initial_quantity 500.0",
                },
                {"row": 4, "error": "构建失败"},
            ]
            assert db.exec(select(Inventory)).all() == []
    finally:
        if os.path.exists(file_path):
            os.remove(file_path)


def test_confirm_inventory_import_refuses_to_write_when_preview_has_errors() -> None:
    file_path = _create_import_file(
        [
            {"cas_number": "64-17-5", "name": "", "specification": "500ml"},
            {"cas_number": "64-17-5", "name": "乙醇", "specification": "500ml"},
        ],
    )

    try:
        with _build_session() as db:
            result = confirm_inventory_import_from_excel(
                db=db,
                file_path=file_path,
                user_id=1,
            )

            assert result["success"] is False
            assert result["created"] == 0
            assert result["total_rows"] == 2
            assert result["errors"] == [{"row": 2, "error": "Missing required field: name"}]
            assert db.exec(select(Inventory)).all() == []
    finally:
        if os.path.exists(file_path):
            os.remove(file_path)


def test_confirm_inventory_import_stores_created_at_as_utc_without_shifting_internal_code_date(
    monkeypatch,
) -> None:
    file_path = _create_import_file(
        [
            {
                "cas_number": "64-17-5",
                "name": "乙醇",
                "specification": "500ml",
                "created_at": "2025-01-13 00:30:00",
            },
        ],
    )
    monkeypatch.setattr(time_utils.settings, "display_utc_offset", "+08:00")

    try:
        with _build_session() as db:
            result = confirm_inventory_import_from_excel(
                db=db,
                file_path=file_path,
                user_id=1,
            )

            created_items = db.exec(select(Inventory)).all()

            assert result["success"] is True
            assert result["created"] == 1
            assert len(created_items) == 1
            assert created_items[0].created_at == datetime(2025, 1, 12, 16, 30, 0)
            assert created_items[0].internal_code.startswith("64175-250113-")
    finally:
        if os.path.exists(file_path):
            os.remove(file_path)
