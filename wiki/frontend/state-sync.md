# 状态同步

本页说明前端在本地状态、URL 状态、查询缓存和 SSE 之间的职责分层，以及当前系统在实时性与一致性之间的取舍。

## Zustand 状态职责

当前全局状态由多类职责明确的状态源组成：

- `useAuthStore`：负责登录态、`authStatus` 状态机、服务端会话探测和退出流程。
- `useUIStore`：负责侧边栏折叠状态。
- `useSSEStore`：负责 SSE 连接状态、`clientId`、重连次数、每个房间的最新序号和 stale 标记。

`useAuthStore` 有几个关键点：

- 本地持久化键是 `auth-storage`。
- 持久化内容仅包含 `user` 和 `isAuthenticated`。
- TTL 为 3 天，过期后会自动清理。
- 应用启动时必须走一次 `bootstrapAuth()`，不能直接信任本地快照。

## 表格状态与 URL 同步

列表页状态分成三层：

- `useTableState`：管理搜索输入、防抖后的全局搜索词、状态筛选、搜索字段、模糊搜索、排序、分页、列宽和展开状态。
- `useTableUrlState`：负责把筛选状态同步到地址栏，并在 URL 变化时把状态回流到页面。
- TanStack Query：负责真正的分页数据缓存。

这套设计里有两个重要约束：

- 搜索输入和实际查询词分离。输入框先写 `searchInput`，防抖后同步到 `globalFilter`。
- URL 同步采用 merge patch，避免整体覆盖 `location.search` 并抹掉页面其他 URL 状态。

## SSE 与实时状态

`useSSE` 和 `useListSSE` 共同组成了当前前端的实时同步层：

- `useSSE` 建立 `/api/events?rooms=...` 连接，监听 `connected`、`auth.invalid` 和业务事件。
- `useSSEStore.processSeq()` 会逐房间记录 `lastSeqByRoom`，用于检测重复事件和断档。
- 重连后，非首次打开流会把当前房间标为 stale。
- 序号断档会直接触发 stale。

`useListSSE` 的策略可以概括成一句话：只有在“局部 patch 不会破坏当前列表语义”时才 patch，否则就 stale。

## patch 与 stale 的边界

当前列表 SSE 处理遵循下面的规则：

- `created` 事件只有在列表正处于第一页起点、没有搜索词、没有排序冲突，并且新项能安全 prepend 时才会直接插入。
- `updated` 事件只有在目标行已经加载进列表、更新字段不影响当前搜索字段、不影响当前排序字段、并且合并后仍满足当前筛选时才会 patch。
- `deleted` 事件默认直接 stale。
- 任何“字段变更可能影响搜索命中”“排序字段被改”“目标行当前没加载出来”的场景，都直接 stale。

这套取舍故意偏保守，因为它优先保证“页面不会静默展示错误顺序或错误过滤结果”。

## 认证状态与 SSE 的衔接

认证和 SSE 是联动的：

- `api/client.ts` 会把当前 `clientId` 写入普通 API 请求头 `X-SSE-Client-Id`。
- 后端广播时会回写 `actor_client_id`，前端收到后会跳过自己触发的回声事件。
- 如果 SSE 收到 `auth.invalid`，前端会调用 `triggerSessionInvalidation()`，进入重新登录流程。
- `bootstrapAuth()` 对启动探测请求会带 `X-Skip-Auth-Invalidation: 1`，避免一次启动探测失败就弹全局失效提示。

## 本地存储分层

当前本地存储大致分成四类：

- `app-ui`：主题、字体来源、仪表盘激活页签、公告已读/关闭、Bug 按钮隐藏状态。
- `app-table`：各表格的 `expandAll`、`fuzzySearch`、`matchMode`、列宽。
- `app-auth-meta`：设备 `id/name` 和 remembered user。
- 独立键：`auth-storage`、`sidebar-storage`、`chemical_properties_cache`、`cart_import_batch_latest`、`runtime-time-config`。

这几层的设计目标为“同类偏好写入同一个规范化对象”，避免每个功能散落多个 localStorage key。

## 主题与壳层状态

- `useTheme` 会优先读取 `app-ui.theme`；没有保存值时才回退到系统主题偏好。
- 主题切换时会短暂禁用全局 CSS transition，避免亮暗模式切换时整页动画闪烁。
- 侧边栏折叠状态存储在 `sidebar-storage`，由 `useUIStore` 持久化。
- Layout 打开移动端侧边栏时会锁住 `document.body.style.overflow`，避免抽屉和页面双滚动。

## 当前同步模型

前端整体采用“快照 + 增量通知 + 明确失效”的同步模型：

1. 页面先通过 HTTP 获取权威快照。
2. SSE 尽量对当前缓存做安全 patch。
3. 只要 patch 的正确性不再可证，就把列表标为 stale。
4. 页面根据 stale 标记重新拉完整快照。

stale 是当前实现中的主动正确性保护机制。

## 改动入口

- 登录态相关问题：优先改 `useStore.ts` 和 `api/client.ts`
- SSE 建连、重连、断档：优先改 `useSSE.ts` 和 `sseStore.ts`
- 列表级 patch 策略：优先改 `useListSSE.ts`
- 搜索、防抖、分页、列宽：优先改 `useTableState.tsx`
- URL 查询参数联动：优先改 `useTableUrlState.ts`
- 主题持久化和公告已读：优先改 `appUiStorage.ts`
- 运行时展示时区：优先改 `cacheVersionBootstrap.ts` 和 `runtimeTimeConfig.ts`

## 验证要点

- 刷新已登录页面时，`authStatus` 是否从 `checking` 正常过渡到 `authenticated`。
- 强制断网或重连时，列表进入 stale 流程。
- 同一条数据被当前客户端修改后，是否能正确跳过自己的 SSE 回声事件。
- 搜索命中、排序字段更新、删除事件这些场景下，是否都按预期选择 patch 或 stale。
- 更改列宽、展开状态、模糊搜索后，是否能在刷新后恢复。
- 后端展示时区变化后，`runtime-time-config` 是否能被刷新。

## 参考代码
- [frontend/src/api/client.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/api/client.ts)
- [frontend/src/hooks/useListSSE.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useListSSE.ts)
- [frontend/src/hooks/useSSE.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useSSE.ts)
- [frontend/src/hooks/useTableState.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useTableState.tsx)
- [frontend/src/hooks/useTableUrlState.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useTableUrlState.ts)
- [frontend/src/hooks/useTheme.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useTheme.ts)
- [frontend/src/lib/cacheVersionBootstrap.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/lib/cacheVersionBootstrap.ts)
- [frontend/src/lib/runtimeTimeConfig.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/lib/runtimeTimeConfig.ts)
- [frontend/src/store/sseStore.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/store/sseStore.ts)
- [frontend/src/store/useStore.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/store/useStore.ts)
- [frontend/src/lib/storage/appAuthMetaStorage.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/lib/storage/appAuthMetaStorage.ts)
- [frontend/src/lib/storage/appTableStorage.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/lib/storage/appTableStorage.ts)
- [frontend/src/lib/storage/appUiStorage.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/lib/storage/appUiStorage.ts)
