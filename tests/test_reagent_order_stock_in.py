from __future__ import annotations

import json
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import APIRouter, BackgroundTasks, HTTPException
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine, select
from starlette.requests import Request

import app.models  # noqa: F401 - populate SQLModel metadata for the test database.
from app.api import reagent_orders_workflow
from app.models.inventory import Inventory, InventoryStatus
from app.models.inventory_operation_log import InventoryOperationAction, InventoryOperationLog
from app.models.log_timeline import LogTimeline, LogTimelineSourceTable
from app.models.reagent_order import ReagentOrder, ReagentOrderReason, ReagentOrderStatus
from app.models.reagent_order_operation_log import ReagentOrderOperationAction, ReagentOrderOperationLog
from app.models.user import User, UserRole


def _build_request(path: str = "/api/reagent-orders/1/stock-in") -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": path,
            "headers": [],
            "client": ("127.0.0.1", 12345),
        }
    )


def _build_stock_in_endpoint():
    router = APIRouter()
    reagent_orders_workflow._register_stock_in_route(router, {})
    for route in router.routes:
        if getattr(route, "path", "") == "/{order_id}/stock-in":
            return route.endpoint
    raise AssertionError("stock-in endpoint not found")


class ReagentOrderStockInTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        SQLModel.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.stock_in_endpoint = _build_stock_in_endpoint()

        self.user = User(
            username="applicant",
            full_name="申购人",
            role=UserRole.USER,
            is_active=True,
            password_hash="hashed",
            username_version=1,
        )
        self.db.add(self.user)
        self.db.commit()
        self.db.refresh(self.user)

        self.order = ReagentOrder(
            cas_number="64-17-5",
            name="乙醇",
            english_name="Ethanol",
            category="溶剂",
            brand="Sigma",
            purity="AR",
            initial_quantity=500.0,
            unit="ml",
            quantity=2,
            price=120.0,
            order_reason=ReagentOrderReason.RUNNING_OUT,
            status=ReagentOrderStatus.APPROVED,
            applicant_id=self.user.id,
            notes="低库存补货",
        )
        self.db.add(self.order)
        self.db.commit()
        self.db.refresh(self.order)

    async def asyncTearDown(self) -> None:
        self.db.close()

    def _add_user(self, username: str, *, role: UserRole = UserRole.USER) -> User:
        user = User(
            username=username,
            full_name=username,
            role=role,
            is_active=True,
            password_hash="hashed",
            username_version=1,
        )
        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)
        return user

    async def _stock_in(
        self,
        payload: reagent_orders_workflow.StockInRequest,
        *,
        order: ReagentOrder | None = None,
        user: User | None = None,
    ) -> dict:
        target_order = order or self.order
        current_user = user or self.user

        with (
            patch("app.api.reagent_orders_workflow._clear_reagent_workflow_cache"),
            patch("app.api.reagent_orders_workflow._clear_inventory_projection_cache"),
            patch(
                "app.api.reagent_orders_workflow._broadcast_inventory_projection_events",
                new=AsyncMock(),
            ),
            patch("app.api.reagent_orders_workflow.enqueue_structure_cache_resolution"),
            patch.object(reagent_orders_workflow.sse_manager, "broadcast", new=AsyncMock()),
        ):
            return await self.stock_in_endpoint(
                order_id=target_order.id,
                payload=payload,
                request=_build_request(f"/api/reagent-orders/{target_order.id}/stock-in"),
                background_tasks=BackgroundTasks(),
                current_user=current_user,
                db=self.db,
            )

    def _inventory_for_order(self, order_id: int) -> list[Inventory]:
        return self.db.exec(
            select(Inventory)
            .where(Inventory.source_order_id == order_id)
            .order_by(Inventory.internal_code)
        ).all()

    async def test_approved_order_stock_in_creates_inventory_items_and_audit_logs(self) -> None:
        payload = reagent_orders_workflow.StockInRequest(
            storage_location=" A1 ",
            remaining_quantity=480.0,
            brand="Sigma-Aldrich",
            notes="入库复核",
        )

        response = await self._stock_in(payload)

        latest_order = self.db.get(ReagentOrder, self.order.id)
        inventory_items = self._inventory_for_order(self.order.id)
        operation_logs = self.db.exec(
            select(InventoryOperationLog).where(
                InventoryOperationLog.inventory_id.in_([item.id for item in inventory_items])
            )
            .order_by(InventoryOperationLog.inventory_id)
        ).all()
        order_logs = self.db.exec(
            select(ReagentOrderOperationLog).where(ReagentOrderOperationLog.order_id == self.order.id)
        ).all()
        timeline_rows = self.db.exec(select(LogTimeline).order_by(LogTimeline.id)).all()

        self.assertEqual(response["message"], "已入库")
        self.assertEqual(response["items_created"], 2)
        self.assertEqual(response["items_updated"], 0)
        self.assertEqual(latest_order.status, ReagentOrderStatus.STOCKED)
        self.assertEqual(latest_order.brand, "Sigma-Aldrich")
        self.assertEqual(latest_order.notes, "入库复核")
        self.assertEqual(len(inventory_items), 2)
        self.assertEqual(len(operation_logs), 2)
        self.assertEqual(len(order_logs), 1)
        self.assertEqual(response["inventory_ids"], [item.id for item in inventory_items])

        for item, operation_log in zip(inventory_items, operation_logs):
            self.assertEqual(item.cas_number, self.order.cas_number)
            self.assertEqual(item.name, self.order.name)
            self.assertEqual(item.brand, "Sigma-Aldrich")
            self.assertEqual(item.storage_location, "A1")
            self.assertEqual(item.remaining_quantity, 480.0)
            self.assertEqual(item.initial_quantity, 500.0)
            self.assertEqual(item.remaining_percent, 0.96)
            self.assertEqual(item.status, InventoryStatus.IN_STOCK)
            self.assertEqual(item.created_by_id, self.user.id)
            self.assertEqual(operation_log.action, InventoryOperationAction.STOCK_IN)
            snapshot = json.loads(operation_log.snapshot_json)
            self.assertEqual(snapshot["sc"], "order_stock_in")
            self.assertEqual(snapshot["oi"], self.order.id)
            self.assertEqual(snapshot["sl"], "A1")
            self.assertEqual(snapshot["rq"], 480.0)

        order_log = order_logs[0]
        self.assertEqual(order_log.action, ReagentOrderOperationAction.UPDATE)
        order_snapshot = json.loads(order_log.snapshot_json)
        self.assertEqual(order_snapshot["bf"]["br"], "Sigma")
        self.assertEqual(order_snapshot["af"]["br"], "Sigma-Aldrich")
        self.assertEqual(order_snapshot["af"]["nt"], "入库复核")
        self.assertEqual(
            [row.source_table for row in timeline_rows],
            [
                LogTimelineSourceTable.INVENTORY_OPERATION_LOG,
                LogTimelineSourceTable.INVENTORY_OPERATION_LOG,
                LogTimelineSourceTable.REAGENT_ORDER_OPERATION_LOG,
            ],
        )
        self.assertTrue(all("乙醇" in row.detail_search_text for row in timeline_rows))

    async def test_stock_in_rejects_non_applicant_without_side_effects(self) -> None:
        outsider = self._add_user("outsider")
        payload = reagent_orders_workflow.StockInRequest(
            storage_location="A1",
            remaining_quantity=480.0,
            brand="ShouldNotApply",
        )

        with self.assertRaises(HTTPException) as exc_info:
            await self._stock_in(payload, user=outsider)

        self.assertEqual(exc_info.exception.status_code, 403)
        self.assertEqual(self.db.get(ReagentOrder, self.order.id).status, ReagentOrderStatus.APPROVED)
        self.assertEqual(self.db.get(ReagentOrder, self.order.id).brand, "Sigma")
        self.assertEqual(self._inventory_for_order(self.order.id), [])
        self.assertEqual(self.db.exec(select(InventoryOperationLog)).all(), [])
        self.assertEqual(self.db.exec(select(ReagentOrderOperationLog)).all(), [])

    async def test_stock_in_rejects_excess_remaining_quantity_without_creating_inventory(self) -> None:
        payload = reagent_orders_workflow.StockInRequest(
            storage_location="A1",
            remaining_quantity=501.0,
        )

        with self.assertRaises(HTTPException) as exc_info:
            await self._stock_in(payload)

        self.assertEqual(exc_info.exception.status_code, 400)
        self.assertIn("cannot exceed", exc_info.exception.detail)
        self.assertEqual(self.db.get(ReagentOrder, self.order.id).status, ReagentOrderStatus.APPROVED)
        self.assertEqual(self._inventory_for_order(self.order.id), [])
        self.assertEqual(self.db.exec(select(InventoryOperationLog)).all(), [])

    async def test_stock_in_rejects_null_remaining_quantity_without_side_effects(self) -> None:
        payload = reagent_orders_workflow.StockInRequest(
            storage_location="A1",
            remaining_quantity=None,
        )

        with self.assertRaises(HTTPException) as exc_info:
            await self._stock_in(payload)

        latest_order = self.db.get(ReagentOrder, self.order.id)

        self.assertEqual(exc_info.exception.status_code, 400)
        self.assertEqual(exc_info.exception.detail, "remaining_quantity cannot be null")
        self.assertEqual(latest_order.status, ReagentOrderStatus.APPROVED)
        self.assertEqual(latest_order.brand, "Sigma")
        self.assertEqual(self._inventory_for_order(self.order.id), [])
        self.assertEqual(self.db.exec(select(InventoryOperationLog)).all(), [])
        self.assertEqual(self.db.exec(select(ReagentOrderOperationLog)).all(), [])

    async def test_stock_in_rejects_blank_storage_location_without_side_effects(self) -> None:
        payload = reagent_orders_workflow.StockInRequest(
            storage_location="   ",
            remaining_quantity=480.0,
            brand="ShouldNotApply",
        )

        with self.assertRaises(HTTPException) as exc_info:
            await self._stock_in(payload)

        self.db.rollback()
        self.db.expire_all()
        latest_order = self.db.get(ReagentOrder, self.order.id)

        self.assertEqual(exc_info.exception.status_code, 400)
        self.assertEqual(exc_info.exception.detail, "storage_location is required")
        self.assertEqual(latest_order.status, ReagentOrderStatus.APPROVED)
        self.assertEqual(latest_order.brand, "Sigma")
        self.assertEqual(self._inventory_for_order(self.order.id), [])
        self.assertEqual(self.db.exec(select(InventoryOperationLog)).all(), [])
        self.assertEqual(self.db.exec(select(ReagentOrderOperationLog)).all(), [])

    async def test_common_public_order_stock_in_is_rejected_without_side_effects(self) -> None:
        self.order.order_reason = ReagentOrderReason.COMMON_PUBLIC
        self.db.add(self.order)
        self.db.commit()

        payload = reagent_orders_workflow.StockInRequest(
            storage_location="A1",
            remaining_quantity=480.0,
        )

        with self.assertRaises(HTTPException) as exc_info:
            await self._stock_in(payload)

        latest_order = self.db.get(ReagentOrder, self.order.id)

        self.assertEqual(exc_info.exception.status_code, 400)
        self.assertEqual(exc_info.exception.detail, "Common-public orders are stocked at confirm-arrival time")
        self.assertEqual(latest_order.status, ReagentOrderStatus.APPROVED)
        self.assertEqual(self._inventory_for_order(self.order.id), [])
        self.assertEqual(self.db.exec(select(InventoryOperationLog)).all(), [])
        self.assertEqual(self.db.exec(select(ReagentOrderOperationLog)).all(), [])

    async def test_inventory_log_failure_rolls_back_stock_in_status_and_created_items(self) -> None:
        original_add = self.db.add

        def _failing_add(obj):
            if isinstance(obj, InventoryOperationLog):
                raise RuntimeError("inventory log write failed")
            return original_add(obj)

        payload = reagent_orders_workflow.StockInRequest(
            storage_location="A1",
            remaining_quantity=480.0,
        )

        with patch.object(self.db, "add", side_effect=_failing_add):
            with self.assertRaises(RuntimeError):
                await self._stock_in(payload)

        self.db.rollback()
        self.db.expire_all()
        latest_order = self.db.get(ReagentOrder, self.order.id)

        self.assertEqual(latest_order.status, ReagentOrderStatus.APPROVED)
        self.assertEqual(self._inventory_for_order(self.order.id), [])
        self.assertEqual(self.db.exec(select(InventoryOperationLog)).all(), [])
        self.assertEqual(self.db.exec(select(ReagentOrderOperationLog)).all(), [])

    async def test_arrived_order_stock_in_updates_pending_items_in_place(self) -> None:
        self.order.status = ReagentOrderStatus.ARRIVED
        self.db.add(self.order)
        self.db.commit()

        pending_items = []
        for index in range(2):
            item = Inventory(
                internal_code=f"TMP-00{index + 1}",
                cas_number=self.order.cas_number,
                name="待入库乙醇",
                category="待确认",
                brand="OldBrand",
                purity="CP",
                initial_quantity=500.0,
                remaining_quantity=500.0,
                remaining_percent=1.0,
                unit="ml",
                status=InventoryStatus.IN_STOCK,
                storage_location=None,
                temporary_keeper_id=self.user.id,
                source_order_id=self.order.id,
                created_by_id=self.user.id,
            )
            self.db.add(item)
            pending_items.append(item)
        self.db.commit()
        for item in pending_items:
            self.db.refresh(item)

        payload = reagent_orders_workflow.StockInRequest(
            storage_location="B2",
            remaining_quantity=450.0,
            purity="HPLC",
        )

        response = await self._stock_in(payload)

        latest_order = self.db.get(ReagentOrder, self.order.id)
        inventory_items = self._inventory_for_order(self.order.id)
        operation_logs = self.db.exec(
            select(InventoryOperationLog)
            .where(InventoryOperationLog.inventory_id.in_([item.id for item in inventory_items]))
            .order_by(InventoryOperationLog.inventory_id)
        ).all()

        self.assertEqual(response["items_created"], 0)
        self.assertEqual(response["items_updated"], 2)
        self.assertEqual(latest_order.status, ReagentOrderStatus.STOCKED)
        self.assertEqual(latest_order.purity, "HPLC")
        self.assertCountEqual(response["inventory_ids"], [item.id for item in pending_items])
        self.assertEqual(len(inventory_items), 2)
        self.assertEqual(len(operation_logs), 2)

        for item, operation_log in zip(inventory_items, operation_logs):
            self.assertEqual(item.name, "乙醇")
            self.assertEqual(item.brand, "Sigma")
            self.assertEqual(item.purity, "HPLC")
            self.assertEqual(item.storage_location, "B2")
            self.assertEqual(item.temporary_keeper_id, None)
            self.assertEqual(item.remaining_quantity, 450.0)
            self.assertEqual(item.remaining_percent, 0.9)
            self.assertEqual(operation_log.action, InventoryOperationAction.INVENTORY_UPDATE)
            snapshot = json.loads(operation_log.snapshot_json)
            self.assertEqual(snapshot["bf"]["tk"], self.user.id)
            self.assertIsNone(snapshot["af"]["tk"])
            self.assertEqual(snapshot["af"]["sl"], "B2")

    async def test_arrived_order_requires_enough_pending_items_and_rolls_back_status(self) -> None:
        self.order.status = ReagentOrderStatus.ARRIVED
        self.db.add(self.order)
        pending_item = Inventory(
            internal_code="TMP-001",
            cas_number=self.order.cas_number,
            name="待入库乙醇",
            category="待确认",
            brand="OldBrand",
            initial_quantity=500.0,
            remaining_quantity=500.0,
            remaining_percent=1.0,
            unit="ml",
            status=InventoryStatus.IN_STOCK,
            storage_location=None,
            temporary_keeper_id=self.user.id,
            source_order_id=self.order.id,
            created_by_id=self.user.id,
        )
        self.db.add(pending_item)
        self.db.commit()
        self.db.refresh(pending_item)

        payload = reagent_orders_workflow.StockInRequest(
            storage_location="B2",
            remaining_quantity=450.0,
        )

        with self.assertRaises(HTTPException) as exc_info:
            await self._stock_in(payload)

        self.db.rollback()
        self.db.expire_all()
        latest_order = self.db.get(ReagentOrder, self.order.id)
        latest_pending_item = self.db.get(Inventory, pending_item.id)

        self.assertEqual(exc_info.exception.status_code, 400)
        self.assertEqual(exc_info.exception.detail, "No enough pending stock items found for this order")
        self.assertEqual(latest_order.status, ReagentOrderStatus.ARRIVED)
        self.assertIsNone(latest_pending_item.storage_location)
        self.assertEqual(latest_pending_item.temporary_keeper_id, self.user.id)
        self.assertEqual(self.db.exec(select(InventoryOperationLog)).all(), [])
        self.assertEqual(self.db.exec(select(ReagentOrderOperationLog)).all(), [])

    async def test_arrived_order_stock_in_requires_remaining_quantity_without_side_effects(self) -> None:
        self.order.status = ReagentOrderStatus.ARRIVED
        self.db.add(self.order)
        self.db.commit()

        payload = reagent_orders_workflow.StockInRequest(storage_location="B2")

        with self.assertRaises(HTTPException) as exc_info:
            await self._stock_in(payload)

        latest_order = self.db.get(ReagentOrder, self.order.id)

        self.assertEqual(exc_info.exception.status_code, 400)
        self.assertEqual(exc_info.exception.detail, "remaining_quantity is required for ARRIVED orders")
        self.assertEqual(latest_order.status, ReagentOrderStatus.ARRIVED)
        self.assertEqual(self._inventory_for_order(self.order.id), [])
        self.assertEqual(self.db.exec(select(InventoryOperationLog)).all(), [])
        self.assertEqual(self.db.exec(select(ReagentOrderOperationLog)).all(), [])

    async def test_arrived_order_stock_in_rejects_non_keeper_and_rolls_back_claim(self) -> None:
        keeper = self._add_user("temporary_keeper")
        self.order.status = ReagentOrderStatus.ARRIVED
        self.db.add(self.order)
        pending_items = []
        for index in range(2):
            item = Inventory(
                internal_code=f"TMP-K{index + 1:03d}",
                cas_number=self.order.cas_number,
                name="待入库乙醇",
                category="待确认",
                brand="OldBrand",
                initial_quantity=500.0,
                remaining_quantity=500.0,
                remaining_percent=1.0,
                unit="ml",
                status=InventoryStatus.IN_STOCK,
                storage_location=None,
                temporary_keeper_id=keeper.id,
                source_order_id=self.order.id,
                created_by_id=keeper.id,
            )
            self.db.add(item)
            pending_items.append(item)
        self.db.commit()

        payload = reagent_orders_workflow.StockInRequest(
            storage_location="B2",
            remaining_quantity=450.0,
        )

        with self.assertRaises(HTTPException) as exc_info:
            await self._stock_in(payload)

        self.db.rollback()
        self.db.expire_all()
        latest_order = self.db.get(ReagentOrder, self.order.id)
        latest_items = self._inventory_for_order(self.order.id)

        self.assertEqual(exc_info.exception.status_code, 403)
        self.assertEqual(exc_info.exception.detail, "Only the temporary keeper can stock in pending items")
        self.assertEqual(latest_order.status, ReagentOrderStatus.ARRIVED)
        self.assertCountEqual([item.id for item in latest_items], [item.id for item in pending_items])
        self.assertTrue(all(item.storage_location is None for item in latest_items))
        self.assertTrue(all(item.temporary_keeper_id == keeper.id for item in latest_items))
        self.assertEqual(self.db.exec(select(InventoryOperationLog)).all(), [])
        self.assertEqual(self.db.exec(select(ReagentOrderOperationLog)).all(), [])


if __name__ == "__main__":
    unittest.main()
