# LabStorageManager - 实验室库存管理系统 (LIMS)

<p align="center">
  <img src="https://img.shields.io/badge/Python-3.11+-blue?style=flat&logo=python" alt="Python">
  <img src="https://img.shields.io/badge/FastAPI-0.109+-blue?style=flat&logo=fastapi" alt="FastAPI">
  <img src="https://img.shields.io/badge/React-19+-blue?style=flat&logo=react" alt="React">
  <img src="https://img.shields.io/badge/TypeScript-5.9+-blue?style=flat&logo=typescript" alt="TypeScript">
  <img src="https://img.shields.io/badge/SQLite-WAL-green?style=flat&logo=sqlite" alt="SQLite">
  <img src="https://img.shields.io/badge/License-Apache%202.0-green?style=flat" alt="License">
</p>

面向实验室场景的试剂/耗材全生命周期管理系统，支持试剂（有 CAS 号）和耗材的采购、入库、借用、归还等核心流程。

## 目录

- [项目概述](#项目概述)
  - [背景与目标](#背景与目标)
  - [核心特性](#核心特性)
  - [系统架构](#系统架构)
- [技术栈](#技术栈)
  - [后端技术](#后端技术)
  - [前端技术](#前端技术)
- [前置要求](#前置要求)
- [快速开始](#快速开始)
  - [克隆项目](#1-克隆项目)
  - [后端配置](#2-后端配置)
  - [前端配置](#3-前端配置)
  - [环境变量配置](#4-环境变量配置)
  - [启动服务](#5-启动服务)
- [项目结构](#项目结构)
  - [后端目录结构](#后端目录结构)
  - [前端目录结构](#前端目录结构)
- [架构设计](#架构设计)
  - [请求流程](#请求流程)
  - [数据模型](#数据模型)
  - [核心业务逻辑](#核心业务逻辑)
- [环境变量参考](#环境变量参考)
  - [必需变量](#必需变量)
  - [可选变量](#可选变量)
  - [文件上传配置](#文件上传配置)
  - [会话配置](#会话配置)
- [核心 API 参考](#核心-api-参考)
  - [认证 API](#认证-api)
  - [用户管理 API](#用户管理-api)
  - [库存 API](#库存-api)
  - [试剂订单 API](#试剂订单-api)
  - [耗材订单 API](#耗材订单-api)
  - [会话管理 API](#会话管理-api)
  - [公告 API](#公告-api)
- [功能操作指南](#功能操作指南)
  - [角色与权限](#角色与权限)
  - [试剂订购流程](#试剂订购流程)
  - [耗材订购流程](#耗材订购流程)
  - [库存借用流程](#库存借用流程)
- [代码规范](#代码规范)
  - [Python 规范](#python-规范)
  - [TypeScript/React 规范](#typescriptreact-规范)
- [验证命令](#验证命令)
- [部署指南](#部署指南)
  - [生产环境部署](#生产环境部署)
  - [数据库备份](#数据库备份)
- [故障排除](#故障排除)
- [开发工作流](#开发工作流)
- [许可证](#许可证)

---

## 项目概述

### 背景与目标

实验室试剂和耗材的管理一直是科研机构和企业研发中心面临的重要挑战。传统的人工管理模式存在诸多问题：库存信息不透明、重复采购造成浪费、借用记录难以追溯、盘点工作耗时耗力等。

LabStorageManager 是一个面向实验室场景的库存管理系统，旨在通过数字化手段解决上述问题。系统采用现代化的技术架构，实现试剂和耗材的全生命周期管理，从采购申请到入库、从借用归还到盘点审计，每个环节都有清晰的记录和可追溯的流程。

### 核心特性

| 特性 | 说明 |
|------|------|
| **双轨制管理** | 试剂（有 CAS 号）和耗材（无 CAS 号）采用不同的管理流程，兼顾专业性和便捷性 |
| **CAS 号防重** | 自动检索库存中相同 CAS 号的剩余总量，在采购申请阶段即可预警，避免重复采购 |
| **WAL 模式** | SQLite 数据库启用 WAL（Write-Ahead Logging）模式，支持高并发读写 |
| **一键入库** | 订单到库存的自动化流转，审批通过后点一键即可完成入库，无需重复录入 |
| **图片管理** | 试剂/样品的图片自动压缩至 100KB 以下，存入文件系统，数据库仅存储 URL |
| **暗黑模式** | 完整的暗色主题支持，满足不同光照环境下的使用需求 |
| **服务端分页** | 大数据量场景下采用服务端分页，保证界面响应速度 |
| **搜索缓存** | 基于内存的搜索结果缓存（10秒 TTL），加速高频查询 |
| **拼音排序** | 预计算拼音字段，支持按中文名称/分类/品牌/位置拼音排序 |
| **剩余百分比** | 自动计算并存储 remaining_percent = remaining_quantity / initial_quantity |
| **多角色支持** | 支持 admin、user、public 三种角色 |
| **会话管理** | 支持多设备登录、设备踢出、IP 限制 |
| **登录限流** | 基于 Redis 的登录限流（5 次/5 分钟） |

### 系统架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Browser                                   │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐    │
│  │Dashboard│  │Inventory│  │ Orders  │  │ Import  │  │ Admin   │    │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘    │
└───────┼────────────┼────────────┼────────────┼────────────┼─────────┘
        │            │            │            │            │
        └────────────┴────────────┼────────────┴────────────┘
                                  │
                           ┌──────▼───────┐
                           │   React 19   │
                           │ + TypeScript │
                           │ + Shadcn/UI  │
                           └──────┬───────┘
                                  │
                           ┌──────▼───────┐
                           │  Axios API   │
                           │  Client      │
                           └──────┬───────┘
                                  │
┌─────────────────────────────────▼─────────────────────────────────┐
│                              FastAPI                              │
│  ┌─────────┐   ┌─────────┐            ┌─────────┐  ┌─────────┐    │
│  │  Auth   │   │ Router  │            │ Services│  │  Core   │    │
│  │ (JWT)   │   │         │            │         │  │         │    │
│  │ RS256   │   │         │            │         │  │         │    │
│  └────┬────┘   └────┬────┘            └────┬────┘  └────┬────┘    │
│       │             │                      │            │         │
└───────┼─────────────┼──────────────────────┼────────────┼─────────┘
        │             │                      │            │
┌───────▼─────────────▼──────────────────────▼────────────▼─────────┐
│                              Database                             │
│         ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│         │   SQLite    │  │    Redis    │  │  FileSystem │         │
│         │  (WAL Mode) │  │   (Cache)   │  │  (Images)   │         │
│         └─────────────┘  └─────────────┘  └─────────────┘         │
└───────────────────────────────────────────────────────────────────┘
```

---

## 技术栈

### 后端技术

| 技术 | 版本 | 说明 |
|------|------|------|
| FastAPI | 0.109+ | 异步高性能 Web 框架 |
| SQLModel | 0.0.37+ | 类型安全的数据库 ORM |
| SQLite | - | 轻量级嵌入式数据库（WAL 模式） |
| python-jose | 3.3+ | JWT 认证（RS256/HS256） |
| bcrypt | 3.2+ | 密码加密 |
| Pillow | 11.0+ | Python 图像处理 |
| pandas | 2.1+ | 数据处理 |
| pydantic | 2.5+ | 数据验证 |
| pypinyin | 0.55+ | 中文转拼音 |
| ruff | - | Python Lint |

### 前端技术

| 技术 | 版本 | 说明 |
|------|------|------|
| React | 19+ | 声明式 UI 库 |
| TypeScript | 5.9+ | 带类型检查的 JavaScript |
| React Router DOM | 7+ | 路由管理 |
| TanStack Table | 8+ | 功能强大的数据表格 |
| TanStack Virtual | 3+ | 虚拟滚动 |
| React Hook Form | 7+ | 表单管理 |
| Valibot | 1+ | 表单验证 |
| Zustand | 5+ | 轻量级状态管理 |
| Radix UI | - | 无样式 UI 组件库 |
| Tailwind CSS | 4+ | 样式框架 |
| Vite | 7+ | 前端构建工具 |

---

## 前置要求

| 软件 | 版本要求 | 说明 |
|------|----------|------|
| Python | 3.11+ | 后端运行环境 |
| Node.js | 18+ | 前端运行环境 |
| npm | 9+ | Node.js 包管理器 |
| Redis | 6.0+ | 可选，用于登录限流和会话缓存 |

---

## 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/your-repo/LabStorageManager.git
cd LabStorageManager
```

### 2. 后端配置

#### 2.1 创建虚拟环境（推荐）

```bash
# Windows PowerShell
python -m venv venv
venv\Scripts\activate

# Linux / macOS
python3 -m venv venv
source venv/bin/activate
```

#### 2.2 安装 Python 依赖

```bash
# 使用 Poetry（推荐）
poetry install

# 或使用 pip
pip install -r requirements.txt
```

### 3. 前端配置

```bash
cd frontend
npm install
```

### 4. 环境变量配置

```bash
# 复制环境变量示例文件
# Windows
copy .env.example .env

# Linux / macOS
cp .env.example .env
```

编辑 `.env` 文件，配置必要的环境变量：

```bash
# 必需配置
SECRET_KEY=your-secret-key-here-change-in-production
DEBUG=true
ENV=development

# 必须设置默认管理员密码
DEFAULT_ADMIN_USERNAME=admin
DEFAULT_ADMIN_PASSWORD=your-secure-password
DEFAULT_ADMIN_FULL_NAME=系统管理员
```

### 5. 启动服务

#### 5.1 启动后端

```bash
# 激活虚拟环境（如果尚未激活）
# Windows
venv\Scripts\activate
# Linux / macOS
source venv/bin/activate

# 启动后端服务
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

后端服务启动后，可访问：
- API 文档：http://localhost:8000/docs
- ReDoc 文档：http://localhost:8000/redoc

> **注意**: 首次启动时，系统会自动创建默认管理员账号（用户名：`admin`，密码：你设置的 `DEFAULT_ADMIN_PASSWORD`）

#### 5.2 启动前端

```bash
# 在新的终端中执行
cd frontend
npm run dev
```

前端服务启动后，可访问：http://localhost:5173

---

## 项目结构

### 后端目录结构

```
app/
├── __init__.py                  # 包初始化
├── main.py                      # FastAPI 应用入口
├── database.py                  # SQLModel 数据库配置 + WAL 模式
├── api/                        # API 路由
│   ├── __init__.py
│   ├── deps.py                 # 依赖注入
│   ├── users.py                # 用户 CRUD + 认证
│   ├── user_sessions.py        # 会话管理
│   ├── user_logs.py            # 操作日志
│   ├── reagent_orders.py       # 试剂订单
│   ├── consumable_orders.py    # 耗材订单
│   ├── inventory.py             # 库存管理
│   ├── inventory_extended_routes.py # 库存扩展路由
│   ├── reagent_orders_workflow.py # 试剂订单工作流
│   ├── announcements.py        # 公告管理
│   ├── error_logs.py           # 错误日志
│   └── cart_sync.py            # 购物车同步
├── core/                       # 核心功能模块
│   ├── __init__.py
│   ├── auth.py                 # JWT 认证 + 会话管理
│   ├── config.py               # 应用配置 (Pydantic Settings)
│   ├── redis.py                # Redis 缓存客户端
│   ├── banner.py               # 启动横幅
│   └── time_utils.py           # 时间工具
├── models/                     # SQLModel 数据模型
│   ├── __init__.py             # 模型导出
│   ├── base.py                 # 基础响应模型
│   ├── user.py                 # 用户模型 + UserRole 枚举
│   ├── user_session.py         # 用户会话模型
│   ├── reagent_order.py        # 试剂订单模型
│   ├── consumable_order.py     # 耗材订单模型
│   ├── inventory.py             # 库存模型 + BorrowLog
│   └── announcement.py          # 公告模型
└── services/                   # 业务逻辑服务
    ├── __init__.py
    ├── api_utils.py            # API 工具
    ├── cas_utils.py            # CAS 号标准化
    ├── chemical_info.py        # 化学信息查询
    ├── error_logger.py         # 错误日志
    ├── excel_service.py        # Excel 导入/导出
    ├── image_service.py        # 图片压缩
    ├── internal_code.py        # 内部编码生成
    ├── pinyin_utils.py         # 中文转拼音
    ├── session_service.py      # 会话服务
    ├── spec_utils.py          # 规格解析
    ├── sql_utils.py           # SQL 工具
    ├── user_service.py        # 用户服务
    └── user_utils.py          # 用户工具
```

### 前端目录结构

```
frontend/src/
├── main.tsx                     # React 入口
├── App.tsx                      # 根组件 + 路由配置
├── index.css                    # 全局样式 + Tailwind
├── fontLoader.ts                # 字体加载
├── api/                         # API 客户端
│   └── client.ts                # Axios 实例 + API 函数
├── assets/                      # 静态资源
│   └── react.svg
├── components/                  # React 组件
│   ├── AnnouncementBanner.tsx   # 公告横幅
│   ├── AnnouncementButton.tsx   # 公告按钮
│   ├── AnnouncementDetail.tsx   # 公告详情
│   ├── BaseForm.tsx             # 基础表单
│   ├── BorrowDialog.tsx         # 借用对话框
│   ├── BugReportButton.tsx      # Bug 反馈按钮
│   ├── bugReportButtonStorage.ts
│   ├── ConsumableOrderExpandedRow.tsx # 耗材订单展开行
│   ├── ErrorBoundary.tsx        # 错误边界
│   ├── ReagentOrderExpandedRow.tsx # 试剂订单展开行
│   ├── SidebarLogo.tsx          # 侧边栏 Logo
│   ├── TableActionButtons.tsx   # 表格操作按钮
│   ├── UserEditDialog.tsx       # 用户编辑对话框
│   └── ui/                      # UI 组件库
│       ├── AutoComplete.tsx
│       ├── Avatar.tsx
│       ├── Button.tsx
│       ├── Card.tsx
│       ├── Checkbox.tsx
│       ├── DataTable.tsx
│       ├── Dialog.tsx
│       ├── FilterTable.tsx
│       ├── FormField.tsx
│       ├── HazardousIcon.tsx
│       ├── HighlightText.tsx
│       ├── Input.tsx
│       ├── Label.tsx
│       ├── LoadingButton.tsx
│       ├── MoleculeStructure.tsx
│       ├── NoteDisplay.tsx
│       ├── Pagination.tsx
│       ├── PasswordInput.tsx
│       ├── QuantityIndicator.tsx
│       ├── RadioGroup.tsx
│       ├── Select.tsx
│       ├── Separator.tsx
│       ├── StatusBadge.tsx
│       ├── TableFilters.tsx
│       ├── Tabs.tsx
│       ├── Textarea.tsx
│       ├── Toast.tsx
│       └── Tooltip.tsx
├── hooks/                       # 自定义 Hooks
│   ├── useDialogState.tsx
│   ├── useErrorLogger.tsx
│   ├── useFormModal.tsx
│   ├── useMobile.tsx
│   ├── useRememberedUser.ts
│   ├── useTableState.tsx
│   ├── useTableUrlState.ts
│   └── useTheme.ts
├── lib/                         # 工具函数
│   ├── badgeConstants.ts
│   ├── constants.ts             # 常量定义（状态映射）
│   ├── dashboardUtils.tsx
│   ├── deviceId.ts
│   ├── formConfigs.tsx
│   ├── inputConfigs.ts
│   ├── options.ts
│   ├── tableConfigs.tsx
│   ├── toast.ts
│   ├── utils.ts
│   └── validationSchemas.ts
├── pages/                       # 页面组件
│   ├── AdminUsers.tsx           # 用户管理
│   ├── AnnouncementManagement.tsx # 公告管理
│   ├── CommonShelf.tsx          # 常用货架
│   ├── ConsumableOrders.tsx     # 耗材订单
│   ├── Dashboard.tsx           # 仪表盘
│   ├── DeviceManagement.tsx     # 设备管理
│   ├── Import.tsx               # 数据导入
│   ├── Inventory.tsx            # 库存管理
│   ├── Layout.tsx              # 布局组件
│   ├── Login.tsx                # 登录页
│   ├── NotFound.tsx             # 404 页面
│   ├── OperationLogs.tsx        # 操作日志
│   ├── ReagentOrders.tsx        # 试剂订单
│   ├── TestError.tsx            # 测试错误页
│   └── dashboard/               # 仪表盘子页面
│       ├── DashboardBorrowTab.tsx
│       ├── DashboardConsumableTab.tsx
│       ├── DashboardReagentTab.tsx
│       └── DashboardStockinTab.tsx
└── store/                       # Zustand 状态管理
    └── useStore.ts
```

---

## 架构设计

### 请求流程

```
1. 用户在浏览器发起请求
       │
       ▼
2. React 组件通过 Axios 发送 HTTP 请求
       │
       ▼
3. FastAPI 路由层接收请求 (/api/*)
       │
       ▼
4. 认证中间件验证 JWT Token（支持 Cookie 或 Bearer）
       │
       ▼
5. Pydantic 进行数据验证
       │
       ▼
6. 业务逻辑层处理 (Services)
       │
       ▼
7. ORM 层与数据库交互 (SQLModel → SQLite)
       │
       ▼
8. 响应返回给前端
       │
       ▼
9. React 组件更新状态并渲染
```

### 数据模型

#### 用户 (User)

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | Integer | PK, Auto | 主键 |
| username | String | Unique, Not Null | 用户名 |
| password_hash | String | Not Null | 加密后的密码 |
| full_name | String | - | 姓名 |
| full_name_pinyin | String | Index | 姓名拼音 |
| role | Enum | Not Null | 角色 (admin/user/public) |
| is_active | Boolean | Default True | 是否激活 |
| avatar_url | String | - | 头像 URL |
| username_version | Integer | Default 1 | 用户名版本（用于会话失效） |
| created_at | DateTime | Auto | 创建时间 |
| updated_at | DateTime | Auto | 更新时间 |

#### 用户会话 (UserSession)

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | Integer | PK, Auto | 主键 |
| user_id | Integer | FK → User.id | 关联用户 |
| token_hash | String | Not Null | Token 哈希 |
| device_id | String | Not Null | 设备唯一标识 |
| device_name | String | - | 设备名称 |
| ip_address | String | - | IP 地址 |
| user_agent | String | - | 浏览器 User-Agent |
| created_at | DateTime | Auto | 创建时间 |
| last_active_at | DateTime | Auto | 最后活跃时间 |
| expires_at | DateTime | Not Null | 过期时间 |

#### 库存 (Inventory)

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | Integer | PK, Auto | 主键 |
| internal_code | String | Unique, Index | 内部编码 |
| cas_number | String | Index | CAS 号 |
| name | String | Index | 物品名称 |
| name_pinyin | String | Index | 名称拼音（用于排序） |
| english_name | String | - | 英文名 |
| alias | String | - | 别名 |
| category | String | Index | 分类 |
| category_pinyin | String | Index | 分类拼音 |
| brand | String | Index | 品牌 |
| brand_pinyin | String | Index | 品牌拼音 |
| storage_location | String | Index | 存放位置 |
| storage_location_pinyin | String | Index | 位置拼音 |
| initial_quantity | Float | - | 初始数量 |
| remaining_quantity | Float | - | 剩余数量 |
| remaining_percent | Float | Index | 剩余百分比 |
| unit | String | - | 单位 |
| status | Enum | Index | 库存状态 |
| is_hazardous | Boolean | Default False | 是否危险品 |
| borrower_id | Integer | FK → User.id | 当前借用人 |
| created_by_id | Integer | FK → User.id | 创建人 |
| created_at | DateTime | Index | 创建时间 |
| updated_at | DateTime | Auto | 更新时间 |

### 核心业务逻辑

#### CAS 号管理

系统对输入的 CAS 号进行自动标准化处理：

| 输入格式 | 标准化结果 |
|----------|------------|
| `64-17-5` | `64175` |
| `64 17 5` | `64175` |
| `64175` | `64175` |

#### 拼音排序

预计算拼音字段以加速排序：
- `name_pinyin` - 名称拼音
- `category_pinyin` - 分类拼音
- `brand_pinyin` - 品牌拼音
- `storage_location_pinyin` - 位置拼音

#### 图片处理

1. **压缩要求**: 上传的图片自动压缩至 100KB 以下
2. **存储位置**: `static/uploads/` 目录
3. **文件命名**: UUID 命名
4. **缩略图**: `static/thumbnails/` 目录
5. **数据库**: 仅存储 URL

---

## 环境变量参考

### 必需变量

| 变量名 | 类型 | 说明 | 示例 |
|--------|------|------|------|
| SECRET_KEY | String | JWT 签名密钥 | `your-secret-key` |
| DEBUG | Boolean | 调试模式 | `true` / `false` |
| ENV | String | 环境 | `development` / `production` |
| DEFAULT_ADMIN_USERNAME | String | 默认管理员用户名 | `admin` |
| DEFAULT_ADMIN_PASSWORD | String | 默认管理员密码 | - |
| DEFAULT_ADMIN_FULL_NAME | String | 默认管理员姓名 | `系统管理员` |

### 可选变量

| 变量名 | 类型 | 说明 | 默认值 |
|--------|------|------|--------|
| ALGORITHM | String | JWT 算法 (HS256/RS256) | `RS256` |
| ACCESS_TOKEN_EXPIRE_MINUTES | Int | Token 过期时间（分钟） | `10080` (7天) |
| REDIS_URL | String | Redis 连接地址 | `redis://localhost:6379/0` |
| CORS_ORIGINS | String | CORS 允许的源 | 见配置文件 |
| max_ip_per_user | Int | 每用户最大 IP 数 | `5` |
| max_device_per_user | Int | 每用户最大设备数 | `10` |
| session_expire_hours | Int | 会话过期小时数 | `72` |
| max_image_size_kb | Int | 图片最大大小（KB） | `100` |

---

## 核心 API 参考

### 认证 API

| 方法 | 端点 | 认证 | 说明 |
|------|------|------|------|
| POST | `/api/users/login` | 否 | 用户登录，返回 JWT Token（通过 Cookie） |
| POST | `/api/users/logout` | 是 | 用户登出 |
| GET | `/api/users/me` | 是 | 获取当前用户信息 |
| POST | `/api/users/change-password` | 是 | 修改当前用户密码 |

### 用户管理 API

| 方法 | 端点 | 认证 | 说明 |
|------|------|------|------|
| GET | `/api/users` | 管理员 | 用户列表 |
| POST | `/api/users` | 管理员 | 创建新用户 |
| GET | `/api/users/{id}` | 是 | 获取用户详情 |
| PUT | `/api/users/{id}` | 是 | 更新用户信息 |
| DELETE | `/api/users/{id}` | 管理员 | 软删除用户 |
| POST | `/api/users/{id}/activate` | 管理员 | 激活用户 |
| POST | `/api/users/{id}/reset-password` | 管理员 | 重置密码 |
| PUT | `/api/users/{id}/role` | 管理员 | 更新角色 |
| POST | `/api/users/{id}/avatar` | 是 | 上传头像 |
| GET | `/api/users/search` | 是 | 搜索用户（自动补全） |

### 库存 API

| 方法 | 端点 | 认证 | 说明 |
|------|------|------|------|
| GET | `/api/inventory` | 是 | 库存列表（分页、筛选、排序） |
| GET | `/api/inventory/{id}` | 是 | 库存详情 |
| GET | `/api/inventory/code/{code}` | 是 | 内部编码查询 |
| POST | `/api/inventory/{id}/borrow` | 是 | 借用库存 |
| POST | `/api/inventory/{id}/return` | 是 | 归还库存 |
| PUT | `/api/inventory/{id}` | 是 | 更新库存 |
| DELETE | `/api/inventory/{id}` | 管理员 | 删除库存 |
| POST | `/api/inventory/manual-add` | 管理员 | 手动添加 |
| POST | `/api/inventory/import` | 管理员 | Excel 导入 |
| GET | `/api/inventory/export` | 管理员 | 导出 CSV |
| GET | `/api/inventory/dashboard/my-borrows` | 是 | 我的借用 |
| GET | `/api/inventory/common-shelf` | 是 | 常用货架 |

### 试剂订单 API

| 方法 | 端点 | 认证 | 说明 |
|------|------|------|------|
| GET | `/api/reagent-orders` | 是 | 订单列表 |
| POST | `/api/reagent-orders` | 是 | 创建订单 |
| GET | `/api/reagent-orders/{id}` | 是 | 订单详情 |
| PUT | `/api/reagent-orders/{id}` | 是 | 更新订单 |
| POST | `/api/reagent-orders/{id}/approve` | 管理员 | 审批通过 |
| POST | `/api/reagent-orders/{id}/reject` | 管理员 | 驳回 |
| POST | `/api/reagent-orders/{id}/confirm-arrival` | 是 | 确认到货 |
| POST | `/api/reagent-orders/{id}/stock-in` | 管理员 | 一键入库 |
| GET | `/api/reagent-orders/cas-overview/{cas}` | 是 | CAS 号概览 |

### 耗材订单 API

| 方法 | 端点 | 认证 | 说明 |
|------|------|------|------|
| GET | `/api/consumable-orders` | 是 | 订单列表 |
| POST | `/api/consumable-orders` | 是 | 创建订单 |
| POST | `/api/consumable-orders/{id}/approve` | 管理员 | 审批通过 |
| POST | `/api/consumable-orders/{id}/reject` | 管理员 | 驳回 |
| POST | `/api/consumable-orders/{id}/complete` | 管理员 | 完成订单 |

### 会话管理 API

| 方法 | 端点 | 认证 | 说明 |
|------|------|------|------|
| GET | `/api/users/me/sessions` | 是 | 会话列表 |
| DELETE | `/api/users/me/sessions/{id}` | 是 | 删除会话 |
| DELETE | `/api/users/me/sessions` | 是 | 删除全部会话 |

### 公告 API

| 方法 | 端点 | 认证 | 说明 |
|------|------|------|------|
| GET | `/api/announcements/public` | 否 | 获取公开公告 |
| GET | `/api/announcements` | 管理员 | 公告列表 |
| POST | `/api/announcements` | 管理员 | 创建公告 |

---

## 功能操作指南

### 角色与权限

| 角色 | 权限范围 |
|------|----------|
| **admin** | 全部权限：用户管理、订单审批、库存管理、系统配置 |
| **user** | 基本权限：申请订单、借用归还、查看个人数据 |
| **public** | 只能查看库存，不能操作 |

### 试剂订购流程

```
提交申请 → CAS 号检查 → 等待审批 → 审批通过/驳回
                              ↓
                        等待到货 → 确认到货 → 一键入库
```

### 库存借用流程

```
查找物品 → 申请借用 → 确认借出 → 使用物品 → 归还检查 → 归还完成
```

---

## 代码规范

### Python 规范

- 使用 ruff lint，line-length 100
- 类型提示 (type hints)
- 异步优先 (async/await)
- 所有代码修改后运行 `ruff check app/` 验证

### TypeScript/React 规范

- 函数式组件 + hooks
- Tailwind CSS（非 CSS modules）
- 导入顺序: React → 第三方 → 本地 → 类型 → 样式
- **禁止修改** migrations/ 目录下的已有文件

---

## 验证命令

### 后端验证

```bash
ruff check app/
```

### 前端验证

```bash
cd frontend
npm run lint
```

---

## 部署指南

### 推荐：Docker 一键部署（服务器）

项目已提供以下 Docker 文件：

- `docker-compose.yml`
- `docker/backend/Dockerfile`
- `docker/frontend/Dockerfile`
- `docker/nginx/default.conf`

#### 1. 拉取代码并准备环境变量

```bash
git clone <your-repo-url> LabStorageManager
cd LabStorageManager
cp .env.example .env
```

请至少在 `.env` 中修改：

- `DEFAULT_ADMIN_PASSWORD`（必须）
- `ENV`（无 HTTPS 时建议 `development`，有 HTTPS 再设为 `production`）
- `CORS_ORIGINS`（按你的域名配置）

说明：

- 当 `ALGORITHM=RS256` 时，容器会在持久化卷中自动生成 `.keys/private.pem` 与 `.keys/public.pem`。
- 如果你当前只有 HTTP（未配置 TLS），请不要把 `ENV` 设为 `production`，否则登录 Cookie 的 `secure` 属性会导致浏览器不发送 Cookie。

#### 2. 一键构建并启动

```bash
# 80 端口发布（可改为 8080 等）
APP_PORT=80 docker compose up -d --build
```

#### 3. 检查服务状态

```bash
docker compose ps
docker compose logs -f backend
docker compose logs -f frontend
curl http://127.0.0.1:${APP_PORT:-80}/health
```

#### 4. 日常更新部署

```bash
git pull
docker compose up -d --build
```

#### 5. 备份与恢复（SQLite）

```bash
# 备份（在容器内复制到持久化卷）
docker compose exec backend sh -c 'cp /data/lab_inventory.db /data/lab_inventory_backup_$(date +%Y%m%d_%H%M%S).db'

# 恢复示例（先停后端，再恢复，再启动）
docker compose stop backend
docker compose exec backend sh -c 'cp /data/lab_inventory_backup_YYYYmmdd_HHMMSS.db /data/lab_inventory.db'
docker compose start backend
```

### 传统方式部署（可选）

```bash
cd frontend && npm run build
pip install gunicorn
gunicorn app.main:app --workers 4 --worker-class uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000
```

---

## 故障排除

### 数据库问题

- 检查 SQLite 文件是否存在
- 确认 `DATABASE_URL` 格式正确
- 确保启用 WAL 模式（URL 包含 `?mode=wal`）

### 认证问题

- 检查 Token 是否过期
- 确认请求头包含 `Authorization: Bearer <token>` 或 Cookie 中有 token
- 验证 JWT 配置正确

### 图片上传问题

- 检查 `static/uploads` 目录存在且有写权限
- 确认 Pillow 库正确安装
- 检查上传文件大小是否超过限制


---

## 许可证

本项目基于 Apache License 2.0 许可证开源。详情请参阅 [LICENSE](LICENSE) 文件。

---

**版本**: 0.1.0  
**最后更新**: 2026-03-18
