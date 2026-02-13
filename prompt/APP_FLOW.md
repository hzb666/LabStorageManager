# APP_FLOW.md

## 1. 登录
* Landing Page -> Login (JWT Auth) -> **User Dashboard (首页)**

## 2. 订购流程
* Nav: "试剂订购" -> Click "新建申请"
    * -> Form: Name, CAS (Auto-check), Spec, Qty, Order Reason, Target Location, Notes, Image -> Submit.
* Admin View: "试剂订购" -> Filter "Pending" -> Click "Pass/Reject".
* Arrival: User finds "Approved" item in "Personal Page" -> Click "Confirm Receipt" (确认到货)
    * -> Frontend checks order_reason:
        * If "common_public": Auto trigger stock-in (no popup)
        * If others: Show popup "是否一键入库？" -> User confirms -> Trigger stock-in
    * -> If consumable: Mark as completed (不入库)
    * -> If reagent: Status = "arrived" (已到货但未入库)
    * -> If order_reason != "common_public", trigger stock-in notification.

## 3. 一键入库
* Nav: "待入库" or From notification -> Select order -> Click "Stock In" (一键入库)
    * -> System generates N Inventory items (N = Qty).
    * -> If target location is empty, record temporary_keeper = current_user.
    * -> Update Order status = "stocked"

## 4. 借用流程
* Nav: "库存查询" -> Search (CAS/Name/Alias) -> Result List.
* Action: Click "借用"
    * -> System validation: Only "in_stock" items can be borrowed
    * -> Status: `Borrowed`, borrower_id: Current User
    * -> Create BorrowLog record (borrow_time, quantity_borrowed)

## 5. 归还流程 (核心交互)
* **Dashboard**: User sees "My Borrowed Items".
* Action: Click "归还" on card
    * -> Modal: Input "Used Amount" (e.g., 200) or "Remaining Amount" (e.g., 300)
    * -> System auto-calculates remaining, checks if consumed
    * -> If remaining <= 0: Status = `Consumed`
    * -> If remaining > 0: Status = `in_stock`
    * -> Update BorrowLog (return_time, quantity_returned)
    * -> Update Inventory.last_borrower_id = Current User
    * -> **Low Quantity Warning**: If remaining < 20%, show alert

## 6. 借用历史
* Nav: Item Detail -> "Borrow History"
* Display: BorrowLog records showing last 10 borrowers
* Info: borrow_time, return_time, quantities

## 7. 位置管理
* Nav: "待入库" -> Select item -> Input/Update Location -> Save.
* Logic: If location is set, clear `temporary_keeper_id`.

## 8. Excel 批量导入
* Nav: "库存管理" -> Click "批量导入" -> Upload Excel file
* Expected Columns:
    * cas_number: CAS号 (required)
    * name: 名称 (required)
    * specification: 规格，如 "500ml" (required)
    * initial_quantity: 初始数量 (required)
    * alias: 别名 (optional)
    * location: 存放位置 (optional)
    * is_hazardous: 是否危险品 (optional, default false)
    * notes: 备注 (optional)
* Validation:
    * CAS format validation (uppercase, no spaces)
    * Specification parsing (value + unit)
    * Quantity must be > 0
* Result:
    * Success: Items created with auto-generated internal codes
    * Error: Row-level error messages returned
    * Frontend: Show progress and error summary
