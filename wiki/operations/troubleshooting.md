# 问题排查

## 登录问题

优先检查：

1. 前端是否进入 `ProtectedRoute`
2. 登录态是否仍保存在 `auth-storage`
3. 后端当前用户解析是否成功

## 列表不同步

优先检查：

1. SSE 是否成功建立
2. React Query 是否缓存未失效
3. 对应写操作是否确实广播了更新事件

## 扩展导入不生效

优先检查：

1. Chrome 扩展权限域名是否包含当前系统地址
2. popup 是否写入了 `import_batch_latest`
3. `/cart-import` 页面的桥接脚本是否命中
4. 本地 `cart_import_batch_latest` 是否被写入

## `/docs` 路径冲突

如果你尝试把正式 wiki 部署到 `/docs`，会和当前 Swagger 代理冲突。应单独分配路径，例如 `/manual`。

## 参考代码

- `frontend/src/App.tsx:29`
- `frontend/src/store/useStore.ts:72`
- `frontend/src/hooks/useSSE.ts:1`
- `browser-extension/manifest.json:17`
- `browser-extension/content/import-bridge.js:15`
- `docker/nginx/default.conf:34`
