# APP_FLOW.md

## 1. 登录
* Landing Page -> Login (JWT Auth) -> **User Dashboard (首页)**

## 2. 试剂订购流程
* Nav: "试剂订购" -> Click "创建订单"
    * -> Form: Name, English Name, CAS (Auto-check), Category, Brand, Spec, Qty, Price, Order Reason, Notes, Image -> Submit.
    * -> CAS 输入后自动检查库存和现有订单，显示预警
* Admin View: "试剂订购" -> Filter "Pending" -> Click "审批/驳回".
    * 驳回原因保存到订单备注
* Arrival: User finds "Approved" item in "个人中心" -> Click "确认到货"
    * -> If order_reason == "common_public": Auto complete (status = stocked)
    * -> Others: Status = "arrived" (已到货但未入库)
* Stock-in: Click "一键入库" -> System generates N Inventory items

## 3. 耗材订购流程
* Nav: "耗材订购" -> Click "创建订单"
    * -> Form: Name, English Name, Category, Brand, Spec, Qty, Price, Order Reason, Notes -> Submit.
    * (耗材无需 CAS 号)
* Admin View: "耗材订购" -> Filter "Pending" -> Click "审批/驳回".
* Completion: User clicks "确认完成" -> Status = "completed" (耗材不入库)

## 4. 一键入库 (试剂)
* Nav: "试剂订购" -> Status "已到货" -> Click "一键入库"
    * -> System generates N Inventory items (N = Qty).
    * -> Internal Code: CAS号-日期-序号 (e.g., "64175-250113-01")
    * -> Each item: initial_quantity = spec_value, unit = spec_unit
    * -> Update Order status = "stocked"

## 5. 借用流程
* Nav: "库存管理" -> Search (CAS/Name/Code) -> Result List.
* Action: Click "借用"
    * -> System validation: Only "in_stock" items can be borrowed
    * -> Status: `Borrowed`, borrower_id: Current User
    * -> Create BorrowLog record (borrow_time, quantity_borrowed)

## 6. 归还流程 (核心交互)
* **Dashboard**: User sees "当前借用".
* Action: Click "归还" on card
    * -> Modal: Input "剩余数量" + 单位
    * -> If remaining <= 0: Status = `Consumed`
    * -> If remaining > 0: Status = `in_stock`
    * -> Update BorrowLog (return_time, quantity_returned)
    * -> Update Inventory.last_borrower_id = Current User
    * -> **Low Quantity Warning**: If remaining < 20%, show toast warning

## 7. 借用历史
* Nav: Item Detail -> "Borrow History"
* Display: BorrowLog records showing last 10 borrowers
* Info: borrow_time, return_time, quantities

## 8. 位置管理
* Nav: Dashboard "待入库位置分配" -> Select item -> Input Location -> Save.
* Logic: If location is set, clear `temporary_keeper_id`.

## 9. CSV/Excel 批量导入
* Nav: "库存管理" -> Click "批量导入" -> Navigate to /import page
* Supported Formats: .csv, .xlsx, .xls
* Expected Columns:
    * cas_number: CAS号 (required)
    * name: 名称 (required)
    * english_name: 英文名 (optional)
    * alias: 别名 (optional)
    * category: 分类 (optional)
    * brand: 品牌 (optional)
    * specification: 规格，如 "500ml" (required)
    * initial_quantity: 初始数量 (required)
    * location: 存放位置 (optional)
    * is_hazardous: 是否危险品 (optional, default false)
    * price: 单价 (optional)
    * notes: 备注 (optional)
* Template: CSV download with UTF-8 BOM for Excel compatibility
* Result:
    * Success: Items created with auto-generated internal codes
    * Error: Row-level error messages displayed via toast + result panel

## 10. 手动入库
* Nav: "库存管理" -> Click "手动入库"
    * -> Modal: CAS号、名称、规格、瓶数、位置等
    * -> System generates internal codes automatically
    * -> 不经过订单流程直接入库

## 11. 库存导出
* Nav: "库存管理" -> Click "导出"
    * -> 下载全部库存 CSV (含编号、CAS、名称、英文名、分类、品牌、价格等完整字段)
    * -> 仅管理员可导出
