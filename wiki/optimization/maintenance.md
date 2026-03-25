# 日常维护

## 关键资源

- **服务健康**：`/health` 由 backend 提供，是判断整体 stack 健康的首选入口。
- **Redis 与会话缓存**：确认 `redis-cli -h <host> -p <port> -a <password> ping` 返回 `PONG`；若 Redis 不可用，系统会降级到数据库模式，但登录限流/会话缓存会失去保障。
- **静态目录**：后端 entrypoint 将 `/data/static` 链接为 `/app/static`，浏览器扩展、公告、上传的图片都落在这里，确保挂载卷可写且定期备份。
- **JWT 密钥**：生产环境 RS256 要求 `.keys/private.pem` 和 `.keys/public.pem` 同步，entrypoint 会在空目录下自动生成；确认 `/data/keys` 持久卷不会被覆盖。
- **扩展导入桥**：`/cart-import` 页面通过 `localStorage` 读取 `cart_import_batch_latest`，并监听来自扩展的 `IMPORT_BATCH_READY` 消息，保证浏览器扩展与前端解耦仍能互通。

## 推荐巡检清单（每日/每次部署后）

1. `curl http://localhost:${APP_PORT:-80}/health`（若有反向代理，记得调整 host）。
2. `redis-cli -a <REDIS_PASSWORD> ping`。
3. 检查 `app_data/static`、`app_data/keys`、`app_data/lab_inventory.db` 是否在数据卷中存在且权限正常。
4. 确认前端静态资源通过 `nginx` 被正确响应（`curl http://<host>/`）。
5. 浏览器访问 `/cart-import?import=true` 并观察 `localStorage` 中的 `cart_import_batch_latest` 是否在 2 小时 TTL 内存活。
6. 查看后台日志 `docker compose logs backend`、`frontend` 查找异常。

## 发生异常时的快速操作

- 如果 `/health` 返回 500，先排查 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/tree/main/logs" /> 或 stdout 是否报错配置项缺失、数据库不可达或 JWT key 缺失。
- 后端无法启动且日志提示 `RSA private key not found`：确认 `.keys` 是否被挂载，或在 `.env` 中临时设置 `ALGORITHM=HS256`（开发用）以跳过 RSA，真正线上务必补齐 PEM 文件。
- Redis 连不上：检查 `REDIS_HOST`、`REDIS_PORT`、`REDIS_PASSWORD` 是否与 Compose 中一致（Redis 容器内部加密），必要时在宿主执行 `docker compose exec redis redis-cli -a <password> ping`。
- 上传或公告图片失效：确认 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/content/import-bridge.js" /> 写入前端 `localStorage` 的数据已经由 backend 的 `/static/` 正常代理，目录权限可写。
- 购物车导入异常：重启浏览器扩展，打开试剂平台的购物车页，确保 popup 能找到 `page=gwc` 的标签页并且 `chrome.storage.local` 存储了批次数据（插件 TTL 2 小时）。

## 参考代码
- [app/core/config.py](https://github.com/hzb666/LabStorageManager/blob/main/app/core/config.py)
- [browser-extension/content/import-bridge.js](https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/content/import-bridge.js)
- [docker/backend/entrypoint.sh](https://github.com/hzb666/LabStorageManager/blob/main/docker/backend/entrypoint.sh)


