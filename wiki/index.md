---
layout: home

hero:
  name: LabStorageManager
  text: 智能化全生命周期资产管理系统
  tagline: 可追溯、高智能、强协同
  actions:
    - theme: brand
      text: 使用者指南
      link: /user-guide/overview
    - theme: brand
      text: 快速部署
      link: /overview/quick-start
    - theme: alt
      text: 系统架构
      link: /overview/overview
    - theme: alt
      text: 自动化边界
      link: /overview/api-boundary
    - theme: alt
      text: 开发入门
      link: /dev-guide/zero-to-hero
    - theme: alt
      text: 版本记录
      link: /changelog

features:
  - title: Agent 与 CLI 受控入口
    details: Agent skill、脚本和运维任务通过 CLI 命令面访问后端，不直连数据库。
  - title: MCP 与智能机器人
    details: MCP 调用 CLI 子进程，企业微信智能机器人和微信客服复用同一套查询与确认流程。
  - title: 浏览器插件导入
    details: 插件采集外部购物车，导入页逐项确认后调用标准订单接口。
  - title: 试剂、耗材与库存闭环
    details: 申购、审批、到货、入库、借用、归还和操作日志都回到统一业务 API。
---

## 系统核心能力

- 试剂申购：适合有 CAS 号、需要到货和入库追踪的物品。
- 耗材采购：适合低值易耗、无需瓶级库存跟踪的采购品。
- 库存管理：支持搜索、借用、归还、手动入库、导出和位置维护。
- 常用货架：沉淀公用试剂，减少重复采购。
- 会话与公告：支持设备管理、公告通知和管理员发布。
- 自动化入口：支持 CLI、Agent skill、MCP、企业微信智能机器人和微信客服。
- 浏览器插件：支持把外部购物车导入系统。

## 角色业务

- 实验室成员：查库存、下订单、借用和归还。
- 管理员：审批订单、导入库存、管理公告和用户。
- 公用终端使用者：快速查询库存、登记借用、查看共享试剂。

## 常用入口

- 使用者先看：[系统总览](/user-guide/overview)、[使用入门](/user-guide/quick-start)、[仪表盘](/user-guide/dashboard)。
- 日常使用：[角色与导航](/user-guide/roles-and-navigation)、[订单、采购与入库](/user-guide/orders-and-procurement)、[库存与借还](/user-guide/inventory-and-borrowing)。
- 账户与支持：[账户、公告与支持](/user-guide/account-and-support)、[管理员指南](/user-guide/admin-guide)、[使用排障](/user-guide/faq)。
- 新成员接手：[项目概览](/overview/overview)、[快速部署](/overview/quick-start)、[从零到上手](/dev-guide/zero-to-hero)。
- 理解系统设计：[系统总览](/overview/system-overview)、[目录结构](/overview/directory-structure)、[技术栈](/overview/tech-stack)、[数据模型](/database/data-model)。
- 二次开发重点：[API 参考](/backend/api-reference)、[API 边界与导航](/overview/api-boundary)、[后端服务地图](/backend/service-map)、[CLI、MCP 与机器人入口](/dev-guide/key-files)、[前端 Hooks](/frontend/hooks)、[前端 Lib 工具箱](/frontend/lib-overview)。
- 部署与维护：[部署指南](/dev-guide/deployment)、[Docker 与 Nginx](/dev-guide/docker-nginx)、[版本记录](/changelog)。

## 开源与版权

- 开源仓库：[hzb666/LabStorageManager](https://github.com/hzb666/LabStorageManager) - 基于 [AssetManager 框架](https://github.com/hzb666/AssetManager) 开发
- 开源许可：Apache-2.0 license
- Copyright © 2026 hzb666 and AssetManager contributors
