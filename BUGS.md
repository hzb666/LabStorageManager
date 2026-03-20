# BUGS

## 2026-03-21 SQLite 表结构与 SQLModel 定义在旧库可能漂移

- 现象: 历史 `lab_inventory.db` 可能出现“模型定义”与“实际表结构”不一致（例如 `inventory.source_order_id` 及其索引在旧库缺失）
- 根因: 启动阶段使用 `SQLModel.metadata.create_all` 仅创建缺失表，不会为已存在表自动补新列；现有启动补齐逻辑仅覆盖拼音搜索字段/索引
- 处理方式: 在 `app/database.py` 增加启动时 schema 一致性校验，遍历所有 SQLModel 表并比对列/索引是否一致，发现差异仅输出明确日志（不自动修改表）
- 预防: 后续新增数据库字段时同步评估旧库迁移策略；至少提供“启动校验 + 手动迁移指引”，避免模型与实际库结构长期漂移

## 2026-03-20 Inventory 更新接口存在 remaining_quantity 重复分支

- 现象: `app/api/inventory.py` 的更新逻辑里出现两个 `if 'remaining_quantity' in update_data`，一个做校验、一个做赋值，且剩余百分比计算分散在后续独立条件中
- 根因: 同一字段的校验与状态更新没有放在同一个分支，导致条件重复、逻辑分散，可维护性下降
- 处理方式: 合并为单一 `remaining_quantity` 分支，统一完成“校验 + 赋值 + remaining_percent 重算”；同时保留 `specification` 更新时的百分比重算分支
- 预防: 对同一输入字段的“校验-赋值-派生字段更新”应尽量收敛在同一条件块，避免出现重复条件和分散副作用

## 2026-03-20 DataTable 列宽 CSS 变量触发 TS2322 类型错误

- 现象: `frontend/src/components/ui/DataTable.tsx` 中给 `cssVariableStyles` 写入 `--col-*-flex/min/display` 时，TypeScript 报 `TS2322`，提示赋值类型不兼容
- 根因: 代码把自定义 CSS 变量键强制断言为 `keyof React.CSSProperties`，导致值类型被按标准 CSS 属性收窄，`'none'`、``${number}px`` 等值无法通过类型检查
- 处理方式: 新增 `ColumnCssVariableKey/ColumnCssVariables` 类型，并将 `cssVariableStyles` 声明为 `React.CSSProperties & ColumnCssVariables`，去除错误的 `keyof React.CSSProperties` 断言
- 预防: 后续在 React `style` 中使用自定义 CSS 变量时，统一用 `Record<\`--*\`, string>`（或更精确模板字面量类型）扩展类型，避免把自定义变量误当成内置样式属性

## 2026-03-19 非模糊搜索命中拼音首字母时未高亮对应汉字

- 现象: 关闭“模糊搜索”后，输入拼音首字母（如 `wsyc`）可以搜到中文记录，但表格中的中文文本没有高亮对应汉字
- 根因: `frontend/src/components/ui/HighlightText.tsx` 的非模糊分支只做了精确正则匹配；当命中来自后端拼音字段（如 `*_pinyin_initials`）时，前端没有拼音到汉字的回退高亮逻辑
- 处理方式: 非模糊分支改为“先精确正则高亮，未命中时回退到拼音映射高亮”，复用现有拼音匹配算法标记对应汉字
- 预防: 以后搜索与高亮分离设计时，若后端支持拼音/别名字段命中，前端高亮必须提供一致的回退策略，避免“能搜到但不高亮”的体验断层

## 2026-03-19 CAS 自动识别始终提示 PubChem fallback 异常

- 现象: 输入合法 CAS 后，接口频繁返回“PubChem fallback 异常，英文名未获取（补充查询最多 1 秒）”，难以区分是主查询失败、补充查询失败还是网络解析问题
- 根因: `app/services/chemical_info.py` 在主查询失败后会被 fallback 错误文案覆盖；同时出站校验先做 DNS 预解析，解析失败会被统一折叠为 `Unsafe outbound URL blocked`，导致真实异常原因被吞掉
- 处理方式: 调整 PubChem 英文名查询逻辑，保留并返回主查询与 fallback 的真实失败原因（含异常类型或 HTTP 状态）；出站安全校验改为协议 + 域名白名单，不再使用 DNS 预解析作为拦截条件
- 预防: 对外部 API 的主/补充分支应分别记录失败原因并在最终 warning 中聚合，避免后续分支覆盖前序根因；白名单可信域名场景下优先保留网络层原始错误以便排障

## 2026-03-19 订单编辑弹窗缺少删除入口且公用账户仍可编辑/删除历史订单

- 现象: 试剂订单、耗材订单及仪表盘中的订单编辑弹窗没有删除入口；同时后端订单 `update/delete` 接口只校验“申请人或管理员”，若存在历史 `PUBLIC` 账户订单，公用账户仍可能编辑或删除自己的旧订单
- 根因: 订单编辑弹窗没有复用库存编辑弹窗的删除区样式与交互；后端鉴权缺少对 `UserRole.PUBLIC` 的显式拒绝
- 处理方式: 抽出共享的 `EditDialogActions` 组件并接入库存、试剂订单、耗材订单及仪表盘两个订单编辑弹窗；后端在试剂/耗材订单的 `update/delete` 接口中显式禁止 `PUBLIC` 账户，继续保留“管理员可操作任意订单、普通用户仅可操作自己的订单”的规则
- 预防: 以后新增“编辑弹窗 + 删除动作”时优先复用同一组件，避免样式漂移；权限接口除了 owner/admin 规则外，还要单独检查 `PUBLIC` 这类受限角色

## 2026-03-19 耗材订单页审批/驳回按钮与订单页不一致

- 现象: `frontend/src/pages/ConsumableOrders.tsx` 中审批和驳回按钮仍是旧的文本按钮，只在 `pending` 状态显示，和订单页的图标按钮、二次确认、禁用态流转规则不一致
- 根因: 耗材订单页的 `ActionButtons` 没有复用订单页同一套 action 配置模式，缺少 `icon`、`variant`、`confirm`、`confirmLabel`、`disableWhen` 等配置，且仍依赖 `showWhen` 直接隐藏按钮
- 处理方式: 将耗材订单页审批/驳回 action 改为与订单页一致的图标按钮和二次确认交互，并把状态控制从“按状态隐藏”改成“始终显示但按状态禁用”；同时移除不再需要的 `isAdmin` 透传，并把操作列宽度调整到与订单页一致
- 预防: 后续如果同类页面存在相同审批流，优先对齐同一套 `TableActionButtons` 配置结构；新增 action 时先检查样式、确认态和状态流转规则是否已和基准页保持一致

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
