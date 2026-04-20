# 快速开始

## 前置环境

- Python 3.11+、Node.js 20+、npm 10+。
- 可选 Redis 6+，用于登录限流和会话缓存。
- 需要 Git 和 Docker，若使用 Compose 还要保证镜像可拉取、依赖可安装。

## 克隆与环境变量

```bash
git clone https://github.com/hzb666/LabStorageManager.git
cd LabStorageManager
```

以 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/.env.example" /> 为模板准备本地运行配置，至少确认这些配置项：

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
- `REDIS_HOST`
- `ALGORITHM`
- `PRIVATE_KEY_PATH`
- `PUBLIC_KEY_PATH`

Redis 仅监听本机或 Compose 内网时，`REDIS_PASSWORD` 可以留空。

本地 `.env.example` 默认使用 `sqlite:///./lab_inventory.db` 和 `logs`。Docker Compose 会覆盖为 `/data/lab_inventory.db` 和 `/data/logs`，上传资源目录对应 `/data/static`，外部访问路径是 `/static/`。

## 启动后端

```bash
poetry install
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

- 开发模式下可访问 `http://localhost:8000/docs`、`/redoc` 和 `/health`；安全运行模式下默认只保留业务接口和健康检查。

## 启动前端

```bash
cd frontend
npm install
npm run dev
```

- 开发模式默认监听 5173。
- 前端 API 基址通常由 `VITE_API_URL` 指向 `http://localhost:8000/api`。
- 生产构建使用 `npm run build`。
- 浏览器插件构建使用 `npm run build:extension`，该命令会根据插件运行配置生成 `manifest.json` 和 `shared/generated-config.js`。

## Docker Compose 运行整套服务

```bash
APP_PORT=80 docker compose up -d --build
```

- `backend`、`frontend` 和 `redis` 会一起启动。
- Compose 持久化 volume 需要可写，用于 `/data/lab_inventory.db`、`/data/logs`、`/data/static` 和 `/data/keys`。
- 可用 `docker compose logs backend` 和 `docker compose logs frontend` 查看日志。

## 首次启动的自动初始化

- 后端 `lifespan` 会调用 `init_db()`，完成建表、索引、FTS 和默认管理员初始化。
- SQLite 连接会强制使用 WAL 和外键约束。
- 开发模式下若缺少 RSA key，配置层会尝试生成临时密钥；生产模式仍应显式提供密钥文件。
- 前端首次加载会恢复登录态，并初始化路由守卫和全局 UI 容器。

## 核心验证

1. `curl http://localhost:${APP_PORT:-80}/health`
2. 浏览器访问 `http://localhost:${APP_PORT:-80}`，确认前端能正常加载。
3. 登录后检查 `/api/users/me`。
4. 打开 `/docs` 和 `/redoc`，确认文档入口可用。
5. 检查 `/cart-import?import=true` 是否能被浏览器插件桥接。
6. 检查 `/static/` 下的上传图片或模板资源能否正常访问。
7. Redis 无密码时执行 `redis-cli ping`；有密码时执行 `redis-cli -a <REDIS_PASSWORD> ping`

## 常见排障命令

```bash
docker compose ps
docker compose logs --tail 200 backend
docker compose logs --tail 200 frontend
docker compose exec redis redis-cli ping
curl -i http://localhost:8000/health
```

## 文档站

`wiki/` 是 VitePress 文档站源码，启动方式如下：

```bash
cd wiki
npm install
npm run dev
```

浏览器访问 `http://localhost:5174` 即可查看文档站。

## 参考代码
- [app/core/config.py](https://github.com/hzb666/LabStorageManager/blob/main/app/core/config.py)
- [app/database.py](https://github.com/hzb666/LabStorageManager/blob/main/app/database.py)
- [browser-extension/build-config.mjs](https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/build-config.mjs)
- [docker-compose.yml](https://github.com/hzb666/LabStorageManager/blob/main/docker-compose.yml)
- [frontend/src/App.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/App.tsx)
