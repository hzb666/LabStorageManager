# 应用骨架

## 入口职责

<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/App.tsx" /> 是前端应用骨架的集中装配点，负责把全局能力一次性挂载到根树上：

- `useTheme()` 在启动阶段通过 `app-ui.theme` 恢复主题状态，并同步 `document.documentElement` 的 `dark` 类
- `ErrorBoundary` 兜底运行时异常，避免局部错误扩散为整页白屏
- `ToastContainer`、`TooltipProvider`、`BrowserRouter` 作为全局基础设施统一注入
- `Routes` 配合 `<Suspense>` 组织懒加载页面，降低首屏下载成本
- `Layout` 作为受保护页面的统一容器，承载导航、面包屑、通知等壳层能力
- 启动后通过一次性 `authAPI.getProfile()` 恢复登录态，并写入 `useAuthStore`

## 路由分层

前端路由在入口层先完成访问边界划分，再交给页面处理业务逻辑：

- 公开路由：`/login`、`/test-error`、`*`
- 受保护路由：仪表盘、订单、库存、导入、设备等业务页面
- 管理员路由：`/admin/users`、`/admin/announcements`、`/admin/logs`

`ProtectedRoute` 依据 `useAuthStore.isAuthenticated` 决定是否放行；未认证时跳转到 `/login`，并保留原路径与提示信息。`AdminRoute` 在此基础上进一步校验 `user.role`，用于约束管理入口。

## 改动入口

- 新增页面时，优先在 `App.tsx` 明确路由归属、守卫类型和懒加载方式
- 需要全局提示、悬浮层或错误兜底时，优先检查是否应挂到入口层，而不是放进单页组件
- 涉及登录态恢复时，优先调整 `authAPI.getProfile()` 与 `useAuthStore` 的协作逻辑

## 验证建议

- 新路由是否挂在正确的守卫下
- 懒加载页面是否能按访问触发加载
- 刷新页面后登录态是否按预期恢复
- 任一页面抛错时，是否仍由 `ErrorBoundary` 接管

## 参考代码
- [frontend/src/App.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/App.tsx)


