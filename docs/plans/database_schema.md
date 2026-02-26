# 数据库表结构文档

> 更新时间：2026-02-25

## 概述

本系统使用 SQLite 数据库，采用 SQLModel ORM。包含以下表：
- `user` - 用户表
- `inventory` - 库存表
- `borrowlog` - 借用记录表
- `reagentorder` - 试剂订购表
- `consumableorder` - 耗材订购表

---

## 表详细结构

### 1. user (用户表)

| 字段名 | 类型 | 可空 | 说明 |
|--------|------|------|------|
| username | VARCHAR(50) | NOT NULL | 用户名（唯一） |
| full_name | VARCHAR(100) | NULL | 全名 |
| role | VARCHAR(5) | NOT NULL | 角色：admin/user |
| is_active | BOOLEAN | NOT NULL | 是否激活 |
| id | INTEGER | NOT NULL | 主键 |
| password_hash | VARCHAR | NOT NULL | 密码哈希 |
| created_at | DATETIME | NOT NULL | 创建时间 |
| updated_at | DATETIME | NOT NULL | 更新时间 |

**索引**：
- `ix_user_username` (UNIQUE) on username

---

### 2. inventory (库存表)

| 字段名 | 类型 | 可空 | 说明 |
|--------|------|------|------|
| cas_number | VARCHAR(50) | NOT NULL | CAS号 |
| name | VARCHAR(200) | NOT NULL | 中文名称 |
| english_name | VARCHAR(200) | NULL | 英文名称 |
| alias | VARCHAR(200) | NULL | 别名 |
| category | VARCHAR(100) | NULL | 分类 |
| brand | VARCHAR(100) | NULL | 品牌 |
| location | VARCHAR(200) | NULL | 存放位置 |
| initial_quantity | FLOAT | NOT NULL | 初始数量 |
| remaining_quantity | FLOAT | NOT NULL | 剩余数量 |
| unit | VARCHAR(20) | NOT NULL | 单位 |
| is_hazardous | BOOLEAN | NOT NULL | 是否危险品 |
| image_path | VARCHAR | NULL | 图片路径 |
| notes | VARCHAR(500) | NULL | 备注 |
| id | INTEGER | NOT NULL | 主键 |
| internal_code | VARCHAR(50) | NOT NULL | 内部编码（唯一） |
| status | VARCHAR(8) | NOT NULL | 状态 |
| borrower_id | INTEGER | NULL | 当前借用人ID |
| last_borrower_id | INTEGER | NULL | 上次借用人ID |
| temporary_keeper_id | INTEGER | NULL | 临时保管人ID |
| created_by_id | INTEGER | NULL | 创建人ID |
| created_at | DATETIME | NOT NULL | 创建时间 |
| updated_at | DATETIME | NOT NULL | 更新时间 |

**索引**：
- `ix_inventory_internal_code` (UNIQUE) on internal_code
- `ix_inventory_cas_number` on cas_number
- `ix_inventory_borrower_id` on borrower_id
- `ix_inventory_temporary_keeper_id` on temporary_keeper_id
- `ix_inventory_created_by_id` on created_by_id

---

### 3. borrowlog (借用记录表)

| 字段名 | 类型 | 可空 | 说明 |
|--------|------|------|------|
| id | INTEGER | NOT NULL | 主键 |
| inventory_id | INTEGER | NOT NULL | 库存ID |
| borrower_id | INTEGER | NOT NULL | 借用人ID |
| borrow_time | DATETIME | NOT NULL | 借出时间 |
| return_time | DATETIME | NULL | 归还时间 |
| quantity_borrowed | FLOAT | NOT NULL | 借出数量 |
| quantity_returned | FLOAT | NULL | 归还数量 |
| notes | VARCHAR | NULL | 备注 |
| created_at | DATETIME | NOT NULL | 创建时间 |

**索引**：
- `ix_borrowlog_inventory_id` on inventory_id
- `ix_borrowlog_borrower_id` on borrower_id

---

### 4. reagentorder (试剂订购表)

| 字段名 | 类型 | 可空 | 说明 |
|--------|------|------|------|
| cas_number | VARCHAR(50) | NOT NULL | CAS号 |
| name | VARCHAR(200) | NOT NULL | 中文名称 |
| english_name | VARCHAR(200) | NULL | 英文名称 |
| alias | VARCHAR(200) | NULL | 别名 |
| category | VARCHAR(100) | NULL | 分类 |
| brand | VARCHAR(100) | NULL | 品牌 |
| specification | VARCHAR(100) | NOT NULL | 规格 |
| quantity | INTEGER | NOT NULL | 订购数量 |
| price | FLOAT | NULL | 价格 |
| order_reason | VARCHAR(13) | NOT NULL | 订购原因 |
| is_hazardous | BOOLEAN | NOT NULL | 是否危险品 |
| image_path | VARCHAR | NULL | 图片路径 |
| notes | VARCHAR(500) | NULL | 备注 |
| id | INTEGER | NOT NULL | 主键 |
| applicant_id | INTEGER | NULL | 申请人ID |
| status | VARCHAR(8) | NOT NULL | 状态 |
| created_at | DATETIME | NOT NULL | 创建时间 |
| updated_at | DATETIME | NOT NULL | 更新时间 |

**索引**：
- `ix_reagentorder_cas_number` on cas_number

---

### 5. consumableorder (耗材订购表)

| 字段名 | 类型 | 可空 | 说明 |
|--------|------|------|------|
| name | VARCHAR(200) | NOT NULL | 中文名称 |
| english_name | VARCHAR(200) | NULL | 英文名称 |
| alias | VARCHAR(200) | NULL | 别名 |
| category | VARCHAR(100) | NULL | 分类 |
| brand | VARCHAR(100) | NULL | 品牌 |
| specification | VARCHAR(100) | NOT NULL | 规格 |
| quantity | INTEGER | NOT NULL | 订购数量 |
| price | FLOAT | NULL | 价格 |
| image_path | VARCHAR | NULL | 图片路径 |
| notes | VARCHAR(500) | NULL | 备注 |
| id | INTEGER | NOT NULL | 主键 |
| applicant_id | INTEGER | NULL | 申请人ID |
| status | VARCHAR(9) | NOT NULL | 状态 |
| created_at | DATETIME | NOT NULL | 创建时间 |
| updated_at | DATETIME | NOT NULL | 更新时间 |

---

## 状态枚举

### inventory.status
- `not_in_stock` - 不在库存
- `in_stock` - 库存
- `borrowed` - 已借出
- `consumed` - 已消耗

### reagentorder.status / consumableorder.status
- `pending` - 待审批
- `approved` - 已审批
- `rejected` - 已驳回
- `completed` - 已完成

### user.role
- `admin` - 管理员
- `user` - 普通用户

### reagentorder.order_reason
- `none` - 没有
- `running_out` - 快用完
- `empty` - 用完
- `common_public` - 常用或公用
- `not_found` - 找不到
- `reorder` - 重新下单

---

## 数据库配置

- **数据库文件**: `lab_inventory.db`
- **模式**: SQLite with WAL Mode
- **ORM**: SQLModel
