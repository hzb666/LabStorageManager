# 购物车同步扩展

## 当前真实链路

不要按旧 README 理解这部分。当前实现的关键链路是：

1. popup 从试剂平台购物车页提取数据
2. popup 解析并整理商品信息
3. popup 把最近一次导入批次写入 `chrome.storage.local`
4. 系统 `/cart-import` 页面上的 `import-bridge.js` 读取该批次
5. 桥接脚本把数据写进页面 `localStorage`
6. 前端导入页继续消费这批数据

## popup 负责什么

- 自动注入内容脚本
- 检测购物车页
- 控制并发抓详情
- 生成批次 ID
- 把混合商品标记为各自 `order_type`

## bridge 负责什么

- 检查 URL 参数是否处于导入模式
- 读取扩展存储中的最近批次
- 做 TTL 判断
- 把批次写入页面 localStorage
- 用 `postMessage` 通知前端页面批次已准备好

## 后端 `cart-sync` 负责什么

后端仍然保留 `/api/cart-sync` 和 `/api/cart-sync/import` 两类接口，用于匹配和创建订单，但扩展与前端的实际桥接流程已经不是“直接由扩展发请求完成所有事情”。

## 参考代码

- `browser-extension/popup/popup.js:4`
- `browser-extension/popup/popup.js:160`
- `browser-extension/content/import-bridge.js:7`
- `browser-extension/content/import-bridge.js:48`
- `browser-extension/manifest.json:17`
- `app/api/cart_sync.py:137`
- `app/api/cart_sync.py:169`
