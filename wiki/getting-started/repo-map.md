# 仓库地图

## 顶层目录

- `app/`：后端源码
- `frontend/`：前端源码
- `browser-extension/`：Chrome 扩展
- `docker/`：镜像与 Nginx 配置
- `docs/`：开发过程中的记录与计划，不作为主 wiki
- `wiki/`：本次建立的正式知识库

## 后端目录

- `app/core/`：认证、配置、常量、代理请求等核心能力
- `app/models/`：SQLModel 数据模型
- `app/api/`：REST API 路由
- `app/services/`：搜索、导入导出、图片、SSE 等服务

## 前端目录

- `frontend/src/pages/`：页面
- `frontend/src/components/`：业务组件与 UI 组件
- `frontend/src/hooks/`：自定义 hooks
- `frontend/src/lib/`：工具、表单/表格配置、校验逻辑
- `frontend/src/store/`：Zustand 状态

## 扩展与部署

- `browser-extension/popup/`：扩展弹窗和主流程
- `browser-extension/content/`：页面脚本与导入桥接
- `browser-extension/background/`：Service Worker
- `docker/backend/`：后端镜像入口
- `docker/frontend/`：前端镜像入口
- `docker/nginx/`：网关配置

## 参考代码

- `docker-compose.yml:1`
- `app/main.py:32`
- `frontend/src/App.tsx:14`
- `browser-extension/manifest.json:1`
