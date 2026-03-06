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

---

## 全面代码审查重构 (2026-02-16)

### P0 - 阻断性问题 [FIXED]

#### 7. WAL 模式未正确启用 [FIXED]

- **文件**: `app/database.py`
- **问题**: 通过 URL 参数 `?mode=wal` 尝试启用 WAL，但 SQLAlchemy 不支持此方式
- **修复**: 使用 SQLAlchemy `event.listens_for(engine, "connect")` 执行 `PRAGMA journal_mode=WAL`，同时开启 `PRAGMA foreign_keys=ON`

#### 8. generate_internal_code 双实现冲突 [FIXED]

- **文件**: `app/services/cas_utils.py`, `app/api/inventory.py`
- **问题**: `cas_utils.py` 和 `internal_code.py` 各有一个 `generate_internal_code`，inventory.py 导入了错误的版本
- **修复**: 删除 `cas_utils.py` 中的版本，inventory.py 改为导入 `internal_code.py`

#### 9. 用户注册接口无认证 [FIXED]

- **文件**: `app/api/users.py`
- **问题**: `POST /users/` 任何人可创建用户（包括 admin），严重安全漏洞
- **修复**: 添加 `require_admin` 依赖

#### 10. Dashboard 入库按钮状态逻辑 [RE-FIXED]

- **文件**: `frontend/src/pages/Dashboard.tsx`, `app/api/reagent_orders.py`
- **问题**: APPROVED 状态显示"一键入库"按钮，但后端 `stock_in_reagent_order` 严格要求 ARRIVED 状态，导致点击必定 400 错误；耗材订单调用不存在的 `consumableOrderAPI.stockIn()` 导致运行时错误
- **初始修复**: 仅在前端移除 approved 状态的"一键入库"按钮（不符合用户需求）
- **最终修复** (2026-02-16):
  - 后端 `stock_in_reagent_order` 接受 `APPROVED` 和 `ARRIVED` 两种状态，"一键入库"跳过确认到货步骤直接入库
  - 前端耗材订单"一键入库"改为调用 `consumableOrderAPI.complete()` 而非不存在的 `stockIn()`
  - APPROVED 状态保留"确认到货"和"一键入库"两个按钮，给用户选择权

#### 11. reject/confirm-arrival 参数不匹配 [FIXED]

- **文件**: `app/api/reagent_orders.py`, `app/api/consumable_orders.py`
- **问题**: 后端用 Query 参数接收 reason/arrival_notes，前端发 JSON body
- **修复**: 改为 Pydantic Body 模型 (RejectRequest, ConfirmArrivalRequest)

### P1 - 重要改进 [FIXED]

#### 12. 旧 stock-in 路由冗余 [FIXED]

- **文件**: `app/api/inventory.py`
- **问题**: 与 `reagent_orders.py` 重复，且状态检查错误、internal_code 格式错误
- **修复**: 删除 `POST /inventory/stock-in/{order_id}`

#### 13. 订单列表接口无认证 [FIXED]

- **文件**: `app/api/reagent_orders.py`, `app/api/consumable_orders.py`
- **问题**: `GET /reagent-orders/` 和 `GET /consumable-orders/` 无需登录即可访问
- **修复**: 添加 `get_current_user` 依赖

#### 14. 归还数量无上限校验 [FIXED]

- **文件**: `app/api/inventory.py`
- **问题**: remaining_quantity 可输入超过 initial_quantity
- **修复**: 添加 `remaining_quantity <= initial_quantity` 校验

#### 15. 路由顺序 + 函数名冲突 [FIXED]

- **文件**: `app/api/inventory.py`
- **问题**: `/export`, `/dashboard/*`, `/import/*` 路由在 `/{inventory_id}` 之后；`get_inventory_by_code` 辅助函数与路由函数同名
- **修复**: 重排路由，所有具名路由在 `/{id}` 之前；辅助函数改名 `_get_by_id` / `_find_by_code`

### P2 - 代码质量 [FIXED]

#### 16. CSV 导出返回 JSON [FIXED]

- **文件**: `app/api/inventory.py`
- **问题**: 返回 `{"data": csv_string}` 需前端二次解析
- **修复**: 改为 `StreamingResponse`，添加 UTF-8 BOM，直接下载

#### 17. CORS 硬编码 [FIXED]

- **文件**: `app/main.py`, `app/core/config.py`
- **修复**: `cors_origins` 移入 Settings，main.py 统一读取

#### 18. 日志缺失 [FIXED]

- **文件**: `app/main.py`, `app/database.py`
- **修复**: 添加 `logging.basicConfig` + 模块级 logger

#### 19. Token 双重存储 [FIXED]

- **文件**: `frontend/src/store/useStore.ts`, `frontend/src/api/client.ts`
- **问题**: token 同时存在 localStorage 和 Zustand persist 中
- **修复**: 统一由 Zustand persist 管理，API interceptor 从 `useAuthStore.getState()` 读取

#### 20. 前端状态映射分散 [FIXED]

- **文件**: 新增 `frontend/src/lib/constants.ts`
- **修复**: 集中定义所有状态/原因/角色映射，ReagentOrders.tsx 和 ConsumableOrders.tsx 引用

#### 21. spec_utils 单位大小写 [FIXED]

- **文件**: `app/services/spec_utils.py`
- **问题**: `spec.lower()` 后 "1L" 变成 "1l"，返回单位不规范
- **修复**: 添加 `UNIT_CANONICAL` 映射 (ml→mL, l→L, ul→μL)

#### 22. /dashboard/my-borrows 时区感知与无感知 datetime 相减崩溃 [FIXED]

- **文件**: `app/api/inventory.py:270-292`
- **问题**: `now = datetime.now(timezone.utc)` 生成时区感知 datetime，但 `item.updated_at` 经 SQLite 往返后为时区无感知（naive）datetime，`now - item.updated_at` 抛出 `TypeError: can't subtract offset-naive and offset-aware datetimes`，导致整个 `/dashboard/my-borrows` 端点崩溃
- **根因**: 模型 `default_factory=datetime.utcnow` + SQLAlchemy `DateTime` 不含 `timezone=True` → SQLite 存取后 tz 信息丢失
- **修复**: `now = datetime.now(timezone.utc).replace(tzinfo=None)`，使 `now` 也为 naive UTC，与数据库返回值一致

## PR Review 遗留问题修复 (2026-02-17)

### 已修复问题

#### 23. pd.read_csv 参数错误 [FIXED]

- **文件**: `app/services/excel_service.py`
- **问题**: `pd.read_csv()` 使用 `errors='replace'`，但正确参数名为 `encoding_errors`
- **修复**: 改为 `encoding_errors='replace'`

#### 24. 驳回操作覆盖 notes 备注 [FIXED]

- **文件**: `app/api/reagent_orders.py`, `app/api/consumable_orders.py`
- **问题**: `RejectRequest.reason` 默认值 `"Order rejected"` 导致 `if body.reason:` 永远为 True，驳回时 `order.notes` 被无条件覆盖
- **修复**: 移除 `RejectRequest` 类和 notes 覆盖逻辑，驳回操作只改状态不动备注

#### 25. APPROVED 一键入库缺少权限检查 [FIXED]

- **文件**: `app/api/reagent_orders.py`
- **问题**: `stock_in_reagent_order` 中 APPROVED 状态可直接入库，但未检查操作者是否为申请人或管理员
- **修复**: 增加与 `confirm_reagent_arrival` 相同的权限校验（申请人本人或 admin）

#### 26. common_public 订单可被错误入库 [FIXED]

- **文件**: `app/api/reagent_orders.py`, `frontend/src/pages/Dashboard.tsx`, `frontend/src/pages/ReagentOrders.tsx`
- **问题**: 常用/公用试剂应在确认到货时直接完成，但可通过一键入库绕过，错误创建 Inventory 记录
- **修复**:
  - 后端：`stock_in_reagent_order` 增加 `common_public` 拦截，返回 400
  - 前端：`common_public` 订单的一键入库按钮置灰（disabled），鼠标悬停显示提示信息

#### 28. Dashboard TanStack Table 点击后路由失效 [FIXED]

- **文件**: `frontend/src/pages/Dashboard.tsx`
- **问题**: 将表格从原生 `<table>` 改为 TanStack Table 后，点击表格或操作表头时路由全部失效，URL变化但不加载页面
- **根因**:

  - `useReactTable` 的 `data` 属性直接使用 `.slice()` 方法
  - `.slice()` 每次渲染都返回新的数组引用
  - TanStack Table 检测到 data 引用变化后强制重新计算，触发无限重渲染循环
  - 浏览器主线程被卡死，React 无力接管路由渲染
- **诊断现象**: "网址会变化但页面不加载" 是无限循环导致主线程阻塞的典型症状
- **修复**:

  - 使用 `useMemo` 包裹分页数据，确保数组引用稳定
  - 将稳定后的 data 传入 `useReactTable`

  ```typescript
  const consumableData = useMemo(() => {
    return myConsumableOrders.slice(
      (consumablePage - 1) * consumablePageSize,
      consumablePage * consumablePageSize
    )
  }, [myConsumableOrders, consumablePage, consumablePageSize])

  const consumableTable = useReactTable({
    data: consumableData, // 使用稳定引用
    ...
  })
  ```
- **教训**: 使用 TanStack Table 时，所有传入的 data 必须是稳定引用（使用 useMemo），避免直接使用 `.slice()`/`.filter()`/`.map()` 等返回新数组的方法
- **文件**: `app/api/inventory.py`
- **问题**: 后端列表 API 使用缓存机制，但缓存 key 没有包含 `limit` 参数，导致切换每页条数时返回了缓存的旧数据
- **复现步骤**:

  1. 页面初始显示 20 条/页（假设 API 缓存了 20 条数据）
  2. 切换到 50 条/页
  3. API 使用相同的缓存 key（不含 limit），返回缓存的 20 条数据
- **根因**: 缓存 key 为 `f"list:{search}:{status_filter}:..."`，缺少 `skip` 和 `limit` 参数
- **修复**: 缓存 key 改为 `f"list:{skip}:{limit}:{search}:{status_filter}:..."`



# BUGS.md - 问题记录

## 2026-03-06 登录后发起大量 API 请求问题

### 问题描述

登录后同时发起大量 API 请求，造成性能浪费。

### 问题日志

```
INFO:     127.0.0.1:3431 - "POST /api/users/login HTTP/1.1" 200 OK
INFO:     127.0.0.1:3431 - "GET /api/users/me HTTP/1.1" 200 OK
INFO:     127.0.0.1:3218 - "GET /api/consumable-orders/dashboard/my-orders HTTP/1.1" 200 OK
INFO:     127.0.0.1:3218 - "GET /api/inventory/dashboard/my-borrows HTTP/1.1" 200 OK
INFO:     127.0.0.1:3218 - "GET /api/inventory/dashboard/pending-stockin HTTP/1.1" 200 OK
INFO:     127.0.0.1:3431 - "GET /api/reagent-orders/dashboard/my-orders HTTP/1.1" 200 OK
INFO:     127.0.0.1:3218 - "GET /api/announcements/public HTTP/1.1" 200 OK
INFO:     127.0.0.1:3431 - "GET /api/consumable-orders/dashboard/my-orders HTTP/1.1" 200 OK
INFO:     127.0.0.1:3218 - "GET /api/inventory/dashboard/my-borrows HTTP/1.1" 200 OK
INFO:     127.0.0.1:3431 - "GET /api/inventory/dashboard/pending-stockin HTTP/1.1" 200 OK
INFO:     127.0.0.1:3218 - "GET /api/reagent-orders/dashboard/my-orders HTTP/1.1" 200 OK
INFO:     127.0.0.1:3431 - "GET /api/announcements/public HTTP/1.1" 200 OK
INFO:     127.0.0.1:13880 - "GET /api/announcements/public HTTP/1.1" 200 OK
INFO:     127.0.0.1:11574 - "GET /api/announcements/ HTTP/1.1" 200 OK
INFO:     127.0.0.1:11370 - "GET /api/announcements/storage-info HTTP/1.1" 200 OK
```

### 请求来源分析

| 序号 | API 请求                                           | 来源文件          | 调用原因                       |
| :--: | -------------------------------------------------- | ----------------- | ------------------------------ |
|  1  | `POST /api/users/login`                          | Login.tsx:82      | 登录接口                       |
|  2  | `GET /api/users/me`                              | App.tsx:51        | 刷新页面时获取用户信息         |
|  3  | `GET /api/consumable-orders/dashboard/my-orders` | Dashboard.tsx:335 | Dashboard 并行加载             |
|  4  | `GET /api/inventory/dashboard/my-borrows`        | Dashboard.tsx:398 | Dashboard 并行加载             |
|  5  | `GET /api/inventory/dashboard/pending-stockin`   | Dashboard.tsx:411 | Dashboard 并行加载             |
|  6  | `GET /api/reagent-orders/dashboard/my-orders`    | Dashboard.tsx:335 | Dashboard 并行加载             |
|  7  | `GET /api/announcements/public`                  | Layout.tsx:55     | **每次路由变化都触发！** |

### 根本原因

1. **Layout.tsx 路由监听导致公告重复请求** - 主要原因

   - `useEffect` 依赖 `location`，每次路由变化都重新请求
   - 登录后跳转到首页，触发多次请求
   - 不同端口是 Vite 热重载多服务器导致
2. **React Strict Mode** - 开发模式下组件渲染两次

### 修复方案

1. 为公告数据添加缓存机制，避免重复请求
2. 优化 Layout.tsx 中的 useEffect 依赖

### 状态

- [X] 已修复 - 改为只在组件挂载时获取一次公告数据
