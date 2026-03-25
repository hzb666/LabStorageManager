# 快速开始

## 1. 前置环境

- Python 3.11+（推荐配合 Poetry）、Node.js 20+、npm 9+。
- 可选安装 Redis 6+，用于登录速率限制与会话缓存；不配置时系统会自动退到 SQLite。
- 确保主机有 Git、Docker（若使用 Compose）、以及对外网的访问（用于拉镜像、安装依赖）。

## 2. 克隆与环境变量

```bash
git clone https://github.com/hzb666/LabStorageManager.git
cd LabStorageManager
cp .env.example .env
```

至少修改 `.env` 中的：

- `DEFAULT_ADMIN_PASSWORD`（首次启动必须）。
- `ENV`（“development”/“production”）。
- `CORS_ORIGINS`（生产环境填写前端域）。
- `REDIS_PASSWORD`、`REDIS_HOST`（若启用了 Redis）。
- `ALGORITHM`、`PRIVATE_KEY_PATH`、`PUBLIC_KEY_PATH`（RS256 模式下 PEM 文件需存在；否则可暂设 HS256 并填写 `SECRET_KEY`）。

## 3. 启动后端

```bash
poetry install
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

- 启动后可访问 `http://localhost:8000/docs` 与 `/redoc` 查看 OpenAPI API，`/health` 用于健康检查。

## 4. 启动前端

```bash
cd frontend
npm install
npm run dev
```

- 开发模式默认监听 5173，若访问不了请检查 `VITE_API_URL` 是否指向 `http://localhost:8000/api` 或替换为实际部署路径。
- 构建生产包：`npm run build`（供 Docker/Nginx 阶段使用）。

## 5. Docker Compose 运行整套服务

```bash
APP_PORT=80 docker compose up -d --build
```

- `backend` 仅暴露内部 8000 端口，前端通过 Nginx 代理对外；`redis` 与 `app_data` 分别持久化在 `redis_data` 和 `app_data`。
- 确保宿主的 `app_data` 可写，尤其是 `app_data/static`、`app_data/keys` 与 `app_data/lab_inventory.db`，避免每次重启都重新生成 RSA key。
- 日志查看：`docker compose logs backend`、`docker compose logs frontend`。

## 6.1 首次启动会自动执行什么

- 后端 `lifespan` 会调用 `init_db()`：自动建表、补齐索引、初始化 FTS、做 schema 一致性检查，并尝试创建默认管理员（<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/database.py#L791" />）。
- SQLite 连接创建时会强制 `PRAGMA journal_mode=WAL` 和 `PRAGMA foreign_keys=ON`，即便重启也会重新校正。
- 若运行在开发模式且缺少 RSA key，配置层会尝试自动生成临时密钥；生产模式则要求显式提供 key 文件（<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/core/config.py#L117" />）。
- 前端首次加载会触发 `authAPI.getProfile()` 以恢复登录态，并初始化主题、路由守卫与全局 Toast/Tooltip 容器（<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/App.tsx" />）。

## 7. 核心验证

1. `curl http://localhost:${APP_PORT:-80}/health`
2. 浏览器访问 `http://localhost:${APP_PORT:-80}`，确保前端界面加载，同时 `/api/users/me` 返回当前用户。
3. 打开 `/docs`、`/redoc` 验证 Swagger 与 ReDoc 文档被 proxy 到 backend。
4. 在前端点击登录并查看 `/cart-import?import=true` 是否被扩展写入 `localStorage.cart_import_batch_latest`。
5. `redis-cli -a <REDIS_PASSWORD> ping`。

## 8. 常见排障命令

```bash
# 1) 检查服务状态
docker compose ps

# 2) 后端错误追踪
docker compose logs --tail 200 backend

# 3) 前端构建/路由问题
docker compose logs --tail 200 frontend

# 4) Redis 连通性
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" ping

# 5) 本地后端健康检查
curl -i http://localhost:8000/health
```

## 9. 文档站

`wiki/` 目录是以 VitePress 组织的文档站点，运行方式：

```bash
cd wiki
npm install
npm run dev
```

浏览器访问 `http://localhost:5174` 即可查看格式化后的运维与扩展文档。

## 参考代码
- [.env.example](https://github.com/hzb666/LabStorageManager/blob/main/.env.example)
- [app/core/config.py](https://github.com/hzb666/LabStorageManager/blob/main/app/core/config.py)（行117）
- [app/database.py](https://github.com/hzb666/LabStorageManager/blob/main/app/database.py)（行791）
- [browser-extension/manifest.json](https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/manifest.json)
- [docker-compose.yml](https://github.com/hzb666/LabStorageManager/blob/main/docker-compose.yml)
- [frontend/src/App.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/App.tsx)


