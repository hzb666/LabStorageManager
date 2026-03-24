# 界面系统

## UI 基础

当前前端建立在这些基础上：

- React 19
- Radix UI 原子组件
- Tailwind CSS 4
- 自建 `ui/` 组件层

这意味着视觉层既有统一基础，又保留了业务组件组合的灵活度。

## 主题与样式

样式核心不是每个组件单写，而是由：

- `index.css`
- `useTheme`
- 一系列 `ui/` 基础组件

共同控制。项目还包含公告、表格、提示等场景的专门 UI 组件。

## 面向使用者的界面特点

- 仪表盘聚合高频信息
- 列表页强调筛选与密度
- Toast 和 Tooltip 作为统一反馈机制
- 公告组件承载已读/关闭等前端状态

## 参考代码

- `frontend/src/index.css:1`
- `frontend/src/hooks/useTheme.ts:1`
- `frontend/src/components/ui/Toast.tsx:1`
- `frontend/src/components/ui/Tooltip.tsx:1`
- `frontend/src/components/AnnouncementDetail.tsx:1`
