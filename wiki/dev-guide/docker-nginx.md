# 运维与排障

本页收拢运行期巡检、故障定位和恢复动作，作为开发指南中面向运行阶段的统一入口。

## 日常巡检

### 服务与依赖

- 访问 `/health` 确认后端整体存活。
- 使用 `redis-cli -a <REDIS_PASSWORD> ping` 确认 Redis 可用。
- 查看 `docker compose logs backend` 与 `docker compose logs frontend`，优先关注启动错误、Redis 连接失败和静态资源异常。

### 数据与文件

- 检查 `app_data/static`、`app_data/keys`、`app_data/lab_inventory.db` 是否存在且权限正常。
- 确认 `/static` 能正常返回公告图片、上传文件和模板。
- 抽查 `/cart-import?import=true`，确认前端仍能读取最新导入批次。

## 日志分库与归档操作

当前日志分库由代码直接定义：

- 主业务库路径由 `DATABASE_URL` 决定，默认指向 `lab_inventory.db`。
- 搜索查询日志库由 `app/search_query_log_db.py` 管理，默认写入 `logs/query_logs.db`。
- 业务操作日志归档脚本是 `app/archive_logs.py`，副本保存在 `dev-logs/archive_logs.py`。
- 搜索查询日志归档脚本是 `app/archive_query_logs.py`，副本保存在 `dev-logs/archive_query_logs.py`。

业务操作日志归档默认覆盖：`inventory_operation_log`、`reagent_order_operation_log`、`consumable_order_operation_log`、`common_shelf_operation_log` 和 `user_operation_log`，并同步处理这些源日志对应的 `log_timeline` 行。`borrowlog` 是借还业务数据表，不属于当前日志归档删除范围。搜索查询日志归档覆盖独立日志库中的 `search_logs` 表。两个脚本默认只处理三个月以前的数据，输出独立 SQLite 归档库，并在复制、`archive_meta` 写入和行数校验成功后删除源表中的已归档行。源库删除使用事务保护，任一删除行数不匹配都会回滚。

执行前先预览归档范围：

```bash
python -m app.archive_logs --dry-run
python -m app.archive_query_logs --dry-run
```

确认后再执行归档：

```bash
python -m app.archive_logs --output-dir logs
python -m app.archive_query_logs --output-dir logs
```

若希望归档随后端自动定期运行，在 `.env` 中设置：

```bash
ARCHIVE_SCHEDULER_ENABLED=true
ARCHIVE_INTERVAL_HOURS=24
ARCHIVE_STARTUP_DELAY_SECONDS=300
ARCHIVE_OUTPUT_DIR=/data/logs
```

调度器会先运行主业务库操作日志归档，再运行搜索查询日志归档。归档目录下的 `.archive-scheduler.lock` 用于避免多 worker 重复执行同一轮任务。

只归档指定业务日志表时使用 `--tables`：

```bash
python -m app.archive_logs --tables inventory_operation_log common_shelf_operation_log --dry-run
```

Docker 部署时需要保证主业务库、搜索日志库和归档输出目录位于可持久化位置。若调整搜索查询日志库位置，应同步更新 `app/search_query_log_db.py` 中的路径常量，并检查容器卷挂载策略。

## 常见故障

### 启动失败

- `DEFAULT_ADMIN_PASSWORD` 为空：补齐 `.env` 中的默认管理员配置。
- `RSA private key not found`：检查 `.keys` 挂载；开发环境可暂时切换 `HS256`，生产环境必须补齐 PEM。
- SQLite 被占用：确认没有多个进程同时写同一个 `lab_inventory.db`；必要时停掉相关进程后再恢复。

### Redis 与会话异常

- `NOAUTH` 或连接失败：核对 `REDIS_PASSWORD`、`REDIS_HOST`、`REDIS_PORT`。
- Redis 不可用时，登录限流和会话缓存会降级，功能可能仍可用，但吞吐和安全边界会下降。
- 如前端收到 `X-Redis-Status: unavailable`，应优先检查 Redis，而不是直接怀疑业务接口。

### 静态资源或 API 404

- `/static/*` 返回 404：先检查 `entrypoint.sh` 是否成功把 `/data/static` 链接到 `/app/static`。
- `/users/login` 返回 404：通常是前端错误绕过 `/api` 前缀，请检查 `VITE_API_URL`。
- `/docs` 路径冲突：不要把其他服务也部署在 `/docs`、`/redoc` 或 `/openapi.json`。

### 扩展导入异常

- 扩展 host 权限不匹配：检查 `manifest.json` 中的 `host_permissions`。
- 批次数据过期或未落盘：检查 `chrome.storage.local.import_batch_latest` 与页面 `localStorage.cart_import_batch_latest`。
- `batch_id` 不一致：确认扩展打开的跳转链路与当前系统地址一致。

## 快速恢复顺序

1. 检查 `/health`、Compose 状态和容器日志。
2. 检查 Redis 连通性。
3. 检查 `.keys`、`static` 和数据库文件挂载状态。
4. 扩展导入问题再补充检查扩展存储与跳转参数。

多数故障都能先用这条顺序把范围缩小到后端配置、Redis、挂载卷或扩展桥接中的一类。

## 参考代码

- [app/core/config.py](https://github.com/hzb666/LabStorageManager/blob/main/app/core/config.py)
- [app/archive_logs.py](https://github.com/hzb666/LabStorageManager/blob/main/app/archive_logs.py)
- [app/archive_query_logs.py](https://github.com/hzb666/LabStorageManager/blob/main/app/archive_query_logs.py)
- [app/search_query_log_db.py](https://github.com/hzb666/LabStorageManager/blob/main/app/search_query_log_db.py)
- [browser-extension/content/import-bridge.js](https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/content/import-bridge.js)
- [docker/backend/entrypoint.sh](https://github.com/hzb666/LabStorageManager/blob/main/docker/backend/entrypoint.sh)
- [docker/nginx/default.conf](https://github.com/hzb666/LabStorageManager/blob/main/docker/nginx/default.conf)
