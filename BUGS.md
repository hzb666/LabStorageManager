# BUGS.md - 问题记录

## 2026-03-06 登录后发起大量 API 请求问题

### 问题描述
登录后同时发起大量 API 请求，造成性能浪费。

### 问题日志
```
INFO:     127.0.0.1:3431 - "POST /api/users/login HTTP/1.1" 200 OK
INFO:     127.0.0.1:3431 - "GET /api/users/me HTTP/1.1" 200 OK
INFO:     127.0.0.1:3218 - "GET /api/consumable-orders/dashboard/my-orders HTTP/1.1" 200 OK
INFO:     127.0.0.1:3218 - "GET /api/inventory/dashboard/my-borrows HTTP/1.1" 200 OK
INFO:     127.0.0.1:3218 - "GET /api/inventory/dashboard/pending-stockin HTTP/1.1" 200 OK
INFO:     127.0.0.1:3431 - "GET /api/reagent-orders/dashboard/my-orders HTTP/1.1" 200 OK
INFO:     127.0.0.1:3218 - "GET /api/announcements/public HTTP/1.1" 200 OK
INFO:     127.0.0.1:3431 - "GET /api/consumable-orders/dashboard/my-orders HTTP/1.1" 200 OK
INFO:     127.0.0.1:3218 - "GET /api/inventory/dashboard/my-borrows HTTP/1.1" 200 OK
INFO:     127.0.0.1:3431 - "GET /api/inventory/dashboard/pending-stockin HTTP/1.1" 200 OK
INFO:     127.0.0.1:3218 - "GET /api/reagent-orders/dashboard/my-orders HTTP/1.1" 200 OK
INFO:     127.0.0.1:3431 - "GET /api/announcements/public HTTP/1.1" 200 OK
INFO:     127.0.0.1:13880 - "GET /api/announcements/public HTTP/1.1" 200 OK
INFO:     127.0.0.1:11574 - "GET /api/announcements/ HTTP/1.1" 200 OK
INFO:     127.0.0.1:11370 - "GET /api/announcements/storage-info HTTP/1.1" 200 OK
```

### 请求来源分析

| 序号 | API 请求 | 来源文件 | 调用原因 |
|:---:|---------|---------|---------|
| 1 | `POST /api/users/login` | Login.tsx:82 | 登录接口 |
| 2 | `GET /api/users/me` | App.tsx:51 | 刷新页面时获取用户信息 |
| 3 | `GET /api/consumable-orders/dashboard/my-orders` | Dashboard.tsx:335 | Dashboard 并行加载 |
| 4 | `GET /api/inventory/dashboard/my-borrows` | Dashboard.tsx:398 | Dashboard 并行加载 |
| 5 | `GET /api/inventory/dashboard/pending-stockin` | Dashboard.tsx:411 | Dashboard 并行加载 |
| 6 | `GET /api/reagent-orders/dashboard/my-orders` | Dashboard.tsx:335 | Dashboard 并行加载 |
| 7 | `GET /api/announcements/public` | Layout.tsx:55 | **每次路由变化都触发！** |

### 根本原因

1. **Layout.tsx 路由监听导致公告重复请求** - 主要原因
   - `useEffect` 依赖 `location`，每次路由变化都重新请求
   - 登录后跳转到首页，触发多次请求
   - 不同端口是 Vite 热重载多服务器导致

2. **React Strict Mode** - 开发模式下组件渲染两次

### 修复方案

1. 为公告数据添加缓存机制，避免重复请求
2. 优化 Layout.tsx 中的 useEffect 依赖

### 状态
- [x] 已修复 - 改为只在组件挂载时获取一次公告数据
