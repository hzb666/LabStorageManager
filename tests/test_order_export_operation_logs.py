import json
import unittest

from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine, select

import app.models  # noqa: F401
from app.models.consumable_order_operation_log import ConsumableOrderOperationAction
from app.models.log_timeline import LogTimeline, LogTimelineSourceTable
from app.models.reagent_order_operation_log import ReagentOrderOperationAction
from app.models.user import User, UserRole
from app.services.order_operation_logger import (
    log_consumable_order_export,
    log_reagent_order_export,
    parse_consumable_order_snapshot,
    parse_reagent_order_snapshot,
)


class OrderExportOperationLogTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        SQLModel.metadata.create_all(self.engine)
        self.session = Session(self.engine)
        self.user = User(
            id=1,
            username="exporter",
            full_name="导出用户",
            role=UserRole.ADMIN,
            password_hash="x",
        )
        self.session.add(self.user)
        self.session.commit()

    def tearDown(self) -> None:
        self.session.close()
        SQLModel.metadata.drop_all(self.engine)

    def test_reagent_order_export_log_projects_to_timeline(self) -> None:
        log = log_reagent_order_export(
            self.session,
            exported_count=7,
            actor_user_id=self.user.id,
            is_cli=True,
        )
        self.session.commit()

        self.assertEqual(ReagentOrderOperationAction.EXPORT, log.action)
        self.assertEqual({"ct": 7}, json.loads(log.snapshot_json))
        self.assertEqual({"count": 7}, parse_reagent_order_snapshot(log.snapshot_json))

        timeline = self.session.exec(
            select(LogTimeline).where(
                LogTimeline.source_table == LogTimelineSourceTable.REAGENT_ORDER_OPERATION_LOG,
                LogTimeline.source_log_id == log.id,
            )
        ).one()
        self.assertEqual(self.user.id, timeline.actor_user_id)
        self.assertEqual(self.user.id, timeline.subject_user_id)
        self.assertEqual("[cli] 导出试剂订单 7 条", timeline.detail_search_text)

    def test_consumable_order_export_log_projects_to_timeline(self) -> None:
        log = log_consumable_order_export(
            self.session,
            exported_count=3,
            actor_user_id=self.user.id,
            is_cli=False,
        )
        self.session.commit()

        self.assertEqual(ConsumableOrderOperationAction.EXPORT, log.action)
        self.assertEqual({"ct": 3}, json.loads(log.snapshot_json))
        self.assertEqual({"count": 3}, parse_consumable_order_snapshot(log.snapshot_json))

        timeline = self.session.exec(
            select(LogTimeline).where(
                LogTimeline.source_table == LogTimelineSourceTable.CONSUMABLE_ORDER_OPERATION_LOG,
                LogTimeline.source_log_id == log.id,
            )
        ).one()
        self.assertEqual(self.user.id, timeline.actor_user_id)
        self.assertEqual(self.user.id, timeline.subject_user_id)
        self.assertEqual("导出耗材订单 3 条", timeline.detail_search_text)


if __name__ == "__main__":
    unittest.main()
