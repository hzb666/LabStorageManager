# Docker 与 Nginx

## 镜像构建

- 后端镜像基于 `python:3.11-slim`，安装 `openssl`、Poetry 并通过 `poetry install --without dev,scripts` 安装依赖，再执行 `pip install redis`，最后在 entrypoint 生成 `.keys` 并把 `/data/static` 挂载至 `/app/static`，保证数据库与图片在 `app_data` 卷中持久化。
- 前端采用多阶段构建：`node:20-alpine` 阶段执行 `npm ci` 与 `npm run build`（可通过 `ARG VITE_API_URL` 指定 API 前缀）；最终镜像基于 `nginx:1.27-alpine`，用 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/docker/nginx/default.conf" /> 替换默认配置，并把 `dist` 目录拷贝到 `/usr/share/nginx/html`。

## Nginx 路由职责

- `location /api/static/` 重写为 `/static/` 并代理至 `backend:8000`，确保上传图片、缩略图与资源共享同一路径。
- `/api/`、`/docs`、`/docs/`、`/redoc`、`/openapi.json`、`/health` 统一代理到后端，代理时设置 `Host`、`X-Real-IP`、`X-Forwarded-For`、`X-Forwarded-Proto` 并使用 `proxy_http_version 1.1`。
- `/static/` 也代理到后端，避免 Nginx 作为静态服务器时直接访问不到后端生成的上传内容。
- 根路径 `/` 使用 `try_files $uri $uri/ /index.html`，保持单页应用的 history 路由。
- `client_max_body_size` 设为 20m，避免上传大文件被 Nginx 提前拒绝。

## 生产注意事项

- Compose 中 `TRUST_PROXY_HEADERS=false`，若 Nginx 在真实受信代理（例如 Cloudflare、Ingress Controller）后面，请设置该环境变量为 `true`，并确保代理传递 `X-Forwarded-*`。
- 如果使用自定义域名或 TLS，替换 `server_name _;` 并在 Nginx 配置中增加 `listen 443 ssl`、证书路径等，同样保持 `/api`、`/docs` 等路径不冲突。
- `frontend` 镜像构建时的 `VITE_API_URL` 应与 Nginx Proxy 的路径对齐。如果前端部署在独立子域，直接在 `docker compose` 命令前 export 一个 `VITE_API_URL`。

## 参考代码
- [docker/backend/Dockerfile](https://github.com/hzb666/LabStorageManager/blob/main/docker/backend/Dockerfile)
- [docker/backend/entrypoint.sh](https://github.com/hzb666/LabStorageManager/blob/main/docker/backend/entrypoint.sh)
- [docker/frontend/Dockerfile](https://github.com/hzb666/LabStorageManager/blob/main/docker/frontend/Dockerfile)
- [docker/nginx/default.conf](https://github.com/hzb666/LabStorageManager/blob/main/docker/nginx/default.conf)


