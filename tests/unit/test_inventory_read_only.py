from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.core.config import Settings, settings
from app.core.read_only import inventory_read_only_middleware, is_read_only_request_allowed
from app.services import audit_logger, search_query_log_service, user_operation_logger
from app.services import search_completion_scheduler as scheduler_module
from app.models.user_operation_log import UserOperationAction


@pytest.mark.parametrize(("raw", "expected", "read_only"), [
    ("off", "off", False),
    ("on", "on", True),
    ("full", "full", False),
    (False, "off", False),
    (True, "full", False),
])
def test_maintenance_mode_uses_one_compatible_setting(raw, expected, read_only):
    configured = Settings(_env_file=None, maintenance_mode=raw)
    assert configured.maintenance_mode == expected
    assert configured.inventory_read_only is read_only


@pytest.mark.parametrize("method,path", [
    ("GET", "/api/inventory/"),
    ("GET", "/api/inventory/1"),
    ("GET", "/api/inventory/export"),
    ("GET", "/api/inventory/code/R123"),
    ("GET", "/api/chemical-info/64-17-5"),
    ("GET", "/api/users/me"),
    ("GET", "/api/runtime/cache-version"),
    ("POST", "/api/users/login"),
    ("POST", "/api/users/login/token"),
    ("POST", "/api/users/logout"),
    ("OPTIONS", "/api/inventory/1"),
])
def test_read_only_allowlist(method, path):
    assert is_read_only_request_allowed(method, path)


@pytest.mark.parametrize("method,path", [
    ("PUT", "/api/inventory/1"),
    ("DELETE", "/api/inventory/1"),
    ("POST", "/api/inventory/manual-add"),
    ("POST", "/api/inventory/1/borrow"),
    ("POST", "/api/inventory/1/return"),
    ("POST", "/api/inventory/import/confirm"),
    ("POST", "/api/search-completions/feedback"),
    ("PUT", "/api/search-completions/preferences"),
    ("GET", "/api/users/"),
    ("GET", "/api/inventory/import/template"),
    ("GET", "/api/inventory/1/unknown"),
    ("GET", "/api/inventory/1/borrow-history"),
    ("GET", "/api/inventory/code/R123/timeline"),
    ("GET", "/api/inventory/cas/64-17-5/total"),
    ("GET", "/api/search-completions/inline"),
    ("POST", "/api/chem/search/substructure"),
    ("GET", "/api/reagent-orders/"),
    ("POST", "/api/users/login/unknown"),
])
def test_read_only_denies_other_business_routes(method, path):
    assert not is_read_only_request_allowed(method, path)


def test_middleware_blocks_before_handler_and_preserves_auth(monkeypatch):
    monkeypatch.setattr(settings, "maintenance_mode", "on")
    application = FastAPI()
    application.middleware("http")(inventory_read_only_middleware)
    calls = []

    def authenticate():
        calls.append("auth")
        from fastapi import HTTPException
        raise HTTPException(status_code=401)

    @application.get("/api/inventory/")
    def inventory_query(user=Depends(authenticate)):
        return []

    @application.post("/api/inventory/1/borrow")
    def borrow():
        calls.append("borrow")
        return {"ok": True}

    client = TestClient(application)
    assert client.get("/api/inventory/").status_code == 401
    assert calls == ["auth"]
    calls.clear()
    assert client.post("/api/inventory/1/borrow").status_code == 503
    assert client.get("/api/inventory/?structure_query=CCO").status_code == 503
    assert client.get("/api/inventory/?structure_match_mode=exact").status_code == 503
    assert calls == []
    monkeypatch.setattr(settings, "maintenance_mode", "off")
    assert client.post("/api/inventory/1/borrow").status_code == 200
    assert calls == ["borrow"]


@pytest.mark.parametrize("mode", ["on", "full"])
def test_maintenance_modes_block_cli_api_with_explicit_code(monkeypatch, mode):
    monkeypatch.setattr(settings, "maintenance_mode", mode)
    application = FastAPI()
    application.middleware("http")(inventory_read_only_middleware)

    @application.get("/api/inventory/")
    def inventory_query():
        return []

    client = TestClient(application)
    response = client.get("/api/inventory/", headers={"X-LSM-Client": "cli"})
    assert response.status_code == 503
    assert response.json() == {
        "detail": "系统维护中，CLI 暂不可用，请稍后再试",
        "code": "CLI_DISABLED_DURING_MAINTENANCE",
    }


def test_maintenance_mode_recognizes_legacy_cli_user_agent(monkeypatch):
    monkeypatch.setattr(settings, "maintenance_mode", "on")
    application = FastAPI()
    application.middleware("http")(inventory_read_only_middleware)

    @application.get("/api/inventory/")
    def inventory_query():
        return []

    response = TestClient(application).get(
        "/api/inventory/",
        headers={"User-Agent": "LabStorageManager CLI"},
    )
    assert response.status_code == 503


def test_read_only_does_not_buffer_or_write_logs(monkeypatch):
    monkeypatch.setattr(settings, "maintenance_mode", "on")
    serialize = Mock(side_effect=AssertionError("must not enqueue"))
    write = Mock(side_effect=AssertionError("must not write"))
    audit = Mock(side_effect=AssertionError("must not open log file"))
    monkeypatch.setattr(search_query_log_service, "_serialize_mapping", serialize)
    monkeypatch.setattr(search_query_log_service, "insert_search_log_rows", write)
    monkeypatch.setattr(audit_logger, "get_audit_logger", audit)
    search_query_log_service.buffer_search_log(
        user_id=1, session_id=1, source="web", endpoint="/inventory/", client_slot="web",
        raw_query="ethanol", filters={}, has_effective_filter=False, sort=None,
        result_count=1, latency_ms=1,
    )
    search_query_log_service._write_ready_batch([SimpleNamespace()])
    audit_logger.log_audit_event("login")
    database = Mock()
    assert user_operation_logger.log_user_operation(
        database, action=UserOperationAction.LOGIN, actor_user_id=1,
        target_user_id=1, is_cli=False,
    ) is None
    database.add.assert_not_called()
    database.flush.assert_not_called()


def test_read_only_scheduler_does_not_initialize_or_rebuild(monkeypatch):
    monkeypatch.setattr(settings, "maintenance_mode", "on")
    initialize = Mock(side_effect=AssertionError("must not initialize"))
    monkeypatch.setattr(scheduler_module, "init_search_completion_db", initialize)
    scheduler = scheduler_module.CompletionScheduler()
    scheduler.start()
    scheduler.run_once()
    assert scheduler._thread is None
    initialize.assert_not_called()
