# 关键文件索引

本页按问题类型整理优先阅读文件，并说明文件排序依据。

## 启动与运行边界

- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/main.py" />：FastAPI 实例、生命周期、中间件、安全头、SSE 上下文、`/cart-import` 重定向和所有路由挂载都在这里收口。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/database.py" />：SQLite 引擎、WAL、外键和初始化编排入口。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/tree/main/app/db_bootstrap" />：schema 补齐、性能索引、FTS、schema consistency check 和启动期回填。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/main.tsx" />：前端启动时机、`QueryClient`、cache version bootstrap 和真正挂载 `App` 的入口。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/App.tsx" />：前端路由树、认证守卫、懒加载页面和全局 Provider 的装配点。

## 认证、会话与访问边界

- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/core/auth.py" />：`CurrentUser`、管理员检查、token 会话校验和 Cookie/Bearer 兼容逻辑的核心。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/user_sessions.py" />：设备会话管理的 API 入口。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/store/useStore.ts" />：`bootstrapAuth()`、`logout()`、`authStatus` 状态机和本地持久化策略。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/api/client.ts" />：Axios 拦截器、401/403 处理、`X-SSE-Client-Id` 注入和设备标识传递。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/pages/Layout.tsx" />：前端导航项的权限过滤、账户入口、主题切换和退出确认。

## 核心业务链

- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders.py" />：试剂订单列表、查询和基础 CRUD。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders_workflow.py" />：试剂审批、到货、入库、仪表盘卡片和删除权限的核心工作流。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_brands.py" />：试剂品牌主数据的查询、新增、编辑和停用。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/consumable_orders.py" />：耗材列表、搜索、审批、完成、导出和删除权限。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory.py" />：库存列表、借用、归还、Excel 导入、手工入库、导出等主入口。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/common_shelf.py" />：常用货架分组、位置候选、补瓶、减瓶和删除。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/internal_code.py" />：库存瓶级唯一编码生成器，排查入库冲突时优先看这里。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/pinyin_utils.py" />：名称、分类、品牌、位置的拼音与首字母预计算逻辑。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/chem.py" /> 与 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/structure_index.py" />：结构缓存、PubChem 解析和子结构检索入口。

## 数据模型与检索基线

- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/tree/main/app/models" />：`User`、`UserSession`、`ReagentOrder`、`ConsumableOrder`、`Inventory`、`CommonShelf`、`Announcement` 等数据对象定义。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/models/inventory.py" />：库存事实源、借用日志和手工入库 DTO。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/models/reagent_order.py" />：试剂状态枚举、订购原因和规格字段。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/models/consumable_order.py" />：耗材状态枚举和搜索相关字段。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/api_utils.py" />：列表页短 TTL 缓存，是排查“数据改了但第一页还是旧的”时必须看的文件。

## 实时同步与缓存一致性

- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/events.py" />：SSE 建连入口、房间白名单、会话周期复检。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/sse_manager.py" />：本地 fan-out、Redis 跨进程广播、慢客户端断开、`auth.invalid` 消息构造。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/sse_redis.py" />：Redis 发布订阅封装。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useSSE.ts" />：EventSource 连接、重连、序号断档处理和 auth invalid 事件处理。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useListSSE.ts" />：列表级 patch / stale 策略。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/store/sseStore.ts" />：客户端 SSE 运行时状态、`lastSeqByRoom` 和 `staleRooms`。

## 前端页面基础设施

- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/components/ui/FilterTable.tsx" />：列表页工具栏、搜索、筛选和表格容器总入口。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useTableState.tsx" />：分页、搜索、防抖、模糊搜索、列宽和展开状态。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useTableUrlState.ts" />：URL 查询参数与表格状态同步。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/components/BaseForm.tsx" />：统一表单渲染外壳。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/lib/validationSchemas.ts" />：前端表单校验和 API 错误归一化。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/lib/reagentBrandOptions.ts" />：试剂品牌选项的查询配置和转换。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/lib/staticAssets.ts" />：RDKit 和本地字体的版本化资源路径。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useTheme.ts" />：主题初始化与切换逻辑。

## 购物车导入与浏览器插件桥接

- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/build-config.mjs" />：根据插件 env 生成 manifest 和运行配置。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/background/service-worker.js" />：目标购物车标签页解析、后台消息路由、详情页抓取辅助。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/popup/popup.js" />：抓取、详情补齐、类型判断、批次保存和跳转系统页面。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/content/import-bridge.js" />：把插件批次复制到页面 `localStorage` 并发出 `IMPORT_BATCH_READY` 消息。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/pages/CartImport.tsx" />：购物车导入 UI 布局。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/pages/cartimport/cartImportControllers.ts" />：批次加载、草稿持久化、CAS 预警和逐条提交逻辑。

## CLI、Agent skill、MCP 与企业微信入口

- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/tree/main/lsm_cli" />：本地命令行客户端，所有命令输出 JSON，并通过后端 API 工作。
- Agent skill：复用 `python -m lsm_cli` 或安装后的 `lsm` 命令，不直接访问数据库或后端内部模块。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/lsm_mcp/http_app.py" />：MCP Streamable HTTP 入口。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/lsm_mcp/cli_runner.py" />：MCP 到 CLI 子进程的执行边界，会注入仓库根目录到 `PYTHONPATH`。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/tree/main/robot/wecom_aibot" />：企业微信智能机器人实现。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/tree/main/robot/wechat_kf" />：微信客服入口。

## 部署与运行环境

- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/docker-compose.yml" />：`redis`、`backend`、`frontend` 三服务编排。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/docker/backend/Dockerfile" />：后端镜像构建方式。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/docker/frontend/Dockerfile" />：前端静态资源镜像构建方式。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/docker/nginx/default.conf" />：统一代理 `/api`、`/static` 和前端路由回退。

## 按问题反查文件

- 登录态异常：先看 `auth.py`、`useStore.ts`、`api/client.ts`
- 到货或入库异常：先看 `reagent_orders_workflow.py`、`inventory.py`、`internal_code.py`
- 品牌选项异常：先看 `reagent_brands.py`、`reagent_brand_service.py`、`reagentBrandOptions.ts`
- 耗材列表搜索异常：先看 `consumable_orders.py`、`sqlite_fts.py`、`sqlite_indexes.py`
- 结构检索异常：先看 `chem.py`、`structure_cache_workflow.py`、`structure_index.py`
- 页面数据旧但刷新正常：先看 `api_utils.py`、`events.py`、`useListSSE.ts`
- 浏览器插件导入失败：先看 `popup.js`、`import-bridge.js`、`cartImportControllers.ts`
- 线上容器访问异常：先看 `docker-compose.yml`、`default.conf`、`main.py`

## 参考代码
- [app/api/common_shelf.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/common_shelf.py)
- [app/api/consumable_orders.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/consumable_orders.py)
- [app/api/events.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/events.py)
- [app/api/inventory.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory.py)
- [app/api/reagent_brands.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_brands.py)
- [app/api/reagent_orders.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders.py)
- [app/api/reagent_orders_workflow.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders_workflow.py)
- [app/api/user_sessions.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/user_sessions.py)
- [app/core/auth.py](https://github.com/hzb666/LabStorageManager/blob/main/app/core/auth.py)
- [app/database.py](https://github.com/hzb666/LabStorageManager/blob/main/app/database.py)
- [app/db_bootstrap](https://github.com/hzb666/LabStorageManager/tree/main/app/db_bootstrap)
- [app/api/chem.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/chem.py)
- [app/main.py](https://github.com/hzb666/LabStorageManager/blob/main/app/main.py)
- [app/services/api_utils.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/api_utils.py)
- [app/services/internal_code.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/internal_code.py)
- [app/services/pinyin_utils.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/pinyin_utils.py)
- [app/services/sse_manager.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/sse_manager.py)
- [browser-extension/background/service-worker.js](https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/background/service-worker.js)
- [browser-extension/content/import-bridge.js](https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/content/import-bridge.js)
- [browser-extension/build-config.mjs](https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/build-config.mjs)
- [browser-extension/popup/popup.js](https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/popup/popup.js)
- [docker-compose.yml](https://github.com/hzb666/LabStorageManager/blob/main/docker-compose.yml)
- [docker/nginx/default.conf](https://github.com/hzb666/LabStorageManager/blob/main/docker/nginx/default.conf)
- [frontend/src/api/client.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/api/client.ts)
- [frontend/src/App.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/App.tsx)
- [frontend/src/components/BaseForm.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/components/BaseForm.tsx)
- [frontend/src/components/ui/FilterTable.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/components/ui/FilterTable.tsx)
- [frontend/src/hooks/useListSSE.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useListSSE.ts)
- [frontend/src/hooks/useTableState.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useTableState.tsx)
- [frontend/src/hooks/useTableUrlState.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useTableUrlState.ts)
- [frontend/src/lib/reagentBrandOptions.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/lib/reagentBrandOptions.ts)
- [frontend/src/lib/staticAssets.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/lib/staticAssets.ts)
- [frontend/src/pages/cartimport/cartImportControllers.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/pages/cartimport/cartImportControllers.ts)
- [frontend/src/store/sseStore.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/store/sseStore.ts)
