import { defineConfig } from "vitepress";
import { MermaidPlugin } from "@leelaa/vitepress-plugin-extended";

const SITE_BASE = "/LabStorageManager/";

export default defineConfig({
  lang: "zh-CN",
  title: "LabStorageManager",
  description: "基于真实代码行为整理的实验室库存管理系统知识库",
  base: SITE_BASE,
  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: `${SITE_BASE}favicon.svg` }],
    ["link", { rel: "preconnect", href: "https://fonts.googleapis.cn" }],
    ["link", { rel: "preconnect", href: "https://fonts.gstatic.cn", crossorigin: "" }],
    ["script", {}, "document.documentElement.setAttribute('data-font-state','loading')"],
  ],
  lastUpdated: true,
  cleanUrls: true,
  vite: {
    build: {
      chunkSizeWarningLimit: 1700,
    },
  },
  markdown: {
    config: (md) => {
      md.use(MermaidPlugin);
    },
  },
  themeConfig: {
    siteTitle: "LabStorageManager",
    nav: [
      {
        text: "使用者指南",
        link: "/user-guide/overview",
        activeMatch: "^/user-guide/",
      },
      { text: "概览", link: "/overview/overview", activeMatch: "^/overview/" },
      { text: "前端", link: "/frontend/app-shell", activeMatch: "^/frontend/" },
      { text: "后端", link: "/backend/runtime", activeMatch: "^/backend/" },
      {
        text: "数据库",
        link: "/database/data-model",
        activeMatch: "^/database/",
      },
      {
        text: "开发指南",
        link: "/dev-guide/principal-guide",
        activeMatch: "^/dev-guide/",
      },
      {
        text: "更新日志",
        link: "/changelog",
        activeMatch: "^/changelog$",
      },
    ],
    socialLinks: [
      { icon: "github", link: "https://github.com/hzb666/LabStorageManager" },
    ],
    darkModeSwitchLabel: "外观",
    lightModeSwitchTitle: "切换到浅色模式",
    darkModeSwitchTitle: "切换到深色模式",
    sidebarMenuLabel: "菜单",
    returnToTopLabel: "返回顶部",
    skipToContentLabel: "跳转到正文",
    langMenuLabel: "切换语言",
    footer: {
      message: "开源项目 · Apache-2.0 license",
      copyright: "Copyright © 2026 hzb666 and AssetManager contributors",
    },
    lastUpdated: {
      text: "最后更新",
    },
    sidebar: [
      {
        text: "使用者指南",
        collapsed: false,
        items: [
          { text: "系统总览", link: "/user-guide/overview" },
          { text: "快速上手", link: "/user-guide/quick-start" },
          { text: "仪表盘", link: "/user-guide/dashboard" },
          { text: "角色与导航", link: "/user-guide/roles-and-navigation" },
          {
            text: "订单、采购与入库",
            link: "/user-guide/orders-and-procurement",
          },
          { text: "库存、借还与常用货架", link: "/user-guide/inventory-and-borrowing" },
          { text: "账户、公告与使用支持", link: "/user-guide/account-and-support" },
          { text: "管理员指南", link: "/user-guide/admin-guide" },
          { text: "使用排障", link: "/user-guide/faq" },
        ],
      },
      {
        text: "概览",
        collapsed: false,
        items: [
          { text: "项目概览", link: "/overview/overview" },
          { text: "快速开始", link: "/overview/quick-start" },
          { text: "目录结构", link: "/overview/directory-structure" },
          { text: "技术栈", link: "/overview/tech-stack" },
          { text: "系统总览", link: "/overview/system-overview" },
          { text: "业务流程", link: "/overview/business-flows" },
          { text: "API 边界与导航", link: "/overview/api-boundary" },
        ],
      },
      {
        text: "前端",
        collapsed: false,
        items: [
          { text: "应用骨架", link: "/frontend/app-shell" },
          { text: "页面地图", link: "/frontend/page-map" },
          { text: "组件层", link: "/frontend/components" },
          { text: "Hooks 层", link: "/frontend/hooks" },
          { text: "Lib 层", link: "/frontend/lib-overview" },
          { text: "表格与表单体系", link: "/frontend/table-form-system" },
          { text: "状态同步", link: "/frontend/state-sync" },
        ],
      },
      {
        text: "后端",
        collapsed: false,
        items: [
          { text: "运行时与入口", link: "/backend/runtime" },
          { text: "认证与安全", link: "/backend/auth-security" },
          { text: "后端服务地图", link: "/backend/service-map" },
          { text: "核心 API 与工作流", link: "/backend/api-workflows" },
          { text: "API 参考", link: "/backend/api-reference" },
          { text: "SSE、导入导出与外围能力", link: "/backend/realtime-io" },
        ],
      },
      {
        text: "数据库",
        collapsed: false,
        items: [
          { text: "数据模型", link: "/database/data-model" },
          { text: "字段参考", link: "/database/field-reference" },
          { text: "数据与搜索", link: "/database/data-search" },
        ],
      },
      {
        text: "开发指南",
        collapsed: false,
        items: [
          { text: "核心导读", link: "/dev-guide/principal-guide" },
          { text: "从零到上手", link: "/dev-guide/zero-to-hero" },
          { text: "关键文件索引", link: "/dev-guide/key-files" },
          { text: "开发、部署与代理", link: "/dev-guide/deployment" },
          { text: "运维与排障", link: "/dev-guide/docker-nginx" },
          { text: "搜索补全建议", link: "/dev-guide/search-completions" },
          { text: "浏览器插件购物车同步", link: "/dev-guide/cart-sync" },
          { text: "术语表", link: "/dev-guide/glossary" },
        ],
      },
      { text: "更新日志", link: "/changelog" },
    ],
    outline: {
      level: [2, 3],
      label: "本页目录",
    },
    search: {
      provider: "local",
      options: {
        translations: {
          button: {
            buttonText: "搜索",
            buttonAriaLabel: "搜索文档",
          },
          modal: {
            displayDetails: "显示详情",
            resetButtonTitle: "清空搜索",
            backButtonTitle: "返回",
            noResultsText: "没有找到相关结果",
            footer: {
              selectText: "选择",
              selectKeyAriaLabel: "回车键",
              navigateText: "切换",
              navigateUpKeyAriaLabel: "向上箭头",
              navigateDownKeyAriaLabel: "向下箭头",
              closeText: "关闭",
              closeKeyAriaLabel: "Esc 键",
            },
          },
        },
      },
    },
    docFooter: {
      prev: "上一页",
      next: "下一页",
    },
  },
});
