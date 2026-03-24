---
layout: home

hero:
  name: LabStorageManager
  text: 实验室库存与申购协同平台
  tagline: 覆盖试剂申购、耗材采购、库存借还、常用货架、公告通知与设备管理
  actions:
    - theme: brand
      text: 快速上手
      link: /user-guide/quick-start
    - theme: brand
      text: 使用者指南
      link: /user-guide/overview
    - theme: alt
      text: 系统架构
      link: /getting-started/overview
    - theme: alt
      text: 开发入门
      link: /onboarding/zero-to-hero

features:
  - title: 试剂与耗材双流程
    details: 试剂支持 CAS、到货与入库链路；耗材走更轻量的采购与完成流程。
  - title: 库存借还可追溯
    details: 支持库存查询、借用、归还、待入库管理和用户操作留痕。
  - title: 常用货架与批量导入
    details: 适合公用试剂沉淀、集中补录库存，以及共享场景下的快速查找。
  - title: 公告与设备管理
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

- 实验室成员：查库存、下订单、借用和归还
- 管理员：审批订单、导入库存、管理公告和用户
- 公用终端使用者：快速查询库存、登记借用、查看共享试剂
- 开发与维护人员：了解系统结构、部署方式和扩展能力

## 常用入口

- 使用者先看：[系统总览](/user-guide/overview)、[快速上手](/user-guide/quick-start)、[仪表盘](/user-guide/dashboard)
- 日常使用：[角色与导航](/user-guide/roles-and-navigation)、[订单、采购与入库](/user-guide/orders-and-procurement)、[库存与借还](/user-guide/inventory-and-borrowing)
- 账户与支持：[账户、公告与支持](/user-guide/account-and-support)、[管理员指南](/user-guide/admin-guide)、[常见问题](/user-guide/faq)
- 新成员接手：[项目概览](/getting-started/overview)、[快速开始](/getting-started/quick-start)、[从零到上手](/onboarding/zero-to-hero)
- 理解系统设计：[系统总览](/architecture/system-overview)、[业务流程](/architecture/business-flows)、[数据模型](/architecture/data-model)
- 部署与维护：[部署指南](/operations/deployment)、[Docker 与 Nginx](/operations/docker-nginx)、[问题排查](/operations/troubleshooting)

## 开源与版权

- 开源仓库：[hzb666/LabStorageManager](https://github.com/hzb666/LabStorageManager) - 基于 [AssetManager 框架](https://github.com/hzb666/AssetManager) 开发
- 开源许可：Apache-2.0 license
- Copyright © 2026 hzb666 and AssetManager contributors
