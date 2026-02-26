# BACKEND_STRUCTURE.md

## Database Schema (SQLModel)

### 1. User (用户表)
* `id`: Int, PK
* `username`: String (Unique, index)
* `password_hash`: String
* `role`: Enum ("admin", "user")
* `full_name`: String
* `is_active`: Boolean (Default True)
* `created_at`: Datetime
* `updated_at`: Datetime

### 2. ReagentOrder (试剂订购表)
* `id`: Int, PK
* `cas_number`: String (Index, **Normalized**: UPPERCASE, NO SPACES)
* `name`: String (中文名称)
* `english_name`: String (Nullable, 英文名称)
* `alias`: String (Nullable, 别名)
* `category`: String (Nullable, 分类/级别)
* `brand`: String (Nullable, 品牌/厂商)
* `specification`: String (e.g., "500ml")
* `quantity`: Int
* `price`: Float (Nullable)
* `applicant_id`: FK -> User
* `status`: Enum ("pending", "approved", "arrived", "stocked", "rejected")
    * **前后端约定**:
        * **后端**: 存储英文值（数据库）
        * **前端**: 映射为中文展示
        * 映射表: pending=已申购, approved=已审批, arrived=已到货但未入库, stocked=已入库, rejected=未通过
* `image_path`: String (Thumbnail path)
* `is_hazardous`: Boolean (Default False)
* `order_reason`: Enum ("none", "running_out", "empty", "common_public", "not_found", "reorder")
* `notes`: String (Nullable, 用户自定义备注)

### 3. ConsumableOrder (耗材订购表)
* `id`: Int, PK
* `name`: String (中文名称)
* `english_name`: String (Nullable, 英文名称)
* `alias`: String (Nullable, 别名)
* `category`: String (Nullable, 分类)
* `brand`: String (Nullable, 品牌)
* `specification`: String (e.g., "100只/盒")
* `quantity`: Int
* `price`: Float (Nullable)
* `applicant_id`: FK -> User
* `status`: Enum ("pending", "approved", "completed", "rejected")
* `image_path`: String (Thumbnail path)
* `is_hazardous`: Boolean (Default False)
* `order_reason`: Enum ("none", "running_out", "empty", "common_public", "not_found", "reorder")
* `notes`: String (Nullable)

### 4. Inventory (库存表 - 仅试剂)
* `id`: Int, PK
* `internal_code`: String (Unique, 格式: "CAS号-日期-序号", e.g., "64175-250113-01")
    * **序号规则**: 按 CAS 号分组自增，同一 CAS 号的试剂序号连续（从 01 开始），每批新入库时查询该 CAS 号的最大序号后 +1
* `cas_number`: String (Index, Copied from Order)
* `name`: String
* `english_name`: String (Nullable)
* `alias`: String (Copied from Order)
* `category`: String (Nullable, 分类)
* `brand`: String (Nullable, 品牌)
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
* `price`: Float (Nullable, 单价)
* `notes`: String (Nullable, 用户自定义备注)

### 5. BorrowLog (借用记录表)
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
* **解析失败**: 抛出 SpecificationError 域错误（API 层转为 HTTPException）
* **支持的单位**: ml, L, g, kg, mg, 个, 瓶, 支, 盒, 包, 套（不区分大小写）

### 试剂确认到货 (POST /api/reagent-orders/{id}/confirm-arrival)
* **触发时机**: 用户在个人中心点击"确认到货"
* **校验**: ReagentOrder.status == "approved"
* **处理逻辑**:
    * 如果 order_reason == "common_public": 状态 = "stocked"（常用/公用直接完成）
    * 其他: 状态 = "arrived"（待入库）
* **返回**: 消息提示 + 状态

### 耗材确认完成 (POST /api/consumable-orders/{id}/complete)
* **触发时机**: 用户确认耗材到货
* **校验**: ConsumableOrder.status == "approved"
* **处理逻辑**: 状态 = "completed"（耗材不入库）

### 试剂一键入库 (POST /api/reagent-orders/{id}/stock-in)
**ReagentOrder -> Inventory 转换规则**：
1. **校验**: ReagentOrder.status == "arrived"
2. **Copy 数据**: 保留 Order 记录用于审计（不删除）
3. **生成 N 条 Inventory**（N = order.quantity，即瓶数）
4. **Internal Code**: CAS号-日期(yymmdd)-序号，全局唯一（如 `64175-250113-01`）
5. **每瓶容量**: 从 `order.specification` 解析（如 "500ml" → 每瓶 500ml）
6. **更新 Order**: status = "stocked"

### 借用 API (POST /api/inventory/{id}/borrow)
* **校验**: 只有 status == "in_stock" 的物品可借用
* **更新 Inventory**:
  * status = "borrowed"
  * borrower_id = current_user
* **创建 BorrowLog**:
  * borrow_time = now()
  * quantity_borrowed = inventory.remaining_quantity

### 归还 API (POST /api/inventory/{id}/return)
* **输入**: remaining_quantity（剩余量）
* **计算**:
  * 如果 remaining <= 0 → status = "consumed"
  * 如果 remaining > 0 → status = "in_stock"
* **低量预警**: remaining < 20% 时返回警告
* **更新 BorrowLog**: return_time, quantity_returned
* **更新 Inventory.last_borrower_id** = current_user

### Dashboard API
* **GET /api/inventory/dashboard/my-borrows**: 返回当前用户借用的物品列表
* **GET /api/reagent-orders/dashboard/my-orders**: 返回当前用户的试剂订单进度
* **GET /api/consumable-orders/dashboard/my-orders**: 返回当前用户的耗材订单进度
* **GET /api/reagent-orders/dashboard/arrived-orders**: 返回已到货但未入库的试剂订单
* **GET /api/inventory/dashboard/pending-stockin**: 返回当前用户暂管的物品

### CAS 库存查询
* **GET /api/inventory/cas/{cas_number}**: 查询 CAS 号库存详情
* **GET /api/inventory/cas/{cas_number}/total**: 查询 CAS 号总剩余量

### 批量导入 (POST /api/inventory/import)
* 支持 CSV (.csv) 和 Excel (.xlsx, .xls) 文件
* 自动识别多种编码（UTF-8, GBK, GB2312）
* 验证 CAS 格式、规格格式、数量
* 支持字段: cas_number, name, english_name, alias, category, brand, specification, initial_quantity, location, is_hazardous, price, notes

### 手动入库 (POST /api/inventory/manual-add)
* **功能**: 手动添加试剂入库（未提交订单的试剂）
* **输入**: CAS号、名称、规格、瓶数、位置等
* **逻辑**: 直接创建 Inventory 记录，不经过 Order

### 导出 (GET /api/inventory/export)
* **功能**: 导出全部库存为 CSV
* **权限**: 仅管理员
* **字段**: 编号、CAS号、名称、英文名、别名、分类、品牌、位置、数量、状态、价格等

### 借用历史 (GET /api/inventory/{id}/borrow-history)
* **返回**: 最近 10 条 BorrowLog 记录（借用人、时间、数量）
* **排序**: 按 borrow_time 降序

> **Note**: User Management APIs documented in `IMPLEMENTATION_PLAN.md`
