# 从零到上手

本页给首次接手仓库的开发者一条最短学习路径。目标不是一次看完所有模块，而是在较短时间内建立对业务主线、代码分层和常见改动入口的稳定认知。

## 第一阶段：系统问题域

先记住三件事：

- 试剂和耗材不是一套流程。试剂会继续流转到库存，耗材通常在采购完成后结束。
- 库存、借用和常用货架都围绕 `Inventory` 展开，借用历史只记录动作，不替代库存现状。
- 前端列表页大量复用统一的表格、筛选、SSE 和状态同步能力，因此很多页面行为看起来不同，实现上却共用同一套基础设施。

## 第二阶段：用 30 分钟建立代码地图

建议按这个顺序读：

1. <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/README.md" />：确认项目定位和启动方式。
2. <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/main.py" />：理解后端入口、中间件、生命周期和静态资源挂载。
3. <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/App.tsx" />：理解前端路由、页面边界和守卫。
4. <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/tree/main/app/models" />：先分清订单、库存、公告、会话和借用日志这些核心对象。
5. <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/tree/main/app/api" />：确认这些对象分别暴露的接口。
6. <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/components/ui/FilterTable.tsx" /> 与 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useTableState.tsx" />：理解列表页的共性实现。

## 第三阶段：把业务链路走一遍

1. 用户登录。
2. 提交试剂或耗材订单。
3. 试剂订单继续流转至库存。
4. 库存支持借用与归还。
5. 仪表盘集中展示上述状态。

如果能把这五步分别对应到模型、API 和页面，后续读代码会顺畅很多。

## 第四阶段：常见改动入口

- 后端入口、中间件或安全策略调整：<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/main.py" />。
- 模型、索引、搜索字段调整：<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/tree/main/app/models" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/database.py" />、`services/search_matchers.py`。
- 接口行为和工作流调整：<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/tree/main/app/api" />。
- 列表页调整：<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/components/ui/FilterTable.tsx" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useTableState.tsx" />、`hooks/useListSSE.ts`。
- 表单调整：<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/components/BaseForm.tsx" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/lib/formConfigs.tsx" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/lib/validationSchemas.ts" />。
- 部署和代理调整：<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/docker-compose.yml" /> 和 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/docker/nginx/default.conf" />。

## 第五阶段：第一轮实操建议

建议按以下顺序完成第一轮熟悉：

1. 跑通本地开发环境。
2. 登录系统并浏览主要页面。
3. 跟踪一遍试剂订购 -> 到货 -> 入库链路。
4. 跟踪一遍库存借用 -> 归还链路。
5. 跟踪浏览器扩展将购物车批次桥接到 `/cart-import` 的链路。

完成这五步后，再阅读 [关键文件索引](/dev-guide/key-files) 会更容易把文件与实际行为对应起来。

## 参考代码

- [app/main.py](https://github.com/hzb666/LabStorageManager/blob/main/app/main.py)
- [frontend/src/App.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/App.tsx)
- [frontend/src/components/BaseForm.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/components/BaseForm.tsx)
- [frontend/src/components/ui/FilterTable.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/components/ui/FilterTable.tsx)
- [frontend/src/hooks/useTableState.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useTableState.tsx)
- [frontend/src/lib/validationSchemas.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/lib/validationSchemas.ts)
- [frontend/src/store/useStore.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/store/useStore.ts)
