# IMPLEMENTATION_PLAN.md

## Phase 6: Admin User Management (基础版)

### 需求确认
- 用户列表（分页）
- 创建用户（username, password, full_name, role）
- 编辑用户（username, full_name, role）
- 软删除（is_active = False）
- 修改角色（admin / user）

### APIs

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/admin/users` | GET | 用户列表（分页） |
| `/api/admin/users` | POST | 创建用户 |
| `/api/admin/users/{id}` | PUT | 编辑用户 |
| `/api/admin/users/{id}` | DELETE | 软删除（禁用） |
| `/api/admin/users/{id}/activate` | POST | 启用用户 |
| `/api/admin/users/{id}/role` | PUT | 修改角色 |

### 后端任务
1. `app/api/admin.py` - Admin 路由
2. `app/core/admin.py` - Admin 权限依赖
3. 复用现有 User 模型

### 前端任务
1. `AdminUsersPage.tsx` - 用户管理页面
2. `CreateUserModal.tsx` - 创建用户弹窗
3. `EditUserDialog.tsx` - 编辑用户弹窗

### 实现顺序
1. Admin 权限依赖
2. Admin 路由和 CRUD API
3. Admin 页面布局
4. 用户表格组件
5. 创建/编辑弹窗

---

## Phase 2.6: Confirm Arrival Optimization (已完成)

### 优化逻辑
**POST /api/orders/{id}/confirm-arrival**

| 订单类型 | 订购原因 | 处理方式 |
|---------|---------|---------|
| consumable | 任意 | 直接完成 (status = stocked) |
| reagent | common_public | 直接完成 (status = stocked) |
| reagent | 其他 | 状态 = ARRIVED，待入库 |

### 实现时间
- 2026-02-13

### Git Commit
`a446da3` - feat: 优化确认收货逻辑，consumable和common_public直接完成
