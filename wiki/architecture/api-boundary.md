# API 边界

## 前后端边界

前端主要通过 `frontend/src/api/client.ts` 访问后端，后端统一暴露在 `/api/*` 下。对浏览器用户来说，前端拿到的是相对路径 API，不直接关心容器内部地址。

## 路由分类

- 用户与会话：`/api/users`、`/api/user-sessions`
- 试剂订单：`/api/reagent-orders`
- 耗材订单：`/api/consumable-orders`
- 库存：`/api/inventory`
- 事件流：`/api/events`
- 购物车同步：`/api/cart-sync`
- 公告：`/api/announcements`

## 不属于普通业务 API 的入口

- `/health`：健康检查
- `/docs`、`/redoc`、`/openapi.json`：FastAPI 文档入口
- `/static/*`：静态资源

## 一个容易踩坑的边界

当前部署里 `/docs` 已经给 FastAPI Swagger 使用，因此正式 wiki 不应该复用同一路径。为此本次文档站单独放在 `wiki/` 源目录，并建议未来部署成 `/manual` 或独立子路径。

## 参考代码

- `frontend/src/api/client.ts:1`
- `app/main.py:185`
- `docker/nginx/default.conf:34`
- `docker/nginx/default.conf:69`
