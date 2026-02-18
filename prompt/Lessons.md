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
