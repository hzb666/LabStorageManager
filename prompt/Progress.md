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

### Phase 6: Admin Management

#### 6.1 User Management API Design

**User Model Extensions (Optional)**:
- `last_login`: datetime (Nullable)
- `login_count`: int (Default 0)
- `department`: string (Nullable)
- `phone`: string (Nullable)
- `email`: string (Nullable)

**User Management APIs**:

| Endpoint | Method | Description | Auth |
|----------|--------|-------------|------|
| `/api/admin/users` | GET | List users with pagination & filters | Admin |
| `/api/admin/users` | POST | Create new user | Admin |
| `/api/admin/users/{id}` | GET | Get user details | Admin |
| `/api/admin/users/{id}` | PUT | Update user | Admin |
| `/api/admin/users/{id}` | DELETE | Deactivate user (soft delete) | Admin |
| `/api/admin/users/{id}/activate` | POST | Activate deactivated user | Admin |
| `/api/admin/users/{id}/reset-password` | POST | Reset user password | Admin |
| `/api/admin/users/{id}/role` | PUT | Update user role | Admin |

**Query Parameters for GET `/api/admin/users`**:
- `page`: int (default 1)
- `page_size`: int (default 20)
- `role`: string (filter by role)
- `is_active`: bool (filter by status)
- `search`: string (search by username/full_name)

#### 6.2 User Statistics API

| Endpoint | Method | Description | Auth |
|----------|--------|-------------|------|
| `/api/admin/users/stats` | GET | User statistics | Admin |
| `/api/admin/users/{id}/activity` | GET | User activity log | Admin |

**Stats Response**:
```json
{
  "total_users": 50,
  "active_users": 45,
  "inactive_users": 5,
  "admins": 3,
  "regular_users": 47,
  "recent_logins_7d": 30
}
```

#### 6.3 Activity/Audit Log API

**AuditLog Model**:
- `id`: int, PK
- `user_id`: FK -> User
- `action`: string (e.g., "order_create", "inventory_borrow", "user_login")
- `resource_type`: string (e.g., "order", "inventory", "user")
- `resource_id`: int
- `details`: JSON (Nullable)
- `ip_address`: string (Nullable)
- `created_at`: datetime

**Audit Log APIs**:
| Endpoint | Method | Description | Auth |
|----------|--------|-------------|------|
| `/api/admin/audit-logs` | GET | List audit logs with filters | Admin |
| `/api/admin/audit-logs/stats` | GET | Audit log statistics | Admin |

**Query Parameters**:
- `user_id`: int (filter by user)
- `action`: string (filter by action type)
- `resource_type`: string
- `start_date`: datetime
- `end_date`: datetime
- `page`, `page_size`: pagination

#### 6.4 Frontend: Admin User Management Page

**Features**:
- User list table with sorting/filtering
- Create user modal
- Edit user dialog
- Reset password dialog
- Toggle user active status
- Change user role
- User activity view

**UI Components**:
- `UsersTable.tsx` - TanStack Table with all columns
- `CreateUserModal.tsx` - Form to create new user
- `EditUserDialog.tsx` - Dialog to edit user details
- `ResetPasswordDialog.tsx` - Dialog to reset user password
- `UserActivityLog.tsx` - Show user's activity history

### Phase 7: Advanced Features

- [ ] Low stock alerts and notifications
- [ ] Batch operations (bulk stock-in, bulk return)
- [ ] Advanced search and filters
- [ ] Data export reports

### Future Enhancements
- [ ] Multi-location support
- [ ] Integration with lab instruments
- [ ] Mobile app (PWA)
- [ ] Barcode/QR code scanning
- [ ] Expiration date tracking
- [ ] Chemical compatibility check

