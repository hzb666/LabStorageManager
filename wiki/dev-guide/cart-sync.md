# 购物车同步扩展

## 权限与资源

- 插件 manifest（<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/manifest.json" />）声明了 `tabs`、`storage`、`scripting` 权限以及对 `https://reagent.bjmu.edu.cn/*`、`http://localhost:5173/*`、`http://127.0.0.1:5173/*` 的 `host_permissions`，保证能访问购物车页面和本地导入页。
- 所有持久数据都写在 `chrome.storage.local`（key 为 `import_batch_latest`）与导入页 `localStorage.cart_import_batch_latest` 中，两个端点都实现了 2 小时的 TTL，过期后必须由 popup 重新生成批次。

## 数据链路

1. background/service-worker 监听 popup 的 `GET_CART_DATA` 请求，查找目标标签页（`page=gwc`）并通过 content script (<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/content/script.js" />) 提取购物车中带 `detailUrl` 的提交商品，再并发请求详情页补齐中文名、英文名、CAS 等。
2. popup 收集商品后调用 `saveCartItemsToStorage` 与 `saveImportBatch`，把商品数组与元信息写入 `chrome.storage.local.import_batch_latest`，并通过 `batch_id` 生成跳转 URL：`<systemUrl>/cart-import?import=true&batch_id=<id>`。
3. 浏览器打开的 `/cart-import` 页面被 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/content/import-bridge.js" /> 注入，该脚本在 `import=true` 且 `batch_id` 匹配时，把 `chrome.storage.local.import_batch_latest` 的内容写入页面 `localStorage.cart_import_batch_latest`，然后通过 `postMessage({ source: 'lab-storage-extension', type: 'IMPORT_BATCH_READY' })` 通知前端。
4. React 的 `CartImport` 页面监听上述 message，并拉取 `localStorage` 中的数据；它会校验 `batch_id`、TTL、商品数量，在过期或不匹配时提示用户回到插件重新发起。
5. 用户逐条填写确认（支持试剂/耗材双轨），最后通过 `/api/cart-sync/import` 接口把选中的商品创建为新的订单，后台对试剂按名称/CAS 匹配，未匹配部分作为新订单。

## 后端接口

- `POST /api/cart-sync`：用于后台批量匹配已有订单（可在内部逻辑链路中调试），收到 `items` + `order_type` 后返回匹配情况。
- `POST /api/cart-sync/import`：会为每条商品创建 `ConsumableOrder` 或 `ReagentOrder`，权限要求当前角色不是 `public`。
- 实际导入会写入数据库并生成 pinyin 字段；如果任何写入失败会回滚并返回错误信息。

## 安全与边界

- 插件不持有后端凭证，不直接调用 `/api/cart-sync`，所有数据停留在浏览器内，通过本地 `localStorage` + `postMessage` 传递，保持了与后台会话的隔离。
- `chrome.storage.local` 中的 JSON 必须包含 `created_at`，`import-bridge` 会用它刷新 TTL，并在过期时清理 `cart_import_batch_latest`。
- 由于插件只在特定页面注入脚本，如果 `cart-import` 地址或参数缺失，桥接脚本会自动退回，这种情况需要用户从 popup 重新跳转。

## 参考代码
- [app/api/cart_sync.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/cart_sync.py)
- [browser-extension/background/service-worker.js](https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/background/service-worker.js)
- [browser-extension/content/import-bridge.js](https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/content/import-bridge.js)
- [browser-extension/content/script.js](https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/content/script.js)
- [browser-extension/manifest.json](https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/manifest.json)
- [browser-extension/popup/popup.js](https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/popup/popup.js)
- [frontend/src/pages/CartImport.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/pages/CartImport.tsx)


