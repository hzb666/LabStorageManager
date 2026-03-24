# 关键文件索引

## 后端入口

- `app/main.py`：FastAPI 应用创建、生命周期、中间件、路由挂载、安全头
- `app/database.py`：SQLite engine、WAL、索引和 FTS 初始化
- `app/core/auth.py`：认证、令牌、权限依赖

## 后端业务层

- `app/api/inventory.py`：库存相关接口
- `app/api/reagent_orders.py`：试剂订单列表与 CRUD
- `app/api/reagent_orders_workflow.py`：审批、到货、入库等工作流
- `app/api/consumable_orders.py`：耗材订单接口
- `app/api/events.py`：SSE 订阅入口
- `app/api/cart_sync.py`：购物车同步与导入接口

## 数据模型

- `app/models/user.py`
- `app/models/user_session.py`
- `app/models/reagent_order.py`
- `app/models/consumable_order.py`
- `app/models/inventory.py`
- `app/models/announcement.py`

## 前端入口

- `frontend/src/main.tsx`：前端挂载入口
- `frontend/src/App.tsx`：路由树、权限守卫、页面懒加载
- `frontend/src/api/client.ts`：接口客户端和数据类型
- `frontend/src/store/useStore.ts`：认证状态和 UI 状态持久化

## 前端复用骨架

- `frontend/src/components/ui/FilterTable.tsx`：列表框架
- `frontend/src/hooks/useTableState.tsx`：列表状态、分页、排序、列宽、展开
- `frontend/src/components/BaseForm.tsx`：表单基础组件
- `frontend/src/lib/formConfigs.tsx`：表单配置
- `frontend/src/lib/validationSchemas.ts`：Valibot 校验定义

## 部署与扩展

- `docker-compose.yml`：容器编排主入口
- `docker/nginx/default.conf`：前后端反向代理
- `browser-extension/popup/popup.js`：扩展主流程
- `browser-extension/content/import-bridge.js`：扩展到系统导入页的桥接脚本

## 参考代码

- `app/main.py:179`
- `app/database.py:24`
- `frontend/src/App.tsx:14`
- `frontend/src/store/useStore.ts:53`
- `docker-compose.yml:1`
