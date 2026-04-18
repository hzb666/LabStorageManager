# 企业微信智能机器人接入

这里放企业微信 **智能机器人 API 模式** 的实现，不是企业微信群机器人 Webhook，也不是公众号回调。

## 目录

```text
robot/
├── legacy_wechat_public_account/  # plans/wechat-prod 迁移过来的公众号方案备份
├── wecom_aibot/                   # 企业微信智能机器人实现
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

## 企业微信后台步骤

1. 进入 `管理后台 -> 安全与管理 -> 管理工具 -> 智能机器人`。
2. 创建机器人，选择 `API 模式创建`。
3. 设置名称、头像、介绍和可见范围。
4. WebSocket 模式复制 `BotID` 与 `Secret`。
5. Webhook 模式配置 `URL`、`Token`、`EncodingAESKey`。

## 当前能力

- 解析文本消息。
- 使用 `msgid` 做持久化去重。
- 查询普通库存名称、CAS、别名、英文名和位置。
- 查询低库存。
- 查询借用中库存。
- 对非文本消息返回明确提示。

## 官方文档

- 智能机器人使用说明：<https://open.work.weixin.qq.com/help2/pc/21663>
- API 概述：<https://developer.work.weixin.qq.com/document/path/101039>
- 接收消息：<https://developer.work.weixin.qq.com/document/path/100719>
- 被动回复：<https://developer.work.weixin.qq.com/document/path/101031>
- 回调加解密：<https://developer.work.weixin.qq.com/document/path/101033>
- 主动回复：<https://developer.work.weixin.qq.com/document/path/101138>
- 长连接：<https://developer.work.weixin.qq.com/document/path/101463>

