# 从零到上手

本页面向首次接触仓库的开发者，目标是在较短时间内建立稳定的认知框架，而非一次性覆盖全部模块细节。

## Part I: 先理解技术基础

对于以 TypeScript 为主要开发语言的读者，可将后端部分概括为：

- `FastAPI`：带有类型校验与依赖注入能力的 API 路由层
- `SQLModel`：结合 ORM 模型、Pydantic 数据结构与类型提示的建模方案
- `SQLite WAL`：轻量数据库方案，但对索引设计和访问模式有较高要求

对于以 Python 为主要开发语言的读者，可将前端部分概括为：

- `React Router`：负责页面路由与权限跳转
- `Zustand`：负责轻量级客户端状态管理
- `TanStack Query/Table`：分别负责远程数据管理与表格渲染

## Part II: 先理解业务主线

系统的核心业务顺序可概括为：

1. 用户登录
2. 提交试剂或耗材订单
3. 试剂订单继续流转至库存
4. 库存支持借用与归还
5. 仪表盘集中展示上述状态

在阅读源码前，建议先区分“订单、库存、借用日志、公告、会话”五类核心对象，以便后续理解路由、状态流转和数据模型之间的关系。

## Part III: 再进入仓库结构

推荐阅读顺序如下：

1. <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/README.md" />
2. <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/main.py" />
3. <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/App.tsx" />
4. <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/tree/main/app/models" />
5. <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/tree/main/app/api" />
6. <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/tree/main/frontend/src/pages" />
7. <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/tree/main/frontend/src/components/ui" />

## Part IV: 常见改动的入口定位

- 调整后端入口、中间件或安全策略：查看 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/main.py" />
- 调整数据结构与字段：查看 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/tree/main/app/models" />
- 调整接口行为：查看 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/tree/main/app/api" />
- 调整列表页：查看 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/components/ui/FilterTable.tsx" /> 与 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useTableState.tsx" />
- 调整表单：查看 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/components/BaseForm.tsx" /> 与 <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/lib/validationSchemas.ts" />

## Part V: 推荐的第一轮实操

建议按以下顺序完成第一轮熟悉：

1. 跑通本地开发环境
2. 登录系统并浏览主要页面
3. 跟踪一遍试剂订购 -> 到货 -> 入库链路
4. 跟踪一遍库存借用 -> 归还链路
5. 查看浏览器扩展如何将购物车批次桥接到 `/cart-import`

## 参考代码

- [app/main.py](https://github.com/hzb666/LabStorageManager/blob/main/app/main.py)
- [frontend/src/App.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/App.tsx)
- [frontend/src/components/BaseForm.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/components/BaseForm.tsx)
- [frontend/src/components/ui/FilterTable.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/components/ui/FilterTable.tsx)
- [frontend/src/hooks/useTableState.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useTableState.tsx)
- [frontend/src/lib/validationSchemas.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/lib/validationSchemas.ts)
- [frontend/src/store/useStore.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/store/useStore.ts)
