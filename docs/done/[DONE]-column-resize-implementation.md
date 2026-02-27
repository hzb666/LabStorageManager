# 列宽自定义功能实现计划

## 需求概述
为 LabStorageManager 系统中的所有表格添加列宽自定义（拖动改变列宽）功能。

## 当前页面表格实现情况

| 页面 | 表格实现 | 分页 | 筛选/搜索 |
|------|---------|------|-----------|
| Dashboard | 原生 HTML table | 自定义 (slice) | 自定义 |
| Inventory | TanStack Table | 自定义 (offset/limit) | 自定义 (globalFilter) |
| ReagentOrders | TanStack Table | 自定义 | 自定义 |
| ConsumableOrders | TanStack Table | 自定义 | 自定义 |
| AdminUsers | TanStack Table | 自定义 | 自定义 |

**说明：** 所有页面的分页和筛选功能均使用自定义实现，非 TanStack 内置组件。

## 需求变更

### 1. Dashboard 表格改为 TanStack
- Dashboard 当前使用原生 HTML table
- 需要重构为 TanStack Table，与其他页面保持一致

### 2. 移动端无需加入此功能
- 列宽调整功能仅在桌面端启用
- 使用 `useMediaQuery` 检测移动端，隐藏拖拽手柄

### 3. 无需虚拟滚动
- 当前分页每页最多 100 条
- DOM 元素数量可控，无需虚拟滚动优化

## 技术方案

### TanStack Table 列宽调整
TanStack Table v8 原生支持列宽调整，需要：
- 在 `useReactTable` 中配置 `columnResizeMode: 'onChange'`
- 在列定义中设置 `size` 属性
- 在表格元素上应用 `style={{ width: header.getSize() }}`
- 添加可视化的拖拽手柄（Resize Handle）

## 实现步骤

1. 修改 Dashboard.tsx：将原生表格重构为 TanStack Table
2. 修改 ResizableHeader.tsx：添加移动端检测逻辑
3. 修改 Inventory.tsx：添加 ResizableHeader
4. 修改 ReagentOrders.tsx：添加 ResizableHeader
5. 修改 ConsumableOrders.tsx：添加 ResizableHeader
6. 修改 AdminUsers.tsx：添加 ResizableHeader
7. 添加全局 CSS 样式
8. 测试验证

## localStorage 存储结构

```typescript
interface ColumnSizes {
  [columnId: string]: number
}

// Key: `table-column-sizes-${tableId}`
// Value: JSON string of ColumnSizes
```

## 页面表格标识

| 表格 | tableId |
|------|---------|
| Inventory | `inventory-table` |
| ReagentOrders | `reagent-orders-table` |
| ConsumableOrders | `consumable-orders-table` |
| AdminUsers | `admin-users-table` |

## 注意事项

1. 拖拽手柄不应遮挡内容，需保证最小列宽（如 40px）
2. 需要处理暗黑模式下的样式
3. 避免拖拽时选中文字（user-select: none）
4. 移动端检测：使用项目已有的 `useMobile` hook (`frontend/src/hooks/use-mobile.tsx`)

---

## 检查清单

### 实现状态

- [X] Dashboard 表格使用 TanStack Table
- [X] Inventory 页面使用列宽调整
- [X] ReagentOrders 页面使用列宽调整
- [X] ConsumableOrders 页面使用列宽调整
- [X] AdminUsers 页面使用列宽调整
- [X] localStorage 持久化列宽
- [X] 移动端隐藏拖拽手柄

---

**检查完成**: ✅ 全部完成

---

*文档更新时间: 2026-02-28*
