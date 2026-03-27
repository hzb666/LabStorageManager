# 状态同步

本页说明前端在本地状态、路由状态、查询缓存和 SSE 之间的职责分层，以及当前系统在实时性与一致性之间的取舍。

## Zustand 状态职责

- `useAuthStore` 负责登录态，配合 `persist` 与 `createExpireStorage` 控制本地缓存过期时间；登录、注销和 `401` 处理都会同步 `user` 与 `isAuthenticated`
- `useUIStore` 负责侧栏折叠状态，避免界面偏好在刷新后丢失
- `sseStore` 负责 SSE 链接状态，包括 `isConnected`、`clientId`、`reconnectCount`、`lastSeqByRoom` 和 `staleRooms`

## 表格状态与 URL 同步

- `useTableState` 统一承接搜索、筛选、排序、列宽、展开和分页等状态，并通过 `useInfiniteQuery` 拉取列表数据
- 该 Hook 同时提供 `applySearchImmediate`、`resetFilters`、`invalidate` 等方法，供 `FilterTable`、`TableFilters` 等上层复用
- `useTableUrlState` 将 `globalFilter`、`columnFilters` 与 `pagination` 同步到 `location.search`，用于书签恢复和路由复用

## SSE 与实时状态

- `useSSE` 负责建立 `/api/events` 连接、批量订阅 rooms，并在重连时递增重连计数、标记房间为 stale
- `useListSSE` 负责判断事件是否可以安全 patch 列表缓存；如果语义可能失真，则优先进入 stale 流程
- 这套机制的目标不是追求最少刷新，而是在正确性的前提下尽量减少全量请求

## 主题与其他全局状态

- `useTheme` 负责初始化主题、同步 `app-ui.theme`，并更新 `document.documentElement` 的 `dark` 类
- `ToastContainer`、`TooltipProvider` 等全局容器在 `App.tsx` 统一挂载
- SSE 相关 store 不依赖页面卸载，保证跨路由持续运行

## 本地存储分层

- `app-ui`：主题、字体来源、Dashboard 页签、公告已读/关闭、Bug 按钮隐藏
- `app-table`：表格 `expandAll`、`fuzzySearch`、列宽
- `app-auth-meta`：设备 `id/name`、remembered user
- 独立保留：`auth-storage`、`sidebar-storage`、`chemical_properties_cache`、`cart_import_batch_latest`

## 状态模型

前端采用“快照 + 增量通知”的同步模型：

1. 页面先通过 HTTP 获取权威快照
2. SSE 只在语义安全时做局部 patch
3. 一旦排序、筛选或序列号可能失真，就将房间标记为 stale
4. 页面通过刷新重新获取完整快照

## 改动入口

- 登录态相关行为优先改 `useAuthStore`
- 侧栏和界面偏好优先改 `useUIStore`
- 表格筛选、分页和列宽优先改 `useTableState` 与 `useTableUrlState`
- SSE 连接、重连和 patch 规则优先改 `useSSE` 与 `useListSSE`
- 主题初始化优先改 `useTheme`

## 验证建议

- `auth-storage` / `sidebar-storage` 的 TTL 是否按预期刷新
- 断网后重连是否会进入 stale 流程
- 同一条列表数据在局部更新和全量刷新下是否保持一致
- 多筛选、多排序场景是否避免错误 patch

## 参考代码
- [frontend/src/hooks/useListSSE.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useListSSE.ts)
- [frontend/src/hooks/useSSE.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useSSE.ts)
- [frontend/src/store/useStore.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/store/useStore.ts)


