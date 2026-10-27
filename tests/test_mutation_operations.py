from __future__ import annotations

import asyncio
import json
import time
from contextlib import asynccontextmanager
from datetime import timedelta
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import APIRouter, FastAPI, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import event
from sqlmodel import Session, SQLModel, create_engine, select

from app.api.mutation_operations import MutationTrackedRoute, router
from app.core.auth import get_current_user
from app.database import DBSession, get_db
from app.models.mutation_operation import MutationOperation
from app.models.user import User


class Change(BaseModel):
    quantity: int


OPERATION_ID = f"{int(time.time() * 1000):012x}_{'a' * 32}"
OTHER_OPERATION_ID = f"{int(time.time() * 1000):012x}_{'b' * 32}"


@pytest.fixture(params=["direct", "included", "nested"])
def operation_app(tmp_path, request):
    engine = create_engine(f"sqlite:///{tmp_path / 'operations.db'}", connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def configure(connection, _record):
        connection.execute("PRAGMA journal_mode=WAL")

    SQLModel.metadata.create_all(engine, tables=[User.__table__, MutationOperation.__table__])
    with Session(engine) as db:
        db.add(User(id=1, username="tester", full_name="Tester", password_hash="unused", username_version=1))
        db.commit()

    app = FastAPI()
    app.router.route_class = MutationTrackedRoute
    app.state.entered = asyncio.Event()
    app.state.release = asyncio.Event()
    app.state.calls = 0

    def database():
        with Session(engine) as db:
            yield db

    def user(request: Request):
        return User(id=int(request.headers.get("X-Test-User", "1")), username="tester", password_hash="unused")

    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_current_user] = user

    business = APIRouter(prefix="/inventory", route_class=MutationTrackedRoute)
    target = app if request.param == "direct" else business
    path = "/api/inventory/manual-add" if request.param == "direct" else "/manual-add"

    @target.post(path, status_code=201)
    async def write(change: Change, db: DBSession, request: Request):
        app.state.calls += 1
        item = db.get(User, 1)
        item.username_version += change.quantity
        db.add(item)
        if request.headers.get("X-Fail") == "before":
            db.flush()
            raise HTTPException(status_code=400, detail="输入不合法")
        db.commit()
        app.state.entered.set()
        if request.headers.get("X-Pause"):
            await app.state.release.wait()
        if request.headers.get("X-Delay"):
            await asyncio.sleep(float(request.headers["X-Delay"]))
        if request.headers.get("X-Fail") == "after":
            raise RuntimeError("response lost after commit")
        return {"id": 1, "quantity": item.username_version}

    if request.param == "included":
        app.include_router(business, prefix="/api")
    elif request.param == "nested":
        parent = APIRouter(prefix="/api")
        parent.include_router(business)
        app.include_router(parent)
    app.include_router(router, prefix="/api")
    yield app, engine
    engine.dispose()


@pytest.fixture
def real_inventory_app(operation_app, monkeypatch):
    from app.api import inventory, inventory_extended_routes

    original, engine = operation_app
    SQLModel.metadata.create_all(engine)
    application = FastAPI()
    application.dependency_overrides.update(original.dependency_overrides)
    application.include_router(inventory.router, prefix="/api")
    application.include_router(router, prefix="/api")
    # 隔离数据库外的通知、索引和外部结构查询，保留真实入库及日志事务。
    monkeypatch.setattr(inventory_extended_routes.sse_manager, "broadcast", AsyncMock())
    monkeypatch.setattr(inventory_extended_routes, "_clear_inventory_cache", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(inventory_extended_routes, "enqueue_structure_cache_resolution", lambda *_args, **_kwargs: None)
    return application, engine


INVENTORY_PAYLOAD = {"cas_number": "64-17-5", "name": "ethanol", "brand": "test", "specification": "500mL"}


def inventory_log_rows(engine):
    from app.models.inventory import Inventory
    from app.models.inventory_operation_log import InventoryOperationLog
    from app.models.log_timeline import LogTimeline

    with Session(engine) as db:
        return (
            db.exec(select(Inventory)).all(),
            db.exec(select(InventoryOperationLog)).all(),
            db.exec(select(LogTimeline)).all(),
        )


@asynccontextmanager
async def client_for(app):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app, raise_app_exceptions=False), base_url="http://test",
    ) as client:
        yield client


def headers(key=OPERATION_ID, **extra):
    return {"Idempotency-Key": key, **extra}


def quantity(engine):
    with Session(engine) as db:
        return db.get(User, 1).username_version


async def test_replaying_a_successful_write_returns_original_result_without_duplicate_business(operation_app):
    app, engine = operation_app
    async with client_for(app) as client:
        first = await client.post("/api/inventory/manual-add", json={"quantity": 2}, headers=headers())
        second = await client.post("/api/inventory/manual-add", json={"quantity": 2}, headers=headers())
        result = await client.get(f"/api/mutation-operations/{OPERATION_ID}")
    assert first.status_code == second.status_code == 201
    assert first.json() == second.json() == {"id": 1, "quantity": 3}
    assert quantity(engine) == 3
    assert app.state.calls == 1
    assert result.json()["state"] == "succeeded"
    assert result.headers["cache-control"] == "no-store"


async def test_commit_is_visible_while_response_is_still_pending_and_concurrent_retry_cannot_write(operation_app):
    app, engine = operation_app
    async with client_for(app) as client:
        pending = asyncio.create_task(client.post(
            "/api/inventory/manual-add", json={"quantity": 2}, headers=headers(**{"X-Pause": "1"}),
        ))
        await asyncio.wait_for(app.state.entered.wait(), timeout=3)
        try:
            status = await client.get(f"/api/mutation-operations/{OPERATION_ID}")
            assert status.json() == {"state": "committed"}
            for _ in range(2):
                duplicate = await client.post("/api/inventory/manual-add", json={"quantity": 2}, headers=headers())
                assert duplicate.status_code == 409
                assert duplicate.headers["x-error-code"] == "OPERATION_PENDING"
            assert quantity(engine) == 3
            assert app.state.calls == 1
        finally:
            app.state.release.set()
            await pending
        completed = await client.get(f"/api/mutation-operations/{OPERATION_ID}")
        assert completed.json()["state"] == "succeeded"


async def test_validation_failure_rolls_back_business_and_replays_original_failure(operation_app):
    app, engine = operation_app
    async with client_for(app) as client:
        failed = await client.post("/api/inventory/manual-add", json={"quantity": 2}, headers=headers(**{"X-Fail": "before"}))
        duplicate = await client.post("/api/inventory/manual-add", json={"quantity": 2}, headers=headers())
        result = await client.get(f"/api/mutation-operations/{OPERATION_ID}")
    assert failed.status_code == duplicate.status_code == 400
    assert duplicate.json() == {"detail": "输入不合法"}
    assert quantity(engine) == 1
    assert app.state.calls == 1
    assert result.json()["state"] == "failed"


async def test_response_failure_after_commit_never_reports_a_rolled_back_write_or_runs_it_again(operation_app):
    app, engine = operation_app
    async with client_for(app) as client:
        failed = await client.post("/api/inventory/manual-add", json={"quantity": 2}, headers=headers(**{"X-Fail": "after"}))
        result = await client.get(f"/api/mutation-operations/{OPERATION_ID}")
        duplicate = await client.post("/api/inventory/manual-add", json={"quantity": 2}, headers=headers())
    assert failed.status_code == 500
    assert result.json() == {"state": "committed"}
    assert duplicate.status_code == 409
    assert quantity(engine) == 3
    assert app.state.calls == 1


async def test_same_key_cannot_change_payload_and_status_is_isolated_by_user(operation_app):
    app, engine = operation_app
    async with client_for(app) as client:
        await client.post("/api/inventory/manual-add", json={"quantity": 2}, headers=headers())
        conflict = await client.post("/api/inventory/manual-add", json={"quantity": 9}, headers=headers())
        hidden = await client.get(f"/api/mutation-operations/{OPERATION_ID}", headers={"X-Test-User": "2"})
        other_user = await client.post("/api/inventory/manual-add", json={"quantity": 2}, headers=headers(**{"X-Test-User": "2"}))
    assert conflict.status_code == 409
    assert hidden.json() == {"state": "missing"}
    assert other_user.status_code == 201
    assert quantity(engine) == 5


async def test_requests_without_operation_header_keep_original_semantics(operation_app):
    app, engine = operation_app
    async with client_for(app) as client:
        first = await client.post("/api/inventory/manual-add", json={"quantity": 2})
        second = await client.post("/api/inventory/manual-add", json={"quantity": 2})
    assert first.status_code == second.status_code == 201
    assert quantity(engine) == 5
    assert app.state.calls == 2


async def test_validation_receipts_do_not_store_rejected_input_or_passwords(operation_app):
    app, _engine = operation_app
    async with client_for(app) as client:
        invalid = await client.post(
            "/api/inventory/manual-add", json={"quantity": "private-input"}, headers=headers(),
        )
        result = await client.get(f"/api/mutation-operations/{OPERATION_ID}")
    assert invalid.status_code == 422
    assert "private-input" in invalid.text
    assert "private-input" not in result.text
    assert result.json()["state"] == "failed"
    assert app.state.calls == 0


def test_commit_proof_survives_an_after_commit_callback_failure(operation_app):
    from app.services.mutation_operations import finish_operation, operation_status, reserve_operation

    _app, engine = operation_app
    with Session(engine) as db:
        context = reserve_operation(db, 1, OTHER_OPERATION_ID, "fingerprint")

        def fail_after_commit(_db):
            raise RuntimeError("post-commit callback failed")

        event.listen(db, "after_commit", fail_after_commit, insert=True)
        db.get(User, 1).username_version = 9
        with pytest.raises(RuntimeError, match="post-commit"):
            db.commit()
        event.remove(db, "after_commit", fail_after_commit)
        finish_operation(context, None)
    with Session(engine) as db:
        assert operation_status(db, 1, OTHER_OPERATION_ID)["state"] == "committed"
        assert db.get(User, 1).username_version == 9


async def test_expired_operation_ids_are_never_executed_again_after_receipt_cleanup(operation_app):
    app, engine = operation_app
    expired_id = f"{int((time.time() - 8 * 86400) * 1000):012x}_{'c' * 32}"
    async with client_for(app) as client:
        response = await client.post("/api/inventory/manual-add", json={"quantity": 2}, headers=headers(expired_id))
    assert response.status_code == 409
    assert response.headers["x-error-code"] == "OPERATION_EXPIRED"
    assert app.state.calls == 0
    assert quantity(engine) == 1


async def test_cleanup_keeps_receipts_until_clock_skewed_operation_ids_expire(operation_app, monkeypatch):
    from app.services import mutation_operations as operations

    app, engine = operation_app
    started_at = operations.get_utc_now()
    started_seconds = time.time()
    future_id = f"{int((started_seconds + 12 * 3600) * 1000):012x}_{'d' * 32}"
    async with client_for(app) as client:
        first = await client.post("/api/inventory/manual-add", json={"quantity": 2}, headers=headers(future_id))
        assert first.status_code == 201

        elapsed = timedelta(days=7, hours=6)
        with monkeypatch.context() as clock:
            clock.setattr(operations, "get_utc_now", lambda: started_at + elapsed)
            clock.setattr(operations.time, "time", lambda: started_seconds + elapsed.total_seconds())
            with Session(engine) as db:
                operations.cleanup_mutation_operations(db)
            replay = await client.post("/api/inventory/manual-add", json={"quantity": 2}, headers=headers(future_id))

        assert replay.status_code == 201
        assert replay.json() == first.json()
        assert app.state.calls == 1
        assert quantity(engine) == 3

        elapsed = timedelta(days=8, hours=6)
        with monkeypatch.context() as clock:
            clock.setattr(operations, "get_utc_now", lambda: started_at + elapsed)
            clock.setattr(operations.time, "time", lambda: started_seconds + elapsed.total_seconds())
            with Session(engine) as db:
                operations.cleanup_mutation_operations(db)
                assert db.get(MutationOperation, (1, future_id)) is None
            expired = await client.post("/api/inventory/manual-add", json={"quantity": 2}, headers=headers(future_id))

        assert expired.status_code == 409
        assert expired.headers["x-error-code"] == "OPERATION_EXPIRED"
        assert app.state.calls == 1


async def test_real_http_timeout_after_commit_recovers_without_a_second_write(operation_app):
    import socket
    import threading

    import uvicorn

    app, engine = operation_app
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    server = uvicorn.Server(uvicorn.Config(app, lifespan="off", log_level="critical"))
    thread = threading.Thread(target=lambda: server.run(sockets=[listener]), daemon=True)
    thread.start()
    try:
        deadline = time.monotonic() + 5
        while not server.started and time.monotonic() < deadline:
            await asyncio.sleep(0.01)
        assert server.started
        async with httpx.AsyncClient(base_url=f"http://127.0.0.1:{listener.getsockname()[1]}") as client:
            with pytest.raises(httpx.ReadTimeout):
                await client.post("/api/inventory/manual-add", json={"quantity": 2},
                                  headers=headers(**{"X-Delay": "0.5"}), timeout=0.15)
            pending = await client.get(f"/api/mutation-operations/{OPERATION_ID}")
            assert pending.json()["state"] == "committed"
            for _ in range(20):
                result = await client.get(f"/api/mutation-operations/{OPERATION_ID}")
                if result.json()["state"] == "succeeded":
                    break
                await asyncio.sleep(0.05)
            assert result.json()["state"] == "succeeded"
            replay = await client.post("/api/inventory/manual-add", json={"quantity": 2}, headers=headers())
            assert replay.json() == {"id": 1, "quantity": 3}
            assert app.state.calls == 1
            assert quantity(engine) == 3
    finally:
        server.should_exit = True
        await asyncio.to_thread(thread.join, 5)
        listener.close()


async def test_real_inventory_router_writes_inventory_and_audit_log_once_across_three_submissions(real_inventory_app, monkeypatch):
    from app.api import inventory_extended_routes
    from app.models.inventory_operation_log import InventoryOperationAction
    from app.models.log_timeline import LogTimelineSourceTable

    application, engine = real_inventory_app
    entered, release = asyncio.Event(), asyncio.Event()

    async def pause_after_commit(*_args, **_kwargs):
        entered.set()
        await release.wait()

    monkeypatch.setattr(inventory_extended_routes.sse_manager, "broadcast", pause_after_commit)
    payload = INVENTORY_PAYLOAD
    async with client_for(application) as client:
        first = asyncio.create_task(client.post("/api/inventory/manual-add", json=payload, headers=headers()))
        try:
            await asyncio.wait_for(entered.wait(), timeout=3)
            for _ in range(2):
                duplicate = await client.post("/api/inventory/manual-add", json=payload, headers=headers())
                assert duplicate.status_code == 409
                assert duplicate.headers["x-error-code"] == "OPERATION_PENDING"
        finally:
            release.set()
            response = await first
        assert response.status_code == 200, response.text
        replay = await client.post("/api/inventory/manual-add", json=payload, headers=headers())
        assert replay.json() == response.json()
        assert response.headers["x-operation-id"] == OPERATION_ID
        status = await client.get(f"/api/mutation-operations/{OPERATION_ID}")
        assert status.json()["state"] == "succeeded"
    items, logs, timeline = inventory_log_rows(engine)
    assert len(items) == len(logs) == len(timeline) == 1
    assert logs[0].inventory_id == items[0].id
    assert logs[0].action == InventoryOperationAction.STOCK_IN
    assert logs[0].operator_id == timeline[0].actor_user_id == 1
    assert timeline[0].source_table == LogTimelineSourceTable.INVENTORY_OPERATION_LOG
    assert timeline[0].source_log_id == logs[0].id
    snapshot = json.loads(logs[0].snapshot_json)
    assert snapshot["id"] == items[0].id
    assert snapshot["na"] == payload["name"]
    assert snapshot["ca"] == payload["cas_number"]


async def test_inventory_and_both_logs_roll_back_when_log_projection_fails(real_inventory_app, monkeypatch):
    from app.services import inventory_operation_logger

    application, engine = real_inventory_app
    project = inventory_operation_logger.project_inventory_operation_log

    def fail_after_projection(*args, **kwargs):
        project(*args, **kwargs)
        raise RuntimeError("log projection failed before commit")

    monkeypatch.setattr(inventory_operation_logger, "project_inventory_operation_log", fail_after_projection)
    async with client_for(application) as client:
        failed = await client.post("/api/inventory/manual-add", json=INVENTORY_PAYLOAD, headers=headers())
        retry = await client.post("/api/inventory/manual-add", json=INVENTORY_PAYLOAD, headers=headers())
        status = await client.get(f"/api/mutation-operations/{OPERATION_ID}")
    assert failed.status_code == 500
    assert retry.status_code == 409
    assert status.json() == {"state": "uncertain"}
    assert inventory_log_rows(engine) == ([], [], [])


@pytest.mark.parametrize("failure", ["notification", "receipt"])
async def test_committed_business_and_logs_are_never_repeated_after_finalization_fails(real_inventory_app, monkeypatch, failure):
    from app.api import inventory_extended_routes
    from app.services import mutation_operations

    application, engine = real_inventory_app
    if failure == "notification":
        monkeypatch.setattr(inventory_extended_routes.sse_manager, "broadcast", AsyncMock(side_effect=RuntimeError("SSE failed")))
    else:
        def fail_receipt(*_args):
            raise RuntimeError("response persistence failed")

        monkeypatch.setattr(mutation_operations, "_save_response", fail_receipt)
    async with client_for(application) as client:
        first = await client.post("/api/inventory/manual-add", json=INVENTORY_PAYLOAD, headers=headers())
        assert first.status_code == (500 if failure == "notification" else 200)
        for _ in range(2):
            retry = await client.post("/api/inventory/manual-add", json=INVENTORY_PAYLOAD, headers=headers())
            assert retry.status_code == 409
            assert retry.headers["x-error-code"] == "OPERATION_PENDING"
        status = await client.get(f"/api/mutation-operations/{OPERATION_ID}")
    assert status.json() == {"state": "committed"}
    assert [len(rows) for rows in inventory_log_rows(engine)] == [1, 1, 1]


async def test_simultaneous_inventory_submissions_create_only_one_business_log_and_timeline(real_inventory_app):
    application, engine = real_inventory_app
    async with client_for(application) as client:
        responses = await asyncio.gather(*(
            client.post("/api/inventory/manual-add", json=INVENTORY_PAYLOAD, headers=headers())
            for _ in range(8)
        ))
        assert any(response.status_code == 200 for response in responses)
        assert all(response.status_code in {200, 409} for response in responses)
        confirmed = await client.post("/api/inventory/manual-add", json=INVENTORY_PAYLOAD, headers=headers())
        assert confirmed.status_code == 200
        for response in responses:
            if response.status_code == 200:
                assert response.json() == confirmed.json()
    assert [len(rows) for rows in inventory_log_rows(engine)] == [1, 1, 1]


@pytest.mark.parametrize("module_name", [
    "inventory", "reagent_orders", "consumable_orders", "common_shelf", "chemical_name_map",
    "reagent_brands", "announcements", "users", "chem",
])
def test_business_modules_register_tracked_routes_without_wrapping_excluded_endpoints(module_name):
    from importlib import import_module

    from app.api.mutation_operations import WRITE_METHODS, supports_operation

    business_router = import_module(f"app.api.{module_name}").router
    tracked = []
    for route in business_router.routes:
        if not getattr(route, "methods", set()).intersection(WRITE_METHODS):
            continue
        expected = supports_operation(f"/api{route.path}")
        assert isinstance(route, MutationTrackedRoute)
        assert route.tracks_operation is expected, route.path
        if expected:
            tracked.append(route.path)
    assert tracked
