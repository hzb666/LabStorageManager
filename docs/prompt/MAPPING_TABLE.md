# 前后端枚举映射表

## 设计原则
- **后端**：存储英文值（数据库/API），便于开发和管理
- **前端**：加载时映射为中文展示，用户友好
- **API 请求**：使用英文值传给后端

---

## 1. Order Status（订单状态）

| 英文值 | 中文展示 | 说明 |
|-------|---------|-----|
| pending | 已申购 | 已提交，等待审批 |
| approved | 已审批 | 审批通过 |
| rejected | 未通过 | 审批未通过 |
| arrived | 已到货 | 物理到货，待入库（试剂订单） |
| stocked | 已入库 | 完成入库（试剂订单） |
| completed | 已完成 | 耗材订单已完成 |

---

## 2. Inventory Status（库存状态）

| 英文值 | 中文展示 | 说明 |
|-------|---------|-----|
| in_stock | 在库 | 可借用 |
| borrowed | 已借出 | 已被借用 |
| consumed | 已耗尽 | 用完/耗尽 |

---

## 3. Order Reason（订购原因）

| 英文值 | 中文展示 | 说明 |
|-------|---------|-----|
| none | 没有 | 没有库存 |
| running_out | 快用完 | 即将用完 |
| empty | 用完 | 已用完 |
| common_public | 常用或公用 | 常用或公用试剂 |
| not_found | 找不到 | 找不到库存 |
| reorder | 重新下单 | 重新订购 |

---

## 4. User Role（用户角色）

| 英文值 | 中文展示 | 说明 |
|-------|---------|-----|
| admin | 管理员 | 可审批订单、管理用户 |
| user | 普通用户 | 常规操作权限 |

---

## 5. Item Type（物品类型）

| 英文值 | 中文展示 | 说明 |
|-------|---------|-----|
| reagent | 试剂 | 需要入库管理 |
| consumable | 耗材 | 不入库，仅流程管理 |

---

## 6. Inventory Fields（库存字段）

| 字段名 | 类型 | 必填 | 说明 |
|-------|------|-----|------|
| id | int | 是 | 主键ID |
| internal_code | string | 是 | 内部编码（如：64175-250113-01） |
| cas_number | string | 是 | CAS号（如：64-17-5） |
| name | string | 是 | 中文名称 |
| english_name | string | 否 | 英文名称 |
| alias | string | 否 | 别名 |
| category | string | 否 | 分类（如：有机溶剂） |
| brand | string | 否 | 品牌（如：Sigma） |
| storage_location | string | 否 | 存放位置 |
| initial_quantity | float | 是 | 初始数量 |
| remaining_quantity | float | 是 | 剩余数量 |
| unit | string | 是 | 单位（ml/L/g/kg/个/支/瓶） |
| status | string | 是 | 库存状态 |
| is_hazardous | bool | 是 | 是否危险品 |
| image_path | string | 否 | 图片路径 |
| price | float | 否 | 价格 |
| borrower_id | int | 否 | 当前借用人ID |
| last_borrower_id | int | 否 | 上一个借用人ID |
| temporary_keeper_id | int | 否 | 临时保管人ID |
| notes | string | 否 | 备注 |
| created_at | datetime | 是 | 创建时间 |
| updated_at | datetime | 是 | 更新时间 |

---

## 7. Reagent Order Fields（试剂订单字段）

| 字段名 | 类型 | 必填 | 说明 |
|-------|------|-----|------|
| id | int | 是 | 主键ID |
| cas_number | string | 是 | CAS号 |
| name | string | 是 | 中文名称 |
| english_name | string | 否 | 英文名称 |
| alias | string | 否 | 别名 |
| category | string | 否 | 分类 |
| brand | string | 否 | 品牌 |
| specification | string | 是 | 规格（如：500ml） |
| quantity | int | 是 | 订购数量 |
| price | float | 否 | 价格 |
| order_reason | string | 是 | 订购原因 |
| is_hazardous | bool | 是 | 是否危险品 |
| image_path | string | 否 | 图片路径 |
| notes | string | 否 | 备注 |
| applicant_id | int | 否 | 申请人ID |
| status | string | 是 | 订单状态 |
| created_at | datetime | 是 | 创建时间 |
| updated_at | datetime | 是 | 更新时间 |

---

## 8. Consumable Order Fields（耗材订单字段）

| 字段名 | 类型 | 必填 | 说明 |
|-------|------|-----|------|
| id | int | 是 | 主键ID |
| name | string | 是 | 中文名称 |
| english_name | string | 否 | 英文名称 |
| alias | string | 否 | 别名 |
| category | string | 否 | 分类 |
| brand | string | 否 | 品牌 |
| specification | string | 是 | 规格 |
| quantity | int | 是 | 订购数量 |
| price | float | 否 | 价格 |
| order_reason | string | 是 | 订购原因 |
| is_hazardous | bool | 是 | 是否危险品 |
| image_path | string | 否 | 图片路径 |
| notes | string | 否 | 备注 |
| applicant_id | int | 否 | 申请人ID |
| status | string | 是 | 订单状态 |
| created_at | datetime | 是 | 创建时间 |
| updated_at | datetime | 是 | 更新时间 |

---

## 9. User Fields（用户字段）

| 字段名 | 类型 | 必填 | 说明 |
|-------|------|-----|------|
| id | int | 是 | 主键ID |
| username | string | 是 | 用户名（唯一） |
| full_name | string | 否 | 全名 |
| role | string | 是 | 用户角色 |
| is_active | bool | 是 | 是否激活 |
| password_hash | string | 是 | 密码哈希（仅后端） |
| created_at | datetime | 是 | 创建时间 |
| updated_at | datetime | 是 | 更新时间 |

---

## 10. Borrow Log Fields（借用记录字段）

| 字段名 | 类型 | 必填 | 说明 |
|-------|------|-----|------|
| id | int | 是 | 主键ID |
| inventory_id | int | 是 | 库存ID |
| borrower_id | int | 是 | 借用人ID |
| borrow_time | datetime | 是 | 借用时间 |
| return_time | datetime | 否 | 归还时间 |
| quantity_borrowed | float | 是 | 借用数量 |
| quantity_returned | float | 否 | 归还数量 |
| notes | string | 否 | 备注 |
| created_at | datetime | 是 | 创建时间 |

---

## 11. Manual Inventory Create Fields（手动入库字段）

| 字段名 | 类型 | 必填 | 说明 |
|-------|------|-----|------|
| cas_number | string | 是 | CAS号 |
| name | string | 是 | 中文名称 |
| english_name | string | 否 | 英文名称 |
| alias | string | 否 | 别名 |
| specification | string | 是 | 规格（如：500ml） |
| initial_quantity | float | 否 | 初始数量 |
| quantity_bottles | int | 是 | 瓶数 |
| storage_location | string | 否 | 存放位置 |
| is_hazardous | bool | 是 | 是否危险品 |
| category | string | 否 | 分类 |
| brand | string | 否 | 品牌 |
| price | float | 否 | 价格 |
| notes | string | 否 | 备注 |

---

## 前端使用示例

```typescript
// 状态映射对象
const STATUS_MAPPING: Record<string, string> = {
  pending: '已申购',
  approved: '已审批',
  rejected: '未通过',
  arrived: '已到货',
  stocked: '已入库',
  completed: '已完成',
  in_stock: '在库',
  borrowed: '已借出',
  consumed: '已耗尽',
  none: '没有',
  running_out: '快用完',
  empty: '用完',
  common_public: '常用或公用',
  not_found: '找不到',
  reorder: '重新下单',
  admin: '管理员',
  user: '普通用户',
  reagent: '试剂',
  consumable: '耗材'
};

// 使用示例
const displayStatus = STATUS_MAPPING[apiResponse.status];
```
