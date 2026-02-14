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
| arrived | 已到货 | 物理到货，待入库 |
| stocked | 已入库 | 完成入库 |

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

## 前端使用示例

```typescript
// 状态映射对象
const STATUS_MAPPING: Record<string, string> = {
  pending: '已申购',
  approved: '已审批',
  rejected: '未通过',
  arrived: '已到货',
  stocked: '已入库',
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
