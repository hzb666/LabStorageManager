# 状态与实时同步

## Zustand 管什么

当前前端至少有两类长期状态：

- 认证状态：`useAuthStore`
- UI 状态：`useUIStore`

它们都通过 `persist` 做本地持久化。

## 本地缓存不是随便写的

认证和侧边栏状态都带过期时间逻辑，不是永久写死在 `localStorage`。这让客户端状态能在“记住我”和“避免永久脏数据”之间取得平衡。

## 列表缓存与 SSE

列表页的数据并不只靠页面刷新。当前项目还具备：

- TanStack Query 缓存
- SSE 订阅
- 页面级刷新与失效机制

这让库存、订单等页面可以在变更后更快同步。

## 主题也是持久化状态

`useTheme` 会把 light/dark 主题写入本地存储，并在初始化时应用到页面。

## 参考代码

- `frontend/src/store/useStore.ts:6`
- `frontend/src/store/useStore.ts:53`
- `frontend/src/store/useStore.ts:85`
- `frontend/src/hooks/useSSE.ts:1`
- `frontend/src/hooks/useListSSE.ts:1`
