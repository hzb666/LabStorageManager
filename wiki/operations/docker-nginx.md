# Docker 与 Nginx

## 镜像构建

后端镜像：

- 基于 `python:3.11-slim`
- 通过 Poetry 安装依赖
- 复制 `app/` 与 `entrypoint.sh`

前端镜像：

- 构建阶段基于 `node:20-alpine`
- 运行阶段基于 `nginx:1.27-alpine`

## Nginx 路由职责

Nginx 当前负责：

- `/api/` -> 后端
- `/static/` -> 后端
- `/api/static/` -> 重写后代理到后端
- `/docs`、`/redoc`、`/openapi.json` -> FastAPI 文档
- `/` -> 前端单页应用

## 为什么 wiki 不能复用 `/docs`

因为当前 `/docs` 已经被 Nginx 明确代理到 FastAPI Swagger，所以正式 wiki 应当使用独立路径或独立部署目标。

## 参考代码

- `docker/backend/Dockerfile:1`
- `docker/frontend/Dockerfile:1`
- `docker/nginx/default.conf:6`
- `docker/nginx/default.conf:34`
- `docker/nginx/default.conf:69`
