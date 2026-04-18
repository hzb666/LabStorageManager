"""WeChat callback API."""

from __future__ import annotations

import logging
import time
from xml.etree import ElementTree as ET

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import verify_wechat_signature
from app.db.base import Base
from app.db.session import engine, get_db_session
from app.services.wechat_service import WechatService
from app.utils.xml import build_text_reply_xml, parse_wechat_xml

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/wechat", tags=["wechat"])

Base.metadata.create_all(bind=engine)


@router.get("/callback", response_class=PlainTextResponse)
def verify_callback(
    signature: str = Query(default=""),
    timestamp: str = Query(default=""),
    nonce: str = Query(default=""),
    echostr: str = Query(default=""),
) -> str:
    if not verify_wechat_signature(settings.wechat_token, signature, timestamp, nonce):
        raise HTTPException(status_code=403, detail="signature mismatch")
    return echostr


@router.post("/callback")
async def wechat_callback(request: Request, db: Session = Depends(get_db_session)) -> Response:
    xml_payload = (await request.body()).decode("utf-8", errors="ignore")
    try:
        message = parse_wechat_xml(xml_payload)
    except ET.ParseError as exc:
        logger.warning("invalid wechat xml: %s", exc)
        raise HTTPException(status_code=400, detail="invalid xml") from exc

    if not message.from_user_name or not message.to_user_name:
        raise HTTPException(status_code=400, detail="invalid xml")

    service = WechatService(db)
    reply_text = await service.handle_message(message)
    if not reply_text:
        return Response(content="", media_type="application/xml")

    reply_xml = build_text_reply_xml(
        to_user=message.from_user_name,
        from_user=message.to_user_name,
        content=reply_text,
        create_time=int(time.time()),
    )
    return Response(content=reply_xml, media_type="application/xml")
