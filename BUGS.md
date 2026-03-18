# BUGS

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
