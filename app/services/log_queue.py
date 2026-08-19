"""Unified async file logging setup for request, audit, and error logs."""
from __future__ import annotations

import logging
import threading
from logging.handlers import QueueHandler, QueueListener, RotatingFileHandler
from pathlib import Path
from queue import Queue

from app.core.constants import LOG_FILE_MAX_BYTES

REQUEST_LOG_DIR = Path(__file__).parent.parent.parent / "logs"
REQUEST_LOG_FILE = REQUEST_LOG_DIR / "request.log"
REQUEST_LOGGER_NAME = "request_logger"
_LOG_FORMAT = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
_DEFAULT_DATE_FORMAT = "%Y-%m-%d %H:%M:%S"
_BOOTSTRAP_LOGGER = logging.getLogger(__name__)

_queue_lock = threading.Lock()
_log_queue: Queue | None = None
_queue_listener: QueueListener | None = None
_file_handlers: dict[str, logging.Handler] = {}
_configured_logger_names: set[str] = set()


class _ExactLoggerFilter(logging.Filter):
    def __init__(self, logger_name: str) -> None:
        super().__init__()
        self._logger_name = logger_name

    def filter(self, record: logging.LogRecord) -> bool:
        return record.name == self._logger_name


def _get_queue() -> Queue:
    global _log_queue
    if _log_queue is None:
        _log_queue = Queue()
    return _log_queue


def _build_rotating_file_handler(
    *,
    logger_name: str,
    file_path: Path,
    level: int,
    datefmt: str | None,
    backup_count: int,
) -> logging.Handler:
    file_path.parent.mkdir(parents=True, exist_ok=True)
    handler = RotatingFileHandler(
        file_path,
        maxBytes=LOG_FILE_MAX_BYTES,
        backupCount=backup_count,
        encoding="utf-8",
    )
    handler.setLevel(level)
    handler.setFormatter(logging.Formatter(_LOG_FORMAT, datefmt=datefmt))
    handler.addFilter(_ExactLoggerFilter(logger_name))
    return handler


def _attach_queue_handler(logger: logging.Logger) -> None:
    queue_obj = _get_queue()
    for handler in logger.handlers:
        if isinstance(handler, QueueHandler) and getattr(handler, "queue", None) is queue_obj:
            return
    logger.addHandler(QueueHandler(queue_obj))


def _restart_listener() -> QueueListener:
    global _queue_listener
    if _queue_listener is not None:
        _queue_listener.stop()
    _queue_listener = QueueListener(
        _get_queue(),
        *_file_handlers.values(),
        respect_handler_level=True,
    )
    _queue_listener.start()
    return _queue_listener


def get_async_file_logger(
    *,
    logger_name: str,
    file_path: Path,
    level: int,
    datefmt: str | None = _DEFAULT_DATE_FORMAT,
    backup_count: int = 5,
) -> logging.Logger:
    with _queue_lock:
        logger = logging.getLogger(logger_name)
        logger.setLevel(level)
        logger.propagate = False
        _attach_queue_handler(logger)
        _configured_logger_names.add(logger_name)

        if logger_name not in _file_handlers:
            _file_handlers[logger_name] = _build_rotating_file_handler(
                logger_name=logger_name,
                file_path=file_path,
                level=level,
                datefmt=datefmt,
                backup_count=backup_count,
            )
            _restart_listener()
        elif _queue_listener is None:
            _restart_listener()

        return logger


def get_request_logger() -> logging.Logger:
    try:
        return get_async_file_logger(
            logger_name=REQUEST_LOGGER_NAME,
            file_path=REQUEST_LOG_FILE,
            level=logging.INFO,
            datefmt=None,
            backup_count=5,
        )
    except OSError:
        logger = logging.getLogger(REQUEST_LOGGER_NAME)
        logger.handlers = [handler for handler in logger.handlers if not isinstance(handler, QueueHandler)]
        logger.addHandler(logging.NullHandler())
        logger.propagate = False
        _BOOTSTRAP_LOGGER.exception("Failed to initialize request logger at %s", REQUEST_LOG_FILE)
        return logger


def initialize_async_file_logging() -> QueueListener | None:
    listener = None
    try:
        get_request_logger()
        from app.services import audit_logger, error_logger

        audit_logger.get_audit_logger()
        error_logger.get_error_logger()
        listener = _queue_listener
    except OSError:
        return listener
    return listener


def shutdown_async_file_logging() -> None:
    global _queue_listener, _log_queue
    with _queue_lock:
        if _queue_listener is not None:
            _queue_listener.stop()
            _queue_listener = None

        for logger_name in _configured_logger_names:
            logger = logging.getLogger(logger_name)
            logger.handlers = [handler for handler in logger.handlers if not isinstance(handler, QueueHandler)]

        for handler in _file_handlers.values():
            handler.close()
        _file_handlers.clear()
        _configured_logger_names.clear()
        _log_queue = None
