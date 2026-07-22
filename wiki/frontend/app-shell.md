# 应用骨架

本页说明前端从 `main.tsx` 到 `App.tsx` 再到 `Layout` 的装配顺序，以及全局能力在入口层的挂载边界。

## 入口职责

前端骨架实际分成两层：

- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/main.tsx" />：创建 `QueryClient`、动态加载 `App`、挂载 `QueryClientProvider`，应用挂载后再执行运行时 cache version 引导。
- <InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/App.tsx" />：装配路由树、认证守卫、主题初始化、全局浮层和错误边界。

当前入口层承担的全局职责包括：

- `initSentry()`：仅在前端 DSN 有效时初始化错误、性能追踪和可选回放。
- `bootstrapCacheVersion(queryClient)`：应用挂载后检查运行时缓存版本，必要时清理前端缓存并跳转登录页。
- `ErrorBoundary`：包裹整个 `App`，运行时异常进入统一兜底页。
- `useTheme()`：初始化主题，把 `app-ui.theme` 回放到 `document.documentElement`，并同步 `color-scheme`。
- `ToastContainer`、`TooltipProvider`：统一提供消息提示和悬浮提示能力。
- `BrowserRouter` + `Routes`：集中维护公开页、受保护页和管理员页的边界。
- `bootstrapAuth()`：启动阶段探测服务端登录态，本地持久化的 `auth-storage` 仅作为启动快照。

## 路由分层

当前路由包含三类受保护边界：

- `LoginRoute`：如果用户已经处于已登录状态，访问 `/login` 会直接跳回首页。
- `ProtectedRoute`：用于需要登录但不走主布局壳层的独立页面，当前主要是 `/cart-import`。
- `ProtectedLayoutRoute`：用于首页、订单、库存、设备和管理后台等主业务页面。
- `AdminRoute`：在 `ProtectedLayoutRoute` 之上再检查 `user.role === admin`。

当前路由清单可以概括为：

- 公开路由：`/login`、未匹配路径 `*`
- 独立受保护路由：`/cart-import`
- 主布局受保护路由：`/`、`/reagents`、`/consumables`、`/inventory`、`/common-shelf`、`/import`、`/devices`、`/logs`
- 管理员路由：`/admin/users`、`/admin/announcements`、`/admin/logs`

## 认证恢复与守卫策略

当前登录恢复通过 `useAuthStore.bootstrapAuth()` 完成：

- `auth-storage` 只保存 `user` 和 `isAuthenticated`，TTL 为 3 天。
- 应用启动时 `authStatus` 先进入 `checking`。
- `bootstrapAuth()` 会调用 `/api/users/me`，并通过 `X-Skip-Auth-Invalidation: 1` 避免启动探测失败时弹出全局“会话失效”提示。
- 如果服务端返回 `401`，入口会把状态切换到未登录。
- 如果网络探测失败但本地仍有登录态快照，当前实现会暂时保留本地态，避免一次短暂探测失败把整个界面直接踢回登录页。

这套设计的重点是：入口层负责“确认会话是否还活着”，页面层只消费结果。

## Layout 的壳层职责

<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/pages/Layout.tsx" /> 是业务页统一壳层，承担：

- 桌面/移动双侧边栏
- 权限过滤后的导航项
- 公告横幅和公告按钮
- 主题切换按钮
- 用户入口与设备页入口
- 退出登录的二次确认
- 移动端抽屉展开时的 body 滚动锁定

这里还有两个容易忽略的细节：

- `Ctrl+B` 可以切换桌面侧边栏收起状态。
- 硬刷新且仍有本地登录态时，`ProtectedLayoutRoute` 会先渲染 `Layout deferOutlet`，让壳层保留，只把业务内容区延后，避免整页闪白。

## 懒加载与占位策略

- 所有业务页都通过 `React.lazy` + `<Suspense>` 懒加载。
- 普通业务页的 fallback 统一使用 `AuthDeferredShell`。
- `/cart-import` 使用单独的 `CartImportLoadingScreen`，因为这个页面在桥接批次时有更明显的“等待批次就绪”语义。
- `main.tsx` 对 `App` 采用动态导入；cache version bootstrap 在挂载后执行，并在版本变化时清理客户端状态。
- `fontLoader.ts` 先使用系统字体渲染，再加载 Noto Sans SC；网络字体失败时回退到版本化的本地 Source Han Sans，成功后记住本地来源。

## 改动入口

- 新增页面时，先决定它属于公开路由、独立受保护路由还是主布局路由。
- 需要全局提示、主题、错误兜底或浮层上下文时，优先挂在 `App.tsx`。
- 影响全站壳层体验的改动优先落在 `Layout.tsx`，避免在单页重复实现。
- 需要改登录恢复、401 处理或退出逻辑时，优先改 `useAuthStore` 和 `api/client.ts`。

## 验证要点

- 刷新受保护页面时，是否先进入 `checking` 再稳定恢复到正确页面。
- 未登录访问 `/cart-import` 时，是否正确跳回 `/login`。
- 已登录访问 `/login` 时，是否自动跳回首页。
- `Ctrl+B` 折叠侧边栏后，桌面布局是否平滑切换且 tooltip 行为正常。
- 页面抛异常时，是否仍由 `ErrorBoundary` 接管。
- 更改缓存版本后，入口层的 bootstrap 是否先完成缓存清理再挂载应用。

## 参考代码
- [frontend/src/App.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/App.tsx)
- [frontend/src/main.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/main.tsx)
- [frontend/src/pages/Layout.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/pages/Layout.tsx)
- [frontend/src/store/useStore.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/store/useStore.ts)
- [frontend/src/api/client.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/api/client.ts)
- [frontend/src/hooks/useTheme.ts](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/hooks/useTheme.ts)
- [frontend/src/components/AuthDeferredShell.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/components/AuthDeferredShell.tsx)
- [frontend/src/components/CartImportLoadingScreen.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/components/CartImportLoadingScreen.tsx)
