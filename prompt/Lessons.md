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
