# 目录结构

## 为什么先看这一页

这个仓库不是简单的“前后端各一坨代码”。它同时包含：

- FastAPI 后端
- React 前端
- 浏览器扩展
- Docker / Nginx 部署
- VitePress wiki

如果先知道每个目录负责什么，再去读业务流程、接口和模型，理解成本会低很多。

## 顶层目录

| 目录 | 作用 | 先看什么 |
| --- | --- | --- |
| `app/` | FastAPI 后端入口、路由、服务、模型与核心基础设施 | `main.py`、`api/`、`services/`、`models/` |
| `frontend/` | React 19 前端，页面、组件、hooks、状态管理 | `src/App.tsx`、`src/pages/`、`src/hooks/` |
| `browser-extension/` | Chrome 扩展，采集外部购物车并桥接到系统 | `manifest.json`、`content/`、`popup/` |
| `docker/` | 前后端镜像与 Nginx 反向代理配置 | `docker-compose.yml`、`docker/nginx/default.conf` |
| `static/` | 上传图片、模板等静态资源目录 | 上传链路、公告图片、导入模板 |
| `wiki/` | 当前知识库源码 | 站点配置、主题定制与各章节页面 |
| `tests/` | 现有测试与验证资源 | 作为行为参考，不是唯一事实来源 |
| `docs/` | 临时分析文档、计划与补充说明 | 仅作辅助，不替代正式 wiki |

## 后端目录

### `app/main.py`

- FastAPI 应用入口
- 挂载路由
- 注册中间件
- 配置 `/docs`、`/redoc`、`/openapi.json`
- 在 `lifespan` 中初始化数据库和 SSE

### `app/api/`

路由层。这里处理：

- HTTP 路径和方法
- 权限依赖
- 请求参数与返回模型
- 与 `services/` 的协作

建议阅读顺序：

1. `users.py`
2. `inventory.py`
3. `reagent_orders.py`
4. `reagent_orders_workflow.py`
5. `consumable_orders.py`
6. `announcements.py`
7. `cart_sync.py`
8. `events.py`

### `app/services/`

服务层和可复用工具层。这里集中放：

- 数据标准化
- 搜索与 FTS
- internal code 生成
- 会话与限流
- 图片、导入导出
- SSE 广播

更适合在理解“业务怎么做”时阅读。详见 [后端服务地图](/backend/service-map)。

### `app/models/`

SQLModel 数据模型和 API DTO：

- 数据库存储模型
- 创建 / 更新 DTO
- 响应 DTO
- 状态枚举

建议先读 [数据模型](/database/data-model)，再对照 [字段参考](/database/field-reference)。

### `app/core/`

运行时基础设施：

- `auth.py`：认证和权限依赖
- `config.py`：配置项与 secure runtime 判断
- `redis.py`：Redis 客户端与断路器
- `constants.py`：上传路径、SSE 房间、限额常量
- `request_utils.py`、`time_utils.py`：请求与时间工具

## 前端目录

### `frontend/src/pages/`

页面层，按业务页面拆分：

- 登录、仪表盘、库存、试剂订单、耗材订单
- 公告管理、设备管理、日志、导入页

它们通常组合 `hooks/`、`components/` 和 `api/client.ts`。

### `frontend/src/components/`

组件层分两类：

- `components/ui/`：原子或基础 UI 组件
- `components/*.tsx`：业务组件，如展开行、对话框、公告、借用弹窗

详见 [组件介绍](/frontend/components)。

### `frontend/src/hooks/`

自定义 hooks，负责：

- SSE 订阅
- 表格状态
- URL 同步
- 列宽和滚动
- 错误记录
- 主题与设备偏好

详见 [前端 Hooks](/frontend/hooks)。

### `frontend/src/lib/`

前端工具箱，负责：

- 表单 schema
- 表单配置
- 表格列配置
- 状态文案和常量
- API URL 构造
- 设备 ID 与 toast 等基础工具

详见 [前端 Lib 工具箱](/frontend/lib-overview)。

### `frontend/src/store/`

Zustand 状态层：

- 认证状态
- UI 状态
- SSE 连接和 stale 房间状态

这部分和 [状态与实时同步](/frontend/state-sync) 关系最紧。

## 浏览器扩展目录

| 路径 | 作用 |
| --- | --- |
| `browser-extension/manifest.json` | 扩展权限、入口和内容脚本声明 |
| `browser-extension/content/script.js` | 抓取北医试剂平台购物车或商品详情 |
| `browser-extension/content/import-bridge.js` | 把批次数据桥接到系统 `/cart-import` 页面 |
| `browser-extension/popup/` | 扩展弹窗 UI |

扩展不是后端的第二套前端，而是“采集器 + 投递器”。

## 部署与运行目录

| 路径 | 作用 |
| --- | --- |
| `docker-compose.yml` | 本地或服务器整体编排 |
| `docker/backend/Dockerfile` | 后端镜像 |
| `docker/frontend/Dockerfile` | 前端构建与静态托管镜像 |
| `docker/nginx/default.conf` | `/api`、`/static`、前端路由和文档入口代理规则 |

## 推荐阅读顺序

### 第一次接手项目

1. [项目概览](/overview/overview)
2. 本页
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
