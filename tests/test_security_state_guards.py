import unittest

from fastapi import HTTPException
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

import app.models  # noqa: F401
from app.api import reagent_orders_workflow
from app.api.consumable_orders import (
    _claim_consumable_order_status_transition,
    _ensure_consumable_order_deletable,
    _ensure_consumable_order_rejectable,
)
from app.models.consumable_order import ConsumableOrder, ConsumableOrderStatus
from app.models.inventory import Inventory, InventoryStatus
from app.models.reagent_order import ReagentOrder, ReagentOrderReason, ReagentOrderStatus
from app.models.user import User, UserRole
from app.services.inventory_state_guards import (
    ensure_inventory_deletable,
    ensure_inventory_editable,
)


def _assert_http_error(case: unittest.TestCase, status_code: int, func, *args, **kwargs) -> None:
    with case.assertRaises(HTTPException) as caught:
        func(*args, **kwargs)
    case.assertEqual(status_code, caught.exception.status_code)


class SecurityStateGuardTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        SQLModel.metadata.create_all(self.engine)
        self.session = Session(self.engine)

    def tearDown(self) -> None:
        self.session.close()
        SQLModel.metadata.drop_all(self.engine)

    def test_inventory_guards_block_borrowed_and_pending_stockin_items(self) -> None:
        borrowed = Inventory(
            internal_code="INV-BORROWED",
            cas_number="64-17-5",
            name="乙醇",
            category="溶剂",
            brand="Sigma",
            status=InventoryStatus.BORROWED,
        )
        pending_stockin = Inventory(
            internal_code="INV-PENDING",
            cas_number="64-17-5",
            name="乙醇",
            category="溶剂",
            brand="Sigma",
            status=InventoryStatus.IN_STOCK,
            storage_location=None,
            temporary_keeper_id=1,
        )

        _assert_http_error(self, 409, ensure_inventory_editable, borrowed)
        _assert_http_error(self, 409, ensure_inventory_deletable, borrowed)
        _assert_http_error(self, 409, ensure_inventory_editable, pending_stockin)
        _assert_http_error(self, 409, ensure_inventory_deletable, pending_stockin)

    def test_arrived_stock_in_requires_temporary_keeper(self) -> None:
        order = ReagentOrder(
            cas_number="64-17-5",
            name="乙醇",
            category="溶剂",
            brand="Sigma",
            quantity=1,
            price=1,
            order_reason=ReagentOrderReason.NOT_STOCKED,
            status=ReagentOrderStatus.ARRIVED,
            initial_quantity=1,
            unit="mL",
        )
        self.session.add(order)
        self.session.commit()
        self.session.refresh(order)

        item = Inventory(
            internal_code="INV-PENDING-ORDER",
            cas_number="64-17-5",
            name="乙醇",
            category="溶剂",
            brand="Sigma",
            status=InventoryStatus.IN_STOCK,
            source_order_id=order.id,
            temporary_keeper_id=1,
        )
        self.session.add(item)
        self.session.commit()

        keeper = User(id=1, username="keeper", role=UserRole.USER, password_hash="x")
        other_user = User(id=2, username="other", role=UserRole.USER, password_hash="x")

        items = reagent_orders_workflow._get_arrived_pending_items(
            self.session,
            order,
            current_user=keeper,
        )
        self.assertEqual([item.id], [found.id for found in items])
        _assert_http_error(
            self,
            403,
            reagent_orders_workflow._get_arrived_pending_items,
            self.session,
            order,
            current_user=other_user,
        )

    def test_reagent_transition_claim_allows_one_status_change(self) -> None:
        order = ReagentOrder(
            cas_number="64-17-5",
            name="乙醇",
            category="溶剂",
            brand="Sigma",
            quantity=1,
            price=1,
            order_reason=ReagentOrderReason.NOT_STOCKED,
            status=ReagentOrderStatus.APPROVED,
        )
        self.session.add(order)
        self.session.commit()
        self.session.refresh(order)

        reagent_orders_workflow._claim_reagent_order_status_transition(
            self.session,
            order_id=order.id,
            expected_status=ReagentOrderStatus.APPROVED,
            target_status=ReagentOrderStatus.ARRIVED,
        )
        self.session.commit()
        self.session.expire_all()
        self.assertEqual(ReagentOrderStatus.ARRIVED, self.session.get(ReagentOrder, order.id).status)

        _assert_http_error(
            self,
            409,
            reagent_orders_workflow._claim_reagent_order_status_transition,
            self.session,
            order_id=order.id,
            expected_status=ReagentOrderStatus.APPROVED,
            target_status=ReagentOrderStatus.STOCKED,
        )

    def test_consumable_delete_and_reject_state_guards(self) -> None:
        approved = ConsumableOrder(name="手套", quantity=1, status=ConsumableOrderStatus.APPROVED)
        completed = ConsumableOrder(name="枪头", quantity=1, status=ConsumableOrderStatus.COMPLETED)
        pending = ConsumableOrder(name="滤膜", quantity=1, status=ConsumableOrderStatus.PENDING)

        _assert_http_error(self, 409, _ensure_consumable_order_deletable, approved)
        _assert_http_error(self, 409, _ensure_consumable_order_deletable, completed)
        _ensure_consumable_order_rejectable(pending)
        _ensure_consumable_order_rejectable(approved)
        _assert_http_error(self, 400, _ensure_consumable_order_rejectable, completed)

    def test_consumable_transition_claim_allows_one_status_change(self) -> None:
        order = ConsumableOrder(
            name="手套",
            specification="M",
            quantity=1,
            status=ConsumableOrderStatus.APPROVED,
        )
        self.session.add(order)
        self.session.commit()
        self.session.refresh(order)

        _claim_consumable_order_status_transition(
            self.session,
            order_id=order.id,
            expected_status=ConsumableOrderStatus.APPROVED,
            target_status=ConsumableOrderStatus.COMPLETED,
        )
        self.session.commit()
        self.session.expire_all()
        self.assertEqual(
            ConsumableOrderStatus.COMPLETED,
            self.session.get(ConsumableOrder, order.id).status,
        )

        _assert_http_error(
            self,
            409,
            _claim_consumable_order_status_transition,
            self.session,
            order_id=order.id,
            expected_status=ConsumableOrderStatus.APPROVED,
            target_status=ConsumableOrderStatus.REJECTED,
        )


if __name__ == "__main__":
    unittest.main()
