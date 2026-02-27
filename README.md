# LabStorageManager - 实验室库存管理系统 (LIMS)

<p align="center">
  <img src="https://img.shields.io/badge/Python-3.11+-blue?style=flat&logo=python" alt="Python">
  <img src="https://img.shields.io/badge/FastAPI-0.109+-blue?style=flat&logo=fastapi" alt="FastAPI">
  <img src="https://img.shields.io/badge/React-18+-blue?style=flat&logo=react" alt="React">
  <img src="https://img.shields.io/badge/TypeScript-5+-blue?style=flat&logo=typescript" alt="TypeScript">
  <img src="https://img.shields.io/badge/SQLite-WAL-green?style=flat&logo=sqlite" alt="SQLite">
  <img src="https://img.shields.io/badge/License-Apache%202.0-green?style=flat" alt="License">
</p>

轻量级、高性能的实验室试剂/耗材管理系统。

## 目录

- [项目概述](#项目概述)
  - [背景与目标](#背景与目标)
  - [核心特性](#核心特性)
  - [系统架构](#系统架构)
- [技术栈](#技术栈)
- [前置要求](#前置要求)
- [快速开始](#快速开始)
  - [环境准备](#环境准备)
  - [后端启动](#后端启动)
  - [前端启动](#前端启动)
- [用户手册](#用户手册)
  - [角色与权限](#角色与权限)
  - [业务流程](#业务流程)
  - [功能操作指南](#功能操作指南)
- [项目结构](#项目结构)
- [架构设计](#架构设计)
  - [系统架构图](#系统架构图)
  - [数据模型](#数据模型)
  - [API 设计](#api-设计)
- [环境变量](#环境变量)
- [核心 API 参考](#核心-api-参考)
  - [认证 API](#认证-api)
  - [用户管理 API](#用户管理-api)
  - [试剂订单 API](#试剂订单-api)
  - [耗材订单 API](#耗材订单-api)
  - [库存 API](#库存-api)
  - [Dashboard API](#dashboard-api)
  - [会话管理 API](#会话管理-api)
- [关键规则与数据规范](#关键规则与数据规范)
  - [CAS 号管理](#cas-号管理)
  - [图片处理规范](#图片处理规范)
  - [数据导入格式](#数据导入格式)
- [前端页面说明](#前端页面说明)
- [测试](#测试)
- [部署指南](#部署指南)
  - [开发环境部署](#开发环境部署)
  - [生产环境部署](#生产环境部署)
  - [数据库备份](#数据库备份)
- [故障排除](#故障排除)
- [开发文档](#开发文档)
- [许可证](#许可证)

---

## 项目概述

### 背景与目标

实验室试剂和耗材的管理一直是科研机构和企业研发中心面临的重要挑战。传统的人工管理模式存在诸多问题：库存信息不透明、重复采购造成浪费、借用记录难以追溯、盘点工作耗时耗力等。

LabStorageManager 是一个面向实验室场景的库存管理系统，旨在通过数字化手段解决上述问题。系统采用现代化的技术架构，实现试剂和耗材的全生命周期管理，从采购申请到入库、从借用归还到盘点审计，每个环节都有清晰的记录和可追溯的流程。

系统的核心目标是建立一个高效、透明、可追溯的实验室物资管理平台，帮助实验室管理人员优化库存结构、减少资源浪费、提高管理效率。

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
| **搜索缓存** | 基于 Redis 的搜索结果缓存，加速高频查询 |

### 系统架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                           用户层 (Browser)                           │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐ │
│  │  Dashboard │  │ Inventory │  │ Orders  │  │ Import  │  │ Admin   │ │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘ │
└───────┼─────────────┼─────────────┼─────────────┼─────────────┼──────┘
        │             │             │             │             │
        └─────────────┴──────┬──────┴─────────────┴─────────────┘
                             │
                      ┌──────▼──────┐
                      │   React 18   │
                      │ + TypeScript │
                      │ + Shadcn/UI  │
                      └──────┬──────┘
                             │
                      ┌──────▼──────┐
                      │  Axios API   │
                      │  Client      │
                      └──────┬──────┘
                             │
┌────────────────────────────┼──────────────────────────────────────┐
│                            │           应用层 (FastAPI)              │
│  ┌─────────┐  ┌─────────┼──▼────────┐  ┌─────────┐  ┌─────────┐   │
│  │  Auth   │  │ Router │            │  │ Services│  │  Core   │   │
│  │ (JWT)   │  │        │            │  │         │  │         │   │
│  └────┬────┘  └────┬────┘            └────┬────┘  └────┬────┘   │
│       │             │                      │            │          │
└───────┼─────────────┼──────────────────────┼────────────┼──────────┘
        │             │                      │            │
┌───────▼─────────────▼──────────────────────▼────────────▼──────────┐
│                        数据层                                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                │
│  │   SQLite    │  │    Redis    │  │  FileSystem │                │
│  │  (WAL Mode) │  │   (Cache)   │  │  (Images)   │                │
│  └─────────────┘  └─────────────┘  └─────────────┘                │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 技术栈

| 层级 | 技术选型 | 版本要求 | 说明 |
|------|----------|----------|------|
| 后端框架 | FastAPI | 0.109+ | 异步高性能 Web 框架 |
| ORM | SQLModel | 0.0.14+ | 类型安全的数据库 ORM |
| 数据库 | SQLite | - | 轻量级嵌入式数据库 |
| 数据库模式 | WAL Mode | - | Write-Ahead Logging 并发优化 |
| 前端框架 | React | 18+ | 声明式 UI 库 |
| 语言 | TypeScript | 5+ | 带类型检查的 JavaScript |
| UI 组件库 | Shadcn/UI | - | 基于 Radix UI 的组件库 |
| 表格组件 | TanStack Table | 8+ | 功能强大的数据表格 |
| 图片处理 | Pillow | 10+ | Python 图像处理库 |
| 数据处理 | Pandas | 2+ | Python 数据分析库 |
| 认证 | JWT | - | JSON Web Token (RS256) |
| 缓存 | Redis | 6.0+ | 内存数据库（可选） |
| 状态管理 | Zustand | 4+ | 轻量级状态管理 |
| 构建工具 | Vite | 5+ | 前端构建工具 |

---

## 前置要求

| 软件 | 版本要求 | 说明 |
|------|----------|------|
| Python | 3.11+ | 后端运行环境，建议使用 3.11 或更高版本 |
| Node.js | 18+ | 前端运行环境，建议使用 LTS 版本 |
| npm | 9+ | Node.js 包管理器 |
| Redis | 6.0+ | 可选，用于搜索结果缓存 |

---

## 快速开始

### 环境准备

#### 1. 克隆项目

```bash
git clone https://github.com/your-repo/LabStorageManager.git
cd LabStorageManager
```

#### 2. Python 环境配置（推荐使用虚拟环境）

```bash
# 创建虚拟环境
python -m venv venv

# 激活虚拟环境
# Windows
venv\Scripts\activate
# Linux / macOS
source venv/bin/activate

# 安装依赖
pip install -r requirements.txt
# 或使用 Poetry
poetry install
```

#### 3. 前端环境配置

```bash
cd frontend
npm install
```

#### 4. 环境变量配置

```bash
# 复制环境变量示例文件
copy .env.example .env
```

编辑 `.env` 文件，配置必要的环境变量：

```bash
# 必需配置
SECRET_KEY=your-secret-key-here-change-in-production
DEBUG=true
DATABASE_URL=sqlite:///./lab_inventory.db

# 可选配置
REDIS_URL=redis://localhost:6379/0
CORS_ORIGINS=http://localhost:5173
API_BASE_URL=http://localhost:8000
```

### 后端启动

```bash
# 激活虚拟环境（如果尚未激活）
# Windows
venv\Scripts\activate
# Linux / macOS
source venv/bin/activate

# 初始化数据库（首次运行）
python -c "from app.database import init_db; init_db()"

# 启动后端服务
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

后端服务启动后，可访问以下地址：
- API 文档：http://localhost:8000/docs
- ReDoc 文档：http://localhost:8000/redoc

### 前端启动

```bash
cd frontend
npm run dev
```

前端服务启动后，可访问：http://localhost:5173

#### 初始管理员账号

首次启动后，需要通过 API 创建管理员账号：

```bash
# 使用 curl
curl -X 'POST' \
  'http://localhost:8000/users/create-admin' \
  -H 'Content-Type: application/json' \
  -d '{
    "username": "admin",
    "password": "admin123",
    "full_name": "系统管理员"
  }'
```

或访问 http://localhost:8000/docs 使用 "Create Admin User" 接口创建管理员。

---

## 用户手册

### 角色与权限

系统采用基于角色的访问控制（RBAC），定义以下两种角色：

| 角色 | 权限范围 | 说明 |
|------|----------|------|
| **管理员 (admin)** | 全部权限 | 可管理用户、审批订单、查看全部数据、系统设置 |
| **普通用户 (user)** | 基本权限 | 可申请订单、借用归还、查看个人数据 |

#### 管理员职责

- 用户账号管理（创建、启用/禁用、重置密码）
- 订单审批（通过/驳回）
- 库存管理（入库、出库、盘点）
- 系统配置

#### 普通用户职责

- 提交试剂/耗材订购申请
- 借用库存物品
- 归还借用物品
- 查看个人申请记录和借用记录

### 业务流程

#### 试剂订购流程

试剂订购采用完整的审批流程，确保采购的合规性和必要性：

```
步骤 1: 提交申请
┌─────────────────────────────────────────────────────────────┐
│ 申请人填写申购单                                           │
│  - CAS 号（系统自动校验格式）                              │
│  - 试剂名称、英文名、别名                                  │
│  - 规格、品牌、数量                                         │
│  - 订购原因（快用完/用完/常用或公用/找不到/重新下单）      │
│  - 是否危险品                                              │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
步骤 2: CAS 号检查
┌─────────────────────────────────────────────────────────────┐
│ 系统自动检查库存中是否存在相同 CAS 号                        │
│ 如果存在，显示现有库存总量和位置信息                        │
│ 申请人可选择继续申请或取消                                 │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
步骤 3: 等待审批
┌─────────────────────────────────────────────────────────────┐
│ 订单状态: Pending（已申购）                                 │
│ 等待管理员审批                                             │
└─────────────────────────────────────────────────────────────┘
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
        审批通过                    审批驳回
              │                           │
              ▼                           ▼
步骤 4: 等待到货                 订单结束
步骤 5: 确认到货                 状态: Rejected
步骤 6: 一键入库                 
步骤 7: 入库完成                 
```

#### 耗材订购流程

耗材订购流程相对简化，审批通过后可直接完成：

```
提交申请 → 等待审批 → 审批通过/驳回 → 确认完成
```

#### 库存借用流程

```
查找物品 → 申请借用 → 确认借出 → 使用物品 → 归还检查 → 归还完成
```

### 功能操作指南

#### 1. Dashboard（仪表盘）

Dashboard 是系统首页，展示与当前用户相关的重要信息：

| 模块 | 说明 |
|------|------|
| 我的借用 | 当前用户正在借用的物品列表 |
| 待入库 | 已到货待入库的订单 |
| 已到货待确认 | 需要确认到达的订单 |
| 低库存预警 | 库存量低于阈值的物品 |

#### 2. 库存管理

库存管理页面提供库存的查看、搜索、借用、归还操作：

- **列表查看**: 支持分页、排序、筛选
- **搜索功能**: 支持按名称、CAS 号、位置、品牌、分类搜索
- **高级搜索**: 精确搜索和模糊搜索
- **借用操作**: 选择物品、填写数量、说明用途
- **归还操作**: 确认归还数量、检查物品状态
- **手动入库**: 直接添加库存物品（需管理员权限）

#### 3. 试剂订单

试剂订单页面管理试剂采购申请：

- **创建订单**: 填写试剂信息，系统自动检查 CAS 号
- **查看订单**: 按状态筛选，查看订单详情
- **审批操作**: 管理员可审批/驳回订单
- **一键入库**: 到货后一键完成入库

#### 4. 耗材订单

耗材订单页面管理耗材采购申请：

- **创建订单**: 填写耗材信息
- **审批操作**: 管理员可审批/驳回订单
- **完成确认**: 审批通过后确认完成

#### 5. 数据导入

数据导入功能支持批量导入库存数据：

- **下载模板**: 获取标准 Excel 导入模板
- **上传文件**: 上传填写好的 Excel 文件
- **预览数据**: 导入前预览数据
- **执行导入**: 确认后执行导入

#### 6. 用户管理

管理员可管理系统用户：

- **创建用户**: 添加新用户账号
- **编辑用户**: 修改用户信息、角色
- **禁用/启用**: 控制用户访问权限
- **重置密码**: 帮助用户恢复账号

#### 7. 设备管理

设备管理显示当前用户的登录会话：

- **会话列表**: 查看当前登录的设备
- **删除会话**: 强制下线某设备
- **删除全部**: 注销所有会话

---

## 项目结构

```
LabStorageManager/
├── app/                          # 后端代码
│   ├── __init__.py
│   ├── main.py                   # FastAPI 应用入口
│   ├── database.py               # SQLModel 数据库配置 + WAL 模式
│   ├── core/                     # 核心功能模块
│   │   ├── __init__.py
│   │   ├── auth.py               # JWT 认证模块
│   │   ├── config.py             # 应用配置 (Pydantic Settings)
│   │   └── redis.py              # Redis 缓存客户端
│   ├── models/                   # SQLModel 数据模型
│   │   ├── __init__.py           # 模型导出
│   │   ├── user.py               # 用户模型 + UserRole 枚举
│   │   ├── user_session.py       # 用户会话模型
│   │   ├── reagent_order.py       # 试剂订单模型 + 状态/原因枚举
│   │   ├── consumable_order.py   # 耗材订单模型
│   │   └── inventory.py         # 库存模型 + BorrowLog 借用日志
│   ├── api/                      # FastAPI 路由
│   │   ├── __init__.py
│   │   ├── deps.py               # 依赖注入 (get_db, get_current_user)
│   │   ├── users.py              # 用户 CRUD + 认证接口
│   │   ├── user_sessions.py      # 会话管理接口
│   │   ├── reagent_orders.py      # 试剂订单接口
│   │   ├── consumable_orders.py  # 耗材订单接口
│   │   └── inventory.py          # 库存接口 + 导入/导出
│   └── services/                  # 业务逻辑服务
│       ├── __init__.py
│       ├── cas_utils.py          # CAS 号标准化 + 验证
│       ├── spec_utils.py         # 规格解析 + 单位转换
│       ├── internal_code.py       # 内部编码生成
│       ├── image_service.py       # 图片压缩 + 文件存储
│       ├── excel_service.py       # Excel 导入/导出
│       └── pinyin_utils.py       # 中文转拼音工具
├── frontend/                     # 前端代码
│   ├── src/
│   │   ├── main.tsx             # React 入口
│   │   ├── App.tsx              # 根组件 + 路由配置
│   │   ├── index.css             # 全局样式 + Tailwind
│   │   ├── pages/               # 页面组件
│   │   │   ├── Login.tsx         # 登录页
│   │   │   ├── Dashboard.tsx     # 仪表盘
│   │   │   ├── Inventory.tsx    # 库存管理
│   │   │   ├── ReagentOrders.tsx # 试剂订单
│   │   │   ├── ConsumableOrders.tsx # 耗材订单
│   │   │   ├── Import.tsx        # 数据导入
│   │   │   ├── AdminUsers.tsx    # 用户管理
│   │   │   ├── DeviceManagement.tsx # 设备管理
│   │   │   └── Layout.tsx        # 布局组件 + 导航
│   │   ├── components/           # React 组件
│   │   │   ├── ErrorBoundary.tsx # React 错误边界
│   │   │   └── ui/              # UI 组件库 (Shadcn 风格)
│   │   │       ├── Button.tsx
│   │   │       ├── Card.tsx
│   │   │       ├── DataTable.tsx
│   │   │       ├── Dialog.tsx
│   │   │       ├── Select.tsx
│   │   │       ├── Pagination.tsx
│   │   │       ├── StatusBadge.tsx
│   │   │       ├── Toast.tsx
│   │   │       ├── Input.tsx
│   │   │       ├── Label.tsx
│   │   │       ├── Checkbox.tsx
│   │   │       ├── RadioGroup.tsx
│   │   │       ├── Tabs.tsx
│   │   │       ├── Separator.tsx
│   │   │       ├── HazardousIcon.tsx
│   │   │       └── QuantityIndicator.tsx
│   │   ├── hooks/               # 自定义 React Hooks
│   │   │   ├── useTheme.ts      # 主题切换 (Light/Dark)
│   │   │   ├── useDialogState.tsx # 对话框状态管理
│   │   │   ├── useTableUrlState.ts # 表格 URL 状态同步
│   │   │   └── useMobile.ts     # 移动端检测
│   │   ├── api/                 # API 客户端
│   │   │   └── client.ts        # Axios 实例 + API 函数封装
│   │   ├── lib/                 # 工具函数
│   │   │   ├── constants.ts     # 常量定义 (状态映射等)
│   │   │   ├── utils.ts         # 通用工具函数
│   │   │   ├── inputValidation.ts # 输入验证规则
│   │   │   └── deviceId.ts      # 设备 ID 生成
│   │   └── store/               # Zustand 状态管理
│   │       └── useStore.ts      # 全局状态 (用户、主题等)
│   ├── public/                   # 静态资源
│   │   └── fonts/              # 思源黑体字体
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   ├── tsconfig.app.json
│   ├── tsconfig.node.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   └── eslint.config.js
├── static/                       # 文件上传目录
│   ├── thumbnails/              # 图片缩略图
│   └── uploads/                 # 原始上传文件
├── tests/                       # 测试代码
│   └── concurrent_inventory_test.py # 并发测试
├── docs/                        # 项目文档
│   ├── prompt/                 # 开发过程文档
│   │   ├── PRD.md              # 产品需求文档
│   │   ├── BACKEND_STRUCTURE.md # 后端架构设计
│   │   ├── Progress.md         # 开发进度
│   │   └── Lessons.md         # 经验教训
│   └── done/                   # 已完成的文档
├── scripts/                     # 工具脚本
│   └── rebuild_pinyin.py       # 拼音库重建
├── pyproject.toml               # Poetry 项目配置
├── poetry.lock                  # Poetry 锁定文件
├── requirements.txt             # pip 依赖
├── .env.example               # 环境变量示例
├── .gitignore
└── README.md
```

---

## 架构设计

### 系统架构图

```mermaid
graph TB
    subgraph Client["前端 (React + TypeScript)"]
        UI[用户界面组件]
        Store[Zustand 状态管理]
        API[Axios HTTP 客户端]
    end

    subgraph Server["后端服务 (FastAPI)"]
        Router[API 路由层]
        Auth[JWT 认证中间件]
        Validation[数据验证 (Pydantic)]
        Services[业务逻辑层]
        ORM[SQLModel ORM]
    end

    subgraph Data["数据层"]
        SQLite[(SQLite WAL)]
        Redis[(Redis Cache)]
        Files[(文件系统)]
    end

    UI --> Store
    Store --> API
    API --> Router
    Router --> Auth
    Auth --> Validation
    Validation --> Services
    Services --> ORM
    ORM --> SQLite
    Services --> Redis
    Services --> Files
```

### 数据模型

#### 用户 (User)

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | Integer | PK, Auto | 主键 |
| username | String | Unique, Not Null | 用户名 |
| hashed_password | String | Not Null | 加密后的密码 |
| full_name | String | - | 姓名 |
| role | Enum | Not Null | 角色 (admin/user) |
| is_active | Boolean | Default True | 是否激活 |
| created_at | DateTime | Auto | 创建时间 |
| updated_at | DateTime | Auto | 更新时间 |

#### 用户会话 (UserSession)

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | Integer | PK, Auto | 主键 |
| user_id | Integer | FK → User.id | 关联用户 |
| device_id | String | Not Null | 设备唯一标识 |
| device_name | String | - | 设备名称 |
| user_agent | String | - | 浏览器 User-Agent |
| created_at | DateTime | Auto | 创建时间 |
| last_active_at | DateTime | Auto | 最后活跃时间 |
| expires_at | DateTime | Not Null | 过期时间 |

#### 试剂订单 (ReagentOrder)

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | Integer | PK, Auto | 主键 |
| cas_number | String | Index | CAS 号 |
| name | String | Not Null | 试剂名称 |
| english_name | String | - | 英文名 |
| alias | String | - | 别名 |
| category | String | - | 分类 |
| brand | String | - | 品牌 |
| specification | String | Not Null | 规格 |
| quantity | Integer | Not Null | 数量 |
| price | Float | - | 单价 |
| order_reason | Enum | Not Null | 订购原因 |
| is_hazardous | Boolean | Default False | 是否危险品 |
| status | Enum | Not Null | 订单状态 |
| notes | String | - | 备注 |
| arrival_notes | String | - | 到货备注 |
| user_id | Integer | FK → User.id | 申请人 |
| created_at | DateTime | Auto | 创建时间 |
| updated_at | DateTime | Auto | 更新时间 |

#### 耗材订单 (ConsumableOrder)

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | Integer | PK, Auto | 主键 |
| name | String | Not Null | 耗材名称 |
| english_name | String | - | 英文名 |
| alias | String | - | 别名 |
| category | String | - | 分类 |
| brand | String | - | 品牌 |
| specification | String | Not Null | 规格 |
| quantity | Integer | Not Null | 数量 |
| price | Float | - | 单价 |
| status | Enum | Not Null | 订单状态 |
| notes | String | - | 备注 |
| user_id | Integer | FK → User.id | 申请人 |
| created_at | DateTime | Auto | 创建时间 |
| updated_at | DateTime | Auto | 更新时间 |

#### 库存 (Inventory)

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | Integer | PK, Auto | 主键 |
| cas_number | String | Index | CAS 号 (试剂特有) |
| name | String | Not Null | 物品名称 |
| english_name | String | - | 英文名 |
| alias | String | - | 别名 |
| specification | String | Not Null | 规格 |
| quantity_bottles | Integer | Not Null | 数量(瓶) |
| brand | String | - | 品牌 |
| category | String | - | 分类 |
| storage_location | String | Index | 存放位置 |
| is_hazardous | Boolean | Default False | 是否危险品 |
| status | Enum | Not Null | 库存状态 |
| internal_code | String | Unique | 内部编码 |
| thumbnail_url | String | - | 缩略图 URL |
| notes | String | - | 备注 |
| created_at | DateTime | Auto | 创建时间 |
| updated_at | DateTime | Auto | 更新时间 |

#### 借用日志 (BorrowLog)

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | Integer | PK, Auto | 主键 |
| inventory_id | Integer | FK → Inventory.id | 库存物品 |
| user_id | Integer | FK → User.id | 借用用户 |
| quantity | Integer | Not Null | 借用数量 |
| returned_quantity | Integer | Default 0 | 已归还数量 |
| borrowed_at | DateTime | Auto | 借用时间 |
| returned_at | DateTime | - | 归还时间 |

### API 设计

系统采用 RESTful API 设计风格，遵循以下原则：

1. **资源导向**: URL 表示资源，如 `/inventory`、`/reagent-orders`
2. **HTTP 方法**: GET 查询、POST 创建、PUT 更新、DELETE 删除
3. **状态码**: 200 成功、201 创建成功、400 客户端错误、401 未认证、404 不存在、500 服务器错误
4. **分页**: 列表接口支持 `skip` 和 `limit` 参数
5. **认证**: 需要认证的接口在请求头中携带 `Authorization: Bearer <token>`

---

## 环境变量

### 必需变量

| 变量名 | 类型 | 说明 | 示例 |
|--------|------|------|------|
| SECRET_KEY | String | JWT 签名密钥，生产环境必须修改 | `your-secret-key-change-this` |
| DEBUG | Boolean | 调试模式 | `true` / `false` |
| DATABASE_URL | String | 数据库连接字符串 | `sqlite:///./lab_inventory.db` |

### 可选变量

| 变量名 | 类型 | 说明 | 默认值 |
|--------|------|------|--------|
| REDIS_URL | String | Redis 连接地址，用于搜索缓存 | `redis://localhost:6379/0` |
| CORS_ORIGINS | String | CORS 允许的源，多个用逗号分隔 | `http://localhost:5173` |
| API_BASE_URL | String | API 基础 URL | `http://localhost:8000` |

### 配置示例

```bash
# .env 文件内容
SECRET_KEY=your-super-secret-key-12345
DEBUG=true
DATABASE_URL=sqlite:///./lab_inventory.db
REDIS_URL=redis://localhost:6379/0
CORS_ORIGINS=http://localhost:5173,http://localhost:3000
API_BASE_URL=http://localhost:8000
```

---

## 核心 API 参考

### 认证 API

| 方法 | 端点 | 认证 | 说明 |
|------|------|------|------|
| POST | `/api/users/login` | 否 | 用户登录，返回 JWT Token |
| POST | `/api/users/logout` | 是 | 用户登出，使当前 Token 失效 |
| GET | `/api/users/me` | 是 | 获取当前用户信息 |
| POST | `/api/users/change-password` | 是 | 修改当前用户密码 |

### 用户管理 API

| 方法 | 端点 | 认证 | 说明 |
|------|------|------|------|
| GET | `/api/users` | 管理员 | 用户列表 (分页) |
| POST | `/api/users` | 管理员 | 创建新用户 |
| GET | `/api/users/{id}` | 是 | 获取用户详情 |
| PUT | `/api/users/{id}` | 是 | 更新用户信息 |
| DELETE | `/api/users/{id}` | 管理员 | 删除用户 (软删除) |
| POST | `/api/users/{id}/activate` | 管理员 | 激活用户 |
| POST | `/api/users/{id}/reset-password` | 管理员 | 重置用户密码 |
| PUT | `/api/users/{id}/role` | 管理员 | 更新用户角色 |

### 试剂订单 API

| 方法 | 端点 | 认证 | 说明 |
|------|------|------|------|
| GET | `/api/reagent-orders` | 是 | 订单列表 (分页、筛选) |
| POST | `/api/reagent-orders` | 是 | 创建试剂订单 |
| GET | `/api/reagent-orders/{id}` | 是 | 订单详情 |
| PUT | `/api/reagent-orders/{id}` | 是 | 更新订单 |
| DELETE | `/api/reagent-orders/{id}` | 是 | 删除订单 |
| POST | `/api/reagent-orders/{id}/approve` | 管理员 | 审批通过 |
| POST | `/api/reagent-orders/{id}/reject` | 管理员 | 驳回订单 |
| POST | `/api/reagent-orders/{id}/confirm-arrival` | 是 | 确认到货 |
| POST | `/api/reagent-orders/{id}/stock-in` | 管理员 | 一键入库 |

### 耗材订单 API

| 方法 | 端点 | 认证 | 说明 |
|------|------|------|------|
| GET | `/api/consumable-orders` | 是 | 订单列表 (分页、筛选) |
| POST | `/api/consumable-orders` | 是 | 创建耗材订单 |
| GET | `/api/consumable-orders/{id}` | 是 | 订单详情 |
| PUT | `/api/consumable-orders/{id}` | 是 | 更新订单 |
| DELETE | `/api/consumable-orders/{id}` | 是 | 删除订单 |
| POST | `/api/consumable-orders/{id}/approve` | 管理员 | 审批通过 |
| POST | `/api/consumable-orders/{id}/reject` | 管理员 | 驳回订单 |
| POST | `/api/consumable-orders/{id}/complete` | 管理员 | 完成订单 |

### 库存 API

| 方法 | 端点 | 认证 | 说明 |
|------|------|------|------|
| GET | `/api/inventory` | 是 | 库存列表 (分页、筛选) |
| GET | `/api/inventory/{id}` | 是 | 库存详情 |
| GET | `/api/inventory/code/{code}` | 是 | 内部编码查询 |
| GET | `/api/inventory/cas/{cas_number}` | 是 | CAS 号查询 |
| POST | `/api/inventory/{id}/borrow` | 是 | 借用库存 |
| POST | `/api/inventory/{id}/return` | 是 | 归还库存 |
| PUT | `/api/inventory/{id}` | 是 | 更新库存 |
| DELETE | `/api/inventory/{id}` | 管理员 | 删除库存 |
| POST | `/api/inventory/manual-add` | 管理员 | 手动添加库存 |
| POST | `/api/inventory/import` | 管理员 | Excel 导入 |
| GET | `/api/inventory/export` | 管理员 | 导出 CSV |
| GET | `/api/inventory/import/template` | 是 | 下载导入模板 |
| GET | `/api/inventory/{id}/borrow-history` | 是 | 借用历史 |

### Dashboard API

| 方法 | 端点 | 认证 | 说明 |
|------|------|------|------|
| GET | `/api/inventory/dashboard/my-borrows` | 是 | 当前用户的借用列表 |
| GET | `/api/inventory/dashboard/pending-stockin` | 管理员 | 待入库列表 |
| GET | `/api/reagent-orders/dashboard/arrived-orders` | 管理员 | 已到货待入库 |
| GET | `/api/reagent-orders/dashboard/my-orders` | 是 | 当前用户的订单 |
| GET | `/api/consumable-orders/dashboard/my-orders` | 是 | 当前用户的耗材订单 |

### 会话管理 API

| 方法 | 端点 | 认证 | 说明 |
|------|------|------|------|
| GET | `/api/users/me/sessions` | 是 | 当前用户的会话列表 |
| DELETE | `/api/users/me/sessions/{id}` | 是 | 删除指定会话 |
| DELETE | `/api/users/me/sessions` | 是 | 删除全部会话 |
| POST | `/api/users/me/sessions/refresh` | 是 | 刷新会话过期时间 |

---

## 关键规则与数据规范

### CAS 号管理

#### 什么是 CAS 号？

CAS（Chemical Abstracts Service）号是化学物质的标准识别号，由美国化学学会下属的 CAS 机构分配。每一种化学物质都有唯一的 CAS 号，格式为 `XXXXX-XX-X`，共 7 位数字。

#### CAS 号标准化

系统对输入的 CAS 号进行自动标准化处理：

| 输入格式 | 标准化结果 |
|----------|------------|
| `64-17-5` | `64175` |
| `64 17 5` | `64175` |
| `64175` | `64175` |
| `  64-17-5  ` | `64175` |

#### CAS 号校验规则

- 必须是 7 位数字
- 可以包含连字符 `-` 和空格
- 系统自动去除所有分隔符

### 图片处理规范

1. **压缩要求**: 上传的图片自动压缩至 100KB 以下
2. **存储位置**: 压缩后的图片存入 `static/uploads/` 目录
3. **文件命名**: 使用 UUID 命名，避免文件名冲突
4. **缩略图**: 同时生成缩略图存入 `static/thumbnails/`
5. **数据库存储**: 仅存储文件的相对 URL，不存储二进制数据

### 数据导入格式

#### Excel 模板字段

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| cas_number | String | 是 | CAS 号 (仅试剂) |
| name | String | 是 | 物品名称 |
| english_name | String | 否 | 英文名称 |
| specification | String | 是 | 规格 |
| quantity_bottles | Integer | 是 | 数量(瓶) |
| brand | String | 否 | 品牌 |
| category | String | 否 | 分类 |
| storage_location | String | 否 | 存放位置 |
| is_hazardous | Boolean | 否 | 是否危险品 (TRUE/FALSE) |
| created_at | DateTime | 否 | 入库日期 (YYYY-MM-DD) |

---

## 前端页面说明

| 页面 | 路由 | 访问权限 | 说明 |
|------|------|----------|------|
| 登录 | `/login` | 公开 | 用户登录页面 |
| 仪表盘 | `/` | 认证用户 | Dashboard 首页 |
| 库存管理 | `/inventory` | 认证用户 | 库存列表和操作 |
| 试剂订单 | `/reagent-orders` | 认证用户 | 试剂订购申请 |
| 耗材订单 | `/consumable-orders` | 认证用户 | 耗材订购申请 |
| 数据导入 | `/import` | 管理员 | Excel 批量导入 |
| 用户管理 | `/admin/users` | 管理员 | 用户账号管理 |
| 设备管理 | `/admin/devices` | 认证用户 | 登录会话管理 |

---

## 测试

### 运行后端测试

```bash
# 运行所有测试
pytest tests/ -v

# 运行特定测试文件
pytest tests/concurrent_inventory_test.py -v

# 显示详细输出
pytest tests/ -v -s
```

### 并发测试说明

项目包含 `concurrent_inventory_test.py` 并发测试脚本，用于验证 WAL 模式下的并发读写正确性：

```bash
python tests/concurrent_inventory_test.py
```

该测试会启动多个并发线程同时对库存进行读写操作，验证数据一致性。

---

## 部署指南

### 开发环境部署

1. 按照快速开始指南配置本地环境
2. 启动后端和前端服务
3. 访问 http://localhost:5173

### 生产环境部署

#### 1. 构建前端

```bash
cd frontend
npm run build
```

构建产物位于 `frontend/dist/` 目录。

#### 2. 配置环境变量

```bash
# 生产环境变量示例
SECRET_KEY=生成随机密钥
DEBUG=false
DATABASE_URL=sqlite:///./prod.db
REDIS_URL=redis://your-redis-server:6379/0
CORS_ORIGINS=https://your-domain.com
```

#### 3. 启动后端

使用 Gunicorn 作为生产服务器：

```bash
pip install gunicorn

gunicorn app.main:app \
    --workers 4 \
    --worker-class uvicorn.workers.UvicornWorker \
    --bind 0.0.0.0:8000 \
    --access-logfile - \
    --error-logfile -
```

#### 4. Nginx 配置（可选）

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # 前端静态文件
    location / {
        root /path/to/frontend/dist;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    # API 反向代理
    location /api {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # 静态文件服务
    location /static {
        alias /path/to/LabStorageManager/static;
    }
}
```

### 数据库备份

SQLite 数据库是一个文件，备份非常简单：

```bash
# 备份
cp lab_inventory.db lab_inventory_backup.db

# 压缩备份
tar -czvf lab_inventory_backup.tar.gz lab_inventory.db
```

建议设置定时任务自动备份：

```bash
# crontab 示例：每天凌晨 2 点备份
0 2 * * * /path/to/backup_script.sh
```

---

## 故障排除

### 常见问题

#### 1. 数据库连接错误

**症状**: `could not connect to server: Connection refused`

**解决方案**:
- 检查 SQLite 文件是否存在
- 验证 `DATABASE_URL` 格式正确
- 确认数据库文件所在目录有读写权限

#### 2. 认证失败 (401)

**症状**: 请求返回 401 Unauthorized

**解决方案**:
- 检查 Token 是否过期
- 确认请求头包含 `Authorization: Bearer <token>`
- 验证 JWT 密钥配置正确

#### 3. 图片上传失败

**症状**: 图片上传后无法显示

**解决方案**:
- 检查 `static/uploads` 目录存在且有写权限
- 确认 Pillow 库正确安装
- 检查上传文件大小是否超过限制

#### 4. 搜索结果不更新

**症状**: 搜索结果与实际数据不符

**解决方案**:
- 检查 Redis 服务是否运行
- 手动清除缓存: `redis-cli FLUSHDB`
- 检查 Redis 连接配置

---

## 开发文档


---

## 许可证

本项目基于 Apache License 2.0 许可证开源。详情请参阅 [LICENSE](LICENSE) 文件。

---

**版本**: dev-0.1  
**最后更新**: 2026-02-27
