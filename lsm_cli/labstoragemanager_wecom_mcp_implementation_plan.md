# LabStorageManager 企业微信机器人 + MCP 接入实施方案

> 版本：v1.0
> 日期：2026-04-18
> 目标：在尽量少改现有代码的前提下，把现有 `lsm_cli` 包装成 MCP 工具层，并接入现有企业微信智能机器人入口。

---

## 1. 结论

当前最合适的方案是：

```text
企业微信智能机器人
  -> robot/wecom_aibot 接入层
  -> LSMRobotOrchestrator
  -> MCP client
  -> lsm_mcp server
  -> lsm_cli
  -> LabStorageManager FastAPI
  -> DB
```

这条路线的核心理由：

1. 现有 `lsm_cli` 已经是机器可读接口：所有命令向 `stdout` 输出 JSON，并且有固定退出码契约。
2. 现有 `lsm_cli` 已经覆盖库存、试剂订单、耗材订单、常用货架等主要业务入口。
3. 现有 `robot/wecom_aibot` 已经有企业微信智能机器人 API 模式骨架，包括 WebSocket / Webhook 入口、文本解析、`msgid` 去重和基础回复。
4. MCP 层只需要包装 CLI，不需要重写后端 service，也不需要让企业微信机器人直接拼 HTTP API。

一句话：**保留企业微信入口，保留 CLI 业务执行能力，在中间新增一层 MCP 工具协议。**

---

## 2. 当前代码库现状

### 2.1 主系统

仓库主 README 描述当前系统是面向实验室试剂与耗材管理的 FastAPI + React 前后端分离项目，覆盖申购、审批、到货、入库、借用、归还等流程。CLI 入口通过 `python -m lsm_cli` 使用后端 API，不直接访问数据库。

### 2.2 CLI 现状

`lsm_cli/README.md` 明确写了输出契约：

```json
{
  "ok": true,
  "data": {}
}
```

失败：

```json
{
  "ok": false,
  "error": {
    "code": "HTTP_ERROR",
    "message": "Invalid credentials",
    "detail": {}
  }
}
```

退出码当前为：

| 退出码 | 含义 |
|---:|---|
| 0 | 成功 |
| 1 | 其他 HTTP 错误 |
| 2 | 401，认证失败或未认证 |
| 3 | 403，权限不足 |
| 4 | 404，资源不存在 |
| 5 | 429，触发限流 |
| 6 | 本地文件不存在 |
| 7 | 本地输入非法 |
| 8 | 命令行参数错误 |
| 9 | 网络错误 |

`lsm_cli/output.py` 里也已经落地了这个契约：`succeed()` 打印 `{"ok": true, "data": ...}`，`fail()` 打印 `{"ok": false, "error": ...}` 并用 `SystemExit(exit_code)` 退出。

`lsm_cli/client.py` 当前会读取 `--base-url`、`--token`、`--timeout`，并在存在 token 时写入 `Authorization: Bearer ...`；API 请求成功时直接返回后端 JSON payload。

### 2.3 CLI 覆盖的业务命令

当前适合包装成 MCP 的 CLI 命令包括：

#### inventory

| CLI 命令 | 对应 API | MCP 暴露建议 |
|---|---|---|
| `inventory list` | `GET /inventory/` | 第一批 |
| `inventory get <inventory_id>` | `GET /inventory/{inventory_id}` | 第一批 |
| `inventory cas <cas_number>` | `GET /inventory/cas/{cas_number}` | 第一批 |
| `inventory name <keyword>` | `GET /inventory/?search=...&search_field=name` | 第一批 |
| `inventory code <internal_code>` | `GET /inventory/code/{internal_code}` | 第一批 |
| `inventory my-borrows` | `GET /inventory/dashboard/my-borrows` | 绑定用户后开放 |
| `inventory pending-stockin` | `GET /inventory/dashboard/pending-stockin` | 绑定用户后开放 |
| `inventory borrow <inventory_id>` | `POST /inventory/{inventory_id}/borrow` | 确认态 + 用户绑定后开放 |
| `inventory return <inventory_id>` | `POST /inventory/{inventory_id}/return` | 确认态 + 用户绑定后开放 |
| `inventory manual-add` | `POST /inventory/manual-add` | 不建议第一版开放 |
| `inventory update <inventory_id>` | `PUT /inventory/{inventory_id}` | 不建议第一版开放 |

#### reagent-orders

| CLI 命令 | 对应 API | MCP 暴露建议 |
|---|---|---|
| `reagent-orders list` | `GET /reagent-orders/` | 第一批 |
| `reagent-orders get <order_id>` | `GET /reagent-orders/{order_id}` | 第一批 |
| `reagent-orders cas <cas_number>` | `GET /reagent-orders/?search=...&search_field=cas_number` | 第一批 |
| `reagent-orders name <keyword>` | `GET /reagent-orders/?search=...&search_field=name` | 第一批 |
| `reagent-orders my` | `GET /reagent-orders/dashboard/my-reagent-orders` | 绑定用户后开放 |
| `reagent-orders create` | `POST /reagent-orders/` | 确认态 + 用户绑定后开放 |
| `reagent-orders update <order_id>` | `PUT /reagent-orders/{order_id}` | 不建议第一版开放 |
| `reagent-orders cas-overview <cas_number>` | `GET /reagent-orders/cas-overview/{cas_number}` | 第一批 |
| `reagent-orders confirm-arrival <order_id>` | `POST /reagent-orders/{order_id}/confirm-arrival` | 第二批 |
| `reagent-orders stock-in <order_id>` | `POST /reagent-orders/{order_id}/stock-in` | 第二批 |

#### consumable-orders

| CLI 命令 | 对应 API | MCP 暴露建议 |
|---|---|---|
| `consumable-orders list` | `GET /consumable-orders/` | 第一批 |
| `consumable-orders get <order_id>` | `GET /consumable-orders/{order_id}` | 第一批 |
| `consumable-orders name <keyword>` | `GET /consumable-orders/?search=...&search_field=name` | 第一批 |
| `consumable-orders my` | `GET /consumable-orders/dashboard/my-consumable-orders` | 绑定用户后开放 |
| `consumable-orders create` | `POST /consumable-orders/` | 确认态 + 用户绑定后开放 |
| `consumable-orders update <order_id>` | `PUT /consumable-orders/{order_id}` | 不建议第一版开放 |
| `consumable-orders complete <order_id>` | `POST /consumable-orders/{order_id}/complete` | 第二批 |

#### common-shelf

| CLI 命令 | 对应 API | MCP 暴露建议 |
|---|---|---|
| `common-shelf list` | `GET /common-shelf/groups` | 第一批 |
| `common-shelf cas <cas_number>` | `GET /common-shelf/groups?search=...&search_field=cas_number` | 第一批 |
| `common-shelf alias <keyword>` | `GET /common-shelf/groups?search=...&search_field=alias` | 第一批 |
| `common-shelf locations <group_key>` | `GET /common-shelf/groups/{group_key}/locations` | 第一批 |
| `common-shelf manual-add` | `POST /common-shelf/manual-add` | 不建议第一版开放 |
| `common-shelf add-bottles <group_key>` | `POST /common-shelf/groups/{group_key}/add-bottles` | 第二批 |
| `common-shelf remove-one <group_key>` | `POST /common-shelf/groups/{group_key}/remove-one` | 第二批 |

### 2.4 企业微信机器人现状

`robot/README.md` 明确说当前实现是**企业微信智能机器人 API 模式**，不是企业微信群机器人 Webhook，也不是公众号回调。

现有目录：

```text
robot/
├── wecom_aibot/
├── run_wecom_webhook.py
└── run_wecom_worker.py
```

现有推荐方案是优先 WebSocket 长连接：

```bash
pip install wecom-aibot-sdk
python robot/run_wecom_worker.py
```

Webhook 模式也已经有入口：

```bash
python robot/run_wecom_webhook.py
```

当前 handler 是：

```text
WecomAibotHandler
  -> parse_text_message
  -> ProcessedMessageStore 按 msgid 去重
  -> InventoryAnswerService.answer(...)
  -> text_reply(...)
```

也就是说，现在企业微信入口层已经有了，业务处理还停留在单一库存问答服务。

---

## 3. 目标架构

### 3.1 推荐最终形态

```text
┌────────────────────────────────────────────┐
│ 企业微信智能机器人 API                      │
│ WebSocket / Webhook                         │
└───────────────────┬────────────────────────┘
                    │
┌───────────────────▼────────────────────────┐
│ robot/wecom_aibot                           │
│ - 验签 / 解密 / WebSocket SDK               │
│ - msgid 去重                                │
│ - 文本解析 / 非文本兜底                     │
│ - 企业微信回复格式                           │
└───────────────────┬────────────────────────┘
                    │
┌───────────────────▼────────────────────────┐
│ LSMRobotOrchestrator                         │
│ - 意图识别                                   │
│ - 候选消歧                                   │
│ - 写操作确认                                 │
│ - 用户绑定校验                               │
└───────────────────┬────────────────────────┘
                    │ MCP client
┌───────────────────▼────────────────────────┐
│ lsm_mcp server                              │
│ - FastMCP tools                              │
│ - CLI 参数白名单                             │
│ - JSON stdout 解析                           │
│ - 退出码归一化                               │
└───────────────────┬────────────────────────┘
                    │ subprocess, no shell
┌───────────────────▼────────────────────────┐
│ lsm_cli                                     │
│ - python -m lsm_cli ...                     │
│ - stdout JSON                               │
│ - exit code                                 │
└───────────────────┬────────────────────────┘
                    │ HTTP API
┌───────────────────▼────────────────────────┐
│ LabStorageManager FastAPI                   │
└────────────────────────────────────────────┘
```

### 3.2 为什么不新建 `mcp/` 目录

不要把新增目录命名为顶层 `mcp/`。

原因：官方 Python MCP SDK 的 import 包名就是 `mcp`，例如：

```python
from mcp.server.fastmcp import FastMCP
```

如果仓库根目录新增 `mcp/`，运行 `python -m ...` 时很容易 shadow 官方 `mcp` 包，导致导入冲突。

建议新增：

```text
lsm_mcp/
```

而不是：

```text
mcp/
```

---

## 4. 新增和修改文件

### 4.1 新增文件

```text
lsm_mcp/
├── __init__.py
├── cli_runner.py        # 安全执行 lsm_cli，解析 stdout JSON 和 exit code
├── server.py            # FastMCP tool 定义
└── http_app.py          # 可选：挂载为本地 Streamable HTTP MCP 服务

robot/wecom_aibot/
├── lsm_orchestrator.py  # 新增：替代 InventoryAnswerService 的机器人编排器
├── mcp_client.py        # 新增：调用本地 MCP server
├── conversation_store.py# 新增：候选项、确认态、绑定态等短会话状态
└── formatters.py        # 新增：把 MCP JSON 格式化成企业微信文本回复
```

### 4.2 修改文件

```text
pyproject.toml
robot/wecom_aibot/config.py
robot/wecom_aibot/handler.py
robot/wecom_aibot/worker.py
robot/wecom_aibot/webhook.py
robot/README.md
```

可选修改：

```text
docker-compose.yml
.env.example
```

---

## 5. 依赖安装

根项目现在使用 Poetry。建议把 MCP SDK 加到根项目，而不是加到 `lsm_cli` 独立包里。

```bash
poetry add "mcp[cli]"
```

如果不想立刻改 Poetry，也可以先临时验证：

```bash
pip install "mcp[cli]"
```

`lsm_cli` 独立包无需依赖 MCP。MCP server 只是调用 `python -m lsm_cli`。

---

## 6. 环境变量设计

新增 MCP 相关环境变量：

```bash
# MCP server 访问 LabStorageManager API 的地址
LSM_MCP_BASE_URL=http://127.0.0.1:8000/api

# 服务账号 token；第一版用于只读查询。
# 不要把这个 token 暴露给模型、日志、企业微信消息。
LSM_MCP_SERVICE_TOKEN=replace-with-service-account-token

# CLI HTTP 超时，单位秒
LSM_MCP_CLI_TIMEOUT=5

# 本地 MCP HTTP 地址，robot 侧使用
LSM_MCP_URL=http://127.0.0.1:8030/mcp
```

现有企业微信变量保留：

```bash
WECOM_AIBOT_MODE=websocket
WECOM_AIBOT_BOT_ID=...
WECOM_AIBOT_SECRET=...
WECOM_AIBOT_STATE_DB=robot/wecom_aibot_state.db
```

Webhook 模式继续使用：

```bash
WECOM_AIBOT_MODE=webhook
WECOM_AIBOT_TOKEN=...
WECOM_AIBOT_ENCODING_AES_KEY=...
WECOM_AIBOT_RECEIVE_ID=...
```

---

## 7. MCP server 实现

### 7.1 `lsm_mcp/cli_runner.py`

目标：安全、固定、可审计地执行 CLI。

原则：

1. 永远使用 `subprocess.run([...], shell=False)`。
2. 不允许模型或用户传入完整命令行。
3. 所有工具都映射到固定 CLI 参数模板。
4. stdout 必须解析成 JSON。
5. stderr 仅作为调试信息，不进入正常用户回复。
6. token 只从服务端环境变量或安全 token store 取，不进入 prompt。

建议代码骨架：

```python
# lsm_mcp/cli_runner.py

from __future__ import annotations

import json
import os
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class LsmCliResult:
    ok: bool
    exit_code: int
    payload: dict[str, Any]
    stderr: str


def run_lsm_cli(args: list[str], *, token: str | None = None) -> dict[str, Any]:
    base_url = os.getenv("LSM_MCP_BASE_URL", "http://127.0.0.1:8000/api")
    timeout_seconds = float(os.getenv("LSM_MCP_CLI_TIMEOUT", "5"))
    resolved_token = token or os.getenv("LSM_MCP_SERVICE_TOKEN", "")

    command = [
        sys.executable,
        "-m",
        "lsm_cli",
        *args,
        "--base-url",
        base_url,
        "--timeout",
        str(timeout_seconds),
    ]

    if resolved_token:
        command.extend(["--token", resolved_token])

    proc = subprocess.run(
        command,
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=timeout_seconds + 2,
        shell=False,
        env={
            **os.environ,
            "PYTHONIOENCODING": "utf-8",
        },
    )

    stdout = proc.stdout.strip()
    stderr = proc.stderr.strip()

    if not stdout:
        return {
            "ok": False,
            "exit_code": proc.returncode,
            "error": {
                "code": "EMPTY_STDOUT",
                "message": "lsm_cli returned empty stdout",
                "detail": {"stderr": stderr},
            },
        }

    try:
        payload = json.loads(stdout)
    except json.JSONDecodeError:
        return {
            "ok": False,
            "exit_code": proc.returncode,
            "error": {
                "code": "INVALID_JSON_STDOUT",
                "message": "lsm_cli stdout is not valid JSON",
                "detail": {"stdout": stdout[:2000], "stderr": stderr},
            },
        }

    if not isinstance(payload, dict):
        return {
            "ok": False,
            "exit_code": proc.returncode,
            "error": {
                "code": "INVALID_JSON_SHAPE",
                "message": "lsm_cli stdout JSON must be an object",
                "detail": {"stdout": payload},
            },
        }

    return {
        "ok": proc.returncode == 0 and payload.get("ok") is True,
        "exit_code": proc.returncode,
        "payload": payload,
        "stderr": stderr,
    }
```

### 7.2 `lsm_mcp/server.py`

目标：把固定 CLI 命令暴露成 MCP tools。

第一版建议只做**查询类 + 少量安全动作的骨架**，写操作即使 tool 存在，也先在 orchestrator 层强制确认和鉴权。

```python
# lsm_mcp/server.py

from __future__ import annotations

from typing import Any

from mcp.server.fastmcp import FastMCP

from lsm_mcp.cli_runner import run_lsm_cli

mcp = FastMCP("LabStorageManager", stateless_http=True, json_response=True)


@mcp.tool()
def inventory_search_by_name(keyword: str, limit: int = 50) -> dict[str, Any]:
    """按名称搜索库存。"""
    limit = max(1, min(limit, 100))
    return run_lsm_cli([
        "inventory",
        "list",
        "--param",
        f"search={keyword}",
        "--param",
        "search_field=name",
        "--page-size",
        str(limit),
    ])


@mcp.tool()
def inventory_get_by_id(inventory_id: int) -> dict[str, Any]:
    """按库存 ID 查看详情。"""
    return run_lsm_cli(["inventory", "get", str(inventory_id)])


@mcp.tool()
def inventory_get_by_cas(cas_number: str) -> dict[str, Any]:
    """按 CAS 号查询库存概览。"""
    return run_lsm_cli(["inventory", "cas", cas_number])


@mcp.tool()
def inventory_get_by_code(internal_code: str) -> dict[str, Any]:
    """按内部编码查询库存。"""
    return run_lsm_cli(["inventory", "code", internal_code])


@mcp.tool()
def inventory_list_low_stock(limit: int = 50) -> dict[str, Any]:
    """查询低库存。"""
    limit = max(1, min(limit, 100))
    return run_lsm_cli([
        "inventory",
        "list",
        "--param",
        "status_filter=run_short",
        "--page-size",
        str(limit),
    ])


@mcp.tool()
def reagent_orders_search_by_name(keyword: str, limit: int = 50) -> dict[str, Any]:
    """按名称搜索试剂订单。"""
    limit = max(1, min(limit, 100))
    return run_lsm_cli([
        "reagent-orders",
        "list",
        "--param",
        f"search={keyword}",
        "--param",
        "search_field=name",
        "--page-size",
        str(limit),
    ])


@mcp.tool()
def reagent_orders_get_by_id(order_id: int) -> dict[str, Any]:
    """查看单条试剂订单。"""
    return run_lsm_cli(["reagent-orders", "get", str(order_id)])


@mcp.tool()
def reagent_orders_get_cas_overview(cas_number: str) -> dict[str, Any]:
    """查看试剂 CAS 概览。"""
    return run_lsm_cli(["reagent-orders", "cas-overview", cas_number])


@mcp.tool()
def consumable_orders_search_by_name(keyword: str, limit: int = 50) -> dict[str, Any]:
    """按名称搜索耗材订单。"""
    limit = max(1, min(limit, 100))
    return run_lsm_cli([
        "consumable-orders",
        "list",
        "--param",
        f"search={keyword}",
        "--param",
        "search_field=name",
        "--page-size",
        str(limit),
    ])


@mcp.tool()
def common_shelf_search_by_alias(keyword: str, limit: int = 50) -> dict[str, Any]:
    """按别名搜索常用货架分组。"""
    limit = max(1, min(limit, 100))
    return run_lsm_cli([
        "common-shelf",
        "list",
        "--param",
        f"search={keyword}",
        "--param",
        "search_field=alias",
        "--page-size",
        str(limit),
    ])


@mcp.tool()
def common_shelf_locations(group_key: str) -> dict[str, Any]:
    """查看常用货架分组的位置统计。"""
    return run_lsm_cli(["common-shelf", "locations", group_key])


if __name__ == "__main__":
    mcp.run()
```

### 7.3 写操作工具

写操作第一版可以先定义代码，但不接入自然语言入口；等用户绑定和确认态做好后再开放。

```python
@mcp.tool()
def inventory_borrow(inventory_id: int, actor_wecom_userid: str) -> dict[str, Any]:
    """借用库存。必须由机器人编排层完成用户绑定和确认后调用。"""
    token = resolve_user_token(actor_wecom_userid)
    return run_lsm_cli(["inventory", "borrow", str(inventory_id)], token=token)


@mcp.tool()
def inventory_return(
    inventory_id: int,
    actor_wecom_userid: str,
    used_quantity: float | None = None,
    remaining_quantity: float | None = None,
) -> dict[str, Any]:
    """归还库存。必须由机器人编排层完成用户绑定和确认后调用。"""
    token = resolve_user_token(actor_wecom_userid)
    args = ["inventory", "return", str(inventory_id)]
    if used_quantity is not None:
        args += ["--used-quantity", str(used_quantity)]
    if remaining_quantity is not None:
        args += ["--remaining-quantity", str(remaining_quantity)]
    return run_lsm_cli(args, token=token)
```

注意：`actor_wecom_userid` 不应该由 LLM 自由填写。第一版如果使用规则 orchestrator，就由代码直接传；如果后面改成 LLM 自动调用 MCP tools，需要把用户身份放到 MCP server 的上下文或会话鉴权里，而不是暴露为普通模型参数。

### 7.4 `lsm_mcp/http_app.py`

推荐用本地 Streamable HTTP 方式跑 MCP server，方便企业微信机器人进程调用，也方便后续网页端或其他 agent 复用。

```python
# lsm_mcp/http_app.py

from __future__ import annotations

import contextlib

from starlette.applications import Starlette
from starlette.routing import Mount

from lsm_mcp.server import mcp


@contextlib.asynccontextmanager
async def lifespan(app: Starlette):
    async with mcp.session_manager.run():
        yield


app = Starlette(
    routes=[Mount("/", app=mcp.streamable_http_app())],
    lifespan=lifespan,
)
```

启动：

```bash
uvicorn lsm_mcp.http_app:app --host 127.0.0.1 --port 8030
```

客户端连接地址：

```text
http://127.0.0.1:8030/mcp
```

---

## 8. Robot 侧接入 MCP

### 8.1 `robot/wecom_aibot/mcp_client.py`

```python
# robot/wecom_aibot/mcp_client.py

from __future__ import annotations

import asyncio
import os
from typing import Any

from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from mcp import types


class LsmMcpClient:
    def __init__(self, url: str | None = None, timeout: float = 8.0) -> None:
        self.url = url or os.getenv("LSM_MCP_URL", "http://127.0.0.1:8030/mcp")
        self.timeout = timeout

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        return await asyncio.wait_for(self._call_tool(name, arguments), timeout=self.timeout)

    async def _call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        async with streamable_http_client(self.url) as (read_stream, write_stream, _):
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()
                result = await session.call_tool(name, arguments=arguments)

        if result.structuredContent:
            return dict(result.structuredContent)

        if result.isError:
            return {
                "ok": False,
                "exit_code": -1,
                "error": {
                    "code": "MCP_TOOL_ERROR",
                    "message": _first_text(result.content) or "MCP tool failed",
                },
            }

        return {
            "ok": True,
            "data": _first_text(result.content),
        }


def _first_text(content: list[types.ContentBlock]) -> str | None:
    for item in content:
        if isinstance(item, types.TextContent):
            return item.text
    return None
```

第一版这样每次调用都会建立一次 MCP HTTP session。代码最简单。后续如果调用量高，再把 session 做成长连接或进程级缓存。

### 8.2 `robot/wecom_aibot/conversation_store.py`

当前 `ProcessedMessageStore` 只负责 `msgid -> response_json` 去重。新增短会话状态表，用于：

1. 多候选选择。
2. 写操作确认。
3. 用户绑定状态。

建议先放同一个 SQLite 文件里。

```sql
CREATE TABLE IF NOT EXISTS wecom_aibot_conversation_state (
  chat_key TEXT PRIMARY KEY,
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

`chat_key` 建议：

```text
{chattype}:{chatid}:{userid}
```

如果 `chatid` 不存在，就用：

```text
single:{userid}
```

状态示例：

```json
{
  "type": "await_confirm",
  "action": "inventory_borrow",
  "arguments": {
    "inventory_id": 123
  },
  "display": "乙腈 / 500mL / A-01",
  "expires_at": "2026-04-18T12:30:00+08:00"
}
```

### 8.3 `robot/wecom_aibot/lsm_orchestrator.py`

第一版不建议一上来做复杂 LLM agent。建议先做规则 orchestrator，稳定之后再用 LLM 做意图理解。

```text
LSMRobotOrchestrator
  1. 先处理会话状态：确认 / 取消 / 序号选择
  2. 再处理 help
  3. 再处理明确查询：CAS、内部编码、低库存、我的借用、订单
  4. 再处理写操作：借用、归还、创建订单
  5. 最后 fallback 到库存名称搜索
```

伪代码：

```python
class LSMRobotOrchestrator:
    def __init__(self, mcp_client, conversation_store):
        self.mcp = mcp_client
        self.store = conversation_store

    async def answer(self, *, text: str, payload: dict) -> str:
        actor = extract_actor(payload)
        chat_key = build_chat_key(payload)

        state = self.store.get(chat_key)
        if state:
            maybe_reply = await self._handle_state(chat_key, state, text, actor)
            if maybe_reply:
                return maybe_reply

        intent = detect_intent(text)

        if intent.name == "help":
            return help_text()

        if intent.name == "inventory_low_stock":
            result = await self.mcp.call_tool("inventory_list_low_stock", {"limit": 50})
            return format_inventory_list(result)

        if intent.name == "inventory_search_by_cas":
            result = await self.mcp.call_tool("inventory_get_by_cas", {"cas_number": intent.cas_number})
            return format_inventory_result(result)

        if intent.name == "inventory_borrow":
            # 先查候选，不直接写
            result = await self.mcp.call_tool("inventory_search_by_name", {"keyword": intent.keyword, "limit": 5})
            return self._ask_confirm_or_select(chat_key, result, action="inventory_borrow")

        # fallback
        result = await self.mcp.call_tool("inventory_search_by_name", {"keyword": text, "limit": 5})
        return format_inventory_result(result)
```

---

## 9. Handler 改造

### 9.1 当前问题

当前 `WecomAibotHandler` 的依赖是：

```python
answer_service: InventoryAnswerService
```

然后：

```python
response = text_reply(self.answer_service.answer(message.content))
```

这会把企业微信机器人锁死在库存问答服务里。

### 9.2 改造目标

改成：

```python
orchestrator: LSMRobotOrchestrator
```

并且让 `handle_payload` 支持异步：

```python
async def handle_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
    ...
    response_text = await self.orchestrator.answer(
        text=message.content,
        payload=payload,
    )
    response = text_reply(response_text)
    self.store.save_response(message.msgid, response)
    return response
```

### 9.3 修改 `worker.py`

当前 WebSocket worker 已经是 async，并且先发流式提示：

```python
await ws_client.reply_stream(frame, stream_id, "正在查询库存...", False)
response = handler.handle_payload(frame.get("body", {}))
await ws_client.reply_stream(frame, stream_id, _extract_text(response), True)
```

改成：

```python
await ws_client.reply_stream(frame, stream_id, "正在查询...", False)
response = await handler.handle_payload(frame.get("body", {}))
await ws_client.reply_stream(frame, stream_id, _extract_text(response), True)
```

### 9.4 修改 `webhook.py`

当前 Webhook endpoint 已经是 async，但里面同步调用：

```python
response = get_handler().handle_payload(payload)
```

改成：

```python
response = await get_handler().handle_payload(payload)
```

Webhook 模式要特别注意响应时间。企业微信接收消息协议中，服务器 5 秒内收不到响应会断开并重试，总共最多三次；有 `msgid` 的消息推荐按 `msgid` 排重。如果无法保证 5 秒内处理完成，应先返回 200/空包，再用主动消息异步回复。

第一版建议优先使用 WebSocket worker，因为当前仓库也推荐 WebSocket，并且 worker 已经有流式“正在查询...”提示。

---

## 10. 用户身份和权限方案

这是最容易踩坑的地方。

### 10.1 第一版建议

第一版分两类工具：

| 类型 | token 来源 | 是否开放 |
|---|---|---|
| 公共只读查询 | `LSM_MCP_SERVICE_TOKEN` | 开放 |
| `my-*` 查询 | 用户绑定 token | 绑定后开放 |
| 借用 / 归还 | 用户绑定 token + 确认态 | 绑定后开放 |
| 新建订单 / 到货 / 入库 / 完成 | 用户绑定 token + 确认态 | 第二批开放 |

原因：CLI 使用 Bearer token 调 API。`my-borrows`、`my orders` 和写操作的“当前用户”是由 token 决定的。只用服务账号 token 会导致“我的借用”和“借用人”变成服务账号，不符合业务审计。

### 10.2 用户绑定表

新增：

```sql
CREATE TABLE IF NOT EXISTS wecom_aibot_user_binding (
  wecom_userid TEXT PRIMARY KEY,
  lsm_username TEXT,
  lsm_access_token TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

生产建议：`lsm_access_token` 加密保存。第一版如果只在内网实验环境测试，也至少要避免打日志。

### 10.3 绑定方式

最少改代码的方式：

```text
管理员预先维护 binding 表
```

推荐正式方式：

```text
用户在 LSM 网页端生成一次性绑定码
-> 企业微信发送：绑定 ABCD-1234
-> robot 调后端验证绑定码
-> 写入 wecom_userid -> lsm_user/token/session 映射
```

这个正式方式需要增加一个很小的后端绑定接口，但能避免用户把 token 粘贴到企业微信里。

不建议：

```text
用户在企业微信里直接发送自己的 access token
```

---

## 11. 写操作确认流程

所有写操作必须走确认态。

### 11.1 借用示例

用户：

```text
帮我借乙腈
```

流程：

```text
1. orchestrator 检测 borrow 意图
2. MCP 调 inventory_search_by_name(keyword="乙腈")
3. 如果 0 个候选：回复未找到
4. 如果多个候选：回复候选列表，让用户回复序号
5. 如果 1 个候选：写入 await_confirm 状态
6. 回复：确认借用 乙腈 / 500mL / A-01 吗？回复“确认”
7. 用户回复“确认”
8. orchestrator 检查状态未过期、用户已绑定
9. MCP 调 inventory_borrow(inventory_id=...)
10. 回复执行结果
```

### 11.2 确认态过期

建议 5 分钟过期。

```json
{
  "type": "await_confirm",
  "expires_at": "2026-04-18T12:30:00+08:00"
}
```

过期后：

```text
这个操作确认已过期，请重新发起。
```

### 11.3 幂等

企业微信侧已有 `msgid` 去重，当前 `ProcessedMessageStore` 会把 `msgid -> response_json` 保存下来。这个必须保留。

写操作还要额外做到：

1. 用户同一个确认态只能执行一次。
2. 执行后立即清除状态。
3. 如果 MCP/CLI 返回超时或网络错误，不要自动重试写操作。
4. 如果企业微信重放同一个 `msgid`，直接返回上次 response。

---

## 12. 回复格式化

MCP tool 返回的是 CLI 包装后的结构，例如：

```json
{
  "ok": true,
  "exit_code": 0,
  "payload": {
    "ok": true,
    "data": {}
  },
  "stderr": ""
}
```

格式化层统一处理：

| 条件 | 回复 |
|---|---|
| `ok=true` 且有列表 | 摘要 + 前 5 条 |
| `exit_code=2` | “认证失败或登录已过期。” |
| `exit_code=3` | “你没有权限执行这个操作。” |
| `exit_code=4` | “没有找到对应记录。” |
| `exit_code=5` | “请求太频繁，请稍后再试。” |
| `exit_code=7/8` | “参数不完整或格式不正确。” |
| `exit_code=9` | “后端服务暂时不可达。” |
| 其他 | “系统异常，请稍后再试。” |

不要把 stderr、token、完整 traceback 发给企业微信用户。

---

## 13. 第一批 MCP tools 清单

建议第一批真正接入机器人自然语言入口的是这些：

| MCP tool | CLI 映射 | 说明 | 是否需要用户绑定 | 是否写操作 |
|---|---|---|---|---|
| `inventory_search_by_name` | `inventory list --param search=... --param search_field=name` | 名称搜库存 | 用户绑定 | 否 |
| `inventory_get_by_id` | `inventory get` | 库存详情 | 用户绑定 | 否 |
| `inventory_get_by_cas` | `inventory cas` | CAS 查库存 | 用户绑定 | 否 |
| `inventory_get_by_code` | `inventory code` | 内部编码查库存 | 用户绑定 | 否 |
| `inventory_list_low_stock` | `inventory list --param status_filter=run_short` | 低库存 | 用户绑定 | 否 |
| `reagent_orders_search_by_name` | `reagent-orders list --param search=...` | 搜试剂订单 | 用户绑定 | 否 |
| `reagent_orders_get_by_id` | `reagent-orders get` | 试剂订单详情 | 用户绑定 | 否 |
| `reagent_orders_get_cas_overview` | `reagent-orders cas-overview` | CAS 概览 | 用户绑定 | 否 |
| `consumable_orders_search_by_name` | `consumable-orders list --param search=...` | 搜耗材订单 | 用户绑定 | 否 |
| `common_shelf_search_by_alias` | `common-shelf list --param search=... --param search_field=alias` | 常用货架别名查询 | 用户绑定 | 否 |
| `common_shelf_locations` | `common-shelf locations` | 常用货架位置统计 | 用户绑定 | 否 |

用户绑定做好后再开放：

| MCP tool | CLI 映射 | 说明 | 保护要求 |
|---|---|---|---|
| `inventory_my_borrows` | `inventory my-borrows` | 我的借用 | 用户绑定 |
| `inventory_pending_stockin` | `inventory pending-stockin` | 我的待补全入库 | 用户绑定 |
| `inventory_borrow` | `inventory borrow` | 借用 | 用户绑定 + 确认态 |
| `inventory_return` | `inventory return` | 归还 | 用户绑定 + 确认态 |
| `reagent_orders_my` | `reagent-orders my` | 我的试剂订单 | 用户绑定 |
| `reagent_orders_create` | `reagent-orders create` | 新建试剂订单 | 用户绑定 + 确认态 |
| `consumable_orders_my` | `consumable-orders my` | 我的耗材订单 | 用户绑定 |
| `consumable_orders_create` | `consumable-orders create` | 新建耗材订单 | 用户绑定 + 确认态 |

第二批再开放：

| MCP tool | CLI 映射 | 说明 | 保护要求 |
|---|---|---|---|
| `reagent_orders_confirm_arrival` | `reagent-orders confirm-arrival` | 确认到货 | 用户绑定 + 确认态 |
| `reagent_orders_stock_in` | `reagent-orders stock-in` | 订单入库 | 用户绑定 + 确认态 |
| `consumable_orders_complete` | `consumable-orders complete` | 完成耗材订单 | 用户绑定 + 确认态 |
| `common_shelf_add_bottles` | `common-shelf add-bottles` | 常用货架加瓶 | 用户绑定 + 确认态 |
| `common_shelf_remove_one` | `common-shelf remove-one` | 常用货架扣减 | 用户绑定 + 确认态 |

不建议第一版暴露：

```text
inventory manual-add
inventory update
reagent-orders update
consumable-orders update
common-shelf manual-add
```

这些参数多、误操作面大，适合网页表单，不适合聊天入口第一版。

---

## 14. 启动方式

### 14.1 后端

```bash
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### 14.2 MCP server

```bash
export LSM_MCP_BASE_URL=http://127.0.0.1:8000/api
export LSM_MCP_SERVICE_TOKEN=replace-with-service-token
export LSM_MCP_CLI_TIMEOUT=5

uvicorn lsm_mcp.http_app:app --host 127.0.0.1 --port 8030
```

### 14.3 企业微信 WebSocket worker

```bash
export WECOM_AIBOT_MODE=websocket
export WECOM_AIBOT_BOT_ID=replace-with-bot-id
export WECOM_AIBOT_SECRET=replace-with-secret
export LSM_MCP_URL=http://127.0.0.1:8030/mcp

python robot/run_wecom_worker.py
```

### 14.4 Webhook 模式

```bash
export WECOM_AIBOT_MODE=webhook
export WECOM_AIBOT_TOKEN=replace-with-token
export WECOM_AIBOT_ENCODING_AES_KEY=replace-with-aes-key
export WECOM_AIBOT_RECEIVE_ID=replace-with-receive-id
export LSM_MCP_URL=http://127.0.0.1:8030/mcp

python robot/run_wecom_webhook.py
```

---

## 15. Docker Compose 建议

最小可运行方式可以把 MCP server 和 robot worker 都放进 backend 容器或同一台机器上跑。更干净的方式是单独服务：

```yaml
services:
  backend:
    # existing backend
    ports:
      - "8000:8000"

  lsm-mcp:
    build: .
    command: uvicorn lsm_mcp.http_app:app --host 0.0.0.0 --port 8030
    environment:
      LSM_MCP_BASE_URL: http://backend:8000/api
      LSM_MCP_SERVICE_TOKEN: ${LSM_MCP_SERVICE_TOKEN}
      LSM_MCP_CLI_TIMEOUT: "5"
    depends_on:
      - backend
    expose:
      - "8030"

  wecom-robot:
    build: .
    command: python robot/run_wecom_worker.py
    environment:
      WECOM_AIBOT_MODE: websocket
      WECOM_AIBOT_BOT_ID: ${WECOM_AIBOT_BOT_ID}
      WECOM_AIBOT_SECRET: ${WECOM_AIBOT_SECRET}
      LSM_MCP_URL: http://lsm-mcp:8030/mcp
    depends_on:
      - lsm-mcp
```

MCP server 不要暴露公网端口。

---

## 16. 测试计划

### 16.1 CLI smoke test

```bash
python -m lsm_cli auth whoami \
  --base-url http://127.0.0.1:8000/api \
  --token "$LSM_MCP_SERVICE_TOKEN"
```

预期：

```json
{
  "ok": true,
  "data": {...}
}
```

### 16.2 MCP server smoke test

启动：

```bash
uvicorn lsm_mcp.http_app:app --host 127.0.0.1 --port 8030
```

用 MCP Inspector：

```bash
npx -y @modelcontextprotocol/inspector
```

连接：

```text
http://127.0.0.1:8030/mcp
```

测试：

```json
{
  "tool": "inventory_search_by_name",
  "arguments": {
    "keyword": "乙醇",
    "limit": 5
  }
}
```

### 16.3 Robot smoke test

企业微信私聊机器人或群里 @ 机器人：

```text
查询乙醇库存
64-17-5 在哪里
低库存
查试剂订单 乙腈
常用货架 酒精
```

### 16.4 写操作测试

在用户绑定完成前：

```text
借用乙醇
```

预期：

```text
这个操作需要先绑定 LabStorageManager 账号。
```

绑定后：

```text
借用乙醇
```

预期：候选或确认，不直接执行。

```text
确认借用：乙醇 / 500mL / A-01 吗？回复“确认”执行，回复“取消”放弃。
```

### 16.5 失败测试

| 场景 | 预期 |
|---|---|
| token 无效 | 认证失败提示，不泄露 token |
| 权限不足 | 权限不足提示 |
| 后端没启动 | 后端暂时不可达 |
| CLI stdout 非 JSON | 系统异常 + 后台日志 |
| 企业微信重复推送同 msgid | 返回相同 cached response |
| 写操作 MCP 超时 | 不自动重试写操作 |
| 用户确认过期 | 提示重新发起 |
| 非文本消息 | 继续返回“目前先支持文字查询” |

---

## 17. 分阶段落地

### 阶段 0：只加 MCP，不动企业微信业务流程

目标：确认 MCP 能稳定包住 CLI。

改动：

```text
新增 lsm_mcp/
新增 pyproject mcp 依赖
```

验收：

```text
MCP Inspector 能调用 inventory_search_by_name 并拿到 CLI JSON。
```

### 阶段 1：企业微信查询接入 MCP

目标：替换 `InventoryAnswerService`，但先只开放读操作。

改动：

```text
新增 robot/wecom_aibot/mcp_client.py
新增 robot/wecom_aibot/lsm_orchestrator.py
修改 handler.py / worker.py / webhook.py
```

开放能力：

```text
库存名称查询
CAS 查询
内部编码查询
低库存
试剂订单搜索
耗材订单搜索
常用货架查询
```

验收：企业微信里能完成上述查询。

### 阶段 2：用户绑定 + 我的数据

目标：让 `my-borrows`、`my reagent orders`、`my consumable orders` 正确按用户身份执行。

改动：

```text
新增 user_binding 表
新增绑定/解绑命令
MCP server 支持按 wecom_userid 取 token
```

开放能力：

```text
我的借用
我的待入库
我的试剂订单
我的耗材订单
```

### 阶段 3：写操作

目标：开放借用、归还、创建订单。

保护：

```text
用户绑定
候选消歧
确认态
状态过期
幂等保护
错误码分支
```

开放能力：

```text
库存借用
库存归还
新建试剂订单
新建耗材订单
```

### 阶段 4：完整闭环

目标：开放订单到货、入库、耗材完成、常用货架加减瓶。

开放能力：

```text
确认到货
订单入库
耗材完成
常用货架加瓶
常用货架扣减
```

---

## 18. 最小 PR 拆分建议

### PR 1：MCP server 包 CLI

包含：

```text
lsm_mcp/__init__.py
lsm_mcp/cli_runner.py
lsm_mcp/server.py
lsm_mcp/http_app.py
pyproject.toml
```

不碰企业微信。

### PR 2：机器人读操作切 MCP

包含：

```text
robot/wecom_aibot/mcp_client.py
robot/wecom_aibot/lsm_orchestrator.py
robot/wecom_aibot/formatters.py
handler.py 修改
worker.py 修改
webhook.py 修改
```

### PR 3：会话状态和确认态

包含：

```text
robot/wecom_aibot/conversation_store.py
借用/归还前的候选和确认流程
```

### PR 4：用户绑定

包含：

```text
wecom_userid -> LSM token/session 映射
绑定 / 解绑命令
my-* 查询开放
```

### PR 5：写操作开放

包含：

```text
inventory_borrow
inventory_return
reagent_orders_create
consumable_orders_create
```

---

## 19. 关键风险和规避

### 19.1 顶层目录命名冲突

不要创建顶层 `mcp/`。使用 `lsm_mcp/`。

### 19.2 token 泄露

不要：

```text
把 token 放进 prompt
把 token 放进企业微信回复
把 token 打到日志
让 LLM 自己填写 token
```

### 19.3 服务账号误用

服务账号适合只读查询，不适合“我的借用”和写操作。写操作必须做用户绑定。

### 19.4 写操作重复执行

必须同时依赖：

```text
企业微信 msgid 去重
会话确认态执行后清除
CLI 写操作不自动重试
```

### 19.5 Webhook 超时

Webhook 模式不要在同步响应里跑长链路。优先 WebSocket。Webhook 如果要接 LLM 或多工具调用，应先快速 ACK，再主动回复。

### 19.6 CLI data schema 不完全统一

CLI 外层统一，但 `data` 内部来自不同后端 API。格式化层不要假设所有列表字段都叫同一个名字；先做 `items / records / data / results` 兼容抽取，必要时对每个 tool 单独 formatter。

---

## 20. 最终建议

现在不要重构后端 service，也不要让机器人直接调用 CLI，更不要让模型生成任意命令。

最小且稳的方案是：

```text
固定 MCP tools
  -> 固定 CLI 命令模板
  -> CLI JSON + exit code
  -> 机器人 orchestrator 做消歧、确认和格式化
```

第一版先把读操作跑通；用户绑定完成前，不要开放“我的数据”和写操作。这样既能快速落地，又不会破坏权限、审计和企业微信回调稳定性。

---

## 21. 参考依据

- 当前仓库主 README：FastAPI + React 架构、CLI 入口和系统能力。
- `lsm_cli/README.md`：CLI 输出契约、退出码、全局参数和命令总览。
- `lsm_cli/output.py`：`succeed()` / `fail()` JSON 输出实现。
- `lsm_cli/client.py`：`--base-url`、`--token`、`--timeout` 和 Bearer token 调 API 的实现。
- `robot/README.md`：企业微信智能机器人 API 模式、WebSocket / Webhook 入口和当前能力。
- `robot/wecom_aibot/handler.py`：当前 handler 仍调用 `InventoryAnswerService`。
- `robot/wecom_aibot/store.py`：当前已按 `msgid` 做持久化去重。
- MCP Python SDK 文档：FastMCP tool、Streamable HTTP、客户端调用方式。
