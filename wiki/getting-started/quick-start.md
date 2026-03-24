# 快速开始

## 1. 后端准备

推荐使用 Python 3.11+，安装依赖后启动 FastAPI：

```bash
poetry install
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## 2. 前端准备

```bash
cd frontend
npm install
npm run dev
```

## 3. Docker 方式

如果你更偏向直接跑整套服务，可以使用 Compose：

```bash
docker compose up --build
```

这会启动：

- `redis`
- `backend`
- `frontend`

## 4. wiki 本身

本次新增的 VitePress 文档站放在根目录 `wiki/`，与现有开发记录 `docs/` 分离。推荐命令：

```bash
cd wiki
npm install
npm run dev
```

## 5. 运行后先验证什么

1. 能否访问前端主页
2. 后端 `/health` 是否正常
3. 登录是否可用
4. 主要业务页路由是否可达
5. 如果需要扩展联调，再检查 `/cart-import`

## 参考代码

- `README.md:1`
- `docker-compose.yml:22`
- `docker/frontend/Dockerfile:1`
- `docker/backend/Dockerfile:1`
