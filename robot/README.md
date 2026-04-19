# 企业微信智能机器人接入

这里放企业微信 **智能机器人 API 模式** 的实现，不是企业微信群机器人 Webhook，也不是公众号回调。

## 目录

```text
robot/
├── legacy_wechat_public_account/  # plans/wechat-prod 迁移过来的公众号方案备份
├── wecom_aibot/                   # 企业微信智能机器人实现
├── wechat_kf/                     # 微信客服入口，面向个人微信用户
├── run_wechat_kf_webhook.py       # 微信客服回调入口
├── run_wecom_webhook.py           # Webhook 短连接入口
└── run_wecom_worker.py            # WebSocket 长连接入口
```

## 推荐方案

优先使用 WebSocket 长连接：

- 不需要公网固定 IP。
- 不需要处理回调加解密。
- 支持私聊和内部群里 @ 智能机器人。
- 需要安装智能机器人 SDK，并保持 worker 常驻。

```powershell
pip install wecom-aibot-sdk
python robot/run_wecom_worker.py
```

Webhook 短连接适合已有公网 HTTPS 域名的部署：

```powershell
python robot/run_wecom_webhook.py
```

然后在企业微信智能机器人 API 模式里配置：

```text
https://your-domain.example.com/wecom/aibot/callback
```

## 当前架构

```text
企业微信智能机器人
  -> robot/wecom_aibot
  -> LLM 意图规划器（可选，按白名单选 MCP tool）
  -> lsm_mcp Streamable HTTP -> python -m lsm_cli -> LabStorageManager API
  -> MiniMax Token Plan MCP web_search（仅内部辅助解析化学名称/别名到 CAS）
```

LLM 只负责把自然语言规划成受控查询动作，不会生成命令行，也不能调用写操作。
如果没有配置 LLM API Key，机器人会退回到规则查询兜底。

第一版不面向用户暴露内部编码查询。内部编码属于系统内部信息，企业微信用户只需要按名称、CAS、订单类型或常用货架别名查询。
查询、借用和归还都必须先完成企业微信用户绑定，之后所有 MCP 调用都使用该用户自己的 LabStorageManager token。借用和归还由确定性流程处理：先检查绑定，再查候选，最后等待用户回复“确认”才执行。

普通库存或 CAS 库存没有查到时，机器人会先查询 CAS 主数据 `chemical_name_map`。如果主数据分类是 `acid`、`base`、`salt` 或 `solvent`，会自动继续查询常用货架；如果主数据没有命中，才让 LLM 判断是否像常用酸碱盐或溶剂，避免把特殊试剂硬写成枚举规则。

MiniMax Token Plan MCP 的 `web_search` 只用于内部辅助：当用户用名称或别名查询库存，普通库存和 CAS 主数据都没有命中时，机器人可以搜索该名称/别名对应的 CAS。识别到 CAS 后，必须回到 LSM MCP 查询库存或常用货架。机器人不提供通用联网问答，不能用联网搜索回答库存、订单、货架位置、借用或归还。
图片理解工具 `understand_image` 不接入机器人。

微信客服入口面向个人微信用户的一对一会话。个人微信用户不需要加入企业微信，也不需要加好友；用户点击微信客服链接或扫码发起咨询后，服务端通过微信客服 API 收消息、回复消息。它不能进入个人微信群，也不能主动给未发起会话的用户发消息。

## MCP 与 LLM 配置

先启动 MCP 服务：

```powershell
$env:LSM_MCP_BASE_URL="http://127.0.0.1:8000/api"
$env:LSM_MCP_CLI_TIMEOUT="5"
poetry run uvicorn lsm_mcp.http_app:app --host 127.0.0.1 --port 8030
```

再启动企业微信 worker：

```powershell
$env:WECOM_AIBOT_MODE="websocket"
$env:WECOM_AIBOT_BOT_ID="replace-with-bot-id"
$env:WECOM_AIBOT_SECRET="replace-with-secret"
$env:LSM_MCP_URL="http://127.0.0.1:8030/mcp"
$env:WECOM_AIBOT_LLM_API_KEY="replace-with-openai-key"
$env:WECOM_AIBOT_LLM_MODEL="gpt-5"
poetry run python robot/run_wecom_worker.py
```

LLM 相关变量：

| 变量 | 说明 |
| --- | --- |
| `WECOM_AIBOT_LLM_API_KEY` / `OPENAI_API_KEY` | LLM API Key；不配置时走规则兜底 |
| `WECOM_AIBOT_LLM_BASE_URL` / `OPENAI_BASE_URL` | OpenAI-compatible Chat Completions base URL；设置后调用 `<base>/chat/completions` |
| `WECOM_AIBOT_LLM_MODEL` / `OPENAI_MODEL` | 默认 `gpt-5` |
| `WECOM_AIBOT_LLM_RESPONSES_URL` / `OPENAI_RESPONSES_URL` | 默认 `https://api.openai.com/v1/responses` |
| `WECOM_AIBOT_LLM_TIMEOUT_SECONDS` | LLM 规划超时，默认 8 秒 |
| `WECOM_AIBOT_LLM_MAX_OUTPUT_TOKENS` | LLM 规划最大输出 token，默认 400 |
| `WECOM_AIBOT_WEB_SEARCH_ENABLED` | 是否启用名称/别名到 CAS 的辅助搜索，默认 `true` |
| `MINIMAX_API_KEY` / `WECOM_AIBOT_MINIMAX_API_KEY` | MiniMax Token Plan MCP API Key |
| `MINIMAX_API_HOST` / `WECOM_AIBOT_MINIMAX_API_HOST` | 默认 `https://api.minimaxi.com` |
| `WECOM_AIBOT_MINIMAX_MCP_COMMAND` | 默认 `uvx` |
| `WECOM_AIBOT_MINIMAX_MCP_TIMEOUT_SECONDS` | `web_search` MCP 调用超时，默认 25 秒 |

如果配置了 `OPENAI_BASE_URL`，机器人会按 OpenAI-compatible Chat Completions 调用；未配置时按 Responses API 调用。MCP 工具目录可通过 `lab_storage_manager_help` 查询，LLM 规划器拿不准工具边界时可以先调用它。

## 微信客服入口

微信客服入口复用同一套 `LSMRobotOrchestrator`、MCP、LLM 和绑定状态，但用户身份使用：

```text
wxkf:{open_kfid}:{external_userid}
```

启动微信客服回调服务：

```powershell
$env:WECHAT_KF_CORP_ID="replace-with-corp-id"
$env:WECHAT_KF_SECRET="replace-with-wechat-kf-secret"
$env:WECHAT_KF_TOKEN="replace-with-callback-token"
$env:WECHAT_KF_ENCODING_AES_KEY="replace-with-callback-aes-key"
$env:WECHAT_KF_OPEN_KFID="replace-with-open-kfid"
$env:WECHAT_KF_BIND_BASE_URL="https://your-domain.example.com"
$env:LSM_MCP_URL="http://127.0.0.1:8030/mcp"
poetry run python robot/run_wechat_kf_webhook.py
```

在企业微信“微信客服”后台配置回调：

```text
https://your-domain.example.com/wechat/kf/callback
```

消息流：

```text
个人微信用户
  -> 微信客服会话
  -> 回调 kf_msg_or_event
  -> /cgi-bin/kf/sync_msg 拉取消息
  -> LSMRobotOrchestrator 生成回复
  -> /cgi-bin/kf/send_msg 回复 external_userid
```

微信客服绑定不会要求用户在聊天里发送密码。未绑定用户发起查询时，机器人会返回一次性网页登录链接：

```text
https://your-domain.example.com/wechat/kf/bind/{state}
```

用户在网页中提交 LabStorageManager 用户名和密码；绑定成功后回到微信客服继续查询、借用或归还。链接默认 10 分钟有效，变量 `WECHAT_KF_BIND_TOKEN_TTL_MINUTES` 可调整。

注意微信客服平台限制：用户必须先发起会话，企业才可回复；回复受微信客服会话窗口和条数限制影响。因此借用/归还流程应尽量保持“一次候选确认 + 一次结果回复”。

## 企业微信后台步骤

1. 进入 `管理后台 -> 安全与管理 -> 管理工具 -> 智能机器人`。
2. 创建机器人，选择 `API 模式创建`。
3. 设置名称、头像、介绍和可见范围。
4. WebSocket 模式复制 `BotID` 与 `Secret`。
5. Webhook 模式配置 `URL`、`Token`、`EncodingAESKey`。

## 当前能力

- 解析文本消息。
- 使用 `msgid` 做持久化去重。
- 通过 LLM 意图规划器选择只读 MCP 工具。
- 私聊绑定 LabStorageManager 用户。
- 绑定后查询普通库存名称、CAS、别名、英文名和位置。
- 库存查不到时，可按 CAS 主数据或 LLM 判断自动追加常用货架查询。
- 绑定后查询低库存。
- 绑定后查询试剂订单、耗材订单和常用货架。
- 绑定后借用库存，执行前必须回复“确认”。
- 绑定后归还库存，必须提供用量或剩余量，执行前必须回复“确认”。
- 名称/别名查不到时，可用 `web_search` 内部辅助识别 CAS，再回到系统数据查询。
- 对非文本消息返回明确提示。
- 不处理图片理解。
- 暂不开放入库、下单、订单到货等高风险写操作。

## 用户指令

绑定账号必须私聊机器人，不要在群聊里发送密码：

```text
绑定 alice password
绑定状态
解绑
```

借用：

```text
借用乙醇
确认
```

如果有多个候选，先回复序号，再回复确认。

归还需要带用量或最终剩余量：

```text
归还乙醇 用量20
归还乙醇 剩余300
确认
```

确认态 5 分钟后过期。企业微信重复投递同一个 `msgid` 时，会返回同一份缓存回复，不会重复执行写操作。

## 官方文档

- 智能机器人使用说明：<https://open.work.weixin.qq.com/help2/pc/21663>
- API 概述：<https://developer.work.weixin.qq.com/document/path/101039>
- 接收消息：<https://developer.work.weixin.qq.com/document/path/100719>
- 被动回复：<https://developer.work.weixin.qq.com/document/path/101031>
- 回调加解密：<https://developer.work.weixin.qq.com/document/path/101033>
- 主动回复：<https://developer.work.weixin.qq.com/document/path/101138>
- 长连接：<https://developer.work.weixin.qq.com/document/path/101463>
