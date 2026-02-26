# Progress.md

## Completed Phases

### Phase 1: Infrastructure
- [x] 1.1: Init FastAPI + SQLModel + SQLite (WAL Mode)
- [x] 1.2: User model & JWT Auth
- [x] 1.2b: Full JWT Authentication (get_current_user)
- [x] 1.3: Image Service (Pillow compress <100KB)
- [x] 1.4: CAS Utility (normalize_cas)

### Phase 2: Ordering & Inventory Core
- [x] 2.1: Order CRUD API
- [x] 2.2: CAS Check API
- [x] 2.3: Inventory CRUD API (Borrow/Return)
- [x] 2.4: Stock-In Logic (Order → Inventory)
- [x] 2.5: ARRIVED status + Confirm Arrival API

### Phase 3: User Dashboard
- [x] 3.1: Dashboard APIs (my-borrows, pending-stockin, my-orders)
- [x] 3.2: Return Item API
- [x] 3.3: Frontend Dashboard Cards & Return Modal

### Phase 4: Excel Import
- [x] 4.1: Backend Excel Import Service (Pandas)
- [x] 4.2: Frontend Excel Upload UI

### Phase 5: Frontend Pages
- [x] 5.1: React + Shadcn/UI + TanStack Table Init
- [x] 5.2: Order Form with CAS Auto-check
- [x] 5.3: Inventory Table with Sorting/Filtering

### Phase 6: Manual Inventory Add
- [x] 6.1: Backend API: POST /inventory/manual-add
- [x] 6.2: Frontend UI: Manual Add Modal in Inventory Page
- [x] 6.3: Dialog Component for Modal

### Phase 7: Admin User Management
- [x] User Management (CRUD, role assignment)
- [x] Frontend Admin User Management Page

### Phase 8: Notifications & Alerts 
- [x] CAS number already has alerts (when submit orders)
- [x] Stock-in notification (when order arrives)
- [x] Low stock alerts
- [x] Borrow/Return notifications

### Phase 9: Reagent & Consumable Split
- [x] Order 表拆分为 ReagentOrder + ConsumableOrder
- [x] 试剂/耗材分别独立页面 (ReagentOrders.tsx / ConsumableOrders.tsx)
- [x] 新增字段: english_name, price, category, brand
- [x] 导航栏更新 (Layout.tsx)
- [x] Dashboard 适配新订单结构

---

## Timeline

| Date | Phase | Status | Description |
|------|-------|--------|-------------|
| 2026-02-12 | Phase 1.1 | ✅ | Backend init: FastAPI + SQLModel + SQLite (WAL mode) |
| 2026-02-13 | Phase 1.2 | ✅ | JWT Auth: login, get_current_user, protected endpoints |
| 2026-02-13 | Phase 2.1-2.4 | ✅ | Order CRUD, Inventory CRUD, CAS Check, Stock-In |
| 2026-02-13 | Phase 2.5 | ✅ | ARRIVED status, Confirm Arrival API, Notes field |
| 2026-02-13 | Phase 2.6 | ✅ | Confirm Arrival Optimization: consumable/common_public complete directly |
| 2026-02-13 | Phase 3 | ✅ | Dashboard APIs: my-orders, my-borrows, pending-stockin, return-item |
| 2026-02-13 | Phase 4 | ✅ | Excel Import API: template, bulk create inventory |
| 2026-02-13 | Phase 5 | ✅ | All Frontend Pages: Login, Dashboard, Orders, Inventory, Import |
| 2026-02-13 | Bug Fix | ✅ | Login API: LoginRequest Pydantic model for JSON body |
| 2026-02-13 | Bug Fix | ✅ | Create admin user in database |
| 2026-02-13 | Bug Fix | ✅ | Dashboard: Flatten nested API response data |
| 2026-02-14 | Feature | ✅ | Manual Inventory Add: Backend API + Frontend UI |
| 2026-02-14 | Code Review | ✅ | 代码审查 - 修复7个问题 (密钥硬编码、SQL注入、prompt()、导出功能等) |
| 2026-02-14 | Code Review | ✅ | 代码审查第二轮 - 修复3个问题 (Orders.tsx prompt()、枚举比较、导出权限) |
| 2026-02-14 | Phase 7 | ✅ | 用户管理 - 软删除、启用API、搜索筛选、前端页面 |
| 2026-02-14 | Phase 8 | ✅ | 通知与提醒 - CAS预警、入库提醒、低库存UI、借用超时标记 |
| 2026-02-14 | Phase 9 设计 | ✅ | 试剂与耗材分离 - 字段设计 (english_name, price, category, brand) |
| 2026-02-14 | Phase 9 实施 | ✅ | 试剂与耗材分离 - Order 拆分、独立页面、导航更新 |
| 2026-02-16 | Code Review Refactor | ✅ | 全面代码审查重构 - 修复 P0/P1/P2 共 14 项问题 |
| 2026-02-16 | Phase 10 | ✅ | Error Boundary + 全页面服务端分页 (库存/试剂订单/耗材订单) |
| 2026-02-16 | Bug Fix | ✅ | 一键入库修复: 后端支持 APPROVED 直接入库, 耗材订单修复 API 调用 |
| 2026-02-17 | PR Review Fix | ✅ | PR Review 遗留 4 项修复: CSV参数、驳回逻辑、入库权限、common_public拦截 |
| 2026-02-18 | Frontend UX | ✅ | 隐藏 internal_code 前端展示（Inventory/Dashboard 改为仅展示 CAS） |
| 2026-02-23 | Feature | ✅ | 导入模板支持自定义 created_at 字段（入库日期） |

### Data Import (2026-02-18) ✅
- [x] 1) 完整性检查: 8599 条原始数据，CAS 异常 18 条，完全重复 19 条
- [x] 2) 数据清洗: CAS 规范化、去重、单位统一、状态校验
- [x] 3) 导入数据库: 8580 条成功写入，0 错误
- [x] 4) 统计报告: `scripts/scrape_processing_report.md`
- [x] 5) 抽样质检: 30 条样本 `scripts/scrape_qc_samples.json`

**清洗后关键指标**:
- CAS 异常: 0 | 完全重复: 0 | 有效记录: 8580 | 库存总量: 17179 条

**Last Updated**: 2026-02-23
**Status**: 导入模板支持自定义入库日期 (created_at) 字段
**Next**: 提交代码并测试验证

---

## Plans

### Code Review Refactor (2026-02-16) ✅
- [x] P0: WAL 模式通过 PRAGMA 正确启用 + foreign_keys
- [x] P0: generate_internal_code 双实现冲突清理
- [x] P0: 用户创建接口加 admin 认证
- [x] P0: Dashboard 入库按钮状态逻辑修复 (approved→确认到货, arrived→一键入库)
- [x] P0: reject/confirm-arrival 参数改为 Body 传递
- [x] P1: 删除旧 stock-in 路由 (inventory.py)
- [x] P1: 订单列表/详情接口加认证
- [x] P1: 归还数量上限校验 + borrow API 清理
- [x] P1: 路由顺序重排 + 函数名冲突修复
- [x] P2: CSV 导出改 StreamingResponse (UTF-8 BOM)
- [x] P2: CORS 从 Settings 读取 + logging 配置
- [x] P2: 前端集中映射表 (constants.ts)
- [x] P2: Token 单一来源 (Zustand persist only)
- [x] P2: spec_utils 单位规范化映射 (mL/L/μL)

### Phase 10: Error Boundary + Pagination ✅
- [x] 10.1: React Error Boundary 组件 + fallback UI (错误提示 + 刷新/返回按钮)
- [x] 10.2: 后端三个列表接口返回 `{data, total, skip, limit}` (pageSize=20)
- [x] 10.3: 前端库存页服务端分页 + Pagination UI + PaginationInfo
- [x] 10.4: 前端试剂/耗材订单页服务端分页

### PR Review Issues Fix (2026-02-17) ✅
- [x] A: excel_service.py pd.read_csv errors → encoding_errors
- [x] B: 移除 RejectRequest.reason，驳回不再覆盖 notes
- [x] C: stock_in_reagent_order APPROVED 状态增加权限检查
- [x] D: common_public 订单拦截入库 (后端 400 + 前端按钮置灰)

### Frontend 隐藏 internal_code (2026-02-18) ✅
- [x] Inventory 页面移除“编号”列
- [x] Dashboard 页面移除“编号”展示（当前借用/待入库/弹窗）
- [x] 搜索占位文案移除“编号”
- [x] Inventory/Dashboard 相关接口出参移除 internal_code
- [x] CAS 查询、手动入库返回、导出 CSV 去除 internal_code 暴露

### Future Enhancements
- [ ] Chemical compatibility check
- [ ] Batch operations (bulk stock-in, bulk return)
- [x] Advanced search and filters (2026-02-21)
- [ ] Data export reports

### Search Performance Optimization (2026-02-21) ✅
- [x] 前端优化：防抖延迟 300ms → 500ms，减少请求频率
- [x] 前端优化：添加请求版本号防止竞态条件（先发后至请求被忽略）
- [x] 后端优化：搜索结果缓存（60秒有效期，最多100条缓存）
- [x] 高级搜索：精确搜索（指定字段：名称/CAS号/位置/品牌/分类/全部）
- [x] 高级搜索：模糊搜索（忽略空格和连字符，如搜索 "64 17 5" 匹配 "64-17-5"）
