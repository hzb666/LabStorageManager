# 开发、部署与代理

本页收拢本地开发、Docker Compose 部署、镜像构建和 Nginx 代理配置，统一说明启动路径与代理边界。

## 本地开发

### 配置准备

将 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/.env.example" /> 复制为 `.env`，至少填写：

- `DEFAULT_ADMIN_PASSWORD`
- `ENV`
- `CORS_ORIGINS`
- `REDIS_PASSWORD`

如果使用 `RS256`，还需要准备 `.keys/private.pem` 与 `.keys/public.pem`；若开发环境暂时改用 `HS256`，必须同时提供高熵 `SECRET_KEY`。

### 启动后端

```bash
poetry install
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 启动前端

```bash
cd frontend
npm install
npm run dev
```

默认前端访问 `http://localhost:5173`，API 前缀是 `http://localhost:8000/api`。如需覆盖，可通过 `VITE_API_URL` 调整。

## Docker Compose 部署

项目默认通过 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/docker-compose.yml" /> 组合三个服务：

- `redis`
- `backend`
- `frontend`

常用启动命令：

```bash
APP_PORT=80 docker compose up -d --build
```

当前部署约束如下：

- `backend` 依赖 `redis`
- `/data/static`、`.keys` 和 `lab_inventory.db` 会挂载到持久化卷
- `frontend` 对外暴露 `${APP_PORT:-80}`
- 前端镜像内的 `VITE_API_URL` 默认配置为 `/api`

## 镜像与入口点

- 后端镜像基于 `python:3.11-slim`，安装 Poetry 和运行时依赖，entrypoint 负责准备 `.keys`、静态目录和数据库挂载。
- 前端镜像采用多阶段构建：Node 阶段执行 `npm ci` 与 `npm run build`，最终由 `nginx:1.27-alpine` 托管 `dist`。
- 后端启动后会在 `lifespan` 中完成数据库初始化、WAL/FTS/索引准备和默认管理员检查。

## Nginx 代理边界

<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/docker/nginx/default.conf" /> 当前承担以下职责：

- `/api/` 代理到后端
- `/api/static/` 重写为 `/static/` 后再代理到后端
- `/static/` 直接代理到后端静态资源
- `/docs`、`/redoc`、`/openapi.json`、`/health` 代理到后端
- `/` 通过 `try_files ... /index.html` 支持前端 history 路由

代理层是统一入口，但认证、CORS、CSRF、安全头和静态资源缓存策略仍由 FastAPI 主导。

## 生产配置注意事项

- 若 Nginx 前面还有受信代理，需把 `TRUST_PROXY_HEADERS` 设为 `true`，并确保代理透传 `X-Forwarded-*`。
- 自定义域名或 TLS 场景下，需要补充 `listen 443 ssl`、证书路径和 `server_name`，同时保持 `/api` 与前端路由边界不变。
- `VITE_API_URL` 必须与代理路径对齐；如果前端部署在独立子域，不要继续使用默认 `/api` 假设。
- 上传大小同时受后端和 Nginx 限制，默认单次请求上限为 `5MB`，Nginx `client_max_body_size` 为 `5m`。

## 最小验证清单

1. `curl http://localhost:${APP_PORT:-80}/health`
2. `redis-cli -a <REDIS_PASSWORD> ping`
3. 浏览器访问 `<host>:${APP_PORT}`，确认前端静态资源与接口请求正常
4. 登录后验证 `/api/users/me`
5. 检查 `/static/*` 资源能否被正常访问

## 参考代码

- [.env.example](https://github.com/hzb666/LabStorageManager/blob/main/.env.example)
- [docker-compose.yml](https://github.com/hzb666/LabStorageManager/blob/main/docker-compose.yml)
- [docker/backend/Dockerfile](https://github.com/hzb666/LabStorageManager/blob/main/docker/backend/Dockerfile)
- [docker/backend/entrypoint.sh](https://github.com/hzb666/LabStorageManager/blob/main/docker/backend/entrypoint.sh)
- [docker/frontend/Dockerfile](https://github.com/hzb666/LabStorageManager/blob/main/docker/frontend/Dockerfile)
- [docker/nginx/default.conf](https://github.com/hzb666/LabStorageManager/blob/main/docker/nginx/default.conf)
