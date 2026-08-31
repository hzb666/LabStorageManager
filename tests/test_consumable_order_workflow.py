from __future__ import annotations

import json
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select
from starlette.requests import Request

import app.models  # noqa: F401 - populate SQLModel metadata for the test database.
from app.api import consumable_orders
from app.models.consumable_order import ConsumableOrder, ConsumableOrderStatus
from app.models.consumable_order_operation_log import (
    ConsumableOrderOperationAction,
    ConsumableOrderOperationLog,
)
from app.models.log_timeline import LogTimeline, LogTimelineSourceTable
from app.models.user import User, UserRole


def _build_request(path: str = "/api/consumable-orders/1/complete") -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": path,
            "headers": [],
            "client": ("127.0.0.1", 12345),
        }
    )


class ConsumableOrderWorkflowTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        SQLModel.metadata.create_all(self.engine)
        self.db = Session(self.engine)

        self.user = self._add_user("applicant")
        self.order = ConsumableOrder(
            name="移液枪枪头",
            english_name="Pipette tips",
            product_number="TIP-200",
            specification="200 uL",
            unit="盒",
            quantity=3,
            price=25.0,
            communication="按常规供应商采购",
            notes="低库存补货",
            applicant_id=self.user.id,
            status=ConsumableOrderStatus.APPROVED,
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

    async def _complete(self, *, user: User | None = None) -> dict:
        with (
            patch("app.api.consumable_orders._clear_consumable_order_cache"),
            patch.object(consumable_orders.sse_manager, "broadcast", new=AsyncMock()),
        ):
            return await consumable_orders.complete_consumable_order(
                order_id=self.order.id,
                request=_build_request(f"/api/consumable-orders/{self.order.id}/complete"),
                current_user=user or self.user,
                db=self.db,
            )

    async def test_complete_approved_order_writes_audit_log_and_timeline(self) -> None:
        response = await self._complete()

        latest_order = self.db.get(ConsumableOrder, self.order.id)
        operation_log = self.db.exec(select(ConsumableOrderOperationLog)).one()
        timeline = self.db.exec(
            select(LogTimeline).where(
                LogTimeline.source_table == LogTimelineSourceTable.CONSUMABLE_ORDER_OPERATION_LOG,
                LogTimeline.source_log_id == operation_log.id,
            )
        ).one()
        snapshot = json.loads(operation_log.snapshot_json)

        self.assertEqual(response["message"], "耗材订单已完成")
        self.assertEqual(response["status"], ConsumableOrderStatus.COMPLETED)
        self.assertEqual(latest_order.status, ConsumableOrderStatus.COMPLETED)
        self.assertEqual(operation_log.action, ConsumableOrderOperationAction.ARRIVAL_COMPLETE)
        self.assertEqual(operation_log.actor_user_id, self.user.id)
        self.assertEqual(operation_log.applicant_id, self.user.id)
        self.assertEqual(snapshot["bf"]["st"], ConsumableOrderStatus.APPROVED.value)
        self.assertEqual(snapshot["af"]["st"], ConsumableOrderStatus.COMPLETED.value)
        self.assertEqual(timeline.actor_user_id, self.user.id)
        self.assertIn("确认耗材到货", timeline.detail_search_text)

    async def test_complete_rejects_non_applicant_without_side_effects(self) -> None:
        outsider = self._add_user("outsider")

        with self.assertRaises(HTTPException) as exc_info:
            await self._complete(user=outsider)

        latest_order = self.db.get(ConsumableOrder, self.order.id)

        self.assertEqual(exc_info.exception.status_code, 403)
        self.assertEqual(latest_order.status, ConsumableOrderStatus.APPROVED)
        self.assertEqual(self.db.exec(select(ConsumableOrderOperationLog)).all(), [])
        self.assertEqual(self.db.exec(select(LogTimeline)).all(), [])

    async def test_complete_rejects_pending_order_without_side_effects(self) -> None:
        self.order.status = ConsumableOrderStatus.PENDING
        self.db.add(self.order)
        self.db.commit()

        with self.assertRaises(HTTPException) as exc_info:
            await self._complete()

        latest_order = self.db.get(ConsumableOrder, self.order.id)

        self.assertEqual(exc_info.exception.status_code, 400)
        self.assertEqual(latest_order.status, ConsumableOrderStatus.PENDING)
        self.assertEqual(self.db.exec(select(ConsumableOrderOperationLog)).all(), [])
        self.assertEqual(self.db.exec(select(LogTimeline)).all(), [])

    async def test_complete_log_failure_rolls_back_status_claim(self) -> None:
        original_add = self.db.add

        def _failing_add(obj):
            if isinstance(obj, ConsumableOrderOperationLog):
                raise RuntimeError("consumable order log write failed")
            return original_add(obj)

        with patch.object(self.db, "add", side_effect=_failing_add):
            with self.assertRaises(RuntimeError):
                await self._complete()

        self.db.rollback()
        self.db.expire_all()
        latest_order = self.db.get(ConsumableOrder, self.order.id)

        self.assertEqual(latest_order.status, ConsumableOrderStatus.APPROVED)
        self.assertEqual(self.db.exec(select(ConsumableOrderOperationLog)).all(), [])
        self.assertEqual(self.db.exec(select(LogTimeline)).all(), [])


if __name__ == "__main__":
    unittest.main()
