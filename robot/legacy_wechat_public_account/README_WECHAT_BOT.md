# Wechat Bot Production Setup

The Wechat callback is disabled by default. Enable it only after the public
account token and public HTTPS endpoint are ready.

## Required environment

```env
WECHAT_BOT_ENABLED=true
WECHAT_TOKEN="replace-with-wechat-public-account-token"
OPENAI_API_KEY="replace-with-openai-api-key"
OPENAI_MODEL="gpt-4.1-mini"
WECHAT_PASSIVE_REPLY_TIMEOUT_SECONDS=4
WECHAT_LLM_TIMEOUT_SECONDS=3
```

## Public callback

Configure the Wechat public account server URL as:

```text
https://your-domain.example/wechat/callback
```

Both `GET` verification and `POST` messages validate
`signature/timestamp/nonce` with the configured token. The route is mounted
outside `/api` so browser CSRF middleware does not apply to Wechat server
traffic.

## Runtime behavior

- XML request bodies are capped by `WECHAT_MAX_XML_BYTES`.
- DTD and entity declarations are rejected before parsing.
- Duplicate Wechat retries replay the original reply when available.
- LLM calls use a short timeout and fall back to a local Chinese reply.
- Conversation memory summarization runs after the passive response is sent.
- Tables are created through the existing SQLModel startup path; no second
  database engine or Alembic layer is introduced.

## Reverse proxy requirements

Set the proxy body limit at or below `WECHAT_MAX_XML_BYTES` and forward HTTPS
traffic to the FastAPI process. In production, keep normal app HTTPS redirect
and security headers enabled.
