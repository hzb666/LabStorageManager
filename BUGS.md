# BUGS

## 2026-03-19 “踢出其他设备”会把当前页面一并登出

- 现象: 在个人账户页点击“踢出其他设备”后，其他设备会被下线，但当前页面也会立即跳回登录页，表现上像是把自己也踢掉了
- 根因: `frontend/src/pages/DeviceManagement.tsx` 的 `handleKickAllDevices` 在后端删除成功后仍然主动调用了 `logout()`；后端接口本意是“保留当前会话，仅删除其他会话”，前端却把当前 cookie 会话清掉了
- 处理方式: 移除成功分支里的主动登出逻辑，仅刷新会话列表并提示“已踢出所有其他设备”
- 预防: 前端处理“远端会话清理”类接口时，先核对接口语义是否保留当前会话；如果后端已承诺排除当前会话，前端不得再额外执行本地登出

## 2026-03-18 设备管理“踢出其他设备”500

- 现象: 点击“踢出其他设备”触发 `DELETE /api/users/me/sessions/`，返回 `500 Internal Server Error`
- 根因: `app/api/user_sessions.py` 的 `delete_all_sessions` 把 `get_current_session` 的返回值当成 `UserSession` 使用；实际返回是 `(User, UserSession)` 元组，访问 `current_session.token_hash` 时触发 `AttributeError: 'tuple' object has no attribute 'token_hash'`
- 处理方式: 将依赖类型改为 `tuple[User, UserSession]`，并在函数内正确解包后再使用 `token_hash` 排除当前会话
- 预防: 对依赖返回类型与注解保持一致，涉及 `get_current_session` 的接口统一按 tuple 解包处理，避免同类属性访问错误

## 2026-03-18 Reagent Order 列表 500

- 现象: `GET /api/reagent-orders/` 在读取订单列表时抛出 `LookupError: 'pending' is not among the defined enum values`
- 根因: `reagentorder.status` 存在历史遗留的小写枚举值（如 `pending`），而当前 SQLAlchemy 默认按枚举成员名读取（如 `PENDING`），导致 ORM 反序列化失败
- 处理方式: 提供手动脚本 `scripts/normalize_legacy_enums.py`，需要时手动执行，将旧的 `enum.value` 存储统一转成当前使用的 `enum.name`
- 预防: 继续保持数据库中的枚举字段统一使用成员名存储；新增或迁移枚举字段时同步考虑历史数据兼容，并在发布时评估是否需要运行手动归一化脚本

## 2026-03-19 SQLite 3.7 环境下列表接口 500

- 现象: `GET /api/consumable-orders/` 在服务器上抛出 `sqlite3.OperationalError: near "NULLS": syntax error`
- 根因: 列表排序使用了 SQLAlchemy 的 `.nulls_last()`，会生成 `ORDER BY ... NULLS LAST`；该语法要求 SQLite >= 3.30.0，而服务器实际版本是 `3.7.17`
- 处理方式: 在 `app/services/sql_utils.py` 增加兼容旧版 SQLite 的排序辅助函数，统一改为先按 `field IS NULL`，再按字段本身排序，实现等价的 `NULLS LAST`
- 预防: 以后新增 SQL 排序逻辑时，不要直接依赖较新的 SQLite 语法；部署到老环境前优先检查 `sqlite3.sqlite_version`

## 2026-03-19 订单页搜索字段与实际 selector 配置不一致

- 现象: 耗材订购页和仪表盘-我的耗材订单页的搜索 selector 与页面实际搜索语义不一致；耗材订购页甚至显示成了库存页默认字段
- 根因: `frontend/src/pages/ConsumableOrders.tsx` 定义了专用搜索字段但没有传给 `FilterTable`；仪表盘耗材订单页复用了试剂订单搜索字段配置，导致出现 `CAS号`、`品牌` 等无效选项
- 处理方式: 将耗材订购页显式绑定专用 `searchFieldOptions`；为仪表盘试剂/耗材订单拆分各自的搜索字段配置，并补上 `created_at` 订购时间搜索
- 预防: 以后页面如果声明了筛选配置，必须确认已真实传入 `FilterTable`；共享 selector 常量前先核对页面的数据字段与搜索逻辑是否一致

## 2026-03-19 登录安全与会话清理问题

- 现象: 登录失败路径存在明显时间差；Redis 不可用时登录限速失效；登录前清理过期会话会逐条删除数据库记录
- 根因: `app/api/users.py` 在用户名不存在时不会执行 `bcrypt` 校验，导致失败路径耗时不一致；同文件的 `_check_rate_limit` 在 Redis 熔断时直接放行；`app/services/session_service.py` 先查询过期会话再逐条 `db.delete`
- 处理方式: 为不存在用户补一条固定 bcrypt 校验，统一失败耗时；补齐内存后备限速检查与成功后的重置；将过期会话清理改成“先取 token_hash，再批量删除数据库记录”
- 预防: 以后涉及认证失败路径时，统一校验链路耗时；所有降级路径都必须同时具备“记录 + 拦截”能力；定时或登录前清理逻辑优先批量 SQL，而不是循环 ORM 删除

## 2026-03-19 用户列表活跃时间查询与 Layout 异步清理

- 现象: 管理员用户列表每页会额外触发多次会话查询；Layout 首屏公告请求在组件卸载后仍可能继续 `setState`
- 根因: `app/api/users.py` 为每个用户单独查询最新 `UserSession`；`frontend/src/pages/Layout.tsx` 的公告加载 effect 缺少取消标记
- 处理方式: 将用户最后活跃时间改为一次聚合查询并回填映射；为公告请求增加卸载取消判断，避免卸载后状态更新
- 预防: 列表页拼装附加字段时优先考虑批量聚合或预加载；所有异步 effect 都要在组件卸载时停止后续状态更新

## 2026-03-19 默认安全头与容器运行配置

- 现象: 全局 CSP 默认允许内联脚本执行；后端容器默认以 root 用户运行；`docker-compose.yml` 未提供健康检查
- 根因: `app/main.py` 使用统一宽松 CSP；`docker/backend/Dockerfile` 未切换低权限用户；编排配置缺少 `healthcheck`
- 处理方式: 将 CSP 调整为按路径收紧，对 `/docs`、`/redoc` 保留兼容策略，其余响应移除 `script-src 'unsafe-inline'`；后端镜像新增专用低权限用户；为 Redis、后端、前端补充健康检查
- 预防: 安全响应头需要区分“开发工具页”和“业务/API 响应”；容器镜像默认使用非 root 账户；新增服务时同时定义健康检查与依赖健康状态
