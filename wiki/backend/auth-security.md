# 认证与安全

## 认证矩阵

认证入口发生在 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/core/auth.py" />：`get_current_user` 是所有数据修改接口的基础依赖（项目关键规则 #3）。它支持两套凭证模式——浏览器交互使用 `HttpOnly` Cookie，调试或脚本可直接带 `Authorization: Bearer …`。解码逻辑依赖 `settings.algorithm`；生产环境必须使用 `RS256` 并从 `.keys/private.pem`/`.keys/public.pem` 加载密钥，开发模式可以回退到 `HS256` 并自动生成短期 secret。

## JWT 与会话生命周期

`create_access_token` 在 `payload` 中包含 `sub`/`username`/`role`/`username_version`/`type`/`iat`/`exp`，过期时间由 `settings.access_token_expire_minutes` 决定。`decode_token` 统一走 `jose.jwt`，遇到任何 `JWTError` 会抛出 401。`get_current_user` 先从缓存 `get_cached_session` 尝试读取 `expires_at`，再落到数据库查 `UserSession`；同时它还会发起 `BackgroundTasks` 执行 `_update_user_activity_task`（带 `ACTIVITY_DEBOUNCE_SECONDS` 防抖）以更新 `last_active_at` 与 `last_ip_address`，避免频繁写入数据库。

当 `username_version` 在数据库中不一致时，token 会失效（常用于管理员通过`username_version` 强制所有旧会话失效），`token_hash` 会在 Redis 与 `user_sessions` 表中作为查找 key。`logout` 端点会同时删除数据库记录与 `delete_cached_session`，`login` 成功后会设置 httpOnly Cookie（TTL 与 `settings.session_expire_hours` 保持一致）并在响应头写入 `X-Redis-Status: unavailable` 提醒前端 Redis 异常。

## 会话管理与设备限制

<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/session_service.py" /> 将会话写入 `user_sessions` 表并同步缓存，核心逻辑包括：

- `_create_user_session` 以 `hashlib.sha256(token)` 作为 `token_hash`，支持在 `device_id` 为空时生成带 `ANONYMOUS_DEVICE_PREFIX` 的随机 ID；无论是 update 还是 insert 都会调用 `cache_session`，TTL 为 `settings.session_expire_hours * SECONDS_PER_HOUR`。  
- `_check_device_limit`/`_check_ip_limit` 读取 `max_device_per_user` 与 `max_ip_per_user`，如果违背则通过 `_evict_oldest_session` 踢出历史会话。  
- `cleanup_expired_sessions` 会定期删除过期行并同步 `delete_cached_sessions`。  
- 内存速率限制使用 `LOGIN_ATTEMPTS` 字典 + `_login_attempts_lock`，仅在 Redis 不可用且非生产环境下启用。

## 登录限流

`/api/users/login` 入口在 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/users.py" />：  

- 启动环节先调用 `cleanup_expired_sessions(db)`（失败不会中断主流程）。  
- 通过 `_check_rate_limit(client_ip)` 检查当前 IP 的 Redis 计数，生产环境 Redis 连接断开时直接返回 503，开发环境则退回 `_check_rate_limit_memory`。  
- 登录失败时调用 `_record_failed_login(client_ip)`；Redis 成功则 `INCR + EXPIRE`，后备逻辑则用 `LOGIN_ATTEMPTS`。  
- 登录成功后调用 `_reset_login_attempts(client_ip)`（跳过 Redis `DEL`，直接让 TTL 自然过期）。  
- 返回 `JSONResponse`，并在需要时写入 `X-Redis-Status`，最后通过 `set_cookie` 发放 `access_token`。

请求失败、账号禁用或设备/IP 超限都会抛出 403/429，登录成功后会记录审计日志并在 `session_service` 中写入新会话。

## JWT 与会话补充：运行模式、设备、Cookie

- 运行模式：生产强制 RS256，缺失 RSA key 会直接启动失败；开发模式若找不到密钥会在 `.keys/` 下生成临时 key（<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/core/config.py#L38-L125" />）。
- 设备与 IP 上限：`max_devices_per_user`、`max_ip_per_user` 在登录时判定，超限返回 400/429，并提示清理旧会话（<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/users.py#L283-L310" />）。
- Cookie 下发：`use_secure_runtime()` 为 true 时开启 Secure+HttpOnly，SameSite 依运行模式设置（<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/users.py#L331-L347" />）。
- username_version：在 `get_current_user` 校验，用户名/重置后旧 token 自动失效（<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/core/auth.py#L219-L340" />）。
- require_admin：管理员专用依赖，用于用户/公告/日志等敏感接口（<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/core/auth.py#L340-L367" />）。

## 边界与风险

- RSA 临时密钥切勿带到生产镜像；上线前必须提供正式密钥并清理 `.keys/` 目录。
- 新前端域名若未加入 `cors_origins`，Cookie 写请求会被 CSRF 中间件拒绝（403）。
- Redis 断路器触发时，限流和会话降级到数据库/内存，功能可用但性能下降；注意通过响应头 `X-Redis-Status` 观测。

## 验证建议

- 本地开发：删除 `.keys/*` 后启动，应自动生成临时密钥；生产模式下应因缺失密钥启动失败。
- 速率限制：同 IP 连续失败应触发 429；关闭 Redis 后仍应在内存窗口被限流。
- 设备上限：设 `max_devices_per_user=1`，连续两次登录应被第二次拒绝。
- CSRF：生产模式从非同源 Origin 发起写请求应 403；Bearer 模式（无 Cookie）不受 CSRF 影响。

## Redis 断路器与缓存策略

`get_redis()` 保证在上一次 `redis.Connect` 抛错之后会有一个 `REDIS_COOLDOWN_SECONDS` 的“冷却时间”，期间直接返回 `None`；`cache_session`、`get_cached_session`、`delete_cached_session` 会在捕获 `RedisError` 时调用 `_handle_redis_error` 让断路器生效。`auth.get_current_user`、`session_service`、`sse_redis`、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/users.py" /> 的速率限流都依赖这套机制，因此即便 Redis 崩了，服务也会优雅退回数据库/内存，前端则透过 `X-Redis-Status` 观察告警。

## 中间件安全链

每个写操作（POST/PUT/PATCH/DELETE）在 secure runtime 下都需通过 `csrf_origin_check_middleware`：如果请求携带 `access_token` Cookie，就必须在 `Origin` 或 `Referer` 中存在 `settings.cors_origins` 之一，否则返回 403。`security_headers_middleware` 始终为响应注入 CSP/X-Content-Type/X-Frame/Strict-Transport-Security（仅在 `use_secure_runtime()` 下），上传路径在 `upload_request_size_middleware` 除了检查 `content-length` 之外还会提前返回 413 并添加安全头，静态资源走的是 `CachedStaticFiles`，因此所有 HTTP 异常都能统一看到同样的安全头。

## 二次开发提醒

- 新增认证逻辑前，先确认 `settings.algorithm`、RSA key 路径、`use_secure_runtime()` 是否需要调整，并确保 `.keys/` 目录存在。  
- 修改 `user_sessions` 表或新增字段，要同时更新 `session_service`、`cache_session` / `get_cached_session` 的 payload，确保 TTL 与 `session_expire_hours` 对齐。  
- 如果新增会话依赖的 redis key（例如用不同前缀区分设备），务必在 `redis_key` 里加统一前缀，并同步更新 `redis_pubsub` 所用的 `REDIS_KEY_PREFIX`。  
- 扩展登录短信/验证码等流程时，挂靠在 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/rate_limit.py" /> 的 `enforce_rate_limit` 能给你默认的“Redis 优先，内存后备”守护。  

## 权限边界速查

| 类型 | 典型依赖 | 示例 |
| --- | --- | --- |
| 公开接口 | 无 `get_current_user` | 登录、健康检查 |
| 登录用户接口 | `Depends(get_current_user)` | 库存查询、订单查询、SSE 订阅 |
| 管理员接口 | `Depends(require_admin)` | 用户管理、公告管理、关键审批动作 |

## 安全回归测试建议

- 密钥模式切换：分别验证 `RS256`（生产）和 `HS256`（开发）可启动且 token 可解码。
- 会话失效：修改 `username_version` 后，旧 token 立即失效。
- Redis 降级：断开 Redis 后，登录限流和会话读取行为符合预期（生产更严格，开发可降级）。
- CSRF 校验：携带 Cookie 的跨域写请求在非法 `Origin/Referer` 下被拒绝。

## 参考代码
- [app/api/users.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/users.py)（行283，331）
- [app/core/auth.py](https://github.com/hzb666/LabStorageManager/blob/main/app/core/auth.py)（行219，340）
- [app/core/config.py](https://github.com/hzb666/LabStorageManager/blob/main/app/core/config.py)（行38）
- [app/services/rate_limit.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/rate_limit.py)
- [app/services/session_service.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/session_service.py)


