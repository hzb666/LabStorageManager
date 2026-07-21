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
    generate_excel_template,
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


def test_generated_excel_template_can_be_previewed_without_header_changes(tmp_path: Path) -> None:
    file_path = tmp_path / "inventory-import-template.xlsx"
    file_path.write_bytes(generate_excel_template())

    with _build_session() as db:
        result = preview_inventory_import_from_excel(
            db=db,
            file_path=str(file_path),
            user_id=1,
        )

    assert result["success"] is True
    assert result["total_rows"] == 1
    assert result["valid_rows"] == 1
    assert result["preview_items"][0]["cas_number"] == "64-17-5"


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


def test_preview_rejects_values_outside_inventory_constraints(tmp_path: Path) -> None:
    file_path = _write_import_csv(
        tmp_path,
        [
            {
                "cas_number": "64-17-5",
                "name": "负库存",
                "specification": "500ml",
                "remaining_quantity": -1,
            },
            {
                "cas_number": "64-17-5",
                "name": "无限库存",
                "specification": "500ml",
                "remaining_quantity": "inf",
            },
            {
                "cas_number": "64-17-5",
                "name": "非数值库存",
                "specification": "500ml",
                "remaining_quantity": "NaN",
            },
            {
                "cas_number": "64-17-5",
                "name": "危险品值错误",
                "specification": "500ml",
                "is_hazardous": "maybe",
            },
            {
                "cas_number": "64-17-5",
                "name": "日期错误",
                "specification": "500ml",
                "created_at": "not-a-date",
            },
            {
                "cas_number": "64-17-5",
                "name": "x" * 201,
                "specification": "500ml",
            },
            {
                "cas_number": "64-17-5",
                "name": "品牌过长",
                "brand": "x" * 101,
                "specification": "500ml",
            },
            {
                "cas_number": "64-17-5",
                "name": "英文名过长",
                "english_name": "x" * 201,
                "specification": "500ml",
            },
            {
                "cas_number": "64-17-5",
                "name": "别名过长",
                "alias": "x" * 201,
                "specification": "500ml",
            },
            {
                "cas_number": "64-17-5",
                "name": "分类过长",
                "category": "x" * 101,
                "specification": "500ml",
            },
            {
                "cas_number": "64-17-5",
                "name": "规格过长",
                "specification": f"1{'0' * 48}ml",
            },
            {
                "cas_number": "64-17-5",
                "name": "位置过长",
                "storage_location": "x" * 201,
                "specification": "500ml",
            },
            {
                "cas_number": "64-17-5",
                "name": "备注过长",
                "notes": "x" * 501,
                "specification": "500ml",
            },
        ],
    )

    with _build_session() as db:
        result = preview_inventory_import_from_excel(
            db=db,
            file_path=file_path,
            user_id=1,
        )

    assert result["success"] is False
    assert result["valid_rows"] == 0
    assert result["errors"] == [
        {"row": 2, "error": "Invalid remaining_quantity: cannot be negative"},
        {"row": 3, "error": "Invalid remaining_quantity: must be a finite number"},
        {"row": 4, "error": "Invalid remaining_quantity: must be a finite number"},
        {"row": 5, "error": "Invalid is_hazardous: expected true/false or 1/0"},
        {"row": 6, "error": "Invalid created_at: expected a valid date"},
        {"row": 7, "error": "Invalid name: must not exceed 200 characters"},
        {"row": 8, "error": "Invalid brand: must not exceed 100 characters"},
        {"row": 9, "error": "Invalid english_name: must not exceed 200 characters"},
        {"row": 10, "error": "Invalid alias: must not exceed 200 characters"},
        {"row": 11, "error": "Invalid category: must not exceed 100 characters"},
        {"row": 12, "error": "Invalid specification: must not exceed 50 characters"},
        {"row": 13, "error": "Invalid storage_location: must not exceed 200 characters"},
        {"row": 14, "error": "Invalid notes: must not exceed 500 characters"},
    ]


def test_preview_accepts_optional_brand_and_supported_boolean_values(tmp_path: Path) -> None:
    file_path = _write_import_csv(
        tmp_path,
        [
            {
                "cas_number": "64-17-5",
                "name": "乙醇",
                "specification": "500ml",
                "is_hazardous": "yes",
            },
            {
                "cas_number": "67-64-1",
                "name": "丙酮",
                "specification": "1L",
                "is_hazardous": 0,
            },
        ],
    )

    with _build_session() as db:
        result = preview_inventory_import_from_excel(
            db=db,
            file_path=file_path,
            user_id=1,
        )

    assert result["success"] is True
    assert result["valid_rows"] == 2
    assert [item["brand"] for item in result["preview_items"]] == [None, None]


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
