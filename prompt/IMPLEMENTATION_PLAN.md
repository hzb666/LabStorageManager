# IMPLEMENTATION_PLAN.md

## Phase 1: Infrastructure ✅ COMPLETED
- [x] 1.1: Init FastAPI + SQLModel + SQLite. **Action**: Configure `sqlite_url` with `?mode=wal`.
- [x] 1.2: Implement `User` model & Auth (JWT).
- [x] 1.3: **Image Service**: Create `compress_image(file)` using Pillow (Max 100KB).
- [x] 1.4: **CAS Utility**: Create `normalize_cas(str)` function.

## Phase 2: Ordering & CAS Check
- [ ] 2.1: Implement `Order` CRUD API.
- [ ] 2.2: Implement `CAS Check` API (Aggregate stats).
- [ ] 2.3: Frontend: React Order Form with auto-check Logic.

## Phase 3: Inventory Core
- [ ] 3.1: Implement `Inventory` Model.
- [ ] 3.2: **Stock-In Logic**: Loop `quantity` times to create Inventory items. Copy `image_path`.
- [ ] 3.3: Frontend: TanStack Table implementation with Virtual Scrolling.

## Phase 4: User Dashboard & Interactions
- [ ] 4.1: API: `get_user_dashboard_data`.
- [ ] 4.2: API: `return_item` (Update remaining quantity).
- [ ] 4.3: Frontend: Build Dashboard Cards & Return Modal.

## Phase 5: Advanced Features
- [ ] 5.1: Backend: Pandas Excel Import/Export logic.
- [ ] 5.2: Frontend: Excel Upload button & Data mapping UI.

---

## Implementation Notes

### Completed (2026-02-13)
- FastAPI backend running on http://localhost:8000
- SQLite database with WAL mode enabled
- User authentication (JWT) working
- Models: User, Order, Inventory
- Services: auth_service, cas_utils, image_service
- Fixed module import paths (backend.app.*)
- Fixed JWT subject type (string)
- Installed dependencies: ecdsa, pyasn1, rsa, python-multipart, bcrypt==3.2.2, cryptography>=3.4,<44
