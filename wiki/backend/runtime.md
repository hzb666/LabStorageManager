# 运行时与入口

本页说明后端启动时如何把配置、数据库、Redis、SSE 和安全中间件串起来。它不是业务文档，重点是运行边界、初始化顺序和修改时的联动关系。

## 入口与配置

后端入口是 [app/main.py](https://github.com/hzb666/LabStorageManager/blob/main/app/main.py)。应用启动时会先读取 `app.core.config.settings`，再根据 `use_secure_runtime()` 决定日志级别、文档是否开放，以及是否启用更严格的安全行为。`FastAPI` 实例在创建时统一注入 `lifespan`、标题、版本和描述，保证启动与关闭阶段走同一条路径。

[`app/core/config.py`](https://github.com/hzb666/LabStorageManager/blob/main/app/core/config.py) 负责运行时配置的集中管理。当前约束是：

- 生产环境默认使用 `RS256`，并要求 RSA 私钥和公钥可用。
- 开发环境允许自动生成临时密钥。
- `use_secure_runtime()` 会影响调试开关、代理头信任、HSTS 和安全响应头。

## 启动初始化

`lifespan` 是 `asynccontextmanager`。启动阶段会初始化异步文件日志、清理过期导入预览、执行 `init_db()`、初始化搜索查询日志库、按配置重建结构索引、启动搜索日志写入线程和日志归档调度器；关闭阶段会停止归档调度器、搜索日志线程、异步文件日志和 `sse_manager` 监听器，避免后台任务残留。

`init_db()` 的顺序不能打乱：

1. `SQLModel.metadata.create_all(engine)` 注册模型。
2. `schema_upgrades.py` 补齐兼容字段和启动期回填。
3. `ensure_sqlite_performance_indexes` 创建性能索引并刷新统计信息。
4. `log_timeline_consistency` 维护日志时间线删除触发器并清理孤儿行。
5. `ensure_sqlite_inventory_fts` 建立 FTS 表与触发器。
6. `check_sqlite_fts_consistency` 和 `check_sqlite_schema_consistency` 校验全文检索、表结构与索引一致性。
7. 创建默认管理员。

这意味着数据库结构、索引、全文检索和基础账号都属于启动期职责，而不是事后补齐的运维动作。

搜索查询日志使用独立 SQLite 文件，不写入主业务库。启动阶段由 `init_query_log_db()` 创建 `search_logs` 表和索引，再由 `start_search_query_log_worker()` 启动低优先级写入线程。列表页搜索会先进入内存缓冲，达到批量阈值或等待时间后写入独立库；关闭时会先 flush 待写入队列。

## SQLite 与 WAL

[app/database.py](https://github.com/hzb666/LabStorageManager/blob/main/app/database.py) 维护 SQLite 引擎和连接行为。每次新建连接都会通过 `event.listen` 执行：

- `PRAGMA journal_mode=WAL;`
- `PRAGMA foreign_keys=ON;`

这里的约束很明确：

- WAL 是并发写入的基础，不应去掉。
- 外键约束必须始终开启，否则模型关系会失真。

`app/db_bootstrap/sqlite_indexes.py` 负责创建复合索引，覆盖库存、订单、借还日志、操作日志、日志时间线和会话等高频查询路径。`app/db_bootstrap/sqlite_fts.py` 负责 `inventory_fts`、`reagent_order_fts`、`consumable_order_fts`、`users_fts`、`chemical_name_map_fts`、`log_timeline_fts` 以及对应触发器的创建、重建和一致性检查。启动阶段还会执行 `ANALYZE`、`PRAGMA optimize`。

如果需要重建搜索索引，`reset_db()` 可以跳过触发器后重新初始化，但它会清空数据，必须谨慎使用。

## Redis 与断路器

[app/core/redis.py](https://github.com/hzb666/LabStorageManager/blob/main/app/core/redis.py) 提供全局 Redis 客户端和简易断路器。`get_redis()` 在最近一次错误后的冷却期内会直接返回 `None`，连接成功时会先 `ping()` 以确认可用性。所有键都通过 `redis_key()` 加上 `settings.redis_key_prefix`，避免命名空间冲突。

Redis 相关封装主要承担三件事：

- `cache_session` / `get_cached_session` / `delete_cached_session` 处理会话缓存、TTL 和异常复位。
- `session_service` 和 `auth.get_current_user` 复用会话缓存与数据库回退。
- `sse_redis` 负责 pub/sub，在 Redis 不可用时会自动退回本地队列。

降级策略也已经固定：

- 登录限流在安全运行时更偏向 fail-closed，开发环境可回退到内存窗口。
- 会话校验继续走数据库，不因为 Redis 故障直接中断。
- SSE 在 Redis 不可用时只保留单进程内可见的广播。

## 列表缓存与 `/static/`

运行时还维护两类轻量缓存：

- `api_utils.py` 中的短 TTL 内存缓存，用于高频列表请求削峰。
- `CachedStaticFiles` 挂载 `/static/`，为上传图片、模板和导出文件写入长期缓存头。

前者只适合短时间重复查询，写操作后必须清理对应缓存前缀。后者只负责静态传输，不承担权限判断或业务状态缓存。

## 日志分库与归档

日志存储分为三类：

- 业务操作日志仍在主业务库中，包括库存、试剂订单、耗材订单、常用货架和用户操作日志。
- 搜索查询日志写入独立 SQLite 文件，由 `app/search_query_log_db.py` 管理。
- 请求、审计和错误日志写入运行期日志文件，由 `app/services/log_queue.py` 统一配置异步文件写入。

归档脚本负责把三个月以前的历史日志复制到独立归档库，并在复制校验成功后从源库删除。`app/archive_logs.py` 处理主业务库中的操作日志表、常用货架日志及对应 `log_timeline` 行，`app/archive_query_logs.py` 处理搜索查询日志库中的 `search_logs` 表。`borrowlog` 是借还业务数据表，不属于当前日志归档删除范围。两个脚本都支持 `--dry-run`、`--tables` 和 `--output-dir`，归档库内会写入 `archive_meta` 记录批次、源库、目标库、截止时间和归档行数。删除阶段必须在归档库提交成功后才会开始，并且源库删除运行在同一个事务中；任一表删除行数和归档行数不一致都会回滚源库删除。

如果不希望额外配置 cron，可以通过 `ARCHIVE_SCHEDULER_ENABLED=true` 启用后端内置归档调度。调度器在 `lifespan` 启动阶段挂载，支持三种模式：设置 `ARCHIVE_RUN_AT_TIME` 时按服务器本地系统时间每天执行；同时设置 `ARCHIVE_RUN_WEEKDAY` 时每周指定星期执行；未设置固定时间时按 `ARCHIVE_STARTUP_DELAY_SECONDS` 和 `ARCHIVE_INTERVAL_HOURS` 周期执行。调度锁用于避免多 worker 重复运行。归档失败只记录日志，不中断后端启动或请求处理。

## SSE 与中间件

`/api/events` 暴露统一 SSE 入口。请求会先校验允许房间，再由 `sse_manager` 生成客户端、订阅房间并启动监听。返回的 `StreamingResponse` 会设置 `Cache-Control: no-cache`、`Connection: keep-alive`、`X-Accel-Buffering: no`，并通过 heartbeat 防止代理层把连接视为闲置。

`app/main.py` 的中间件顺序也有明确边界：

1. 请求日志，生成 `X-Request-ID` 并掩码化路径。
2. 上传体积拦截，只对上传路径做 `content-length` 限制。
3. HTTPS 重定向。
4. CSRF 原点检查，对 Cookie 认证写请求校验 `Origin` / `Referer`。
5. 安全头注入。
6. CORS。
7. 路由。

上传资源由 `CachedStaticFiles` 挂载在 `/static/`，并会统一携带缓存头与安全头。运行目录是 `static/`；Docker Compose 中对应 `/data/static`。上传目录和缩略图目录缺失时，配置层会自动创建。

## 二次开发提示

- 修改模型或搜索字段时，先同步更新 `app/db_bootstrap/` 中的 schema、索引和 FTS 初始化逻辑，再运行初始化流程核对结果。
- 新增配置项时，需要同步写入 `Settings`，并确认它在 `use_secure_runtime()` 下的默认行为。
- 修改 SSE 房间、模板或序号逻辑时，要同时更新 `ALLOWED_SSE_ROOMS`、`SSERoom`、`sse_manager` 和关闭阶段的清理逻辑。
- 新增上传接口时，要确认它被 `_is_upload_request` 覆盖，否则可能绕过体积限制。

## 验证建议

- 启动后访问 `/health`，确认应用能正常完成初始化。
- 手工请求 `/api/events`，确认能持续收到 heartbeat。
- 发送超限上传请求，确认返回 413。
- 在安全运行时访问 `/docs`、`/openapi.json`，确认可见性符合预期。

## 参考代码

- [app/core/config.py](https://github.com/hzb666/LabStorageManager/blob/main/app/core/config.py)
- [app/core/redis.py](https://github.com/hzb666/LabStorageManager/blob/main/app/core/redis.py)
- [app/db_bootstrap](https://github.com/hzb666/LabStorageManager/tree/main/app/db_bootstrap)
- [app/database.py](https://github.com/hzb666/LabStorageManager/blob/main/app/database.py)
- [app/main.py](https://github.com/hzb666/LabStorageManager/blob/main/app/main.py)
- [app/search_query_log_db.py](https://github.com/hzb666/LabStorageManager/blob/main/app/search_query_log_db.py)
- [app/archive_logs.py](https://github.com/hzb666/LabStorageManager/blob/main/app/archive_logs.py)
- [app/archive_query_logs.py](https://github.com/hzb666/LabStorageManager/blob/main/app/archive_query_logs.py)
