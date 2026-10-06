from __future__ import annotations

import importlib
from pathlib import Path

import bcrypt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from sqlmodel import SQLModel, Session, create_engine

import app.models  # noqa: F401
from app.core.config import settings
from app.models.compound_structure import CompoundStructureCache, CompoundStructureStatus
from app.models.inventory import Inventory
from app.models.user import User, UserRole
from app.read_only import snapshot
from app.read_only.database import snapshot_engine


@pytest.fixture
def read_only_snapshot(tmp_path, monkeypatch):
    source = tmp_path / "source.db"
    target = tmp_path / "snapshot.db"
    source_engine = create_engine(f"sqlite:///{source}")
    SQLModel.metadata.create_all(source_engine)
    with Session(source_engine) as db:
        user = User(
            username="reader",
            full_name="只读用户",
            role=UserRole.USER,
            is_active=True,
            password_hash=bcrypt.hashpw(b"password123", bcrypt.gensalt()).decode(),
        )
        db.add(user)
        db.flush()
        db.add(Inventory(
            internal_code="64-17-5-260101-001",
            cas_number="64-17-5",
            name="乙醇",
            brand="测试品牌",
            storage_location="A1",
            initial_quantity=500,
            remaining_quantity=400,
            remaining_percent=0.8,
            unit="mL",
            created_by_id=user.id,
        ))
        db.add(CompoundStructureCache(
            cas_number="64-17-5",
            smiles_canonical="CCO",
            english_name="ethanol",
            status=CompoundStructureStatus.RESOLVED,
        ))
        db.commit()
    source_engine.dispose()

    monkeypatch.setattr(settings, "read_only_snapshot_path", str(target))
    monkeypatch.setattr(settings, "algorithm", "HS256")
    monkeypatch.setattr(settings, "secret_key", "read-only-test-secret-with-at-least-32-bytes")
    monkeypatch.setattr(settings, "env", "development")
    metadata = snapshot.create_snapshot(source_path=source, snapshot_path=target)
    return source, target, metadata


def test_snapshot_is_consistent_and_atomic(read_only_snapshot):
    source, target, first = read_only_snapshot
    verified = snapshot.verify_snapshot(target)
    assert verified == first
    assert verified.inventory_count == 1

    with create_engine(f"sqlite:///{source}").begin() as connection:
        connection.execute(text("UPDATE inventory SET name = '无水乙醇'"))
    second = snapshot.create_snapshot(source_path=source, snapshot_path=target)
    assert second.snapshot_id != first.snapshot_id
    assert snapshot.verify_snapshot(target) == second


def test_read_only_app_auth_queries_and_rejects_writes(read_only_snapshot):
    _source, target, metadata = read_only_snapshot
    read_only_main = importlib.import_module("app.read_only.main")
    before_mtime = target.stat().st_mtime_ns
    with TestClient(read_only_main.app) as client:
        blocked_cli = client.get(
            "/api/runtime/cache-version",
            headers={"X-LSM-Client": "cli"},
        )
        assert blocked_cli.status_code == 503
        assert blocked_cli.json()["code"] == "CLI_DISABLED_DURING_MAINTENANCE"

        runtime = client.get("/api/runtime/cache-version")
        assert runtime.status_code == 200
        assert runtime.json()["snapshot_created_at"] == metadata.created_at

        assert client.get("/api/inventory/").status_code == 401
        login = client.post("/api/users/login", json={
            "username": "reader",
            "password": "password123",
            "device_id": "test",
            "device_name": "test",
        })
        assert login.status_code == 200
        assert login.json()["user"]["username"] == "reader"

        listing = client.get("/api/inventory/", params={"search": "乙醇"})
        assert listing.status_code == 200
        assert listing.json()["total"] == 1
        assert listing.json()["data"][0]["temporary_keeper_name"] is None

        detail = client.get("/api/inventory/code/64-17-5-260101-001")
        assert detail.status_code == 200
        assert detail.json()["name"] == "乙醇"

        detail_by_id = client.get("/api/inventory/1")
        assert detail_by_id.status_code == 200
        assert detail_by_id.json()["internal_code"] == "64-17-5-260101-001"

        chemical_info = client.get("/api/chemical-info/64-17-5", params={
            "skip_chinese": True,
            "cache_only": True,
        })
        assert chemical_info.status_code == 200
        assert chemical_info.json()["smiles"] == "CCO"

        export = client.get("/api/inventory/export")
        assert export.status_code == 200
        assert export.headers["content-type"].startswith(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )

        assert client.post("/api/inventory/1/borrow").status_code == 503
        assert client.post("/api/search-completions/feedback").status_code == 503
        assert client.get("/api/inventory/1/borrow-history").status_code == 404
        assert client.get("/api/search-completions/inline").status_code == 404

        assert client.post("/api/users/logout").status_code == 200
        assert client.get("/api/inventory/").status_code == 401

    assert target.stat().st_mtime_ns == before_mtime


def test_snapshot_engine_rejects_sql_writes(read_only_snapshot):
    with snapshot_engine.connect() as connection:
        with pytest.raises(OperationalError):
            connection.execute(text("UPDATE inventory SET name = 'forbidden'"))
