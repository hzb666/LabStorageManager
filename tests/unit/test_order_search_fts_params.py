from sqlalchemy.dialects import sqlite
from sqlmodel import select

from app.api.consumable_orders import ConsumableOrder, _apply_consumable_order_filters
from app.api.reagent_orders import ReagentOrder, _apply_reagent_order_filters
from app.services.search_matchers import TextMatchMode


def _compile_params(statement) -> dict:
    compiled = statement.compile(
        dialect=sqlite.dialect(),
        compile_kwargs={"render_postcompile": True},
    )
    return compiled.params


def test_reagent_order_all_search_uses_distinct_fts_bind_names() -> None:
    statement = _apply_reagent_order_filters(
        select(ReagentOrder),
        None,
        "abc",
        "all",
        False,
        TextMatchMode.CONTAINS,
    )

    params = _compile_params(statement)

    assert "users_match_query" in params
    assert "reagent_order_fts_match_query" in params
    assert "match_query" not in params
    assert params["users_match_query"] != params["reagent_order_fts_match_query"]


def test_consumable_order_all_search_uses_distinct_fts_bind_names() -> None:
    statement = _apply_consumable_order_filters(
        select(ConsumableOrder),
        None,
        "abc",
        "all",
        False,
        TextMatchMode.CONTAINS,
    )

    params = _compile_params(statement)

    assert "users_match_query" in params
    assert "consumable_order_fts_match_query" in params
    assert "match_query" not in params
    assert params["users_match_query"] != params["consumable_order_fts_match_query"]
