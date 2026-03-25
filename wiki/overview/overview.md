# 项目概览

LabStorageManager 是一个面向实验室场景的全流程库存管理系统，目标不是只记录库存，而是把“采购申请、到货、入库、借用、归还、通知与审计”放进一套统一入口里。

## 项目边界

当前仓库实际覆盖了这些模块：

- FastAPI 后端
- React 19 + TypeScript 前端
- SQLite 持久化与 WAL 并发配置
- Redis 辅助缓存与会话能力
- Chrome Manifest V3 浏览器扩展
- Docker / Nginx 部署方案

## 业务对象

- 用户与角色
- 试剂订单
- 耗材订单
- 库存
- 借用日志
- 用户会话
- 公告

## 三大子系统

1. `app/`：后端单一事实源，负责业务规则、认证、数据存储和静态文件。
2. `frontend/`：用户直接操作的 React 单页应用，负责路由、表格、表单和交互。
3. `browser-extension/`：浏览器扩展，负责从外部试剂平台抓取购物车并桥接导入。

## 代码事实源与职责

- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/main.py" />：启动 FastAPI、注册中间件（CORS、HTTPS 重定向、CSRF、日志、安全头）、启停生命周期、挂载 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/tree/main/app/api" /> 路由，以及为 `/cart-import` 和 `/` 提供前端跳转。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/database.py" />：构建 SQLite 引擎、启用 WAL/外键、一次性创建索引、FTS 触发器与默认管理员保证核心一致性。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/tree/main/app/core" />：`auth.py` 提供 JWT + 多设备会话检查，`constants.py` 定义 SSE 房间、HTTPS、上传路径等守则，`request_utils.py` 统一请求 ID、客户端 IP。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/tree/main/app/models" />：每个业务对象（用户、会话、试剂/耗材订单、库存、借用日志、公告）都通过 SQLModel 精准建模，`Inventory` 中实现 `internal_code`、拼音字段与状态枚举。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/tree/main/app/api" />：以 `users`, `inventory`, `reagent_orders`, `reagent_orders_workflow`, `consumable_orders`, `user_sessions`, `cart_sync`, `announcements`, `error_logs`, `events` 为主干，`reagent_orders_workflow` 负责审批/到货/入库、`cart_sync` 处理购物车匹配与导入。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/tree/main/app/services" />：`internal_code`/`spec_utils`/`cas_utils` 负责 CAS 规范化与规格解析、`pinyin_utils` 预计算汉字拼音、`sse_manager` 与 `sse_redis` 实现事件广播、`inventory_queries` 提供通用查询。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/main.tsx" /> & <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/App.tsx" />：挂载 TanStack Query、Auth 状态、SSE hook 与路由树，页面按 `Dashboard`、`ReagentOrders`、`ConsumableOrders`、`Inventory`、`CommonShelf`、`Import`、`CartImport`、`Admin` 等维度 Lazily 加载。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/api/client.ts" />：统一 Axios 实例、Cookie 登录、拦截器、分页/枚举定义，涵盖身份、用户、订单、库存、公告、设备、日志等所有 `/api` 接口。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useSSE.ts" /> 与 `store/sseStore.ts`：以 `/api/events?rooms=...` 订阅 SSE，`CommonShelf` 仅监听 `common_shelf` 房间，消息交由对应 handlers 更新界面与 stale 提示。
- `browser-extension/`：`manifest.json` 授权 `reagent.bjmu.edu.cn`，`popup/` 提供用户交互，`content/import-bridge.js` 将 `chrome.storage.local.import_batch_latest` 同步到前端 `/cart-import`；最终通过 `/api/cart-sync/import` 创建订单。

## 主要特征

- 试剂与耗材双链路
- CAS 号重复提醒，帮助减少重复采购
- 试剂支持确认到货、暂存和一键入库
- 常用货架支持“拿一瓶”这种高频公用试剂场景
- SQLite 开启 WAL，兼顾部署简单和并发读取
- 前端有完整的表格、表单、本地状态和设备管理体系
- 后端提供 SSE、批量导入、图片上传、公告管理等外围能力
- 扩展可把外部购物车批次桥接进系统导入页

## 请求与事件链路

- 浏览器先加载 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/main.tsx" />，`QueryClientProvider` + `App` 组合后由 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/api/client.ts" /> 统一调用 `/api` 接口。认证通过 Server 设置的 HTTP-only `access_token` Cookie，`authAPI` 在 `login/logout/getProfile` 之间刷新 `useAuthStore`。
- 列表页（库存、试剂、耗材、常用货架）都依赖 `/api/.../dashboard`、`/inventory`、`/reagent-orders`、`/consumable-orders` 等接口，同时通过 `useSSE` 订阅 `/api/events?rooms=inventory,common_shelf,reagent_orders,consumable_orders` 实时更新。
- 订单审批、到货、入库逻辑由 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders_workflow.py" /> 实现：`/{id}/approve`、`/{id}/confirm-arrival`、`/{id}/stock-in` 按 `ReagentOrderStatus` 跳转到 `Inventory`，并由 `InventoryStatus` 维护 `is_common`、`temporary_keeper_id`。
- 耗材走 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/consumable_orders.py" /> 的 `approve/reject/complete`，完成后直接设置 `status=completed`，无需入库。
- SSE 中间件 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/sse_manager.py" /> 在 `/api/events` 路由对外提供推送，`inventory/common_shelf` 事件也会触发前端表格刷新；<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/cart_sync.py" /> 会在导入后向 SSE 广播 `cart_sync` 相关事件。
- 扩展通过 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/content/script.js" /> 抓取试剂购物车，把数据写到 Chrome storage（`import_batch_latest`），`content/import-bridge.js` 把它同步到页面 `localStorage.cart_import_batch_latest`，前端再调用 `cartSyncAPI.importItems` 触发 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/cart_sync.py" />。

## 这套 wiki 的口径

- 以代码真实行为为准
- 历史设计文档和旧 API 文档只作为辅助背景
- 如果某个功能仍在演进，会写成“当前实现”

## 技术栈速览

| 层级 | 当前实现 |
| --- | --- |
| 后端 | FastAPI + SQLModel + SQLite(WAL) + Redis |
| 前端 | React 19 + TypeScript + Vite + React Router |
| 数据获取 | Axios + TanStack Query |
| 大表格与搜索 | TanStack Table + Virtual + 后端检索/拼音字段 |
| 认证与会话 | JWT + 多设备会话管理 |
| 扩展 | Chrome Manifest V3 |

## 数据与缓存

- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/database.py" /> 在每条连接上执行 `PRAGMA journal_mode=WAL`、`PRAGMA foreign_keys=ON` 并用 `CREATE INDEX IF NOT EXISTS` 构建搜索/排序/筛选所需复合索引与 FTS 表（`inventory_fts`、`reagent_order_fts`、`consumable_order_fts`、`users_fts`）。
- 对查询频繁的列表（库存、订单）使用 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/api_utils.py" /> + 内存缓存 `LIST_CACHE_PREFIX`，分页首页且无搜索条件时从 `SEARCH_CACHE` 直接返回。
- Redis 一方面在 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/core/redis.py" /> 提供登录限流、会话黑名单，另一方面由 `SSEMessage` 通过 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/sse_redis.py" /> 负责跨进程广播，确保 `SSERoom` 的 `seq` 全局有序。
- 图片通过 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/image_service.py" /> 压缩并写入 `static/uploads`，<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/main.py" /> 通过 `CachedStaticFiles` 添加 `Cache-Control`、CSP、HSTS 安全头。

## 运行与部署要点

- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/docker-compose.yml" /> 构建 `redis`、`backend`（依赖 `.env` 中密钥）、`frontend` 三个服务，`backend` 挂载 `app_data` 卷并在 `healthcheck` 中探 `/health`，`frontend` 暴露 `${APP_PORT:-80}`。
- Docker 镜像在 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/docker/backend/Dockerfile" /> 与 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/docker/frontend/Dockerfile" />，Nginx 配置见 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/docker/nginx/default.conf" />（反向代理 `/api` 与 `/static`）。
- 本机运行时分别 `python -m uvicorn app.main:app --reload --port 8000`、`npm run dev`，`frontend` 默认在 5173 端口，然后通过 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/main.py" /> 的 `cart_import_redirect` 将 `/cart-import` 重定向到前端。

## 前端页面地图

| 路由 | 页面定位 |
| --- | --- |
| `/login` | 登录页 |
| `/` | 仪表盘 |
| `/reagents` | 试剂订单 |
| `/consumables` | 耗材订单 |
| `/inventory` | 库存管理 |
| `/common-shelf` | 常用货架 |
| `/import` | 批量导入库存 |
| `/devices` | 个人账户与设备管理 |
| `/admin/users` | 用户管理 |
| `/admin/announcements` | 公告管理 |
| `/admin/logs` | 用户操作日志 |

## 开发者阅读路线（按任务）

1. 想先跑起来：先看 [快速开始](/overview/quick-start) 与 [部署指南](/dev-guide/deployment)，再看 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/main.py" /> 的 `lifespan` 与中间件链。
2. 想改业务流程：先看 [业务流程](/overview/business-flows) 与 [核心 API 与工作流](/backend/api-workflows)，确认试剂/耗材双轨状态机差异。
3. 想改搜索和性能：先看 [数据模型](/database/data-model)、[数据与搜索](/database/data-search)、[优化思路](/optimization/optimization)，再改 `app/database.py` 的索引/FTS 初始化。
4. 想改前端表格与实时：先看 [应用骨架](/frontend/app-shell)、[表格与表单体系](/frontend/table-form-system)、[状态与实时同步](/frontend/state-sync)。
5. 想改扩展导入：先看 [购物车同步扩展](/dev-guide/cart-sync) 与 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/pages/CartImport.tsx" />。

## 与 zread 对照后的校正说明

- 本地开发默认不是 Vite dev proxy 反代，而是前端直接请求 `VITE_API_URL`（默认 `http://localhost:8000/api`），见 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/lib/apiConfig.ts" />。
- 常用货架前端页面路径是 `/common-shelf`，后端接口路径是 `/api/inventory/common-shelf*`，两者不应混淆。
- FTS 不止 `inventory_fts`，还包含 `reagent_order_fts`、`consumable_order_fts`、`users_fts`，并由触发器与主表保持同步。
- 购物车扩展存储键是 `chrome.storage.local.import_batch_latest`，页面缓存键是 `localStorage.cart_import_batch_latest`，二者由桥接脚本转换。

## 开发验证清单

- 认证与会话：登录后检查 `/api/users/me`，并验证 401 拦截是否会触发前端登出。
- 实时推送：打开两个浏览器标签，执行库存借还或订单审批，确认另一端收到 SSE 更新或 stale 提示。
- 搜索与拼音：用中文、全拼、首字母、CAS 编号分别查询库存与订单，确认结果一致性。
- 导入链路：测试 Excel 导入与扩展导入各一遍，确认错误行反馈和成功导入统计。
- 部署一致性：在 Docker 模式下检查 `/health`、`/api/*`、`/static/*`、`/docs`（生产模式应关闭）行为是否符合预期。

## 参考代码
- [app/api/cart_sync.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/cart_sync.py)
- [app/api/consumable_orders.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/consumable_orders.py)
- [app/api/reagent_orders_workflow.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders_workflow.py)
- [app/core/redis.py](https://github.com/hzb666/LabStorageManager/blob/main/app/core/redis.py)
- [app/database.py](https://github.com/hzb666/LabStorageManager/blob/main/app/database.py)
- [app/main.py](https://github.com/hzb666/LabStorageManager/blob/main/app/main.py)
- [app/services/api_utils.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/api_utils.py)
- [app/services/image_service.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/image_service.py)
- [app/services/sse_manager.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/sse_manager.py)
- [app/services/sse_redis.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/sse_redis.py)
- [browser-extension/content/script.js](https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/content/script.js)
- [docker-compose.yml](https://github.com/hzb666/LabStorageManager/blob/main/docker-compose.yml)
- [docker/backend/Dockerfile](https://github.com/hzb666/LabStorageManager/blob/main/docker/backend/Dockerfile)
- [docker/frontend/Dockerfile](https://github.com/hzb666/LabStorageManager/blob/main/docker/frontend/Dockerfile)
- [docker/nginx/default.conf](https://github.com/hzb666/LabStorageManager/blob/main/docker/nginx/default.conf)
- [frontend/src/api/client.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/api/client.ts)
- [frontend/src/App.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/App.tsx)
- [frontend/src/hooks/useSSE.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useSSE.ts)
- [frontend/src/lib/apiConfig.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/lib/apiConfig.ts)
- [frontend/src/main.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/main.tsx)
- [frontend/src/pages/CartImport.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/pages/CartImport.tsx)
