from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, patch

from fastapi import APIRouter, HTTPException
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine, select
from starlette.requests import Request

from app.api import inventory_extended_routes
from app.models.inventory import BorrowLog, Inventory, InventoryBorrowRequest, InventoryBorrowReturn, InventoryStatus
from app.models.inventory_operation_log import InventoryOperationAction, InventoryOperationLog
from app.models.log_timeline import LogTimeline, LogTimelineSourceTable
from app.models.user import User, UserRole


def _build_request(path: str = "/api/inventory/1/borrow") -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": path,
            "headers": [],
            "client": ("127.0.0.1", 12345),
        }
    )


def _build_borrow_endpoint():
    router = APIRouter()
    inventory_extended_routes._register_borrow_route(router, {}, "inventory:list")
    for route in router.routes:
        if getattr(route, "path", "") == "/{inventory_id}/borrow":
            return route.endpoint
    raise AssertionError("borrow endpoint not found")


def _build_return_endpoint():
    router = APIRouter()
    inventory_extended_routes._register_return_route(router, {}, "inventory:list")
    for route in router.routes:
        if getattr(route, "path", "") == "/{inventory_id}/return":
            return route.endpoint
    raise AssertionError("return endpoint not found")


def _build_return_delete_endpoint():
    router = APIRouter()
    inventory_extended_routes._register_return_route(router, {}, "inventory:list")
    for route in router.routes:
        if getattr(route, "path", "") == "/{inventory_id}/return-delete":
            return route.endpoint
    raise AssertionError("return-delete endpoint not found")


class BorrowAtomicityTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        SQLModel.metadata.create_all(
            self.engine,
            tables=[
                User.__table__,
                Inventory.__table__,
                BorrowLog.__table__,
                InventoryOperationLog.__table__,
                LogTimeline.__table__,
            ],
        )
        self.db = Session(self.engine)
        self.borrow_endpoint = _build_borrow_endpoint()
        self.return_endpoint = _build_return_endpoint()
        self.return_delete_endpoint = _build_return_delete_endpoint()

        self.user = User(
            username="borrower",
            full_name="借用人",
            role=UserRole.USER,
            is_active=True,
            password_hash="hashed",
            username_version=1,
        )
        self.db.add(self.user)
        self.db.commit()
        self.db.refresh(self.user)

        self.item = Inventory(
            internal_code="INV-001",
            cas_number="64-17-5",
            name="乙醇",
            category="溶剂",
            brand="Sigma",
            initial_quantity=100.0,
            remaining_quantity=100.0,
            remaining_percent=1.0,
            unit="mL",
            status=InventoryStatus.IN_STOCK,
            created_by_id=self.user.id,
        )
        self.db.add(self.item)
        self.db.commit()
        self.db.refresh(self.item)

    async def asyncTearDown(self) -> None:
        self.db.close()

    def _add_user(self, username: str, *, role: UserRole = UserRole.USER, is_active: bool = True) -> User:
        user = User(
            username=username,
            full_name=username,
            role=role,
            is_active=is_active,
            password_hash="hashed",
            username_version=1,
        )
        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)
        return user

    async def _borrow(
        self,
        *,
        user: User | None = None,
        borrow_data: InventoryBorrowRequest | None = None,
    ) -> dict:
        with (
            patch("app.api.inventory_extended_routes.clear_cache_by_prefix"),
            patch.object(inventory_extended_routes.sse_manager, "broadcast", new=AsyncMock()),
        ):
            return await self.borrow_endpoint(
                inventory_id=self.item.id,
                request=_build_request(),
                current_user=user or self.user,
                db=self.db,
                borrow_data=borrow_data,
            )

    async def _return(self, return_data: InventoryBorrowReturn, *, user: User | None = None) -> dict:
        with (
            patch("app.api.inventory_extended_routes.clear_cache_by_prefix"),
            patch.object(inventory_extended_routes.sse_manager, "broadcast", new=AsyncMock()),
        ):
            return await self.return_endpoint(
                inventory_id=self.item.id,
                return_data=return_data,
                request=_build_request(f"/api/inventory/{self.item.id}/return"),
                current_user=user or self.user,
                db=self.db,
            )

    async def _return_delete(self, return_data: InventoryBorrowReturn, *, user: User | None = None) -> None:
        with (
            patch("app.api.inventory_extended_routes.clear_cache_by_prefix"),
            patch("app.api.inventory_extended_routes.delete_inventory_entity_completions"),
            patch.object(inventory_extended_routes.sse_manager, "broadcast", new=AsyncMock()),
        ):
            await self.return_delete_endpoint(
                inventory_id=self.item.id,
                return_data=return_data,
                request=_build_request(f"/api/inventory/{self.item.id}/return-delete"),
                current_user=user or self.user,
                db=self.db,
            )

    async def test_borrow_success_updates_inventory_and_log(self) -> None:
        response = await self._borrow()

        latest_item = self.db.get(Inventory, self.item.id)
        logs = self.db.exec(select(BorrowLog).where(BorrowLog.inventory_id == self.item.id)).all()

        self.assertEqual(response["status"], InventoryStatus.BORROWED.value)
        self.assertEqual(latest_item.status, InventoryStatus.BORROWED)
        self.assertEqual(latest_item.borrower_id, self.user.id)
        self.assertEqual(len(logs), 1)
        self.assertEqual(logs[0].borrower_id, self.user.id)

    async def test_borrow_log_failure_rolls_back_inventory_status(self) -> None:
        original_add = self.db.add

        def _failing_add(obj):
            if isinstance(obj, BorrowLog):
                raise RuntimeError("borrow log write failed")
            return original_add(obj)

        with (
            patch("app.api.inventory_extended_routes.clear_cache_by_prefix"),
            patch.object(inventory_extended_routes.sse_manager, "broadcast", new=AsyncMock()),
            patch.object(self.db, "add", side_effect=_failing_add),
        ):
            with self.assertRaises(RuntimeError):
                await self.borrow_endpoint(
                    inventory_id=self.item.id,
                    request=_build_request(),
                    current_user=self.user,
                    db=self.db,
                    borrow_data=None,
                )

        self.db.rollback()
        self.db.expire_all()
        latest_item = self.db.get(Inventory, self.item.id)
        logs = self.db.exec(select(BorrowLog).where(BorrowLog.inventory_id == self.item.id)).all()

        self.assertEqual(latest_item.status, InventoryStatus.IN_STOCK)
        self.assertIsNone(latest_item.borrower_id)
        self.assertEqual(logs, [])

    async def test_public_borrow_requires_and_records_actual_borrower(self) -> None:
        public_user = self._add_user("public_kiosk", role=UserRole.PUBLIC)
        actual_user = self._add_user("actual_borrower")

        response = await self._borrow(
            user=public_user,
            borrow_data=InventoryBorrowRequest(actual_borrower_id=actual_user.id),
        )

        latest_item = self.db.get(Inventory, self.item.id)
        borrow_log = self.db.exec(select(BorrowLog).where(BorrowLog.inventory_id == self.item.id)).one()
        timeline = self.db.exec(
            select(LogTimeline).where(LogTimeline.source_table == LogTimelineSourceTable.BORROWLOG)
        ).one()

        self.assertEqual(response["status"], InventoryStatus.BORROWED.value)
        self.assertEqual(latest_item.borrower_id, actual_user.id)
        self.assertEqual(borrow_log.borrower_id, actual_user.id)
        self.assertEqual(borrow_log.notes, f"actual_borrower_id:{actual_user.id}")
        self.assertEqual(timeline.actor_user_id, actual_user.id)
        self.assertIn("借用", timeline.detail_search_text)

    async def test_public_borrow_without_actual_borrower_is_rejected_without_mutation(self) -> None:
        public_user = self._add_user("public_kiosk", role=UserRole.PUBLIC)

        with self.assertRaises(HTTPException) as exc_info:
            await self._borrow(user=public_user)

        latest_item = self.db.get(Inventory, self.item.id)
        logs = self.db.exec(select(BorrowLog).where(BorrowLog.inventory_id == self.item.id)).all()

        self.assertEqual(exc_info.exception.status_code, 400)
        self.assertEqual(latest_item.status, InventoryStatus.IN_STOCK)
        self.assertIsNone(latest_item.borrower_id)
        self.assertEqual(logs, [])

    async def test_public_borrow_rejects_public_actual_borrower_without_mutation(self) -> None:
        public_user = self._add_user("public_kiosk", role=UserRole.PUBLIC)
        public_actual = self._add_user("public_actual", role=UserRole.PUBLIC)

        with self.assertRaises(HTTPException) as exc_info:
            await self._borrow(
                user=public_user,
                borrow_data=InventoryBorrowRequest(actual_borrower_id=public_actual.id),
            )

        latest_item = self.db.get(Inventory, self.item.id)
        logs = self.db.exec(select(BorrowLog).where(BorrowLog.inventory_id == self.item.id)).all()

        self.assertEqual(exc_info.exception.status_code, 400)
        self.assertEqual(latest_item.status, InventoryStatus.IN_STOCK)
        self.assertIsNone(latest_item.borrower_id)
        self.assertEqual(logs, [])

    async def test_borrow_rejects_pending_stock_in_item_without_mutation(self) -> None:
        self.item.temporary_keeper_id = self.user.id
        self.item.storage_location = None
        self.db.add(self.item)
        self.db.commit()

        with self.assertRaises(HTTPException) as exc_info:
            await self._borrow()

        latest_item = self.db.get(Inventory, self.item.id)
        logs = self.db.exec(select(BorrowLog).where(BorrowLog.inventory_id == self.item.id)).all()

        self.assertEqual(exc_info.exception.status_code, 409)
        self.assertIn("Pending stock-in item", exc_info.exception.detail)
        self.assertEqual(latest_item.status, InventoryStatus.IN_STOCK)
        self.assertEqual(latest_item.temporary_keeper_id, self.user.id)
        self.assertIsNone(latest_item.borrower_id)
        self.assertEqual(logs, [])

    async def test_return_rejects_remaining_quantity_above_initial_without_mutation(self) -> None:
        await self._borrow()

        with self.assertRaises(HTTPException) as exc_info:
            await self._return(InventoryBorrowReturn(remaining_quantity=101.0))

        latest_item = self.db.get(Inventory, self.item.id)
        borrow_log = self.db.exec(select(BorrowLog).where(BorrowLog.inventory_id == self.item.id)).one()

        self.assertEqual(exc_info.exception.status_code, 400)
        self.assertEqual(latest_item.status, InventoryStatus.BORROWED)
        self.assertEqual(latest_item.borrower_id, self.user.id)
        self.assertIsNone(borrow_log.return_time)
        self.assertIsNone(borrow_log.quantity_returned)

    async def test_return_rejects_non_borrower_without_closing_borrow_log(self) -> None:
        await self._borrow()
        outsider = self._add_user("outsider")

        with self.assertRaises(HTTPException) as exc_info:
            await self._return(InventoryBorrowReturn(remaining_quantity=60.0), user=outsider)

        latest_item = self.db.get(Inventory, self.item.id)
        borrow_log = self.db.exec(select(BorrowLog).where(BorrowLog.inventory_id == self.item.id)).one()
        timelines = self.db.exec(
            select(LogTimeline).where(LogTimeline.source_table == LogTimelineSourceTable.BORROWLOG)
        ).all()

        self.assertEqual(exc_info.exception.status_code, 403)
        self.assertEqual(latest_item.status, InventoryStatus.BORROWED)
        self.assertEqual(latest_item.borrower_id, self.user.id)
        self.assertIsNone(borrow_log.return_time)
        self.assertIsNone(borrow_log.quantity_returned)
        self.assertEqual(len(timelines), 1)
        self.assertIn("未归还", timelines[0].detail_search_text)

    async def test_admin_can_return_another_users_borrow_and_get_low_stock_warning(self) -> None:
        await self._borrow()
        admin = self._add_user("admin", role=UserRole.ADMIN)

        response = await self._return(InventoryBorrowReturn(remaining_quantity=5.0), user=admin)

        latest_item = self.db.get(Inventory, self.item.id)
        borrow_log = self.db.exec(select(BorrowLog).where(BorrowLog.inventory_id == self.item.id)).one()

        self.assertEqual(response["status"], InventoryStatus.IN_STOCK.value)
        self.assertIn("warning", response)
        self.assertEqual(latest_item.status, InventoryStatus.IN_STOCK)
        self.assertEqual(latest_item.remaining_quantity, 5.0)
        self.assertEqual(latest_item.remaining_percent, 0.05)
        self.assertEqual(latest_item.last_borrower_id, self.user.id)
        self.assertIsNone(latest_item.borrower_id)
        self.assertIsNotNone(borrow_log.return_time)
        self.assertEqual(borrow_log.quantity_returned, 5.0)

    async def test_return_legacy_item_requires_specification_without_mutation(self) -> None:
        self.item.initial_quantity = None
        self.item.unit = None
        self.item.remaining_quantity = 30.0
        self.item.remaining_percent = None
        self.db.add(self.item)
        self.db.commit()
        await self._borrow()

        with self.assertRaises(HTTPException) as exc_info:
            await self._return(InventoryBorrowReturn(remaining_quantity=10.0))

        latest_item = self.db.get(Inventory, self.item.id)
        borrow_log = self.db.exec(select(BorrowLog).where(BorrowLog.inventory_id == self.item.id)).one()

        self.assertEqual(exc_info.exception.status_code, 400)
        self.assertEqual(exc_info.exception.detail, "specification is required")
        self.assertIsNone(latest_item.initial_quantity)
        self.assertIsNone(latest_item.unit)
        self.assertEqual(latest_item.status, InventoryStatus.BORROWED)
        self.assertIsNone(borrow_log.return_time)
        self.assertIsNone(borrow_log.quantity_returned)

    async def test_return_legacy_item_records_specification_and_percent(self) -> None:
        self.item.initial_quantity = None
        self.item.unit = None
        self.item.remaining_quantity = 30.0
        self.item.remaining_percent = None
        self.db.add(self.item)
        self.db.commit()
        await self._borrow()

        response = await self._return(
            InventoryBorrowReturn(
                remaining_quantity=10.0,
                specification="50 ml",
            )
        )

        latest_item = self.db.get(Inventory, self.item.id)
        borrow_log = self.db.exec(select(BorrowLog).where(BorrowLog.inventory_id == self.item.id)).one()

        self.assertEqual(response["status"], InventoryStatus.IN_STOCK.value)
        self.assertEqual(latest_item.initial_quantity, 50.0)
        self.assertEqual(latest_item.unit, "mL")
        self.assertEqual(latest_item.remaining_quantity, 10.0)
        self.assertEqual(latest_item.remaining_percent, 0.2)
        self.assertIsNotNone(borrow_log.return_time)
        self.assertEqual(borrow_log.quantity_returned, 10.0)

    async def test_return_zero_remaining_marks_consumed_and_closes_borrow_log(self) -> None:
        await self._borrow()

        response = await self._return(InventoryBorrowReturn(remaining_quantity=0.0, notes="已用完"))

        latest_item = self.db.get(Inventory, self.item.id)
        borrow_log = self.db.exec(select(BorrowLog).where(BorrowLog.inventory_id == self.item.id)).one()
        timeline = self.db.exec(
            select(LogTimeline).where(LogTimeline.source_table == LogTimelineSourceTable.BORROWLOG)
        ).one()

        self.assertEqual(response["status"], InventoryStatus.CONSUMED.value)
        self.assertEqual(latest_item.status, InventoryStatus.CONSUMED)
        self.assertEqual(latest_item.remaining_quantity, 0.0)
        self.assertEqual(latest_item.remaining_percent, 0.0)
        self.assertEqual(latest_item.last_borrower_id, self.user.id)
        self.assertIsNone(latest_item.borrower_id)
        self.assertEqual(latest_item.notes, "已用完")
        self.assertIsNotNone(borrow_log.return_time)
        self.assertEqual(borrow_log.quantity_returned, 0.0)
        self.assertIn("已归还", timeline.detail_search_text)
        self.assertIn("0.0", timeline.detail_search_text)

    async def test_return_delete_rejects_non_zero_remaining_without_deleting_item(self) -> None:
        await self._borrow()

        with self.assertRaises(HTTPException) as exc_info:
            await self._return_delete(InventoryBorrowReturn(remaining_quantity=1.0))

        latest_item = self.db.get(Inventory, self.item.id)
        operation_logs = self.db.exec(select(InventoryOperationLog)).all()

        self.assertEqual(exc_info.exception.status_code, 400)
        self.assertEqual(latest_item.status, InventoryStatus.BORROWED)
        self.assertEqual(latest_item.borrower_id, self.user.id)
        self.assertEqual(operation_logs, [])

    async def test_return_delete_zero_remaining_deletes_item_and_writes_audit_log(self) -> None:
        await self._borrow()

        await self._return_delete(InventoryBorrowReturn(remaining_quantity=0.0, notes="空瓶回收"))

        deleted_item = self.db.get(Inventory, self.item.id)
        operation_log = self.db.exec(select(InventoryOperationLog)).one()
        timeline = self.db.exec(
            select(LogTimeline).where(
                LogTimeline.source_table == LogTimelineSourceTable.INVENTORY_OPERATION_LOG,
                LogTimeline.source_log_id == operation_log.id,
            )
        ).one()

        self.assertIsNone(deleted_item)
        self.assertEqual(operation_log.action, InventoryOperationAction.INVENTORY_DELETE)
        self.assertEqual(operation_log.inventory_id, self.item.id)
        self.assertEqual(operation_log.operator_id, self.user.id)
        self.assertEqual(operation_log.notes, "空瓶回收 用完")
        self.assertEqual(timeline.actor_user_id, self.user.id)
        self.assertIn("删除库存", timeline.detail_search_text)

    async def test_return_refreshes_borrow_timeline_detail(self) -> None:
        await self._borrow()

        timeline_before = self.db.exec(
            select(LogTimeline).where(
                LogTimeline.source_table == LogTimelineSourceTable.BORROWLOG,
            )
        ).one()
        self.assertIn("未归还", timeline_before.detail_search_text)

        await self._return(InventoryBorrowReturn(remaining_quantity=60.0))

        timelines = self.db.exec(
            select(LogTimeline).where(
                LogTimeline.source_table == LogTimelineSourceTable.BORROWLOG,
            )
        ).all()

        self.assertEqual(len(timelines), 1)
        self.assertEqual(timelines[0].id, timeline_before.id)
        self.assertIn("已归还", timelines[0].detail_search_text)
        self.assertIn("60.0", timelines[0].detail_search_text)


if __name__ == "__main__":
    unittest.main()
