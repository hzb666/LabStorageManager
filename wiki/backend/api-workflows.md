# 核心 API 与工作流

## 路由分层方式

后端并不是把所有业务都塞进一个大路由文件，而是沿着“对象 + 工作流”拆分：

- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/users.py" /> 负责登录、用户 CRUD、头像与密码。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/user_sessions.py" /> 负责设备与会话。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory.py" /> 负责库存核心列表与详情，再通过 `register_inventory_extended_routes` 和 `register_common_shelf` 挂上扩展库存能力。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders.py" /> 负责试剂订单的创建、列表与编辑，<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders_workflow.py" /> 专门负责审批、到货、入库和删除。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/consumable_orders.py" /> 同时承担耗材订单的 CRUD 与状态流转，因为它没有试剂那样长的后置链路。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/announcements.py" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/error_logs.py" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/user_logs.py" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/cart_sync.py" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/events.py" /> 则分别处理外围能力。

## 试剂工作流

试剂链路是整套系统里最重的业务流：

1. `POST /api/reagent-orders/` 创建订单。
2. `GET /api/reagent-orders/cas-overview/{cas_number}` 在创建或编辑时给出同 CAS 的库存/订单风险提示。
3. 管理员通过 `POST /api/reagent-orders/{id}/approve` 或 `reject` 进入审批分支。
4. 申请人或管理员在到货后调用 `POST /api/reagent-orders/{id}/confirm-arrival`。
5. 需要转库存的订单再调用 `POST /api/reagent-orders/{id}/stock-in`，把订单数据复制到 `inventory`。

关键点不是状态名字，而是“订单转库存是 copy，不是 move”。订单记录必须继续保留，方便审计、回溯与后续统计。

## 耗材工作流

耗材链路刻意做得更短：

1. 创建耗材订单。
2. 管理员审批通过或驳回。
3. 审批通过后直接 `complete`，不进入瓶级库存管理。

因此 `consumable_orders.py` 同时承担查询、修改、审批与完成逻辑；它的重点在表单校验、导出与状态过滤，而不是库存生成。

## 库存工作流

库存接口是一组复合能力，而不是单一 CRUD：

- 列表查询同时承担分页、排序、短 TTL 列表缓存、CAS 搜索、文本搜索、FTS 搜索和拼音排序。
- `manual-add` 支持管理员绕过订单链路直接入库。
- `borrow` 和 `return` 会修改状态、写借还历史，并通过 SSE 通知前端列表更新。
- `dashboard/my-borrows` 和 `dashboard/pending-stockin` 为首页和仪表盘聚合数据。
- `import/template` 与 `import` 组成 Excel 导入链路。
- 常用货架并不单独建表，而是同 `inventory` 共表，通过 `is_common` 语义和专用路由完成分组消费与维护。

## 事件驱动的补充层

路由不是唯一的更新出口。很多接口在数据库提交后还会广播 SSE：

- 库存创建、编辑、删除、借用、归还
- 常用货架创建、编辑、删除、消耗
- 试剂订单与耗材订单的创建、更新、删除
- 仪表盘聚合数据更新

这意味着前端页面不只是“请求一次然后静态展示”，而是以 HTTP 快照为基线，再以 SSE 做增量修正或 stale 提示。

## 购物车同步的双阶段流程

`cart_sync` 不只是“扩展直接发请求”那么简单，而是分成两步：

1. `POST /api/cart-sync` 根据扩展采集到的商品，对已有试剂订单做匹配分析。
2. `POST /api/cart-sync/import` 把选中的商品导入系统，生成试剂订单或耗材订单。

扩展、前端导入页和后端路由之间通过批次数据衔接，详见 [购物车同步扩展](/dev-guide/cart-sync)。

## 日志、错误与公告

- `user_logs` 用短期令牌保护用户操作日志查询，避免直接暴露日志文件。
- `error_logs` 给管理员提供错误观测入口。
- `announcements` 一方面服务首页公告流，另一方面承担图片上传、可见性控制与置顶规则。

## 补充：状态机细节与边界

### 试剂订单
- 状态枚举：`PENDING/APPROVED/REJECTED/ARRIVED/STOCKED/DELETED`（<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/models/reagent_order.py#L21-L28" />）。
- 审批：`/{id}/approve` / `/{id}/reject` 仅管理员，更新状态并写入操作日志（<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders_workflow.py#L53-L156" />）。
- 到货确认：`/{id}/confirm-arrival` 可直接进入暂存或常用货架，状态置为 `ARRIVED`，允许后续入库（<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders_workflow.py#L213-L302" />）。
- 一键入库：`/{id}/stock-in` 将订单复制到 `inventory`，保留 `source_order_id` 追溯，支持写入常用货架或普通库存，入库后状态 `STOCKED`（<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders_workflow.py#L303-L520" />）。
- SSE/缓存：审批、到货、入库都会通过 `sse_manager` 推送 `reagent_orders` 房间并清理列表缓存。

### 耗材订单
- 状态：`PENDING/APPROVED/REJECTED/COMPLETED`（<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/models/consumable_order.py#L20-L26" />）。
- 审批/完成：`/{id}/approve`、`/{id}/reject`、`/{id}/complete`，完成后直接 `status=COMPLETED` 不入库（<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/consumable_orders.py#L436-L553" />）。
- SSE/缓存：同样推送 `consumable_orders` 房间并清理缓存。

### 库存 & 借用
- 入库来源：手动新增、批量导入、试剂订单复制；均会预计算拼音与 internal_code，并可写入常用货架标记（<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory.py#L91-L265" />）。
- 借用/归还：校验当前 `borrower_id` 和数量，借用会记录 `borrow_log`，公用账号会弹出选择借用人；归还/消费将更新数量与 `last_borrower_id`（<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory.py#L323-L525" />）。
- 删除保护：已借出状态禁止编辑/删除，需先归还（<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory.py#L481-L489" />）。
- FTS 与缓存：库存写操作会重建缓存并通过 SSE 推送 `inventory`/`common_shelf` 房间。

### 购物车同步（浏览器扩展）
- 阶段 1 匹配：`POST /api/cart-sync/sync` 将扩展提交的条目按 CAS/名称匹配已有库存或订单，返回匹配结果（<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/cart_sync.py#L25-L138" />）。
- 阶段 2 导入：`POST /api/cart-sync/import` 将匹配结果落地为试剂/耗材订单，失败条目逐条记录日志并返回（<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/cart_sync.py#L138-L241" />）。
- SSE：导入完成后广播 `cart_sync` / `reagent_orders` / `consumable_orders` 更新。

### 导入导出
- Excel 导入：`/api/inventory/import` 支持 `.csv/.xlsx/.xls`，单文件 2MB，逐行错误返回；成功后推送 SSE 并刷新缓存（<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory.py#L551-L720" />）。
- 导出：库存/订单都提供导出接口，走后台生成文件再下载。

### 边界与风险
- 订单复制入库必须保留 `source_order_id`，否则审计链断裂。
- 常用货架与普通库存字段不一致时，前端列表和 SSE 房间要同步更新，否则会出现“拿一瓶”数据不一致。
- 批量导入需校验文件大小与行数，超限会 413/400；模板变更需更新前端下载链接。

### 验证建议
- 试剂流程：新建→审批→到货→入库，检查库存生成且 `source_order_id` 回填；SSE 前端应实时刷新。
- 耗材流程：新建→审批→完成，应不生成库存记录。
- 借用流程：借用后状态应锁定编辑，归还后可编辑；日志记录 borrower/returner。
- 购物车导入：模拟扩展提交批次，应返回匹配结果并在导入后生成订单与 SSE 推送。

## 二次开发建议

- 新增业务接口时，先确认它是“对象 CRUD”还是“工作流动作”，后者通常更适合单独放在 workflow 路由中。
- 任何会改动列表结果的接口，都要同时考虑缓存失效和 SSE 广播。
- 库存相关新路由若是命名路由，必须在 `/{inventory_id}` 之前注册。
- 面向前端或扩展的正式接口，最好同时在 [API 参考](/backend/api-reference) 中登记，避免二次开发者只靠源码 grep。

## 参考代码
- [app/api/announcements.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/announcements.py)
- [app/api/cart_sync.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/cart_sync.py)（行25，138）
- [app/api/consumable_orders.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/consumable_orders.py)（行436）
- [app/api/error_logs.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/error_logs.py)
- [app/api/events.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/events.py)
- [app/api/inventory.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory.py)（行91，323，481，551）
- [app/api/reagent_orders_workflow.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders_workflow.py)（行53，213，303）
- [app/api/reagent_orders.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders.py)
- [app/api/user_logs.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/user_logs.py)
- [app/api/user_sessions.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/user_sessions.py)
- [app/api/users.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/users.py)
- [app/models/consumable_order.py](https://github.com/hzb666/LabStorageManager/blob/main/app/models/consumable_order.py)（行20）
- [app/models/reagent_order.py](https://github.com/hzb666/LabStorageManager/blob/main/app/models/reagent_order.py)（行21）



