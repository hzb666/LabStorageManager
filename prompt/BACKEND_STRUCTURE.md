# BACKEND_STRUCTURE.md

## Database Schema (SQLModel)

### 1. User (用户表)
* `id`: Int, PK
* `username`: String (Unique, index)
* `password_hash`: String
* `role`: Enum ("admin", "user")
* `full_name`: String
* `department`: String (Nullable)
* `phone`: String (Nullable)
* `email`: String (Nullable)
* `is_active`: Boolean (Default True)
* `last_login`: Datetime (Nullable)
* `login_count`: Int (Default 0)
* `created_at`: Datetime
* `updated_at`: Datetime

### 2. Order (订购表)
* `id`: Int, PK
* `type`: Enum ("reagent", "consumable")
* `cas_number`: String (Index, **Normalized**: UPPERCASE, NO SPACES)
* `name`: String
* `alias`: String (Nullable, e.g., "酒精, Ethanol")
* `specification`: String (e.g., "500ml")
* `quantity`: Int
* `applicant_id`: FK -> User
* `status`: Enum ("pending", "approved", "arrived", "stocked", "rejected")
    * **前后端约定**:
        * **后端**: 存储英文值（数据库）
        * **前端**: 映射为中文展示
        * 映射表: pending=已申购, approved=已审批, arrived=已到货但未入库, stocked=已入库, rejected=未通过
* `image_path`: String (Thumbnail path)
* `is_hazardous`: Boolean (Default False)
* `order_reason`: Enum ("none", "running_out", "empty", "common_public", "not_found", "reorder")
    * "none" = 没有
    * "running_out" = 快用完
    * "empty" = 用完
    * "common_public" = 常用或公用（入库后不触发提醒）
    * "not_found" = 找不到
    * "reorder" = 重新下单
* `location`: String (Nullable, 目标存放位置，一键入库时复制到 Inventory.location)
* `notes`: String (Nullable, 用户自定义备注)

### 3. Inventory (库存表 - 仅试剂)
* `id`: Int, PK
* `internal_code`: String (Unique, 格式: "CAS号-日期-序号", e.g., "64175-250113-01")
    * **序号规则**: 按 CAS 号分组自增，同一 CAS 号的试剂序号连续（从 01 开始），每批新入库时查询该 CAS 号的最大序号后 +1
* `cas_number`: String (Index, Copied from Order)
* `name`: String
* `alias`: String (Copied from Order)
* `location`: String (Free Text, Nullable - 可留空，后续补充)
* `initial_quantity`: Float (e.g., 500)
* `remaining_quantity`: Float (e.g., 200)
* `unit`: String (e.g., "ml", stored as string, case-insensitive)
* `status`: Enum ("in_stock", "borrowed", "consumed")
* `borrower_id`: FK -> User (Nullable)
* `last_borrower_id`: FK -> User (Nullable)
* `is_hazardous`: Boolean
* `image_path`: String
* `temporary_keeper_id`: FK -> User (Nullable, 暂管人，一键入库时可先不填位置)
* `notes`: String (Nullable, 用户自定义备注)

### 4. BorrowLog (借用记录表)
* `id`: Int, PK
* `inventory_id`: FK -> Inventory
* `borrower_id`: FK -> User
* `borrow_time`: DateTime
* `return_time`: DateTime (Nullable)
* `quantity_borrowed`: Float (借出时数量)
* `quantity_returned`: Float (Nullable, 归还时数量)
* `notes`: String (Nullable, 备注)

## Key API Logic

### 规格解析规则
* **解析逻辑**: 从 specification 中提取 (数值, 单位)，如 "500ml" -> (500, "ml")
* **单位处理**: 忽略大小写、空格，不做单位转换
* **解析失败**: 返回错误信息，让用户重新输入规格
* **支持的单位**: ml, L, g, kg, mg, 个, 瓶, 支, 盒（不区分大小写）

### 确认到货 (POST /api/orders/{id}/confirm-arrival)
* **触发时机**: 用户在个人中心点击"确认到货"
* **校验**: Order.status == "approved"
* **处理逻辑**:
    * 如果 type == "consumable": 状态 = "stocked"（直接完成，不入库）
    * 如果 order_reason == "common_public": 状态 = "stocked"（常用/公用直接完成）
    * 如果 type == "reagent" 且 order_reason != "common_public": 状态 = "arrived"（待入库）
* **返回**: 消息提示 + 状态

### 一键入库 (POST /api/orders/{id}/stock-in)
**Order -> Inventory 转换规则**：
1. **校验**: Order.status == "arrived"
2. **Copy 数据**: 保留 Order 记录用于审计（不删除）
3. **生成 N 条 Inventory**（N = order.quantity，即瓶数）
4. **Internal Code**: CAS号-日期(yymmdd)-序号，全局唯一（如 `64175-250113-01`）
5. **每瓶容量**: 从 `order.specification` 解析（如 "500ml" → 每瓶 500ml）
6. **位置逻辑**:
   - 如果 order.location 有值 → Inventory.location = order.location
   - 如果 order.location 为空 → Inventory.location = null, temporary_keeper_id = current_user
7. **更新 Order**: status = "stocked"

### 借用 API (POST /api/inventory/{id}/borrow)
* **校验**: 只有 status == "in_stock" 的物品可借用
* **更新 Inventory**:
  * status = "borrowed"
  * borrower_id = current_user
* **创建 BorrowLog**:
  * borrow_time = now()
  * quantity_borrowed = inventory.remaining_quantity

### 归还 API (POST /api/inventory/{id}/return)
* **输入**: remaining_amount（剩余量）或 used_amount（使用量）
* **计算**:
  * remaining = previous_remaining - used_amount
  * 如果 remaining <= 0 → status = "consumed"
  * 如果 remaining > 0 → status = "in_stock"
* **低量预警**: remaining < 20% 时返回警告
* **更新 BorrowLog**:
  * return_time = now()
  * quantity_returned = remaining
* **更新 Inventory.last_borrower_id** = current_user

### Dashboard API (4 个独立端点)
* **GET /api/dashboard/my-borrows**: 返回当前用户借用的物品列表（status == borrowed）
* **GET /api/dashboard/my-orders**: 返回当前用户的订单进度（status in pending, approved, arrived）
* **GET /api/dashboard/arrived-orders**: 返回已到货但未入库的订单（status == arrived, type == reagent）
* **GET /api/dashboard/pending-stockin**: 返回当前用户暂管的物品（location IS NULL AND temporary_keeper_id = current_user）

### POST /api/cas/check
* Input: `cas_number`
* Logic: `SELECT SUM(remaining_quantity) FROM inventory WHERE cas_number = ? AND status != 'consumed'`

### POST /api/inventory/import (Excel)
* Logic: Parse Excel -> Validate CAS format -> Bulk Create Inventory Items.

> **Note**: User Management APIs and Audit Log APIs are documented in `IMPLEMENTATION_PLAN.md`
