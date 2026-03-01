# 试剂订单页面功能完善计划

## 目标

对比库存页面，为试剂订单页面(ReagentOrders.tsx)添加缺失的功能。

---

## 一、实施状态总览

| 功能                                 | 状态      | 备注    |
| ------------------------------------ | --------- | ------- |
| 后端 list API 添加 search 参数       | ✅ 已完成 |         |
| 后端 list API 添加 search_field 参数 | ✅ 已完成 |         |
| 后端 list API 添加 fuzzy 参数        | ✅ 已完成 |         |
| 后端 list API 添加 sort_by 参数      | ✅ 已完成 |         |
| 后端 list API 添加 sort_order 参数   | ✅ 已完成 |         |
| 后端添加 export API                  | ✅ 已完成 |         |
| 前端 fuzzySearch state               | ✅ 已完成 | 第173行 |
| 前端 searchField state               | ✅ 已完成 | 第172行 |
| 前端 statusFilter state              | ✅ 已完成 | 第171行 |
| 前端 sortingRef                      | ✅ 已完成 | 第174行 |
| 前端 grandTotal state                | ✅ 已完成 | 第177行 |
| 前端 grandTotalRef                   | ✅ 已完成 | 第178行 |
| 前端模糊搜索 Checkbox UI             | ✅ 已完成 |         |
| 前端搜索字段 Select UI               | ✅ 已完成 |         |
| 前端状态筛选 Select UI               | ✅ 已完成 |         |
| 前端手动排序                         | ✅ 已完成 |         |
| 前端搜索高亮                         | ✅ 已完成 |         |
| 前端导出功能                         | ✅ 已完成 |         |
| 前端总数显示                         | ✅ 已完成 |         |

---

## 二、库存页面 vs 试剂订单页面功能对比 (实施后)

| 功能         | 库存页面 (Inventory.tsx) | 试剂订单页面 (ReagentOrders.tsx) |
| ------------ | ------------------------ | -------------------------------- |
| 模糊搜索     | ✅                       | ✅ 已实现                        |
| 搜索字段选择 | ✅                       | ✅ 已实现                        |
| 状态筛选     | ✅                       | ✅ 已实现                        |
| 排序功能     | ✅                       | ✅ 已实现                        |
| 搜索高亮     | ✅                       | ✅ 已实现                        |
| 导出功能     | ✅                       | ✅ 已实现                        |
| 总数显示     | ✅                       | ✅ 已实现                        |

---

## 三、后端 API 实现

### 3.1 list_reagent_orders 参数 (reagent_orders.py:135)

```python
@router.get("/")
def list_reagent_orders(
    skip: int = 0,
    limit: int = 50,
    status_filter: Optional[ReagentOrderStatus] = None,
    search: Optional[str] = None,
    search_field: Optional[str] = None,
    fuzzy: bool = False,
    sort_by: Optional[str] = None,
    sort_order: Optional[str] = 'desc',
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
```

**实现位置**: reagent_orders.py 第135-231行

**搜索字段支持**: name, cas_number, brand, category

**排序字段支持**: cas_number, name, category, brand, quantity, price, status, order_reason, created_at, updated_at

### 3.2 export_reagent_orders (reagent_orders.py:254)

```python
@router.get("/export")
def export_reagent_orders(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
```

**实现位置**: reagent_orders.py 第254-298行

---

## 四、前端代码实现

### 4.1 状态变量定义 (ReagentOrders.tsx)

| 变量          | 行号 | 代码                                                                |
| ------------- | ---- | ------------------------------------------------------------------- |
| statusFilter  | 171  | `const [statusFilter, setStatusFilter] = useState<string>('all')` |
| searchField   | 172  | `const [searchField, setSearchField] = useState('all')`           |
| fuzzySearch   | 173  | `const [fuzzySearch, setFuzzySearch] = useState(false)`           |
| sortingRef    | 174  | `const sortingRef = useRef<SortingState>([])`                     |
| grandTotal    | 177  | `const [grandTotal, setGrandTotal] = useState(0)`                 |
| grandTotalRef | 178  | `const grandTotalRef = useRef(0)`                                 |

### 4.2 查询函数 (queryFn)

**位置**: ReagentOrders.tsx 第241-268行

```typescript
const queryFn = useCallback(async ({ pageParam = 0 }: { pageParam: number }) => {
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

  const response = await reagentOrderAPI.list(params as any)
  return response.data
}, [statusFilter, globalFilter, searchField, fuzzySearch, sorting])
```

### 4.3 Query Key

**位置**: ReagentOrders.tsx 第277行

```typescript
queryKey: ['reagent-orders', statusFilter, globalFilter, searchField, fuzzySearch, sorting],
```

### 4.4 总数统计

**位置**: ReagentOrders.tsx 第289-299行

```typescript
useEffect(() => {
  if (!globalFilter && total > 0) {
    grandTotalRef.current = total
    setGrandTotal(total)
  }
}, [total, globalFilter])

const displayCount = globalFilter ? `${total}/${grandTotalRef.current}` : `${grandTotal}`
```

### 4.5 HighlightText 组件

**位置**: ReagentOrders.tsx 第111-136行

### 4.6 handleExport 函数

**位置**: ReagentOrders.tsx 第454-468行

```typescript
const handleExport = useCallback(async () => {
  try {
    const response = await reagentOrderAPI.exportOrders()
    const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `reagent_orders_${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  } catch {
    toast.error('导出失败')
  }
}, [])
```

### 4.7 表格配置

**位置**: ReagentOrders.tsx 第590-618行

- manualSorting: true
- onSortingChange: 处理排序状态
- meta: fuzzySearch, onEdit

### 4.8 搜索 UI

**位置**: ReagentOrders.tsx 第635-693行

- 模糊搜索 Checkbox (第658-668行)
- 搜索字段 Select (第669-679行)
- 状态筛选 Select (第680-690行)

**状态选项**:

- 全部
- pending (待审批)
- approved (已审批)
- arrived (已到货)
- stocked (已入库)
- rejected (已驳回)

### 4.9 导出按钮

**位置**: ReagentOrders.tsx 第629行

```typescript
{isAdmin && (
  <Button variant="morden" size="lg" onClick={handleExport}>
    <ArrowUpFromLine className="w-4 h-4 mr-1.5" /> 导出
  </Button>
)}
```

### 4.10 总数显示

**位置**: ReagentOrders.tsx 第701行

```typescript
试剂订单列表 <span className="text-muted-foreground font-normal">( {displayCount} )</span>
```

---

## 五、前端 API Client

### 5.1 reagentOrderAPI.list

**位置**: client.ts 第108-115行

```typescript
list: (params?: PaginationParams & {
  status_filter?: string
  search?: string
  search_field?: string
  fuzzy?: boolean
  sort_by?: string
  sort_order?: string
}) => api.get('/reagent-orders', { params }),
```

### 5.2 reagentOrderAPI.exportOrders

**位置**: client.ts 第141行

```typescript
exportOrders: () => api.get('/reagent-orders/export', { responseType: 'blob' }),
```

---

## 六、修复的问题

### 问题 1: StreamingResponse 导入错误

**问题**: 从 `fastapi` 直接导入 `StreamingResponse` 导致 500 错误

**修复**: 改为从 `fastapi.responses` 导入

```python
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from fastapi.responses import StreamingResponse
```

### 问题 2: 缺少 sortingRef 定义

**问题**: 代码使用了 `sortingRef.current` 但未定义

**修复**: 添加 `const sortingRef = useRef<SortingState>([])`

### 问题 3: 缺少 grandTotalRef 定义

**问题**: 代码使用了 `grandTotalRef.current` 但未定义

**修复**: 添加 `const grandTotalRef = useRef(0)`

---

## 七、测试要点

1. ✅ 模糊搜索功能正常
2. ✅ 搜索字段选择正确过滤 (全部/名称/CAS号/品牌/分类)
3. ✅ 状态筛选正确过滤 (待审批/已审批/已到货/已入库/已驳回)
4. ✅ 点击表头排序生效
5. ✅ 搜索关键词高亮显示
6. ✅ 导出功能下载 CSV (仅管理员)
7. ✅ 总数显示正确 (有筛选时显示 `当前/总数`)

---

*文档更新日期: 2026-03-02*
*状态: 已完成*
