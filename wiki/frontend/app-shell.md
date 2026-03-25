# 应用骨架

## 前端入口做了什么

<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/App.tsx" /> 负责把整个应用骨架拼起来：

- `AppContent` 先通过 `useTheme()` 初始化主题（会写入 `localStorage` 并切换 `document.documentElement` 上的 `dark` 类）
- 通过 `ErrorBoundary` 兜底运行时异常，避免整个应用直接白屏
- 注入 `ToastContainer`、`TooltipProvider` 与 `BrowserRouter`
- 通过 `Routes` + `<Suspense>` 包裹每个懒加载页面，只有真实访问时才会请求对应 chunk
- 将 `Layout` 当作受保护的嵌套路由容器，大多数业务路由都挂在其下
- `useEffect` 在刷新后仅调用一次 `authAPI.getProfile()` 并把结果写入 `useAuthStore`，确保头像/权限在每次打开页面时同步

## 路由守卫

这个项目的权限控制不是只在后端做。前端也通过两个组件做了一层显式约束：

- `ProtectedRoute` 会从 `useAuthStore` 读取 `isAuthenticated`，未认证时通过 `Navigate` 跳转到 `/login` 并把当前 `location.pathname`、`authNotice`（登录失败提示）放到 `state`，以便登录页重新弹出提示
- `AdminRoute` 除了 `isAuthenticated`，还会把 `user.role` 与 `UserRoles.ADMIN` 对齐，非管理员直接 `Navigate` 回 `/`

加上懒加载+`Suspense`，既在低优先级路由加载时节省资源，也保证守卫只在验证通过后才把页面注入 DOM。

## 错误边界

整个应用被 `ErrorBoundary` 包裹，说明前端把运行时异常兜底当成正式能力，而不是只靠控制台报错。

`AppContent` 还在 `useEffect` 里保持 `hasFetchedUser` 只触发一次的约定：刷新页面后立刻走 `authAPI.getProfile()`，成功时 `setAuth(res.data)`，失败则打印错误但不阻塞页面。

## 启动后会自动做的事

- 如果已认证，会请求 `authAPI.getProfile()` 刷新用户资料
- 主题会在 `useTheme()` 中初始化

## 路由守卫边界（当前实现）

- 公开路由：`/login`、`/test-error`、`*`（404）。
- 受保护路由：业务主路径（仪表盘、订单、库存、导入、设备）。
- 管理员路由：`/admin/users`、`/admin/announcements`、`/admin/logs`。

这样分层后，前端可以尽早拦截无效访问，减少“请求到后端才失败”的无效交互。

## 开发者接入检查

- 新页面是否选择了正确的守卫（用户级或管理员级）。
- 是否通过 `React.lazy` 与 `<Suspense>` 保持按需加载。
- 是否在页面挂载时避免重复请求（参照 `hasFetchedUser` 的一次性恢复逻辑）。
- 是否保留 `ErrorBoundary` 兜底，避免局部页面异常导致全局白屏。

## 参考代码
- [frontend/src/App.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/App.tsx)


