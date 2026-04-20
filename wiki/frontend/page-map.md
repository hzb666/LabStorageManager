# 页面地图

本页从“路由如何分层”“页面挂在什么壳层下”“它通常依赖哪些 API / SSE 房间”三个角度说明当前前端页面结构。

## 路由概览

- `/login`：独立登录页，不使用主布局壳层。
- `/cart-import`：独立受保护页，用于承接浏览器插件桥接批次，不走主业务布局。
- `/test-error`：人工验证错误边界。
- `*`：未匹配路径进入 `NotFoundPage`。
- `/`：仪表盘。
- `/reagents`：试剂订单。
- `/consumables`：耗材订单。
- `/inventory`：库存列表。
- `/common-shelf`：常用货架。
- `/import`：Excel 或手工批量导入相关页面。
- `/devices`：个人设备和会话管理。
- `/admin/users`：用户管理。
- `/admin/announcements`：公告管理。
- `/admin/logs`：操作日志查看。

## 守卫与加载方式

当前路由不是一个统一守卫包住所有页面，而是按页面性质分层：

- `LoginRoute`：控制登录页的反向跳转。
- `ProtectedRoute`：保护独立页面，当前主要用于 `/cart-import`。
- `ProtectedLayoutRoute`：保护主布局页面，并在硬刷新恢复登录态时允许 `Layout deferOutlet` 先渲染壳层。
- `AdminRoute`：进一步限制后台管理页面只能由管理员访问。

所有业务页都通过 `React.lazy` + `<Suspense>` 懒加载；不同页面会使用 `AuthDeferredShell` 或 `CartImportLoadingScreen` 作为占位。

## 主布局页与独立页的边界

### 独立页

- `Login`：不需要侧边栏、公告条或用户菜单。
- `CartImport`：虽然需要登录，但它是一次性导入工作区，因此不复用常规布局。
- `TestError` 和 `NotFound`：保持独立，便于单独验证和兜底。

### 主布局页

主布局页都挂在 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/pages/Layout.tsx" /> 下，因此天然共享：

- 桌面/移动侧边栏
- 公告横幅和公告按钮
- 主题切换
- 用户入口
- 退出登录确认

这意味着如果某个页面应该出现在主导航里，就通常应该挂在主布局路由树下，而不是另起一个独立路由。

## 页面职责分布

### 仪表盘

`Dashboard` 负责展示各条主业务链的汇总状态，例如我的试剂订单、我的耗材订单、待补位置库存等。它偏读聚合接口，不承担复杂编辑流程。

### 订单页

`ReagentOrders` 和 `ConsumableOrders` 都是典型列表页：

- 共享 `FilterTable`
- 共享 `useTableState`
- 接入各自的 SSE 房间
- 表格行展开后再展示更细粒度的详情和操作按钮

二者最大的不同不是前端表格，而是后端工作流分叉：试剂有到货/入库链，耗材只有审批/完成链。

### 库存与常用货架页

`Inventory` 和 `CommonShelf` 都属于“现货侧页面”，但语义不同：

- `Inventory` 面向单瓶库存和借还
- `CommonShelf` 面向分组展示、公用沉淀和补瓶减瓶

因此它们虽然都接实时刷新，但列表主键和局部 patch 语义并不相同。

### 管理页

`AdminUsers`、`AnnouncementManagement`、`OperationLogs` 都属于后台管理页：

- 只对管理员开放
- 通常同时依赖列表和表单
- 更强调权限、审计和导出，而不是日常高频操作

### 设备页

`DeviceManagement` 放在主布局里，但不是管理员页。它承载个人会话查看、设备名修改和会话下线，是认证系统在前端的直接落点。

## 页面与 API / 状态同步对照

| 页面 | 主 API 模块 | 常用 SSE rooms |
| --- | --- | --- |
| `Dashboard` | `reagentOrderAPI.getMyReagentOrders`、`consumableOrderAPI.getMyConsumableOrders`、`inventoryAPI.getPendingStockin` | `dashboard`、`inventory` |
| `ReagentOrders` | `reagentOrderAPI` | `reagent_orders` |
| `ConsumableOrders` | `consumableOrderAPI` | `consumable_orders` |
| `Inventory` | `inventoryAPI` | `inventory` |
| `CommonShelf` | `commonShelfAPI` | `common_shelf` |
| `CartImport` | `authAPI`、`reagentOrderAPI`、`consumableOrderAPI` | 以本地草稿和标准 API 为主，不直接依赖 SSE 房间 |
| `DeviceManagement` | `sessionAPI` | 通常不依赖业务 SSE 房间 |

## 导航与页面分组

主布局里的导航项由 `Layout.tsx` 中的 `navItems` 定义，分成两组：

- `功能`：仪表盘、试剂订单、耗材订单、库存列表、常用货架、导入数据
- `管理`：用户管理、公告管理

这里有几个细节值得记住：

- `adminOnly` 导航项只在当前用户是管理员时出现。
- `/devices` 不在主导航列表里，而是挂在侧边栏底部的用户信息区。
- `/admin/logs` 当前可以访问，但不在左侧主导航项数组里。

## 页面改动时的判断顺序

- 新页面是否需要共享侧边栏和公告条？
- 它是否要求登录，但又不适合放进主壳层？
- 它是否需要管理员权限？
- 它是列表页、表单页，还是一次性流程页？
- 它是否需要接入某个 SSE 房间，还是只需要普通 HTTP 快照？

按这个顺序判断，通常就能知道它该挂在哪层、该复用哪些基础设施。

## 验证建议

- 未登录访问受保护页时，是否全部被正确拦截。
- 管理员和普通用户看到的导航项是否不同。
- `/cart-import` 是否保持独立工作区体验，而不是混入主布局。
- 切换不同业务页后，相关列表是否仍能收到正确的 SSE 更新或 stale 提示。
- 新页面挂载后，是否选用了正确的懒加载 fallback 和路由守卫。

## 参考代码
- [frontend/src/App.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/App.tsx)
- [frontend/src/pages/Layout.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/pages/Layout.tsx)
- [frontend/src/pages/CartImport.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/pages/CartImport.tsx)
- [frontend/src/pages/Dashboard.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/pages/Dashboard.tsx)
- [frontend/src/pages/Inventory.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/pages/Inventory.tsx)
- [frontend/src/pages/ReagentOrders.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/pages/ReagentOrders.tsx)
- [frontend/src/pages/ConsumableOrders.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/pages/ConsumableOrders.tsx)
- [frontend/src/pages/DeviceManagement.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/pages/DeviceManagement.tsx)
- [frontend/src/pages/AnnouncementManagement.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/pages/AnnouncementManagement.tsx)
- [frontend/src/pages/OperationLogs.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/pages/OperationLogs.tsx)
