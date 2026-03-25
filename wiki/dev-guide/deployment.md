# 部署指南

## 本地开发启动

1. 将 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/.env.example" /> 复制为 `.env`，至少填写 `DEFAULT_ADMIN_PASSWORD`、`ENV`、`CORS_ORIGINS` 和 `REDIS_PASSWORD`。RS256 模式需要 `.keys/private.pem` 与 `.keys/public.pem`，HS256 身份验证时确保 `SECRET_KEY` 有高熵值。
2. 安装 Python 依赖并启动后端：
   ```bash
   poetry install
   python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
   ```
3. 启动前端开发服务器（默认访问 `http://localhost:5173`）：
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   可通过 `VITE_API_URL` 覆盖 API 前缀，默认对接 `http://localhost:8000/api`。

## Docker Compose 快速部署

- 通过 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/docker-compose.yml" /> 组合 `redis`、`backend` 和 `frontend`（其中 `frontend` 只暴露一个端口，内部把 `backend` 反向代理给浏览器）。默认命令：
  ```bash
  APP_PORT=80 docker compose up -d --build
  ```
- `backend` 容器依赖 `redis`。<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/docker/backend/entrypoint.sh" /> 会把 `/data/static`、`.keys` 和 `lab_inventory.db` 挂载到应用目录，确保 WAL 数据与静态资源在 `app_data` 卷中持久化。
- 必填环境变量包括 `REDIS_PASSWORD`、`DEFAULT_ADMIN_PASSWORD`、`ENV`、`CORS_ORIGINS` 和 JWT 所需的 `ALGORITHM` / key 路径。若你前置 TLS 终端，在 `TRUST_PROXY_HEADERS` 中设置 `true`，否则应保持 `false`（Compose 已将其显式设置为 `false`）。
- 前端镜像构建时的 `VITE_API_URL` 预设为 `/api`，对接 Nginx 反向代理；可在 `docker compose` 启动前设置环境变量改变 API 前缀。
- 启动后验证：
  - `docker compose ps`
  - `docker compose logs backend` / `frontend`
  - `curl http://localhost:${APP_PORT:-80}/health`
  - `redis-cli -a <REDIS_PASSWORD> ping`

## 静态资源与 HTTP 路径

- 所有上传文件、图片预览和缩略图落在 `/data/static`，entrypoint 把它链接为 `/app/static`，后端直接提供 `/static/`，Nginx 通过重写 `/api/static/` 代理到后端的同一路径。
- API 层统一以 `/api` 为前缀，Swagger `/docs`、ReDoc `/redoc`、`/openapi.json` 同样由 Nginx 代理转发到后端；operator 不需要单独部署文档服务。

## 常规验证

1. `curl http://localhost:${APP_PORT:-80}/health`
2. `redis-cli -h localhost -p 6379 -a <REDIS_PASSWORD> ping`
3. 浏览器访问 `<host>:${APP_PORT}`，检查 CSS/JS 被 `nginx` 正常加载，API 调用是否返回 200。
4. 登录后访问 `/api/users/me` 确认 JWT Token 拥有正确作用域。

## 参考代码
- [.env.example](https://github.com/hzb666/LabStorageManager/blob/main/.env.example)
- [docker-compose.yml](https://github.com/hzb666/LabStorageManager/blob/main/docker-compose.yml)
- [docker/backend/entrypoint.sh](https://github.com/hzb666/LabStorageManager/blob/main/docker/backend/entrypoint.sh)
- [docker/nginx/default.conf](https://github.com/hzb666/LabStorageManager/blob/main/docker/nginx/default.conf)


