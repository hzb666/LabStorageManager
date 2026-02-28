# Inventory 页面代码分析文档

## 一、代码结构概览

### 1.1 导入模块 (Imports)

| 导入内容 | 用途 | 状态 |
|---------|------|------|
| React hooks | 状态管理 | ✅ 必需 |
| @tanstack/react-table | 表格组件 | ✅ 必需 |
| @tanstack/react-query | 数据请求 | ✅ 必需 |
| react-hook-form | 表单管理 | ✅ 必需 |
| @hookform/resolvers/valibot | 表单验证 | ✅ 必需 |
| UI 组件 (Button, Input, Checkbox, Select, Card, Dialog) | UI 构建 | ✅ 必需 |
| @/api/client | API 调用 | ✅ 必需 |
| @/components/ui/Toast | 提示消息 | ✅ 必需 |
| @/components/ui/DataTable | 表格组件 | ✅ 必需 |
| @/lib/utils | 工具函数 | ✅ 必需 |
| @/lib/validationSchemas | 验证规则 | ✅ 必需 |
| @/components/BaseForm | 表单组件 | ✅ 必需 |
| @/hooks/useDialogState | Dialog 状态管理 | ✅ 必需 |
| lucide-react icons | 图标 | ✅ 必需 |
| @/components/ui/StatusBadge | 状态徽章 | ✅ 必需 |
| @/components/ui/HazardousIcon | 危险品图标 | ✅ 必需 |
| @/components/ui/QuantityIndicator | 数量指示器 | ✅ 必需 |
| @/components/ui/LoadingButton | 加载按钮 | ✅ 必需 |

**结论**: 无冗余导入

---

## 二、类型定义 (Type Definitions)

### 2.1 ValidationError 接口
```typescript
interface ValidationError {
  loc?: (string | number)[]
  msg?: string
  type?: string
}
```
**用途**: 后端验证错误解析  
**状态**: ✅ 必需 - 用于手动入库表单的错误处理

### 2.2 InventoryItem 接口
```typescript
interface InventoryItem {
  id: number
  cas_number: string
  name: string
  english_name: string | null
  alias: string | null
  category: string | null
  brand: string | null
  storage_location: string | null
  initial_quantity: number
  remaining_quantity: number
  unit: string
  status: string
  is_hazardous: boolean
  created_at: string
  notes: string | null
  specification?: string
  created_by_id?: number | null
  created_by_name?: string | null
  borrower_id?: number | null
  borrower_name?: string | null
  last_borrower_id?: number | null
  last_borrower_name?: string | null
}
```
**用途**: 库存数据类型定义  
**状态**: ✅ 必需 - 所有字段都在表格、展开行、表单中使用

---

## 三、组件定义 (Components)

### 3.1 HighlightText 组件 (lines 77-110)
```typescript
const HighlightText = React.memo(function HighlightText({ text, highlight, fuzzy }: { text: string; highlight: string; fuzzy?: boolean })
```
**功能**: 
- 高亮搜索匹配的文本
- 支持精确搜索和模糊搜索
- 使用 React.memo 优化渲染

**状态**: ✅ 必需 - 用于表格单元格的搜索高亮

### 3.2 ActionButtons 组件 (lines 112-207)
```typescript
const ActionButtons = React.memo(function ActionButtons({ item, onEdit, onBorrowSuccess }: {...})
```
**功能**:
- 编辑按钮 (打开编辑弹窗)
- 借用按钮 (在库状态时显示)
- 借用确认逻辑 (首次点击确认，再次点击执行)
- 错误处理 (409 冲突提示)

**状态**: ✅ 必需 - 表格操作列

---

## 四、主组件状态 (State Management)

### 4.1 表格状态

| 状态变量 | 用途 | 行号 | 状态 |
|---------|------|------|------|
| `sorting` | 表格排序状态 | 210 | ✅ 必需 |
| `columnSizing` | 列宽调整状态 | 211-218 | ✅ 必需 (持久化到 localStorage) |
| `isAllExpanded` | 展开所有行 | 221-228 | ✅ 必需 (持久化到 localStorage) |
| `tableHeight` | 表格高度计算 | 238 | ✅ 必需 |

### 4.2 筛选状态

| 状态变量 | 用途 | 行号 | 状态 |
|---------|------|------|------|
| `globalFilter` | 全局搜索文本 | 219 | ✅ 必需 |
| `statusFilter` | 状态筛选 | 220 | ✅ 必需 |
| `searchField` | 搜索字段选择 | 240 | ✅ 必需 |
| `fuzzySearch` | 模糊搜索开关 | 241 | ✅ 必需 |
| `displayFilter` | 显示的筛选文本 | 480 | ⚠️ 可优化 (见下文) |

### 4.3 对话框状态

| 状态变量 | 用途 | 行号 | 状态 |
|---------|------|------|------|
| `dialogState` | 弹窗状态 (edit/add) | 326 | ✅ 必需 |
| `deleteConfirm` | 删除确认状态 | 327 | ✅ 必需 |
| `editingItem` | 当前编辑项 | 328 | ✅ 必需 |

---

## 五、数据查询 (Data Fetching)

### 5.1 useInfiniteQuery 配置 (lines 277-305)

```typescript
const { data: allData, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage, refetch } = useInfiniteQuery({
  queryKey: ['inventory', statusFilter, globalFilter, searchField, fuzzySearch, sorting],
  queryFn,
  initialPageParam: 0,
  getNextPageParam: (lastPage, allPages) => {...},
  placeholderData: keepPreviousData,
  refetchInterval: 10000,
  refetchPage: (page, index) => index >= 0,
})
```

**功能**:
- 无限滚动分页
- 10秒自动刷新
- 保持筛选状态

**⚠️ 已知问题**:
- `refetchPage: (page, index) => index >= 0` - TypeScript 类型错误 (预存在问题)
- `params as any` - 类型断言 (预存在问题)

### 5.2 数据处理

| 变量 | 用途 | 行号 | 状态 |
|------|------|------|------|
| `queryFn` | 查询函数 | 245-275 | ✅ 必需 |
| `loadInventory` | 刷新函数 | 307-309 | ✅ 必需 |
| `data` | 扁平化数据 | 311 | ✅ 必需 |
| `total` | 总数 | 312 | ✅ 必需 |
| `grandTotal` | 无筛选总数 | 314 | ✅ 必需 |
| `grandTotalRef` | 总数引用 | 315 | ✅ 必需 |
| `displayCount` | 显示计数 | 324 | ✅ 必需 |

---

## 六、表单处理 (Forms)

### 6.1 编辑表单 (Edit Form)

| 变量/函数 | 用途 | 行号 | 状态 |
|----------|------|------|------|
| `editForm` | 表单实例 | 331-348 | ✅ 必需 |
| `handleEditModalClose` | 关闭弹窗 | 350-356 | ✅ 必需 |
| `handleEditSave` | 保存编辑 | 358-380 | ✅ 必需 |
| `handleEditClick` | 点击编辑 | 382-401 | ✅ 必需 |

**字段配置** (BaseForm):
- name (试剂名称) - 必填
- cas_number (CAS号) - 只读
- english_name (英文名称)
- alias (别名)
- storage_location (存放位置)
- remaining_quantity (剩余量) - 必填
- specification (规格) - 必填
- brand (品牌)
- category (分类)
- is_hazardous (危险品)
- notes (备注)

### 6.2 手动入库表单 (Add Form)

| 变量/函数 | 用途 | 行号 | 状态 |
|----------|------|------|------|
| `addSubmitting` | 提交状态 | 404 | ✅ 必需 |
| `addForm` | 表单实例 | 405-422 | ✅ 必需 |
| `handleManualAddModalClose` | 关闭弹窗 | 424-429 | ✅ 必需 |
| `handleManualAdd` | 提交入库 | 431-477 | ✅ 必需 |

**字段配置** (BaseForm):
- name (试剂名称) - 必填
- cas_number (CAS号) - 必填
- english_name (英文名称)
- alias (别名)
- storage_location (存放位置)
- specification (规格) - 必填
- quantity_bottles (瓶数) - 必填
- brand (品牌)
- category (分类)
- is_hazardous (危险品)
- notes (备注)

---

## 七、表格配置 (Table Configuration)

### 7.1 列定义 (lines 514-622)

| 列名 | 字段 | 功能 | 状态 |
|------|------|------|------|
| CAS号 | cas_number | 搜索高亮 | ✅ |
| 名称 | name | 危险品图标 + 搜索高亮 | ✅ |
| 分类 | category | 搜索高亮 | ✅ |
| 位置 | storage_location | 搜索高亮 + 排序 | ✅ |
| 品牌 | brand | 搜索高亮 | ✅ |
| 剩余/规格 | remaining_quantity | 数量指示器 | ✅ |
| 状态 | status | 状态徽章 | ✅ |
| 操作 | actions | 编辑 + 借用按钮 | ✅ |

### 7.2 表格配置 (lines 624-648)

```typescript
const table = useReactTable({
  data, columns,
  getRowId: (row) => String(row.id),
  getCoreRowModel: getCoreRowModel(),
  getExpandedRowModel: getExpandedRowModel(),
  getRowCanExpand: () => true,
  columnResizeMode: 'onChange',
  enableColumnResizing: true,
  manualSorting: true,
  ...
})
```

**功能**:
- 行展开支持
- 列宽调整
- 手动排序
- 无限滚动

---

## 八、事件处理 (Event Handlers)

| 函数 | 用途 | 行号 | 状态 |
|------|------|------|------|
| `toggleExpandAll` | 切换展开/收起 | 234-236 | ✅ 必需 |
| `handleStatusFilterChange` | 状态筛选变更 | 490-493 | ✅ 必需 |
| `handleDeleteClick` | 删除库存项 | 495-512 | ✅ 必需 |
| `handleExport` | 导出 CSV | 657-675 | ✅ 必需 |

---

## 九、渲染内容 (Render)

| 区域 | 行号 | 功能 | 状态 |
|------|------|------|------|
| Header | 679-691 | 标题 + 手动入库/导出按钮 | ✅ |
| Search & Filters | 693-765 | 搜索框 + 模糊搜索 + 字段选择 + 状态筛选 | ✅ |
| Edit Modal | 767-806 | 编辑表单 + 删除按钮 | ✅ |
| Add Modal | 808-837 | 手动入库表单 | ✅ |
| Table | 839-932 | 数据表格 + 展开行 | ✅ |

---

## 十、冗余代码分析

### 10.1 已确认冗余 (已优化)

| 项目 | 原代码 | 优化后 | 状态 |
|------|--------|--------|------|
| addForm.reset() | `addForm.reset({name: '', ...})` | `addForm.reset()` | ✅ 已优化 |

### 10.2 潜在冗余 (可优化)

| 项目 | 描述 | 建议 |
|------|------|------|
| `displayFilter` 状态 | 与 `globalFilter` 同步复制 | 可考虑移除，仅使用 `globalFilter` |
| 注释中的标记 | 如 `【核心改造】` | 可清理历史注释 |

### 10.3 预存在问题 (非本次重构引入)

| 问题 | 位置 | 描述 |
|------|------|------|
| TypeScript 错误 | line 304 | `refetchPage` 类型错误 |
| any 类型 | line 272 | `params as any` |
| 隐式 any | line 304 | 参数 `page`, `index` 隐式 any |

---

## 十一、功能清单

### 11.1 核心功能

| 功能 | 实现方式 | 状态 |
|------|----------|------|
| 库存列表展示 | DataTable + 分页 | ✅ |
| 无限滚动加载 | useInfiniteQuery | ✅ |
| 搜索功能 | globalFilter + 字段筛选 | ✅ |
| 模糊搜索 | fuzzySearch 开关 | ✅ |
| 状态筛选 | statusFilter (all/in_stock/borrowed/consumed) | ✅ |
| 列宽调整 | columnSizing + localStorage | ✅ |
| 行展开详情 | getExpandedRowModel | ✅ |
| 展开/收起全部 | toggleExpandAll + localStorage | ✅ |
| 10秒自动刷新 | refetchInterval | ✅ |

### 11.2 操作功能

| 功能 | 实现方式 | 状态 |
|------|----------|------|
| 手动入库 | BaseForm + inventoryAPI.manualAdd | ✅ |
| 编辑库存 | BaseForm + inventoryAPI.update | ✅ |
| 删除库存 | inventoryAPI.delete | ✅ |
| 借用库存 | inventoryAPI.borrow | ✅ |
| 导出 CSV | inventoryAPI.exportInventory | ✅ |

### 11.3 表单验证

| 表单 | 验证方式 | 状态 |
|------|----------|------|
| 编辑表单 | InventoryFormSchema + valibotResolver | ✅ |
| 手动入库表单 | InventoryFormSchema + valibotResolver | ✅ |

---

## 十二、文件依赖关系

```
Inventory.tsx
├── @/components/ui/Button
├── @/components/ui/Input
├── @/components/ui/Checkbox
├── @/components/ui/Select
├── @/components/ui/Card
├── @/components/ui/Dialog
├── @/components/ui/StatusBadge
├── @/components/ui/HazardousIcon
├── @/components/ui/QuantityIndicator
├── @/components/ui/LoadingButton
├── @/components/ui/DataTable
├── @/components/ui/Toast
├── @/components/BaseForm
├── @/api/client (inventoryAPI)
├── @/lib/utils (formatDate, cn)
├── @/lib/validationSchemas (InventoryFormSchema, InventoryFormData)
├── @/hooks/useDialogState
└── lucide-react (icons)
```

---

*文档生成时间: 2026-02-28*
