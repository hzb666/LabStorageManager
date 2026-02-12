# APP_FLOW.md

## 1. 登录
* Landing Page -> Login (JWT Auth) -> **User Dashboard (首页)**

## 2. 订购流程
* Nav: "试剂订购" -> Click "新建申请"
    * -> Form: Name, English Name, CAS (Auto-check), Spec, Qty, Image -> Submit.
* Admin View: "试剂订购" -> Filter "Pending" -> Click "Pass/Reject".
* Arrival: Finds "Purchased" item in "Personal Page" -> Click "Stock In" (一键入库) -> System generates Inventory items.

## 3. 借用流程
* Nav: "库存查询" -> Search (CAS/Name/Alias) -> Result List.
* Action: Click "借用"
    * -> System validation (is available?) -> Status: `Borrowed`, Holder: Current User.

## 4. 归还流程 (核心交互)
* **Dashboard**: User sees "My Borrowed Items".
* Action: Click "归还" on card
    * -> Modal: Input "Remaining Amount" (e.g. 300) -> Confirm.
    * -> System: Updates `remaining`, clears `holder`, sets `last_user`.