# 业务流程

## 试剂主流程

```mermaid
flowchart LR
    Create["提交试剂订单"] --> Pending["pending"]
    Pending --> Approved["approved"]
    Approved --> Arrived["confirm-arrival"]
    Arrived --> StockIn["stock-in"]
    StockIn --> Inventory["生成库存记录"]
    Inventory --> Borrow["借用"]
    Borrow --> Return["归还"]
```

说明：

- `frontend` 的 `ReagentOrders` 页面通过 `reagentOrderAPI.list/create/approve/confirmArrival/stockIn` 访问后端。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders.py" /> 提供试剂订单基础 CRUD，<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders_workflow.py" /> 提供审批、到货和入库。
- `confirm-arrival` 会根据订单原因和存储信息决定直接入库、进入常用货架或暂存。
- `stock-in` 会把试剂订单复制为 `Inventory` 记录，并同步库存状态、常用货架标记、剩余量和拼音字段。
- 借用与归还会写入 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/models/inventory.py" /> 中的 `BorrowLog`，并通过 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory.py" /> 更新库存状态。

## 耗材主流程

```mermaid
flowchart LR
    Create["提交耗材订单"] --> Pending["pending"]
    Pending --> Approved["approved"]
    Approved --> Completed["completed"]
```

说明：

- 耗材从 `frontend` 的 `ConsumableOrders` 页面进入 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/consumable_orders.py" />。
- 该接口负责创建、更新、审批、拒绝、完成、查询与导出。
- `complete` 仅允许申请人或管理员调用，并要求订单处于已审批状态。
- 耗材不生成库存记录，数据保留在 `consumable_order` 表中。

## 浏览器插件导入流程

```mermaid
flowchart LR
    Cart["试剂平台购物车"] --> Popup["插件 popup"]
    Popup --> Storage["chrome.storage.local"]
    Storage --> Bridge["import-bridge.js"]
    Bridge --> PageCache["cart_import_batch_latest"]
    PageCache --> Import["/cart-import 页面"]
    Import --> ReagentApi["reagentOrderAPI.create"]
    Import --> ConsumableApi["consumableOrderAPI.create"]
    ReagentApi --> ReagentOrders["app/api/reagent_orders.py"]
    ConsumableApi --> ConsumableOrders["app/api/consumable_orders.py"]
```

说明：

- 浏览器插件通过 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/content/script.js" /> 抓取购物车数据，并写入 `chrome.storage.local.import_batch_latest`。
- `/cart-import` 页面再通过 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/content/import-bridge.js" /> 读取页面缓存。
- 前端导入页逐条调用标准的 `reagentOrderAPI.create` 或 `consumableOrderAPI.create`，由试剂订单与耗材订单路由完成落库。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/cart_sync.py" /> 提供 `/api/cart-sync`，用于匹配分析场景。
- 导入前会做基础校验和标准化，减少重复和脏数据进入数据库。

## 库存借用与常用货架

```mermaid
flowchart LR
    InventoryScreen["库存/常用货架页"] --> Borrow["POST /api/inventory/{id}/borrow"]
    Borrow --> BorrowLog["写入 BorrowLog"]
    BorrowLog --> Return["POST /api/inventory/{id}/return"]
    Return --> InventoryUpdate["remaining_quantity/remaining_percent 更新"]
    InventoryUpdate --> SSE["SSERoom.INVENTORY / SSERoom.COMMON_SHELF"]
```

说明：

- `inventory.py` 提供借用、归还、手动添加、导入和导出等接口。
- 常用货架由 `register_common_shelf` 提供，前端 `CommonShelf` 页面只订阅相关 SSE 房间。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/sse_manager.py" /> 负责广播 `inventory` 和 `common_shelf` 相关事件，前端通过 `useSSE` 和 `sseStore` 处理重复、缺失和 stale 状态。

## 单个库存操作记录

```mermaid
flowchart LR
    ExpandedRow["库存展开行：记录"] --> Route["/inventory/{internalCode}"]
    Route --> Metadata["按内部码读取库存摘要"]
    Route --> Timeline["GET /api/inventory/code/{internalCode}/timeline"]
    Timeline --> LogTimeline["查询主库 LogTimeline"]
    LogTimeline --> Sources["InventoryOperationLog + BorrowLog"]
    Sources --> Table["时间倒序表格与展开详情"]
```

说明：

- 所有已登录账号都能查看；路由以内部码定位库存，库存不存在时返回 `404`。
- 服务只投影入库、编辑和借用三类记录。归还更新原 `BorrowLog`，所以同一次借还只显示一行。
- 编辑摘要列出发生变化的字段，展开详情复用操作日志组件展示修改前后的值。
- 搜索在操作人、详情摘要和借用状态中匹配，分页结果按时间和时间线 ID 倒序。
- 查询只访问主数据库，不读取归档库；主库实际保留范围决定页面可见记录范围。

## 实验步骤查库存流程

```mermaid
flowchart LR
    Procedure["实验步骤文本"] --> Extract["LLM 提取化学品"]
    Extract --> Resolve["PubChem 解析 CAS"]
    Resolve --> Search["按候选 CAS 查询库存"]
    Search --> Review["用户核对解析与库存结果"]
```

说明：

- 库存页通过 `/api/procedure-inventory-search/extract` 提取化学品，再通过 `/resolve` 解析 CAS 候选。
- 解析结果会带入库存页，用户结合实验原文、CAS 候选和库存命中情况进行核对。
- 单次实验步骤最多 5000 个字符，解析列表最多 50 项，每项最多保留 5 个 CAS 候选。
- 前端临时结果按用户保存在 `sessionStorage` 中，10 分钟后失效，退出登录时清除。
- 后端仅记录模型、提供方、尝试次数和 token 用量，不保存实验步骤原文与模型响应。

## 双轨状态机对照

| 维度 | 试剂订单 | 耗材订单 |
| --- | --- | --- |
| 状态枚举 | `pending/approved/rejected/arrived/stocked` | `pending/approved/rejected/completed` |
| 是否进入库存 | 是（`stock-in` 后复制为 `Inventory`） | 否 |
| 核心校验字段 | `cas_number`、规格解析、拼音字段 | `product_number`、规格文本、拼音字段 |
| 角色敏感动作 | 审批/驳回通常由管理员执行 | 审批/驳回/完成受角色控制 |
| 实时事件 | `reagent_orders` + `inventory` + `common_shelf` | `consumable_orders` |

## 流程一致性校验点

- 订单转库存必须保留订单审计记录。
- `confirm-arrival` 的不同分支需要保持互斥且可追溯。
- `common-shelf` 更新要关注分组字段和并发修改。
- 借还与消耗要写 `BorrowLog`，不能只改库存数量。
- 前端局部 patch 失败时要标记 stale，并允许用户刷新。
- 实验步骤查库存需要同时验证字符上限、解析条目上限、调用频率和 LLM 配置状态。

## 参考代码
- [app/api/cart_sync.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/cart_sync.py)
- [app/api/consumable_orders.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/consumable_orders.py)
- [app/api/inventory.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory.py)
- [app/api/inventory_timeline.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory_timeline.py)
- [app/api/procedure_inventory_search.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/procedure_inventory_search.py)
- [app/api/reagent_orders_workflow.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders_workflow.py)
- [app/api/reagent_orders.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders.py)
- [app/models/inventory.py](https://github.com/hzb666/LabStorageManager/blob/main/app/models/inventory.py)
- [app/services/inventory_timeline.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/inventory_timeline.py)
- [app/services/sse_manager.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/sse_manager.py)
- [browser-extension/content/import-bridge.js](https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/content/import-bridge.js)
- [browser-extension/content/script.js](https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/content/script.js)
