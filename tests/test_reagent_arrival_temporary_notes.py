import unittest

from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

import app.models  # noqa: F401
from app.api.reagent_orders_workflow import (
    InventoryCreateOptions,
    _create_inventory_items_from_order,
)
from app.models.inventory import InventoryStatus
from app.models.reagent_order import ReagentOrder, ReagentOrderReason, ReagentOrderStatus


class ReagentArrivalTemporaryNotesTests(unittest.TestCase):
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

    def _build_order(self, notes: str | None) -> ReagentOrder:
        return ReagentOrder(
            cas_number="64-17-5",
            name="乙醇",
            category="溶剂",
            brand=None,
            purity=None,
            initial_quantity=1,
            unit="mg",
            quantity=1,
            price=1,
            order_reason=ReagentOrderReason.NOT_STOCKED,
            status=ReagentOrderStatus.APPROVED,
            notes=notes,
        )

    def test_temporary_arrival_keeps_notes_as_user_content_only(self) -> None:
        items = _create_inventory_items_from_order(
            self.session,
            self._build_order("用户备注"),
            options=InventoryCreateOptions(
                created_by_id=1,
                temporary_keeper_id=1,
                storage_location=None,
                inventory_status=InventoryStatus.IN_STOCK,
                remaining_quantity=1,
            ),
        )

        self.assertEqual("用户备注", items[0].notes)
        self.assertEqual(1, items[0].temporary_keeper_id)
        self.assertIsNone(items[0].storage_location)
        self.assertNotIn("暂存", items[0].notes or "")

    def test_temporary_arrival_without_notes_stays_empty(self) -> None:
        items = _create_inventory_items_from_order(
            self.session,
            self._build_order(None),
            options=InventoryCreateOptions(
                created_by_id=1,
                temporary_keeper_id=1,
                storage_location=None,
                inventory_status=InventoryStatus.IN_STOCK,
                remaining_quantity=1,
            ),
        )

        self.assertIsNone(items[0].notes)


if __name__ == "__main__":
    unittest.main()
