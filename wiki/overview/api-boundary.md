# API 边界与导航

## 这页解决什么问题

这页不再重复罗列接口清单。它只回答两类问题：

- 系统里有哪些入口，各自归谁管
- 想继续看 API、后端服务、认证或工作流时，应该跳到哪一页

如果你要查具体接口路径，请直接看 [API 参考](/backend/api-reference)。

## 谁在调用后端

这个项目有三类客户端：

- React 前端，通过 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/api/client.ts" /> 的 Axios 实例访问后端
- 浏览器扩展，通过桥接脚本把外部购物车批次送到前端导入页，再由前端调用后端
- 调试脚本或运维工具，通过 Bearer Token 或开发环境 `/docs` 直接访问 FastAPI

从系统边界上看，真正的业务后端只有一个：FastAPI。

## 入口边界

| 路径前缀 | 归属层 | 说明 |
| --- | --- | --- |
| `/api/*` | FastAPI 业务接口 | 主业务入口，绝大多数接口都在这里 |
| `/api/events` | FastAPI SSE | 实时推送入口 |
| `/static/*` | FastAPI 静态资源 | 上传图片、模板、导出资源访问路径 |
| `/health` | FastAPI 健康检查 | 部署探活 |
| `/docs` `/redoc` `/openapi.json` | FastAPI 文档 | 仅非 secure runtime 默认开放 |
| `/cart-import` | 前后端桥接入口 | 后端重定向到前端导入页面 |

## 鉴权边界

- 浏览器页面默认使用 HttpOnly Cookie
- 脚本和调试工具可以使用 `Authorization: Bearer`
- 管理员接口额外依赖 `require_admin`
- SSE 也不是公开通道，`GET /api/events` 同样要求登录

涉及 Cookie 的写请求在 secure runtime 下还会经过 `Origin` / `Referer` 校验，因此新域名、反向代理或跨域部署都要同步检查 `cors_origins`。

## 前端边界

前端不直接拼接服务内部地址，而是通过 `getApiBaseUrl()` 构造统一 base URL。它与后端的边界有三个特点：

- 以 HTTP 快照为主，SSE 增量更新为辅
- 表格状态、列宽、展开状态保存在浏览器本地
- 认证状态和 UI 状态由 Zustand 管理，不直接回写后端

继续阅读：

- 前端页面入口：[/frontend/app-shell](/frontend/app-shell)
- hooks：[/frontend/hooks](/frontend/hooks)
- lib：[/frontend/lib-overview](/frontend/lib-overview)

## 扩展边界

扩展和后端不是直连强耦合：

1. 扩展从外部采购平台采集数据
2. 扩展把批次写入 `chrome.storage.local`
3. `import-bridge.js` 在 `/cart-import` 页面把批次同步到页面环境
4. 前端导入页再调用 `/api/cart-sync` 和 `/api/cart-sync/import`

因此扩展更像“外部采集器”，不是系统自己的第二前端。

## 代理与部署边界

<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/docker/nginx/default.conf" /> 把前后端统一到一个入口：

- `/api/` 反代到后端
- `/static/` 透传到后端静态资源
- `/docs`、`/redoc`、`/openapi.json` 单独透传
- `/` 落到前端产物并回退到 `index.html`

这意味着部署层是单入口，但安全头、CSRF、CORS 和静态缓存仍由 FastAPI 主导。

## 阅读导航

### 我要查接口路径

去 [API 参考](/backend/api-reference)。

### 我要理解后端分层

去 [后端服务地图](/backend/service-map)。

### 我要理解接口怎么串成业务流程

去 [核心 API 与工作流](/backend/api-workflows)。

### 我要理解认证、Cookie、CSRF、Redis 降级

去 [认证与安全](/backend/auth-security)。

### 我要理解运行时入口、中间件、WAL、SSE 生命周期

去 [运行时与入口](/backend/runtime)。

## 新增接口前检查清单

- 这是对象 CRUD，还是工作流动作
- 是否补齐 `get_current_user` 或 `require_admin`
- 是否要触发 SSE 广播与缓存失效
- 是否涉及上传体积保护、CSRF、CORS 或代理头
- 是否需要同步更新 [API 参考](/backend/api-reference)

## 参考代码

- [app/api/cart_sync.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/cart_sync.py)
- [app/api/events.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/events.py)
- [app/core/auth.py](https://github.com/hzb666/LabStorageManager/blob/main/app/core/auth.py)
- [app/main.py](https://github.com/hzb666/LabStorageManager/blob/main/app/main.py)
- [browser-extension/content/import-bridge.js](https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/content/import-bridge.js)
- [docker/nginx/default.conf](https://github.com/hzb666/LabStorageManager/blob/main/docker/nginx/default.conf)
- [frontend/src/api/client.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/api/client.ts)
