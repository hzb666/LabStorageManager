# 核心 API 与工作流

本页聚焦“对象 CRUD”和“跨步骤工作流”之间的分工。前者负责稳定的资源读写，后者负责审批、入库、完成等状态推进。理解这层分界后，新增接口时更容易判断应该放在哪个文件里。

## 路由分层

后端并不是把所有业务塞进一个大路由文件，而是按职责拆分：

- [app/api/users.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/users.py) 负责登录、用户 CRUD、头像与密码。
- [app/api/user_sessions.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/user_sessions.py) 负责设备与会话。
- [app/api/inventory.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory.py) 负责库存核心列表与详情，再通过扩展注册挂载库存补充能力。
- [app/api/reagent_orders.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders.py) 负责试剂订单的创建、列表与编辑。
- [app/api/reagent_orders_workflow.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders_workflow.py) 负责审批、到货、入库和删除。
- [app/api/consumable_orders.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/consumable_orders.py) 同时承担耗材订单 CRUD 与状态流转。
- [app/api/announcements.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/announcements.py)、[app/api/error_logs.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/error_logs.py)、[app/api/user_logs.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/user_logs.py)、[app/api/cart_sync.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/cart_sync.py)、[app/api/events.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/events.py) 则处理外围能力。
- [app/api/common_shelf.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/common_shelf.py)、[app/api/chemical_name_map.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/chemical_name_map.py) 负责常用货架分组与 CAS 主数据维护。

## 试剂工作流

试剂链路是系统里最重的业务流：

1. `POST /api/reagent-orders/` 创建订单。
2. `GET /api/reagent-orders/cas-overview/{cas_number}` 在创建或编辑时提供同 CAS 的库存与订单提示。
3. 管理员通过 `POST /api/reagent-orders/{id}/approve` 或 `reject` 进入审批分支。
4. 申请人或管理员在到货后调用 `POST /api/reagent-orders/{id}/confirm-arrival`。
5. 需要转库存的订单再调用 `POST /api/reagent-orders/{id}/stock-in`，把订单数据复制到 `inventory`。

这里的关键约束不是状态名字，而是“订单转库存是 copy，不是 move”。订单记录必须保留，用于审计、回溯和统计。

## 耗材工作流

耗材链路刻意更短：

1. 创建耗材订单。
2. 管理员审批通过或驳回。
3. 审批通过后直接 `complete`，不进入瓶级库存管理。

因此 [app/api/consumable_orders.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/consumable_orders.py) 同时承担查询、修改、审批与完成逻辑。它的重点是表单校验、导出与状态过滤，而不是库存生成。

## 库存工作流

库存接口是一组复合能力，而不是单一 CRUD：

- 列表查询同时承担分页、排序、短 TTL 缓存、CAS 搜索、文本搜索、FTS 搜索和拼音排序。
- `manual-add` 支持管理员绕过订单链路直接入库。
- `borrow` 和 `return` 会修改状态、写借还历史，并通过 SSE 通知前端。
- `dashboard/my-borrows` 和 `dashboard/pending-stockin` 为首页和仪表盘聚合数据。
- `import/template` 与 `import` 组成 Excel 导入链路。
- 常用货架由独立的 `common_shelf` 表（`CommonShelf` 模型）维护，按 `CAS + 品牌 + 规格` 形成分组键 `group_key`，并由 `/api/common-shelf/*` 提供分组级与瓶级操作。
- 手动加瓶前会校验 CAS 主数据；若缺失主数据，需要先走 `/api/chemical-name-map` 完成补录，避免常用货架出现无法稳定展示名称的脏数据。

## 事件驱动补充层

路由不是唯一的更新出口。很多接口在数据库提交后还会广播 SSE：

- 库存创建、编辑、删除、借用、归还
- 常用货架创建、编辑、删除、加瓶、扣减 1 瓶
- 试剂订单与耗材订单的创建、更新、删除
- 仪表盘聚合数据更新

这意味着前端页面不是“请求一次然后静态展示”，而是以 HTTP 快照为基线，再通过 SSE 做增量修正或 stale 提示。

## 购物车同步

浏览器扩展导入链路分为“批次桥接”和“订单创建”两段：

1. 扩展把采集到的商品批次写入 `chrome.storage.local`。
2. `import-bridge.js` 在 `/cart-import` 页面把批次复制到页面 `localStorage`。
3. 前端导入页逐条调用 `reagentOrderAPI.create` 或 `consumableOrderAPI.create`。
4. `POST /api/cart-sync` 提供后端匹配分析能力；导入落库统一走标准订单创建接口。

扩展、前端导入页和后端路由之间通过批次数据衔接，详见 [购物车同步扩展](/dev-guide/cart-sync)。

## 日志、错误与公告

- `user_logs` 用短期令牌保护用户操作日志查询，避免直接暴露日志文件。
- `error_logs` 给管理员提供错误观测入口。
- `announcements` 负责首页公告流，同时承担图片上传、可见性控制与置顶规则。

## 状态机与边界

### 试剂订单

- 状态枚举：`PENDING/APPROVED/REJECTED/ARRIVED/STOCKED`。
- 审批：`/{id}/approve` 与 `/{id}/reject` 仅管理员可用，更新状态并写入操作日志。
- 到货确认：`/{id}/confirm-arrival` 可直接进入暂存或常用货架，状态置为 `ARRIVED`。
- 一键入库：`/{id}/stock-in` 将订单复制到 `inventory`，保留 `source_order_id`，支持写入常用货架或普通库存，入库后状态变为 `STOCKED`。
- SSE 与缓存：审批、到货、入库都会通过 `sse_manager` 推送 `reagent_orders` 房间并清理列表缓存。

### 耗材订单

- 状态：`PENDING/APPROVED/REJECTED/COMPLETED`。
- 审批/完成：`/{id}/approve`、`/{id}/reject`、`/{id}/complete`，完成后直接 `status=COMPLETED`，不进入库存。
- SSE 与缓存：同样推送 `consumable_orders` 房间并清理缓存。

### 库存与借用

- 入库来源：手动新增、批量导入、试剂订单复制；都会预计算拼音与 internal_code，并可写入常用货架标记。
- 借用/归还：校验当前 `borrower_id` 和数量，借用会记录 `borrow_log`，公用账号会弹出选择借用人；归还/消费会更新数量与 `last_borrower_id`。
- 删除保护：已借出状态禁止编辑/删除，需先归还。
- FTS 与缓存：库存写操作会重建缓存并通过 SSE 推送 `inventory` / `common_shelf` 房间。

### 购物车导入

- 主链路：`/cart-import` 页面逐条提交标准试剂/耗材订单创建请求。
- 匹配分析：`POST /api/cart-sync` 按 CAS / 名称匹配已有试剂订单，返回匹配结果。
- 事件：标准订单接口会广播 `reagent_orders` 或 `consumable_orders` 更新。

### 导入导出

- Excel 导入：`/api/inventory/import/preview` 和 `/api/inventory/import/confirm` 支持预览后确认，单文件 2MB，逐行错误返回；确认成功后推送 SSE 并刷新缓存。
- 导出：库存与订单都提供导出接口，走后台生成文件再下载。

## 边界与风险

- 订单复制入库必须保留 `source_order_id`，否则审计链会断裂。
- 常用货架与普通库存字段不一致时，前端列表和 SSE 房间要同步更新，否则会出现数据不一致。
- 批量导入需校验文件大小与行数，超限会返回 413/400；模板变更也要同步前端下载链接。
- 新增命名路由时，要注意它不能被 `/{id}` 路由吞掉。

## 验证建议

- 试剂流程：新建 -> 审批 -> 到货 -> 入库，确认库存生成且 `source_order_id` 回填。
- 耗材流程：新建 -> 审批 -> 完成，确认不会生成库存记录。
- 借用流程：借用后状态应锁定编辑，归还后可恢复；日志应记录 borrower/returner。
- 购物车导入：模拟扩展提交批次，确认页面能逐条生成标准试剂或耗材订单。

## 二次开发建议

- 新增业务接口时，先判断它是“对象 CRUD”还是“工作流动作”，后者通常更适合单独放在 workflow 路由中。
- 任何会改动列表结果的接口，都要同时考虑缓存失效和 SSE 广播。
- 库存相关新路由若是命名路由，必须优先于 `/{inventory_id}` 注册。
- 面向前端或扩展的正式接口，最好同时在 [API 参考](/backend/api-reference) 中登记。

## 参考代码

- [app/api/announcements.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/announcements.py)
- [app/api/cart_sync.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/cart_sync.py)
- [app/api/consumable_orders.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/consumable_orders.py)
- [app/api/error_logs.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/error_logs.py)
- [app/api/events.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/events.py)
- [app/api/inventory.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory.py)
- [app/api/reagent_orders.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders.py)
- [app/api/reagent_orders_workflow.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders_workflow.py)
- [app/api/user_logs.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/user_logs.py)
- [app/api/user_sessions.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/user_sessions.py)
- [app/api/users.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/users.py)
- [app/models/consumable_order.py](https://github.com/hzb666/LabStorageManager/blob/main/app/models/consumable_order.py)
- [app/models/reagent_order.py](https://github.com/hzb666/LabStorageManager/blob/main/app/models/reagent_order.py)
