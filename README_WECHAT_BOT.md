# 微信公众号机器人 + 账户级记忆后端

本模块基于 FastAPI + SQLAlchemy 2.x + Alembic，实现微信公众号回调、用户级会话记忆、幂等去重与 LLM 回复。

## 1. 环境变量

```bash
WECHAT_TOKEN=your_token
WECHAT_APP_ID=wx_xxx
WECHAT_APP_SECRET=xxx
WECHAT_ENCODING_AES_KEY=
DATABASE_URL=postgresql+psycopg://user:pass@localhost:5432/lsm
REDIS_URL=
OPENAI_API_KEY=sk-xxx
OPENAI_MODEL=gpt-4.1-mini
LLM_TIMEOUT_SECONDS=5
MEMORY_WINDOW_SIZE=10
MEMORY_SUMMARY_TRIGGER_COUNT=20
```

本地可使用 SQLite fallback：

```bash
DATABASE_URL=sqlite:///./wechat_memory.db
```

## 2. 迁移

```bash
poetry install
poetry run alembic upgrade head
```

## 3. 测试

```bash
poetry run pytest -q tests/test_wechat_callback.py
```

## 4. 运行

```bash
poetry run uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

回调地址：

- GET/POST `http://<your-domain>/wechat/callback`

## 5. 本地调试

1. 启动服务。
2. 用 GET 验签：

```bash
curl "http://127.0.0.1:8000/wechat/callback?signature=xxx&timestamp=1&nonce=2&echostr=ok"
```

3. 用 POST 模拟微信 XML：

```bash
curl -X POST "http://127.0.0.1:8000/wechat/callback" \
  -H "Content-Type: application/xml" \
  -d '<xml><ToUserName><![CDATA[gh_test]]></ToUserName><FromUserName><![CDATA[o_user]]></FromUserName><CreateTime>1700000000</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[你好]]></Content><MsgId>1</MsgId></xml>'
```

## 6. 微信公众平台配置

- 开发 -> 基本配置 -> 服务器配置
- URL 填：`https://<your-domain>/wechat/callback`
- Token 填：`WECHAT_TOKEN`
- 明文模式可直接使用当前 MVP
- 消息加解密 Key（EncodingAESKey）留作后续扩展

## 7. 已实现能力

- GET URL 校验（sha1(token,timestamp,nonce)）
- POST 明文 XML 解析 + 被动文本回复
- 幂等去重（MsgId / event key）
- 用户、会话、消息、长期记忆持久化
- 最近窗口 + summary memory
- LLM 超时兜底文本
- pytest 覆盖核心链路

## 8. 后续建议

- 完成 AES 安全模式加解密（兼容明文/兼容模式/安全模式）
- 超时后改为“被动回复 + 客服消息异步补发”
- 接入自定义菜单、模板消息、素材管理
- 通过用户信息接口补全 unionid（需开放平台绑定）
