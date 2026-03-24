"""
Audit logger service for security-sensitive operations.

This logger is intentionally separated from the root logger so audit events
can be retained even when production root level is set to WARNING.
"""

import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path

from app.core.constants import LOG_FILE_MAX_BYTES


AUDIT_LOG_DIR = Path(__file__).parent.parent.parent / "logs"
AUDIT_LOG_FILE = AUDIT_LOG_DIR / "audit.log"
AUDIT_LOGGER_NAME = "audit_logger"
_BOOTSTRAP_LOGGER = logging.getLogger(__name__)


def get_audit_logger() -> logging.Logger:
    """Return singleton audit logger configured with dedicated file handler."""
    logger = logging.getLogger(AUDIT_LOGGER_NAME)
    if logger.handlers:
        return logger

    try:
        AUDIT_LOG_DIR.mkdir(parents=True, exist_ok=True)

        handler = RotatingFileHandler(
            AUDIT_LOG_FILE,
            maxBytes=LOG_FILE_MAX_BYTES,
            backupCount=5,
            encoding="utf-8",
        )
        handler.setLevel(logging.INFO)
        handler.setFormatter(
            logging.Formatter(
                "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
                datefmt="%Y-%m-%d %H:%M:%S",
            )
        )

        logger.setLevel(logging.INFO)
        logger.addHandler(handler)
        logger.propagate = False
    except OSError:
        # 审计日志初始化失败时不阻断业务请求（例如只读文件系统/权限不足）
        logger.addHandler(logging.NullHandler())
        logger.propagate = False
        _BOOTSTRAP_LOGGER.exception("Failed to initialize audit logger at %s", AUDIT_LOG_FILE)

    return logger


def log_audit_event(
    action: str,
    *,
    actor_user_id: int | None = None,
    target_user_id: int | None = None,
    client_ip: str | None = None,
    request_id: str | None = None,
    outcome: str = "success",
    detail: str | None = None,
) -> None:
    """Record normalized audit event line."""
    try:
        logger = get_audit_logger()
        message = (
            f"AUDIT action={action} outcome={outcome} "
            f"actor_user_id={actor_user_id if actor_user_id is not None else '-'} "
            f"target_user_id={target_user_id if target_user_id is not None else '-'} "
            f"client_ip={client_ip or '-'} request_id={request_id or '-'}"
        )
        if detail:
            message = f"{message} detail={detail}"
        logger.info(message)
    except Exception:
        # 审计日志属于附加能力，任何异常都不能影响主业务接口。
        _BOOTSTRAP_LOGGER.exception("Failed to write audit event: action=%s", action)
