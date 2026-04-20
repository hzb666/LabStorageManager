# 企业微信智能机器人接入

这里放企业微信 **智能机器人 API 模式** 的实现，不是企业微信群机器人 Webhook，也不是公众号回调。

## 目录

```text
robot/
├── legacy_wechat_public_account/  # plans/wechat-prod 迁移过来的公众号方案备份
├── wecom_aibot/                   # 企业微信智能机器人实现
├── wechat_kf/                     # 微信客服入口，面向个人微信用户
├── create_wechat_kf_account.py    # 创建微信客服账号并可写入 open_kfid
├── get_wechat_kf_link.py          # 获取微信客服联系链接或账号列表
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
  -> LLM 意图规划器（可选，按白名单选 MCP tool 或进入确认型写流程）
  -> lsm_mcp Streamable HTTP -> python -m lsm_cli -> LabStorageManager API
  -> MiniMax Token Plan MCP web_search（仅内部辅助解析化学名称/别名到 CAS）
```

LLM 负责把自然语言规划成受控查询动作，或规划为“开始借用/开始归还”。
它不会生成命令行，也不能直接调用写工具；借用和归还仍必须先展示候选和操作内容，
收到用户明确回复“确认”后才执行。
如果没有配置 LLM API Key，机器人会退回到规则查询兜底。
现有工作流的入口判断优先交给 LLM，包括库存、低库存、我的借用、我的订单、
我的暂存、试剂订单、耗材订单和常用货架；代码里的关键词/正则只作为兜底和基本约束。
库存、试剂订单和耗材订单的名称查询默认走包含搜索；LLM 规划器会按语义判断
是否明确要求名称完整一致，并在需要时给对应 MCP 工具传 `exact=true`。
规则兜底保持默认包含搜索，不用关键词枚举模拟 LLM 判断。

第一版不面向用户暴露内部编码查询。内部编码属于系统内部信息，企业微信用户只需要按名称、CAS、订单类型或常用货架别名查询。
查询、借用和归还都必须先完成企业微信用户绑定，之后所有 MCP 调用都使用该用户自己的 LabStorageManager token。借用和归还由受控流程处理：LLM 可理解用户意图和参数，但系统仍先检查绑定，再查候选，最后等待用户回复“确认”才执行。用户可以发送“解绑”或“取消绑定”发起手动解除绑定，必须再次回复“确认”才会真正解除。机器人发现已保存的用户 token 过期或认证失败时，会自动解除绑定并提示用户重新绑定。

普通库存或 CAS 库存没有查到时，机器人会先查询 CAS 主数据 `chemical_name_map`。如果主数据分类是 `acid`、`base`、`salt` 或 `solvent`，会自动继续查询常用货架；如果主数据记录里有有效 CAS，会先回到系统按 CAS 查库存。遇到明确缩写、配体、催化剂、膦配体或金属催化剂名称时，会更积极地走“确定 CAS -> 回查系统数据”的路径；短英文 token 不直接触发联网，必须先由 LLM 判断是否像化学名称。

MiniMax Token Plan MCP 的 `web_search` 只用于内部辅助：当用户用名称或别名查询库存，
普通库存和 CAS 主数据都没有命中时，机器人会先让 LLM 用通用化学知识尝试解析 CAS；
仍不确定且 LLM 判断值得继续确定 CAS 时，才可以用网络搜索查该名称/别名对应的 CAS。网络搜索不能干别的，
识别到 CAS 后必须回到 LSM MCP 查询库存或常用货架。机器人不提供通用联网问答，
不能用联网搜索回答库存、订单、货架位置、借用或归还。
图片理解工具 `understand_image` 不接入机器人。

微信客服入口面向个人微信用户的一对一会话。个人微信用户不需要加入企业微信，也不需要加好友；用户点击微信客服链接或扫码发起咨询后，服务端通过微信客服 API 收消息、回复消息。它不能进入个人微信群，也不能主动给未发起会话的用户发消息。

## 角色设定建议

在企业微信智能机器人后台的“角色设定”中可使用下面这段：

```text
你是 LabStorageManager 实验室库存助手，服务对象是实验室成员。

你的职责：
1. 帮助用户查询实验室库存、试剂订单、耗材订单和常用货架信息。
2. 帮助已绑定账号的用户查询自己的借用、试剂订单、耗材订单、暂存/待补全入库项。
3. 帮助已绑定账号的用户发起库存借用和归还。
4. 对借用、归还等写操作必须先展示候选和操作内容，收到用户明确回复“确认”后才可执行。
5. 用简洁、准确、自然的中文回复用户，可以根据上下文组织语言，但不能脱离系统查询结果自由编造。
6. 用户表达不清时，先追问必要信息，不要猜测。
7. 不要向用户展示系统内部编码、内部码、token、API Key、接口错误详情、stderr、stdout、traceback、用户 ID、数据库 ID、密钥、密码或绑定凭据。
8. 不要编造库存、位置、数量、订单状态、借用人、暂存人或货架信息；这些内容必须来自 MCP/API 查询到的安全结果。
9. 遇到缩写、配体、催化剂、膦配体或金属催化剂名称时，应优先确定 CAS，再回到系统查询库存；短英文 token 需要先判断是否像化学名称。受限网络搜索只允许用于识别 CAS，不能用于直接回答库存或通用问题。
10. 不要执行删除、修改库存资料、手动入库、创建订单、订单到货、订单入库等高风险操作，除非后续明确开放了对应工具和确认流程。
11. 收到图片、语音、文件或其他非文字输入时，回复：目前只支持文字输入。

你可以理解这些常见说法：
- “查乙醇库存”“乙醇还有吗”“乙醇在哪里”表示查询库存。
- “64-17-5 在哪里”表示按 CAS 查询库存。
- “BINAP 库存”“dppf 库存”“XPhos 配体在哪里”“Pd(PPh3)4 催化剂还有吗”表示先尝试确定 CAS，再按系统数据查询库存。
- “低库存”“快没了”表示查询低库存。
- “查试剂订单 乙腈”表示查询试剂订单。
- “查耗材订单 手套”表示查询耗材订单。
- “常用货架 酒精”表示查询常用货架。
- “我的借用”“我借了哪些”“借用中”表示查询当前绑定用户的借用中库存。
- “我的试剂订单”“我的试剂申购”表示查询当前绑定用户的试剂订单。
- “我的耗材订单”“我的耗材申购”表示查询当前绑定用户的耗材订单。
- “我的暂存”“待补全入库”“我的待入库”表示查询当前绑定用户的暂存/待补全入库项。
- “绑定 用户名 密码”表示绑定 LabStorageManager 账号；企业微信内部机器人只能在私聊中处理绑定，微信客服入口应引导用户打开一次性网页登录链接绑定。
- “借用乙醇”表示发起借用流程。
- “归还乙醇 用量20”或“归还乙醇 剩余300”表示发起归还流程。

安全规则：
- 绑定密码、token、用户凭据不得在回复中复述。
- 群聊中如果用户发送绑定指令，应提示用户私聊机器人绑定。
- 用户发送“解绑”或“取消绑定”时，应先要求用户回复“确认”；收到“确认”后才解除当前账号绑定。
- 如果系统提示绑定已过期或认证失败，应让用户重新绑定，不要继续复用旧凭据。
- 借用和归还必须经过候选确认：先展示候选，再让用户回复“确认”。
- 如果有多个候选，先让用户选择序号，再进入确认。
- 用户回复“取消”时，放弃当前操作。
- 确认态过期时，让用户重新发起。
- 如果系统查询结果里没有某个字段，就不要补充该字段。
- 可以让语言更自然，但不得新增事实、暴露内部字段或扩大工具能力范围。
```

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
$env:WECOM_AIBOT_TOKEN_ENCRYPTION_KEY="replace-with-random-secret"
$env:WECOM_AIBOT_LLM_API_KEY="replace-with-openai-key"
$env:WECOM_AIBOT_LLM_MODEL="gpt-5"
poetry run python robot/run_wecom_worker.py
```

机器人绑定态会保存 LabStorageManager access token。`ENV` / `APP_ENV` /
`WECOM_AIBOT_ENV` 不为 `development`、`dev`、`local`、`test` 或 `testing` 时，
必须配置 `WECOM_AIBOT_TOKEN_ENCRYPTION_KEY`；读取到历史明文绑定时会在下次访问时自动重写为加密值。

LLM 相关变量：

| 变量 | 说明 |
| --- | --- |
| `ENV` / `APP_ENV` / `WECOM_AIBOT_ENV` | 运行环境，默认 `development` |
| `WECOM_AIBOT_TOKEN_ENCRYPTION_KEY` | 机器人绑定 token 的本地加密密钥，生产环境必填 |
| `WECOM_AIBOT_ALLOW_PLAINTEXT_TOKEN_STORAGE` | 仅开发环境有效；允许无加密密钥时明文保存，默认 `true` |
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

### 创建客服账号

创建微信客服账号需要企业 ID、客服 Secret，以及一个头像图片。默认头像路径为 `robot/tx.png`，默认账号名称为 `实验室库存助手`：

```powershell
$env:WECHAT_KF_CORP_ID="replace-with-corp-id"
$env:WECHAT_KF_SECRET="replace-with-wechat-kf-secret"
poetry run python robot/create_wechat_kf_account.py --write-env
```

常用参数：

| 参数 | 说明 |
| --- | --- |
| `--name` | 客服账号名称 |
| `--avatar` | 头像图片路径 |
| `--write-env` | 把返回的 `open_kfid` 写入 `robot/.env` |
| `--json` | 输出完整 API 响应 |

查询已有客服账号：

```powershell
poetry run python robot/get_wechat_kf_link.py --list-accounts --json
```

生成联系链接：

```powershell
poetry run python robot/get_wechat_kf_link.py --scene lsm --scene-param inventory
```

`--scene` 默认值为 `lsm`。`--scene-param` 会追加到返回链接的查询参数中，用于区分入口来源。

### 启动回调服务

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
同一用户连续发送的多条文字会先经过默认 1 秒的短静默窗口合并，再交给机器人生成一次回复；静默窗口可通过 `WECHAT_KF_REPLY_DEBOUNCE_SECONDS` 调整。

回调处理会记录同步页数、跳过消息、重复消息和回复结果，日志中的 `open_kfid`、`external_userid` 等标识会做掩码处理。

## 企业微信后台步骤

1. 进入 `管理后台 -> 安全与管理 -> 管理工具 -> 智能机器人`。
2. 创建机器人，选择 `API 模式创建`。
3. 设置名称、头像、介绍和可见范围。
4. WebSocket 模式复制 `BotID` 与 `Secret`。
5. Webhook 模式配置 `URL`、`Token`、`EncodingAESKey`。

## 当前能力

- 解析文本消息。
- 使用 `msgid` 做持久化去重。
- 通过 LLM 意图规划器选择只读 MCP 工具，或进入借用/归还确认流程。
- 私聊绑定 LabStorageManager 用户。
- 绑定后查询普通库存名称、CAS、别名、英文名和位置。
- 库存查不到时，可按 CAS 主数据或 LLM 判断自动追加常用货架查询。
- 绑定后查询我的借用、我的试剂订单、我的耗材订单、我的暂存/待补全入库项。
- 绑定后查询低库存。
- 绑定后查询试剂订单、耗材订单和常用货架。
- 绑定后借用库存，执行前必须回复“确认”。
- 绑定后归还库存，必须提供用量或剩余量，执行前必须回复“确认”。
- 名称/别名查不到时，先用 LLM 通用知识解析 CAS；仍不确定时才用 `web_search`
  内部辅助识别 CAS，再回到系统数据查询。
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

我的查询：

```text
我的借用
我的试剂订单
我的耗材订单
我的暂存
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
