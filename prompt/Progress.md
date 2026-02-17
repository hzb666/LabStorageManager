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

**Last Updated**: 2026-02-16
**Status**: Phase 1-10 全部完成，一键入库 Bug 修复
**Next**: Future Enhancements (化学兼容性检查、批量操作等)

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

### Future Enhancements
- [ ] Chemical compatibility check
- [ ] Batch operations (bulk stock-in, bulk return)
- [ ] Advanced search and filters
- [ ] Data export reports
