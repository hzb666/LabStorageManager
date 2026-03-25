# 表格与表单体系

## 表格基础设施

- `FilterTable` 是业务页面的通用骨架：它把 `TableFilters`、`DataTable`、分页控制、展开/展开、列宽等行为组合在一个卡片内，并仅通过 `api`、`tableId`、`queryKey` 等配置与页面绑定。
- `DataTable` 负责表格渲染细节：拿到 TanStack Table 实例后会在 `DataTableHeader`/`DataTableBody` 之间同步滚动、计算滚动条宽度、允许列自定义 resize，并传入 `useVirtualizer` 管理虚拟化。
- `TableFilters` 提供统一的搜索输入、模糊切换、字段选择、状态下拉，输入回调会传到 `useTableState`，所有页面复用同一套 filters，保持行为一致。

## 状态 + 虚拟滚动 + 持久化

- `useTableState` 是列表页状态的“大脑”：它把 `globalFilter`、`statusFilter`、`searchField`、`sorting`、`fuzzySearch`、`columnSizing`、`isAllExpanded` 和分页（`data`/`total`）整合。借助 `useInfiniteQuery` + `FilterAPI.list` 提供无限滚动，`getNextPageParam` 根据当前加载数量算下一页 offset。
- 列宽与展开状态分别通过 `localStorage` 持久化：`columnSizing` 在变更后经过 `columnSizingDebounceMs` 再写，展开状态/模糊开关则和 `tableId` 相关的 key 共享缓存，Page-level 组件可以在状态恢复后立刻显示上次设定。
- `FilterTable` 还通过 `useLocationSearchSync`、`useTableUrlState` 让 `globalFilter/page/filters` 内容与 URL search 保持双向同步，方便书签/路由记忆，URL 版分页从 1 开始，内部统一转换为 TanStack Table 的 `pageIndex`，并在状态清空时自动从 query string 中删除字段。

## 虚拟滚动 + SSE + URL 的协作

- `DataTable` 在 `useVirtualizer` 中根据 `rows`、`isAllExpanded`、`estimatedRowHeight` 估算行高，并与 `useDataTableScroll`、`useBulkExpand` 协同：滚动条触发 `handleInfiniteScroll` 发送 `fetchNextPage`，点击展开会平滑滚动到可见区域。
- `useBulkExpand` 负责批量展开/收起时的锚点恢复与虚拟计算，`useColumnResize` 提供握住两列拖动时按 min/max 约束的权重计算。
- `Table` 实例的 `meta` 交给 `useTableState` 传入 `fuzzySearch`、`onEdit`、`onBorrowSuccess` 后，`FilterTable` 中的 `DataTable` 会在 `renderExpandedRow` 和 `noteField` 中使用 `row.getIsExpanded()` 等状态。

## 表单配置系统

- `BaseForm` 是配置驱动表单的统一 renderer：支持 `fields` 数组模式或 `FormSchema`，每个字段都会根据 `type`（`input`/`select`/`checkbox`/`autocomplete`）映射到对应的 UI 组件，还会处理 `error`、`disabled`/`readOnly` 等共享逻辑。
- `formConfigs.tsx` 定义了库存/试剂订单/耗材订单/用户等表单的字段配置，包括 `colSpan`、`placeholder`、`enableTagToggle`、`options`、`checkboxLabel` 等，页面只需要获得所需 schema 并传给 `BaseForm`。
- `validationSchemas.ts` 全面转向 Valibot，以 `createRequiredStringSchema`、`CasNumberSchema`、`OrderReasonSchema` 等函数封装业务校验，配合 `valibotResolver` 插入 React Hook Form，确保前端输入标准化（Trim、Uppercase、正则、最小/最大值）。

## 关键复用点

- 新页面在复用 `FilterTable` 时只需注入 `api`、`tableId`、`columns` 与 `renderExpandedRow`，其他筛选、状态、虚拟滚动、列宽、展开、SSE stale Banner 都自动生效。
- 表单只要选用 `getXxxFormFields` + 对应 `useForm` + `BaseForm`，并以 `createValibotResolver(schema)` 进行验证，避免每个模块手写字段/校验逻辑。

## 字段变更的联动清单

1. 后端模型字段变化后，先同步 `validationSchemas.ts` 与 `formConfigs.tsx`。
2. 若字段参与搜索/排序，补充 `FilterTable` 的筛选项与列定义。
3. 若字段影响列表 patch 安全性，更新 `useListSSE` 的 `isSafeToPatch` 判断策略。
4. 若字段需要持久化 UI 状态（列宽/展开/筛选），确认 `tableId` 命名不冲突。
5. 提交前手动验证：筛选、排序、分页、无限滚动、展开行、导出是否仍然一致。

## 参考代码
- [frontend/src/components/BaseForm.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/components/BaseForm.tsx)
- [frontend/src/components/ui/DataTable.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/components/ui/DataTable.tsx)
- [frontend/src/components/ui/FilterTable.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/components/ui/FilterTable.tsx)
- [frontend/src/hooks/useTableState.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useTableState.tsx)
- [frontend/src/hooks/useTableUrlState.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useTableUrlState.ts)
- [frontend/src/lib/formConfigs.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/lib/formConfigs.tsx)
- [frontend/src/lib/validationSchemas.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/lib/validationSchemas.ts)


