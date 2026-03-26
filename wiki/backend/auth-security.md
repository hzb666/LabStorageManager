# 认证与安全

本页说明认证、会话、限流和中间件安全链如何协同工作。重点不是“有哪些接口”，而是哪些依赖负责判权、哪些组件负责失效控制，以及改动时需要同步检查什么。

## 认证入口

认证入口集中在 [app/core/auth.py](https://github.com/hzb666/LabStorageManager/blob/main/app/core/auth.py)。其中 `get_current_user` 是绝大多数数据修改接口的基础依赖，也是项目关键规则中要求必须使用的入口。

当前支持两种凭证模式：

- 浏览器交互使用 `HttpOnly` Cookie。
- 调试或脚本可以直接携带 `Authorization: Bearer ...`。

令牌解析依赖 `settings.algorithm`。生产环境必须使用 `RS256` 并加载 `.keys/private.pem` 与 `.keys/public.pem`；开发环境可以退回到 `HS256`，并在缺失密钥时生成短期 secret。

## JWT 与会话生命周期

`create_access_token` 会在 payload 中写入 `sub`、`username`、`role`、`username_version`、`type`、`iat` 和 `exp`，过期时间由 `settings.access_token_expire_minutes` 决定。`decode_token` 统一走 `jose.jwt`，任何 `JWTError` 都会转成 401。

`get_current_user` 的判定顺序比较固定：

1. 先从 `get_cached_session` 读取缓存。
2. 缓存未命中时回退数据库中的 `UserSession`。
3. 通过 `BackgroundTasks` 调度 `_update_user_activity_task`，更新 `last_active_at` 和 `last_ip_address`。

这里的约束是：会话读取不能依赖 Redis 成功与否，Redis 只影响性能和告警，而不应该成为登录态唯一来源。

当 `username_version` 与数据库不一致时，旧 token 会失效。`token_hash` 会同时作为 Redis 与 `user_sessions` 表的查找键。`logout` 会同步删除数据库记录与缓存，`login` 成功后会写入 httpOnly Cookie，并在必要时通过 `X-Redis-Status` 提示前端 Redis 状态。

## 会话管理与设备限制

[app/services/session_service.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/session_service.py) 负责会话写入、缓存同步和旧设备清理，核心逻辑包括：

- `_create_user_session` 使用 `hashlib.sha256(token)` 生成 `token_hash`。
- `device_id` 为空时会生成带 `ANONYMOUS_DEVICE_PREFIX` 的随机 ID。
- `cache_session` 在插入与更新时都会执行，TTL 与 `settings.session_expire_hours` 对齐。
- `_check_device_limit` 和 `_check_ip_limit` 分别读取 `max_device_per_user` 与 `max_ip_per_user`。
- 超限时通过 `_evict_oldest_session` 踢出最旧会话。
- `cleanup_expired_sessions` 会同步删除过期数据库行与缓存。

内存速率限制只在 Redis 不可用且非生产环境时作为后备方案启用。

## 登录限流

`/api/users/login` 在 [app/api/users.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/users.py) 中实现。入口会先执行 `cleanup_expired_sessions(db)`，失败不会阻断主流程。随后根据客户端 IP 进入限流检查：

- Redis 可用时，使用 Redis 计数。
- Redis 不可用时，开发环境回退到内存窗口。
- 生产环境在 Redis 断开时更偏向 fail-closed，直接返回 503。

登录失败会调用 `_record_failed_login(client_ip)`；登录成功后调用 `_reset_login_attempts(client_ip)`，并通过 `set_cookie` 发放 `access_token`。账号禁用、设备/IP 超限或认证失败都会返回相应的 403、429 或 400/503。

## 权限边界

| 类型 | 典型依赖 | 示例 |
| --- | --- | --- |
| 公开接口 | 无 `get_current_user` | 登录、健康检查 |
| 登录用户接口 | `Depends(get_current_user)` | 库存查询、订单查询、SSE 订阅 |
| 管理员接口 | `Depends(require_admin)` | 用户管理、公告管理、关键审批动作 |

`require_admin` 用于用户、公告、日志等敏感接口；`get_current_user` 则覆盖大多数有状态业务。修改接口权限时，不应只看路由文件，还要确认依赖链和 session 校验是否一致。

## 中间件安全链

[app/main.py](https://github.com/hzb666/LabStorageManager/blob/main/app/main.py) 中的安全中间件按顺序工作：

1. 请求日志，生成 `X-Request-ID` 并掩码化路径。
2. 上传体积限制，仅对上传路径拦截超限请求。
3. HTTPS 重定向。
4. CSRF 原点校验，对带 Cookie 的写请求检查 `Origin` / `Referer`。
5. 安全头注入。
6. CORS。

`security_headers_middleware` 会注入 CSP、X-Content-Type-Options、X-Frame-Options 和 HSTS；`upload_request_size_middleware` 会在超限时提前返回 413；静态资源走 `CachedStaticFiles`，因此统一携带缓存头与安全头。

## Redis 断路器与降级

[app/core/redis.py](https://github.com/hzb666/LabStorageManager/blob/main/app/core/redis.py) 提供全局 Redis 客户端和断路器。`get_redis()` 在错误后的冷却期内会直接返回 `None`，`cache_session`、`get_cached_session`、`delete_cached_session` 捕获 `RedisError` 后会触发断路器复位。

这套机制被认证、会话和 SSE 共同依赖，因此 Redis 崩溃后系统的行为应该是“降级但可用”，而不是把整条请求链打断。前端可以通过 `X-Redis-Status` 观察是否发生降级。

## 二次开发提醒

- 新增认证逻辑前，先确认 `settings.algorithm`、RSA key 路径和 `use_secure_runtime()` 的默认行为。
- 修改 `user_sessions` 表或相关 payload 时，要同步更新 `session_service` 和缓存结构。
- 新增 Redis key 时，务必保留统一前缀，避免与现有命名空间冲突。
- 扩展登录后置流程时，优先复用现有限流和会话服务，不要在路由里重复实现。

## 验证建议

- 删除 `.keys/*` 后启动开发环境，确认会自动生成临时密钥。
- 在生产模式下移除密钥，确认应用无法正常启动。
- 连续失败登录同一 IP，确认会触发 429；关闭 Redis 后确认开发环境可回退。
- 设定 `max_devices_per_user=1` 后连续登录，确认第二次会被拒绝。
- 从非法 `Origin` 发起 Cookie 写请求，确认会被 403 拦截。

## 参考代码

- [app/api/users.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/users.py)
- [app/core/auth.py](https://github.com/hzb666/LabStorageManager/blob/main/app/core/auth.py)
- [app/core/config.py](https://github.com/hzb666/LabStorageManager/blob/main/app/core/config.py)
- [app/services/rate_limit.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/rate_limit.py)
- [app/services/session_service.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/session_service.py)
