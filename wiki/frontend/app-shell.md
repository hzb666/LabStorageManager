# 应用骨架

## 前端入口做了什么

`frontend/src/App.tsx` 负责把整个应用骨架拼起来：

- 初始化主题
- 挂载 `BrowserRouter`
- 注入 `ToastContainer` 和 `TooltipProvider`
- 定义受保护路由
- 定义管理员专属路由
- 对页面做懒加载

## 路由守卫

这个项目的权限控制不是只在后端做。前端也通过两个组件做了一层显式约束：

- `ProtectedRoute`
- `AdminRoute`

这决定了页面可见性和跳转体验。

## 错误边界

整个应用被 `ErrorBoundary` 包裹，说明前端把运行时异常兜底当成正式能力，而不是只靠控制台报错。

## 启动后会自动做的事

- 如果已认证，会请求 `authAPI.getProfile()` 刷新用户资料
- 主题会在 `useTheme()` 中初始化

## 参考代码

- `frontend/src/App.tsx:29`
- `frontend/src/App.tsx:41`
- `frontend/src/App.tsx:46`
- `frontend/src/App.tsx:138`
