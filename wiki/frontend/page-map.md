# 页面地图

本页从“路由如何分层”“页面挂在什么壳层下”“它通常依赖哪些 API / SSE 房间”三个角度说明当前前端页面结构。

## 路由概览

- `/login`：独立登录页，不使用主布局壳层。
- `/cart-import`：独立受保护页，用于承接浏览器插件桥接批次，不走主业务布局。
- `*`：未匹配路径进入 `NotFoundPage`。
- `/`：仪表盘。
- `/reagents`：试剂订单。
- `/consumables`：耗材订单。
- `/inventory`：库存列表。
- `/inventory/:internalCode`：单个库存的操作记录。
- `/common-shelf`：常用货架。
- `/import`：Excel 或手工批量导入相关页面。
- `/devices`：个人设备和会话管理。
- `/logs`：当前账号的操作日志查看。
- `/admin/users`：用户管理。
- `/admin/announcements`：公告管理。
- `/admin/logs`：管理员从用户管理页进入的用户操作日志查看。

## 守卫与加载方式

当前路由按页面性质分层：

- `LoginRoute`：控制登录页的反向跳转。
- `ProtectedRoute`：保护独立页面，当前主要用于 `/cart-import`。
- `ProtectedLayoutRoute`：保护主布局页面，并在硬刷新恢复登录态时允许 `Layout deferOutlet` 先渲染壳层。
- `AdminRoute`：进一步限制后台管理页面只能由管理员访问。

所有业务页都通过 `React.lazy` + `<Suspense>` 懒加载；不同页面会使用 `AuthDeferredShell` 或 `CartImportLoadingScreen` 作为占位。

## 主布局页与独立页的边界

### 独立页

- `Login`：不需要侧边栏、公告条或用户菜单。
- `CartImport`：虽然需要登录，但它是一次性导入工作区，因此不复用常规布局。
- `NotFound`：保持独立，用于未匹配路径兜底。

### 主布局页

主布局页都挂在 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/pages/Layout.tsx" /> 下，因此天然共享：

- 桌面/移动侧边栏
- 公告横幅和公告按钮
- 主题切换
- 用户入口
- 退出登录确认

需要出现在主导航的页面通常挂在主布局路由树下，独立路由仅用于独立工作区或错误页。

## 页面职责分布

### 仪表盘

`Dashboard` 负责仪表盘视图编排。页面入口保留在 `Dashboard.tsx`，数据 hook、看板/管理面板、订单 tab 与库存 tab 放在 `pages/dashboard/` 下。

角色分支：

- 普通用户：个人模式和成员看板。
- 管理员：个人模式和管理模式。
- 公用账户：公告和全局窗口统计。

### 订单页

`ReagentOrders` 和 `ConsumableOrders` 都是典型列表页：

- 共享 `FilterTable`
- 共享 `useTableState`
- 接入各自的 SSE 房间
- 表格行展开后再展示更细粒度的详情和操作按钮

二者的主要差异来自后端工作流分叉：试剂有到货/入库链，耗材只有审批/完成链。

### 库存与常用货架页

`Inventory` 和 `CommonShelf` 都属于“现货侧页面”，但语义不同：

- `Inventory` 面向单瓶库存、借还和实验步骤查库存
- `InventoryOperationTimeline` 面向单瓶库存的入库、编辑和借用记录，只读取主数据库
- `CommonShelf` 面向分组展示、公用沉淀和补瓶减瓶

因此它们虽然都接实时刷新，但列表主键和局部 patch 语义并不相同。

### 管理页

`AdminUsers`、`AnnouncementManagement` 属于后台管理页：

- 只对管理员开放
- 通常同时依赖列表和表单
- 更强调权限、审计和导出

`OperationLogs` 同时服务 `/logs` 和 `/admin/logs`。前者从个人设备页进入，后者从用户管理页带短期日志令牌进入。

### 设备页

`DeviceManagement` 放在主布局里，面向个人会话管理。它承载个人会话查看、设备名修改和会话下线，是认证系统在前端的直接落点。

## 页面与 API / 状态同步对照

| 页面 | 主 API 模块 | 常用 SSE rooms |
| --- | --- | --- |
| `Dashboard` | `dashboardAPI.getPersonalSummary`、`dashboardAPI.getBoardSummary`、`dashboardAPI.getBoardSectionItems`、`dashboardAPI.getBoardWindowStats`、`dashboardAPI.getAdminSummary`、`dashboardAPI.getAdminSectionItems` | `dashboard`、`inventory` |
| `ReagentOrders` | `reagentOrderAPI` | `reagent_orders` |
| `ConsumableOrders` | `consumableOrderAPI` | `consumable_orders` |
| `Inventory` | `inventoryAPI`、`procedureInventorySearchAPI` | `inventory` |
| `InventoryOperationTimeline` | `inventoryAPI.getByCode`、`createInventoryTimelineAPI` | 不订阅 SSE，按分页 HTTP 快照读取 |
| `CommonShelf` | `commonShelfAPI` | `common_shelf` |
| `CartImport` | `authAPI`、`reagentOrderAPI`、`consumableOrderAPI` | 以本地草稿和标准 API 为主，不直接依赖 SSE 房间 |
| `DeviceManagement` | `sessionAPI` | 通常不依赖业务 SSE 房间 |
| `OperationLogs` | `logsAPI`、`userAPI.generateLogsToken` | 通常不依赖业务 SSE 房间 |

## 导航与页面分组

主布局里的导航项由 `Layout.tsx` 中的 `navItems` 定义，分成两组：

- `功能`：仪表盘、试剂订单、耗材订单、库存列表、常用货架、导入数据
- `管理`：用户管理、公告管理

这里有几个细节值得记住：

- `adminOnly` 导航项只在当前用户是管理员时出现。
- `/devices` 挂在侧边栏底部的用户信息区。
- `/logs` 和 `/admin/logs` 当前可以访问，但不在左侧主导航项数组里。

## 页面改动时的判断顺序

1. 确认页面是否共享侧边栏和公告条。
2. 确认登录、角色和公用账户权限。
3. 确认页面类型属于列表、表单或一次性流程。
4. 确认数据同步方式使用 SSE 房间或普通 HTTP 快照。
5. 根据以上边界选择路由层级和基础设施。

## 验证要点

- 未登录访问受保护页时，是否全部被正确拦截。
- 管理员和普通用户看到的导航项是否不同。
- `/cart-import` 保持独立工作区体验。
- `/logs` 和 `/admin/logs` 是否都能通过短期日志令牌进入。
- 切换不同业务页后，相关列表是否仍能收到正确的 SSE 更新或 stale 提示。
- 新页面挂载后，是否选用了正确的懒加载 fallback 和路由守卫。
- 库存操作记录是否只显示入库、编辑、借用三类，并可搜索操作人和详情摘要。

## 参考代码
- [frontend/src/App.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/App.tsx)
- [frontend/src/pages/Layout.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/pages/Layout.tsx)
- [frontend/src/pages/CartImport.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/pages/CartImport.tsx)
- [frontend/src/pages/Dashboard.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/pages/Dashboard.tsx)
- [frontend/src/pages/Inventory.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/pages/Inventory.tsx)
- [frontend/src/pages/InventoryOperationTimeline.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/pages/InventoryOperationTimeline.tsx)
- [frontend/src/pages/ReagentOrders.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/pages/ReagentOrders.tsx)
- [frontend/src/pages/ConsumableOrders.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/pages/ConsumableOrders.tsx)
- [frontend/src/pages/DeviceManagement.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/pages/DeviceManagement.tsx)
- [frontend/src/pages/AnnouncementManagement.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/pages/AnnouncementManagement.tsx)
- [frontend/src/pages/OperationLogs.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/pages/OperationLogs.tsx)
