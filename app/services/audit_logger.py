# 审计日志单独落盘，避免主日志级别过高时丢失安全事件。

import logging
from dataclasses import dataclass
from pathlib import Path

AUDIT_LOG_DIR = Path(__file__).parent.parent.parent / "logs"
AUDIT_LOG_FILE = AUDIT_LOG_DIR / "audit.log"
AUDIT_LOGGER_NAME = "audit_logger"
_BOOTSTRAP_LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True)
class AuditEventContext:
    actor_user_id: int | None = None
    target_user_id: int | None = None
    client_ip: str | None = None
    request_id: str | None = None


def get_audit_logger() -> logging.Logger:
    logger = logging.getLogger(AUDIT_LOGGER_NAME)
    if logger.handlers and not all(isinstance(handler, logging.NullHandler) for handler in logger.handlers):
        return logger
    logger.handlers = [handler for handler in logger.handlers if not isinstance(handler, logging.NullHandler)]

    try:
        from app.services.log_queue import get_async_file_logger

        return get_async_file_logger(
            logger_name=AUDIT_LOGGER_NAME,
            file_path=AUDIT_LOG_FILE,
            level=logging.INFO,
            datefmt="%Y-%m-%d %H:%M:%S",
            backup_count=5,
        )
    except OSError:
        # 审计日志初始化失败时不阻断业务请求（例如只读文件系统/权限不足）
        logger.handlers = [handler for handler in logger.handlers if handler.__class__.__name__ != "QueueHandler"]
        logger.addHandler(logging.NullHandler())
        logger.propagate = False
        _BOOTSTRAP_LOGGER.exception("Failed to initialize audit logger at %s", AUDIT_LOG_FILE)

    return logger


def log_audit_event(
    action: str,
    *,
    context: AuditEventContext | None = None,
    outcome: str = "success",
    detail: str | None = None,
) -> None:
    try:
        logger = get_audit_logger()
        audit_context = context or AuditEventContext()
        message = (
            f"AUDIT action={action} outcome={outcome} "
            f"actor_user_id={audit_context.actor_user_id if audit_context.actor_user_id is not None else '-'} "
            f"target_user_id={audit_context.target_user_id if audit_context.target_user_id is not None else '-'} "
            f"client_ip={audit_context.client_ip or '-'} request_id={audit_context.request_id or '-'}"
        )
        if detail:
            message = f"{message} detail={detail}"
        logger.info(message)
    except Exception:
        # 审计日志属于附加能力，任何异常都不能影响主业务接口。
        _BOOTSTRAP_LOGGER.exception("Failed to write audit event: action=%s", action)
