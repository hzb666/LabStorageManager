---
layout: home

hero:
  name: LabStorageManager
  text: 实验室库存与采购协同知识库
  tagline: 面向使用者、开发者与维护者的统一文档入口
  actions:
    - theme: brand
      text: 使用者指南
      link: /user-guide/overview
    - theme: brand
      text: 快速上手
      link: /user-guide/quick-start
    - theme: alt
      text: 系统架构
      link: /overview/overview
    - theme: alt
      text: 开发入门
      link: /dev-guide/zero-to-hero
    - theme: alt
      text: 更新日志
      link: /changelog

features:
  - title: 业务流程完整
    details: 覆盖试剂申购、耗材采购、到货入库、库存借还、公告通知与设备会话管理。
  - title: 文档分层清晰
    details: 使用者指南聚焦日常操作，开发文档聚焦架构、实现边界、数据模型与维护要点。
  - title: 内容对齐当前实现
    details: 以仓库中的真实代码行为为准，帮助开发者快速定位职责、流程与扩展入口。
  - title: 支持维护与交接
    details: 提供部署、代理、运行时、扩展桥接与版本演进资料，便于持续维护和知识传递。
---

## 这套 wiki 适合谁

- 使用者：查看现有库存、提交订单、处理借还、阅读公告和管理个人设备会话。
- 开发者：理解前后端分层、数据库设计、关键工作流与文档对应的代码入口。
- 维护者：查阅部署方式、代理配置、运行时约束、排障信息和版本演进背景。

## 系统能力概览

- 试剂申购链路：适用于需要 CAS、到货确认和正式入库的试剂类物品。
- 耗材采购链路：适用于低值易耗、无需瓶级库存追踪的采购对象。
- 库存与借还：支持库存查询、借用、归还、待入库处理和位置维护。
- 常用货架：支持共享试剂沉淀，减少重复采购并提升查找效率。
- 公告与会话：支持公告通知、设备管理和多终端登录安全控制。
- 外部导入：支持浏览器扩展桥接外部购物车，并进入统一导入流程。

## 文档分区

- 使用者指南：面向日常操作，解释页面入口、常见流程和注意事项。
- 概览：帮助新接手的开发者快速理解系统定位、目录结构、技术栈和核心业务流程。
- 前端：说明应用骨架、页面地图、组件组织、状态同步与表格表单体系。
- 后端：说明运行时入口、认证、安全边界、API 工作流、SSE 和服务分层。
- 数据库：说明实体关系、字段职责、索引设计、FTS 搜索与模型变更注意事项。
- 开发指南：提供接手路线、关键文件索引、部署与代理说明、排障和扩展资料。
- 更新日志：按版本记录重要能力变化，帮助理解系统演进背景。

## 推荐阅读路线

- 首次使用系统：[系统总览](/user-guide/overview)、[快速上手](/user-guide/quick-start)、[角色与导航](/user-guide/roles-and-navigation)。
- 首次接手项目：[项目概览](/overview/overview)、[快速开始](/overview/quick-start)、[从零到上手](/dev-guide/zero-to-hero)。
- 理解系统设计：[系统总览](/overview/system-overview)、[目录结构](/overview/directory-structure)、[技术栈](/overview/tech-stack)、[数据模型](/database/data-model)。
- 调整业务流程：[业务流程](/overview/business-flows)、[核心 API 与工作流](/backend/api-workflows)、[后端服务地图](/backend/service-map)。
- 调整前端交互：[应用骨架](/frontend/app-shell)、[页面地图](/frontend/page-map)、[表格与表单体系](/frontend/table-form-system)、[状态同步](/frontend/state-sync)。
- 部署与维护：[开发、部署与代理](/dev-guide/deployment)、[运维与排障](/dev-guide/docker-nginx)、[更新日志](/changelog)。

## 常用入口速查

- 使用侧入口：[仪表盘](/user-guide/dashboard)、[订单、采购与入库](/user-guide/orders-and-procurement)、[库存、借还与常用货架](/user-guide/inventory-and-borrowing)、[账户、公告与使用支持](/user-guide/account-and-support)。
- 开发侧入口：[API 边界与导航](/overview/api-boundary)、[前端 Hooks 层](/frontend/hooks)、[前端 Lib 层](/frontend/lib-overview)、[API 参考](/backend/api-reference)。
- 管理与维护入口：[管理员指南](/user-guide/admin-guide)、[开发、部署与代理](/dev-guide/deployment)、[运维与排障](/dev-guide/docker-nginx)。

## 开源与版权

- 开源仓库：[hzb666/LabStorageManager](https://github.com/hzb666/LabStorageManager) - 基于 [AssetManager 框架](https://github.com/hzb666/AssetManager) 开发
- 开源许可：Apache-2.0 license
- Copyright © 2026 hzb666 and AssetManager contributors
