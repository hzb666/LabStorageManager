# 试剂与耗材分离设计方案

## 当前状态
- 单一 Order 表，通过 `type` 字段区分试剂/耗材
- 前端 Orders.tsx 混合展示

## 目标架构

### 数据库层
```
Order (保留，但 type 字段废弃)
  ↓ 新建
ReagentOrder (试剂订单表)
ConsumableOrder (耗材订单表)
```

### API 层
| 当前 | 未来 |
|------|------|
| POST /api/orders/ | POST /api/reagent-orders/ |
| GET /api/orders/ | GET /api/reagent-orders/ |
| | POST /api/consumable-orders/ |
| | GET /api/consumable-orders/ |

### 前端层
| 当前 | 未来 |
|------|------|
| Orders.tsx | ReagentOrders.tsx (试剂订购) |
| | ConsumableOrders.tsx (耗材订购) |

---

## 字段差异分析

### ReagentOrder (试剂订单)
| 字段 | 必需 | 说明 |
|------|------|------|
| cas_number | ✅ | CAS号 |
| name | ✅ | 中文名称 |
| english_name | ✅ | 英文名称 |
| specification | ✅ | 规格 |
| quantity | ✅ | 数量 |
| price | ✅ | 价格 |
| order_reason | ✅ | 订购原因 |
| is_hazardous | ✅ | 是否危险品 |
| image_path | ❌ | 图片 |
| alias | ❌ | 别名 |
| notes | ❌ | 备注 |

**工作流**: PENDING → APPROVED → ARRIVED → STOCKED → 借用/归还

**注意**: 试剂订单不需要 location（入库时自动生成 internal_code）

### ConsumableOrder (耗材订单)
| 字段 | 必需 | 说明 |
|------|------|------|
| name | ✅ | 中文名称 |
| english_name | ✅ | 英文名称 |
| specification | ✅ | 规格 |
| quantity | ✅ | 数量 |
| price | ✅ | 价格 |
| order_reason | ✅ | 订购原因 |
| is_hazardous | ✅ | 是否危险品 |
| image_path | ❌ | 图片 |
| alias | ❌ | 别名 |
| notes | ❌ | 备注 |

**注意**: 耗材无需 CAS号、location、stock-in

---

## 库存表 (Inventory) - 新增字段

| 字段 | 类型 | 说明 |
|------|------|------|
| category | TEXT | 分类 |
| english_name | TEXT | 英文名称 |
| brand | TEXT | 品牌 |
| price | REAL | 价格 |

---

## 实现步骤

### Phase 1: 后端模型
1. 创建 `app/models/reagent_order.py`
2. 创建 `app/models/consumable_order.py`
3. 更新 `app/models/__init__.py`

### Phase 2: 后端 API
1. 创建 `app/api/reagent_orders.py`
2. 创建 `app/api/consumable_orders.py`
3. 旧 API 标记废弃 (deprecated)

### Phase 3: 前端
1. 创建 `frontend/src/pages/ReagentOrders.tsx`
2. 创建 `frontend/src/pages/ConsumableOrders.tsx`
3. 更新导航 (Layout.tsx)
4. 更新 Dashboard

### Phase 4: 数据迁移
- 旧 Order 表数据迁移到新表
- 保留旧表用于审计

---

## 注意事项

1. **Inventory 只关联 ReagentOrder** - 耗材不入库
2. **Dashboard 需要分别查询** - my-borrows 只查试剂
3. **权限一致** - 两种订单的审批权限相同
