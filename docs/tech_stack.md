# 技术栈文档

## 项目概述

实验室试剂/耗材管理系统，采用 FastAPI + React 全栈架构。

---

## 技术栈

### 后端

- **框架**: FastAPI 0.109+ / Uvicorn
- **ORM**: SQLModel 0.0.37+
- **数据库**: SQLite (WAL 模式)
- **认证**: JWT (python-jose + bcrypt)
- **Lint**: ruff

### 前端

- **框架**: React 19 + TypeScript 5.9
- **UI**: Radix UI + 自建 Shadcn/UI 风格组件
- **状态管理**: Zustand 5+
- **路由**: React Router DOM 7
- **表格**: TanStack Table 8 + React Virtual
- **表单**: React Hook Form + Valibot
- **构建**: Vite 7
- **CSS**: Tailwind CSS 4

---

## 构建命令

### 后端

```bash
# 启动后端
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Lint
ruff check app/
```

### 前端

```bash
# 安装依赖
cd frontend && npm install

# 开发
npm run dev

# 构建
npm run build

# Lint
npm run lint
```

---

## 架构

### 后端结构

```
app/
├── main.py              # FastAPI 入口
├── database.py          # SQLModel 配置 + WAL 模式
├── core/               # 核心模块
│   ├── auth.py         # JWT 认证
│   ├── config.py       # Pydantic Settings
│   └── redis.py        # Redis 缓存
├── models/             # 数据模型
├── api/                # API 路由
└── services/           # 业务逻辑
```

### 前端结构

```
frontend/src/
├── pages/              # 页面组件
├── components/ui/      # UI 组件库
├── hooks/              # 自定义 hooks
├── api/                # Axios API 客户端
├── lib/                # 工具函数
└── store/              # Zustand 状态
```

---

**注意**: Node.js 不参与后端业务，仅作为前端的运行时环境和构建工具，后端完全由 Python/FastAPI 负责。

---

## 技术栈关系图

```
┌─────────────────────────────────────────────────────────────┐
│                        用户浏览器                            │
└─────────────────────────┬───────────────────────────────────┘
                          │ HTTP/HTTPS
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    前端 (Node.js 环境)                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │   React 19  │  │  Vite 7     │  │  TanStack Table 8   │ │
│  │   TypeScript│  │  (构建工具)  │  │  (虚拟滚动表格)      │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└─────────────────────────┬───────────────────────────────────┘
                          │ REST API (JSON)
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    后端 (Python 环境)                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │   FastAPI   │  │  SQLModel    │  │   SQLite (WAL)      │ │
│  │   (Uvicorn) │  │  (ORM)       │  │   (数据库)           │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```
