---
layout: home

hero:
  name: LabStorageManager
  text: 高效的全生命周期资产协作管理系统
  tagline: 可追溯、强协同、易维护
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

features:
  - title: 申购与采购双流程
    details: 试剂支持 CAS、到货与入库链路；耗材采用更轻量的采购与完成流程。
  - title: 库存借还与入库追溯
    details: 支持库存查询、借用、归还、待入库管理和全流程操作留痕。
  - title: 常用货架与批量导入
    details: 适合公用试剂沉淀、集中补录库存，以及共享场景下的快速查找。
  - title: 公告通知与设备管理
    details: 提供公告发布、未读提醒、设备会话管理和多终端使用支持。
---

## 系统核心能力

- 试剂申购：适合有 CAS 号、需要到货和入库追踪的物品
- 耗材采购：适合低值易耗、无需瓶级库存跟踪的采购品
- 库存管理：支持搜索、借用、归还、手动入库、导出和位置维护
- 常用货架：沉淀公用试剂，减少重复采购
- 会话与公告：支持设备管理、公告通知和管理员发布
- 扩展桥接：支持浏览器扩展把外部购物车导入系统

## 适合谁使用

- 一线使用者：查库存、下订单、借用和归还
- 管理员：审批订单、导入库存、管理公告和用户
- 公用终端使用者：快速查询库存、登记借用、查看共享试剂
- 开发与维护人员：了解系统结构、部署方式和扩展能力

## 常用入口

- 使用者先看：[系统总览](/user-guide/overview)、[快速上手](/user-guide/quick-start)、[仪表盘](/user-guide/dashboard)
- 日常使用：[角色与导航](/user-guide/roles-and-navigation)、[订单、采购与入库](/user-guide/orders-and-procurement)、[库存与借还](/user-guide/inventory-and-borrowing)
- 账户与支持：[账户、公告与支持](/user-guide/account-and-support)、[管理员指南](/user-guide/admin-guide)、[常见问题](/user-guide/faq)
- 新成员接手：[项目概览](/overview/overview)、[快速开始](/overview/quick-start)、[从零到上手](/dev-guide/zero-to-hero)
- 理解系统设计：[系统总览](/overview/system-overview)、[目录结构](/overview/directory-structure)、[技术栈](/overview/tech-stack)、[数据模型](/database/data-model)
- 二次开发重点：[API 参考](/backend/api-reference)、[API 边界与导航](/overview/api-boundary)、[后端服务地图](/backend/service-map)、[前端 Hooks](/frontend/hooks)、[前端 Lib 工具箱](/frontend/lib-overview)
- 部署与维护：[部署指南](/dev-guide/deployment)、[Docker 与 Nginx](/dev-guide/docker-nginx)、[问题排查](/optimization/troubleshooting)

## 开源与版权

- 开源仓库：[hzb666/LabStorageManager](https://github.com/hzb666/LabStorageManager) - 基于 [AssetManager 框架](https://github.com/hzb666/AssetManager) 开发
- 开源许可：Apache-2.0 license
- Copyright © 2026 hzb666 and AssetManager contributors
