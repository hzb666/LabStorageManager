from __future__ import annotations

from hashlib import sha1
from xml.etree import ElementTree

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine, select

from app.api.wechat import router
from app.core.config import settings
from app.database import get_db
from app.models.wechat import ProcessedWechatEvent, WechatChatMessage, WechatUser
from app.services.wechat_llm_service import WechatLLMService

TOKEN = "wechat-token"


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch) -> tuple[TestClient, object]:
    monkeypatch.setattr(settings, "wechat_token", TOKEN)
    monkeypatch.setattr(settings, "wechat_max_xml_bytes", 4096)
    monkeypatch.setattr(settings, "wechat_memory_summary_every_messages", 200)

    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)

    def override_get_db():
        with Session(engine) as session:
            yield session

    app = FastAPI()
    app.dependency_overrides[get_db] = override_get_db
    app.include_router(router)
    return TestClient(app), engine


def test_get_callback_requires_valid_signature(client: tuple[TestClient, object]) -> None:
    test_client, _engine = client

    assert test_client.get("/wechat/callback", params={"echostr": "ok"}).status_code == 403

    response = test_client.get(
        "/wechat/callback",
        params={**_signed_params(), "echostr": "ok"},
    )

    assert response.status_code == 200
    assert response.text == "ok"


def test_post_rejects_invalid_signature_before_db_write(
    client: tuple[TestClient, object],
) -> None:
    test_client, engine = client

    response = test_client.post(
        "/wechat/callback",
        params={"signature": "bad", "timestamp": "1", "nonce": "n"},
        content=_text_xml(msg_id="m1", content="hello"),
    )

    assert response.status_code == 403
    assert _count(engine, WechatUser) == 0


def test_text_message_replies_and_replays_duplicate(
    client: tuple[TestClient, object],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    test_client, engine = client
    calls = 0

    async def fake_generate_reply(self, **kwargs):  # noqa: ANN001, ANN003
        nonlocal calls
        calls += 1
        return "库存助手回复"

    monkeypatch.setattr(WechatLLMService, "generate_reply", fake_generate_reply)

    first = test_client.post(
        "/wechat/callback",
        params=_signed_params(),
        content=_text_xml(msg_id="m2", content="查一下库存"),
    )
    second = test_client.post(
        "/wechat/callback",
        params=_signed_params(),
        content=_text_xml(msg_id="m2", content="查一下库存"),
    )

    assert first.status_code == 200
    assert second.status_code == 200
    assert _reply_content(first.text) == "库存助手回复"
    assert _reply_content(second.text) == "库存助手回复"
    assert calls == 1
    assert _count(engine, ProcessedWechatEvent) == 1
    assert _count(engine, WechatChatMessage) == 2


def test_non_text_message_is_deduped(client: tuple[TestClient, object]) -> None:
    test_client, engine = client
    payload = _xml(
        """
        <xml>
          <ToUserName><![CDATA[server]]></ToUserName>
          <FromUserName><![CDATA[user]]></FromUserName>
          <CreateTime>1</CreateTime>
          <MsgType><![CDATA[image]]></MsgType>
          <MsgId>img1</MsgId>
        </xml>
        """
    )

    first = test_client.post("/wechat/callback", params=_signed_params(), content=payload)
    second = test_client.post("/wechat/callback", params=_signed_params(), content=payload)

    assert first.status_code == 200
    assert second.status_code == 200
    assert _reply_content(first.text) == "暂时只支持文字消息。"
    assert _reply_content(second.text) == "暂时只支持文字消息。"
    assert _count(engine, ProcessedWechatEvent) == 1


def test_invalid_create_time_is_rejected(client: tuple[TestClient, object]) -> None:
    test_client, _engine = client
    payload = _xml(
        """
        <xml>
          <ToUserName><![CDATA[server]]></ToUserName>
          <FromUserName><![CDATA[user]]></FromUserName>
          <CreateTime>bad</CreateTime>
          <MsgType><![CDATA[text]]></MsgType>
          <Content><![CDATA[hello]]></Content>
          <MsgId>m3</MsgId>
        </xml>
        """
    )

    response = test_client.post("/wechat/callback", params=_signed_params(), content=payload)

    assert response.status_code == 400


def test_dtd_payload_is_rejected(client: tuple[TestClient, object]) -> None:
    test_client, _engine = client
    payload = b"<!DOCTYPE xml [<!ENTITY xxe SYSTEM 'file:///etc/passwd'>]><xml />"

    response = test_client.post("/wechat/callback", params=_signed_params(), content=payload)

    assert response.status_code == 400


def test_reply_cdata_is_escaped(
    client: tuple[TestClient, object],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    test_client, _engine = client

    async def fake_generate_reply(self, **kwargs):  # noqa: ANN001, ANN003
        return "a]]>b"

    monkeypatch.setattr(WechatLLMService, "generate_reply", fake_generate_reply)

    response = test_client.post(
        "/wechat/callback",
        params=_signed_params(),
        content=_text_xml(msg_id="m4", content="hello"),
    )

    assert response.status_code == 200
    assert _reply_content(response.text) == "a]]>b"


def _signed_params() -> dict[str, str]:
    timestamp = "1"
    nonce = "nonce"
    signature = sha1("".join(sorted([TOKEN, timestamp, nonce])).encode()).hexdigest()
    return {"signature": signature, "timestamp": timestamp, "nonce": nonce}


def _text_xml(*, msg_id: str, content: str) -> bytes:
    return _xml(
        f"""
        <xml>
          <ToUserName><![CDATA[server]]></ToUserName>
          <FromUserName><![CDATA[user]]></FromUserName>
          <CreateTime>1</CreateTime>
          <MsgType><![CDATA[text]]></MsgType>
          <Content><![CDATA[{content}]]></Content>
          <MsgId>{msg_id}</MsgId>
        </xml>
        """
    )


def _xml(value: str) -> bytes:
    return value.strip().encode("utf-8")


def _reply_content(xml_text: str) -> str:
    root = ElementTree.fromstring(xml_text.encode("utf-8"))
    content = root.find("Content")
    assert content is not None
    return content.text or ""


def _count(engine: object, model: type[SQLModel]) -> int:
    with Session(engine) as session:
        return session.exec(select(func.count()).select_from(model)).one()
