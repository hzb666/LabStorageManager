# 问题排查

## 启动失败

- **默认管理员未配置**：`DEFAULT_ADMIN_PASSWORD` 为空会导致 FastAPI 在首次启动时抛出配置错误。检查 `.env` 中是否填好值，必要时设置 `DEFAULT_ADMIN_USERNAME`/`DEFAULT_ADMIN_FULL_NAME`。
- **JWT 密钥错误**：`ALGORITHM=RS256` 时必须有 `.keys/private.pem` 与 `.keys/public.pem`，否则 `app.core.config.Settings.get_private_key` 会抛出异常。使用 Docker 时请确认宿主 `app_data/keys` 无误，非容器环境可以临时设 `ALGORITHM=HS256` 并设置 `SECRET_KEY`，但上线前一定补上 PEM 文件。
- **数据库锁**：SQLite 使用 WAL 模式，`lab_inventory.db` 可能被其他进程占用。确保没有多个进程同时写入 DB，必要时停掉所有容器后删除 `lab_inventory.db-wal`/`.shm` 再重启。

## Redis 与会话异常

- **连接失败**：`REDIS_PASSWORD` 必须匹配 `redis` 容器命令行里写明的密码。可在宿主执行 `docker compose exec redis redis-cli -a <密码> ping` 测试；若出现 `NOAUTH`，说明密码错。
- **登录限流失效**：若 Redis 不可用，会自动退回数据库模式，但登录限流/设备管理功能会失去缓存。检查 backend 日志确认 `Redis client fallback to local storage` 消息。

## 静态资源与 API 404

- `nginx` 的 `location /api/static/`、`/static/` 与 `/` 都代理到后端或前端，若某条路径返回 404，先检查 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/docker/backend/entrypoint.sh" /> 是否成功链接 `/data/static`；如果目录不存在，上传的图片会无效。
- 当前所有 API 前缀是 `/api`，例如登录是 `/api/users/login`。前端若直接访问 `/users/login` 会被 Nginx 处理为静态请求并返回 404，请确认 `VITE_API_URL` 与后端匹配。

## 浏览器扩展 / 购物车导入

- **主机权限不足**：Chrome 扩展 manifest 限定只对 `https://reagent.bjmu.edu.cn/*` 和 `http://localhost:5173/*` 有权限，如果你用的是别名或 https，需更新 `host_permissions` 并重新加载扩展。
- **桥接脚本未生效**：<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/content/import-bridge.js" /> 仅在 `cart-import?import=true` 页面运行，且依赖 `chrome.storage.local.import_batch_latest` 中的数据，数据超过 2 小时 TTL 会被清除。确保 popup 爬取后的批次 ID 被写入 storage，并通过 `postMessage` 发给当前页面，CartImport 页面监听该消息并尝试从 `localStorage.cart_import_batch_latest` 加载。
- **批次 ID 不匹配**：前端页面会检测 URL 上的 `batch_id` 参数与 localStorage 的批次 ID 是否相同，如果不一致会重定向回 `/reagents` 并提示错误，确认浏览器插件打开的跳转链路正确（`chrome.tabs.create({url: `${systemUrl}/cart-import?import=true&batch_id=${batchId}`})`）。
- **扩展无法访问 `cart-import`**：确保 `chrome.storage.local` 中的 `import_batch_latest` 正确序列化并包含 `created_at`，`LocalStorage` TTL 由 `import-bridge` 负责清理，失效后需在扩展中重新 `saveImportBatch`。

## `/docs` 路径冲突

- 由于 `/docs`、`/redoc`、`/openapi.json` 都由 Nginx 代理到 FastAPI 内部文档，不能把其他服务也部署到 `/docs`。如需自建 wiki，请使用 `/manual`、`/help` 等不会冲突的路径或独立域名。

## 参考代码
- [app/core/config.py](https://github.com/hzb666/LabStorageManager/blob/main/app/core/config.py)
- [browser-extension/content/import-bridge.js](https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/content/import-bridge.js)
- [docker/backend/entrypoint.sh](https://github.com/hzb666/LabStorageManager/blob/main/docker/backend/entrypoint.sh)
- [docker/nginx/default.conf](https://github.com/hzb666/LabStorageManager/blob/main/docker/nginx/default.conf)


