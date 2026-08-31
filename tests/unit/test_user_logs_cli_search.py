import unittest

from sqlalchemy import create_engine, text
from sqlalchemy.dialects import sqlite
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, select

import app.models  # noqa: F401
from app.api.user_logs import _apply_log_timeline_keyword_filter, _matches_cli_log_keyword
from app.models.log_timeline import LogTimeline, LogTimelineSourceTable
from app.models.user_operation_log import UserOperationAction, UserOperationLog
from app.services.log_timeline_detail_backfill import (
    clear_log_timeline_user_operation_search_text,
)
from app.services.log_timeline_projection import project_user_operation_log


def _where_sql(statement) -> str:
    compiled = _compile_statement(statement)
    return str(compiled).lower().partition("where")[2]


def _compile_statement(statement):
    compiled = statement.compile(
        dialect=sqlite.dialect(),
        compile_kwargs={"render_postcompile": True},
    )
    return compiled


class UserLogsCliSearchTests(unittest.TestCase):
    def _create_memory_engine(self):
        engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        SQLModel.metadata.create_all(engine)
        return engine

    def test_cli_display_keywords_match_cli_logs(self) -> None:
        for keyword in ("cli", "CLI", "[cli]", "[CLI]", "命令行"):
            with self.subTest(keyword=keyword):
                self.assertTrue(_matches_cli_log_keyword(keyword))

    def test_regular_log_keywords_do_not_match_cli_logs(self) -> None:
        for keyword in ("乙醇", "库存", ""):
            with self.subTest(keyword=keyword):
                self.assertFalse(_matches_cli_log_keyword(keyword))

    def test_log_timeline_cli_keyword_filter_includes_cli_origin_clause(self) -> None:
        statement = _apply_log_timeline_keyword_filter(select(LogTimeline), "[cli]")

        self.assertIn("is_cli", _where_sql(statement))

    def test_log_timeline_regular_keyword_filter_does_not_force_cli_origin(self) -> None:
        statement = _apply_log_timeline_keyword_filter(select(LogTimeline), "乙醇")

        self.assertNotIn("is_cli", _where_sql(statement))

    def test_short_keyword_filter_searches_display_detail_text(self) -> None:
        statement = _apply_log_timeline_keyword_filter(select(LogTimeline), "归还")

        self.assertIn("detail_search_text", _where_sql(statement))

    def test_borrow_state_keyword_does_not_expand_to_all_borrow_logs(self) -> None:
        statement = _apply_log_timeline_keyword_filter(select(LogTimeline), "未归还")
        compiled = _compile_statement(statement)

        match_query = str(compiled.params.get("log_timeline_fts_match_query", ""))
        self.assertIn("detail_search_text", match_query)
        self.assertNotIn("source_table", match_query)

    def test_user_operation_projection_does_not_store_dynamic_user_name(self) -> None:
        engine = self._create_memory_engine()

        with Session(engine) as session:
            log = UserOperationLog(
                actor_user_id=1,
                target_user_id=2,
                action=UserOperationAction.UPDATE_PROFILE,
                detail="username=alice",
                snapshot_json='{"un":"alice"}',
            )
            session.add(log)
            session.flush()

            timeline = project_user_operation_log(session, log=log, is_cli=False)

            self.assertEqual("", timeline.search_text)
            self.assertEqual("", timeline.search_text_pinyin)
            self.assertEqual("修改用户资料", timeline.detail_search_text)
            self.assertNotIn("alice", timeline.detail_search_text)
            self.assertNotIn("username=", timeline.detail_search_text)

    def test_existing_user_operation_search_names_are_cleared(self) -> None:
        engine = self._create_memory_engine()

        with engine.begin() as connection:
            connection.execute(
                text(
                    """
                    INSERT INTO user_operation_log (
                        id,
                        actor_user_id,
                        target_user_id,
                        action,
                        outcome,
                        detail,
                        snapshot_json,
                        created_at
                    )
                    VALUES (
                        1,
                        1,
                        2,
                        'login',
                        'failure',
                        'username=Alice',
                        '{}',
                        CURRENT_TIMESTAMP
                    )
                    """
                )
            )
            connection.execute(
                text(
                    """
                    INSERT INTO log_timeline (
                        occurred_at,
                        is_cli,
                        actor_user_id,
                        subject_user_id,
                        source_table,
                        source_log_id,
                        search_text,
                        search_text_pinyin,
                        detail_search_text
                    )
                    VALUES (
                        CURRENT_TIMESTAMP,
                        0,
                        1,
                        2,
                        :source_table,
                        1,
                        'Alice',
                        'alice',
                        '用户登录 (username=Alice)'
                    )
                    """
                ),
                {"source_table": LogTimelineSourceTable.USER_OPERATION_LOG.value},
            )

            cleared_rows = clear_log_timeline_user_operation_search_text(connection)
            row = connection.execute(
                text(
                    """
                    SELECT search_text, search_text_pinyin, detail_search_text
                    FROM log_timeline
                    WHERE source_table = :source_table
                    """
                ),
                {"source_table": LogTimelineSourceTable.USER_OPERATION_LOG.value},
            ).one()

            self.assertEqual(1, cleared_rows)
            self.assertEqual(("", "", "用户登录"), tuple(row))


if __name__ == "__main__":
    unittest.main()
