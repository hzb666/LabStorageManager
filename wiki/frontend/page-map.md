# 页面地图

## 路由概览

- `/`：应用主入口，由 `Layout` 提供边栏、面包屑和通知区域
- `/reagents`、`/consumables`：订单核心视图，共享 `FilterTable` 与表格状态体系
- `/inventory`、`/common-shelf`：库存浏览与操作页面，结合 SSE 与虚拟滚动展示数据
- `/import`、`/cart-import`：导入相关页面，分别覆盖 Excel 导入与设备或采购桥接
- `/devices`：设备管理页面，承载 Session 列表与操作按钮
- `/test-error`：用于手动验证错误边界
- `/login`：独立登录页，不依赖应用骨架
- `*`：未匹配路径统一进入 `NotFoundPage`

## 守卫与加载方式

- `ProtectedRoute` 负责普通登录态校验，并在跳转时保留来源路径
- `AdminRoute` 在此基础上继续校验管理员权限
- 页面组件统一使用 `React.lazy` 和 `<Suspense>`，按访问路径加载对应 chunk
- `/admin/*` 等管理入口只在路由命中时挂载，减少无关页面成本

## 页面职责分布

### 仪表盘

负责首屏汇总和概览展示，通常结合 TanStack Query 与 `useQueryClient` 更新简报数据。

### 订单与库存页

负责列表浏览、筛选、分页和展开详情，核心依赖 `FilterTable`、`DataTable`、`useTableState`。

### 管理页

负责表格与表单的组合交互，例如用户管理和公告管理，通常同时依赖 API 模块与表单 schema。

## 页面与 API / 状态同步对照

| 页面 | 主 API 模块 | 常用 SSE rooms |
| --- | --- | --- |
| `Dashboard` | `dashboardAPI`、`inventoryAPI.dashboard*` | `dashboard`、`inventory` |
| `ReagentOrders` | `reagentOrderAPI` | `reagent_orders` |
| `ConsumableOrders` | `consumableOrderAPI` | `consumable_orders` |
| `Inventory` | `inventoryAPI` | `inventory` |
| `CommonShelf` | `commonShelfAPI` | `common_shelf` |
| `CartImport` | `cartSyncAPI` | 以 HTTP 为主，提交后触发相关房间刷新 |

## 改动入口

- 新页面先判断它属于公开页、受保护页还是管理员页
- 列表页优先接入 `FilterTable` 和 `useTableState`
- 表单页优先接入 `BaseForm` 和 `validationSchemas`
- 需要实时数据时，优先补齐 `useSSE` 或 `useListSSE`
- 页面级导航变化时，同步更新本页和 [应用骨架](/frontend/app-shell)

## 验证建议

- 新页面是否挂在正确的路由分层下
- 是否按需加载且不会提前请求无关 chunk
- 页面切换后，相关缓存和实时同步状态是否仍然一致
- 新页面是否能在本页对应的 API 和 SSE 入口中被准确定位

## 参考代码
- [frontend/src/App.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/App.tsx)
- [frontend/src/pages/Inventory.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/pages/Inventory.tsx)
- [frontend/src/pages/Layout.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/pages/Layout.tsx)
- [frontend/src/pages/ReagentOrders.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/pages/ReagentOrders.tsx)


