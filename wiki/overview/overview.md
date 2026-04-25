# 项目概览

LabStorageManager 是面向实验室采购与库存管理的业务系统，围绕试剂、耗材、库存、借用、会话与公告展开，目标是把采购、到货、入库、借用、归还和审计放在同一条可追踪链路里。

## 职责边界

仓库覆盖的主要子系统如下：

- `app/`：FastAPI 后端，负责业务规则、认证、数据存储、静态资源和事件推送。
- `frontend/`：React 单页应用，负责页面路由、表格、表单和交互状态。
- `browser-extension/`：浏览器插件，负责采集外部购物车并桥接到 `/cart-import`。
- `lsm_cli/`：本地命令行客户端，供脚本和 Agent skill 通过后端 API 操作。
- `lsm_mcp/`：受控 MCP 工具服务，按白名单映射到 CLI 命令。
- `robot/`：企业微信智能机器人与微信客服入口。
- `docker/` 与 `docker-compose.yml`：部署镜像、Nginx 代理和服务编排。
- `wiki/`：文档站源码。

## 核心对象

- 用户与角色
- 试剂订单
- 试剂品牌
- 耗材订单
- 库存
- 借用日志
- 用户会话
- 公告

## 子系统概览

1. `app/` 承担后端业务校验、认证、持久化和静态资源服务。
2. `frontend/` 是用户交互入口，承担路由、列表页、表单页和实时刷新。
3. `browser-extension/` 是外部数据采集入口，只负责抓取和桥接，不直接写数据库。
4. Agent skill、`lsm_cli/`、`lsm_mcp/` 和 `robot/` 共同提供受控自动化入口，最终仍回到后端 API。

## 关键代码与职责

- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/main.py" />：创建 FastAPI 应用，注册中间件、生命周期、路由和 `/cart-import` 重定向。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/database.py" />：初始化 SQLite 引擎，启用 WAL 和外键，并编排启动期数据库准备。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/tree/main/app/db_bootstrap" />：集中维护 SQLite schema 补齐、性能索引、FTS 表和一致性检查。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/tree/main/app/core" />：`auth.py` 负责 JWT 与会话检查，`constants.py` 维护通用常量，`request_utils.py` 统一请求上下文。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/tree/main/app/models" />：使用 SQLModel 定义用户、订单、库存、品牌、借用日志、公告和会话等对象。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/tree/main/app/api" />：承载 `users`、`dashboard`、`inventory`、`reagent_orders`、`reagent_orders_workflow`、`consumable_orders`、`reagent_brands`、`cart_sync`、`announcements`、`events`、`chem` 等接口。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/tree/main/app/services" />：提供 CAS 规范化、规格解析、拼音字段、内码生成、SSE 广播、查询缓存、操作日志时间线和结构检索等能力。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/main.tsx" /> 与 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/App.tsx" />：挂载查询客户端、认证状态、SSE hook 和路由树。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/api/client.ts" />：统一 Axios 实例、Cookie 登录和各业务 API 的调用方式。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useSSE.ts" /> 与 `store/sseStore.ts`：维护 SSE 连接、序号处理和 stale 提示。
- `browser-extension/`：构建期 manifest、`popup/` 和 `content/import-bridge.js` 共同完成外部购物车到导入页的桥接。
- `lsm_cli/`：提供 `auth`、`inventory`、`reagent-orders`、`consumable-orders`、`common-shelf` 和 `chemical-name-map` 命令面，供脚本和 Agent skill 复用。
- `lsm_mcp/`：通过 CLI 子进程暴露受控 MCP 工具，不直接访问数据库。
- `robot/`：复用 MCP 工具面处理企业微信智能机器人和微信客服消息。

## 系统特征

- 试剂与耗材采用双链路处理。
- CAS 号重复提醒用于降低重复采购。
- 试剂品牌选项由后端主数据接口维护，前端表单统一复用。
- 试剂支持到货确认、暂存和一键入库。
- 常用货架覆盖“高频领用”的库存场景。
- SQLite 以 WAL 模式运行，兼顾部署简单和并发读取。
- 前端覆盖表格、表单、本地状态和设备管理。
- 后端提供 SSE、批量导入、图片上传和公告管理。

## 请求与事件链路

- 浏览器先加载 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/main.tsx" />，再由 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/api/client.ts" /> 统一访问 `/api`。
- 认证依赖后端设置的 HTTP-only `access_token` Cookie，`authAPI` 负责登录、退出和用户信息刷新。
- 列表页通过 `/api/...` 接口获取快照，并通过 `useSSE` 订阅 `/api/events?rooms=...` 进行增量刷新。
- 试剂工作流由 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders_workflow.py" /> 负责，按审批、到货和入库推进状态。
- 耗材工作流由 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/consumable_orders.py" /> 负责，完成后直接结束，不进入库存。
- SSE 推送由 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/sse_manager.py" /> 对外提供，浏览器插件导入页提交成功后由标准订单接口广播相关事件。
- 浏览器插件通过 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/content/script.js" /> 采集购物车，再由 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/content/import-bridge.js" /> 写入页面缓存，最终进入前端导入页。

## 技术栈速览

| 层级 | 技术 |
| --- | --- |
| 后端 | FastAPI + SQLModel + SQLite(WAL) + Redis |
| 前端 | React 19 + TypeScript 5.9 + Vite 8 + React Router 7 |
| 数据获取 | Axios + TanStack Query |
| 大表格与搜索 | TanStack Table + Virtual + 后端检索/拼音字段 |
| 认证与会话 | JWT + 多设备会话管理 |
| 化学结构 | RDKit + Ketcher + PubChem + 本地结构缓存 |
| 浏览器插件 | Chrome Manifest V3 |
| 自动化入口 | Agent skill + CLI + MCP + 企业微信智能机器人 + 微信客服 |

## 数据与缓存

- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/database.py" /> 在连接初始化时执行 `PRAGMA journal_mode=WAL` 和 `PRAGMA foreign_keys=ON`，并通过 `app/db_bootstrap/` 创建搜索、排序和筛选所需的索引与 FTS 表。
- 查询频繁的列表会走 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/api_utils.py" /> 的短 TTL 缓存，首页且无搜索条件时优先命中缓存。
- Redis 由 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/core/redis.py" /> 提供登录限流和会话黑名单，由 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/sse_redis.py" /> 负责跨进程广播。
- 图片由 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/image_service.py" /> 处理后保存到 `static/` 运行目录，经 `/static/` 访问；缓存头由 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/main.py" /> 的静态文件配置统一处理。
- 结构检索由 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/chem.py" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/structure_index.py" /> 和 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/models/compound_structure.py" /> 共同支撑。

## 运行与部署

- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/docker-compose.yml" /> 编排 `redis`、`backend` 和 `frontend` 三个服务。
- Docker 镜像定义在 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/docker/backend/Dockerfile" /> 与 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/docker/frontend/Dockerfile" />。
- Nginx 代理规则见 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/docker/nginx/default.conf" />，负责统一入口和前端路由回退。
- 本机开发时通常分别启动后端与前端，再通过 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/main.py" /> 的 `/cart-import` 跳转进入导入页。

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
| `/cart-import` | 浏览器插件导入确认 |
| `/devices` | 个人账户与设备管理 |
| `/admin/users` | 用户管理 |
| `/admin/announcements` | 公告管理 |
| `/admin/logs` | 用户操作日志 |
| `/logs` | 当前用户操作日志 |

## 开发者阅读路线

1. 本地启动与运行边界：先看 [快速开始](/overview/quick-start) 和 [开发、部署与代理](/dev-guide/deployment)。
2. 业务流程调整：先看 [业务流程](/overview/business-flows)。
3. 接口边界调整：先看 [API 边界与导航](/overview/api-boundary)。
4. 目录和入口梳理：先看 [目录结构](/overview/directory-structure) 和 [技术栈](/overview/tech-stack)。
5. 浏览器插件导入调整：先看 [浏览器插件购物车同步](/dev-guide/cart-sync)。
6. CLI、MCP 和机器人入口调整：先看 [关键文件导航](/dev-guide/key-files) 和 [API 边界与导航](/overview/api-boundary)。

## 验证要点

- 登录后检查 `/api/users/me`，确认认证链路正常。
- 打开两个浏览器标签，验证库存或订单更新后是否能收到 SSE 刷新。
- 分别用中文、拼音和 CAS 查询库存或订单，确认搜索结果一致。
- 测试 Excel 导入和浏览器插件导入，确认错误反馈和导入统计。
- 在 Docker 模式下检查 `/health`、`/api/*` 和 `/static/` 访问行为是否符合预期。

## 参考代码
- [app/api/cart_sync.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/cart_sync.py)
- [app/api/chem.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/chem.py)
- [app/api/consumable_orders.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/consumable_orders.py)
- [app/api/dashboard.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/dashboard.py)
- [app/api/reagent_brands.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_brands.py)
- [app/api/reagent_orders_workflow.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders_workflow.py)
- [app/core/redis.py](https://github.com/hzb666/LabStorageManager/blob/main/app/core/redis.py)
- [app/database.py](https://github.com/hzb666/LabStorageManager/blob/main/app/database.py)
- [app/main.py](https://github.com/hzb666/LabStorageManager/blob/main/app/main.py)
- [app/services/api_utils.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/api_utils.py)
- [app/services/image_service.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/image_service.py)
- [app/services/structure_index.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/structure_index.py)
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
- [app/db_bootstrap](https://github.com/hzb666/LabStorageManager/tree/main/app/db_bootstrap)
