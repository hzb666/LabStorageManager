<h1 align="center">LabStorageManager</h1>

![logo.webp](./wiki/logo.webp)

<p align="center">
  <img src="https://img.shields.io/badge/Python-3.11+-blue?style=flat&logo=python" alt="Python">
  <img src="https://img.shields.io/badge/Node.js-20+-blue?style=flat&logo=node.js" alt="Node.js">
  <img src="https://img.shields.io/badge/SQLite-WAL-green?style=flat&logo=sqlite" alt="SQLite">
  <img src="https://img.shields.io/badge/License-Apache%202.0-green?style=flat" alt="License">
  <a href="https://zread.ai/hzb666/LabStorageManager" target="_blank"><img src="https://img.shields.io/badge/Zread-_.svg?style=flat&color=00b0aa&labelColor=565656&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTQuOTYxNTYgMS42MDAxSDIuMjQxNTZDMS44ODgxIDEuNjAwMSAxLjYwMTU2IDEuODg2NjQgMS42MDE1NiAyLjI0MDFWNC45NjAxQzEuNjAxNTYgNS4zMTM1NiAxLjg4ODEgNS42MDAxIDIuMjQxNTYgNS42MDAxSDQuOTYxNTZDNS4zMTUwMiA1LjYwMDEgNS42MDE1NiA1LjMxMzU2IDUuNjAxNTYgNC45NjAxVjIuMjQwMUM1LjYwMTU2IDEuODg2NjQgNS4zMTUwMiAxLjYwMDEgNC45NjE1NiAxLjYwMDFaIiBmaWxsPSIjZmZmIi8%2BCjxwYXRoIGQ9Ik00Ljk2MTU2IDEwLjM5OTlIMi4yNDE1NkMxLjg4ODEgMTAuMzk5OSAxLjYwMTU2IDEwLjY4NjQgMS42MDE1NiAxMS4wMzk5VjEzLjc1OTlDMS42MDE1NiAxNC4xMTM0IDEuODg4MSAxNC4zOTk5IDIuMjQxNTYgMTQuMzk5OUg0Ljk2MTU2QzUuMzE1MDIgMTQuMzk5OSA1LjYwMTU2IDE0LjExMzQgNS42MDE1NiAxMy43NTk5VjExLjAzOTlDNS42MDE1NiAxMC42ODY0IDUuMzE1MDIgMTAuMzk5OSA0Ljk2MTU2IDEwLjM5OTlaIiBmaWxsPSIjZmZmIi8%2BCjxwYXRoIGQ9Ik0xMy43NTg0IDEuNjAwMUgxMS4wMzg0QzEwLjY4NSAxLjYwMDEgMTAuMzk4NCAxLjg4NjY0IDEwLjM5ODQgMi4yNDAxVjQuOTYwMUMxMC4zOTg0IDUuMzEzNTYgMTAuNjg1IDUuNjAwMSAxMS4wMzg0IDUuNjAwMUgxMy43NTg0QzE0LjExMTkgNS42MDAxIDE0LjM5ODQgNS4zMTM1NiAxNC4zOTg0IDQuOTYwMVYyLjI0MDFDMTQuMzk4NCAxLjg4NjY0IDE0LjExMTkgMS42MDAxIDEzLjc1ODQgMS42MDAxWiIgZmlsbD0iI2ZmZiIvPgo8cGF0aCBkPSJNNCAxMkwxMiA0TDQgMTJaIiBmaWxsPSIjZmZmIi8%2BCjxwYXRoIGQ9Ik00IDEyTDEyIDQiIHN0cm9rZT0iI2ZmZiIgc3Ryb2tlLXdpZHRoPSIxLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgo8L3N2Zz4K&logoColor=ffffff" alt="zread"/></a>
<img src="https://img.shields.io/badge/DeepWiki-_.svg?style=flat&color=00b0aa&labelColor=565656&logo=data:image/svg+xml;charset=utf-8;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0NjAiIGhlaWdodD0iNTAwIiBjbGFzcz0ic2l6ZS00IHRyYW5zZm9ybSB0cmFuc2l0aW9uLXRyYW5zZm9ybSBkdXJhdGlvbi03MDAgZ3JvdXAtaG92ZXI6cm90YXRlLTE4MCBbJmFtcDtfcGF0aF06c3Ryb2tlLTAiIHZpZXdCb3g9IjExMCAxMTAgNDYwIDUwMCI+PHBhdGggZD0iTTQxOSAzMzJxMTYtNyAzMiAwbDI1IDE1IDMgMSAzIDEgMy0xIDMtMSA1MS0yOXE2LTMgNi0xMXYtNThxMC04LTYtMTFsLTUxLTI5cS02LTMtMTIgMGwtNTEgMjl2MWwtMiAxLTIgMnYxbC0xIDJ2MWwtMSAzdjI5YTMyIDMyIDAgMCAxLTQ4IDI4bC0yNS0xNS0zLTEtMy0xLTMgMS0zIDEtNTEgMjlxLTUgMy02IDExdjU4cTEgOCA2IDExbDUxIDI5IDMgMSAzIDEgMy0xIDMtMSAyNS0xNWEzMiAzMiAwIDAgMSA0OCAyOHYyOWwxIDN2MWwxIDJ2MWwyIDIgMiAyIDUxIDI5IDYgMiA2LTIgNTEtMjlxNi0zIDYtMTF2LTU4cTAtOC02LTExbC01MS0yOS0zLTEtMy0xLTMgMS0zIDEtMjUgMTVhMzIgMzIgMCAwIDEtNDgtMjhxMS0xOCAxNi0yOCIgc3R5bGU9ImZpbGw6IzIxYzE5YSIvPjxwYXRoIGQ9Im0xNDEgMzE4IDUxIDI5IDYgMiA2LTIgNTEtMjl2LTFsMi0xIDItMnYtMWwxLTJ2LTFsMS0zdi0yOWEzMiAzMiAwIDAgMSA0OC0yOGwyNSAxNSAzIDEgMyAxIDMtMSAzLTEgNTEtMjlxNi0zIDYtMTF2LTU4cTAtOC02LTExbC01MS0yOXEtNi0zLTEyIDBsLTUxIDI5LTIgMmgtMWwtMSAydjFsLTEgMnYxbC0xIDN2MjlhMzIgMzIgMCAwIDEtNDggMjhsLTI1LTE1LTMtMS0zLTEtMyAxLTMgMS01MSAyOXEtNiAzLTYgMTF2NThxMCA4IDYgMTEiIHN0eWxlPSJmaWxsOiMzOTY5Y2EiLz48cGF0aCBkPSJtMzk3IDQ4NC01MS0yOS0zLTEtMy0xLTMgMS0zIDEtMjUgMTVhMzIgMzIgMCAwIDEtNDgtMjh2LTI5bC0xLTN2LTFsLTEtMnYtMWwtMi0yLTItMXYtMWwtNTEtMjlxLTYtMy0xMiAwbC01MSAyOXEtNiAzLTYgMTF2NThxMCA4IDYgMTFsNTEgMjkgMyAxIDMgMSAzLTEgMy0xIDI1LTE1YTMyIDMyIDAgMCAxIDQ4IDI4djI5bDEgM3YxbDEgMnYxbDIgMiAyIDIgNTEgMjkgNiAyIDYtMiA1MS0yOXE2LTMgNi0xMXYtNThxMC04LTYtMTEiIHN0eWxlPSJmaWxsOiMwMjk0ZGUiLz48L3N2Zz4=" alt="deepwiki"/>
</p>


面向实验室场景的试剂与耗材管理系统，覆盖申购、审批、到货、入库、借用、归还、公告、设备会话管理和受控自动化入口。项目采用 FastAPI + React 前后端分离架构，适合单实验室或中小团队快速部署，也适合通过 CLI、Agent skill、MCP、智能机器人和浏览器插件接入日常流程。

## 目录

- [项目简介](#项目简介)
- [核心能力](#核心能力)
- [技术栈](#技术栈)
- [快速开始](#快速开始)
- [环境变量](#环境变量)
- [常用命令](#常用命令)
- [CLI 支持](#cli-支持)
- [系统架构](#系统架构)
- [前端本地存储](#前端本地存储)
- [关键业务规则](#关键业务规则)
- [目录结构](#目录结构)
- [部署说明](#部署说明)
- [附属模块](#附属模块)
- [故障排查](#故障排查)
- [CLI 访问边界](#cli-访问边界)
- [许可证](#许可证)

## 项目简介

LabStorageManager 解决的是实验室中最容易失控的几类问题：

- 试剂和耗材分开管理，但又能共享统一的认证、审批和搜索体验。
- CAS 号、防重复采购、拼音检索、模糊搜索、批量导入这些实验室高频需求由系统直接支持。
- 订单到库存的流转保留审计链路，避免“入库后订单消失”带来的追溯困难。
- 图片不入库，只落文件系统并在数据库中保存 URL，减轻数据库压力。

适用场景：

- 高校课题组或研究平台
- 企业研发实验室
- 需要部署在单机 / 轻量服务器上的库存系统

## 核心能力

- 试剂与耗材双流程管理
  试剂支持 CAS 号、到货确认、一键入库；耗材支持独立订单流程与完成态管理。
- CAS 防重与库存预警
  申购时可按 CAS 查询现有库存和历史订单，降低重复购买概率。
- 试剂品牌主数据
  试剂订单、库存和待入库表单共享品牌选项，支持拼音搜索、软删除和操作日志记录。
- 中文拼音检索与 FTS 搜索
  名称、分类、品牌、位置等字段会预计算拼音，并结合 SQLite FTS5 提供搜索能力。
- 库存借还闭环
  支持借出、归还、借用历史、当前借用人、临时保管人等字段；历史记录缺少规格时可在归还时补齐。
- 仪表盘与管理看板
  个人模式展示订单、借用和待入库待办；成员看板展示公告、运行统计、个人待处理、订单概览、近期到货/入库和库存告警；管理员管理模式展示全局待办、风险提醒、库存告警和管理表格；公用账户展示公告和全局窗口统计；低库存按剩余比例低于 10% 判断。
- 常用货架与常用试剂
  支持常用货架分组、CAS 主数据、位置统计、加瓶和扣减。
- 用户、设备、会话治理
  支持 HttpOnly Cookie 登录、设备列表、批量注销、IP/设备数量限制。
- 公告与图片上传
  公告支持图片，文件保存到 `static/` 运行目录，经 `/static/` 访问；数据库只保留 URL，并受尺寸、类型、上传频率控制。
- 化学结构检索
  可选启用本地结构缓存、PubChem 解析、Ketcher 绘制和子结构检索。
- CLI、Agent skill 与脚本入口
  提供 `python -m lsm_cli` 命令行入口，供脚本、Agent skill 和无 UI 场景在受控命令面内操作。
- MCP、智能机器人与浏览器插件
  MCP 通过 CLI 子进程工作；企业微信智能机器人、微信客服和浏览器插件都回到标准 API 与确认流程，识别到 CAS 时优先执行系统内精确查询。
- 部署简单
  内置 Docker Compose，可快速拉起 `frontend + backend + redis`。

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 后端 | FastAPI, SQLModel, SQLite, Redis, python-jose, bcrypt, Pillow, pypinyin |
| 前端 | React 19, TypeScript 5.9, Vite 8, React Router 7, Zustand, React Hook Form, Valibot |
| UI | Radix UI, Tailwind CSS 4, Lucide React, Framer Motion |
| 表格与数据 | TanStack Table 8, TanStack Virtual, TanStack Query 5, Axios |
| 化学相关 | RDKit, Ketcher, PubChem 解析, 本地结构缓存 |
| 自动化入口 | `lsm_cli`, Agent skill, `lsm_mcp`, 企业微信智能机器人, 微信客服, 浏览器插件 |
| 构建与校验 | Poetry, npm, ruff, ESLint, TypeScript build |
| 部署 | Docker Compose, Nginx, Uvicorn |

## 快速开始

### 1. 前置要求

本地环境：

- Python 3.11+
- Node.js 20+
- npm 10+
- Redis 6+ 或 7+（本地开发可选，但推荐开启）

### 2. 克隆仓库

```bash
git clone <your-repo-url> LabStorageManager
cd LabStorageManager
```

### 3. 配置后端环境

推荐使用 Poetry：

```bash
poetry install
```

### 4. 配置前端环境

```bash
cd frontend
npm install
cd ..
```

### 5. 创建环境变量文件

以 `.env.example` 为模板准备本地运行配置。该配置文件只用于当前环境，不纳入版本库。

PowerShell：

```powershell
Copy-Item .env.example .env
```

Bash：

```bash
cp .env.example .env
```

最少需要确认这些字段：

| 变量 | 说明 |
| --- | --- |
| `ENV` | 本地开发使用 `development` |
| `CORS_ORIGINS` | 前端地址白名单，开发时通常为 `http://localhost:5173` |
| `DEFAULT_ADMIN_PASSWORD` | 必填；后端首次启动会用它初始化管理员 |
| `ALGORITHM` | 默认 `RS256` |
| `DATABASE_URL` | 主库 SQLite 连接串，必须指向文件型 SQLite；本地示例默认 `sqlite:///./lab_inventory.db`，Docker Compose 默认写入 `/data/lab_inventory.db` |
| `QUERY_LOG_DIR` | 搜索日志库目录 |

开发环境配置：

- 将 `ENV=development`
- 将 `CORS_ORIGINS` 改为当前前端地址
- 首次启动前设置 `DEFAULT_ADMIN_PASSWORD`

说明：

- 当 `ENV=development` 且本地还没有 RSA 密钥时，后端可自动生成临时密钥对。
- 当 `ENV=production` 时，`ALGORITHM` 必须为 `RS256`，并且 RSA 私钥与公钥路径必须可用。

### 6. 启动后端

```bash
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

启动后可访问：

- 开发文档: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`
- 健康检查: `http://localhost:8000/health`

注意：

- 只有开发模式会暴露 `/docs`、`/redoc` 和 `/openapi.json`。
- 首次启动会自动初始化至少一个管理员账户。

### 7. 启动前端

```bash
cd frontend
npm run dev
```

默认前端地址：

- `http://localhost:5173`

## 环境变量

### 必填项

| 变量 | 示例 | 说明 |
| --- | --- | --- |
| `ENV` | `development` | `development/dev` 或 `production` |
| `CORS_ORIGINS` | `["http://localhost:5173"]` | JSON 数组字符串 |
| `DEFAULT_ADMIN_PASSWORD` | `your-password` | 默认管理员密码，未设置将导致启动失败 |
| `ALGORITHM` | `RS256` | 生产环境必须使用 `RS256` |

### 常用项

| 变量 | 示例值 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | `sqlite:///./lab_inventory.db` | 主库 SQLite 连接串；本地默认写入项目根目录，Docker Compose 默认覆盖为 `sqlite:////data/lab_inventory.db` |
| `QUERY_LOG_DIR` | `logs` | 搜索日志库目录；Docker Compose 默认覆盖为 `/data/logs` |
| `TRUST_PROXY_HEADERS` | `true` | Compose 生产部署设为 true；本地开发或无可信反代时设为 false |
| `CACHE_VERSION` | `0.1.0` | 前后端缓存失效版本；留空时使用 `APP_VERSION` |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `10080` | 登录态默认 7 天 |
| `SESSION_EXPIRE_HOURS` | `72` | 会话有效期 |
| `MAX_IP_PER_USER` | `5` | 每个用户允许的最大 IP 数 |
| `MAX_DEVICE_PER_USER` | `10` | 每个用户允许的最大设备数 |
| `CLI_RATE_LIMIT_COUNT` | `60` | CLI API 单窗口请求次数 |
| `CLI_RATE_LIMIT_WINDOW_SECONDS` | `60` | CLI API 限流窗口秒数 |
| `CLI_LOGIN_RATE_LIMIT_COUNT` | `3` | CLI 登录单窗口尝试次数 |
| `CLI_LOGIN_RATE_LIMIT_WINDOW_SECONDS` | `300` | CLI 登录限流窗口秒数 |
| `REDIS_HOST` | `127.0.0.1` | Redis 主机 |
| `REDIS_PORT` | `6379` | Redis 端口 |
| `REDIS_DB` | `1` | Redis 逻辑库 |
| `REDIS_PASSWORD` | 空 | Redis 仅监听本机时可留空；对外监听时必须设置 |
| `REDIS_KEY_PREFIX` | `lsm` | Redis key 前缀 |

### 日志归档

| 变量 | 示例值 | 说明 |
| --- | --- | --- |
| `ARCHIVE_SCHEDULER_ENABLED` | `true` | 启用后端内置日志归档调度 |
| `ARCHIVE_RUN_AT_TIME` | `03:30` | 按服务器本地系统时间执行归档 |
| `ARCHIVE_RUN_WEEKDAY` | `sun` | 设置后每周指定星期执行；留空则每天执行 |
| `ARCHIVE_INTERVAL_HOURS` | `168` | 未设置固定时间时使用的周期小时数 |
| `ARCHIVE_STARTUP_DELAY_SECONDS` | `300` | 未设置固定时间时首次运行前的延迟 |
| `ARCHIVE_OUTPUT_DIR` | `logs` | 归档库输出目录 |

### 上传与图片

| 变量 | 示例值 | 说明 |
| --- | --- | --- |
| `MAX_FILE_SIZE_MB` | `10` | 单文件体积限制 |
| `MAX_UPLOAD_REQUEST_SIZE_MB` | `12` | 单次请求总上传限制；生产 Nginx 需保持一致 |
| `ALLOWED_IMAGE_TYPES` | `["image/jpeg", "image/png", "image/webp"]` | JSON 数组字符串 |
| `MAX_IMAGE_WIDTH` | `800` | 最大宽度 |
| `MAX_IMAGE_HEIGHT` | `800` | 最大高度 |
| `MAX_IMAGE_SIZE_KB` | `100` | 压缩后图片大小上限 |
| `UPLOAD_RATE_LIMIT_COUNT` | `10` | 上传限流次数 |
| `UPLOAD_RATE_LIMIT_WINDOW_SECONDS` | `300` | 上传限流时间窗口 |

### 公告与外部信息

| 变量 | 示例值 | 说明 |
| --- | --- | --- |
| `MAX_TOTAL_ANNOUNCEMENTS` | `10` | 单管理员公告总数上限 |
| `MAX_VISIBLE_ANNOUNCEMENTS` | `5` | 单管理员可见公告数上限 |
| `NIUTRANS_APPID` | 空 | 牛翻 API AppID；未配置时不启用 |
| `NIUTRANS_APIKEY` | 空 | 牛翻 API Key；未配置时不启用 |

### 化学结构检索

| 变量 | 示例值 | 说明 |
| --- | --- | --- |
| `CHEM_STRUCTURE_FEATURE_ENABLED` | `true` | 是否启用结构缓存和子结构检索接口 |
| `CHEM_RESOLVER_PUBCHEM_ENABLED` | `true` | 是否允许通过 PubChem 解析 CAS 结构 |
| `CHEM_PUBCHEM_RATE_LIMIT_PER_SECOND` | `2` | PubChem 请求速率上限 |
| `CHEM_PUBCHEM_TIMEOUT_SECONDS` | `20` | PubChem 请求超时 |
| `CHEM_PUBCHEM_MAX_RETRIES` | `3` | PubChem 失败重试次数 |
| `CHEM_PUBCHEM_USER_AGENT` | `LabStorageManager/0.1.0` | 发送到 PubChem 的 User-Agent |
| `CHEM_STRUCTURE_SEARCH_MAX_RESULTS` | `100` | 子结构检索默认结果上限 |

### JWT 与密钥

| 变量 | 说明 |
| --- | --- |
| `PRIVATE_KEY_PATH` | `RS256` 私钥路径 |
| `PUBLIC_KEY_PATH` | `RS256` 公钥路径 |
| `SECRET_KEY` | 仅 `HS256` 时使用；开发环境可自动生成临时值 |

## 常用命令

### 后端

```bash
# 开发启动
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# 代码检查
ruff check app/
```

### 前端

```bash
cd frontend

# 开发启动
npm run dev

# 生成带版本号的 RDKit 和本地字体资源映射
npm run generate:static-assets

# Lint
npm run lint

# 生产构建
npm run build
```

### Docker

```bash
# 构建并启动
APP_PORT=80 docker compose up -d --build

# 查看状态
docker compose ps

# 查看日志
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f redis
```

Compose 默认把主库、搜索日志库、上传文件和密钥放在持久化 volume 中。备份 SQLite 主库前先做 checkpoint，并保证主库及其 WAL/SHM 伴随文件处于同一备份批次。

## CLI 支持

仓库提供本地命令行入口 [`lsm_cli/README.md`](lsm_cli/README.md)，适合脚本任务和不打开前端的开发者。CLI 只通过后端 API 工作，不直接访问数据库，也不导入服务层。

### 支持范围

- `auth`
  支持 `login`、`logout`、`whoami`
- `inventory`
  支持列表、详情、CAS 查询、借还、手工入库、更新等日常库存操作
- `reagent-orders`
  支持列表、创建、更新、到货确认、一键入库等试剂订单流程
- `consumable-orders`
  支持列表、创建、更新、完成等耗材订单流程
- `common-shelf`
  支持常用货架列表、CAS/别名查询、位置统计、加瓶和扣减
- `chemical-name-map`
  支持 CAS 主数据列表、关键词查询和 CAS 精确查询

限制说明：

- 不开放 `delete`
- 不开放 `export`
- 不开放文件上传
- 不开放 CLI 未显式暴露的 API

### 快速示例

```bash
# 查看顶层帮助
python -m lsm_cli --help

# 交互式登录
python -m lsm_cli auth login --username alice

# 查询库存
python -m lsm_cli inventory list --page 1 --page-size 20 --param search=乙醇

# 创建试剂订单
python -m lsm_cli reagent-orders create --data-file payload.json

# 查看当前登录用户
python -m lsm_cli auth whoami
```

### 使用约定

- 默认 API 地址为 `http://127.0.0.1:8000/api`
- `auth login` 支持 `--base-url` 与 `--timeout`
- 脚本登录推荐使用 `--password-stdin` 传递密码，避免明文出现在 shell history
- 所有命令向 `stdout` 输出 JSON，并通过退出码区分错误类别
- 受限 CLI 操作流程见 [CLI 访问边界](#cli-访问边界)
- Windows / macOS 目录版安装、配置文件位置、完整退出码契约见 [`lsm_cli/README.md`](lsm_cli/README.md)

## 系统架构

### 总体结构

```text
Browser / Browser Extension
        |
        v
React 19 + Vite + Axios
        |
        v
FastAPI
  |- Auth / Session
  |- Dashboard
  |- Inventory
  |- Reagent Orders
  |- Consumable Orders
  |- Announcements
  |- Event Stream
        |
        v
SQLite (WAL) + Redis + /static/

WeCom / WeChat KF
        |
        v
lsm_mcp -> python -m lsm_cli -> FastAPI API
```

### 后端特点

- 使用 `FastAPI` 暴露 API，开发模式下提供 Swagger/ReDoc。
- `SQLite` 在每个连接上都会显式开启 `PRAGMA journal_mode=WAL`。
- 数据库初始化由 `app/database.py` 编排，`app/db_bootstrap/` 负责 schema 补齐、结构绑定回填、性能索引、FTS 表、触发器和一致性检查。
- 全局中间件处理以下问题：
  - 请求日志与 `X-Request-ID`
  - 上传请求体积限制
  - 生产环境 HTTPS 跳转
  - Cookie 鉴权下的 CSRF Origin/Referer 校验
  - 安全响应头与 CSP/HSTS

### 前端特点

- 使用 `BrowserRouter` 管理路由。
- 登录态通过 HttpOnly Cookie 持有，Axios 统一开启 `withCredentials`。
- 页面采用懒加载，主要模块包括：
  - 仪表盘
  - 试剂订单
  - 耗材订单
  - 库存
  - 公共货架
  - 导入页
  - 结构检索
  - 设备管理
  - 用户管理
  - 公告管理
  - 操作日志

### 认证与会话

- 登录接口写入 Cookie，不依赖浏览器 `localStorage` 保存 token。
- 支持多设备登录与会话列表管理。
- 会话可按设备名称、IP 等信息追踪。
- 401 会统一触发前端登出与跳转。

## 前端本地存储

| Key | 用途 |
| --- | --- |
| `app-ui` | 主题、字体来源、仪表盘页签与模式偏好、公告已读/关闭、Bug 按钮隐藏 |
| `app-table` | 表格 `expandAll`、`fuzzySearch`、`matchMode`、列宽 |
| `app-auth-meta` | 设备 `id/name`、remembered user |
| `runtime-time-config` | 后端返回的展示时区和 UTC 偏移 |
| `auth-storage` | Zustand 登录态持久化，带 TTL |
| `sidebar-storage` | Zustand 侧栏状态持久化，带 TTL |
| `chemical_properties_cache` | 化学属性缓存，独立长 TTL |
| `cart_import_batch_latest` | 浏览器插件导入桥接批次，2 小时 TTL |

### 搜索与性能

- `inventory`、`reagent_order`、`consumable_order`、`users`、`chemical_name_map`、`log_timeline` 建有 SQLite FTS5 虚表。
- 名称、拼音、拼音首字母等字段会被索引，便于中文检索。
- 大量列表查询配套了状态、申请人、时间、公共货架等复合索引。

## 关键业务规则

这些规则直接影响系统正确性，开发和运维都应该了解。

### 1. SQLite 必须启用 WAL

这是并发读写的基础约束，项目在数据库连接层已强制设置。

### 2. 订单到库存采用 Copy 语义

试剂一键入库时会根据订单生成库存记录，但订单本身保留，用于审计和回溯。

### 3. 所有格式化输入在后端标准化

CAS 号等关键字段会在服务端清洗，避免由于大小写、空格、分隔符差异导致重复数据。

### 4. 数据写接口必须带权限控制

涉及写操作的接口需要校验当前用户身份，管理员能力与普通用户能力分离。

### 5. 归还与库存删除分流

普通删除不处理借用中库存。借用记录归还后剩余量为 0 时，可通过归还流程删除该库存并写入库存删除日志。

### 6. 错误反馈分层

- 输入校验错误应在表单字段旁展示
- toast 主要用于非字段级错误

### 7. 生产环境有额外约束

- 生产环境必须使用 `RS256`
- Cookie 场景下会启用更严格的 CSRF 与 HTTPS 策略
- 未配置 HTTPS 时，不应把 `ENV` 直接切到 `production`

## 目录结构

### 根目录

```text
.
├── app/                  # FastAPI 后端
├── frontend/             # React 前端
├── browser-extension/    # 浏览器插件，用于购物车导入等场景
├── docker/               # Dockerfile、Nginx、入口脚本
├── lsm_cli/              # 本地命令行客户端
├── lsm_mcp/              # 受控 MCP 工具服务
├── robot/                # 企业微信智能机器人与微信客服入口
├── static/               # 上传图片与静态文件运行目录
├── wiki/                 # VitePress 知识库源码
├── docker-compose.yml    # 一体化部署编排
├── pyproject.toml        # 后端依赖与工具配置
└── README.md
```

### 后端

```text
app/
├── main.py               # FastAPI 入口、中间件、路由装配
├── database.py           # SQLModel 引擎、WAL 与初始化编排
├── db_bootstrap/         # SQLite schema、索引、FTS 与一致性检查
├── api/                  # 路由层
├── core/                 # 配置、认证、常量、请求工具
├── models/               # SQLModel 数据模型
└── services/             # 业务服务
```

仪表盘聚合逻辑位于 `app/services/dashboard/`，覆盖汇总分发、item 构造、指标统计和通用 builder。

主要接口模块：

- `users.py`
- `user_sessions.py`
- `user_logs.py`
- `dashboard.py`
- `inventory.py`
- `reagent_orders.py`
- `consumable_orders.py`
- `reagent_brands.py`
- `announcements.py`
- `cart_sync.py`
- `events.py`
- `error_logs.py`
- `common_shelf.py`
- `chemical_name_map.py`

### 前端

```text
frontend/src/
├── api/                  # Axios API 封装
├── components/           # UI 组件、业务组件、结构检索与日志详情组件
├── hooks/                # 自定义 hooks
├── lib/                  # 工具、常量、校验、品牌选项与本地存储
├── pages/                # 页面级组件
└── store/                # Zustand 状态管理
```

仪表盘入口为 `frontend/src/pages/Dashboard.tsx`，辅助文件集中在 `frontend/src/pages/dashboard/`。

## 部署说明

### 方案一：Docker Compose

这是当前仓库最直接的部署方式。

包含的服务：

- `frontend`
- `backend`
- `redis`

步骤：

```bash
git clone <your-repo-url> LabStorageManager
cd LabStorageManager
Copy-Item .env.example .env
```

至少修改：

- `DEFAULT_ADMIN_PASSWORD`
- `CORS_ORIGINS`
- `ENV`

如果 Redis 仅监听 `127.0.0.1` 或 Compose 内网，可让 `REDIS_PASSWORD` 为空；Redis 对外监听或跨机器访问时必须设置强密码。

如果保持默认 `ALGORITHM=RS256`，首次启动前需要在 Compose 的持久化卷里生成 RSA 密钥：

```bash
docker compose run --rm --entrypoint sh backend -c \
  'mkdir -p /data/keys && \
   openssl genrsa -out /data/keys/private.pem 2048 && \
   openssl rsa -in /data/keys/private.pem -pubout -out /data/keys/public.pem'
```

后端启动时会把持久化密钥目录映射到应用内路径，并读取 `PRIVATE_KEY_PATH` 与 `PUBLIC_KEY_PATH`。

然后启动：

```bash
APP_PORT=80 docker compose up -d --build
```

检查服务：

```bash
docker compose ps
curl http://127.0.0.1:${APP_PORT:-80}/
curl http://127.0.0.1:${APP_PORT:-80}/health
```

说明：

- 前端镜像基于 `node:20-alpine` 构建，运行层是安装 Nginx 与 Brotli 模块的 Alpine 镜像。
- 后端镜像基于 `python:3.11-slim`，使用 `uvicorn` 启动。
- Compose 会把 Redis 地址注入为容器内部服务名 `redis`。
- Compose 的 `app_data` volume 挂载到容器 `/data`，默认保存 `/data/lab_inventory.db`、`/data/logs`、`/data/static` 和 `/data/keys`。

### 方案二：本地前后端分开

适合开发调试。

1. 本地启动 Redis（推荐）
2. 启动后端 `uvicorn`
3. 启动前端 `vite`
4. 前端通过 `CORS_ORIGINS` 与 API 基地址访问后端

### 方案三：生产静态前端 + pip 后端

适合服务器上由 Nginx 托管前端静态文件、后端由进程管理器启动的部署方式。

前端构建：

```bash
cd frontend
npm ci
npm run build
```

将 `frontend/dist` 放到 Nginx 站点根目录。浏览器插件需要单独设置 `browser-extension/.env` 后执行 `npm run build:extension`。

后端安装与启动：

```bash
python -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
poetry install --without dev,scripts --no-root
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

当前仓库根 `pyproject.toml` 使用非包模式，生产运行应按 Poetry 依赖清单安装后直接启动 ASGI 应用。

## 附属模块

### 浏览器插件

仓库包含 `browser-extension/`，用于浏览器侧导入或购物车同步相关场景。后端提供了 `/cart-import` 路由，会将入口跳转到前端页面。

`browser-extension/manifest.json` 和 `browser-extension/shared/generated-config.js` 是构建期文件，不提交到 Git。生产部署浏览器插件前，先准备插件构建配置，再运行：

```bash
npm run build:extension
```

### Agent skill、MCP 与机器人

Agent skill、`lsm_mcp/` 和 `robot/` 都应通过 `python -m lsm_cli` 或安装后的 `lsm` 命令进入系统，不直接访问数据库。企业微信智能机器人和微信客服入口位于 `robot/`，查询和借还流程都通过 MCP、CLI 与后端 API 完成。

### 公告图片与 `/static/`

- 上传目录是仓库运行时 `static/`，Compose 中对应 `/data/static`
- 公开访问路径默认挂载在 `/static/`
- 响应头附带缓存控制
- 图片安全头由后端统一补齐

## 故障排查

### 启动时报 `DEFAULT_ADMIN_PASSWORD must be set`

判断：
未设置默认管理员密码。

处理：
在本地运行配置中补充 `DEFAULT_ADMIN_PASSWORD` 后重启后端。

### 生产环境访问 `/docs` 为 404

判断：
生产模式默认关闭 API 文档。

处理：
确认 `ENV=development` 时再访问 `/docs`。

### 登录后立刻掉线或 Cookie 不生效

判断：

- `CORS_ORIGINS` 未正确配置
- 浏览器与后端地址不匹配
- 在无 HTTPS 的环境使用了 `production`
- 外层 HTTPS 代理部署时未启用 `TRUST_PROXY_HEADERS`

处理：

- 开发时设为 `ENV=development`
- 检查前端域名是否在 `CORS_ORIGINS` 中
- 生产 Compose 部署保持 `TRUST_PROXY_HEADERS=true`
- 确认浏览器实际请求携带 Cookie

### Redis 连不上

影响：
会话或限流相关能力可能异常，核心库存数据仍在 SQLite。

处理：

- 确认 `REDIS_HOST`、`REDIS_PORT`；Redis 对外监听时再确认 `REDIS_PASSWORD`
- 检查容器或本地 Redis 是否已启动

### 图片上传失败

检查以下几项：

- 文件类型是否在 `ALLOWED_IMAGE_TYPES`
- 请求体是否超过 `MAX_UPLOAD_REQUEST_SIZE_MB`
- 单图是否超过限制，或 `static/`、`/data/static` 目录无写权限

### 搜索结果异常或性能下降

检查以下几项：

- 数据库初始化是否完整执行
- FTS 虚表和触发器是否存在
- 是否误删了 SQLite 索引或数据库文件

## CLI 访问边界

CLI 面向脚本化操作提供稳定命令面。脚本化操作应通过 `python -m lsm_cli` 或安装后的 `lsm` 命令与系统交互，并遵守当前 CLI 已暴露的能力范围。

### 适用场景

- 需要通过 CLI 登录、查询库存、查看借用状态
- 需要通过 CLI 创建或更新试剂订单、确认到货、一键入库
- 需要通过 CLI 创建、更新或完成耗材订单
- 需要通过 CLI 查询常用货架或 CAS 主数据
- 需要让 Agent skill、MCP 或智能机器人复用稳定命令面
- 需要避免 raw HTTP、数据库直连、直接导入后端模块

### 硬限制

- 只允许调用 `python -m lsm_cli` 及其已暴露子命令
- 禁止使用 `curl`、`Invoke-RestMethod`、`requests`、`httpx`、数据库直连或伪造本地 token
- 写操作前必须先通过 CLI 查询拿到准确 ID；禁止猜测 ID
- 目标不唯一、字段含义不清或单位/数量有歧义时，必须先确认，不能“先试一下”
- 登录只允许普通用户账号；推荐 `--password-stdin`
- 不支持 `delete`、`export`、文件上传、用户管理、会话管理、密码修改、头像修改

### 推荐执行流程

1. 用 `python -m lsm_cli --help` 确认目标能力是否存在。
2. 需要认证时，用 `auth login` 登录，再用 `auth whoami` 校验身份。
3. 对写操作先用 `list`、`get`、`cas`、`code`、`my-*` 等读命令定位准确 ID。
4. 再执行真正的写操作，并再次核对目标 ID、动作和输入值。
5. 如果命令失败，优先按退出码处理；不要切换到 HTTP 或数据库旁路。

### 参考入口

- CLI 说明：[`lsm_cli/README.md`](lsm_cli/README.md)
- 后端 CLI 访问控制：[`app/main.py`](app/main.py)

## 许可证

本项目使用 Apache License 2.0。详见 [LICENSE](LICENSE)。
