# Lessons.md - 经验教训记录

## 2026-02-14 审查发现与修复

### 问题 1: UI 图标反了
- **现象**: 导入按钮显示 Upload 图标，导出按钮显示 Download 图标
- **原因**: 图标选择与语义不符
- **修复**: 
  - 导入 (从服务器下载模板) → `<Download>`
  - 导出 (上传数据到服务器) → `<Upload>`
- **文件**: `frontend/src/pages/Inventory.tsx`

### 问题 2: Pandas 模块缺失
- **现象**: `ModuleNotFoundError: No module named 'pandas'`
- **原因**: 环境中未安装 pandas
- **影响**: 导入模板功能 (`/api/inventory/import/template`) 500 错误
- **修复**: `pip install pandas openpyxl`
- **验证**: `python -c "import pandas; print(pandas.__version__)"` → 3.0.0

### 问题 3: 安全漏洞 - 缺少权限检查
- **现象**: 7 个 API 端点缺少 `current_user` 验证
- **风险**: 任何人可以修改/删除数据，违反 Critical Rule #3
- **修复**: 添加 `current_user: User = Depends(get_current_user)` 依赖

修复的端点:
| 文件 | 端点 | 权限级别 |
|------|------|---------|
| inventory.py | stock-in | require_admin |
| inventory.py | update_inventory | get_current_user |
| inventory.py | delete_inventory | require_admin |
| orders.py | upload_image | get_current_user |
| orders.py | update_order | get_current_user |
| orders.py | arrived_orders | get_current_user |
| orders.py | delete_order | get_current_user |

---

## 历史教训

### 2026-02-13 登录 API 修复
- **问题**: 422/401 错误
- **根因**: 
  1. 后端期望 Query 参数，前端发送 JSON Body
  2. 数据库无用户
- **修复**: 添加 `LoginRequest` Pydantic 模型 + 创建 admin 用户

### 2026-02-13 Dashboard 数据解析
- **问题**: `myOrders.filter is not a function`
- **根因**: 后端返回嵌套 `{ data: { pending: {...}, approved: {...} } }`，前端期望扁平数组
- **修复**: 前端展平嵌套数据

---

## 最佳实践

1. **依赖检查**: 每次添加新 API 时，确保检查是否需要 `current_user`
2. **环境同步**: 新增依赖后，确保在运行环境中安装
3. **图标语义**: 
   - Download = 从服务器获取（导入模板）
   - Upload = 发送到服务器（导出数据）

### 问题 4: SQLite SQL 语法错误
- **现象**: internal_code 生成失败
- **原因**: 使用了 SQL 标准 SUBSTRING，SQLite 应使用 SUBSTR
- **修复**: `SUBSTRING(internal_code FROM LENGTH(:prefix) + 1)` → `SUBSTR(internal_code, LENGTH(:prefix) + 1)`
- **文件**: `app/services/internal_code.py`

### 问题 5: 安全配置改进
- **现象**: secret_key 有不安全的默认值
- **修复**: 更新默认值并添加注释提醒生产环境修改
- **文件**: `app/core/config.py`

---

## 2026-02-16 全面代码审查重构

### 教训 6: SQLite WAL 模式不能通过 URL 参数设置
- **错误做法**: `sqlite:///path?mode=wal`
- **正确做法**: `event.listens_for(engine, "connect")` + `PRAGMA journal_mode=WAL`
- **原因**: SQLite URL 参数是给 URI filename 用的，不是 PRAGMA；且 SQLAlchemy 层面不支持此写法

### 教训 7: FastAPI 路由顺序至关重要
- **问题**: `/{inventory_id}` 放在 `/export` 前面会导致 `/export` 永远被当作 ID 匹配
- **规则**: 所有具名路由（/export, /dashboard/*, /import/*）必须在通配 ID 路由之前注册

### 教训 8: 辅助函数与路由函数不能同名
- **问题**: `get_inventory_by_code` 既是辅助函数也是路由函数，Python 中后者覆盖前者
- **规则**: 内部辅助函数用下划线前缀 (`_get_by_id`, `_find_by_code`)

### 教训 9: FastAPI 参数传递一致性
- **问题**: 后端用 Query 参数 `reason: str = "..."` 接收，前端用 JSON body 发送 → 参数丢失
- **规则**: 修改操作一律用 Pydantic Body 模型，GET 查询才用 Query 参数

### 教训 10: Token 单一来源原则
- **问题**: Zustand persist + localStorage.setItem 双重存储，logout 时可能遗漏
- **规则**: 认证状态由一个 store 管理，其他地方通过 `store.getState()` 读取

### 教训 11: CSV 导出应使用 StreamingResponse
- **错误做法**: 把 CSV 字符串包在 JSON 里 `{"data": "...csv..."}`，前端需二次解析
- **正确做法**: `StreamingResponse` + `Content-Disposition: attachment` 让浏览器直接下载

### 教训 12: Git stash + pull 冲突处理流程
- **场景**: 本地有大量修改，远端也有新提交，直接 pull 会 abort
- **正确流程**: 
  1. `git add` 新文件（untracked 文件不能 stash）
  2. `git stash push -m "描述"`
  3. `git pull origin branch`
  4. `git stash pop`（可能产生冲突）
  5. 手动解决冲突 → `git add` → `git commit`
  6. `git stash drop` 清理已解决的 stash
- **注意**: stash pop 冲突后 stash 不会自动删除，需要手动 drop

### 教训 13: PowerShell 不支持 Bash heredoc 语法
- **问题**: `git commit -m "$(cat <<'EOF'...EOF)"` 在 PowerShell 中完全不工作
- **解决**: 将 commit message 写入临时文件，用 `git commit -F .git/COMMIT_MSG`
- **注意**: PowerShell 中 `&&` 也不可用，需用 `;` 分隔命令

### 教训 28: VSCode 终端 PowerShell 命令语法
- **问题**: 执行 `git add . && git status` 报错：`标记"&&"不是此版本中的有效语句分隔符`
- **原因**: VSCode 内置终端使用 PowerShell 7，不支持 Bash 的 `&&` 链式命令
- **解决**: 
  1. 使用 `;` 代替 `&&`：`git add . ; git status`
  2. 或切换到 Git Bash 终端
  3. 或在命令开头加 `bash -c "..."`

### 教训 14: 合并冲突时要取双方最优解
- **场景**: 远端已将 `datetime.utcnow()` 改为 `datetime.now(timezone.utc)`，本地改了参数传递方式
- **错误做法**: 简单选择"ours"或"theirs"，丢失一方的改进
- **正确做法**: 逐个冲突分析，合并两边的改进（如：取远端的 datetime 改进 + 本地的 Body 模型参数）

### 教训 15: SpecificationError 比 HTTPException 更好
- **问题**: 在 service 层（`spec_utils.py`）直接抛出 `HTTPException` 耦合了 HTTP 框架
- **正确做法**: service 层抛出领域异常 `SpecificationError(ValueError)`，API 层 catch 后转换为 `HTTPException`
- **好处**: service 层可被非 HTTP 调用方（如 CLI、测试）复用

### 教训 16: 前后端状态校验必须一致
- **问题**: 前端"一键入库"按钮在 `approved` 状态显示，但后端 `stock_in` 端点只接受 `ARRIVED` 状态，导致前端操作必定失败
- **延伸**: 耗材订单调用不存在的 `consumableOrderAPI.stockIn()` 方法，运行时直接报错
- **规则**: 
  1. 前端展示操作按钮时，必须确保对应后端接口支持该状态
  2. "一键操作" 类功能应在后端合并多步骤逻辑，而非依赖前端按正确顺序调用
  3. 前端 API 客户端调用的方法必须在客户端中实际定义

### 教训 17: SQLite datetime 往返丢失时区信息
- **问题**: `datetime.now(timezone.utc)` 创建 aware datetime，但 SQLite + SQLAlchemy `DateTime(timezone=False)` 存取后返回 naive datetime，两者相减抛 TypeError
- **规则**: 与 SQLite 中读出的 datetime 做算术运算时，必须确保双方 tz-awareness 一致。推荐用 `.replace(tzinfo=None)` 将 aware datetime 转为 naive UTC，或在模型层统一使用 `DateTime(timezone=True)`

### 教训 18: PowerShell 下 git commit 中文编码问题
- **问题**: PowerShell 环境下 `git commit -m "中文"` 会产生乱码
- **原因**: PowerShell 默认编码不是 UTF-8
- **解决方法**: 
  1. 用 Write 工具把中文 commit message 写入 `.git/COMMIT_MSG` 文件
  2. 执行 `git commit -F .git/COMMIT_MSG` 或 `git commit --amend -F .git/COMMIT_MSG`
- **注意**: 不要用 heredoc 语法 (`$(cat <<'EOF'...)`)，PowerShell 不支持

### 教训 19: Git Flow 中 main 分支不应过早合并
- **问题**: 项目尚无稳定版本时，就把 develop 通过 PR 合并到了 main，导致 main 上充满开发中的代码
- **规则**:
  1. `main` 分支只在正式发布稳定版本（如 v1.0.0）时才从 `develop` 合并
  2. 开发阶段所有工作都在 `develop` 和 `feature/*` 分支上进行
  3. 合并到 `main` 时必须打 tag 标记版本号（`git tag -a v1.0.0 -m "Release v1.0.0"`）
  4. 不要因为"同步代码"而随意向 main 发 PR
- **补救**: 已有的代码不做回退，从现在起规范操作，等真正稳定后再合并并打 tag

### 教训 20: PowerShell 不支持 Unix head 命令
- **问题**: 执行 `npx tsc --noEmit 2>&1 | head -30` 时报错：`head: The term 'head' is not recognized as a name of a cmdlet, function, script file, or executable program`
- **原因**: `head` 是 Unix/Linux 命令，PowerShell 默认不支持
- **解决方案**: 
  1. 使用 PowerShell 原生命令：`Get-Content file.txt | Select-Object -First 30`
  2. 或使用 `Select-Object -First 30` 管道
  3. 或在命令中避免使用 `head`，直接查看完整输出

---

## 2026-02-22 安全审计修复

### 教训 21: JWT 密钥不能硬编码
- **问题**: `secret_key = "dev-secret-key-do-not-use-in-production-12345"` 硬编码
- **风险**: 攻击者可伪造任意用户 token
- **修复**: 使用 `secrets.token_urlsafe(32)` 生成安全随机密钥
- **文件**: `app/core/config.py`

### 教训 22: API 端点必须验证认证状态
- **问题**: 4 个敏感端点 (CAS查询、库存查询) 无需认证即可访问
- **风险**: 泄露化学品库存信息
- **修复**: 添加 `current_user: User = Depends(get_current_user)`
- **文件**: `app/api/inventory.py`

### 教训 23: Cookie 必须在生产环境启用 secure 标志
- **问题**: `secure=False` 允许 HTTP 传输 token
- **风险**: 中间人攻击窃取 token
- **修复**: `secure=settings.env != "development"`
- **文件**: `app/api/users.py`

### 教训 24: 权限检查必须使用枚举而非字符串
- **问题**: `current_user.role != "admin"` 字符串比较
- **风险**: 类型不一致可能导致权限检查失效
- **修复**: 统一使用 `UserRole.ADMIN` 枚举
- **文件**: `app/api/reagent_orders.py`, `app/api/consumable_orders.py`

### 教训 25: 防止用户权限提升
- **问题**: 普通用户可通过更新 API 修改自己的 role 字段
- **风险**: 用户可提升为管理员
- **修复**: 非 admin 用户更新时删除 role 字段
- **文件**: `app/api/users.py`

### 教训 26: 前端路由也需要权限保护
- **问题**: 仅 UI 隐藏用户管理菜单，但 URL 可直接访问
- **风险**: 普通用户可以看到管理页面（虽然操作会被后端拒绝）
- **修复**: 添加 `AdminRoute` 组件，前端路由级别保护
- **文件**: `frontend/src/App.tsx`

### 教训 27: 内存存储需防泄漏
- **问题**: 速率限制字典无限增长
- **风险**: 攻击者耗尽服务器内存 (DoS)
- **修复**: 
  1. 设置最大缓存上限 (MAX_CACHE_SIZE = 10000)
  2. 定期清理过期条目 (超过 1 小时)
- **文件**: `app/api/users.py`

### 安全检查清单 (后续开发必检)
1. **新增 API 端点**: 必须添加 `Depends(get_current_user)` 或 `Depends(require_admin)`
2. **权限比较**: 必须使用枚举 `UserRole.ADMIN`，禁止字符串 `"admin"`
3. **敏感数据**: CAS查询、库存查询等必须登录后访问
4. **Cookie 配置**: 生产环境必须 `secure=True`
5. **密钥生成**: 必须使用 `secrets.token_urlsafe()` 或环境变量
6. **前端路由**: 管理员页面必须使用 `AdminRoute` 包装
