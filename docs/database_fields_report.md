# 数据库表字段完整分析报告

## 一、数据库表概览

本项目共有 **6 个数据库表**：

| 表名 | 说明 | 模型文件 |
|------|------|----------|
| users | 用户表 | app/models/user.py |
| user_sessions | 用户会话表 | app/models/user_session.py |
| inventory | 库存表 | app/models/inventory.py |
| borrow_log | 借用记录表 | app/models/inventory.py |
| reagent_orders | 试剂订单表 | app/models/reagent_order.py |
| consumable_orders | 耗材订单表 | app/models/consumable_order.py |

---

## 二、详细字段分析

### 1. users 表（用户）

| 字段 | 类型 | DB约束 | DB验证 | 后端API验证 | 前端验证 |
|------|------|--------|--------|-------------|----------|
| id | INTEGER | PK, AUTOINCREMENT | - | - | - |
| username | VARCHAR(20) | UNIQUE, INDEX, NOT NULL | min=3, max=20, 正则 `^[a-zA-Z0-9_]+$` | 同DB | UsernameSchema: minLength(3), maxLength(20), regex |
| full_name | VARCHAR(100) | NOT NULL | max=100 | - | - |
| role | VARCHAR(10) | NOT NULL, DEFAULT='user' | 枚举: admin/user | 枚举: admin/user | picklist(['admin', 'user']) |
| is_active | BOOLEAN | NOT NULL, DEFAULT=1 | - | - | - |
| password_hash | VARCHAR(255) | NOT NULL | - | - | - |
| created_at | DATETIME | NOT NULL | - | - | - |
| updated_at | DATETIME | NOT NULL | - | - | - |

**特殊验证**：
- 后端：`UserCreate` 要求 `password: min_length=6`
- 前端：`PasswordBaseSchema` 要求 minLength(6)

---

### 2. user_sessions 表（用户会话）

| 字段 | 类型 | DB约束 | DB验证 | 后端API验证 | 前端验证 |
|------|------|--------|--------|-------------|----------|
| id | INTEGER | PK, AUTOINCREMENT | - | - | - |
| user_id | INTEGER | FK->users.id, INDEX, NOT NULL | - | - | - |
| device_id | VARCHAR(255) | INDEX, NOT NULL | - | - | - |
| device_name | VARCHAR(255) | NOT NULL | - | - | - |
| ip_address | VARCHAR(45) | NOT NULL | - | - | - |
| last_ip_address | VARCHAR(45) | NOT NULL | - | - | - |
| user_agent | TEXT | NOT NULL | - | - | - |
| token_hash | VARCHAR(255) | INDEX, NOT NULL | - | - | - |
| created_at | DATETIME | NOT NULL | - | - | - |
| last_active_at | DATETIME | NOT NULL | - | - | - |
| expires_at | DATETIME | NOT NULL | - | - | - |

---

### 3. inventory 表（库存）

| 字段 | 类型 | DB约束 | DB验证 | 后端API验证 | 前端验证 |
|------|------|--------|--------|-------------|----------|
| id | INTEGER | PK, AUTOINCREMENT | - | - | - |
| internal_code | VARCHAR(50) | UNIQUE, INDEX, NOT NULL | - | - | - |
| cas_number | VARCHAR(50) | INDEX, NOT NULL | - | normalize_cas() 自动标准化 | CasNumberSchema: 格式+校验码 |
| name | VARCHAR(200) | INDEX, NOT NULL | - | - | createRequiredStringSchema('名称') |
| english_name | VARCHAR(200) | NULL | max=200 | - | v.optional(v.string()) |
| alias | VARCHAR(200) | NULL | max=200 | - | v.optional(v.string()) |
| category | VARCHAR(100) | INDEX, NULL | max=100 | - | v.optional(v.string()) |
| brand | VARCHAR(100) | INDEX, NULL | max=100 | - | v.optional(v.string()) |
| storage_location | VARCHAR(200) | INDEX, NULL | max=200 | - | v.optional(v.string()) |
| initial_quantity | REAL | NULL | - | - | createQuantitySchema: >0 |
| remaining_quantity | REAL | NULL | - | - | createNonNegativeNumberSchema: >=0 |
| unit | VARCHAR(20) | NULL | max=20 | - | createRequiredStringSchema('单位') |
| is_hazardous | BOOLEAN | NOT NULL, DEFAULT=0 | - | - | v.boolean() |
| image_path | VARCHAR(200) | NULL | - | - | - |
| notes | VARCHAR(500) | NULL | max=500 | - | v.optional(v.string()) |
| status | VARCHAR(20) | INDEX, NOT NULL | 枚举 | 枚举: not_in_stock/in_stock/borrowed/consumed | - |
| borrower_id | INTEGER | FK->users.id, INDEX, NULL | - | - | - |
| last_borrower_id | INTEGER | FK->users.id, NULL | - | - | - |
| temporary_keeper_id | INTEGER | FK->users.id, INDEX, NULL | - | - | - |
| created_by_id | INTEGER | FK->users.id, INDEX, NULL | - | - | - |
| created_at | DATETIME | INDEX, NOT NULL | - | - | - |
| updated_at | DATETIME | NOT NULL | - | - | - |
| name_pinyin | VARCHAR(200) | INDEX, NULL | - | - | - |
| category_pinyin | VARCHAR(200) | INDEX, NULL | - | - | - |
| brand_pinyin | VARCHAR(200) | INDEX, NULL | - | - | - |

**关键验证说明**：
- **CAS号**：前端使用 `CasNumberSchema`（格式验证+校验码），后端使用 `normalize_cas()` 自动标准化
- **数量**：前端必填 >0，后端允许NULL（兼容旧数据）
- **specification**：前端传入规格字符串（如"500ml"），后端用 `parse_specification()` 解析为 quantity + unit

---

### 4. borrow_log 表（借用记录）

| 字段 | 类型 | DB约束 | DB验证 | 后端API验证 | 前端验证 |
|------|------|--------|--------|-------------|----------|
| id | INTEGER | PK, AUTOINCREMENT | - | - | - |
| inventory_id | INTEGER | FK->inventory.id, INDEX, NOT NULL | - | - | - |
| borrower_id | INTEGER | FK->users.id, INDEX, NOT NULL | - | - | - |
| borrow_time | DATETIME | NOT NULL | - | - | - |
| return_time | DATETIME | NULL | - | - | - |
| quantity_borrowed | REAL | NOT NULL | gt=0 | - | - |
| quantity_returned | REAL | NULL | - | - | - |
| notes | VARCHAR(500) | NULL | max=500 | - | - |
| created_at | DATETIME | NOT NULL | - | - | - |

---

### 5. reagent_orders 表（试剂订单）

| 字段 | 类型 | DB约束 | DB验证 | 后端API验证 | 前端验证 |
|------|------|--------|--------|-------------|----------|
| id | INTEGER | PK, AUTOINCREMENT | - | - | - |
| cas_number | VARCHAR(50) | INDEX, NOT NULL | - | normalize_cas() + validate_cas_format() | CasNumberSchema |
| name | VARCHAR(200) | INDEX, NOT NULL | - | - | createRequiredStringSchema |
| english_name | VARCHAR(200) | NULL | max=200 | - | v.optional(v.string()) |
| alias | VARCHAR(200) | NULL | max=200 | - | v.optional(v.string()) |
| category | VARCHAR(100) | INDEX, NULL | max=100 | - | v.optional(v.string()) |
| brand | VARCHAR(100) | INDEX, NULL | max=100 | - | v.optional(v.string()) |
| initial_quantity | REAL | NULL | - | - | - |
| unit | VARCHAR(20) | NULL | max=20 | - | - |
| quantity | INTEGER | NOT NULL | gt=0 | - | createPositiveNumberSchema: >=1 |
| price | REAL | NOT NULL | ge=0 | price > 0 | createPriceSchema: >0 (Create) |
| order_reason | VARCHAR(20) | NOT NULL | 枚举 | 枚举验证 | v.optional(v.string()) |
| is_hazardous | BOOLEAN | NOT NULL, DEFAULT=0 | - | - | v.boolean() |
| image_path | VARCHAR(200) | NULL | - | - | - |
| notes | VARCHAR(500) | NULL | max=500 | - | v.optional(v.string()) |
| applicant_id | INTEGER | FK->users.id, INDEX, NULL | - | - | - |
| status | VARCHAR(20) | INDEX, NOT NULL | 枚举 | 枚举验证 | - |
| created_at | DATETIME | INDEX, NOT NULL | - | - | - |
| updated_at | DATETIME | NOT NULL | - | - | - |
| name_pinyin | VARCHAR(200) | INDEX, NULL | - | - | - |
| brand_pinyin | VARCHAR(200) | INDEX, NULL | - | - | - |

**关键差异（API vs DB）**：
- `ReagentOrderCreate`: price 必填且 gt=0
- `ReagentOrderUpdate`: price 可选
- 前端：specification 必填（格式如 "500ml"）

---

### 6. consumable_orders 表（耗材订单）

| 字段 | 类型 | DB约束 | DB验证 | 后端API验证 | 前端验证 |
|------|------|--------|--------|-------------|----------|
| id | INTEGER | PK, AUTOINCREMENT | - | - | - |
| name | VARCHAR(200) | INDEX, NOT NULL | - | - | createRequiredStringSchema |
| english_name | VARCHAR(200) | NULL | max=200 | - | v.optional(v.string()) |
| alias | VARCHAR(200) | NULL | max=200 | - | v.optional(v.string()) |
| category | VARCHAR(100) | NULL | max=100 | - | v.optional(v.string()) |
| brand | VARCHAR(100) | NULL | max=100 | - | v.optional(v.string()) |
| specification | VARCHAR(100) | NOT NULL | - | - | createRequiredStringSchema (后端必填) |
| unit | VARCHAR(20) | NULL | max=20 | - | v.optional(v.string()) |
| quantity | INTEGER | NOT NULL | gt=0 | - | createPositiveNumberSchema: >=1 |
| price | REAL | NULL | ge=0 | - | createPriceSchema: >=0 |
| image_path | VARCHAR(200) | NULL | - | - | - |
| notes | VARCHAR(500) | NULL | max=500 | - | v.optional(v.string()) |
| applicant_id | INTEGER | FK->users.id, INDEX, NULL | - | - | - |
| status | VARCHAR(20) | INDEX, NOT NULL | 枚举 | 枚举验证 | - |
| created_at | DATETIME | INDEX, NOT NULL | - | - | - |
| updated_at | DATETIME | NOT NULL | - | - | - |
| name_pinyin | VARCHAR(200) | INDEX, NULL | - | - | - |
| category_pinyin | VARCHAR(100) | INDEX, NULL | - | - | - |

**关键差异**：
- `specification`: 后端必填（不同于 reagent_orders 的 initial_quantity + unit 分离设计）
- 无 `order_reason` 和 `is_hazardous` 字段（与 reagent_orders 不同）

---

## 三、API 层与 DB 层验证分离说明

根据用户提到的"api和db分离"，当前架构验证分布如下：

### 验证层级

1. **数据库层 (DB Layer)**
   - SQLModel 字段定义约束（类型、最大长度、默认值）
   - Foreign Key 约束
   - 索引和唯一约束

2. **后端 API 层 (Backend API Layer)**
   - 使用 SQLModel DTO (Create/Update) 进行输入验证
   - 业务逻辑验证（CAS号标准化、规格解析、状态转换）
   - 权限验证（用户角色、操作权限）

3. **前端验证层 (Frontend Validation)**
   - Valibot Schema 验证
   - 表单必填检查
   - 数据格式验证

### 关键区别示例

| 字段 | DB层 | API层 (Create) | API层 (Update) | 前端 |
|------|------|----------------|----------------|------|
| inventory.remaining_quantity | NULL 允许 | 无约束 | 无约束 | >=0 |
| reagent_orders.price | NULL 允许 | gt=0 (必填) | 无约束 | >0 |
| consumable_orders.specification | NOT NULL | 必填 | 可选 | 必填 |

---

## 四、总结

### 数据库会创建的所有表（共6个）
1. users
2. user_sessions  
3. inventory（**缺少 notes 列** - 当前问题）
4. borrow_log
5. reagent_orders
6. consumable_orders

### 初始化后 notes 列是否存在
- **已确认**：重新初始化数据库后，新表**会包含 notes 列**
- 测试结果：新创建的 inventory 表包含所有 24 个字段，包括 notes

### 建议
1. 删除现有 `lab_inventory.db` 并重新初始化
2. 或者执行 SQL: `ALTER TABLE inventory ADD COLUMN notes VARCHAR(500);`
