# 目录结构

这个仓库同时包含 FastAPI 后端、React 前端、浏览器扩展、CLI、MCP 服务、企业微信入口、Docker/Nginx 部署文件和 VitePress wiki。先明确目录边界，再去看业务流程和接口，会更高效。

## 顶层目录

| 目录 | 作用 | 关键入口 |
| --- | --- | --- |
| `app/` | FastAPI 后端入口、路由、服务、模型与核心基础设施 | `main.py`、`api/`、`services/`、`models/` |
| `frontend/` | React 19 前端，页面、组件、hooks、状态管理 | `src/App.tsx`、`src/pages/`、`src/hooks/` |
| `browser-extension/` | Chrome 扩展，采集外部购物车并桥接到系统 | `build-config.mjs`、`content/`、`popup/` |
| `lsm_cli/` | 本地命令行客户端，只通过后端 API 工作 | `__main__.py`、`commands/` |
| `lsm_mcp/` | 受控 MCP 工具服务，调用 CLI 子进程 | `http_app.py`、`cli_runner.py` |
| `robot/` | 企业微信智能机器人和微信客服入口 | `wecom_aibot/`、`wechat_kf/` |
| `docker/` | 前后端镜像与 Nginx 反向代理配置 | `docker-compose.yml`、`docker/nginx/default.conf` |
| `static/` | 上传图片、模板等静态资源目录 | 上传链路、公告图片、导入模板 |
| `wiki/` | 当前知识库源码 | 站点配置、主题定制与各章节页面 |

## 后端目录

### `app/main.py`

- FastAPI 应用入口。
- 挂载路由。
- 注册中间件。
- 配置 `/docs`、`/redoc` 和 `/openapi.json`。
- 在 `lifespan` 中初始化数据库和 SSE。

### `app/api/`

路由层负责 HTTP 路径、权限依赖、请求参数和返回模型。建议优先阅读：

1. `users.py`
2. `inventory.py`
3. `reagent_orders.py`
4. `reagent_orders_workflow.py`
5. `consumable_orders.py`
6. `announcements.py`
7. `cart_sync.py`
8. `events.py`

### `app/services/`

服务层和可复用工具层，集中放置：

- 数据标准化
- 搜索与 FTS
- 内码生成
- 会话与限流
- 图片、导入导出
- SSE 广播

更适合在理解“业务怎么做”时阅读。

### `app/models/`

SQLModel 数据模型和 API DTO，包括：

- 数据库存储模型
- 创建 / 更新 DTO
- 响应 DTO
- 状态枚举

建议先读 [数据模型](/database/data-model)，再对照 [字段参考](/database/field-reference)。

### `app/core/`

运行时基础设施：

- `auth.py`：认证和权限依赖
- `config.py`：配置项与运行模式判断
- `redis.py`：Redis 客户端与断路器
- `constants.py`：上传路径、SSE 房间和限额常量
- `request_utils.py`、`time_utils.py`：请求和时间工具

## 前端目录

### `frontend/src/pages/`

页面层按业务拆分，包括登录、仪表盘、库存、试剂订单、耗材订单、公告管理、设备管理、日志和导入页。

### `frontend/src/components/`

组件层分两类：

- `components/ui/`：原子或基础 UI 组件。
- `components/*.tsx`：业务组件，如展开行、对话框、公告和借用弹窗。

### `frontend/src/hooks/`

自定义 hooks 主要负责：

- SSE 订阅
- 表格状态
- URL 同步
- 列宽和滚动
- 错误记录
- 主题和设备偏好

### `frontend/src/lib/`

前端工具箱主要负责：

- 表单 schema
- 表单配置
- 表格列配置
- 状态文案和常量
- API URL 构造
- 设备 ID 与 toast 工具

### `frontend/src/store/`

Zustand 状态层用于：

- 认证状态
- UI 状态
- SSE 连接和 stale 房间状态

## 浏览器扩展目录

| 路径 | 作用 |
| --- | --- |
| `browser-extension/build-config.mjs` | 根据扩展 env 生成 manifest 和运行配置 |
| `browser-extension/content/script.js` | 抓取购物车或商品详情 |
| `browser-extension/content/import-bridge.js` | 把批次数据桥接到系统 `/cart-import` 页面 |
| `browser-extension/popup/` | 扩展弹窗 UI |

扩展不是后端的第二套前端，而是采集器和投递器。

## CLI、MCP 与机器人目录

| 路径 | 作用 |
| --- | --- |
| `lsm_cli/` | 面向脚本和 MCP 的命令行入口，输出 JSON，不直接访问数据库 |
| `lsm_mcp/` | MCP Streamable HTTP 服务，按白名单映射到 CLI 命令 |
| `robot/wecom_aibot/` | 企业微信智能机器人实现 |
| `robot/wechat_kf/` | 微信客服一对一会话入口 |
| `robot/create_wechat_kf_account.py` | 创建微信客服账号并可写入 `WECHAT_KF_OPEN_KFID` |
| `robot/get_wechat_kf_link.py` | 获取客服账号列表或联系链接 |

## 部署与运行目录

| 路径 | 作用 |
| --- | --- |
| `docker-compose.yml` | 本地或服务器整体编排 |
| `docker/backend/Dockerfile` | 后端镜像 |
| `docker/frontend/Dockerfile` | 前端构建与静态托管镜像 |
| `docker/nginx/default.conf` | `/api`、`/static`、前端路由和文档入口代理规则 |

## 按任务阅读

### 第一次接手项目

1. [项目概览](/overview/overview)
2. [目录结构](/overview/directory-structure)
3. [技术栈](/overview/tech-stack)
4. [业务流程](/overview/business-flows)
5. [API 边界与导航](/overview/api-boundary)

### 要改后端

1. [运行时与入口](/backend/runtime)
2. [认证与安全](/backend/auth-security)
3. [后端服务地图](/backend/service-map)
4. [核心 API 与工作流](/backend/api-workflows)
5. [API 参考](/backend/api-reference)

### 要改前端

1. [应用骨架](/frontend/app-shell)
2. [页面地图](/frontend/page-map)
3. [组件介绍](/frontend/components)
4. [前端 Hooks](/frontend/hooks)
5. [前端 Lib 工具箱](/frontend/lib-overview)

## 参考代码
- [app/main.py](https://github.com/hzb666/LabStorageManager/blob/main/app/main.py)
- [app/services](https://github.com/hzb666/LabStorageManager/tree/main/app/services)
- [app/models](https://github.com/hzb666/LabStorageManager/tree/main/app/models)
- [browser-extension/content/import-bridge.js](https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/content/import-bridge.js)
- [docker-compose.yml](https://github.com/hzb666/LabStorageManager/blob/main/docker-compose.yml)
- [frontend/src/App.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/App.tsx)
- [frontend/src/components](https://github.com/hzb666/LabStorageManager/tree/main/frontend/src/components)
- [frontend/src/hooks](https://github.com/hzb666/LabStorageManager/tree/main/frontend/src/hooks)
- [frontend/src/lib](https://github.com/hzb666/LabStorageManager/tree/main/frontend/src/lib)
- [lsm_cli](https://github.com/hzb666/LabStorageManager/tree/main/lsm_cli)
- [lsm_mcp](https://github.com/hzb666/LabStorageManager/tree/main/lsm_mcp)
- [robot](https://github.com/hzb666/LabStorageManager/tree/main/robot)
