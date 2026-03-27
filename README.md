# LabStorageManager - 实验室库存管理系统 (LIMS)

<p align="center">
  <img src="https://img.shields.io/badge/Python-3.14+-blue?style=flat&logo=python" alt="Python">
  <img src="https://img.shields.io/badge/FastAPI-0.135+-blue?style=flat&logo=fastapi" alt="FastAPI">
  <img src="https://img.shields.io/badge/React-19.2+-blue?style=flat&logo=react" alt="React">
  <img src="https://img.shields.io/badge/TypeScript-5.9+-blue?style=flat&logo=typescript" alt="TypeScript">
  <img src="https://img.shields.io/badge/Node.js-24+-blue?style=flat&logo=node.js" alt="Node.js">
  <img src="https://img.shields.io/badge/SQLite-WAL-green?style=flat&logo=sqlite" alt="SQLite">
  <img src="https://img.shields.io/badge/License-Apache%202.0-green?style=flat" alt="License">
  <a href="https://zread.ai/hzb666/LabStorageManager" target="_blank"><img src="https://img.shields.io/badge/Ask_Zread-_.svg?style=flat&color=00b0aa&labelColor=565656&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTQuOTYxNTYgMS42MDAxSDIuMjQxNTZDMS44ODgxIDEuNjAwMSAxLjYwMTU2IDEuODg2NjQgMS42MDE1NiAyLjI0MDFWNC45NjAxQzEuNjAxNTYgNS4zMTM1NiAxLjg4ODEgNS42MDAxIDIuMjQxNTYgNS42MDAxSDQuOTYxNTZDNS4zMTUwMiA1LjYwMDEgNS42MDE1NiA1LjMxMzU2IDUuNjAxNTYgNC45NjAxVjIuMjQwMUM1LjYwMTU2IDEuODg2NjQgNS4zMTUwMiAxLjYwMDEgNC45NjE1NiAxLjYwMDFaIiBmaWxsPSIjZmZmIi8%2BCjxwYXRoIGQ9Ik00Ljk2MTU2IDEwLjM5OTlIMi4yNDE1NkMxLjg4ODEgMTAuMzk5OSAxLjYwMTU2IDEwLjY4NjQgMS42MDE1NiAxMS4wMzk5VjEzLjc1OTlDMS42MDE1NiAxNC4xMTM0IDEuODg4MSAxNC4zOTk5IDIuMjQxNTYgMTQuMzk5OUg0Ljk2MTU2QzUuMzE1MDIgMTQuMzk5OSA1LjYwMTU2IDE0LjExMzQgNS42MDE1NiAxMy43NTk5VjExLjAzOTlDNS42MDE1NiAxMC42ODY0IDUuMzE1MDIgMTAuMzk5OSA0Ljk2MTU2IDEwLjM5OTlaIiBmaWxsPSIjZmZmIi8%2BCjxwYXRoIGQ9Ik0xMy43NTg0IDEuNjAwMUgxMS4wMzg0QzEwLjY4NSAxLjYwMDEgMTAuMzk4NCAxLjg4NjY0IDEwLjM5ODQgMi4yNDAxVjQuOTYwMUMxMC4zOTg0IDUuMzEzNTYgMTAuNjg1IDUuNjAwMSAxMS4wMzg0IDUuNjAwMUgxMy43NTg0QzE0LjExMTkgNS42MDAxIDE0LjM5ODQgNS4zMTM1NiAxNC4zOTg0IDQuOTYwMVYyLjI0MDFDMTQuMzk4NCAxLjg4NjY0IDE0LjExMTkgMS42MDAxIDEzLjc1ODQgMS42MDAxWiIgZmlsbD0iI2ZmZiIvPgo8cGF0aCBkPSJNNCAxMkwxMiA0TDQgMTJaIiBmaWxsPSIjZmZmIi8%2BCjxwYXRoIGQ9Ik00IDEyTDEyIDQiIHN0cm9rZT0iI2ZmZiIgc3Ryb2tlLXdpZHRoPSIxLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgo8L3N2Zz4K&logoColor=ffffff" alt="zread"/></a>
<img src="https://img.shields.io/badge/Ask_Deepwiki-_.svg?style=flat&color=00b0aa&labelColor=565656&logo=data:image/svg+xml;charset=utf-8;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0NjAiIGhlaWdodD0iNTAwIiBjbGFzcz0ic2l6ZS00IHRyYW5zZm9ybSB0cmFuc2l0aW9uLXRyYW5zZm9ybSBkdXJhdGlvbi03MDAgZ3JvdXAtaG92ZXI6cm90YXRlLTE4MCBbJmFtcDtfcGF0aF06c3Ryb2tlLTAiIHZpZXdCb3g9IjExMCAxMTAgNDYwIDUwMCI+PHBhdGggZD0iTTQxOSAzMzJxMTYtNyAzMiAwbDI1IDE1IDMgMSAzIDEgMy0xIDMtMSA1MS0yOXE2LTMgNi0xMXYtNThxMC04LTYtMTFsLTUxLTI5cS02LTMtMTIgMGwtNTEgMjl2MWwtMiAxLTIgMnYxbC0xIDJ2MWwtMSAzdjI5YTMyIDMyIDAgMCAxLTQ4IDI4bC0yNS0xNS0zLTEtMy0xLTMgMS0zIDEtNTEgMjlxLTUgMy02IDExdjU4cTEgOCA2IDExbDUxIDI5IDMgMSAzIDEgMy0xIDMtMSAyNS0xNWEzMiAzMiAwIDAgMSA0OCAyOHYyOWwxIDN2MWwxIDJ2MWwyIDIgMiAyIDUxIDI5IDYgMiA2LTIgNTEtMjlxNi0zIDYtMTF2LTU4cTAtOC02LTExbC01MS0yOS0zLTEtMy0xLTMgMS0zIDEtMjUgMTVhMzIgMzIgMCAwIDEtNDgtMjhxMS0xOCAxNi0yOCIgc3R5bGU9ImZpbGw6IzIxYzE5YSIvPjxwYXRoIGQ9Im0xNDEgMzE4IDUxIDI5IDYgMiA2LTIgNTEtMjl2LTFsMi0xIDItMnYtMWwxLTJ2LTFsMS0zdi0yOWEzMiAzMiAwIDAgMSA0OC0yOGwyNSAxNSAzIDEgMyAxIDMtMSAzLTEgNTEtMjlxNi0zIDYtMTF2LTU4cTAtOC02LTExbC01MS0yOXEtNi0zLTEyIDBsLTUxIDI5LTIgMmgtMWwtMSAydjFsLTEgMnYxbC0xIDN2MjlhMzIgMzIgMCAwIDEtNDggMjhsLTI1LTE1LTMtMS0zLTEtMyAxLTMgMS01MSAyOXEtNiAzLTYgMTF2NThxMCA4IDYgMTEiIHN0eWxlPSJmaWxsOiMzOTY5Y2EiLz48cGF0aCBkPSJtMzk3IDQ4NC01MS0yOS0zLTEtMy0xLTMgMS0zIDEtMjUgMTVhMzIgMzIgMCAwIDEtNDgtMjh2LTI5bC0xLTN2LTFsLTEtMnYtMWwtMi0yLTItMXYtMWwtNTEtMjlxLTYtMy0xMiAwbC01MSAyOXEtNiAzLTYgMTF2NThxMCA4IDYgMTFsNTEgMjkgMyAxIDMgMSAzLTEgMy0xIDI1LTE1YTMyIDMyIDAgMCAxIDQ4IDI4djI5bDEgM3YxbDEgMnYxbDIgMiAyIDIgNTEgMjkgNiAyIDYtMiA1MS0yOXE2LTMgNi0xMXYtNThxMC04LTYtMTEiIHN0eWxlPSJmaWxsOiMwMjk0ZGUiLz48L3N2Zz4=" alt="deepwiki"/>
</p>

面向实验室场景的试剂与耗材管理系统，覆盖申购、审批、到货、入库、借用、归还、公告、设备会话管理等完整流程。项目采用 FastAPI + React 前后端分离架构，后端以 SQLite WAL 模式为核心存储，前端基于 React 19 和 Vite 8 构建，适合单实验室或中小团队快速部署。

## 目录

- [项目简介](#项目简介)
- [核心能力](#核心能力)
- [技术栈](#技术栈)
- [快速开始](#快速开始)
- [环境变量](#环境变量)
- [常用命令](#常用命令)
- [系统架构](#系统架构)
- [前端本地存储](#前端本地存储)
- [关键业务规则](#关键业务规则)
- [目录结构](#目录结构)
- [部署说明](#部署说明)
- [附属模块](#附属模块)
- [故障排查](#故障排查)
- [开发约定](#开发约定)
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
- 中文拼音检索与 FTS 搜索
  名称、分类、品牌、位置等字段会预计算拼音，并结合 SQLite FTS5 提供搜索能力。
- 库存借还闭环
  支持借出、归还、借用历史、当前借用人、临时保管人等字段。
- 公共货架与常用试剂
  支持公共库存场景，便于管理共享样品或常备试剂。
- 用户、设备、会话治理
  支持 HttpOnly Cookie 登录、设备列表、批量注销、IP/设备数量限制。
- 公告与图片上传
  公告支持图片，图片文件落地到 `static/`，并受尺寸、类型、上传频率控制。
- 部署简单
  内置 Docker Compose，可快速拉起 `frontend + backend + redis`。

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 后端 | FastAPI, SQLModel, SQLite, Redis, python-jose, bcrypt, Pillow, pypinyin |
| 前端 | React 19, TypeScript 5.9, Vite 8, React Router 7, Zustand, React Hook Form, Valibot |
| UI | Radix UI, Tailwind CSS 4, Lucide React, Framer Motion |
| 表格与数据 | TanStack Table 8, TanStack Virtual, Axios |
| 化学相关 | RDKit（前端分子结构渲染） |
| 构建与校验 | Poetry, npm, ruff, ESLint, TypeScript build |
| 部署 | Docker Compose, Nginx, Uvicorn |

## 快速开始

### 1. 前置要求

建议本地环境：

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

如果你使用 `pip`：

```bash
python -m venv .venv

# Windows PowerShell
.venv\Scripts\Activate.ps1

# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
```

### 4. 配置前端环境

```bash
cd frontend
npm install
cd ..
```

### 5. 创建环境变量文件

```bash
# Windows PowerShell
Copy-Item .env.example .env

# macOS / Linux
cp .env.example .env
```

最少需要确认这些字段：

| 变量 | 说明 |
| --- | --- |
| `ENV` | 本地开发建议 `development` |
| `CORS_ORIGINS` | 前端地址白名单，开发时通常为 `http://localhost:5173` |
| `DEFAULT_ADMIN_PASSWORD` | 必填；后端首次启动会用它初始化管理员 |
| `ALGORITHM` | 默认 `RS256` |
| `DATABASE_URL` | 默认 SQLite 文件 |

开发环境建议：

- 将 `ENV=development`
- 把 `CORS_ORIGINS` 改成你的前端地址
- 首次启动前设置 `DEFAULT_ADMIN_PASSWORD`

说明：

- 当 `ENV=development` 且本地还没有 RSA 密钥时，后端可自动生成临时密钥对。
- 当 `ENV=production` 时，`ALGORITHM` 必须为 `RS256`，并且 `.keys/private.pem` / `.keys/public.pem` 必须可用。

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

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | `sqlite:///./lab_inventory.db` | SQLite 数据库连接串 |
| `TRUST_PROXY_HEADERS` | `false` | 是否信任反向代理头 |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `10080` | 登录态默认 7 天 |
| `SESSION_EXPIRE_HOURS` | `72` | 会话有效期 |
| `MAX_IP_PER_USER` | `5` | 每个用户允许的最大 IP 数 |
| `MAX_DEVICE_PER_USER` | `10` | 每个用户允许的最大设备数 |
| `REDIS_HOST` | `127.0.0.1` | Redis 主机 |
| `REDIS_PORT` | `6379` | Redis 端口 |
| `REDIS_DB` | `1` | Redis 逻辑库 |
| `REDIS_KEY_PREFIX` | `lsm` | Redis key 前缀 |

### 上传与图片

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `MAX_FILE_SIZE_MB` | `10` | 单文件体积限制 |
| `MAX_UPLOAD_REQUEST_SIZE_MB` | `12` | 单次请求总上传限制 |
| `ALLOWED_IMAGE_TYPES` | `image/jpeg,image/png,image/webp` | 允许的 MIME 类型 |
| `MAX_IMAGE_WIDTH` | `800` | 最大宽度 |
| `MAX_IMAGE_HEIGHT` | `800` | 最大高度 |
| `MAX_IMAGE_SIZE_KB` | `100` | 压缩后图片大小上限 |
| `UPLOAD_RATE_LIMIT_COUNT` | `10` | 上传限流次数 |
| `UPLOAD_RATE_LIMIT_WINDOW_SECONDS` | `300` | 上传限流时间窗口 |

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
  |- Inventory
  |- Reagent Orders
  |- Consumable Orders
  |- Announcements
  |- Event Stream
        |
        v
SQLite (WAL) + Redis + static/
```

### 后端特点

- 使用 `FastAPI` 暴露 API，开发模式下提供 Swagger/ReDoc。
- `SQLite` 在每个连接上都会显式开启 `PRAGMA journal_mode=WAL`。
- 数据库初始化时会自动创建表、性能索引、FTS 表与触发器，并检查 schema 一致性。
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
| `app-ui` | 主题、字体来源、Dashboard 页签、公告已读/关闭、Bug 按钮隐藏 |
| `app-table` | 表格 `expandAll`、`fuzzySearch`、列宽 |
| `app-auth-meta` | 设备 `id/name`、remembered user |
| `auth-storage` | Zustand 登录态持久化，带 TTL |
| `sidebar-storage` | Zustand 侧栏状态持久化，带 TTL |
| `chemical_properties_cache` | 化学属性缓存，独立长 TTL |
| `cart_import_batch_latest` | 扩展导入桥接批次，2 小时 TTL |

### 搜索与性能

- `inventory`、`reagent_order`、`consumable_order`、`users` 建有 SQLite FTS5 虚表。
- 名称、拼音、拼音首字母等字段会被索引，便于中文检索。
- 大量列表查询配套了状态、申请人、时间、公共货架等复合索引。

## 关键业务规则

这些规则直接影响系统正确性，开发和运维都应该了解。

### 1. SQLite 必须启用 WAL

这是并发读写的基础约束，项目在数据库连接层已强制设置。

### 2. 订单到库存是 Copy，不是 Move

试剂一键入库时会根据订单生成库存记录，但订单本身保留，用于审计和回溯。

### 3. 所有格式化输入在后端标准化

CAS 号等关键字段会在服务端清洗，避免由于大小写、空格、分隔符差异导致重复数据。

### 4. 数据写接口必须带权限控制

涉及写操作的接口需要校验当前用户身份，管理员能力与普通用户能力分离。

### 5. 错误反馈分层

- 输入校验错误应在表单字段旁展示
- toast 主要用于非字段级错误

### 6. 生产环境有额外约束

- 生产环境必须使用 `RS256`
- Cookie 场景下会启用更严格的 CSRF 与 HTTPS 策略
- 未配置 HTTPS 时，不应把 `ENV` 直接切到 `production`

## 目录结构

### 根目录

```text
.
├── app/                  # FastAPI 后端
├── frontend/             # React 前端
├── browser-extension/    # 浏览器扩展，用于购物车导入等场景
├── docker/               # Dockerfile、Nginx、入口脚本
├── static/               # 图片与静态文件
├── docs/                 # 项目文档
├── tests/                # 后端测试目录
├── docker-compose.yml    # 一体化部署编排
├── pyproject.toml        # 后端依赖与工具配置
├── requirements.txt      # pip 安装入口
└── README.md
```

### 后端

```text
app/
├── main.py               # FastAPI 入口、中间件、路由装配
├── database.py           # SQLModel 引擎、WAL、FTS、索引初始化
├── api/                  # 路由层
├── core/                 # 配置、认证、常量、请求工具
├── models/               # SQLModel 数据模型
└── services/             # 业务服务
```

主要接口模块：

- `users.py`
- `user_sessions.py`
- `user_logs.py`
- `inventory.py`
- `reagent_orders.py`
- `consumable_orders.py`
- `announcements.py`
- `cart_sync.py`
- `events.py`
- `error_logs.py`

### 前端

```text
frontend/src/
├── api/                  # Axios API 封装
├── components/           # UI 组件
├── hooks/                # 自定义 hooks
├── lib/                  # 工具、常量、校验
├── pages/                # 页面级组件
└── store/                # Zustand 状态管理
```

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
cp .env.example .env
```

至少修改：

- `DEFAULT_ADMIN_PASSWORD`
- `CORS_ORIGINS`
- `REDIS_PASSWORD`
- `ENV`

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

- 前端镜像基于 `node:20-alpine` 构建，运行层是 `nginx:1.27-alpine`。
- 后端镜像基于 `python:3.11-slim`，使用 `uvicorn` 启动。
- Compose 会把 Redis 地址注入为容器内部服务名 `redis`。

### 方案二：本地前后端分开跑

适合开发调试。

1. 本地启动 Redis（推荐）
2. 启动后端 `uvicorn`
3. 启动前端 `vite`
4. 前端通过 `CORS_ORIGINS` 与 API 基地址访问后端

## 附属模块

### 浏览器扩展

仓库包含 `browser-extension/`，用于浏览器侧导入或购物车同步相关场景。后端提供了 `/cart-import` 路由，会将入口跳转到前端页面。

### 公告图片与静态资源

- 静态资源默认挂载在 `/static`
- 响应头附带缓存控制
- 图片安全头由后端统一补齐

## 故障排查

### 启动时报 `DEFAULT_ADMIN_PASSWORD must be set`

原因：
未设置默认管理员密码。

处理：
在 `.env` 中补充 `DEFAULT_ADMIN_PASSWORD` 后重启后端。

### 生产环境访问 `/docs` 为 404

原因：
生产模式默认关闭 API 文档。

处理：
确认 `ENV=development` 时再访问 `/docs`。

### 登录后立刻掉线或 Cookie 不生效

原因：

- `CORS_ORIGINS` 未正确配置
- 浏览器与后端地址不匹配
- 在无 HTTPS 的环境使用了 `production`

处理：

- 开发时设为 `ENV=development`
- 检查前端域名是否在 `CORS_ORIGINS` 中
- 确认浏览器实际请求携带 Cookie

### Redis 连不上

影响：
会话或限流相关能力可能异常，核心库存数据仍在 SQLite。

处理：

- 确认 `REDIS_HOST`、`REDIS_PORT`、`REDIS_PASSWORD`
- 检查容器或本地 Redis 是否已启动

### 图片上传失败

检查以下几项：

- 文件类型是否在 `ALLOWED_IMAGE_TYPES`
- 请求体是否超过 `MAX_UPLOAD_REQUEST_SIZE_MB`
- 单图是否超过限制或服务器目录无写权限

### 搜索结果异常或性能下降

检查以下几项：

- 数据库初始化是否完整执行
- FTS 虚表和触发器是否存在
- 是否误删了 SQLite 索引或数据库文件

## 许可证

本项目使用 Apache License 2.0。详见 [LICENSE](LICENSE)。
