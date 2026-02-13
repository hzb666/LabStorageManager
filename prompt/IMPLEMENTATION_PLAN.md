# IMPLEMENTATION_PLAN.md - LIMS 系统实现计划

---

## Phase 1: Infrastructure (已完成) ✅

### 1.1 FastAPI + SQLModel + SQLite (WAL Mode) ✅
- **实现**: `app/database.py`
- **WAL Mode**: `?mode=wal` 配置
- **Git**: 初始提交

### 1.2 User Model & JWT Auth ✅
- **文件**: `app/models/user.py`, `app/core/auth.py`
- **功能**:
  - User 模型 (username, password_hash, role, full_name, is_active)
  - JWT token 创建和验证
  - 密码加密 (bcrypt)
- **API**:
  - `POST /users/auth/login` - 登录

### 1.3 Image Service (Pillow <100KB) ✅
- **文件**: `app/services/image_service.py`
- **功能**: 图片压缩至 <100KB, 生成缩略图

### 1.4 CAS Utility (normalize_cas) ✅
- **文件**: `app/services/cas_utils.py`
- **功能**: CAS 号标准化 (去除空格, 大写)

---

## Phase 2: Ordering & Inventory Core (已完成) ✅

### 2.1 Order CRUD API ✅

| Endpoint | Method | Status |
|----------|--------|--------|
| `/orders/` | POST | ✅ |
| `/orders/` | GET | ✅ |
| `/orders/{id}` | GET | ✅ |
| `/orders/{id}` | PUT | ✅ |
| `/orders/{id}` | DELETE | ✅ |
| `/orders/{id}/upload-image` | POST | ✅ |

### 2.2 CAS Check API ✅

| Endpoint | Method | Status |
|----------|--------|--------|
| `/inventory/cas/{cas_number}` | GET | ✅ |
| `/inventory/cas/{cas_number}/total` | GET | ✅ |

### 2.3 Inventory CRUD API (Borrow/Return) ✅

| Endpoint | Method | Status |
|----------|--------|--------|
| `/inventory/` | GET | ✅ |
| `/inventory/{id}` | GET | ✅ |
| `/inventory/{id}` | PUT | ✅ |
| `/inventory/{id}` | DELETE | ✅ |
| `/inventory/code/{code}` | GET | ✅ |
| `/inventory/{id}/borrow` | POST | ✅ |
| `/inventory/{id}/return` | POST | ✅ |

### 2.4 Stock-In Logic ✅

| Endpoint | Method | Status |
|----------|--------|--------|
| `/orders/{id}/stock-in` | POST | ✅ |

**逻辑**:
- Order → Inventory 转换 (Copy 数据, 不删除 Order)
- 生成 N 条 Inventory (N = order.quantity)
- Internal Code: `CAS号-日期-序号`

### 2.5 Order Workflow (Confirm Arrival) ✅

| Endpoint | Method | Status |
|----------|--------|--------|
| `/orders/{id}/approve` | POST | ✅ (Admin) |
| `/orders/{id}/reject` | POST | ✅ (Admin) |
| `/orders/{id}/confirm-arrival` | POST | ✅ |

### 2.6 Confirm Arrival Optimization ✅ (2026-02-13)

**优化逻辑** (`/orders/{id}/confirm-arrival`):

| 订单类型 | 订购原因 | 处理方式 |
|---------|---------|---------|
| consumable | 任意 | 直接完成 (status = stocked) |
| reagent | common_public | 直接完成 (status = stocked) |
| reagent | 其他 | 状态 = ARRIVED，待入库 |

---

## Phase 3: User Dashboard (已完成) ✅

### 3.1 Dashboard APIs ✅

| Endpoint | Method | Status |
|----------|--------|--------|
| `/orders/dashboard/my-orders` | GET | ✅ |
| `/orders/dashboard/arrived-orders` | GET | ✅ |
| `/inventory/dashboard/my-borrows` | GET | ✅ |
| `/inventory/dashboard/pending-stockin` | GET | ✅ |

### 3.2 Return Item API ✅

- `POST /inventory/{id}/return` - 归还物品
- 低量预警 (< 20%)
- BorrowLog 记录

### 3.3 Frontend Dashboard ✅

| 功能 | 文件 | 状态 |
|------|------|------|
| 统计卡片 | `Dashboard.tsx` | ✅ |
| 我的订单 | `Dashboard.tsx` | ✅ |
| 当前借用 | `Dashboard.tsx` | ✅ |
| 待入库 | `Dashboard.tsx` | ✅ |
| 归还 Modal | `Dashboard.tsx` | ✅ |

---

## Phase 4: Excel Import (已完成) ✅

### 4.1 Backend Excel Service ✅

| Endpoint | Method | Status |
|----------|--------|--------|
| `/inventory/import/template` | GET | ✅ |
| `/inventory/import` | POST | ✅ (Admin) |

### 4.2 Frontend Excel UI ✅

| 功能 | 文件 | 状态 |
|------|------|------|
| 导入页面 | `Import.tsx` | ✅ |
| 模板下载 | `Import.tsx` | ✅ |
| 进度显示 | `Import.tsx` | ✅ |
| 错误展示 | `Import.tsx` | ✅ |

---

## Phase 5: Frontend Pages (已完成) ✅

### 5.1 React + Shadcn/UI + TanStack Table ✅
- **文件**: `frontend/src/App.tsx`, `frontend/src/main.tsx`
- **组件**: Button, Card, Input, Layout

### 5.2 Order Form with CAS Auto-check ✅
| 功能 | 文件 | 状态 |
|------|------|------|
| 订单表单 | `Orders.tsx` | ✅ |
| CAS 校验 | `Orders.tsx` | ✅ |
| 图片上传 | `Orders.tsx` | ✅ |

### 5.3 Inventory Table ✅
| 功能 | 文件 | 状态 |
|------|------|------|
| 库存表格 | `Inventory.tsx` | ✅ |
| 排序筛选 | `Inventory.tsx` | ✅ |
| 危险品标记 | `Inventory.tsx` | ✅ |
| 低量预警 | `Inventory.tsx` | ✅ |

---

## Phase 6: Admin User Management (待实现)

### 6.1 Admin APIs (待实现)

| Endpoint | Method | Status | Description |
|----------|--------|--------|-------------|
| `/admin/users` | GET | ⏳ | 用户列表（分页） |
| `/admin/users` | POST | ⏳ | 创建用户 |
| `/admin/users/{id}` | PUT | ⏳ | 编辑用户 |
| `/admin/users/{id}` | DELETE | ⏳ | 软删除（禁用） |
| `/admin/users/{id}/activate` | POST | ⏳ | 启用用户 |
| `/admin/users/{id}/role` | PUT | ⏳ | 修改角色 |

### 6.2 Frontend Admin Page (待实现)

| 功能 | 文件 | 状态 |
|------|------|------|
| 用户列表 | `AdminUsers.tsx` | ⏳ |
| 创建用户弹窗 | `CreateUserModal.tsx` | ⏳ |
| 编辑用户弹窗 | `EditUserDialog.tsx` | ⏳ |

---

## Phase 7: Notifications (待实现)

### 7.1 Notification Features (待实现)
- [ ] 入库提醒 (order arrives)
- [ ] 低库存警告
- [ ] 借用/归还通知

---

## 已实现 API 完整列表

### Users API
- `POST /users/auth/login` - 登录
- `POST /users/` - 创建用户
- `GET /users/` - 用户列表
- `GET /users/me` - 当前用户
- `GET /users/{id}` - 用户详情
- `PUT /users/{id}` - 更新用户
- `DELETE /users/{id}` - 删除用户

### Orders API
- `POST /orders/` - 创建订单
- `GET /orders/` - 订单列表
- `GET /orders/{id}` - 订单详情
- `PUT /orders/{id}` - 更新订单
- `DELETE /orders/{id}` - 删除订单
- `POST /orders/{id}/upload-image` - 上传图片
- `POST /orders/{id}/approve` - 审批订单
- `POST /orders/{id}/reject` - 驳回订单
- `POST /orders/{id}/confirm-arrival` - 确认到货
- `POST /orders/{id}/stock-in` - 一键入库
- `GET /orders/dashboard/my-orders` - 我的订单
- `GET /orders/dashboard/arrived-orders` - 已到货订单

### Inventory API
- `GET /inventory/` - 库存列表
- `GET /inventory/{id}` - 库存详情
- `GET /inventory/code/{code}` - 按编码查询
- `GET /inventory/cas/{cas}` - CAS 库存查询
- `GET /inventory/cas/{cas}/total` - CAS 总量
- `PUT /inventory/{id}` - 更新库存
- `DELETE /inventory/{id}` - 删除库存
- `POST /inventory/{id}/borrow` - 借用物品
- `POST /inventory/{id}/return` - 归还物品
- `GET /inventory/{id}/borrow-history` - 借用历史
- `GET /inventory/dashboard/my-borrows` - 我的借用
- `GET /inventory/dashboard/pending-stockin` - 待入库
- `GET /inventory/import/template` - 导入模板
- `POST /inventory/import` - 批量导入

---

## 技术栈

### Backend
- FastAPI
- SQLModel (SQLAlchemy + Pydantic)
- SQLite (WAL Mode)
- JWT (Python-jose)
- Passlib (bcrypt)
- Pillow (图片压缩)
- Pandas (Excel 处理)

### Frontend
- React 18 + TypeScript
- Vite
- Shadcn/UI + Tailwind CSS
- TanStack Table
- Axios
- Zustand (状态管理)
