# 购物车同步扩展

本页说明浏览器扩展、`/cart-import` 页面和后端订单接口之间的职责边界。当前实现里，扩展只负责采集、分类和桥接数据，不直接写数据库；真正落库仍由系统前端页面和后端标准订单 API 完成。

## 权限与资源

- 插件 manifest（<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/manifest.json" />）声明了 `tabs`、`storage`、`scripting`、`webRequest` 权限，以及对试剂平台与本地系统地址的 `host_permissions`。
- 扩展侧批次缓存写入 `chrome.storage.local.import_batch_latest`；页面侧桥接缓存写入 `localStorage.cart_import_batch_latest`。
- 批次数据统一使用 2 小时 TTL。扩展 popup 在保存批次前会清理旧批次；`import-bridge.js` 会在页面加载时清理页面侧过期缓存。
- 后台 `service-worker` 负责解析目标购物车标签页、记录最近活跃购物车页面、协调 popup 与 content script 的通信，不负责最终导入。

## 当前批次数据形态

扩展写入的批次并不只是“商品数组”，还包含一组面向导入页的中间字段：

- `batch_id`：当前导入批次标识，用于页面加载和桥接校验。
- `created_at`：批次创建时间，桥接脚本和前端都会用它做 TTL 判断。
- `items[]`：每一项至少包含 `name`、`specification`、`brand`、`cas_number`、`product_id`、`detail_url`。
- `items[].suggested_order_type`：扩展根据 CAS、规格、详情页文本预判是试剂还是耗材。
- `items[].order_type`：当前导入时采用的类型，导入页允许用户切换。
- `items[].classification_reason`：扩展对类型判断的解释，方便人工确认。
- `items[].detail_fetch_status`：详情页拉取结果，例如成功、超时、回退基础信息。

这意味着扩展桥接传递的是“待人工确认的导入草稿”，不是已经符合后端 DTO 的最终请求体。

## 数据链路

1. popup 先通过 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/background/service-worker.js" /> 解析当前最合适的购物车标签页。
2. popup 通过 `sendMessageWithAutoInject` 与 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/content/script.js" /> 通信，抓取购物车条目。
3. popup 再并发抓取商品详情页，补齐中文名、英文名、规格、货号、CAS、品牌，并给每个条目写入 `suggested_order_type`、`classification_reason`、`detail_fetch_status`。
4. popup 调用 `saveImportBatch` 把批次写入 `chrome.storage.local.import_batch_latest`，然后打开 `${systemUrl}/cart-import?import=true&batch_id=...`。
5. <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/content/import-bridge.js" /> 只在 `/cart-import` 页面生效。它会校验 `import=true`、`batch_id`、TTL，并把扩展批次拷贝到页面 `localStorage.cart_import_batch_latest`。
6. 桥接脚本写入成功后，会向页面发送 `postMessage({ source: 'lab-storage-extension', type: 'IMPORT_BATCH_READY' ... })`。
7. React 侧的 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/pages/cartimport/cartImportControllers.ts" /> 会先尝试从本地批次缓存读取草稿；如果桥接稍晚到达，会监听 `IMPORT_BATCH_READY` 再补读一次，并最多重试若干轮。
8. 用户在 `CartImport` 页面逐条确认、切换类型、补录字段后，前端分别调用标准的 `reagentOrderAPI.create` 或 `consumableOrderAPI.create`。

当前前端并没有直接调用 `cartSyncAPI.importItems`。`/api/cart-sync/import` 仍然存在于后端，但导入页主链路已经切到标准订单创建接口，保证页面行为和普通手工建单保持一致。

## 前端导入页职责

- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/pages/CartImport.tsx" /> 只负责界面布局。
- 真正的导入控制逻辑在 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/pages/cartimport/cartImportControllers.ts" />。
- `useCartImportBatchController` 负责读取桥接批次、维护当前条目索引、跟踪 `submittedIds` 和返回跳转。
- `useCartImportFormController` 负责在试剂表单与耗材表单之间切换，并把用户未提交的修改保存回草稿。
- 试剂条目会额外接入 CAS 重复预警和英文名自动补全；耗材条目直接走耗材 schema。
- 所有条目都是“逐条提交”，不是一次性批量导入。这样做的结果是：哪怕某一项校验失败，也不会影响之前已经成功提交的条目。

## 后端接口

- `POST /api/cart-sync`：接收购物车商品并尝试匹配现有订单。当前仓库里更多像一个兼容接口或辅助接口。
- `POST /api/cart-sync/import`：根据传入的 `order_type` 批量创建试剂订单或耗材订单，会清洗文本、规范 CAS、解析规格，并在一个请求中统一提交。
- `POST /api/reagent-orders`：当前 `CartImport` 页面提交试剂条目时实际调用的接口。
- `POST /api/consumable-orders`：当前 `CartImport` 页面提交耗材条目时实际调用的接口。

如果你在排查“扩展导入成功，但页面没有落单”，要先确认是桥接阶段失败，还是页面逐条调用标准订单 API 失败，而不是默认怀疑 `/api/cart-sync/import`。

## 安全与边界

- 扩展不持有后端登录凭证，也不会直接写数据库。
- 页面桥接只发生在匹配的系统域名和 `/cart-import` 路径上，且依赖查询参数 `import=true`。
- `import-bridge.js` 只把扩展批次复制到页面本地存储，并通过 `postMessage` 通知页面；它不做业务校验，不做订单创建。
- 最终订单创建仍受当前登录态约束，公共账号不能导入订单。
- 扩展分类结果只是建议值，前端允许把条目在“试剂/耗材”之间人工切换。

## 常见排查点

- 扩展 popup 提示“请先打开购物车页面”时，先检查目标站点标签页 URL 是否仍满足当前匹配规则。
- 页面提示找不到批次时，先看 `chrome.storage.local.import_batch_latest` 和 `localStorage.cart_import_batch_latest` 是否存在且未过期。
- 如果 bridge 已写入缓存但页面仍为空，优先检查 `IMPORT_BATCH_READY` 消息是否发出，以及批次 `batch_id` 是否与 URL 一致。
- 试剂条目导入失败但耗材正常时，优先检查 CAS、规格字符串和试剂表单 schema。
- 若你要调整导入链路，优先在导入页和标准订单 API 收口业务规则，不要把大量业务判断复制进扩展。

## 参考代码
- [app/api/cart_sync.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/cart_sync.py)
- [app/api/consumable_orders.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/consumable_orders.py)
- [app/api/reagent_orders.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/reagent_orders.py)
- [browser-extension/background/service-worker.js](https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/background/service-worker.js)
- [browser-extension/content/import-bridge.js](https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/content/import-bridge.js)
- [browser-extension/content/script.js](https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/content/script.js)
- [browser-extension/manifest.json](https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/manifest.json)
- [browser-extension/popup/popup.js](https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/popup/popup.js)
- [frontend/src/api/client.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/api/client.ts)
- [frontend/src/pages/CartImport.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/pages/CartImport.tsx)
- [frontend/src/pages/cartimport/cartImportControllers.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/pages/cartimport/cartImportControllers.ts)
- [frontend/src/pages/cartimport/cartImportModel.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/pages/cartimport/cartImportModel.ts)
