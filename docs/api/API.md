# Lab Storage Manager API 文档

实验室库存管理系统 (LIMS) RESTful API 文档

## 概述

Lab Storage Manager 是一个面向实验室的库存管理系统，支持以下核心功能：
- 试剂和耗材的采购订单管理
- 库存物品的借出/归还
- 用户认证与会话管理
- 管理员权限控制

Base URL: `http://localhost:8000/api`

---

## 认证方式

本系统使用 **JWT Token** 进行身份认证。

### 认证流程

1. 登录获取 Token：`POST /api/users/login`
2. Token 通过 HTTPOnly Cookie 自动存储在客户端
3. 所有需要认证的接口会自动读取 Cookie

### 认证失败

返回 `401 Unauthorized`，需要重新登录。

---

## 用户管理 API

### 用户登录

**端点:** `POST /api/users/login`

用户登录系统，获取认证 Token。

**请求体:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| username | string | 是 | 用户名 |
| password | string | 是 | 密码 |
| device_id | string | 否 | 设备标识符 |
| device_name | string | 否 | 设备名称，默认 "Unknown Device" |

**响应 (200):**

```json
{
  "token_type": "bearer",
  "user": {
    "id": 1,
    "username": "admin",
    "full_name": "管理员",
    "role": "admin",
    "is_active": true
  }
}
```

**错误响应:**

| 状态码 | 说明 |
|--------|------|
| 401 | 用户名或密码错误 |
| 403 | 用户账号已禁用 |
| 429 | 登录尝试过多，请 5 分钟后重试 |

---

### 用户登出

**端点:** `POST /api/users/logout`

清除认证 Cookie 和会话。

**响应 (200):**

```json
{
  "message": "Logged out successfully"
}
```

---

### 获取当前用户

**端点:** `GET /api/users/me`

获取当前已认证用户的信息。

**需要认证:** 是

**响应 (200):**

```json
{
  "id": 1,
  "username": "admin",
  "full_name": "管理员",
  "role": "admin",
  "is_active": true,
  "created_at": "2024-01-01T00:00:00Z"
}
```

---

### 修改密码

**端点:** `POST /api/users/change-password`

修改当前用户的密码。

**需要认证:** 是

**请求体:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| old_password | string | 是 | 原密码 |
| new_password | string | 是 | 新密码（至少6位） |

**响应 (200):**

```json
{
  "message": "密码修改成功"
}
```

**错误响应:**

| 状态码 | 说明 |
|--------|------|
| 400 | 原密码错误 |

---

### 获取用户列表

**端点:** `GET /api/users/`

获取所有用户列表（仅管理员）。

**需要认证:** 是（管理员）

**查询参数:**

| 参数 | 类型 | 说明 |
|------|------|------|
| skip | int | 分页偏移，默认 0 |
| limit | int | 返回数量，默认 100 |
| username | string | 按用户名模糊搜索 |
| role | string | 按角色筛选 (admin/user) |
| is_active | bool | 按激活状态筛选 |

**响应 (200):**

```json
{
  "data": [
    {
      "id": 1,
      "username": "admin",
      "full_name": "管理员",
      "role": "admin",
      "is_active": true
    }
  ],
  "total": 1
}
```

---

### 创建用户

**端点:** `POST /api/users/`

创建新用户（仅管理员）。

**需要认证:** 是（管理员）

**请求体:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| username | string | 是 | 用户名（唯一） |
| password | string | 是 | 密码（至少6位） |
| full_name | string | 否 | 姓名 |
| role | string | 是 | 角色 (admin/user) |

**响应 (201):**

```json
{
  "id": 2,
  "username": "newuser",
  "full_name": "新用户",
  "role": "user",
  "is_active": true
}
```

---

### 获取指定用户

**端点:** `GET /api/users/{user_id}`

根据 ID 获取用户信息。

**需要认证:** 是

**响应 (200):**

```json
{
  "id": 1,
  "username": "admin",
  "full_name": "管理员",
  "role": "admin",
  "is_active": true
}
```

**错误响应:**

| 状态码 | 说明 |
|--------|------|
| 404 | 用户不存在 |

---

### 更新用户

**端点:** `PUT /api/users/{user_id}`

更新用户信息。

**需要认证:** 是（用户本人或管理员）

**请求体:**

| 字段 | 类型 | 说明 |
|------|------|------|
| full_name | string | 姓名 |
| username | string | 用户名 |
| is_active | bool | 是否激活 |

**响应 (200):**

```json
{
  "id": 1,
  "username": "admin",
  "full_name": "管理员",
  "role": "admin",
  "is_active": true
}
```

---

### 激活用户

**端点:** `POST /api/users/{user_id}/activate`

激活被禁用的用户账号（仅管理员）。

**需要认证:** 是（管理员）

**响应 (200):**

```json
{
  "id": 1,
  "username": "admin",
  "full_name": "管理员",
  "role": "admin",
  "is_active": true
}
```

---

### 删除用户

**端点:** `DELETE /api/users/{user_id}`

禁用用户账号（软删除，仅管理员）。

**需要认证:** 是（管理员）

**响应:** `204 No Content`

**错误响应:**

| 状态码 | 说明 |
|--------|------|
| 400 | 不能禁用自己 |

---

### 更新用户角色

**端点:** `PUT /api/users/{user_id}/role?role={role}`

更新用户角色（仅管理员）。

**需要认证:** 是（管理员）

**查询参数:**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| role | string | 是 | 新角色 (admin/user) |

**响应 (200):**

```json
{
  "id": 1,
  "username": "admin",
  "full_name": "管理员",
  "role": "admin",
  "is_active": true
}
```

---

### 重置用户密码

**端点:** `POST /api/users/{user_id}/reset-password`

管理员重置用户密码（不需要原密码）。

**需要认证:** 是（管理员）

**请求体:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| new_password | string | 是 | 新密码（至少6位） |

**响应 (200):**

```json
{
  "message": "密码重置成功"
}
```

---

## 库存管理 API

### 获取库存列表

**端点:** `GET /api/inventory/`

获取库存物品列表，支持多种筛选和排序方式。

**需要认证:** 是

**查询参数:**

| 参数 | 类型 | 说明 |
|------|------|------|
| skip | int | 分页偏移，默认 0 |
| limit | int | 分页大小，默认 0 表示返回全部 |
| status_filter | string | 状态筛选 (in_stock/borrowed/consumed) |
| cas_filter | string | CAS 号精确筛选 |
| hazardous_only | bool | 仅危险品 |
| search | string | 搜索关键词 |
| search_field | string | 精确搜索字段 (name/cas_number/storage_location/brand/category) |
| fuzzy | bool | 模糊搜索模式，忽略空格和连字符 |
| sort_by | string | 排序字段 |
| sort_order | string | 排序方向 (asc/desc) |

**支持排序字段:**
- `cas_number` - CAS 号
- `name` - 名称（支持中文拼音排序）
- `category` - 分类
- `storage_location` - 存放位置
- `brand` - 品牌
- `remaining_quantity` - 剩余数量
- `remaining_percent` - 剩余百分比
- `initial_quantity` - 初始数量
- `status` - 状态
- `created_at` - 创建时间
- `updated_at` - 更新时间

**响应 (200):**

```json
{
  "data": [
    {
      "id": 1,
      "internal_code": "R001-0001",
      "cas_number": "64-17-5",
      "name": "乙醇",
      "english_name": "Ethanol",
      "category": "有机溶剂",
      "brand": "Sigma",
      "storage_location": "A-1-1",
      "initial_quantity": 500,
      "remaining_quantity": 500,
      "unit": "ml",
      "status": "in_stock",
      "is_hazardous": true,
      "borrower_name": null,
      "created_by_name": "管理员"
    }
  ],
  "total": 100,
  "skip": 0,
  "limit": 0
}
```

---

### 获取库存详情

**端点:** `GET /api/inventory/{inventory_id}`

根据 ID 获取库存物品详情。

**需要认证:** 是

**响应 (200):**

```json
{
  "id": 1,
  "internal_code": "R001-0001",
  "cas_number": "64-17-5",
  "name": "乙醇",
  "english_name": "Ethanol",
  "category": "有机溶剂",
  "brand": "Sigma",
  "storage_location": "A-1-1",
  "initial_quantity": 500,
  "remaining_quantity": 500,
  "unit": "ml",
  "status": "in_stock",
  "is_hazardous": true,
  "specification": "500 ml"
}
```

---

### 按内部编码查询

**端点:** `GET /api/inventory/code/{internal_code}`

根据内部编码查询库存物品。

**需要认证:** 是

**响应 (200):** 同上

**错误响应:**

| 状态码 | 说明 |
|--------|------|
| 404 | 库存物品不存在 |

---

### 按 CAS 号查询

**端点:** `GET /api/inventory/cas/{cas_number}`

根据 CAS 号查询所有库存状态。

**需要认证:** 是

**响应 (200):**

```json
{
  "cas_number": "64-17-5",
  "exists_in_inventory": true,
  "total_remaining": 1500,
  "in_stock_count": 2,
  "borrowed_count": 1,
  "items": [
    {
      "id": 1,
      "name": "乙醇",
      "storage_location": "A-1-1",
      "remaining_quantity": 500,
      "unit": "ml",
      "status": "in_stock"
    }
  ]
}
```

---

### 获取 CAS 号总剩余量

**端点:** `GET /api/inventory/cas/{cas_number}/total`

获取指定 CAS 号的总剩余数量。

**需要认证:** 是

**响应 (200):**

```json
{
  "cas_number": "64-17-5",
  "total_remaining": 1500
}
```

---

### 创建库存物品

**端点:** `POST /api/inventory/manual-add`

手动添加库存物品（不通过订单流程）。

**需要认证:** 是

**请求体:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| cas_number | string | 是 | CAS 号 |
| name | string | 是 | 名称 |
| english_name | string | 否 | 英文名称 |
| alias | string | 否 | 别名 |
| category | string | 否 | 分类 |
| brand | string | 否 | 品牌 |
| specification | string | 是 | 规格（如 "500 ml"） |
| quantity_bottles | int | 是 | 数量（瓶数） |
| storage_location | string | 否 | 存放位置 |
| is_hazardous | bool | 否 | 是否危险品 |
| notes | string | 否 | 备注 |

**响应 (201):**

```json
{
  "message": "Manual stock-in successful",
  "items_created": 3,
  "item_ids": [1, 2, 3]
}
```

---

### 更新库存物品

**端点:** `PUT /api/inventory/{inventory_id}`

更新库存物品信息。

**需要认证:** 是

**请求体:**

| 字段 | 类型 | 说明 |
|------|------|------|
| name | string | 名称 |
| english_name | string | 英文名称 |
| alias | string | 别名 |
| category | string | 分类 |
| brand | string | 品牌 |
| storage_location | string | 存放位置 |
| is_hazardous | bool | 是否危险品 |
| notes | string | 备注 |

**响应 (200):**

```json
{
  "id": 1,
  "name": "乙醇（更新）",
  ...
}
```

---

### 删除库存物品

**端点:** `DELETE /api/inventory/{inventory_id}`

删除库存物品（仅管理员）。

**需要认证:** 是（管理员）

**响应:** `204 No Content`

---

### 借用库存

**端点:** `POST /api/inventory/{inventory_id}/borrow`

借用库存物品。

**需要认证:** 是

**前置条件:** 物品状态必须为 `in_stock`

**响应 (200):**

```json
{
  "id": 1,
  "status": "borrowed",
  "borrower_id": 1,
  ...
}
```

**错误响应:**

| 状态码 | 说明 |
|--------|------|
| 400 | 物品不在库，无法借用 |
| 404 | 库存物品不存在 |

---

### 归还库存

**端点:** `POST /api/inventory/{inventory_id}/return`

归还借用的库存物品。

**需要认证:** 是

**请求体:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| remaining_quantity | float | 是 | 剩余数量 |
| unit | string | 否 | 单位 |

**前置条件:** 物品状态必须为 `borrowed`，且归还人必须是借用人或管理员

**响应 (200):**

```json
{
  "id": 1,
  "status": "in_stock",
  "remaining_quantity": 450,
  "unit": "ml",
  "warning": "剩余量仅剩 90.0%，请及时补充"
}
```

**说明:** 如果剩余量低于初始量的 20%，会返回警告信息。

---

### 获取借用历史

**端点:** `GET /api/inventory/{inventory_id}/borrow-history`

获取库存物品的借用历史记录（最近10条）。

**需要认证:** 是

**响应 (200):**

```json
{
  "inventory_id": 1,
  "name": "乙醇",
  "history": [
    {
      "id": 1,
      "borrower_id": 1,
      "borrow_time": "2024-01-01T00:00:00Z",
      "return_time": "2024-01-05T00:00:00Z",
      "quantity_borrowed": 500,
      "quantity_returned": 450
    }
  ]
}
```

---

### 获取我的借用

**端点:** `GET /api/inventory/dashboard/my-borrows`

获取当前用户借用的所有物品。

**需要认证:** 是

**响应 (200):**

```json
{
  "data": [
    {
      "inventory_id": 1,
      "name": "乙醇",
      "cas_number": "64-17-5",
      "remaining_quantity": 500,
      "unit": "ml",
      "borrow_time": "2024-01-01T00:00:00Z",
      "borrow_days": 3,
      "is_overdue": false
    }
  ],
  "total": 1,
  "overdue_count": 0
}
```

**说明:** 借用超过 3 天会标记为逾期 (is_overdue: true)。

---

### 获取待入库列表

**端点:** `GET /api/inventory/dashboard/pending-stockin`

获取等待分配存放位置的物品列表（当前用户为临时保管人）。

**需要认证:** 是

**响应 (200):**

```json
{
  "data": [
    {
      "inventory_id": 1,
      "name": "乙醇",
      "cas_number": "64-17-5",
      "initial_quantity": 500,
      "unit": "ml",
      "stockin_time": "2024-01-01T00:00:00Z"
    }
  ],
  "total": 1
}
```

---

### 导出库存

**端点:** `GET /api/inventory/export`

导出所有库存数据为 CSV 文件（仅管理员）。

**需要认证:** 是（管理员）

**响应:** `text/csv` 流

**响应头:**

```
Content-Disposition: attachment; filename=inventory_export_20240101_120000.csv
```

---

### 获取导入模板

**端点:** `GET /api/inventory/import/template`

获取 Excel 导入模板结构。

**需要认证:** 是（管理员）

**响应 (200):**

```json
{
  "columns": ["CAS号", "名称", "英文名", ...],
  "required": ["CAS号", "名称", "规格", "数量"],
  "format": {
    "CAS号": "XXX-XX-X",
    "数量": "数字"
  }
}
```

---

### 导入库存

**端点:** `POST /api/inventory/import`

从 Excel 文件导入库存（仅管理员）。

**需要认证:** 是（管理员）

**表单参数:**

| 参数 | 类型 | 说明 |
|------|------|------|
| file | file | Excel 文件 (.xlsx, .xls, .csv) |
| default_storage_location | string | 默认存放位置 |
| default_is_hazardous | bool | 默认是否危险品 |

**文件限制:**
- 最大文件大小: 10MB
- 支持格式: .xlsx, .xls, .csv

**响应 (200):**

```json
{
  "message": "Import completed",
  "success": true,
  "total_rows": 100,
  "created": 95,
  "errors_count": 5,
  "errors": [
    {"row": 5, "error": "Invalid CAS format"}
  ]
}
```

---

## 试剂订单 API

### 创建试剂订单

**端点:** `POST /api/reagent-orders/`

创建新的试剂采购订单。

**需要认证:** 是

**请求体:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| cas_number | string | 是 | CAS 号 |
| name | string | 是 | 名称 |
| english_name | string | 否 | 英文名称 |
| alias | string | 否 | 别名 |
| category | string | 否 | 分类 |
| brand | string | 否 | 品牌 |
| specification | string | 是 | 规格（如 "500 ml"） |
| quantity | int | 是 | 数量（瓶数） |
| price | float | 否 | 价格 |
| order_reason | string | 是 | 申购原因 |
| is_hazardous | bool | 否 | 是否危险品 |

**order_reason 可选值:**
- `research` - 科研项目
- `teaching` - 教学实验
- `common_public` - 常用/公用
- `other` - 其他

**响应 (201):**

```json
{
  "id": 1,
  "cas_number": "64-17-5",
  "name": "乙醇",
  "status": "pending",
  "applicant_id": 1,
  "created_at": "2024-01-01T00:00:00Z"
}
```

---

### 获取试剂订单列表

**端点:** `GET /api/reagent-orders/`

获取试剂订单列表。

**需要认证:** 是

**查询参数:**

| 参数 | 类型 | 说明 |
|------|------|------|
| skip | int | 分页偏移，默认 0 |
| limit | int | 分页大小，默认 50 |
| status_filter | string | 状态筛选 |

**status_filter 可选值:**
- `pending` - 待审批
- `approved` - 已审批
- `rejected` - 已拒绝
- `arrived` - 已到货
- `stocked` - 已入库

**响应 (200):**

```json
{
  "data": [
    {
      "id": 1,
      "cas_number": "64-17-5",
      "name": "乙醇",
      "status": "pending",
      "applicant_id": 1,
      "applicant_name": "管理员",
      "created_at": "2024-01-01T00:00:00Z"
    }
  ],
  "total": 10,
  "skip": 0,
  "limit": 50
}
```

---

### 获取订单详情

**端点:** `GET /api/reagent-orders/{order_id}`

根据 ID 获取订单详情。

**需要认证:** 是

**响应 (200):**

```json
{
  "id": 1,
  "cas_number": "64-17-5",
  "name": "乙醇",
  "status": "pending",
  "quantity": 3,
  "price": 150.00,
  "order_reason": "research",
  "is_hazardous": true,
  "applicant_id": 1,
  "created_at": "2024-01-01T00:00:00Z"
}
```

---

### 更新订单

**端点:** `PUT /api/reagent-orders/{order_id}`

更新订单信息。

**需要认证:** 是

**请求体:**

| 字段 | 类型 | 说明 |
|------|------|------|
| name | string | 名称 |
| quantity | int | 数量 |
| price | float | 价格 |
| order_reason | string | 申购原因 |
| notes | string | 备注 |

**响应 (200):**

```json
{
  "id": 1,
  "status": "pending",
  ...
}
```

---

### 审批通过订单

**端点:** `POST /api/reagent-orders/{order_id}/approve`

审批通过试剂订单（仅管理员）。

**需要认证:** 是（管理员）

**前置条件:** 订单状态必须为 `pending`

**响应 (200):**

```json
{
  "id": 1,
  "status": "approved",
  ...
}
```

---

### 审批拒绝订单

**端点:** `POST /api/reagent-orders/{order_id}/reject`

拒绝试剂订单（仅管理员）。

**需要认证:** 是（管理员）

**前置条件:** 订单状态必须为 `pending`

**响应 (200):**

```json
{
  "id": 1,
  "status": "rejected",
  ...
}
```

---

### 确认到货

**端点:** `POST /api/reagent-orders/{order_id}/confirm-arrival`

确认试剂已到货。

**需要认证:** 是（订单申请人或管理员）

**请求体:**

| 字段 | 类型 | 说明 |
|------|------|------|
| arrival_notes | string | 到货备注 |

**业务逻辑:**
- 常用/公用试剂 (`common_public`): 直接完成，无需入库
- 其他原因: 状态变为 `arrived`，需要手动入库

**响应 (200):**

```json
{
  "message": "已到货待入库，请及时完成入库操作",
  "order_id": 1,
  "status": "arrived"
}
```

---

### 入库

**端点:** `POST /api/reagent-orders/{order_id}/stock-in`

将订单物品入库到库存。

**需要认证:** 是（订单申请人或管理员）

**前置条件:**
- 订单状态必须为 `approved` 或 `arrived`
- 不能是常用/公用试剂

**响应 (200):**

```json
{
  "message": "Stock-in successful",
  "order_id": 1,
  "items_created": 3,
  "inventory_ids": [1, 2, 3]
}
```

---

### 获取待入库订单

**端点:** `GET /api/reagent-orders/dashboard/arrived-orders`

获取所有已到货但未入库的订单。

**需要认证:** 是

**响应 (200):**

```json
{
  "data": [
    {
      "order_id": 1,
      "cas_number": "64-17-5",
      "name": "乙醇",
      "specification": "500 ml",
      "quantity": 3,
      "price": 150.00,
      "arrived_at": "2024-01-01T00:00:00Z"
    }
  ],
  "total": 1
}
```

---

### 获取我的订单

**端点:** `GET /api/reagent-orders/dashboard/my-orders`

获取当前用户的试剂订单进度。

**需要认证:** 是

**响应 (200):**

```json
{
  "data": {
    "pending": {
      "orders": [...],
      "count": 2,
      "label": "已申购"
    },
    "approved": {
      "orders": [...],
      "count": 1,
      "label": "已审批"
    },
    "arrived": {
      "orders": [...],
      "count": 1,
      "label": "已到货"
    }
  },
  "total": 4
}
```

---

### 上传订单图片

**端点:** `POST /api/reagent-orders/{order_id}/upload-image`

上传订单图片（自动压缩生成缩略图）。

**需要认证:** 是

**表单参数:**

| 参数 | 类型 | 说明 |
|------|------|------|
| file | file | 图片文件 |

**响应 (200):**

```json
{
  "message": "Image uploaded successfully",
  "image_url": "/static/images/xxx.jpg",
  "thumbnail_url": "/static/images/xxx_thumb.jpg"
}
```

---

### 删除订单

**端点:** `DELETE /api/reagent-orders/{order_id}`

删除试剂订单（仅订单申请人或管理员）。

**需要认证:** 是

**前置条件:** 订单状态必须为 `pending`

**响应:** `204 No Content`

---

## 耗材订单 API

### 创建耗材订单

**端点:** `POST /api/consumable-orders/`

创建新的耗材采购订单。

**需要认证:** 是

**请求体:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | 名称 |
| english_name | string | 否 | 英文名称 |
| alias | string | 否 | 别名 |
| category | string | 否 | 分类 |
| brand | string | 否 | 品牌 |
| specification | string | 是 | 规格 |
| quantity | int | 是 | 数量 |
| price | float | 否 | 价格 |
| order_reason | string | 是 | 申购原因 |
| is_hazardous | bool | 否 | 是否危险品 |

**响应 (201):**

```json
{
  "id": 1,
  "name": "离心管",
  "status": "pending",
  "applicant_id": 1,
  "created_at": "2024-01-01T00:00:00Z"
}
```

---

### 获取耗材订单列表

**端点:** `GET /api/consumable-orders/`

获取耗材订单列表。

**需要认证:** 是

**查询参数:** 同试剂订单

**响应 (200):** 同试剂订单格式

---

### 获取订单详情

**端点:** `GET /api/consumable-orders/{order_id}`

根据 ID 获取耗材订单详情。

**需要认证:** 是

**响应 (200):**

```json
{
  "id": 1,
  "name": "离心管",
  "status": "pending",
  "quantity": 100,
  "price": 50.00,
  "applicant_id": 1,
  "created_at": "2024-01-01T00:00:00Z"
}
```

---

### 更新订单

**端点:** `PUT /api/consumable-orders/{order_id}`

更新耗材订单信息。

**需要认证:** 是

**请求体:** 同创建

---

### 审批通过订单

**端点:** `POST /api/consumable-orders/{order_id}/approve`

审批通过耗材订单（仅管理员）。

**需要认证:** 是（管理员）

**前置条件:** 订单状态必须为 `pending`

---

### 审批拒绝订单

**端点:** `POST /api/consumable-orders/{order_id}/reject`

拒绝耗材订单（仅管理员）。

**需要认证:** 是（管理员）

**前置条件:** 订单状态必须为 `pending`

---

### 完成订单

**端点:** `POST /api/consumable-orders/{order_id}/complete`

完成耗材订单（耗材无需入库）。

**需要认证:** 是（订单申请人或管理员）

**前置条件:** 订单状态必须为 `approved`

**响应 (200):**

```json
{
  "message": "耗材订单已完成",
  "order_id": 1,
  "status": "completed"
}
```

---

### 获取我的订单

**端点:** `GET /api/consumable-orders/dashboard/my-orders`

获取当前用户的耗材订单进度。

**需要认证:** 是

**响应 (200):**

```json
{
  "data": {
    "pending": {
      "orders": [...],
      "count": 1,
      "label": "已申购"
    },
    "approved": {
      "orders": [...],
      "count": 1,
      "label": "已审批"
    }
  },
  "total": 2
}
```

---

### 上传订单图片

**端点:** `POST /api/consumable-orders/{order_id}/upload-image`

上传耗材订单图片。

**需要认证:** 是

---

### 删除订单

**端点:** `DELETE /api/consumable-orders/{order_id}`

删除耗材订单（仅订单申请人或管理员）。

**需要认证:** 是

**前置条件:** 订单状态必须为 `pending`

---

## 用户会话管理 API

### 获取当前用户会话

**端点:** `GET /api/users/me/sessions`

获取当前用户的所有活跃会话。

**需要认证:** 是

**响应 (200):**

```json
{
  "data": [
    {
      "id": 1,
      "device_id": "abc123",
      "device_name": "Chrome - Windows",
      "ip_address": "192.168.1.100",
      "last_active_at": "2024-01-01T12:00:00Z",
      "expires_at": "2024-01-02T12:00:00Z"
    }
  ],
  "total": 1
}
```

---

### 删除指定会话

**端点:** `DELETE /api/users/me/sessions/{session_id}`

删除指定会话（强制下线）。

**需要认证:** 是

**响应:** `204 No Content`

---

### 删除所有会话

**端点:** `DELETE /api/users/me/sessions`

删除当前用户的所有会话（退出所有设备）。

**需要认证:** 是

**响应:** `204 No Content`

---

## 通用响应格式

### 成功响应

```json
{
  "message": "操作成功",
  "data": { ... }
}
```

### 错误响应

```json
{
  "detail": "错误信息描述"
}
```

### 分页响应

```json
{
  "data": [...],
  "total": 100,
  "skip": 0,
  "limit": 50
}
```

---

## 状态码说明

### HTTP 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 请求成功 |
| 201 | 资源创建成功 |
| 204 | 请求成功，无返回内容 |
| 400 | 请求参数错误 |
| 401 | 未认证或认证失败 |
| 403 | 无权限访问 |
| 404 | 资源不存在 |
| 429 | 请求过于频繁 |
| 500 | 服务器内部错误 |

### 库存状态 (InventoryStatus)

| 值 | 说明 |
|-----|------|
| `in_stock` | 在库 |
| `borrowed` | 已借出 |
| `consumed` | 已用完 |

### 订单状态 (OrderStatus)

| 状态 | 说明 |
|------|------|
| `pending` | 待审批 |
| `approved` | 已审批 |
| `rejected` | 已拒绝 |
| `arrived` | 已到货（仅试剂） |
| `stocked` | 已入库（仅试剂） |
| `completed` | 已完成（仅耗材） |

---

## 速率限制

登录接口实施 IP 级别的速率限制：
- 最多失败 5 次
- 限制时间窗口: 5 分钟
- 超过限制后返回 429 状态码

---

## 文件上传安全

导入和图片上传接口实施以下安全检查：

1. **文件扩展名验证**: 仅允许 .xlsx, .xls, .csv
2. **MIME 类型检查**: 验证文件内容类型
3. **文件魔数验证**: 检查文件头签名
4. **文件大小限制**: 最大 10MB
5. **空文件检查**: 拒绝空文件

---

## 常见问题

### 如何获取 API 文档?

访问 `/docs` 获取 Swagger UI 文档，访问 `/redoc` 获取 ReDoc 文档。

### 如何测试 API?

1. 登录获取 Token
2. 使用 Swagger UI 的 Authorize 功能
3. 或者在请求头中添加: `Authorization: Bearer <token>`

### 权限不足怎么办?

检查用户角色是否为 `admin`，普通用户无法访问管理员专属接口。
