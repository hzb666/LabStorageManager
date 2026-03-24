# 页面地图

## 主页面

当前路由树里最重要的业务页包括：

- `/`：仪表盘
- `/reagents`：试剂订购
- `/consumables`：耗材订购
- `/inventory`：库存管理
- `/common-shelf`：常用货架
- `/import`：批量导入
- `/cart-import`：扩展桥接导入

## 管理页

以下页面需要管理员角色：

- `/admin/users`
- `/admin/announcements`
- `/admin/logs`

## 辅助页

- `/login`
- `/devices`
- `/test-error`
- `*`：NotFound

## 页面结构理解建议

- 仪表盘：聚合入口
- 订单页：业务申请与状态跟踪
- 库存页：最重的操作型页面
- 管理页：用户、公告、日志

## 参考代码

- `frontend/src/App.tsx:68`
- `frontend/src/App.tsx:84`
- `frontend/src/App.tsx:93`
- `frontend/src/App.tsx:120`
