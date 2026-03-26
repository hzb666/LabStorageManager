# API 边界与导航

本页说明系统对外入口的边界，以及前端、扩展、代理和后端之间的职责分工。具体接口路径仍以 [API 参考](/backend/api-reference) 为准。

## 调用方

当前调用后端的主体有三类：

- React 前端，通过 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/api/client.ts" /> 访问后端。
- 浏览器扩展，通过桥接脚本把外部购物车批次送到导入页，再由前端调用后端。
- 调试脚本或运维工具，通过 Bearer Token 或开发环境文档页访问 FastAPI。

从系统边界上看，业务后端只有一个，即 FastAPI。

## 入口边界

| 路径前缀 | 归属层 | 说明 |
| --- | --- | --- |
| `/api/*` | FastAPI 业务接口 | 主业务入口 |
| `/api/events` | FastAPI SSE | 实时推送入口 |
| `/static/*` | FastAPI 静态资源 | 上传图片、模板和导出资源 |
| `/health` | FastAPI 健康检查 | 部署探活 |
| `/docs` `/redoc` `/openapi.json` | FastAPI 文档 | 仅非生产运行模式默认开放 |
| `/cart-import` | 前后端桥接入口 | 后端重定向到前端导入页 |

## 鉴权边界

- 浏览器页面默认使用 HttpOnly Cookie。
- 脚本和调试工具可以使用 `Authorization: Bearer`。
- 管理员接口额外依赖 `require_admin`。
- `GET /api/events` 同样要求登录。

涉及 Cookie 的写请求在安全运行模式下还会经过来源校验，因此新域名、反向代理或跨域部署都要同步检查 `CORS_ORIGINS`。

## 前端边界

前端不直接拼接服务内部地址，而是通过统一的 API 基址访问后端。它与后端边界的主要特点是：

- 以 HTTP 快照为主，SSE 增量更新为辅。
- 表格状态、列宽和展开状态保存在浏览器本地。
- 认证状态和 UI 状态由 Zustand 管理，不直接回写后端。

如果需要继续定位页面入口、状态逻辑和工具函数，可分别查看 [应用骨架](/frontend/app-shell)、[前端 Hooks](/frontend/hooks) 和 [前端 Lib 工具箱](/frontend/lib-overview)。

## 扩展边界

扩展和后端不是直连强耦合，而是通过导入页完成桥接：

1. 扩展从外部采购平台采集数据。
2. 扩展把批次写入 `chrome.storage.local`。
3. `import-bridge.js` 在 `/cart-import` 页面把批次同步到页面环境。
4. 前端导入页再调用 `/api/cart-sync` 和 `/api/cart-sync/import`。

因此扩展更像外部采集器，不是系统自己的第二前端。

## 代理与部署边界

<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/docker/nginx/default.conf" /> 把前后端统一到一个入口：

- `/api/` 反代到后端。
- `/static/` 透传到后端静态资源。
- `/docs`、`/redoc` 和 `/openapi.json` 单独透传。
- `/` 落到前端产物并回退到 `index.html`。

部署层是统一入口，但安全头、CSRF、CORS 和静态缓存仍由 FastAPI 主导。

## 新增接口前检查清单

- 这是对象 CRUD，还是工作流动作。
- 是否补齐 `get_current_user` 或 `require_admin`。
- 是否要触发 SSE 广播与缓存失效。
- 是否涉及上传体积保护、CSRF、CORS 或代理头。
- 是否需要同步更新 [API 参考](/backend/api-reference)。

## 相关页面

- 查接口路径：看 [API 参考](/backend/api-reference)。
- 看后端分层：看 [后端服务地图](/backend/service-map)。
- 看业务流程：看 [核心 API 与工作流](/backend/api-workflows)。
- 看认证、Cookie、CSRF 与 Redis 降级：看 [认证与安全](/backend/auth-security)。
- 看运行时入口、中间件、WAL 与 SSE 生命周期：看 [运行时与入口](/backend/runtime)。

## 参考代码
- [app/api/cart_sync.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/cart_sync.py)
- [app/api/events.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/events.py)
- [app/core/auth.py](https://github.com/hzb666/LabStorageManager/blob/main/app/core/auth.py)
- [app/main.py](https://github.com/hzb666/LabStorageManager/blob/main/app/main.py)
- [browser-extension/content/import-bridge.js](https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/content/import-bridge.js)
- [docker/nginx/default.conf](https://github.com/hzb666/LabStorageManager/blob/main/docker/nginx/default.conf)
- [frontend/src/api/client.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/api/client.ts)
