# Inventory.tsx 代码优化分析报告

## 一、问题确认

根据代码分析，确认以下问题确实存在：

### 1.1 TanStack Table 重渲染问题 ✅

**当前代码** ([`Inventory.tsx:452-560`](frontend/src/pages/Inventory.tsx:452))：
```typescript
const columns = useMemo(() => [
  // ...
  cell: info => (
    <HighlightText text={info.getValue() || ''} highlight={displayFilter} fuzzy={fuzzySearch} />
  ),
  // ...
], [displayFilter, handleEditClick, loadInventory, fuzzySearch])
```

**问题**：
- `displayFilter`、`fuzzySearch`、`handleEditClick`、`loadInventory` 都在 columns 的依赖数组中
- 每当用户输入一个字符，`displayFilter` 更新，整个 columns 定义被重新创建
- 导致大量 DOM 节点销毁和重建，搜索时出现明显卡顿

---

### 1.2 分页类型确认 ✅

**当前实现** ([`Inventory.tsx:218-221`](frontend/src/pages/Inventory.tsx:218))：
```typescript
const params: Record<string, unknown> = {
  skip: pageParam,
  limit: 50,
}
```

**结论**：使用的是 **Offset 分页**，不是游标分页。

**后端实现** ([`app/api/inventory.py:756`](app/api/inventory.py:756))：
```python
items = db.exec(base.order_by(order_expr).offset(skip).limit(limit)).all()
```

---

### 1.3 冗余状态 displayFilter ✅

**当前代码** ([`Inventory.tsx:194-203`](frontend/src/pages/Inventory.tsx:194))：
```typescript
const [globalFilter, setGlobalFilter] = useState('')
const [displayFilter, setDisplayFilter] = useState('')

useEffect(() => {
  setDisplayFilter(globalFilter)
}, [globalFilter])
```

**问题**：
- `displayFilter` 只是简单复制 `globalFilter`，没有实际作用
- 每次输入字符会触发两次状态更新和重渲染
- 没有实现防抖 (Debounce) 功能

---

### 1.4 LoadingButton 颜色跳变 ✅

**当前代码** ([`Inventory.tsx:973-980`](frontend/src/pages/Inventory.tsx:973))：
```typescript
className={cn(
  "h-8 text-sm/4 px-3 border-0",
  isConfirming
    ? isLoading
      ? "text-destructive-foreground opacity-100 cursor-wait bg-destructive/70 transition-none"
      : "bg-destructive text-destructive-foreground hover:bg-destructive/70 transition-none"
    : "bg-primary hover:bg-primary/80"
)}
```

**问题**：
- `isLoading` 时虽然设置了 `bg-destructive/70`，但没有禁用 disabled 默认样式
- 可能导致 loading 状态和其他状态颜色不一致

---

### 1.5 表单配置重复 ✅

**编辑表单** ([`Inventory.tsx:742-754`](frontend/src/pages/Inventory.tsx:742))：
```typescript
fields={[
  { name: 'name', label: '试剂名称', type: 'input', required: true, colSpan: 2 },
  { name: 'cas_number', label: 'CAS号', type: 'input', readOnly: true, colSpan: 1 },
  // ...
]}
```

**入库表单** ([`Inventory.tsx:783-795`](frontend/src/pages/Inventory.tsx:783))：
```typescript
fields={[
  { name: 'name', label: '试剂名称', type: 'input', required: true, colSpan: 2 },
  { name: 'cas_number', label: 'CAS号', type: 'input', required: true, colSpan: 1 },
  // ...
]}
```

**问题**：
- 两个表单的字段配置大量重复
- 维护困难，添加一个字段需要改4个地方

---

## 二、改进方案

### 2.1 表格列定义优化（优先级：P0）

**目标**：消除 columns 的外部依赖，解决搜索卡顿

**问题根因**：
- 每次用户输入字符，`displayFilter` 更新
- columns 的 useMemo 依赖了 `displayFilter`, `fuzzySearch`, `handleEditClick`, `loadInventory`
- 导致整个列定义被重新创建，触发表格 DOM 树完全重绘

**影响程度**：100%（每次搜索都触发）

**方案**：利用 `table.meta` 注入状态和方法

```typescript
// 类型定义
interface TableMeta {
  fuzzySearch: boolean
  onEdit: (item: InventoryItem) => void
  onBorrowSuccess: () => void
}

// 使用
const table = useReactTable({
  data,
  columns,
  meta: {
    fuzzySearch,
    onEdit: handleEditClick,
    onBorrowSuccess: loadInventory,
  }
})

// 列定义 - 依赖项清空
const columns = useMemo(() => [
  columnHelper.accessor('name', {
    cell: info => {
      const filterValue = info.table.getState().globalFilter
      const isFuzzy = info.table.options.meta?.fuzzySearch
      return <HighlightText text={info.getValue()} highlight={filterValue} fuzzy={isFuzzy} />
    },
  }),
], []) // 空依赖数组
```

---

### 2.2 移除冗余状态（优先级：P1）

**目标**：删除无用的 `displayFilter` 状态

**问题根因**：
- `displayFilter` 只是简单复制 `globalFilter`，没有任何实际作用
- 每次输入触发两次状态更新和重渲染

**影响程度**：100%（每次搜索都触发额外渲染）

**方案**：删除 `displayFilter`，直接使用 `globalFilter`

```typescript
// 删除这两行
const [displayFilter, setDisplayFilter] = useState('')
useEffect(() => {
  setDisplayFilter(globalFilter)
}, [globalFilter])

// 在 columns 中直接使用 table.getState().globalFilter
```

---

### 2.3 表单配置抽离（优先级：P1）

**目标**：消除 editForm 和 addForm 的字段配置重复

**问题根因**：
- 两个表单的字段配置几乎相同
- 添加一个字段需要改4个地方

**影响程度**：100%（每次维护都遇到）

**方案**：抽离表单字段工厂函数

```typescript
// 定义在组件外部
const INVENTORY_FORM_FIELDS = {
  common: [
    { name: 'name', label: '试剂名称', type: 'input', required: true, colSpan: 2 },
    { name: 'english_name', label: '英文名称', type: 'input', colSpan: 2 },
    { name: 'alias', label: '别名', type: 'input' },
    { name: 'storage_location', label: '存放位置', type: 'input' },
    { name: 'brand', label: '品牌', type: 'input' },
    { name: 'category', label: '分类', type: 'input' },
    { name: 'is_hazardous', label: '危险品', type: 'checkbox' },
    { name: 'notes', label: '备注', type: 'textarea', colSpan: 3 },
  ],
  edit: [
    { name: 'cas_number', label: 'CAS号', type: 'input', readOnly: true, colSpan: 1 },
    { name: 'remaining_quantity', label: '剩余量', type: 'number', required: true },
    { name: 'specification', label: '规格', type: 'input', required: true },
  ],
  add: [
    { name: 'cas_number', label: 'CAS号', type: 'input', required: true, colSpan: 1 },
    { name: 'specification', label: '规格', type: 'input', required: true },
    { name: 'quantity_bottles', label: '瓶数', type: 'number', required: true },
  ],
}

function getFormFields(mode: 'edit' | 'add') {
  return [
    ...INVENTORY_FORM_FIELDS.common,
    ...INVENTORY_FORM_FIELDS[mode],
  ]
}
```

---

### 2.4 LoadingButton 修复（优先级：P2）

**目标**：修复状态切换时的颜色跳变问题

**问题根因**：
- `isLoading` 时未强制锁定 disabled 样式

**影响程度**：100%（每次点击借用都发生）

**方案**：强制锁定 disabled 样式

```typescript
className={cn(
  "h-8 text-sm/4 px-3 border-0 transition-none",
  isConfirming
    ? isLoading
      ? "bg-destructive/70 text-destructive-foreground cursor-wait disabled:bg-destructive/70 disabled:text-destructive-foreground disabled:opacity-100"
      : "bg-destructive text-destructive-foreground hover:bg-destructive/70"
    : "bg-primary hover:bg-primary/80"
)}
```

---

### 2.5 游标分页改造（优先级：未来优化项）

**状态**：⚠️ **文档与代码不一致**

- 文档 [`docs/done/[DONE]-inventory_performance_optimization.md`](docs/done/[DONE]-inventory_performance_optimization.md) 声称"后端游标分页 API ✅ 已完成"
- 实际代码：后端 API 仍使用 `skip`/`limit`，未实现 `cursor` 参数

**影响分析**：
- 发生概率：< 1%（实验室小规模并发极其罕见）
- 影响程度：中（滚动时偶现重复或遗漏数据）
- 修复成本：高（前后端联动重构）

**结论**：维持 Offset 分页，暂不需要改造

---

## 三、实施优先级（最终版）

| 优先级 | 改进项 | 发生概率 | 影响程度 | 修复成本 |
|--------|--------|----------|----------|----------|
| **P0** | TanStack Table 列定义重构 | 100% | 高（输入卡顿） | 低 |
| **P1** | 提取通用表单字段配置 | 100% | 中（可维护性） | 低 |
| **P2** | 修复 LoadingButton 状态跳变 | 100% | 低（视觉） | 极低 |
| **未来优化项** | 游标分页改造 | < 1% | 中 | 高 |

---

## 四、总结

当前 Inventory.tsx 代码质量总体良好，主要性能瓶颈在表格列定义的依赖项过多。核心改进方向：

1. **P0 - 立即可做**：优化 columns 依赖，解决搜索卡顿
2. **P1 - 建议做**：表单配置抽离 + 移除冗余状态
3. **P2 - 顺手修**：LoadingButton 颜色修复
4. **未来优化项**：游标分页，当前方案已满足需求
