# 从零到上手

这条路径写给第一次接触这个仓库的人。目标不是让你背完所有模块，而是尽快形成稳定的认知地图。

## Part I: 先理解技术地基

如果你主要写 TypeScript，可以先把后端部分类比成：

- `FastAPI` 类似“带类型校验和依赖注入的 API 路由层”
- `SQLModel` 类似“把 ORM 模型、Pydantic 数据结构和类型提示拼到一起”
- `SQLite WAL` 类似“轻量但需要精细化索引和访问模式设计的数据库”

如果你主要写 Python，可以把前端理解成：

- `React Router` 负责页面和权限跳转
- `Zustand` 负责轻量客户端状态
- `TanStack Query/Table` 分别负责远程数据与表格渲染

## Part II: 先认业务，不要先认文件

这个系统的业务顺序建议这样理解：

1. 用户登录
2. 提交试剂或耗材订单
3. 试剂订单可能继续流转到库存
4. 库存支持借用与归还
5. 仪表盘把这些状态集中显示出来

你先把“订单、库存、借用日志、公告、会话”这几个对象分清，再看代码会容易很多。

## Part III: 再进入仓库结构

建议阅读顺序：

1. `README.md`
2. `app/main.py`
3. `frontend/src/App.tsx`
4. `app/models/*.py`
5. `app/api/*.py`
6. `frontend/src/pages/*.tsx`
7. `frontend/src/components/ui/*.tsx`

## Part IV: 开发时怎么不迷路

- 改后端入口、中间件、安全策略：看 `app/main.py`
- 改数据结构和字段：看 `app/models/`
- 改接口行为：看 `app/api/`
- 改列表页：看 `frontend/src/components/ui/FilterTable.tsx` 和 `frontend/src/hooks/useTableState.tsx`
- 改表单：看 `frontend/src/components/BaseForm.tsx` 和 `frontend/src/lib/validationSchemas.ts`

## Part V: 推荐的第一轮实操

1. 跑通本地开发环境
2. 登录系统并浏览主要页面
3. 跟一遍试剂订购 -> 到货 -> 入库链路
4. 跟一遍库存借用 -> 归还链路
5. 看一次浏览器扩展如何把购物车批次桥接进 `/cart-import`

## 参考代码

- `README.md:1`
- `app/main.py:179`
- `frontend/src/App.tsx:46`
- `frontend/src/store/useStore.ts:53`
- `frontend/src/hooks/useTableState.tsx:161`
