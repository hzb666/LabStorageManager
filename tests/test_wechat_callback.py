from __future__ import annotations

import hashlib

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from app.api.wechat import router
from app.db.base import Base
from app.db.models import ChatMessage, UserMemory, WechatUser
from app.db.session import get_db_session
from app.services.llm_service import LLMTimeoutError


@pytest.fixture()
def app_client(monkeypatch):
    monkeypatch.setattr("app.api.wechat.settings.wechat_token", "test-token")
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, class_=Session)
    Base.metadata.create_all(bind=engine)

    app = FastAPI()
    app.include_router(router)

    def override_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db_session] = override_db
    client = TestClient(app)
    return client, TestingSessionLocal


def _signature(token: str, timestamp: str, nonce: str) -> str:
    text = "".join(sorted([token, timestamp, nonce]))
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


def _text_xml(msg_id: str = "1", content: str = "你好") -> str:
    return f"""<xml>
<ToUserName><![CDATA[gh_test]]></ToUserName>
<FromUserName><![CDATA[o_user]]></FromUserName>
<CreateTime>1700000000</CreateTime>
<MsgType><![CDATA[text]]></MsgType>
<Content><![CDATA[{content}]]></Content>
<MsgId>{msg_id}</MsgId>
</xml>"""


def test_verify_signature_success(app_client):
    client, _ = app_client
    signature = _signature("test-token", "1", "2")
    r = client.get(f"/wechat/callback?signature={signature}&timestamp=1&nonce=2&echostr=ok")
    assert r.status_code == 200
    assert r.text == "ok"


def test_verify_signature_failure(app_client):
    client, _ = app_client
    r = client.get("/wechat/callback?signature=bad&timestamp=1&nonce=2&echostr=ok")
    assert r.status_code == 403


def test_parse_text_and_reply_xml(app_client, monkeypatch):
    client, _ = app_client

    async def fake_reply(self, system_prompt, summary, history, user_input):
        return "收到：" + user_input

    async def fake_summary(self, history, previous_summary):
        return "summary"

    monkeypatch.setattr("app.services.llm_service.LLMService.generate_reply", fake_reply)
    monkeypatch.setattr("app.services.llm_service.LLMService.summarize_memory", fake_summary)

    r = client.post("/wechat/callback", data=_text_xml())
    assert r.status_code == 200
    assert "<MsgType><![CDATA[text]]></MsgType>" in r.text
    assert "收到：你好" in r.text


def test_idempotent_dedup(app_client, monkeypatch):
    client, _ = app_client

    async def fake_reply(self, system_prompt, summary, history, user_input):
        return "ok"

    monkeypatch.setattr("app.services.llm_service.LLMService.generate_reply", fake_reply)

    first = client.post("/wechat/callback", data=_text_xml(msg_id="42"))
    second = client.post("/wechat/callback", data=_text_xml(msg_id="42"))
    assert first.status_code == 200
    assert second.status_code == 200
    assert "已经处理过" in second.text


def test_user_creation_and_second_message_reads_history(app_client, monkeypatch):
    client, SessionLocal = app_client
    calls: list[dict] = []

    async def fake_reply(self, system_prompt, summary, history, user_input):
        calls.append({"history": history, "user_input": user_input})
        return "答复"

    monkeypatch.setattr("app.services.llm_service.LLMService.generate_reply", fake_reply)

    client.post("/wechat/callback", data=_text_xml(msg_id="101", content="第一句"))
    client.post("/wechat/callback", data=_text_xml(msg_id="102", content="第二句"))

    with SessionLocal() as db:
        user = db.scalar(select(WechatUser).where(WechatUser.openid == "o_user"))
        assert user is not None
        assert len(calls) == 2
        assert any(item["content"] == "第一句" for item in calls[1]["history"])


def test_memory_summary_trigger(app_client, monkeypatch):
    client, SessionLocal = app_client
    monkeypatch.setattr("app.services.memory_service.settings.memory_summary_trigger_count", 4)

    async def fake_reply(self, system_prompt, summary, history, user_input):
        return "答复"

    async def fake_summary(self, history, previous_summary):
        return "稳定事实摘要"

    monkeypatch.setattr("app.services.llm_service.LLMService.generate_reply", fake_reply)
    monkeypatch.setattr("app.services.llm_service.LLMService.summarize_memory", fake_summary)

    for i in range(2):
        client.post("/wechat/callback", data=_text_xml(msg_id=str(200 + i), content=f"m{i}"))

    with SessionLocal() as db:
        user = db.scalar(select(WechatUser).where(WechatUser.openid == "o_user"))
        memory = db.get(UserMemory, user.id)
        assert memory.summary_text == "稳定事实摘要"


def test_llm_timeout_fallback(app_client, monkeypatch):
    client, SessionLocal = app_client

    async def timeout_reply(self, system_prompt, summary, history, user_input):
        raise LLMTimeoutError()

    monkeypatch.setattr("app.services.llm_service.LLMService.generate_reply", timeout_reply)

    r = client.post("/wechat/callback", data=_text_xml(msg_id="301", content="超时测试"))
    assert "已收到，我稍后继续处理" in r.text

    with SessionLocal() as db:
        messages = db.scalars(select(ChatMessage).where(ChatMessage.role == "assistant")).all()
        assert messages[-1].content == "已收到，我稍后继续处理。"


def test_invalid_xml_returns_400(app_client):
    client, _ = app_client
    r = client.post("/wechat/callback", data="<xml>")
    assert r.status_code == 400
