from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi.encoders import jsonable_encoder
from starlette.requests import Request

from app.api import consumable_orders, reagent_orders
from app.models.consumable_order import ConsumableOrder
from app.models.reagent_order import ReagentOrder


@pytest.mark.parametrize("kind", ["reagent", "consumable"])
@pytest.mark.parametrize("hour", [16, 17, 18, 23])
def test_order_list_preserves_utc_time_on_cache_miss_and_hit(monkeypatch, kind, hour):
    module = reagent_orders if kind == "reagent" else consumable_orders
    model = ReagentOrder if kind == "reagent" else ConsumableOrder
    query_model = getattr(module, f"{model.__name__}ListQuery")
    list_orders = getattr(module, f"list_{kind}_orders")
    stamp = datetime(2026, 10, 3, hour, 30)
    order = model(
        id=1,
        name="Time test",
        cas_number="64-17-5",
        specification="500mL",
        quantity=1,
        price=1,
        created_at=stamp,
        updated_at=stamp,
    )
    db = MagicMock()
    db.exec.return_value.one.return_value = 1
    db.exec.return_value.all.return_value = [order]
    monkeypatch.setattr(module, "SEARCH_CACHE", {})
    monkeypatch.setattr(module, "batch_get_user_names", lambda *_: {})
    monkeypatch.setattr(module, f"get_{kind}_order_status_times", lambda *_: {})
    monkeypatch.setattr(module, "buffer_search_log", lambda **_: None)
    request = Request({"type": "http", "method": "GET", "path": "/", "headers": []})
    session = (None, SimpleNamespace(user_id=1, id=1))

    for _attempt in range(2):
        result = list_orders(request, db, query_model(), session)
        row = jsonable_encoder(result)["data"][0]
        for field in ("created_at", "updated_at"):
            assert row[field] == f"2026-10-03T{hour:02d}:30:00Z"
            display_time = datetime.fromisoformat(row[field]).astimezone(timezone(timedelta(hours=8)))
            assert display_time.day == 4
            assert display_time.hour == hour - 16

    assert db.exec.call_count == 2


def test_arrived_orders_preserve_utc_time():
    endpoint = next(
        route.endpoint
        for route in reagent_orders.router.routes
        if route.path.endswith("/dashboard/arrived-orders")
    )
    stamp = datetime(2026, 10, 3, 17, 30)
    order = ReagentOrder(id=1, name="Time test", cas_number="64-17-5", updated_at=stamp)
    db = MagicMock()
    db.exec.return_value.all.return_value = [order]

    result = jsonable_encoder(endpoint(db))

    assert result["data"][0]["arrived_at"] == "2026-10-03T17:30:00Z"
