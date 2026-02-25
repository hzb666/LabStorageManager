# 数据库表字段说明

## 1. User (用户表)

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| id | int | 否 | 主键，自增 |
| username | str | 是 | 用户名（登录账号），唯一，索引，3-20字符，只能字母+数字组合，首字符必须是字母，禁止保留字（admin、root等），不区分大小写 |
| full_name | str | 否 | 姓名，最大100字符 |
| role | enum | 是 | 角色：admin/user，默认USER |
| is_active | bool | 是 | 是否激活，默认True |
| password_hash | str | 是 | 密码哈希（不返回给前端） |
| created_at | datetime | 是 | 创建时间，默认当前时间 |
| updated_at | datetime | 是 | 更新时间，默认当前时间 |

---

## 2. Inventory (库存表)

### 数据库字段

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| id | int | 否 | 主键，自增 |
| internal_code | str | 是 | 内部编码，唯一，索引，格式：CAS号-日期-序号，如 64175-250113-01 |
| cas_number | str | 是 | CAS号，有索引，最大50字符 |
| name | str | 是 | 名称，最大200字符 |
| english_name | str | 否 | 英文名，最大200字符 |
| alias | str | 否 | 别名，最大200字符 |
| category | str | 否 | 分类，最大100字符 |
| brand | str | 否 | 品牌，最大100字符 |
| location | str | 否 | 位置，最大200字符 |
| initial_quantity | float | 是 | 初始数量，必须>0 |
| remaining_quantity | float | 是 | 剩余数量，默认0.0 |
| unit | str | 是 | 单位，默认ml，最大20字符 |
| is_hazardous | bool | 是 | 是否危险品，默认False |
| image_path | str | 否 | 图片路径（存储在/static/thumbnails/） |
| notes | str | 否 | 备注，最大500字符 |
| price | float | 否 | 价格，必须>=0 |
| status | enum | 是 | 状态：in_stock/borrowed/consumed，默认IN_STOCK |
| borrower_id | str | 否 | 当前借用人用户名，有索引 |
| last_borrower_id | str | 否 | 上一个借用人用户名 |
| temporary_keeper_id | str | 否 | 临时保管人用户名，有索引 |
| created_by_id | str | 否 | 创建人用户名，有索引 |
| created_at | datetime | 是 | 创建时间，默认当前时间 |
| updated_at | datetime | 是 | 更新时间，默认当前时间 |

### API响应额外字段

| 字段名 | 类型 | 说明 |
|--------|------|------|
| borrower_name | str | 借用人姓名 |
| last_borrower_name | str | 上一个借用人姓名 |
| created_by_name | str | 创建人姓名 |

---

## 3. BorrowLog (借用记录表)

### 数据库字段

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| id | int | 否 | 主键，自增 |
| inventory_id | int | 是 | 库存ID，有索引 |
| borrower_id | str | 是 | 借用人用户名，有索引 |
| borrow_time | datetime | 是 | 借用时间，默认当前时间 |
| return_time | datetime | 否 | 归还时间 |
| quantity_borrowed | float | 是 | 借用数量，必须>0 |
| quantity_returned | float | 否 | 归还数量 |
| notes | str | 否 | 备注 |
| created_at | datetime | 是 | 创建时间，默认当前时间 |

### API响应额外字段

| 字段名 | 类型 | 说明 |
|--------|------|------|
| borrower_name | str | 借用人姓名 |

---

## 4. ReagentOrder (试剂订单表)

### 数据库字段

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| id | int | 否 | 主键，自增 |
| cas_number | str | 是 | CAS号，有索引，最大50字符 |
| name | str | 是 | 名称（中文），最大200字符 |
| english_name | str | 否 | 英文名，最大200字符 |
| alias | str | 否 | 别名，最大200字符 |
| category | str | 否 | 分类（如分析纯、实验级），最大100字符 |
| brand | str | 否 | 品牌（如Sigma、国药），最大100字符 |
| specification | str | 是 | 规格（如500ml），最大100字符 |
| quantity | int | 是 | 申购数量，必须>0 |
| price | float | 否 | 价格，必须>=0 |
| order_reason | enum | 是 | 申购原因，默认NONE |
| is_hazardous | bool | 是 | 是否危险品，默认False |
| image_path | str | 否 | 图片路径 |
| notes | str | 否 | 备注，最大500字符 |
| applicant_id | str | 否 | 申请人用户名 |
| status | enum | 是 | 状态：pending/approved/arrived/stocked/rejected，默认PENDING |
| created_at | datetime | 是 | 创建时间，默认当前时间 |
| updated_at | datetime | 是 | 更新时间，默认当前时间 |

### API响应额外字段

| 字段名 | 类型 | 说明 |
|--------|------|------|
| applicant_name | str | 申请人姓名 |

---

## 5. ConsumableOrder (耗材订单表)

### 数据库字段

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| id | int | 否 | 主键，自增 |
| name | str | 是 | 名称（中文），最大200字符 |
| english_name | str | 否 | 英文名，最大200字符 |
| alias | str | 否 | 别名，最大200字符 |
| category | str | 否 | 分类（如手套、试管），最大100字符 |
| brand | str | 否 | 品牌（如3M、Corning），最大100字符 |
| specification | str | 是 | 规格（如500ml），最大100字符 |
| quantity | int | 是 | 申购数量，必须>0 |
| price | float | 否 | 价格，必须>=0 |
| order_reason | enum | 是 | 申购原因，默认NONE |
| is_hazardous | bool | 是 | 是否危险品，默认False |
| image_path | str | 否 | 图片路径 |
| notes | str | 否 | 备注，最大500字符 |
| applicant_id | str | 否 | 申请人用户名 |
| status | enum | 是 | 状态：pending/approved/rejected/completed，默认PENDING |
| created_at | datetime | 是 | 创建时间，默认当前时间 |
| updated_at | datetime | 是 | 更新时间，默认当前时间 |

### API响应额外字段

| 字段名 | 类型 | 说明 |
|--------|------|------|
| applicant_name | str | 申请人姓名 |

---

## 枚举类型说明

### UserRole
| 值 | 说明 |
|-----|------|
| admin | 管理员 |
| user | 普通用户 |

### InventoryStatus
| 值 | 说明 |
|-----|------|
| in_stock | 在库 |
| borrowed | 已借出 |
| consumed | 已用完 |

### ReagentOrderStatus
| 值 | 说明 |
|-----|------|
| pending | 已申购（待审批） |
| approved | 已审批（采购完成） |
| arrived | 已到货（待入库） |
| stocked | 已入库 |
| rejected | 未通过 |

### ConsumableOrderStatus
| 值 | 说明 |
|-----|------|
| pending | 已申购（待审批） |
| approved | 已审批（采购完成） |
| rejected | 未通过 |
| completed | 已完成（耗材不需要入库） |

### ReagentOrderReason / ConsumableOrderReason
| 值 | 说明 |
|-----|------|
| none | 无 |
| running_out | 即将用完 |
| empty | 已用完 |
| common_public | 公共常用 |
| not_found | 找不到 |
| reorder | 重新订购 |
