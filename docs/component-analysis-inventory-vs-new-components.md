# 组件重构分析报告：Inventory 页面 vs 新组件对比

## 一、概述

本文档详细对比 Inventory.tsx 页面与新组件（FilterTable、TableFilters、useTableState、tableConfigs、HighlightText）的代码对应关系，分析新组件是否完全保留原页面的功能和性能优化。

---

## 二、功能对比总览

| 功能模块 | Inventory.tsx 位置 | 新组件对应位置 | 状态 |
|---------|------------------|--------------|------|
| 搜索输入 | 行 593-610 | TableFilters.tsx 行 159-176 | ✅ 保留 |
| 模糊搜索 | 行 612-623 | TableFilters.tsx 行 181-189 | ✅ 保留 |
| 搜索字段选择 | 行 624-634 | TableFilters.tsx 行 191-205 | ✅ 保留 |
| 状态筛选 | 行 635-655 | TableFilters.tsx 行 207-221 | ✅ 保留 |
| 搜索防抖 300ms | 行 223-239 | useTableState.tsx 行 275-283 | ✅ 保留 |
| 列宽持久化 | 行 147-158 | useTableState.tsx 行 199-237 | ✅ 保留 |
| 无限滚动 | 行 199-219 | useTableState.tsx 行 313-331 | ✅ 保留 |
| 展开行渲染 | 行 726-742 | FilterTable.tsx 行 227 | ✅ 保留 |
| 展开全部 | 行 150, 160, 704-706 | useTableState.tsx 行 240-273 | ✅ 保留 |
| 空状态显示 | 行 712-721 | TableFilters.tsx 行 77-115 | ✅ 保留 |
| 表格列配置 | 行 436-528 | tableConfigs.tsx 行 28-133 | ✅ 保留 |
| 高亮搜索 | 行 109-134 | HighlightText.tsx | ✅ 增强 |
| 弹窗表单 | 行 659-696 | ❌ 未包含 | 需页面处理 |
| 删除功能 | 行 398-414 | ❌ 未包含 | 需页面处理 |
| 导出功能 | 行 416-431 | ❌ 未包含 | 需页面处理 |

---

## 三、详细代码对比

### 3.1 搜索筛选区域

#### Inventory.tsx (行 592-656)
```tsx
{/* 搜索过滤区域 */}
<div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
  <div className="relative flex-1 min-w-50">
    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
    <Input
      placeholder="搜索名称、CAS号、位置..."
      value={searchInput}
      onChange={(e) => setSearchInput(e.target.value)}
      className="pl-9 pr-8 text-base w-full inline-flex leading-none"
    />
    {searchInput && (
      <button onClick={() => setSearchInput('')}>
        <X className="w-4 h-4" />
      </button>
    )}
  </div>
  <div className="flex flex-wrap gap-2 items-center justify-between w-full sm:w-auto">
    {/* 模糊搜索 */}
    <label className="flex items-center gap-2 text-base cursor-pointer whitespace-nowrap">
      <Checkbox checked={fuzzySearch} onCheckedChange={...} />
      <span className="text-base pr-2">模糊搜索</span>
    </label>
    {/* 搜索字段选择 */}
    <Select value={searchField} onValueChange={...}>
      <SelectTrigger className="w-30 min-h-10"><SelectValue placeholder="全部" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">全部</SelectItem>
        <SelectItem value="name">名称</SelectItem>
        ...
      </SelectContent>
    </Select>
    {/* 状态筛选 */}
    <Select value={statusFilter} onValueChange={...}>
      <SelectTrigger className="w-30 min-h-10"><SelectValue placeholder="全部状态" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">全部状态</SelectItem>
        ...
      </SelectContent>
    </Select>
  </div>
</div>
```

#### TableFilters.tsx (行 154-239)
- ✅ 完全保留相同的布局结构
- ✅ 使用相同的图标和样式类
- ✅ 相同的状态绑定方式
- ✅ 清空按钮逻辑一致

**结论：功能完全保留**

---

### 3.2 搜索防抖优化

#### Inventory.tsx (行 223-239)
```tsx
useEffect(() => {
  const timer = setTimeout(() => {
    if (globalFilter !== searchInput) {
      setGlobalFilter(searchInput)
      // 筛选/搜索/排序时重置单行展开状态，但保持展开全部状态
      if (tableRef.current) {
        const wasAllExpanded = isAllExpanded
        tableRef.current.resetExpanded()
        if (wasAllExpanded) {
          tableRef.current.toggleAllRowsExpanded(true)
        }
      }
    }
  }, 300)
  return () => clearTimeout(timer)
}, [searchInput, globalFilter, isAllExpanded])
```

#### useTableState.tsx (行 275-283)
```tsx
useEffect(() => {
  const timer = setTimeout(() => {
    if (globalFilter !== searchInput) {
      setGlobalFilter(searchInput)
    }
  }, debounceMs)
  return () => clearTimeout(timer)
}, [searchInput, globalFilter, debounceMs])
```

**差异分析：**
- ✅ 防抖时间默认 300ms，参数可配置
- ⚠️ **缺失**：防抖时重置展开状态的逻辑移至 FilterTable.tsx (行 166-175)

#### FilterTable.tsx (行 166-175)
```tsx
useEffect(() => {
  if (filter.hasFilter || filter.sorting.length > 0) {
    if (enableExpandAll && filter.isAllExpanded) {
      table.resetExpanded()
      table.toggleAllRowsExpanded(true)
    } else {
      table.resetExpanded()
    }
  }
}, [filter.hasFilter, filter.sorting, enableExpandAll, filter.isAllExpanded, table])
```

**结论：功能保留，逻辑位置调整**

---

### 3.3 列宽持久化优化

#### Inventory.tsx (行 147-158)
```tsx
const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(() => {
  try { return JSON.parse(localStorage.getItem('inventory-table-col-sizes') || '{}') } catch { return {} }
})

useEffect(() => {
  const timer = setTimeout(() => {
    localStorage.setItem('inventory-table-col-sizes', JSON.stringify(columnSizing))
  }, 500)
  return () => clearTimeout(timer)
}, [columnSizing])
```

#### useTableState.tsx (行 199-237)
```tsx
const columnSizingStorageKey = `${storageKeyPrefix}-${tableId}`
const [columnSizing, setColumnSizingState] = useState<ColumnSizingState>(() => {
  if (typeof window === 'undefined') return {}
  try {
    const stored = localStorage.getItem(columnSizingStorageKey)
    if (stored) return JSON.parse(stored)
  } catch { return {} }
  return {}
})

useEffect(() => {
  const timer = setTimeout(() => {
    try {
      if (Object.keys(columnSizing).length > 0) {
        localStorage.setItem(columnSizingStorageKey, JSON.stringify(columnSizing))
      }
    } catch { }
  }, columnSizingDebounceMs)
  return () => clearTimeout(timer)
}, [columnSizing, columnSizingStorageKey, columnSizingDebounceMs])
```

**改进点：**
- ✅ 防抖时间可配置（默认 500ms）
- ✅ 动态生成 localStorage key，支持多表格
- ✅ 增加 SSR 兼容判断

**结论：功能保留且增强**

---

### 3.4 无限滚动查询

#### Inventory.tsx (行 178-219)
```tsx
const queryFn = useCallback(async ({ pageParam = 0 }) => {
  const currentSorting = sorting.length > 0 ? sorting : sortingRef.current
  const sort = currentSorting[0]

  const params: Record<string, unknown> = { skip: pageParam, limit: 50 }

  if (statusFilter !== 'all') params.status_filter = statusFilter
  if (globalFilter) {
    params.search = globalFilter
    if (searchField !== 'all') params.search_field = searchField
    if (fuzzySearch) params.fuzzy = true
  }
  if (sort) {
    params.sort_by = sort.id
    params.sort_order = sort.desc ? 'desc' : 'asc'
  }

  const response = await inventoryAPI.list(params as any)
  return response.data
}, [statusFilter, globalFilter, searchField, fuzzySearch, sorting])

const { data: allData, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage, refetch } = useInfiniteQuery({
  queryKey: ['inventory', statusFilter, globalFilter, searchField, fuzzySearch, sorting],
  queryFn,
  initialPageParam: 0,
  getNextPageParam: (lastPage, allPages) => {
    const currentLoadedCount = allPages.reduce((acc, page) => acc + page.data.length, 0)
    if (currentLoadedCount < (lastPage.total || 0)) return currentLoadedCount
    return null
  },
  placeholderData: keepPreviousData,
})
```

#### useTableState.tsx (行 286-331)
```tsx
const queryFn = useCallback(async ({ pageParam = 0 }) => {
  const currentSorting = sorting.length > 0 ? sorting : sortingRef.current
  const sort = currentSorting[0]

  const params: Record<string, unknown> = {
    skip: pageParam,
    limit: pageSize,
    ...extraParams,
  }

  if (statusFilter !== 'all' && statusFilter !== defaultStatus) {
    params.status_filter = statusFilter
  }
  if (globalFilter) {
    params.search = globalFilter
    if (searchField !== 'all') params.search_field = searchField
    if (fuzzySearch) params.fuzzy = true
  }
  if (sort) {
    params.sort_by = sort.id
    params.sort_order = sort.desc ? 'desc' : 'asc'
  }

  const response = await api.list(params)
  return response.data
}, [api, statusFilter, globalFilter, searchField, fuzzySearch, sorting, pageSize, extraParams, defaultStatus])

const { data: allData, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage, refetch } = useInfiniteQuery({
  queryKey: [...queryKey, statusFilter, globalFilter, searchField, fuzzySearch, sorting],
  queryFn,
  initialPageParam: 0,
  getNextPageParam: (lastPage, allPages) => {
    const currentLoadedCount = allPages.reduce((acc, page) => acc + page.data.length, 0)
    if (currentLoadedCount < (lastPage.total || 0)) return currentLoadedCount
    return null
  },
  placeholderData: keepPreviousData,
})
```

**改进点：**
- ✅ pageSize 可配置
- ✅ 支持 extraParams 额外参数
- ✅ defaultStatus 可配置
- ✅ queryKey 前缀可配置

**结论：功能完全保留且增强**

---

### 3.5 展开全部功能

#### Inventory.tsx (行 150, 160, 704-706)
```tsx
const [isAllExpanded, setIsAllExpanded] = useState<boolean>(false)
const toggleExpandAll = useCallback(() => setIsAllExpanded(prev => !prev), [])

// 按钮
<Button variant="morden" size="lg" onClick={toggleExpandAll} className="ml-auto flex font-normal">
  {isAllExpanded ? <><ChevronsDownUp className="size-4 mr-1.5" />收起全部</> : <><ChevronsUpDown className="size-4 mr-1.5" />展开全部</>}
</Button>
```

#### useTableState.tsx (行 240-273)
```tsx
const expandKey = expandStorageKey || `${tableId}-expand-all`
const [isAllExpanded, setIsAllExpanded] = useState<boolean>(() => {
  if (typeof window === 'undefined') return defaultExpanded
  try {
    const stored = localStorage.getItem(expandKey)
    if (stored !== null) return stored === 'expanded' || stored === 'true'
  } catch { return defaultExpanded }
  return defaultExpanded
})

useEffect(() => {
  try {
    localStorage.setItem(expandKey, isAllExpanded ? 'expanded' : 'collapsed')
  } catch { }
}, [isAllExpanded, expandKey])

const toggleExpandAll = useCallback(() => {
  setIsAllExpanded(prev => !prev)
}, [])
```

**改进点：**
- ✅ localStorage 持久化（Inventory.tsx 原有代码似乎未持久化，FilterTable 继承后有持久化）
- ✅ 动态 key 支持多表格

**结论：功能保留且增强**

---

### 3.6 表格列配置

#### Inventory.tsx (行 436-528)
```tsx
const columns = useMemo(() => [
  columnHelper.accessor('cas_number', { header: 'CAS号', size: 120, ... }),
  columnHelper.accessor('name', { header: '名称', size: 250, ... }),
  columnHelper.accessor('storage_location', { ... }),
  columnHelper.accessor('category', { ... }),
  columnHelper.accessor('brand', { ... }),
  columnHelper.accessor('remaining_quantity', { id: 'remaining_percent', ... }),
  columnHelper.accessor('status', { ... }),
  columnHelper.display({ id: 'actions', ... }),
], [])
```

#### tableConfigs.tsx (行 28-133)
```tsx
export function getInventoryTableColumns(): ColumnDef<TableRowData, unknown>[] {
  return [
    columnHelper.accessor('cas_number', { header: 'CAS号', size: 120, ... }),
    columnHelper.accessor('name', { header: '名称', size: 250, ... }),
    columnHelper.accessor('storage_location', { ... }),
    columnHelper.accessor('category', { ... }),
    columnHelper.accessor('brand', { ... }),
    columnHelper.accessor('remaining_quantity', { id: 'remaining_percent', ... }),
    columnHelper.accessor('status', { ... }),
    // ⚠️ 缺失：操作列 (id: 'actions')
  ]
}
```

**⚠️ 差异分析：**
- tableConfigs.tsx 中的 `getInventoryTableColumns` **未包含操作列 (actions)**
- 操作列需要通过 `renderActions` prop 单独传入 FilterTable

**结论：基本保留，操作列需额外处理**

---

### 3.7 高亮搜索组件

#### Inventory.tsx (行 109-134) - 内联定义
```tsx
const HighlightText = React.memo(function HighlightText({ text, highlight, fuzzy }) {
  const regex = React.useMemo(() => new RegExp(`(${highlight})`, 'gi'), [highlight])
  if (!highlight || !text) return <>{text}</>

  if (fuzzy) {
    const normalizedHighlight = highlight.replace(/[\s\u00A0\u2002\u2003\u2009\u200C\u200D_.-]+/g, '')
    const normalizedText = text.replace(/[\s\u00A0\u2002\u2003\u2009\u200C\u200D_.-]+/g, '')
    if (normalizedText.toLowerCase().includes(normalizedHighlight.toLowerCase())) {
      return <span className="bg-amber-200 dark:bg-amber-800/50">{text}</span>
    }
    return <>{text}</>
  }

  const parts = text.split(regex)
  return <>{parts.map(...)}</>
})
```

#### HighlightText.tsx - 独立组件
- ✅ React.memo 优化
- ✅ 模块级正则缓存（regexCache）
- ✅ 防内存泄漏策略（超过50种搜索词清空缓存）
- ✅ 极速阻断优化（无文本/无搜索词时直接返回）
- ✅ 更好的类型定义
- ✅ fuzzy 模式使用 RegExp.test 避免内存分配

**结论：功能保留且显著增强性能**

---

### 3.8 空状态显示

#### Inventory.tsx (行 712-721)
```tsx
{globalFilter && statusFilter && statusFilter !== 'all'
  ? `"${globalFilter}"的"${statusFilter === 'in_stock' ? '在库' : ...}"记录`
  : globalFilter
    ? `未找到匹配"${globalFilter}"的记录`
    : hasFilter
      ? '未找到符合条件的记录'
      : '暂无库存数据，请先入库'}
```

#### TableFilters.tsx (行 77-115)
```tsx
function TableEmptyState({ searchKeyword, statusFilter, hasFilter }) {
  const getMessage = () => {
    const statusLabels = { in_stock: '在库', not_in_stock: '不在库', ... }

    if (searchKeyword && statusFilter && statusFilter !== 'all') {
      const statusLabel = statusLabels[statusFilter] || statusFilter
      return `未找到匹配"${searchKeyword}"的"${statusLabel}"记录`
    }

    if (searchKeyword) return `未找到匹配"${searchKeyword}"的记录`
    if (hasFilter) return '未找到符合条件的记录'

    return '暂无数据'  // ⚠️ 差异：缺少 "请先入库" 提示
  }
}
```

**⚠️ 差异分析：**
- 库存页面特有的"暂无库存数据，请先入库"提示未保留
- 通用组件改为更通用的"暂无数据"

**结论：基本保留，库存特定提示需通过 prop 定制**

---

### 3.9 缺失的功能

以下 Inventory.tsx 功能在新组件中**未包含**，需要在使用 FilterTable 的页面中自行处理：

| 功能 | Inventory.tsx 位置 | 说明 |
|-----|------------------|------|
| 弹窗表单 | 行 659-696 | 手动入库/编辑 Dialog |
| 表单验证 | 行 270-396 | useForm + valibot |
| 删除功能 | 行 398-414 | 删除确认逻辑 |
| 导出功能 | 行 416-431 | CSV 导出 |
| 刷新功能 | 行 242-247 | loadInventory |
| 借用功能 | 行 799-815 | 借用 API 调用 |

---

## 四、性能优化对比

| 优化项 | Inventory.tsx | 新组件 | 状态 |
|-------|--------------|--------|------|
| 搜索防抖 300ms | ✅ | ✅ (可配置) | 保留 |
| 列宽持久化防抖 500ms | ✅ | ✅ (可配置) | 保留 |
| React.memo 阻断多余渲染 | ActionButtons | 通用组件已 memo | 保留 |
| HighlightText 正则缓存 | ❌ | ✅ | 增强 |
| 搜索时保持展开全部状态 | ✅ | ✅ | 保留 |

---

## 五、总结

### ✅ 完全保留的功能
1. 搜索输入框及清空逻辑
2. 模糊搜索开关
3. 搜索字段选择
4. 状态筛选
5. 搜索防抖 300ms
6. 列宽持久化
7. 无限滚动分页
8. 展开/收起全部
9. 展开行渲染
10. 空状态显示
11. 表格列配置（除操作列）

### ⚠️ 需要调整的功能
1. **操作列**：需通过 `renderActions` prop 传入
2. **空状态文案**：库存特定提示需定制
3. **展开状态重置逻辑**：移至 FilterTable 内部处理

### ❌ 未包含的功能（需页面处理）
1. 弹窗表单（新增/编辑）
2. 表单验证逻辑
3. 删除功能
4. 导出功能
5. 刷新数据
6. 借用功能

### 性能优化评估
- 新组件在性能上**等同或优于**原 Inventory.tsx
- HighlightText 组件增加了正则缓存，显著提升大量单元格渲染性能
- 列宽持久化和搜索防抖均可配置，更灵活

### 建议
1. 使用新组件时，需在页面中处理弹窗、表单、删除、导出等功能
2. 如需库存特定空状态提示，可在 TableFilters 外层包裹或自定义
3. 操作列通过 `renderActions` prop 传入，保持灵活性
