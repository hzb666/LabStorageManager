# 开发、部署与代理

本页收拢本地开发、Docker Compose 部署、镜像构建和 Nginx 代理配置，统一说明启动路径与代理边界。

## 本地开发

前端本地构建、CI 和安全检查使用 Node.js `24.14.1` 与 npm `11.8.0`。Wiki Pages 工作流使用 Node.js 20。两个 npm 项目均以各自的 lock 文件为安装依据。

### 配置准备

以 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/.env.example" /> 为模板准备本地运行配置，至少填写：

```powershell
Copy-Item .env.example .env
```

非 PowerShell 环境可使用：

```bash
cp .env.example .env
```

- `DEFAULT_ADMIN_PASSWORD`
- `ENV`
- `CORS_ORIGINS`
- `DATABASE_URL`
- `QUERY_LOG_DIR`

如果使用 `RS256`，还需要准备 RSA 私钥与公钥；若开发环境暂时改用 `HS256`，必须同时提供高熵 `SECRET_KEY`。

Redis 仅监听 `127.0.0.1` 或 Compose 内网时，`REDIS_PASSWORD` 可以留空；Redis 对外监听或跨机器访问时必须设置强密码。
默认登录态为 7 天：`ACCESS_TOKEN_EXPIRE_MINUTES=10080`，`SESSION_EXPIRE_HOURS=168`。单个后端进程的 Redis 连接池上限由 `REDIS_MAX_CONNECTIONS` 控制，默认 100。

实验步骤查库存需要配置 OpenAI 兼容 LLM 的 API 地址、API Key 和模型。Sentry 前后端监控均为可选能力，DSN 为空时保持停用；前端 source map 上传还需要构建环境提供组织、项目和鉴权信息。

### 启动后端

```bash
poetry install
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

使用虚拟环境部署时，应按 Poetry 依赖清单安装运行依赖：

```bash
python -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
poetry install --without dev,scripts --no-root
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

### 启动前端

```bash
cd frontend
npm ci
npm run dev
```

默认前端访问 `http://localhost:5173`，API 前缀是 `http://localhost:8000/api`。如需覆盖，可通过 `VITE_API_URL` 调整。

`npm run dev` 会先执行 `npm run generate:static-assets`，为 RDKit、本地 WASM 和字体写入带版本号的资源映射。

生产环境前端按静态站点部署：

```bash
cd frontend
npm ci
npm run build
```

`npm run build` 同样会先生成公共资源映射。将前端构建产物放到 Nginx 站点根目录。后端代码、上传资源、密钥、数据库文件和运行依赖放在后端运行目录，由进程管理器启动 `python -m uvicorn app.main:app --host 127.0.0.1 --port 8000`。

本地 `.env.example` 默认主库是 `sqlite:///./lab_inventory.db`，搜索日志目录是 `logs`。Docker Compose 会把它们覆盖到 `/data/lab_inventory.db` 和 `/data/logs`，并把上传资源保存到 `/data/static`。

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
- `/data/lab_inventory.db`、`/data/logs`、`/data/static` 和 `/data/keys` 会挂载到持久化 volume
- `frontend` 对外暴露 `${APP_PORT:-80}`
- 前端镜像内的 `VITE_API_URL` 默认配置为 `/api`

## 镜像与入口点

- 后端镜像基于 `python:3.11-slim`，安装 Poetry 和运行时依赖，entrypoint 负责准备 `/data/keys`、`/data/static` 和 `/data/lab_inventory.db`。
- 前端镜像采用多阶段构建：Node 阶段执行 `npm ci` 与 `npm run build`，最终由安装 Nginx 与 Brotli 模块的 Alpine 镜像托管构建产物。
- 后端启动后会在 `lifespan` 中完成数据库初始化、schema 补齐、WAL/FTS/索引准备、结构索引重建和默认管理员检查。

## Nginx 代理边界

<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/docker/nginx/default.conf" /> 当前承担以下职责：

- `/api/` 代理到后端
- `/static/` 代理到后端
- `/docs`、`/redoc`、`/openapi.json`、`/health` 代理到后端
- `/` 通过 `try_files ... /index.html` 支持前端 history 路由

代理层是统一入口，但认证、CORS、CSRF、安全头和 `/static/` 缓存策略仍由 FastAPI 主导。

## 生产配置注意事项

- 若 Nginx 前面还有受信代理，需把 `TRUST_PROXY_HEADERS` 设为 `true`，并确保代理透传 `X-Forwarded-*`。
- 自定义域名或 TLS 场景下，需要补充 `listen 443 ssl`、证书路径和 `server_name`，同时保持 `/api` 与前端路由边界不变。
- `VITE_API_URL` 必须与代理路径对齐；如果前端部署在独立子域，不要继续使用默认 `/api` 假设。
- 上传大小同时受后端和 Nginx 限制，生产配置使用 `MAX_UPLOAD_REQUEST_SIZE_MB=12` 和 Nginx `client_max_body_size 12m`。公告图片和头像仍由业务代码限制为 5MB。

## 最小验证清单

1. `curl http://localhost:${APP_PORT:-80}/health`
2. Redis 无密码时执行 `redis-cli ping`；有密码时执行 `redis-cli -a <REDIS_PASSWORD> ping`
3. 浏览器访问 `<host>:${APP_PORT}`，确认前端静态资源与接口请求正常
4. 登录后验证 `/api/users/me`
5. 检查 `/static/` 上传资源能否被正常访问
6. 启用 LLM 后检查实验步骤提取、CAS 解析和库存查询；未配置时确认接口返回服务不可用

## 参考代码

- [docker-compose.yml](https://github.com/hzb666/LabStorageManager/blob/main/docker-compose.yml)
- [docker/backend/Dockerfile](https://github.com/hzb666/LabStorageManager/blob/main/docker/backend/Dockerfile)
- [docker/backend/entrypoint.sh](https://github.com/hzb666/LabStorageManager/blob/main/docker/backend/entrypoint.sh)
- [docker/frontend/Dockerfile](https://github.com/hzb666/LabStorageManager/blob/main/docker/frontend/Dockerfile)
- [docker/nginx/default.conf](https://github.com/hzb666/LabStorageManager/blob/main/docker/nginx/default.conf)
