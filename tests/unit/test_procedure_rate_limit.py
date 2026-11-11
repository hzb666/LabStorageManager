from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api import procedure_inventory_search as api
from app.core.config import Settings
from app.services import rate_limit


def test_default_account_limit_is_five_per_five_minutes(monkeypatch):
    monkeypatch.delenv("PROCEDURE_SEARCH_RATE_LIMIT_COUNT", raising=False)
    monkeypatch.delenv("PROCEDURE_SEARCH_RATE_LIMIT_WINDOW_SECONDS", raising=False)
    settings = Settings(_env_file=None)
    assert settings.procedure_search_rate_limit_count == 5
    assert settings.procedure_search_rate_limit_window_seconds == 300


def test_each_stage_and_account_have_independent_five_request_limits(monkeypatch):
    clock = SimpleNamespace(now=1000.0)
    monkeypatch.setattr(rate_limit, "get_redis", lambda: None)
    monkeypatch.setattr(rate_limit, "_fallback_store", {})
    monkeypatch.setattr(rate_limit, "_fallback_windows", {})
    monkeypatch.setattr(rate_limit.time, "time", lambda: clock.now)
    monkeypatch.setattr(api.settings, "procedure_search_rate_limit_count", 5)
    monkeypatch.setattr(api.settings, "procedure_search_rate_limit_window_seconds", 300)
    for scope in [
        api.PROCEDURE_EXTRACTION_RATE_LIMIT_SCOPE,
        api.PROCEDURE_RESOLUTION_RATE_LIMIT_SCOPE,
        "procedure_inventory_report",
    ]:
        for _ in range(5):
            api._enforce_procedure_rate_limit(scope=scope, user_id=1)
        with pytest.raises(HTTPException) as error:
            api._enforce_procedure_rate_limit(scope=scope, user_id=1)
        assert error.value.status_code == 429
        assert error.value.headers["Retry-After"] == "300"
        api._enforce_procedure_rate_limit(scope=scope, user_id=2)
    clock.now += 300
    api._enforce_procedure_rate_limit(scope=api.PROCEDURE_EXTRACTION_RATE_LIMIT_SCOPE, user_id=1)
