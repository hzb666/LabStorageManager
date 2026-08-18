from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, patch

from fastapi import BackgroundTasks, HTTPException
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine, select
from starlette.requests import Request

import app.models  # noqa: F401 - populate SQLModel metadata for the test database.
from app.api import reagent_orders
from app.api import chemical_name_map
from app.api import reagent_orders_workflow
from app.core.api_errors import API_ERROR_CODE_HEADER, ApiErrorCode
from app.models.chemical_name_map import ChemicalNameMap
from app.models.reagent_order import (
    ReagentOrder,
    ReagentOrderCreate,
    ReagentOrderReason,
    ReagentOrderStatus,
    ReagentOrderUpdate,
)
from app.models.user import User, UserRole


COMMON_PUBLIC_ERROR = "Common-public orders require CAS master data"


def _build_request(path: str) -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": path,
            "headers": [],
            "client": ("127.0.0.1", 12345),
        }
    )


class ReagentOrderCommonPublicValidationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        SQLModel.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.user = User(
            username="applicant",
            full_name="Applicant",
            role=UserRole.USER,
            is_active=True,
            password_hash="hashed",
            username_version=1,
        )
        self.db.add(self.user)
        self.db.commit()
        self.db.refresh(self.user)

    async def asyncTearDown(self) -> None:
        self.db.close()
        SQLModel.metadata.drop_all(self.engine)

    @staticmethod
    def _create_payload(
        *,
        cas_number: str = "64-17-5",
        order_reason: ReagentOrderReason = ReagentOrderReason.COMMON_PUBLIC,
    ) -> ReagentOrderCreate:
        return ReagentOrderCreate(
            cas_number=cas_number,
            name="Ethanol",
            brand="Sigma",
            specification="500 ml",
            quantity=1,
            price=100,
            order_reason=order_reason,
        )

    async def _create_order(self, payload: ReagentOrderCreate) -> ReagentOrder:
        with (
            patch.object(reagent_orders, "log_reagent_order_create"),
            patch.object(reagent_orders, "_clear_reagent_order_cache"),
            patch.object(reagent_orders, "enqueue_structure_cache_resolution"),
            patch.object(reagent_orders.sse_manager, "broadcast", new=AsyncMock()),
        ):
            return await reagent_orders.create_reagent_order(
                order=payload,
                request=_build_request("/api/reagent-orders/"),
                background_tasks=BackgroundTasks(),
                current_user=self.user,
                db=self.db,
            )

    async def _assert_common_public_validation_error(self, awaitable) -> None:
        with self.assertRaises(HTTPException) as context:
            await awaitable

        self.assertEqual(422, context.exception.status_code)
        self.assertEqual(
            [
                {
                    "loc": ["body", "order_reason"],
                    "msg": COMMON_PUBLIC_ERROR,
                    "type": "value_error",
                }
            ],
            context.exception.detail,
        )
        self.assertTrue(COMMON_PUBLIC_ERROR.isascii())

    def _add_master_data(self, cas_number: str) -> ChemicalNameMap:
        row = ChemicalNameMap(cas_number=cas_number, name="Ethanol")
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return row

    def _add_order(
        self,
        *,
        cas_number: str,
        order_reason: ReagentOrderReason,
    ) -> ReagentOrder:
        order = ReagentOrder(
            cas_number=cas_number,
            name="Ethanol",
            brand="Sigma",
            initial_quantity=500,
            unit="ml",
            quantity=1,
            price=100,
            order_reason=order_reason,
            applicant_id=self.user.id,
        )
        self.db.add(order)
        self.db.commit()
        self.db.refresh(order)
        return order

    async def test_create_common_public_succeeds_when_cas_master_data_exists(self) -> None:
        self._add_master_data("64-17-5")

        created = await self._create_order(self._create_payload())

        self.assertIsNotNone(created.id)
        self.assertEqual(ReagentOrderReason.COMMON_PUBLIC, created.order_reason)

    async def test_create_common_public_rejects_missing_cas_master_data(self) -> None:
        await self._assert_common_public_validation_error(
            self._create_order(self._create_payload(cas_number="67-56-1"))
        )
        self.assertEqual([], self.db.exec(select(ReagentOrder)).all())

    async def test_create_non_common_public_allows_missing_cas_master_data(self) -> None:
        created = await self._create_order(
            self._create_payload(
                cas_number="67-56-1",
                order_reason=ReagentOrderReason.RUNNING_OUT,
            )
        )

        self.assertIsNotNone(created.id)
        self.assertEqual(ReagentOrderReason.RUNNING_OUT, created.order_reason)

    async def test_update_to_common_public_rejects_missing_cas_master_data(self) -> None:
        order = self._add_order(
            cas_number="67-56-1",
            order_reason=ReagentOrderReason.RUNNING_OUT,
        )

        await self._assert_common_public_validation_error(
            reagent_orders.update_reagent_order(
                order_id=order.id,
                order_update=ReagentOrderUpdate(order_reason=ReagentOrderReason.COMMON_PUBLIC),
                request=_build_request(f"/api/reagent-orders/{order.id}"),
                background_tasks=BackgroundTasks(),
                db=self.db,
                current_user=self.user,
            )
        )
        self.db.refresh(order)
        self.assertEqual(ReagentOrderReason.RUNNING_OUT, order.order_reason)

    async def test_update_common_public_cas_rejects_missing_master_data(self) -> None:
        self._add_master_data("64-17-5")
        order = self._add_order(
            cas_number="64-17-5",
            order_reason=ReagentOrderReason.COMMON_PUBLIC,
        )

        await self._assert_common_public_validation_error(
            reagent_orders.update_reagent_order(
                order_id=order.id,
                order_update=ReagentOrderUpdate(cas_number="67-56-1"),
                request=_build_request(f"/api/reagent-orders/{order.id}"),
                background_tasks=BackgroundTasks(),
                db=self.db,
                current_user=self.user,
            )
        )
        self.db.refresh(order)
        self.assertEqual("64-17-5", order.cas_number)

    async def test_delete_master_data_rejects_unfinished_referencing_order(self) -> None:
        master_data = self._add_master_data("64-17-5")
        self._add_order(
            cas_number="64-17-5",
            order_reason=ReagentOrderReason.RUNNING_OUT,
        )

        with self.assertRaises(HTTPException) as context:
            chemical_name_map.delete_chemical_name_map(
                item_id=master_data.id,
                request=_build_request(f"/api/chemical-name-map/{master_data.id}"),
                current_user=self.user,
                db=self.db,
            )

        self.assertEqual(409, context.exception.status_code)
        self.assertEqual(
            "CAS master data is referenced by an unfinished reagent order and cannot be deleted",
            context.exception.detail,
        )
        self.assertEqual(
            {
                API_ERROR_CODE_HEADER: ApiErrorCode.CAS_MASTER_DATA_REFERENCED_BY_ORDER
            },
            context.exception.headers,
        )
        self.assertIsNotNone(self.db.get(ChemicalNameMap, master_data.id))

    async def test_delete_master_data_allows_stocked_referencing_order(self) -> None:
        master_data = self._add_master_data("64-17-5")
        order = self._add_order(
            cas_number="64-17-5",
            order_reason=ReagentOrderReason.RUNNING_OUT,
        )
        order.status = ReagentOrderStatus.STOCKED
        self.db.add(order)
        self.db.commit()

        deleted = chemical_name_map.delete_chemical_name_map(
            item_id=master_data.id,
            request=_build_request(f"/api/chemical-name-map/{master_data.id}"),
            current_user=self.user,
            db=self.db,
        )

        self.assertEqual({"message": "CAS 主数据已删除", "id": master_data.id}, deleted)
        self.assertIsNone(self.db.get(ChemicalNameMap, master_data.id))

    async def test_approve_common_public_rechecks_master_data(self) -> None:
        order = self._add_order(
            cas_number="64-17-5",
            order_reason=ReagentOrderReason.COMMON_PUBLIC,
        )
        approve_endpoint = next(
            route.endpoint
            for route in reagent_orders.router.routes
            if getattr(route, "path", None) == "/reagent-orders/{order_id}/approve"
        )

        with self.assertRaises(HTTPException) as context:
            await approve_endpoint(
                order_id=order.id,
                request=_build_request(f"/api/reagent-orders/{order.id}/approve"),
                db=self.db,
                current_user=self.user,
            )

        self.assertEqual(409, context.exception.status_code)
        self.assertEqual(
            {API_ERROR_CODE_HEADER: ApiErrorCode.COMMON_PUBLIC_MASTER_DATA_REQUIRED},
            context.exception.headers,
        )

    async def test_confirm_arrival_rechecks_master_data_before_status_transition(self) -> None:
        order = self._add_order(
            cas_number="64-17-5",
            order_reason=ReagentOrderReason.COMMON_PUBLIC,
        )
        order.status = reagent_orders.ReagentOrderStatus.APPROVED
        self.db.add(order)
        self.db.commit()
        confirm_endpoint = next(
            route.endpoint
            for route in reagent_orders.router.routes
            if getattr(route, "path", None) == "/reagent-orders/{order_id}/confirm-arrival"
        )

        with self.assertRaises(HTTPException) as context:
            await confirm_endpoint(
                order_id=order.id,
                request=_build_request(f"/api/reagent-orders/{order.id}/confirm-arrival"),
                background_tasks=BackgroundTasks(),
                current_user=self.user,
                db=self.db,
                body=reagent_orders_workflow.ConfirmArrivalRequest(),
            )

        self.assertEqual(409, context.exception.status_code)
        self.assertEqual(
            {API_ERROR_CODE_HEADER: ApiErrorCode.COMMON_PUBLIC_MASTER_DATA_REQUIRED},
            context.exception.headers,
        )
        self.db.refresh(order)
        self.assertEqual(reagent_orders.ReagentOrderStatus.APPROVED, order.status)


if __name__ == "__main__":
    unittest.main()
