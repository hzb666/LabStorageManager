# Hooks 层

`frontend/src/hooks/` 负责承接页面中的可复用状态逻辑，为页面、组件和 `lib/` 提供稳定的状态协作接口。

## 分类

### 表格与列表状态

| Hook | 职责 | 典型调用方 |
| --- | --- | --- |
| `useTableState` | 统一管理筛选、排序、分页、列宽、展开和数据拉取 | 库存页、订单页、管理页 |
| `useTableUrlState` | 将筛选和分页同步到 URL | 带筛选表格的页面 |
| `useBulkExpand` | 统一控制整表展开与收起 | 可展开明细表格 |
| `useColumnResize` | 处理列宽拖拽和持久化 | `DataTable` |
| `useDataTableScroll` | 处理滚动容器与虚拟列表协作 | `DataTable`、`FilterTable` |

### 状态同步

| Hook | 职责 | 典型调用方 |
| --- | --- | --- |
| `useSSE` | 建立 `/api/events` 长连接，管理订阅房间和重连 | 页面级实时同步接入 |
| `useListSSE` | 将 SSE 事件应用到列表缓存或标记 stale | 库存、订单、仪表盘列表 |

### 业务专用 Hook

| Hook | 职责 |
| --- | --- |
| `useReagentCasDuplicateCheck` | 创建试剂订单时进行同 CAS 风险检查 |
| `useInlineSearchCompletion` | 列表搜索框的内联补全请求、缓存和反馈 |
| `useRememberedUser` | 记住登录用户名等轻量偏好 |
| `useErrorLogger` | 统一采集前端异常和 API 错误 |
| `useExportDownload` | 统一文件导出、中文错误提示和重复点击保护 |

### UI 与交互状态

| Hook | 职责 |
| --- | --- |
| `useTheme` | 管理明暗主题切换 |
| `useDialogState` | 管理弹窗开关状态 |
| `useFormModal` | 管理表单弹窗的打开、关闭、重置和提交 |
| `useMobile` | 判断响应式断点 |

## 核心职责

### `useTableState`

这是表格页面的状态总控，负责：

- 筛选与搜索
- 排序
- 查询参数
- 无限分页
- 列宽
- 展开状态
- 数据刷新

### `useSSE` 与 `useListSSE`

这两个 Hook 共同定义实时同步策略：

- `useSSE` 决定连接时机、订阅房间和重连行为
- `useListSSE` 决定事件是局部 patch 还是降级为 stale
- 两者共同维护“优先保证语义正确，再争取局部更新”的一致性原则

### `useErrorLogger`

该 Hook 将运行时异常、Promise 错误和 API 错误转为统一的错误记录行为，便于页面层保持简洁。

### `useInlineSearchCompletion`

该 Hook 只负责搜索建议状态，不参与真实列表数据查询。`FilterTable` 在配置了 `inlineCompletionEndpoint` 且搜索字段为 `all` 时启用它；单字段搜索不会显示建议，避免补全结果来自其他字段。完整后端和前端协作见 [搜索补全建议](/dev-guide/search-completions)。

### `useExportDownload`

该 Hook 统一调用导出接口、处理 blob 错误信息并维护加载状态。库存和订单页面通过加载按钮阻止重复导出请求，后端继续负责用户级限流与导出上限。

## 改动入口

- 页面状态过多时，优先新增专用 Hook，避免继续堆进组件
- 表格相关改动通常先看 `useTableState`、`useTableUrlState`、`useColumnResize`
- 实时同步改动通常先看 `useSSE`、`useListSSE` 和 `store/sseStore.ts`
- 弹窗和主题改动通常先看 `useDialogState`、`useFormModal`、`useTheme`

## 阅读顺序

### 修改表格页

1. `useTableState`
2. `useTableUrlState`
3. `useColumnResize`
4. `useBulkExpand`
5. `useDataTableScroll`

### 修改实时更新

1. `useSSE`
2. `useListSSE`
3. `frontend/src/store/sseStore.ts`

### 修改主题或弹窗体验

1. `useTheme`
2. `useDialogState`
3. `useFormModal`

## 验证要点

- 页面状态是否已经抽离到 Hook 层
- 同一类能力是否复用了现有 Hook
- 表格筛选、分页和列宽状态是否能正确恢复
- SSE 断线和重连后，是否仍能回到一致状态

## 参考代码
- [frontend/src/hooks/useColumnResize.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useColumnResize.ts)
- [frontend/src/hooks/useDataTableScroll.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useDataTableScroll.ts)
- [frontend/src/hooks/useDialogState.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useDialogState.tsx)
- [frontend/src/hooks/useErrorLogger.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useErrorLogger.tsx)
- [frontend/src/hooks/useExportDownload.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useExportDownload.ts)
- [frontend/src/hooks/useFormModal.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useFormModal.tsx)
- [frontend/src/hooks/useListSSE.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useListSSE.ts)
- [frontend/src/hooks/useInlineSearchCompletion.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useInlineSearchCompletion.ts)
- [frontend/src/hooks/useReagentCasDuplicateCheck.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useReagentCasDuplicateCheck.ts)
- [frontend/src/hooks/useSSE.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useSSE.ts)
- [frontend/src/hooks/useTableState.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useTableState.tsx)
- [frontend/src/hooks/useTableUrlState.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useTableUrlState.ts)
- [frontend/src/hooks/useTheme.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useTheme.ts)
