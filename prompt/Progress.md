# Progress.md

## Phase 1: Infrastructure
- [x] 1.1: Init FastAPI + SQLModel + SQLite. **Action**: Configure `sqlite_url` with `?mode=wal`. ✓
- [x] 1.2: Implement `User` model & Auth (JWT). ✓
- [x] 1.2b: **Full JWT Authentication**: Replace all hardcoded `user_id=1` with `get_current_user` dependency. ✓
- [x] 1.3: **Image Service**: Create `compress_image(file)` using Pillow (Max 100KB). ✓
- [x] 1.4: **CAS Utility**: Create `normalize_cas(str)` function. ✓

## Phase 2: Ordering & Inventory Core
- [x] 2.1: Implement `Order` CRUD API (Create, Read, Update, Delete).
- [x] 2.2: Implement `CAS Check` API (Aggregate stats for inventory).
- [x] 2.3: Implement `Inventory` CRUD API with Borrow/Return.
- [x] 2.4: Implement `Stock-In` Logic: Loop `quantity` times to create Inventory items.
- [x] 2.5: **Workflow Adjustment**: Add ARRIVED status + Confirm Arrival API + Notes field.

## Phase 3: User Dashboard & Interactions
- [x] 3.1: API: `get_user_dashboard_data` (my-borrows, pending-stockin, my-orders).
- [x] 3.2: API: `return_item` (Update remaining quantity, BorrowLog).
- [x] 3.3: Frontend: Build Dashboard Cards & Return Modal (Completed).

## Phase 4: Excel Import/Export
- [x] 4.1: Backend: Pandas Excel Import/Export logic.
- [x] 4.2: Frontend: Excel Upload button & Data mapping UI.

## Phase 5: Frontend
- [x] 5.1: Init React + Shadcn/UI + TanStack Table. ✓
- [x] 5.2: Frontend: Order Form with CAS auto-check. ✓
- [x] 5.3: Frontend: Inventory Table with Virtual Scrolling. ✓

---
**Last Updated**: 2025-02-13 14:09 (UTC+8)

## Timeline
- 2025-02-13 13:45: Phase 1.2b - Full JWT Authentication enabled (orders.py, inventory.py)
- 2025-02-13 14:09: Phase 5.1 - Frontend initialized (React + Vite + TypeScript + Shadcn/UI)
- 2025-02-13 09:27: Phase 3.3 - Dashboard Return Modal implemented

| Date | Phase | Status | Description |
|------|-------|--------|-------------|
| 2026-02-12 | Phase 1.1 | ✅ | Backend init: FastAPI + SQLModel + SQLite (WAL mode) |
| 2026-02-13 | Phase 1.2 | ✅ | JWT Auth: login, get_current_user, protected endpoints |
| 2026-02-13 | Phase 2.1-2.4 | ✅ | Order CRUD, Inventory CRUD, CAS Check, Stock-In |
| 2026-02-13 | Phase 2.5 | ✅ | ARRIVED status, Confirm Arrival API, Notes field |
| 2026-02-13 | Phase 3 | ✅ | Dashboard APIs: my-orders, my-borrows, pending-stockin, return-item |
| 2026-02-13 | Phase 4 | ✅ | Excel Import API: template, bulk create inventory |

**Last Updated**: 2026-02-13
**Status**: Phase 5 Completed - All Frontend Pages Implemented
**Next**: Phase 6 - Admin Management

**Verified APIs**:
- `POST /api/orders/` - Create order
- `POST /api/orders/{id}/approve` - Approve order
- `POST /api/orders/{id}/reject` - Reject order
- `POST /api/orders/{id}/confirm-arrival` - Confirm arrival
- `POST /api/orders/{id}/stock-in` - Stock-in to inventory
- `GET /api/orders/dashboard/arrived-orders` - Get arrived orders
- `GET /api/orders/dashboard/my-orders` - Get user's order progress (NEW)
- `GET /api/inventory/cas/{cas_number}` - CAS inventory check
- `POST /api/inventory/{id}/borrow` - Borrow item
- `POST /api/inventory/{id}/return` - Return item
- `GET /api/inventory/dashboard/my-borrows` - User's borrows
- `GET /api/inventory/dashboard/pending-stockin` - Items pending stock-in
- `GET /api/inventory/import/template` - Get Excel import template
- `POST /api/inventory/import` - Import inventory from Excel (NEW)

**Key Changes (Phase 2.5)**:
- Order status: Removed `PURCHASED`, Added `ARRIVED` status
- Workflow: Approval → Arrival Confirmation → Stock-in
- Added `notes` field to Order and Inventory models
- New APIs: Confirm Arrival, Arrived Orders Dashboard

---

## Plans

### Immediate Next Steps
1. **Phase 6: Admin Management**
   - [ ] User Management (CRUD, role assignment)
   - [ ] System Settings
   - [ ] Data Backup/Restore

2. **Phase 7: Advanced Features**
   - [ ] Low stock alerts and notifications
   - [ ] Batch operations (bulk stock-in, bulk return)
   - [ ] Audit log and activity tracking

### Future Enhancements
- [ ] Advanced search and filters
- [ ] Data export reports
- [ ] Multi-location support
- [ ] Integration with lab instruments

