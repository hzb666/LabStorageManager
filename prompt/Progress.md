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

---

## Timeline

| Date | Phase | Status | Description |
|------|-------|--------|-------------|
| 2026-02-12 | Phase 1.1 | ✅ | Backend init: FastAPI + SQLModel + SQLite (WAL mode) |
| 2026-02-13 | Phase 1.2 | ✅ | JWT Auth: login, get_current_user, protected endpoints |
| 2026-02-13 | Phase 2.1-2.4 | ✅ | Order CRUD, Inventory CRUD, CAS Check, Stock-In |
| 2026-02-13 | Phase 2.5 | ✅ | ARRIVED status, Confirm Arrival API, Notes field |
| 2026-02-13 | Phase 3 | ✅ | Dashboard APIs: my-orders, my-borrows, pending-stockin, return-item |
| 2026-02-13 | Phase 4 | ✅ | Excel Import API: template, bulk create inventory |
| 2026-02-13 | Phase 5 | ✅ | All Frontend Pages: Login, Dashboard, Orders, Inventory, Import |

**Last Updated**: 2026-02-13
**Status**: Phase 5 Completed - All Frontend Pages Implemented
**Next**: Phase 6 - Admin Management

---

## Plans

### Phase 6: Admin Management
- [ ] User Management (CRUD, role assignment)
- [ ] User Statistics API
- [ ] Audit/Activity Log
- [ ] Frontend Admin User Management Page

### Phase 7: Advanced Features
- [ ] Low stock alerts and notifications
- [ ] Batch operations
- [ ] Advanced search and filters
- [ ] Data export reports

### Future Enhancements
- [ ] Multi-location support
- [ ] Integration with lab instruments
- [ ] Mobile app (PWA)
- [ ] Barcode/QR code scanning
- [ ] Expiration date tracking
- [ ] Chemical compatibility check
