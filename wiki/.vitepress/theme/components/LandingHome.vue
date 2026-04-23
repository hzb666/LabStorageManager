<script setup lang="ts">
import {
  Atom,
  AppWindow,
  BookOpen,
  Bot,
  Container,
  Database,
  FileCheck2,
  FlaskConical,
  Megaphone,
  PackageCheck,
  RefreshCcw,
  Scale,
  Search,
  ShieldCheck,
  ShoppingCart,
  UserRound,
  Warehouse,
  Zap
} from '@lucide/vue'
import { withBase } from 'vitepress'
import './LandingHome.css'

const iconMap = {
  announce: Megaphone,
  bolt: Zap,
  cart: ShoppingCart,
  cas: Search,
  browser: AppWindow,
  container: Container,
  cycle: RefreshCcw,
  database: Database,
  doc: FileCheck2,
  flask: FlaskConical,
  license: Scale,
  molecule: Atom,
  robot: Bot,
  shelf: Warehouse,
  shield: ShieldCheck,
  stockin: PackageCheck,
  user: UserRound
} as const

const navItems = [
  ['产品功能', '#capabilities'],
  ['应用场景', '#scenarios'],
  ['部署方式', '/dev-guide/deployment'],
  ['快速了解', '/user-guide/overview'],
  ['GitHub', 'https://github.com/hzb666/LabStorageManager']
] as const

const heroActions = [
  ['使用指南', '/user-guide/overview', 'primary'],
  ['开始部署', '/overview/quick-start', 'secondary']
] as const

const topCapabilities = [
  ['cas', '全文与结构搜索', '支持中文、拼音、首字母、英文和 FTS 全文搜索，支持结构式精确或子结构搜索。'],
  ['browser', '浏览器插件', '从外部采购页面采集购物车，快速生成可追踪的采购批次。'],
  ['robot', 'Agent · CLI · MCP 入口', '面向自动化和企业微信机器人，提供受控命令入口。']
] as const

const capabilities = [
  ['flask', '订单分类', '试剂、耗材订单独立流转，采购状态和审批记录更清晰。'],
  ['stockin', '到货确认 · 一键入库', '到货后批量确认订单细节，自动生成独立库存记录。'],
  ['cycle', '库存借还闭环', '覆盖借出、归还、当前借用人与历史记录，流转可追溯。'],
  ['shelf', '常用货架', '集中管理常用试剂、CAS 主数据、位置和取用记录。'],
  ['shield', '权限 · 日志 · 会话', '统一处理权限控制、操作日志、设备状态和登录会话。'],
  ['announce', '导入导出 · 公告功能', '支持批量导入导出、公告发布和公告图片管理。']
] as const

const workflow = [
  ['cart', '采购申请', '提交采购 / 耗材申购单'],
  ['doc', '审批确认', '管理员审核，记录审批备注'],
  ['stockin', '到货入库', '到货确认，生成库存记录'],
  ['user', '借用归还', '借用登记、归还与当前借用人'],
  ['cycle', '全程追溯', '操作日志、会话与审计闭环']
] as const

const scenarios = [
  ['cart', '课题组采购协同', '适合成员提交试剂或耗材申请，管理员审批后继续完成到货、入库与追踪。'],
  ['shelf', '共享试剂与公用货架', '适合维护常备物品、共享实验台取用，以及公共电脑上的借还登记与位置管理。'],
  ['robot', '自动化接入与外部协同', '适合通过浏览器插件、CLI、MCP 或企业微信机器人接入采购、查询和受控操作流程。']
] as const

const techBadges = [
  ['bolt', 'FastAPI + React'],
  ['database', 'SQLite + Redis'],
  ['container', 'Docker 快速部署'],
  ['license', 'Apache 2.0 开源']
] as const

const heroShellStyle = {
  backgroundImage: `linear-gradient(rgba(248, 251, 255, 0.58), rgba(248, 251, 255, 0.58)), url("${withBase('/assets/landing-hero-bg.webp')}")`
}
const deviceImage = withBase('/assets/landing-device.webp')

function resolveLink(link: string) {
  return link.startsWith('http') || link.startsWith('#') ? link : withBase(link)
}
</script>

<template>
  <section class="landing" aria-labelledby="landing-title">
    <header class="landing-nav">
      <a class="landing-brand" :href="resolveLink('/')">LabStorageManager</a>
      <nav aria-label="首页导航">
        <a v-for="item in navItems" :key="item[0]" :href="resolveLink(item[1])">{{ item[0] }}</a>
      </nav>
      <a class="login-link" :href="resolveLink('/overview/overview')">查看文档</a>
    </header>

    <div class="hero-shell" :style="heroShellStyle">
      <div class="hero">
        <div class="hero-copy">
          <span class="hero-kicker">全生命周期 · 智能 · 高效 · 可追溯</span>
          <h1 id="landing-title">智能化实验室资产管理系统</h1>
          <p>覆盖采购、审批、到货、入库、借用归还与审计追踪，构建面向实验室与 Agent 集成的智能平台。</p>
          <div class="hero-actions">
            <a
              v-for="action in heroActions"
              :key="action[0]"
              :class="['hero-action', action[2]]"
              :href="resolveLink(action[1])"
            >
              <BookOpen v-if="action[2] === 'primary'" class="hero-action-icon" aria-hidden="true" />
              {{ action[0] }}
            </a>
          </div>
        </div>

        <div class="device-preview" aria-label="系统仪表盘界面预览">
          <img
            class="device-image"
            :src="deviceImage"
            width="1448"
            height="1086"
            alt="LabStorageManager 仪表盘笔记本样机"
            loading="eager"
            decoding="sync"
            fetchpriority="high"
          >
        </div>
      </div>
    </div>

    <div class="tech-row" aria-label="技术栈">
      <span v-for="item in techBadges" :key="item[1]" class="tech-badge">
        <component :is="iconMap[item[0]]" aria-hidden="true" />{{ item[1] }}
      </span>
    </div>

    <section id="capabilities" class="section-block">
      <h2><span />核心能力<span /></h2>
      <div class="top-capability-grid">
        <article v-for="item in topCapabilities" :key="item[1]" class="top-capability-card">
          <component :is="iconMap[item[0]]" aria-hidden="true" />
          <h3>{{ item[1] }}</h3>
          <p>{{ item[2] }}</p>
        </article>
      </div>
      <div class="capability-grid">
        <article v-for="item in capabilities" :key="item[1]" class="capability-card">
          <component :is="iconMap[item[0]]" aria-hidden="true" />
          <div><h3>{{ item[1] }}</h3><p>{{ item[2] }}</p></div>
        </article>
      </div>
    </section>

    <section class="section-block workflow-block">
      <h2><span />业务流程<span /></h2>
      <div class="workflow">
        <article v-for="item in workflow" :key="item[1]" class="workflow-step">
          <component :is="iconMap[item[0]]" aria-hidden="true" />
          <h3>{{ item[1] }}</h3>
          <p>{{ item[2] }}</p>
        </article>
      </div>
    </section>

    <section id="scenarios" class="section-block scenarios-block">
      <h2><span />应用场景<span /></h2>
      <div class="scenario-grid">
        <article v-for="item in scenarios" :key="item[1]" class="scenario-card">
          <component :is="iconMap[item[0]]" aria-hidden="true" />
          <div><h3>{{ item[1] }}</h3><p>{{ item[2] }}</p></div>
        </article>
      </div>
    </section>

    <footer class="landing-footer">
      <p><span />智能 · 高效 · 可追溯<span /></p>
      <div>
        <a :href="resolveLink('/overview/quick-start')">快速部署</a>
        <a :href="resolveLink('/overview/overview')">查看文档</a>
      </div>
      <small>Copyright © 2026 LabStorageManager. Licensed under Apache 2.0.</small>
    </footer>
  </section>
</template>
