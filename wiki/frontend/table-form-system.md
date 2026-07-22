# 表格与表单体系

本页说明前端列表页和表单页的复用基础设施，以及当前已经落地的表格性能处理方式。

## 表格基础设施

- `FilterTable` 是业务页面的通用页面骨架，负责把 `TableFilters`、`DataTable`、分页控制、展开和列宽组合起来
- `DataTable` 负责表格渲染细节，包括表头与表体联动、列宽调整和虚拟滚动
- `TableFilters` 负责统一搜索输入、模糊切换、字段选择、状态下拉和搜索补全显示，并把输入结果交给 `useTableState`

## 状态、虚拟滚动与持久化

- `useTableState` 是列表页状态的总控，负责 `globalFilter`、`statusFilter`、`searchField`、`sorting`、`fuzzySearch`、`columnSizing`、`isAllExpanded` 和分页数据
- `useTableState` 与 `useInfiniteQuery`、列表 API 和 `getNextPageParam` 协作，形成无限滚动的数据获取方式
- 列宽、展开状态和模糊开关统一持久化到 `app-table`，按 `tableId` 进行分组
- `useTableUrlState` 将筛选和分页写回 URL，便于刷新、分享和路由复用

## 列表性能处理

- `DataTable` 与 `useVirtualizer` 协作，降低长列表渲染成本
- `useDataTableScroll` 与 `useBulkExpand` 负责滚动、展开和虚拟计算的联动
- `useColumnResize` 负责列宽拖拽与约束计算
- `FilterTable` 通过 `renderExpandedRow`、`noteField` 等入口接入业务详情，而不破坏表格骨架
- 页面可通过 `endMessage` 覆盖已加载完毕时的底部文案；库存操作记录用它提示归档库未纳入查询
- 虚拟行使用取整后的 `translateY` 定位，减少文本落在子像素时的模糊；长期渲染的行不保留永久 `will-change`

这套设计的目标是：

- 长列表默认使用虚拟滚动
- 分页、筛选和排序由统一状态层管理
- URL 同步保证刷新和分享后仍能恢复语义
- 展开行与虚拟滚动共同工作
- 页面只在需要时继续拉取下一页

## 表单配置系统

- `BaseForm` 是配置驱动表单的统一渲染层，按字段类型映射到对应 UI 组件
- `formConfigs.tsx` 负责描述字段顺序、默认值、占位符、选项和布局信息
- `validationSchemas.ts` 负责业务校验、格式标准化和错误映射，并与 React Hook Form 协作

## 改动入口

- 新列表页优先复用 `FilterTable`、`useTableState` 和 `useTableUrlState`
- 需要搜索建议时，在页面传入 `inlineCompletionEndpoint` 并开启 `enableInlineCompletion`；该能力只在搜索字段为“全部”时生效，详见 [搜索补全建议](/dev-guide/search-completions)
- 新表单页优先复用 `BaseForm`、`formConfigs.tsx` 和 `validationSchemas.ts`
- 字段参与实时更新时，再检查 `useListSSE` 的安全 patch 逻辑
- 需要持久化 UI 偏好时，再确认 `tableId` 命名是否冲突

## 字段变更联动

1. 后端模型字段变化后，先同步 `validationSchemas.ts` 与 `formConfigs.tsx`
2. 若字段参与搜索或排序，补充列表筛选项与列定义
3. 若字段影响列表 patch 安全性，更新 `useListSSE` 的判断策略
4. 若字段需要持久化 UI 状态，确认 `tableId` 命名不冲突
5. 提交前验证筛选、排序、分页、无限滚动和展开行的一致性

## 验证要点

- 新列表页是否复用了现有骨架
- 新表单页是否复用了现有 schema 和配置层
- 虚拟滚动、展开和列宽调整是否互不干扰
- URL 同步后是否能够恢复筛选语义

## 参考代码
- [frontend/src/components/BaseForm.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/components/BaseForm.tsx)
- [frontend/src/components/ui/DataTable.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/components/ui/DataTable.tsx)
- [frontend/src/components/ui/FilterTable.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/components/ui/FilterTable.tsx)
- [frontend/src/hooks/useTableState.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useTableState.tsx)
- [frontend/src/hooks/useTableUrlState.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useTableUrlState.ts)
- [frontend/src/lib/formConfigs.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/lib/formConfigs.tsx)
- [frontend/src/lib/validationSchemas.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/lib/validationSchemas.ts)


