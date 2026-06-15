import unittest
from datetime import datetime
from unittest.mock import patch

from sqlalchemy import text
from sqlmodel import SQLModel, Session, create_engine, select

from app.database import init_db, normalize_legacy_enum_storage
from app.models.reagent_order import ReagentOrder, ReagentOrderReason, ReagentOrderStatus
from app.models.user import User


class LegacyEnumStorageTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite://")
        SQLModel.metadata.create_all(
            self.engine,
            tables=[User.__table__, ReagentOrder.__table__],
        )

    def tearDown(self) -> None:
        SQLModel.metadata.drop_all(
            self.engine,
            tables=[ReagentOrder.__table__, User.__table__],
        )
        self.engine.dispose()

    def test_normalizes_legacy_reagent_order_enums_before_orm_reads(self) -> None:
        timestamp = datetime(2026, 3, 18, 9, 30, 0)

        with self.engine.begin() as connection:
            connection.execute(
                text(
                    """
                    INSERT INTO reagentorder (
                        cas_number,
                        name,
                        quantity,
                        price,
                        order_reason,
                        is_hazardous,
                        status,
                        created_at,
                        updated_at
                    ) VALUES (
                        :cas_number,
                        :name,
                        :quantity,
                        :price,
                        :order_reason,
                        :is_hazardous,
                        :status,
                        :created_at,
                        :updated_at
                    )
                    """
                ),
                {
                    "cas_number": "64-17-5",
                    "name": "乙醇",
                    "quantity": 1,
                    "price": 99.0,
                    "order_reason": "running_out",
                    "is_hazardous": 0,
                    "status": "pending",
                    "created_at": timestamp,
                    "updated_at": timestamp,
                },
            )

            updated_rows = normalize_legacy_enum_storage(connection)

        self.assertEqual(updated_rows, 2)

        with self.engine.connect() as connection:
            row = connection.execute(
                text("SELECT status, order_reason FROM reagentorder")
            ).one()

        self.assertEqual(row.status, "PENDING")
        self.assertEqual(row.order_reason, "RUNNING_OUT")

        with Session(self.engine) as session:
            order = session.exec(select(ReagentOrder)).one()

        self.assertEqual(order.status, ReagentOrderStatus.PENDING)
        self.assertEqual(order.order_reason, ReagentOrderReason.RUNNING_OUT)

    def test_init_db_does_not_normalize_legacy_enums_automatically(self) -> None:
        with (
            patch("app.database.SQLModel.metadata.create_all"),
            patch("app.database._create_default_admin"),
            patch("app.database.normalize_legacy_enum_storage") as normalize_mock,
        ):
            init_db()

        normalize_mock.assert_not_called()


if __name__ == "__main__":
    unittest.main()
