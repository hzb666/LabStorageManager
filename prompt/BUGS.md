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

### 后续建议

1. 添加单元测试覆盖核心业务逻辑
2. 考虑添加API请求速率限制
3. 添加日志记录关键操作
4. 定期执行代码审查
