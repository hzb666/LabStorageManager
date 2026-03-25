# 状态与实时同步

## Zustand 管什么

- `useAuthStore` 用 `persist` 包裹，自定义的 `createExpireStorage` 会给每条 `localStorage` 记录附带 `expiresAt`（默认 3 天），登录/注销都会同步 `user`、`isAuthenticated`，api 401 事件直接 `logout` 并跳到 `/login`
- `useUIStore` 负责 `sidebarCollapsed`，同样通过 `persist` + 过期存储缓存，防止 sider 状态永久“卡”在某个开合值
- `sseStore` 维持 SSE 链接状态：`isConnected`、`clientId`、`reconnectCount`、`lastSeqByRoom`、`staleRooms`，配合 `markRoomStale/clearRoomStale` 给列表页提供实时刷新提示

## 表格状态与 URL

- `useTableState` 把搜索/筛选、排序、列宽、展开、无限分页统一处理：使用 `useInfiniteQuery` 搭配 `api.list`，`getNextPageParam` 负责计算下一页 offset，`queryKey` 会引入 `statusFilter`、`globalFilter`、`searchField`、`sorting`，以保证缓存区分所有筛选组合。列宽通过 `localStorage` 防抖写入，展开状态+模糊开关持久化到 `tableId` 相关的 key 里。
- 该 hook 还提供 `applySearchImmediate`、`resetFilters`、`invalidate` 之类方法，供 `FilterTable`、`TableFilters` 等上层组件复用，保持筛选/列配置的同步体验。
- `useTableUrlState` 进一步把 `globalFilter`、列筛选（`columnFilters`）与 `pagination` 反序列化/写回到 `location.search`，确保页签之间路由复用或书签链接时状态一致。默认 `page`、`pageSize` 从 1 开始的分页映射到 TanStack Table 的 `pageIndex`。

## SSE 与实时状态

- `useSSE` 接管 `/events` 连接，按 `rooms` 批量订阅，`EventSource` 事件会先走 `processSeq`（防止旧事件重复应用），再交给页面 `handlers`。重连时会 `incrementReconnectCount` 并标记所有 `room` stale。
- `useListSSE` 把 SSE 局部更新与 TanStack Query 缓存结合：只有 `item_id` 在当前分页中并且不影响排序/搜索字段时才做 patch，否则 `markRoomStale`，页面会展示 `StaleBanner` 并依赖 `onRefresh`（通常是 `refetch`）恢复。
- 这个模式确保库存/订单表格在后端事件触发时快速同步，又不会因为顺序 gap 导致错乱数据。

## 主题与其他实时状态

- `useTheme` 会在初始化时读取 `localStorage`，没有值时跟随系统 `prefers-color-scheme` 决定初始 `light/dark`，切换时临时注入 `style` 禁用过渡保证无闪烁，然后更新 `document.documentElement` 上的 `dark` 类。
- `ToastContainer`、`TooltipProvider` 等 UI 容器会在 `App.tsx` 级颁布，无需在每个页面重复挂载。SSE 相关 store（`useSSEStore`）也不依赖页面卸载，保持连接状态跨路由持续。

## 断线与恢复（推荐处理模式）

1. 连接断开时：`useSSE` 递增 `reconnectCount` 并标记订阅房间为 stale。
2. 自动重连后：先继续消费新事件，再由页面触发一次手动 `refetch` 清理 stale。
3. 若检测到序号断档：不要盲目局部 patch，直接走全量刷新。
4. 对高风险列表（多筛选、多排序）默认偏向 “stale + refresh” 策略，避免错误 patch 污染视图。

## 状态层调试建议

- 开发时在浏览器 DevTools 观察 `localStorage` 中 `auth-storage`、`ui-storage`、表格相关 key 的过期时间。
- 人工断开网络并恢复，验证 SSE stale banner 是否出现、刷新后是否恢复一致。
- 使用两个账号并发操作同一条库存/订单，确认“局部更新”与“全量刷新”路径都可用。

## 参考代码
- [frontend/src/hooks/useListSSE.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useListSSE.ts)
- [frontend/src/hooks/useSSE.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useSSE.ts)
- [frontend/src/store/useStore.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/store/useStore.ts)


