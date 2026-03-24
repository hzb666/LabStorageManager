# 项目概览

LabStorageManager 是一个面向实验室场景的全流程库存管理系统，目标不是只记录库存，而是把“采购申请、到货、入库、借用、归还、通知与审计”放进一套统一入口里。

## 项目边界

当前仓库实际覆盖了这些模块：

- FastAPI 后端
- React 19 + TypeScript 前端
- SQLite 持久化与 WAL 并发配置
- Redis 辅助缓存与会话能力
- Chrome Manifest V3 浏览器扩展
- Docker / Nginx 部署方案

## 业务对象

- 用户与角色
- 试剂订单
- 耗材订单
- 库存
- 借用日志
- 用户会话
- 公告

## 三大子系统

1. `app/`：后端单一事实源，负责业务规则、认证、数据存储和静态文件。
2. `frontend/`：用户直接操作的 React 单页应用，负责路由、表格、表单和交互。
3. `browser-extension/`：浏览器扩展，负责从外部试剂平台抓取购物车并桥接导入。

## 主要特征

- 试剂与耗材双链路
- CAS 号重复提醒，帮助减少重复采购
- 试剂支持确认到货、暂存和一键入库
- 常用货架支持“拿一瓶”这种高频公用试剂场景
- SQLite 开启 WAL，兼顾部署简单和并发读取
- 前端有完整的表格、表单、本地状态和设备管理体系
- 后端提供 SSE、批量导入、图片上传、公告管理等外围能力
- 扩展可把外部购物车批次桥接进系统导入页

## 这套 wiki 的口径

- 以代码真实行为为准
- 历史设计文档和旧 API 文档只作为辅助背景
- 如果某个功能仍在演进，会写成“当前实现”

## 技术栈速览

| 层级 | 当前实现 |
| --- | --- |
| 后端 | FastAPI + SQLModel + SQLite(WAL) + Redis |
| 前端 | React 19 + TypeScript + Vite + React Router |
| 数据获取 | Axios + TanStack Query |
| 大表格与搜索 | TanStack Table + Virtual + 后端检索/拼音字段 |
| 认证与会话 | JWT + 多设备会话管理 |
| 扩展 | Chrome Manifest V3 |

## 前端页面地图

| 路由 | 页面定位 |
| --- | --- |
| `/login` | 登录页 |
| `/` | 仪表盘 |
| `/reagents` | 试剂订单 |
| `/consumables` | 耗材订单 |
| `/inventory` | 库存管理 |
| `/common-shelf` | 常用货架 |
| `/import` | 批量导入库存 |
| `/devices` | 个人账户与设备管理 |
| `/admin/users` | 用户管理 |
| `/admin/announcements` | 公告管理 |
| `/admin/logs` | 用户操作日志 |

## 参考代码

- `README.md:1`
- `app/main.py:179`
- `frontend/src/App.tsx:46`
- `docker-compose.yml:1`
