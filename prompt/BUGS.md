# BUGS.md - 问题记录

## 代码审查修复 (2026-02-14)

### 已修复问题

#### 1. 生产环境密钥硬编码问题 [FIXED]
- **文件**: `app/core/config.py`
- **问题**: `secret_key` 使用硬编码默认值，生产环境存在安全风险
- **修复**: 
  - 移除硬编码密钥，改为从环境变量读取
  - 添加 `env` 字段用于区分开发和生产环境
  - 生产环境必须设置 `SECRET_KEY` 环境变量
  - 更新 `.env.example` 添加环境变量说明

#### 2. SQL注入风险 [FIXED]
- **文件**: `app/services/internal_code.py`
- **问题**: CAS号直接用于SQL LIKE模式，存在潜在注入风险
- **修复**: 
  - 添加正则验证确保CAS号只包含数字和连字符
  - 在 `generate_internal_code` 和 `get_next_sequence` 函数中添加验证

#### 3. 使用 window.prompt() [FIXED]
- **文件**: `frontend/src/pages/Dashboard.tsx`
- **问题**: `handleStockin` 函数使用 `prompt()` 获取位置输入，用户体验差
- **修复**: 
  - 创建独立的Modal对话框组件
  - 添加状态管理 (`showStockinModal`, `selectedStockin`, `stockinLocation`)
  - 实现正式的UI交互流程

#### 4. 未实现的导出按钮 [FIXED]
- **文件**: `frontend/src/pages/Inventory.tsx`, `app/api/inventory.py`, `frontend/src/api/client.ts`
- **问题**: "导出"按钮点击无响应
- **修复**: 
  - 后端添加 `/inventory/export` API端点，返回CSV格式数据
  - 前端API客户端添加 `exportInventory` 方法
  - 前端实现 `handleExport` 函数，支持CSV下载

#### 5. 订单入库数量验证缺失 [FIXED]
- **文件**: `app/api/orders.py`
- **问题**: 入库前未验证 `order.quantity` 的有效性
- **修复**: 添加数量验证，确保 `order.quantity > 0`

#### 6. 库存序号竞态条件 [FIXED]
- **文件**: `app/api/inventory.py`
- **问题**: 并发入库时可能出现序号重复
- **修复**: 
  - 添加重试逻辑 (最多5次)
  - 捕获唯一约束冲突异常并自动重试

## 全量代码审查 (2026-02-16)

### 已修复问题

#### 7. 用户创建接口无认证 [SECURITY][FIXED]
- **文件**: `app/api/users.py`
- **问题**: `POST /users/` 无 `Depends(require_admin)` 依赖，任何人可创建管理员账号
- **修复**: 添加 `current_user: User = Depends(require_admin)` 参数

#### 8. 函数名冲突 get_inventory_by_code [BUG][FIXED]
- **文件**: `app/api/inventory.py`
- **问题**: 路由处理函数 `get_inventory_by_code` 与第39行的辅助函数同名，运行时路由处理函数覆盖辅助函数
- **修复**: 路由处理函数重命名为 `get_inventory_by_internal_code`

#### 9. 遗留 stock_in_order 使用错误的 generate_internal_code [BUG][FIXED]
- **文件**: `app/api/inventory.py`
- **问题**: 遗留的 `/inventory/stock-in/{order_id}` 端点从 `cas_utils` 导入 `generate_internal_code(cas, seq)`，生成 `"64-001"` 格式而非正确的 `"64175-250113-01"` 格式；新版入库已在 `reagent_orders.py` 实现
- **修复**: 删除遗留端点，`manual_add_inventory` 改用 `internal_code.py` 版本

#### 10. 驳回原因未存储 [BUG][FIXED]
- **文件**: `app/api/reagent_orders.py`, `app/api/consumable_orders.py`
- **问题**: `reject` 端点接受 `reason` 参数但从未保存到订单记录中
- **修复**: 将驳回原因保存到 `order.notes` 字段

#### 11. 导出CSV缺少新字段 [FIXED]
- **文件**: `app/api/inventory.py`
- **问题**: `export_inventory` 导出CSV不包含 `english_name`, `category`, `brand`, `price` 字段
- **修复**: 添加缺失字段到CSV导出

#### 12. excel_service db.commit() 无错误处理 [FIXED]
- **文件**: `app/services/excel_service.py`
- **问题**: `db.commit()` 失败时无回滚逻辑
- **修复**: 添加 try/except + db.rollback()

#### 13. datetime.utcnow() 已弃用 [FIXED]
- **文件**: 所有后端API文件 + `auth.py`
- **问题**: Python 3.12+ 已弃用 `datetime.utcnow()`
- **修复**: 全部替换为 `datetime.now(timezone.utc)`

#### 14. 未使用的 REASON_MAPPING [FIXED]
- **文件**: `frontend/src/pages/ReagentOrders.tsx`, `ConsumableOrders.tsx`
- **问题**: `REASON_MAPPING` 常量已定义但从未使用
- **修复**: 删除未使用代码

#### 15. 全部 alert() 替换为 toast 通知 [FIXED]
- **文件**: 全部前端页面 (6 个文件, 42 处调用)
- **问题**: 使用浏览器原生 `alert()` 阻塞式弹窗，用户体验差
- **修复**: 
  - 创建 `toast.tsx` 轻量通知组件（success/error/warning/info）
  - App.tsx 添加 `ToastContainer` 全局渲染
  - 所有页面 `alert()` 替换为 `toast.success/error/warning()`

#### 16. 订单列表显示申请人ID而非姓名 [FIXED]
- **文件**: `app/api/reagent_orders.py`, `app/api/consumable_orders.py`, 前端两个订单页
- **问题**: 订单列表显示 `applicant_id` 数字，用户无法识别申请人
- **修复**: 
  - 后端列表 API 关联 User 表返回 `applicant_name` 字段
  - 前端显示 `applicant_name` 替代 `applicant_id`

#### 17. window.location.href 导致 SPA 整页刷新 [FIXED]
- **文件**: `frontend/src/pages/Inventory.tsx`
- **问题**: 使用 `window.location.href = '/import'` 跳转导致整页刷新
- **修复**: 使用 React Router 的 `useNavigate` hook

#### 18. ExternalLink 图标语义不符 [FIXED]
- **文件**: `frontend/src/pages/Inventory.tsx`
- **问题**: 导出按钮使用 `ExternalLink` 图标（表示外链），语义不正确
- **修复**: 替换为 `Download` 图标

#### 19. spec_utils.py 服务层抛出 HTTPException [FIXED]
- **文件**: `app/services/spec_utils.py`
- **问题**: 服务层函数直接抛出 `HTTPException`，违反分层架构原则
- **修复**: 
  - 创建 `SpecificationError(ValueError)` 域错误
  - API 层捕获 `SpecificationError` 转为 `HTTPException`

#### 20. BorrowLog.return_time == None 不规范 [FIXED]
- **文件**: `app/api/inventory.py`
- **问题**: SQLAlchemy `== None` 比较虽可工作但触发 lint 警告
- **修复**: 改为 `.is_(None)` 标准写法

#### 21. 过期文档未更新 [FIXED]
- **文件**: `BACKEND_STRUCTURE.md`, `FRONTEND_GUIDELINES.md`, `APP_FLOW.md`
- **问题**: 文档仍引用旧 Order 单表、仅支持 .xlsx/.xls、未记录新字段
- **修复**: 全部重写以反映当前代码状态

### 后续建议

1. 添加单元测试覆盖核心业务逻辑
2. 考虑添加API请求速率限制
3. 添加日志记录关键操作
4. 定期执行代码审查
