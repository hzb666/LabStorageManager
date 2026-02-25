# LabStorageManager - 实验室库存管理系统 (LIMS)

轻量级、高性能的实验室试剂/耗材管理系统。

## 📋 项目概述

构建一个轻量级、高性能的实验室试剂/耗材管理系统。核心解决重复录入问题，通过"订购单 -> 库存"的一键流转，实现对试剂生命周期的精细化管理。

### 核心特性

- **双轨制管理**: 耗材（短流程）vs 试剂（长流程）
- **CAS 号防重**: 自动检索库存中相同 CAS 号的剩余总量并预警
- **WAL 模式**: SQLite 并发写入优化

## 🛠 技术栈

| 层级 | 技术选型 |
|------|----------|
| 后端 | FastAPI + SQLModel + SQLite (WAL Mode) |
| 前端 | React + Shadcn/UI + TanStack Table |
| 图片处理 | Pillow (<100KB 压缩) |
| 数据处理 | Pandas (Excel 导入/导出) |
| 认证 | JWT (RS256) |

## 📁 项目结构

```
LabStorageManager/
├── app/
│   ├── main.py                 # FastAPI 入口
│   ├── database.py             # SQLModel + WAL 模式配置
│   ├── core/
│   │   └── auth.py             # JWT 认证模块
│   ├── models/
│   │   ├── user.py             # 用户模型
│   │   ├── reagent_order.py    # 试剂订单模型
│   │   ├── consumable_order.py # 耗材订单模型
│   │   └── inventory.py        # 库存模型 + BorrowLog
│   ├── api/
│   │   ├── users.py            # 用户 API
│   │   ├── reagent_orders.py   # 试剂订单 API
│   │   ├── consumable_orders.py# 耗材订单 API
│   │   └── inventory.py        # 库存 API
│   └── services/
│       ├── cas_utils.py         # CAS 号标准化
│       ├── spec_utils.py        # 规格解析
│       ├── internal_code.py     # 内部编码生成
│       └── image_service.py     # 图片压缩服务
├── frontend/
│   └── src/
│       ├── pages/
│       │   ├── ReagentOrders.tsx   # 试剂订购页
│       │   ├── ConsumableOrders.tsx # 耗材订购页
│       │   └── ...
│       └── api/
│           └── client.ts        # API 客户端
├── prompt/                      # 需求文档
│   ├── PRD.md                   # 产品需求文档
│   ├── BACKEND_STRUCTURE.md     # 后端架构设计
│   ├── APP_FLOW.md              # 应用流程
│   ├── MAPPING_TABLE.md         # 前后端枚举映射
│   ├── Progress.md              # 开发进度
│   └── Lessons.md               # 经验教训
└── static/                      # 图片存储目录
```

## 🚀 快速启动

```bash
# 1. 安装依赖
pip install fastapi uvicorn sqlmodel pydantic pillow pandas openpyxl

# 2. 启动服务
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# 3. 访问 API 文档
# http://localhost:8000/docs
```

## 📊 数据库设计

### Order Status (订购单状态)
| 后端值 | 前端展示 |
|--------|----------|
| pending | 已申购 |
| approved | 已审批 |
| arrived | 已到货 |
| stocked | 已入库 |
| rejected | 未通过 |

### Order Reason (订购原因)
| 后端值 | 前端展示 |
|--------|----------|
| none | 没有 |
| running_out | 快用完 |
| empty | 用完 |
| common_public | 常用或公用 |
| not_found | 找不到 |
| reorder | 重新下单 |

### Inventory Status (库存状态)
| 后端值 | 前端展示 |
|--------|----------|
| in_stock | 在库 |
| borrowed | 已借出 |
| consumed | 已耗尽 |

## 🔑 核心 API

### 订购单管理
- `POST /api/orders/` - 创建订购单
- `GET /api/orders/` - 列表订购单
- `POST /api/orders/{id}/approve` - 审批
- `POST /api/orders/{id}/reject` - 驳回
- `POST /api/orders/{id}/confirm-arrival` - 确认到货
- `POST /api/orders/{id}/stock-in` - 一键入库

### 库存管理
- `GET /api/inventory/` - 列表库存
- `POST /api/inventory/{id}/borrow` - 借用
- `POST /api/inventory/{id}/return` - 归还
- `GET /api/inventory/cas/{cas_number}` - CAS 号查询
- `GET /api/inventory/export` - 导出CSV

### Dashboard
- `GET /api/inventory/dashboard/my-borrows` - 我的借用
- `GET /api/inventory/dashboard/pending-stockin` - 待入库
- `GET /api/orders/dashboard/arrived-orders` - 已到货待入库

## 📝 关键规则

### CAS 号标准化
```python
# 输入: "64-17-5" / "64 17 5" / "64175"
# 输出: "64175" (统一格式)
```

### CAS 号管理
CAS 号是试剂的唯一标识符，系统通过 CAS 号进行：
- 重复入库检测
- 库存总量计算
- 低库存预警

### 图片处理
- 上传时自动压缩至 <100KB
- 生成缩略图存入文件系统
- 数据库仅存储 URL 路径

## 📖 文档链接

- [PRD (产品需求)](prompt/PRD.md)
- [后端架构](prompt/BACKEND_STRUCTURE.md)
- [应用流程](prompt/APP_FLOW.md)
- [开发进度](prompt/Progress.md)
- [经验教训](prompt/Lessons.md)

## 📅 开发进度

| Phase | Status | Description |
|-------|--------|-------------|
| 1.1 | ✅ | 后端初始化 (FastAPI + SQLModel + WAL) |
| 1.2 | ✅ | JWT 认证 (RS256) |
| 2.1-2.4 | ✅ | Order/Inventory CRUD, CAS Check, Stock-In |
| 2.5 | ✅ | 工作流调整 (ARRIVED 状态, 确认到货) |
| 3 | ✅ | Dashboard APIs |
| 4 | ✅ | Excel 导入/导出 |
| 5 | ✅ | Frontend 页面 (Login, Dashboard, Orders, Inventory, Import) |
| 6 | ✅ | 手动入库功能 |
| 7 | ✅ | Admin 用户管理 |
| 8 | ✅ | 通知系统 (CAS预警、入库提醒、低库存、超时提醒) |
| 9 | ✅ | 数据库 Schema 优化 (外键改为 user.id) |
| 10 | ✅ | UI 改进 (侧边栏折叠、主题切换、密码可见性) |

## 📄 许可证

Apache License 2.0
