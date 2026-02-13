# IMPLEMENTATION_PLAN.md

## Phase 6: Admin Management - Detailed Design

### 6.1 User Management API Design

#### User Model Extensions (Optional - for Phase 6)
- `last_login`: datetime (Nullable)
- `login_count`: int (Default 0)
- `department`: string (Nullable)
- `phone`: string (Nullable)
- `email`: string (Nullable)

#### User Management APIs (Admin Only)

| Endpoint | Method | Description | Auth |
|----------|--------|-------------|------|
| `/api/admin/users` | GET | List users with pagination & filters | Admin |
| `/api/admin/users` | POST | Create new user | Admin |
| `/api/admin/users/{id}` | GET | Get user details | Admin |
| `/api/admin/users/{id}` | PUT | Update user | Admin |
| `/api/admin/users/{id}` | DELETE | Deactivate user (soft delete) | Admin |
| `/api/admin/users/{id}/activate` | POST | Activate deactivated user | Admin |
| `/api/admin/users/{id}/reset-password` | POST | Reset user password | Admin |
| `/api/admin/users/{id}/role` | PUT | Update user role | Admin |

#### Query Parameters for GET `/api/admin/users`
- `page`: int (default 1)
- `page_size`: int (default 20)
- `role`: string (filter by role: "admin" | "user")
- `is_active`: bool (filter by status)
- `search`: string (search by username/full_name)

#### GET Response Example
```json
{
  "data": [
    {
      "id": 1,
      "username": "admin",
      "full_name": "管理员",
      "role": "admin",
      "is_active": true,
      "created_at": "2026-02-12T10:00:00"
    }
  ],
  "total": 50,
  "page": 1,
  "page_size": 20
}
```

#### POST /api/admin/users Request Body
```json
{
  "username": "newuser",
  "password": "securepassword123",
  "full_name": "新用户",
  "role": "user",
  "department": "实验室A",
  "phone": "13800138000",
  "email": "user@example.com"
}
```

---

### 6.2 User Statistics API

| Endpoint | Method | Description | Auth |
|----------|--------|-------------|------|
| `/api/admin/users/stats` | GET | User statistics | Admin |
| `/api/admin/users/{id}/activity` | GET | User activity log | Admin |

#### GET /api/admin/users/stats Response
```json
{
  "total_users": 50,
  "active_users": 45,
  "inactive_users": 5,
  "admins": 3,
  "regular_users": 47,
  "recent_logins_7d": 30
}
```

---

### 6.3 Activity/Audit Log API

#### AuditLog Model
- `id`: int, PK
- `user_id`: FK -> User
- `action`: string (e.g., "order_create", "inventory_borrow", "user_login")
- `resource_type`: string (e.g., "order", "inventory", "user")
- `resource_id`: int
- `details`: JSON (Nullable)
- `ip_address`: string (Nullable)
- `created_at`: datetime

#### Audit Log APIs

| Endpoint | Method | Description | Auth |
|----------|--------|-------------|------|
| `/api/admin/audit-logs` | GET | List audit logs with filters | Admin |
| `/api/admin/audit-logs/stats` | GET | Audit log statistics | Admin |

#### Query Parameters for GET `/api/admin/audit-logs`
- `user_id`: int (filter by user)
- `action`: string (filter by action type)
- `resource_type`: string (e.g., "order", "inventory", "user")
- `start_date`: datetime
- `end_date`: datetime
- `page`: int (default 1)
- `page_size`: int (default 20)

#### GET /api/admin/audit-logs Response Example
```json
{
  "data": [
    {
      "id": 1,
      "user_id": 2,
      "username": "testuser",
      "action": "order_create",
      "resource_type": "order",
      "resource_id": 15,
      "ip_address": "192.168.1.100",
      "created_at": "2026-02-13T10:30:00"
    }
  ],
  "total": 100,
  "page": 1,
  "page_size": 20
}
```

---

### 6.4 Frontend: Admin User Management Page

#### Features
- User list table with sorting/filtering
- Create user modal
- Edit user dialog
- Reset password dialog
- Toggle user active status
- Change user role
- User activity view

#### UI Components
- `UsersTable.tsx` - TanStack Table with all columns
- `CreateUserModal.tsx` - Form to create new user
- `EditUserDialog.tsx` - Dialog to edit user details
- `ResetPasswordDialog.tsx` - Dialog to reset user password
- `UserActivityLog.tsx` - Show user's activity history

#### Users Table Columns
| Column | Description |
|--------|-------------|
| username | 用户名 |
| full_name | 姓名 |
| role | 角色 (admin/user) |
| department | 部门 |
| is_active | 状态 |
| created_at | 创建时间 |
| last_login | 最后登录 |
| actions | 操作 |

#### Actions Menu
- 查看详情
- 编辑
- 重置密码
- 启用/禁用
- 修改角色
- 查看活动日志

---

## Implementation Order for Phase 6

1. **Backend First**
   - Add User model extensions (optional fields)
   - Create AuditLog model
   - Implement admin middleware/dependency
   - Implement User Management APIs
   - Implement Audit Log APIs
   - Add auto-logging for critical actions

2. **Frontend Second**
   - Admin layout with sidebar
   - Users table page
   - Create/Edit user dialogs
   - Reset password dialog
   - Audit log viewer page

---

## Critical Rules for Phase 6

1. **Permission Check**: All admin endpoints must verify `current_user.role == "admin"`
2. **Soft Delete**: Never hard delete users, set `is_active = False`
3. **Audit Trail**: Log all critical actions (create/update/delete)
4. **Password Security**: Admin can reset but not view passwords
5. **Pagination**: All list endpoints must support pagination
