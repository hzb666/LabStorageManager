from __future__ import annotations

import unittest

from fastapi import HTTPException
from sqlalchemy import create_engine, text
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel
from starlette.requests import Request

import app.models  # noqa: F401 - populate SQLModel metadata for the test database.
from app.api.consumable_orders import CONSUMABLE_ORDER_SORT_FIELD_MAP
from app.api.inventory import InventoryListQuery, _build_inventory_order_expr, list_inventory
from app.api.reagent_orders import (
    REAGENT_ORDER_SORT_FIELD_MAP,
    VALID_REAGENT_SEARCH_FIELDS,
    VALID_REAGENT_SORT_FIELDS,
    ReagentOrderListQuery,
    list_reagent_orders,
)
from app.core.api_errors import API_ERROR_CODE_HEADER, ApiErrorCode
from app.db_bootstrap.schema_consistency import check_sqlite_schema_consistency
from app.db_bootstrap.sqlite_indexes import ensure_sqlite_performance_indexes
from app.models.consumable_order import ConsumableOrder
from app.models.reagent_order import ReagentOrder


class InventoryListContractsTests(unittest.TestCase):
    def test_reagent_order_category_is_not_a_list_sort_field(self) -> None:
        self.assertNotIn("category", VALID_REAGENT_SORT_FIELDS)
        self.assertNotIn("category", REAGENT_ORDER_SORT_FIELD_MAP)

    def test_reagent_order_category_search_field_is_rejected(self) -> None:
        self.assertNotIn("category", VALID_REAGENT_SEARCH_FIELDS)
        request = Request(
            {
                "type": "http",
                "method": "GET",
                "path": "/api/reagent-orders/",
                "headers": [],
            }
        )

        with self.assertRaises(HTTPException) as context:
            list_reagent_orders(
                request=request,
                db=None,
                query=ReagentOrderListQuery(search="solvent", search_field="category"),
                current_session=(object(), object()),
            )

        self.assertEqual(400, context.exception.status_code)
        self.assertEqual("Invalid search field", context.exception.detail)
        self.assertEqual(
            {API_ERROR_CODE_HEADER: ApiErrorCode.INVALID_SEARCH_FIELD},
            context.exception.headers,
        )

    def test_order_display_fields_sort_by_pinyin_columns(self) -> None:
        self.assertIs(REAGENT_ORDER_SORT_FIELD_MAP["name"], ReagentOrder.name_pinyin)
        self.assertIs(REAGENT_ORDER_SORT_FIELD_MAP["brand"], ReagentOrder.brand_pinyin)
        self.assertIs(CONSUMABLE_ORDER_SORT_FIELD_MAP["name"], ConsumableOrder.name_pinyin)

    def test_pinyin_sort_uses_native_nulls_last_and_existing_index(self) -> None:
        engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        SQLModel.metadata.create_all(engine)
        try:
            with engine.begin() as connection:
                ensure_sqlite_performance_indexes(connection)
                statement = (
                    "EXPLAIN QUERY PLAN SELECT id FROM inventory "
                    "ORDER BY brand_pinyin ASC NULLS LAST, created_at DESC, id DESC LIMIT 50"
                )
                plan = " ".join(str(row) for row in connection.execute(text(statement)).all())
            self.assertIn("ix_inventory_brand_pinyin_created_at_id", plan)
            self.assertNotIn("USE TEMP B-TREE", plan)

        finally:
            SQLModel.metadata.drop_all(engine)

    def test_pinyin_sort_expression_places_nulls_last(self) -> None:
        order_expr = _build_inventory_order_expr("brand", "asc")
        compiled = str(order_expr[0].compile(compile_kwargs={"literal_binds": True}))

        self.assertEqual("inventory.brand_pinyin ASC NULLS LAST", compiled)

    def test_cas_sort_uses_plain_column_order(self) -> None:
        ascending = _build_inventory_order_expr("cas_number", "asc")
        descending = _build_inventory_order_expr("cas_number", "desc")

        self.assertEqual("inventory.cas_number ASC NULLS LAST", str(ascending[0].compile()))
        self.assertEqual("inventory.cas_number DESC", str(descending[0].compile()))

    def test_descending_pinyin_indexes_match_list_sorting(self) -> None:
        engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        SQLModel.metadata.create_all(engine)
        expected_indexes = {
            "inventory": (
                "ix_inventory_cas_number_desc_created_at_id",
                "ix_inventory_name_pinyin_desc_created_at_id",
                "ix_inventory_category_pinyin_desc_created_at_id",
                "ix_inventory_brand_pinyin_desc_created_at_id",
                "ix_inventory_storage_location_pinyin_desc_created_at_id",
            ),
            "reagent_order": (
                "ix_reagent_order_cas_number_desc_created_at_id",
                "ix_reagent_order_name_pinyin_desc_created_at_id",
                "ix_reagent_order_brand_pinyin_desc_created_at_id",
            ),
            "consumable_order": ("ix_consumable_order_name_pinyin_desc_created_at_id",),
        }
        try:
            with engine.begin() as connection:
                ensure_sqlite_performance_indexes(connection)
                for table_name, index_names in expected_indexes.items():
                    for index_name in index_names:
                        ddl = connection.execute(
                            text(
                                "SELECT sql FROM sqlite_master "
                                "WHERE type='index' AND name=:index_name"
                            ),
                            {"index_name": index_name},
                        ).scalar_one()
                        self.assertIn("DESC, created_at DESC, id DESC", ddl)
        finally:
            SQLModel.metadata.drop_all(engine)

    def test_schema_consistency_accepts_directional_indexes(self) -> None:
        engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        SQLModel.metadata.create_all(engine)
        try:
            with engine.begin() as connection:
                ensure_sqlite_performance_indexes(connection)
                check_sqlite_schema_consistency(connection)
        finally:
            SQLModel.metadata.drop_all(engine)

    def test_invalid_search_field_is_rejected(self) -> None:
        query = InventoryListQuery(search="solvent", search_field="category")
        request = Request({"type": "http", "method": "GET", "path": "/api/inventory/", "headers": []})

        with self.assertRaises(HTTPException) as context:
            list_inventory(
                request=request,
                db=None,
                query=query,
                current_session=(object(), object()),
            )

        self.assertEqual(400, context.exception.status_code)
        self.assertEqual("Invalid search field", context.exception.detail)
        self.assertEqual(
            {API_ERROR_CODE_HEADER: ApiErrorCode.INVALID_SEARCH_FIELD},
            context.exception.headers,
        )

    def test_created_at_ascending_indexes_have_descending_id_tiebreakers(self) -> None:
        engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        SQLModel.metadata.create_all(engine)
        try:
            index_names = (
                "ix_inventory_created_at_asc_id_desc",
                "ix_reagent_order_created_at_asc_id_desc",
                "ix_consumable_order_created_at_asc_id_desc",
            )
            with engine.connect() as connection:
                for index_name in index_names:
                    ddl = connection.execute(
                        text(
                            "SELECT sql FROM sqlite_master "
                            "WHERE type='index' AND name=:index_name"
                        ),
                        {"index_name": index_name},
                    ).scalar_one()
                    self.assertIn("(created_at ASC, id DESC)", ddl)
        finally:
            SQLModel.metadata.drop_all(engine)

    def test_bootstrap_repairs_mixed_direction_index(self) -> None:
        engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        SQLModel.metadata.create_all(engine)
        try:
            with engine.begin() as connection:
                connection.execute(text("DROP INDEX ix_inventory_created_at_asc_id_desc"))
                connection.execute(
                    text(
                        "CREATE INDEX ix_inventory_created_at_asc_id_desc "
                        "ON inventory (created_at ASC, id ASC)"
                    )
                )
                ensure_sqlite_performance_indexes(connection)
                ddl = connection.execute(
                    text(
                        "SELECT sql FROM sqlite_master "
                        "WHERE type='index' AND name='ix_inventory_created_at_asc_id_desc'"
                    )
                ).scalar_one()
            self.assertIn("(created_at ASC, id DESC)", ddl)
        finally:
            SQLModel.metadata.drop_all(engine)


if __name__ == "__main__":
    unittest.main()
