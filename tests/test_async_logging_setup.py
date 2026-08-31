from __future__ import annotations

import importlib
import logging
import shutil
import unittest
from logging.handlers import QueueHandler
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from app.services import audit_logger, error_logger


class AsyncLoggingSetupTests(unittest.TestCase):
    def setUp(self) -> None:
        self.log_queue = None

    def tearDown(self) -> None:
        if self.log_queue is not None:
            self.log_queue.shutdown_async_file_logging()

    def _load_log_queue(self):
        try:
            self.log_queue = importlib.import_module("app.services.log_queue")
        except ModuleNotFoundError:
            self.fail("缺少 app.services.log_queue 模块，无法覆盖异步文件日志回归测试")
        return self.log_queue

    def test_async_logging_uses_queue_handler_and_flushes_to_file(self) -> None:
        log_queue = self._load_log_queue()
        temp_path = Path.cwd() / f".tmp-async-logging-{uuid4().hex}"
        temp_path.mkdir(parents=True, exist_ok=False)
        try:
            request_log_file = temp_path / "request.log"
            audit_log_file = temp_path / "audit.log"
            error_log_file = temp_path / "error.log"

            with (
                patch.object(log_queue, "REQUEST_LOG_DIR", temp_path),
                patch.object(log_queue, "REQUEST_LOG_FILE", request_log_file),
                patch.object(audit_logger, "AUDIT_LOG_DIR", temp_path),
                patch.object(audit_logger, "AUDIT_LOG_FILE", audit_log_file),
                patch.object(error_logger, "LOG_DIR", temp_path),
                patch.object(error_logger, "LOG_FILE", error_log_file),
            ):
                listener = log_queue.initialize_async_file_logging()
                request_logger = log_queue.get_request_logger()
                queued_handlers = [handler for handler in request_logger.handlers if isinstance(handler, QueueHandler)]

                self.assertIsNotNone(listener)
                self.assertTrue(queued_handlers)
                self.assertTrue(any(isinstance(handler, QueueHandler) for handler in audit_logger.get_audit_logger().handlers))
                self.assertTrue(any(isinstance(handler, QueueHandler) for handler in error_logger.get_error_logger().handlers))

                request_logger.info("request-log-smoke")
                audit_logger.log_audit_event("login")
                error_logger.get_error_logger().error("error-log-smoke")
                log_queue.shutdown_async_file_logging()

            self.assertIn("request-log-smoke", request_log_file.read_text(encoding="utf-8"))
            self.assertIn("AUDIT action=login", audit_log_file.read_text(encoding="utf-8"))
            self.assertIn("error-log-smoke", error_log_file.read_text(encoding="utf-8"))
        finally:
            shutil.rmtree(temp_path, ignore_errors=True)

    def test_request_logger_init_failure_is_reported(self) -> None:
        log_queue = self._load_log_queue()
        with (
            patch("app.services.log_queue._build_rotating_file_handler", side_effect=OSError("boom")),
            patch("app.services.log_queue._BOOTSTRAP_LOGGER.exception") as bootstrap_logger,
        ):
            logger = log_queue.get_request_logger()

        self.assertTrue(any(isinstance(handler, logging.NullHandler) for handler in logger.handlers))
        bootstrap_logger.assert_called_once()

    def test_audit_logger_retries_after_bootstrap_failure(self) -> None:
        audit_logger_instance = logging.getLogger(audit_logger.AUDIT_LOGGER_NAME)
        audit_logger_instance.handlers.clear()
        recovered_logger = logging.getLogger("audit-logger-recovered")

        with patch("app.services.log_queue.get_async_file_logger", side_effect=[OSError("boom"), recovered_logger]) as get_logger:
            first_logger = audit_logger.get_audit_logger()
            self.assertTrue(any(isinstance(handler, logging.NullHandler) for handler in first_logger.handlers))
            second_logger = audit_logger.get_audit_logger()

        self.assertIs(second_logger, recovered_logger)
        self.assertEqual(get_logger.call_count, 2)

    def test_error_logger_retries_after_bootstrap_failure(self) -> None:
        error_logger_instance = logging.getLogger("error_logger")
        error_logger_instance.handlers.clear()
        recovered_logger = logging.getLogger("error-logger-recovered")

        with patch("app.services.log_queue.get_async_file_logger", side_effect=[OSError("boom"), recovered_logger]) as get_logger:
            first_logger = error_logger.get_error_logger()
            self.assertTrue(any(isinstance(handler, logging.NullHandler) for handler in first_logger.handlers))
            second_logger = error_logger.get_error_logger()

        self.assertIs(second_logger, recovered_logger)
        self.assertEqual(get_logger.call_count, 2)


if __name__ == "__main__":
    unittest.main()
