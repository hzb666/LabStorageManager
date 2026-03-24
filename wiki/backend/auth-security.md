# 认证与安全

## 认证方式

当前系统不是单一认证方式，而是同时支持：

- HTTPOnly Cookie 场景
- Bearer Token 场景

这让浏览器前端和接口调试场景都能覆盖，但也意味着安全策略不能只看某一种请求模式。

## 角色边界

系统角色包括：

- `admin`
- `user`
- `public`

不同角色不仅影响前端页面可见性，也影响后端接口权限，例如购物车导入明确拒绝 `public` 角色。

## 会话与设备管理

会话不是“只要 JWT 有效就算登录”，而是单独落在 `user_sessions` 表里，记录：

- 设备 ID
- 设备名
- 初始和最近 IP
- token hash
- 过期时间

这意味着系统具备显式设备管理和会话踢出的能力。

## 安全防护点

入口层当前已经实现了这些安全相关能力：

- 安全响应头
- HTTPS 重定向
- 上传大小限制
- 路由日志脱敏
- 可信来源判断

## 认证与权限排查建议

遇到“能登录但接口不可用”时，按这个顺序查：

1. `frontend/src/App.tsx` 的路由守卫
2. `frontend/src/api/client.ts` 的请求配置
3. `app/core/auth.py` 的当前用户解析
4. 具体接口是否附加管理员依赖

## 参考代码

- `app/models/user.py:19`
- `app/models/user_session.py:13`
- `app/main.py:110`
- `app/main.py:120`
- `app/api/cart_sync.py:169`
- `frontend/src/App.tsx:29`
