# 购物车同步扩展

本页说明浏览器扩展与导入页之间的职责边界，以及外部购物车数据如何进入系统。扩展只负责采集和桥接，不直接写数据库。

## 权限与资源

- 插件 manifest（<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/manifest.json" />）声明了 `tabs`、`storage` 和 `scripting` 权限，以及对 `https://reagent.bjmu.edu.cn/*`、`http://localhost:5173/*`、`http://127.0.0.1:5173/*` 的 `host_permissions`。
- 持久数据写入 `chrome.storage.local.import_batch_latest` 和导入页 `localStorage.cart_import_batch_latest`。
- 两端都使用 2 小时 TTL，过期后由 popup 重新生成批次。

## 数据链路

1. background/service-worker 监听 popup 的 `GET_CART_DATA` 请求，定位目标标签页并通过 content script (<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/content/script.js" />) 提取购物车中的商品信息。
2. popup 收集商品后调用 `saveCartItemsToStorage` 和 `saveImportBatch`，把商品数组与元信息写入 `chrome.storage.local.import_batch_latest`，并生成跳转 URL。
3. `/cart-import` 页面被 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/content/import-bridge.js" /> 注入后，会在 `import=true` 且 `batch_id` 匹配时把扩展数据写入页面 `localStorage.cart_import_batch_latest`，然后通过 `postMessage` 通知前端。
4. React 的 `CartImport` 页面监听上述消息，并读取 `localStorage` 中的数据；它会校验 `batch_id`、TTL 和商品数量。
5. 用户确认后，前端通过 `/api/cart-sync/import` 把商品创建为新的订单，后端再按规则完成试剂或耗材落库。

## 后端接口

- `POST /api/cart-sync`：用于匹配已有订单，返回匹配结果。
- `POST /api/cart-sync/import`：根据商品创建 `ConsumableOrder` 或 `ReagentOrder`。
- 导入过程会写入数据库并生成拼音字段；如果任一步失败，会回滚并返回错误。

## 安全与边界

- 插件不持有后端凭证，也不直接调用 `/api/cart-sync`。
- 数据在浏览器内通过 `localStorage.cart_import_batch_latest` 和 `postMessage` 传递，和后台会话隔离。
- `chrome.storage.local` 中的 JSON 必须包含 `created_at`，`import-bridge` 会据此刷新 TTL，并在过期时清理缓存。
- 如果 `cart-import` 地址或参数缺失，桥接脚本会退回，用户需要从 popup 重新跳转。

## 参考代码
- [app/api/cart_sync.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/cart_sync.py)
- [browser-extension/background/service-worker.js](https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/background/service-worker.js)
- [browser-extension/content/import-bridge.js](https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/content/import-bridge.js)
- [browser-extension/content/script.js](https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/content/script.js)
- [browser-extension/manifest.json](https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/manifest.json)
- [browser-extension/popup/popup.js](https://github.com/hzb666/LabStorageManager/blob/main/browser-extension/popup/popup.js)
- [frontend/src/pages/CartImport.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/pages/CartImport.tsx)
