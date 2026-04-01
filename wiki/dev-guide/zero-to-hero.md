# 从零到上手

本页给首次接手仓库的开发者一条最短学习路径。目标不是一次看完所有模块，而是在较短时间内建立对业务主线、代码分层、运行边界和常见改动入口的稳定认知。

## 第一阶段：先建立三个核心判断

先把下面三件事记牢，再开始读代码：

- 试剂和耗材不是一条流程。试剂订单会继续流向暂存、库存或常用货架；耗材订单在完成后结束。
- `Inventory` 才是现货事实源。借用日志、仪表盘卡片、常用货架展示都不能替代它。
- 前端大量页面看似不同，实际共享同一套表格、URL 状态、SSE 和认证恢复基础设施。

如果这三件事没有先建立，后面会很容易把“订单状态”“库存状态”“前端局部 patch”混成一个概念。

## 第二阶段：用 30 分钟建立代码地图

建议按这个顺序读：

1. <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/README.md" />：确认项目定位、运行方式和部署入口。
2. <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/main.py" />：理解后端入口、中间件、生命周期、路由挂载和 `/cart-import` 重定向。
3. <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/database.py" />：理解 SQLite、WAL、索引、FTS 和默认管理员初始化。
4. <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/main.tsx" /> 与 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/App.tsx" />：理解前端启动、QueryClient、路由分层和守卫。
5. <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/tree/main/app/models" />：先分清用户、试剂订单、耗材订单、库存、公告、会话、借用日志这些对象。
6. <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/tree/main/app/api" />：把对象和接口一一对上。
7. <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/components/ui/FilterTable.tsx" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useTableState.tsx" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useListSSE.ts" />：理解列表页共性实现。

## 第三阶段：把业务链路走一遍

建议你至少亲手走完下面五条链路：

1. 登录并刷新页面，观察登录态是否被正确恢复。
2. 提交一条试剂订单，管理员审批，再执行到货确认。
3. 对同一条试剂订单分别测试“直接入库”和“先暂存后补位”两条路径。
4. 提交一条耗材订单，完成审批并标记完成。
5. 走一遍库存借用 -> 归还链路，并观察列表是否通过 SSE 提示刷新。

如果你能把这五步分别对应到模型、API、页面和 SSE 事件房间，后面再看代码就不会只停留在文件名层面。

## 第四阶段：补一遍外部导入链路

这个仓库有一条容易被忽略、但很关键的外围链路：

- 扩展 popup 抓购物车
- bridge 脚本把批次桥接到 `/cart-import`
- 导入页逐条提交成标准订单

建议至少看这几个文件：

- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/popup/popup.js" />
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/content/import-bridge.js" />
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/pages/CartImport.tsx" />
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/pages/cartimport/cartImportControllers.ts" />

这条链路的重点不是“能抓到数据”，而是“扩展只是桥接，最终仍走系统自身的订单创建规则”。

## 第五阶段：常见改动入口

- 后端入口、中间件、安全策略：<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/main.py" />
- SQLite、索引、FTS、默认管理员：<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/database.py" />
- 试剂工作流：<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders_workflow.py" />
- 耗材工作流：<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/consumable_orders.py" />
- 库存借还与导入：<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory.py" />
- 认证与设备会话：<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/core/auth.py" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/user_sessions.py" />
- 前端应用骨架：<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/App.tsx" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/pages/Layout.tsx" />
- 列表页：<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/components/ui/FilterTable.tsx" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useTableState.tsx" />
- 状态同步：<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useSSE.ts" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useListSSE.ts" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/store/sseStore.ts" />
- 表单和输入验证：<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/components/BaseForm.tsx" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/lib/formConfigs.tsx" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/lib/validationSchemas.ts" />

## 第六阶段：第一轮实操建议

建议按以下顺序完成第一轮熟悉：

1. 跑通本地后端与前端。
2. 登录系统并浏览主要页面。
3. 跟踪一遍试剂订购 -> 审批 -> 到货 -> 入库。
4. 跟踪一遍耗材订购 -> 审批 -> 完成。
5. 跟踪一遍库存借用 -> 归还。
6. 跟踪扩展把购物车桥接到 `/cart-import` 的链路。
7. 打开两个页面标签，验证写操作后 SSE 是否让列表进入刷新或 stale 状态。

完成这几步后，再读 [关键文件索引](/dev-guide/key-files) 和 [核心导读](/dev-guide/principal-guide) 会更容易把文件、职责和运行时现象对应起来。

## 新人最容易踩的坑

- 把 `docs/` 历史分析稿当成事实源。当前行为应以代码和这套 wiki 为准。
- 看到 SSE 事件就以为前端一定会原地 patch。实际很多场景会直接标记 stale 再重拉。
- 把 `public` 账号当成普通用户。它在建单、导入等场景下受限更多。
- 以为购物车导入直接走 `/api/cart-sync/import`。当前导入页主链路已经改成逐条调用标准订单创建接口。
- 只改前端输入校验，不同步检查后端规范化和 DTO。

## 参考代码

- [app/main.py](https://github.com/hzb666/LabStorageManager/blob/main/app/main.py)
- [app/database.py](https://github.com/hzb666/LabStorageManager/blob/main/app/database.py)
- [app/api/consumable_orders.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/consumable_orders.py)
- [app/api/inventory.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory.py)
- [app/api/reagent_orders_workflow.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders_workflow.py)
- [frontend/src/App.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/App.tsx)
- [frontend/src/components/BaseForm.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/components/BaseForm.tsx)
- [frontend/src/components/ui/FilterTable.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/components/ui/FilterTable.tsx)
- [frontend/src/hooks/useListSSE.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useListSSE.ts)
- [frontend/src/hooks/useTableState.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useTableState.tsx)
- [frontend/src/lib/validationSchemas.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/lib/validationSchemas.ts)
- [frontend/src/main.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/main.tsx)
- [frontend/src/pages/cartimport/cartImportControllers.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/pages/cartimport/cartImportControllers.ts)
- [browser-extension/popup/popup.js](https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/popup/popup.js)
