"""Wechat public account callback API."""

import logging

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, Request, status
from fastapi.responses import PlainTextResponse, Response

from app.core.config import settings
from app.core.wechat_security import verify_wechat_signature
from app.database import DBSession
from app.services.wechat_service import WechatService, summarize_wechat_memory
from app.services.wechat_xml import WechatXmlError, build_text_reply_xml, parse_wechat_xml

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/wechat", tags=["Wechat"])


@router.get("/callback")
def verify_callback(
    signature: str = Query(default=""),
    timestamp: str = Query(default=""),
    nonce: str = Query(default=""),
    echostr: str = Query(default=""),
) -> PlainTextResponse:
    """Wechat server URL verification endpoint."""

    _require_valid_signature(signature=signature, timestamp=timestamp, nonce=nonce)
    return PlainTextResponse(echostr)


@router.post("/callback")
async def receive_message(
    request: Request,
    background_tasks: BackgroundTasks,
    db: DBSession,
    signature: str = Query(default=""),
    timestamp: str = Query(default=""),
    nonce: str = Query(default=""),
) -> Response:
    """Receive and passively reply to Wechat messages."""

    _require_valid_signature(signature=signature, timestamp=timestamp, nonce=nonce)
    _reject_oversized_content_length(request)
    payload = await request.body()
    try:
        message = parse_wechat_xml(payload, max_bytes=settings.wechat_max_xml_bytes)
    except WechatXmlError as exc:
        logger.warning("Rejected invalid Wechat XML: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid Wechat XML",
        ) from exc

    result = await WechatService(db).handle_message(message)
    if result.schedule_memory_summary and result.memory_user_id is not None:
        background_tasks.add_task(summarize_wechat_memory, result.memory_user_id)
    if not result.reply_text:
        return PlainTextResponse("success")

    reply_xml = build_text_reply_xml(
        to_user=message.from_user_name,
        from_user=message.to_user_name,
        content=result.reply_text,
    )
    return Response(content=reply_xml, media_type="application/xml; charset=utf-8")


def _require_valid_signature(*, signature: str, timestamp: str, nonce: str) -> None:
    if verify_wechat_signature(
        token=settings.wechat_token,
        signature=signature,
        timestamp=timestamp,
        nonce=nonce,
    ):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Invalid Wechat signature",
    )


def _reject_oversized_content_length(request: Request) -> None:
    raw_content_length = request.headers.get("content-length")
    if not raw_content_length:
        return
    try:
        content_length = int(raw_content_length)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid Content-Length header",
        ) from exc
    if content_length > settings.wechat_max_xml_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Wechat XML body is too large",
        )
