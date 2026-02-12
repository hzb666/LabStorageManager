# BACKEND_STRUCTURE.md

## Database Schema (SQLModel)

### 1. User (用户表)
* `id`: Int, PK
* `username`: String (Unique)
* `password_hash`: String
* `role`: Enum ("admin", "user")
* `full_name`: String

### 2. Order (订购表)
* `id`: Int, PK
* `type`: Enum ("reagent", "consumable")
* `cas_number`: String (Index, **Normalized**: UPPERCASE, NO SPACES)
* `name`: String
* `alias`: String (Nullable, e.g., "酒精, Ethanol")
* `specification`: String (e.g., "500ml")
* `quantity`: Int
* `applicant_id`: FK -> User
* `status`: Enum ("pending", "approved", "purchased", "stocked", "rejected")
* `image_path`: String (Thumbnail path)
* `is_hazardous`: Boolean (Default False)

### 3. Inventory (库存表 - 仅试剂)
* `id`: Int, PK
* `internal_code`: String (Unique, e.g., "CAS-01")
* `cas_number`: String (Index, Copied from Order)
* `name`: String
* `alias`: String (Copied from Order)
* `location`: String (Free Text)
* `initial_quantity`: Float (e.g., 500)
* `remaining_quantity`: Float (e.g., 200)
* `unit`: String (e.g., "ml", stored as string, case-insensitive)
* `status`: Enum ("in_stock", "borrowed", "consumed")
* `borrower_id`: FK -> User (Nullable)
* `last_borrower_id`: FK -> User (Nullable)
* `is_hazardous`: Boolean
* `image_path`: String

## Key API Logic

### POST /api/cas/check
* Input: `cas_number`
* Logic: `SELECT SUM(remaining_quantity) FROM inventory WHERE cas_number = ? AND status != 'consumed'`

### POST /api/inventory/import (Excel)
* Logic: Parse Excel -> Validate CAS format -> Bulk Create Inventory Items.