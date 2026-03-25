# 页面地图

## 路由概览

- `/`（Layout + 仪表盘 Tab）：主导航容器，由 `Layout` 提供边栏/面包屑/通知等区域。
- `/reagents`、`/consumables`：订单类核心视图，内嵌同一份 `FilterTable` + 表格状态逻辑。
- `/inventory`、`/common-shelf`：库存浏览与操作页，支持 SSE 推送并在虚拟滚动表格中展示。
- `/import` 与 `/cart-import`：导入相关，前者用于 Excel、后者用作设备/采购交叉桥接。
- `/devices`：设备管理（Session 列表 + 操作按钮），`/test-error` 用于手动触发边界调试。
- `/login`：无骨架页面，专用登录表单。
- `*`：404，所有未匹配路径统一落在 `NotFoundPage`。

## 守卫与懒加载

- `ProtectedRoute` 与 `AdminRoute` 执行前置跳转，前者检查 `useAuthStore.isAuthenticated` 并把当前路径通过 `state.from` 传给 `/login`，后者进一步校验 `user.role === UserRoles.ADMIN`。
- 所有页面组件都使用 `React.lazy` 懒加载并用 `<Suspense>` 包裹：只有在用户访问对应路径时才下载 chunk，减少首屏负担。
- `/cart-import`、管理员路径 `/admin/*` 等也在 `Routes` 中按需载入，管理页额外套用 `AdminRoute`。

## 页面定位建议

- 仪表盘：首屏聚合，使用多个 TanStack Query + `useQueryClient` 更新简报数据。
- 订单与库存页：复用 `FilterTable` + `DataTable`，强调筛选、分页、列宽/展开状态持久化。
- 管理页：强调表格+表单混合，`AdminUsers`、`AnnouncementManagement` 会调用不同的 API + 表单 schema。

## 页面与 API/SSE 对照

| 页面 | 主 API 模块 | 常用 SSE rooms |
| --- | --- | --- |
| `Dashboard` | `dashboardAPI`、`inventoryAPI.dashboard*` | `dashboard`, `inventory` |
| `ReagentOrders` | `reagentOrderAPI` | `reagent_orders` |
| `ConsumableOrders` | `consumableOrderAPI` | `consumable_orders` |
| `Inventory` | `inventoryAPI` | `inventory` |
| `CommonShelf` | `commonShelfAPI` | `common_shelf` |
| `CartImport` | `cartSyncAPI` | 以 HTTP 为主，提交后触发订单相关房间 |

这样做的价值是：开发者在改某个页面时，可以直接定位后端路由、SSE 房间和缓存失效策略，减少“只改 UI 没接全链路”的问题。

## 新增页面接入流程（建议）

1. 在 `App.tsx` 增加懒加载组件与路由（按需选择 `ProtectedRoute` 或 `AdminRoute`）。
2. 在 `api/client.ts` 增加对应 API 模块，统一复用 Axios 错误处理。
3. 使用 `FilterTable` + `useTableState`（列表页）或 `BaseForm` + `validationSchemas`（表单页）。
4. 需要实时更新时，接入 `useSSE`/`useListSSE`，并设计 stale 回退策略。
5. 最后补齐文档：更新本页与 [应用骨架](/frontend/app-shell) 的路由说明。

## 参考代码
- [frontend/src/App.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/App.tsx)
- [frontend/src/pages/Inventory.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/pages/Inventory.tsx)
- [frontend/src/pages/Layout.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/pages/Layout.tsx)
- [frontend/src/pages/ReagentOrders.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/pages/ReagentOrders.tsx)


