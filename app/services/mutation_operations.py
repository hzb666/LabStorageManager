"""统一写入防重：先占用操作号，随业务事务提交凭据，再保存可重放响应。"""
from __future__ import annotations

import hashlib
import json
import logging
import re
import time
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from fastapi import HTTPException
from sqlalchemy import delete, event, update
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session
from starlette.responses import Response

from app.core.time_utils import get_utc_now
from app.models.mutation_operation import MutationOperation

logger = logging.getLogger(__name__)
OPERATION_HEADER = "Idempotency-Key"
RESPONSE_HEADER = "X-Operation-ID"
REPLAY_HEADERS = {"content-type", "x-error-code", "x-auth-error-code", "retry-after"}
OPERATION_RETENTION_DAYS = 7
MAX_FUTURE_SKEW_SECONDS = 86400
_last_cleanup_at = 0.0


class OperationReplay(Exception):
    def __init__(self, response: Response):
        self.response = response


@dataclass
class OperationContext:
    user_id: int
    operation_id: str
    db: Session
    committed: bool = False


def request_fingerprint(method: str, path: str, query: str, body: bytes) -> str:
    if body:
        body = json.dumps(
            json.loads(body), sort_keys=True, separators=(",", ":"), ensure_ascii=False,
        ).encode()
    return hashlib.sha256(b"\n".join([method.encode(), path.encode(), query.encode(), body])).hexdigest()


def replay_response(operation: MutationOperation) -> Response:
    if operation.response_body is None or operation.status_code is None:
        raise HTTPException(
            status_code=409,
            detail="操作结果正在确认，请勿重复创建提交",
            headers={"X-Error-Code": "OPERATION_PENDING", RESPONSE_HEADER: operation.operation_id},
        )
    return Response(
        content=operation.response_body,
        status_code=operation.status_code,
        headers={**json.loads(operation.response_headers), RESPONSE_HEADER: operation.operation_id},
    )


def reserve_operation(db: Session, user_id: int, operation_id: str, fingerprint: str) -> OperationContext:
    if not re.fullmatch(r"[0-9a-f]{12}_[0-9a-f]{32}", operation_id):
        raise HTTPException(status_code=400, detail="无效的操作标识")
    age_seconds = time.time() - int(operation_id.split("_", 1)[0], 16) / 1000
    if age_seconds > OPERATION_RETENTION_DAYS * 86400 or age_seconds < -MAX_FUTURE_SKEW_SECONDS:
        raise HTTPException(
            status_code=409, detail="操作标识已过期或设备时间异常，请先核实原操作结果",
            headers={"X-Error-Code": "OPERATION_EXPIRED"},
        )
    with Session(db.get_bind()) as receipt_db:
        operation = receipt_db.get(MutationOperation, (user_id, operation_id))
        if operation is None:
            if time.monotonic() - _last_cleanup_at >= 3600:
                _purge_expired_operations(receipt_db)
            operation = MutationOperation(
                user_id=user_id, operation_id=operation_id, fingerprint=fingerprint,
            )
            receipt_db.add(operation)
            try:
                receipt_db.commit()
            except IntegrityError:
                receipt_db.rollback()
                operation = receipt_db.get(MutationOperation, (user_id, operation_id))
            else:
                context = OperationContext(user_id=user_id, operation_id=operation_id, db=db)
                _track_business_commit(context)
                return context
        if operation is None:
            raise RuntimeError("Operation reservation disappeared")
        if operation.fingerprint != fingerprint:
            raise HTTPException(status_code=409, detail="同一操作标识不能用于不同的提交内容")
        raise OperationReplay(replay_response(operation))


def _track_business_commit(context: OperationContext) -> None:
    def before_commit(db: Session) -> None:
        if not context.committed:
            # 与业务数据、业务日志共用事务，提交失败时这条凭据也会回滚。
            db.exec(update(MutationOperation).where(
                MutationOperation.user_id == context.user_id,
                MutationOperation.operation_id == context.operation_id,
            ).values(state="committed"))

    def after_commit(_db: Session) -> None:
        context.committed = True

    event.listen(context.db, "before_commit", before_commit)
    event.listen(context.db, "after_commit", after_commit)
    context.db.info["mutation_operation_listeners"] = (before_commit, after_commit)


def finish_operation(context: OperationContext, response: Response | None) -> None:
    listeners = context.db.info.pop("mutation_operation_listeners", ())
    for name, listener in zip(("before_commit", "after_commit"), listeners, strict=False):
        event.remove(context.db, name, listener)
    try:
        # 先释放业务失败后的写锁及提交后的读事务，再用独立事务保存响应。
        context.db.rollback()
        _save_response(context, response)
    except Exception:
        # 凭据落库异常不能把已经提交成功的业务改报为失败；保留原来的占位，禁止重复执行。
        logger.exception("Could not finalize mutation operation %s", context.operation_id)


def _save_response(context: OperationContext, response: Response | None) -> None:
    with Session(context.db.get_bind()) as db:
        operation = db.get(MutationOperation, (context.user_id, context.operation_id))
        if operation is None:
            return
        committed = context.committed or operation.state == "committed"
        if response is None or (response.status_code >= 400 and committed):
            operation.state = "committed" if committed else "uncertain"
        else:
            operation.state = "succeeded" if response.status_code < 400 else "failed"
            operation.status_code = response.status_code
            operation.response_body = _response_body(response)
            operation.response_headers = json.dumps({
                key: value for key, value in response.headers.items() if key in REPLAY_HEADERS
            })
        db.add(operation)
        db.commit()


def _response_body(response: Response) -> str:
    body = bytes(response.body).decode("utf-8")
    if response.status_code == 422:
        data = json.loads(body)
        if isinstance(data.get("detail"), list):
            # FastAPI 校验错误可能包含输入原文（例如密码）；凭据仅保留字段位置及错误信息。
            data["detail"] = [
                {key: value for key, value in item.items() if key not in {"input", "ctx"}}
                if isinstance(item, dict) else item
                for item in data["detail"]
            ]
            body = json.dumps(data, ensure_ascii=False)
    return body


def operation_status(db: Session, user_id: int, operation_id: str) -> dict[str, Any]:
    operation = db.get(MutationOperation, (user_id, operation_id))
    if operation is None:
        return {"state": "missing"}
    result: dict[str, Any] = {"state": operation.state}
    if operation.response_body is not None:
        result["response"] = {
            "status_code": operation.status_code,
            "body": operation.response_body,
            "headers": json.loads(operation.response_headers),
        }
    return result


def cleanup_mutation_operations(db: Session) -> None:
    _purge_expired_operations(db)
    db.commit()


def _purge_expired_operations(db: Session) -> None:
    global _last_cleanup_at
    # 设备时间允许快一天，凭据必须覆盖操作号的整个有效期，避免清理后同号再次执行。
    db.exec(delete(MutationOperation).where(
        MutationOperation.created_at < get_utc_now() - timedelta(
            days=OPERATION_RETENTION_DAYS, seconds=MAX_FUTURE_SKEW_SECONDS,
        ),
    ))
    _last_cleanup_at = time.monotonic()

