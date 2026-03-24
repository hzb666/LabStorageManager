import { defineConfig } from 'vitepress'

export default defineConfig({
  lang: 'zh-CN',
  title: 'LabStorageManager',
  description: '基于真实代码行为整理的实验室库存管理系统知识库',
  base: '/LabStorageManager/',
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }]
  ],
  lastUpdated: true,
  cleanUrls: true,
  themeConfig: {
    siteTitle: 'LabStorageManager',
    nav: [
      { text: '使用者指南', link: '/user-guide/overview' },
      { text: '开始', link: '/getting-started/overview' },
      { text: '架构', link: '/architecture/system-overview' },
      { text: '前端', link: '/frontend/app-shell' },
      { text: '后端', link: '/backend/runtime' },
      { text: '部署与扩展', link: '/operations/deployment' }
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/hzb666/LabStorageManager' }
    ],
    darkModeSwitchLabel: '外观',
    lightModeSwitchTitle: '切换到浅色模式',
    darkModeSwitchTitle: '切换到深色模式',
    sidebarMenuLabel: '菜单',
    returnToTopLabel: '返回顶部',
    skipToContentLabel: '跳转到正文',
    langMenuLabel: '切换语言',
    footer: {
      message: '开源项目 · Apache-2.0 license',
      copyright: 'Copyright © 2026 hzb666 and AssetManager contributors'
    },
    sidebar: [
      {
        text: '使用者指南',
        collapsed: false,
        items: [
          { text: '系统总览', link: '/user-guide/overview' },
          { text: '快速上手', link: '/user-guide/quick-start' },
          { text: '仪表盘', link: '/user-guide/dashboard' },
          { text: '角色与导航', link: '/user-guide/roles-and-navigation' },
          { text: '订单、采购与入库', link: '/user-guide/orders-and-procurement' },
          { text: '库存与借还', link: '/user-guide/inventory-and-borrowing' },
          { text: '账户、公告与支持', link: '/user-guide/account-and-support' },
          { text: '管理员指南', link: '/user-guide/admin-guide' },
          { text: '常见问题', link: '/user-guide/faq' }
        ]
      },
      {
        text: '入门引导',
        collapsed: false,
        items: [
          { text: '核心导读', link: '/onboarding/principal-guide' },
          { text: '从零到上手', link: '/onboarding/zero-to-hero' },
          { text: '术语表', link: '/onboarding/glossary' },
          { text: '关键文件索引', link: '/onboarding/key-files' }
        ]
      },
      {
        text: '开始',
        collapsed: false,
        items: [
          { text: '项目概览', link: '/getting-started/overview' },
          { text: '快速开始', link: '/getting-started/quick-start' },
          { text: '仓库地图', link: '/getting-started/repo-map' }
        ]
      },
      {
        text: '架构',
        collapsed: false,
        items: [
          { text: '系统总览', link: '/architecture/system-overview' },
          { text: '业务流程', link: '/architecture/business-flows' },
          { text: '数据模型', link: '/architecture/data-model' },
          { text: 'API 边界', link: '/architecture/api-boundary' }
        ]
      },
      {
        text: '前端',
        collapsed: false,
        items: [
          { text: '应用骨架', link: '/frontend/app-shell' },
          { text: '页面地图', link: '/frontend/page-map' },
          { text: '表格与表单体系', link: '/frontend/table-form-system' },
          { text: '状态与实时同步', link: '/frontend/state-sync' },
          { text: '界面系统', link: '/frontend/ui-system' }
        ]
      },
      {
        text: '后端',
        collapsed: false,
        items: [
          { text: '运行时与入口', link: '/backend/runtime' },
          { text: '认证与安全', link: '/backend/auth-security' },
          { text: '数据与搜索', link: '/backend/data-search' },
          { text: '核心 API 与工作流', link: '/backend/api-workflows' },
          { text: 'SSE、导入导出与外围能力', link: '/backend/realtime-io' }
        ]
      },
      {
        text: '部署与扩展',
        collapsed: false,
        items: [
          { text: '部署指南', link: '/operations/deployment' },
          { text: 'Docker 与 Nginx', link: '/operations/docker-nginx' },
          { text: '日常维护', link: '/operations/maintenance' },
          { text: '问题排查', link: '/operations/troubleshooting' },
          { text: '购物车同步扩展', link: '/extension/cart-sync' }
        ]
      }
    ],
    outline: {
      level: [2, 3],
      label: '本页目录'
    },
    search: {
      provider: 'local',
      options: {
        translations: {
          button: {
            buttonText: '搜索',
            buttonAriaLabel: '搜索文档'
          },
          modal: {
            displayDetails: '显示详情',
            resetButtonTitle: '清空搜索',
            backButtonTitle: '返回',
            noResultsText: '没有找到相关结果',
            footer: {
              selectText: '选择',
              selectKeyAriaLabel: '回车键',
              navigateText: '切换',
              navigateUpKeyAriaLabel: '向上箭头',
              navigateDownKeyAriaLabel: '向下箭头',
              closeText: '关闭',
              closeKeyAriaLabel: 'Esc 键'
            }
          }
        }
      }
    },
    docFooter: {
      prev: '上一页',
      next: '下一页'
    }
  }
})
