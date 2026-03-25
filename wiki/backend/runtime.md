# 运行时与入口

## 入口与 FastAPI 配置

后端真正的入口是 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/main.py" />：它根据 `app.core.config.settings` 设定日志级别（`debug` 开启时 DEBUG，生产默认 WARNING），再根据 `use_secure_runtime()` 切换 `/docs`、`/redoc` 和 `/openapi.json` 的可见性。`FastAPI` 实例在创建时传入 `lifespan`、标题、版本和描述，保证启动 / 关闭期间都走同一套流程。

## Lifespan 与数据库初始化

`lifespan` 是一个 `asynccontextmanager`：启动时打印 banner、调用 `init_db()`、记录 WAL 已启用，并在关闭时关闭 `sse_manager` 的监听器，避免后台任务泄漏。`init_db()` 会先 `create_all` 注册模型，再在同一个连接上调用 `ensure_sqlite_performance_indexes`、`ensure_sqlite_inventory_fts` 以及 `check_sqlite_schema_consistency`，最后创建默认管理员，这意味着数据库结构、索引、FTS、WAL 和一致性检查都在启动阶段自动铺好。

## 配置导向

<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/core/config.py" /> 通过 `Settings` 持久化所有运行时配置：环境标记 `env`、JWT 算法默认 `RS256`，生产强制不允许 HS256；缺少 RSA key 会在显式开发模式下自动生成临时密钥并写入 `.keys/` 目录，否则会直接报错。`use_secure_runtime()` 反向决定是否打开调试、是否信任代理头、是否设置 HSTS，以及默认静态目录 `static/uploads`/`static/thumbnails` 是否先创建。

## SQLite、WAL 与索引

<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/database.py" /> 维护着连接与引擎：`connect_args={"check_same_thread": False}`，注册一个 `event.listen(engine, "connect")` 的回调，每新建连接都会执行 `PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;` 确保 SQLite 并发写入和 FK 约束。`init_db()` 调用的两个核心辅助函数 `ensure_sqlite_performance_indexes` 与 `ensure_sqlite_inventory_fts` 分别负责：

- 逐条落过 `CREATE INDEX IF NOT EXISTS`（包括 `inventory`、`order`、`user_sessions` 的复合索引）。
- 批量创建 `inventory_fts`/`reagent_order_fts`/`consumable_order_fts`/`users_fts` 虚拟表和对应 TRIGGER，并在启动时比对原表行数决定是否 rebuild。
- 在启动后执行 `ANALYZE`、`PRAGMA optimize` 以及一致性检查，找出缺失列、额外索引或不同步的 FTS 触发器。

如需重建搜索索引，可调用 `reset_db()` 跳过触发器，再由 `init_db()` 重新建表 + FTS（请谨慎，因为会清空数据）。

## Redis 缓存与断路器

<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/core/redis.py" /> 提供一个全局 Redis 客户端并实现简易断路器：`get_redis()` 在最近一次错误后的 `REDIS_COOLDOWN_SECONDS` 内直接返回 `None`，并在连接成功时 `ping()` 以验证可用性。所有键都通过 `redis_key()` 加上 `settings.redis_key_prefix` 限定命名空间。`cache_session` / `get_cached_session` / `delete_cached_session` 封装了 JSON 序列化、TTL、异常处理和断路器复位，被 `session_service`、`auth.get_current_user`、`session_service` 里的后台任务以及 `sse_redis` 的 pub/sub 复用。Redis 不可用时代码会：

- 在登录速率限制中根据 `settings.use_secure_runtime()` 决定是否返回 503（生产 fail-closed）还是退回内存记录 (`LOGIN_ATTEMPTS`)。
- 在会话验证里继续走数据库查询，但不会中断（只会在响应头写入 `X-Redis-Status: unavailable` 以提醒前端）。
- 在 SSE pub/sub 中直接跳过 `publish` / `subscribe`，自动回退到本地队列。

## SSE 与缓存边界

事件流由 `/api/events` 暴露：它先校验允许房间（`SSERoom` 枚举），再使用 `sse_manager` 生成 `client_id`、订阅房间、确保监听器启动。返回的 `StreamingResponse` 指定 `Cache-Control: no-cache`、`Connection: keep-alive`、`X-Accel-Buffering: no`，并通过 `event_generator` 在 SSE 事件之间插入 `: heartbeat` 以避免代理断开。`SSEManager` 内部维持本地队列 `asyncio.Queue`、客户端 `last_seq`、慢客户端检测与断开，同步 `redis_pubsub` 的 `publish` 与 `subscribe_patterns` 来跨进程传递事件、通过 `redis_key("sse:seq:room")` 保证全局序号。应用在 `lifespan` 结束时调用 `sse_manager.stop_listener()` 并在 `start_listener()` 中复用 `asyncio.Task`，不再允许重复启动。

## 中间件与安全链

<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/main.py" /> 的中间件顺序很关键：

- 请求日志：自动生成 `X-Request-ID`，在 `logger` 中打印掩码化路径（数字/UUID 以 `{id}` 展示）。
- 上传限制：`content-length` 超出 `settings.max_upload_request_size_mb`直接 413；只针对上传路径（例如 `/api/users/{id}/avatar`）。
- HTTPS 重定向与 CORS：在 `use_secure_runtime()` 之下 `x-forwarded-proto` 也被校验，`CORSMiddleware` 之后的 `security_headers_middleware` 会加上 CSP、XFO、Referrer-Policy、HSTS。
- CSRF 原点校验：对 Cookie 认证的写请求检查 `Origin`/`Referer` 是否落在 `settings.cors_origins`（secure runtime 下强制）。
- 静态文件：`CachedStaticFiles` 为 `/static` 下的文件统一写入 `Cache-Control: public, max-age={STATIC_CACHE_MAX_AGE_SECONDS}, immutable` 以及同样的安全头；<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/main.py" /> 会在存在 `static/` 目录时挂载。

## 二次开发提示

- 每当修改模型或搜索字段，先更新 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/database.py" /> 中的索引/FTS 逻辑并手动运行 `init_db()` 验证（触发器的 `TRUNCATE` 会先清空，再 `INSERT INTO ... SELECT`）。  
- 新增配置项必须同步写入 `Settings`，并在 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/.env.example" />（如果有）以及 `use_secure_runtime()` 的判断中标明其在生产环境的默认值（例如 JWT 密钥、Redis 连接、上传限速）。  
- Redis 在不可用时会失效，因此需保证会话/速率限制的回退逻辑仍能运行；你可以通过访问 `X-Redis-Status` 响应头判断是否触发了降级。  
- 修改 SSE 事件（新增房间、模板、序列）时也要更新 `ALLOWED_SSE_ROOMS`、`SSERoom` 枚举，以及确保 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/main.py" /> lifespan 仍然在关闭时 `await sse_manager.stop_listener()`。  
- 静态缓存配置集中在常量 `STATIC_CACHE_MAX_AGE_SECONDS`，调整时也要同步更新 CDN 规则与前端 `Cache-Control` 策略。

## 补充：lifespan、执行链与验证

- 启停顺序：`lifespan` 在启动执行 `init_db()` 并启动 SSE 监听，关闭阶段会 `stop_listener`，防止后台任务悬挂（<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/main.py#L168-L184" />）。
- 中间件链路（外到内）：请求日志 → 上传体积拦截（仅上传路径，超限 413）→ HTTPS 重定向 → CSRF 源检查（Cookie 写请求）→ 安全头 → CORS → 路由（<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/main.py#L191-L352" />）。
- 静态资源：`CachedStaticFiles` 对 `/static` 加 immutable 缓存与安全头，上传/缩略图目录缺失会在启动时自动创建（<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/main.py#L150-L352" />）。

### 边界与风险
- `use_secure_runtime()` 为生产默认：隐藏文档、强制 HSTS/HTTPS、启用 CSRF 校验，新增跨域前端需同步 `cors_origins`。
- 上传限额依赖 `_is_upload_request` 路径匹配，新增上传接口需同步列表，否则可能绕过体积限制。
- 关闭 SSE 监听缺失会导致事件任务泄漏；修改 lifespan 时需保留 `stop_listener()` 调用。

### 验证建议
- 本地启动：访问 `/health` 200；手工请求 `/api/events` 应持续心跳（`: heartbeat`）。
- 上传超限：向 `/api/users/{id}/avatar` 发送超 `max_upload_request_size_mb` 的 body，应返回 413。
- 安全模式：设 `ENV=production` 后 `/docs`/`/openapi.json` 不可访问，HTTP 请求被 307 重定向到 HTTPS（reverse proxy 场景）。

## 参考代码
- [.env.example](https://github.com/hzb666/LabStorageManager/blob/main/.env.example)
- [app/core/config.py](https://github.com/hzb666/LabStorageManager/blob/main/app/core/config.py)
- [app/core/redis.py](https://github.com/hzb666/LabStorageManager/blob/main/app/core/redis.py)
- [app/database.py](https://github.com/hzb666/LabStorageManager/blob/main/app/database.py)
- [app/main.py](https://github.com/hzb666/LabStorageManager/blob/main/app/main.py)（行150，168，191）


