# 术语表

本页只收录当前代码里反复出现、并且容易误解的业务术语和实现术语。定义以 `app/`、`frontend/src/`、`browser-extension/` 的现有行为为准。

## 核心业务术语

- `试剂订单`：`ReagentOrder`，支持审批、到货、暂存、正式入库和常用货架分流。
- `耗材订单`：`ConsumableOrder`，支持审批和完成，不进入 `Inventory`。
- `库存`：`Inventory`，瓶级事实源。借用、归还、导出和待补位置都围绕它展开。
- `常用货架`：`CommonShelf`，面向高频共享试剂的独立沉淀区，不等同于普通库存列表。
- `借用日志`：`BorrowLog`，记录借出、归还、消耗行为；它是历史表，不代表库存当前状态。
- `一键入库`：把试剂订单转换为库存记录的动作。对于 `COMMON_PUBLIC` 场景，也可能直接进入常用货架。
- `到货确认`：试剂订单从 `approved` 推进到 `arrived` 或 `stocked` 的动作。若带位置可直接入库；否则进入暂存。
- `暂存`：试剂已到货，但库存位置尚未补全。此时会生成 `Inventory` 记录，并把 `temporary_keeper_id` 设为当前操作者。
- `归还`：借用人回填剩余量，后端更新库存状态并写 `BorrowLog`。
- `剩余百分比`：`remaining_quantity / initial_quantity`，后端落库存时同步计算并存库，便于排序和筛选。
- `CAS`：化学品标识字段。系统会做 `normalize_cas` 规范化，并把特殊值兜底为生物试剂占位 CAS。
- `内部编码`：`internal_code`，库存瓶级唯一标识，用于追踪同一试剂的不同瓶。
- `来源订单`：`source_order_id`，库存或常用货架记录回指试剂订单的关联字段。

## 工作流状态术语

- `pending`：已申购，等待管理员处理。
- `approved`：已批准。试剂还没完成到货/入库，耗材还没被标记完成。
- `arrived`：仅试剂使用。表示已到货但尚未补全为正式库存位置，通常对应暂存库存。
- `stocked`：仅试剂使用。表示试剂已经正式入库，或按常用货架链路完成落位。
- `completed`：仅耗材使用。表示耗材采购流程结束。
- `rejected`：申请被拒绝。
- `common_public`：试剂订购原因之一，表示这批试剂目标是进入公用常用货架，不进入普通个人库存。

## 技术术语

- `WAL`：SQLite 的 Write-Ahead Logging 模式。当前项目在每个新连接上显式执行 `PRAGMA journal_mode=WAL`。
- `FTS`：全文检索。当前实现基于 SQLite FTS5，并分别维护 `inventory_fts`、`reagent_order_fts`、`consumable_order_fts`、`users_fts`、`chemical_name_map_fts`、`log_timeline_fts`。
- `结构缓存`：`CompoundStructureCache`，按 CAS 保存 SMILES、MolBlock、InChIKey、来源和人工确认状态。
- `日志时间线`：`LogTimeline`，把库存、订单、常用货架、用户和借还源日志投影成统一分页搜索读模型。
- `拼音字段`：写入或更新时预计算的 `*_pinyin`、`*_pinyin_initials` 字段，用于中文排序和搜索。
- `短 TTL 列表缓存`：后端 `api_utils.py` 提供的内存缓存，只用于降低第一页无搜索条件列表的重复查询开销。
- `SSE`：Server-Sent Events。当前系统通过 `/api/events?rooms=...` 建立只读事件流。
- `房间`：SSE 事件分组单位，例如 `inventory`、`reagent_orders`、`consumable_orders`、`common_shelf`、`dashboard`。
- `stale`：前端认为当前列表缓存不再可靠，需要重新拉快照的状态。
- `seq`：每个 SSE 房间的事件序号。前端会用它检测重复事件和序号断档。
- `actor_client_id`：触发事件的 SSE 客户端标识。前端收到后会用它跳过“自己刚刚提交导致的回声事件”。
- `HTTPOnly Cookie`：当前 Web 端主登录态载体，前端脚本不能直接读取。
- `X-Skip-Auth-Invalidation`：前端在少数探测请求上附带的头，用于阻止 401 时触发全局会话失效提示。
- `X-SSE-Client-Id`：前端在普通 API 请求里回传当前 SSE 客户端 ID，帮助后端广播时带上事件来源。

## 前端状态术语

- `auth-storage`：Zustand 持久化键，只保存用户快照和登录布尔值，带过期时间。
- `app-ui`：全局 UI 偏好存储，记录主题、公告已读/关闭、仪表盘激活页签、Bug 按钮隐藏状态等。
- `app-table`：表格偏好存储，记录 `expandAll`、`fuzzySearch`、列宽等。
- `app-auth-meta`：设备 ID、设备名和 remembered user 的本地存储。
- `Query Key`：TanStack Query 的缓存键，列表页通过它区分不同筛选组合。
- `Infinite Query`：列表分页的前端取数方式。当前 `useTableState` 统一封装了分页偏移量和下一页计算。

## 系统角色与身份术语

- `admin`：管理员，拥有审批、用户管理、公告管理、日志查看等能力。
- `user`：普通成员，能建单、查库存、借还、确认到货等。
- `public`：受限公共账号，可查库存、登记借用和补充库存基础信息；不能创建订单、手动新增普通库存、删除普通库存或使用导入功能。
- `temporary_keeper_id`：库存暂管人字段，独立于角色枚举，表示当前暂时保管该库存并等待补全位置的用户。
- `created_by`：创建记录的用户。
- `applicant`：订单申请人。
- `borrower`：借用人。
- `last_borrower`：最近一次借用该库存的人。

## 浏览器插件导入术语

- `batch_id`：浏览器插件导入批次标识。
- `IMPORT_BATCH_READY`：桥接脚本写入页面缓存后发送给页面的消息类型。
- `suggested_order_type`：浏览器插件根据详情页信息给出的建议类型。
- `classification_reason`：浏览器插件对类型判断的说明。
- `detail_fetch_status`：详情页抓取状态，例如成功、超时、回退基础信息。

## 参考代码
- [app/database.py](https://github.com/hzb666/LabStorageManager/blob/main/app/database.py)
- [app/db_bootstrap](https://github.com/hzb666/LabStorageManager/tree/main/app/db_bootstrap)
- [app/models/consumable_order.py](https://github.com/hzb666/LabStorageManager/blob/main/app/models/consumable_order.py)
- [app/models/inventory.py](https://github.com/hzb666/LabStorageManager/blob/main/app/models/inventory.py)
- [app/models/reagent_order.py](https://github.com/hzb666/LabStorageManager/blob/main/app/models/reagent_order.py)
- [app/models/user.py](https://github.com/hzb666/LabStorageManager/blob/main/app/models/user.py)
- [app/services/sse_manager.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/sse_manager.py)
- [frontend/src/store/useStore.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/store/useStore.ts)
- [frontend/src/store/sseStore.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/store/sseStore.ts)
- [frontend/src/lib/storage/appAuthMetaStorage.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/lib/storage/appAuthMetaStorage.ts)
- [frontend/src/lib/storage/appTableStorage.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/lib/storage/appTableStorage.ts)
- [frontend/src/lib/storage/appUiStorage.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/lib/storage/appUiStorage.ts)
- [browser-extension/popup/popup.js](https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/popup/popup.js)
