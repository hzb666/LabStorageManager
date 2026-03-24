# 部署指南

## 当前默认部署方式

仓库里已经给出一套完整的 Docker Compose 方案，默认包含三个服务：

- `redis`
- `backend`
- `frontend`

这也是目前最贴近仓库真实行为的部署入口。

## 服务关系

- `backend` 依赖 `redis`
- `frontend` 依赖 `backend`
- 对外暴露的端口来自 `frontend` 容器

## 环境变量重点

- `REDIS_PASSWORD` 是必需项
- `APP_PORT` 控制外部访问端口
- `TRUST_PROXY_HEADERS` 当前在 Compose 中显式置为 `false`

## 健康检查

- Redis 使用 `redis-cli ping`
- Backend 请求本地 `/health`
- Frontend 访问容器内首页

## 参考代码

- `docker-compose.yml:1`
- `docker-compose.yml:22`
- `docker-compose.yml:48`
