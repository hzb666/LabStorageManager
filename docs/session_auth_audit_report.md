# Session 过期验证调查报告

**调查时间**: 2026-03-14  
**项目**: LabStorageManager (实验室库存管理系统)

---

## 一、执行摘要

| 项目 | 状态 |
|------|------|
| 认证机制是否存在 | ✅ 存在 |
| JWT Token 验证 | ✅ 正常 |
| Session 过期验证 | ❌ **大部分接口缺失** |
| 受影响接口数量 | 约 **51 个** |
| 有过期验证的接口 | 仅 **5 个** |

---

## 二、认证机制概述

### 2.1 核心认证文件

| 文件 | 职责 |
|------|------|
| `app/core/auth.py` | JWT token 解析与用户认证，提供 `get_current_user` 和 `CurrentUser` |
| `app/api/deps.py` | Session 管理与过期验证，提供 `get_current_session` |
| `app/models/user_session.py` | Session 数据模型 |

### 2.2 两种认证依赖函数

| 函数 | 位置 | Session 过期验证 |
|------|------|-----------------|
| `get_current_user` | auth.py | ❌ **无** |
| `get_current_session` | deps.py | ✅ **有** |

---

## 三、当前 Session 逻辑

### 3.1 配置参数

| 参数 | 值 | 位置 |
|------|-----|------|
| JWT Token 过期时间 | **7 天** | `app/core/config.py:32` |
| Session 过期时间 | **3 天 (72 小时)** | `app/core/config.py:56` |

### 3.2 Session 失效的场景

| 失效方式 | 说明 | 代码位置 |
|----------|------|----------|
| **过期** | Session 超过 72 小时后过期 | `deps.py:145-148` |
| **主动登出** | 用户点击退出登录，删除 Session 记录 | `users.py:290` |
| **被踢出** | 管理员在另一设备踢掉当前设备 | `user_sessions.py` |
| **用户名修改** | 用户修改用户名，强制所有设备下线 | `auth.py:287-293` |

---

## 四、详细分析

### 4.1 `get_current_user` (auth.py) 验证逻辑

位置：[`app/core/auth.py:218-316`](app/core/auth.py:218)

**验证项目**：
- ✅ JWT token 格式有效性
- ✅ 用户 ID 存在性
- ✅ 用户账号是否 active
- ✅ username_version (用于用户名修改后强制下线)
- ✅ session 是否存在于数据库 (通过 token_hash 查询)

**缺失项目**：
- ❌ **Session 过期时间 (expires_at) 验证**

### 4.2 `get_current_session` (deps.py) 验证逻辑

位置：[`app/api/deps.py:36-183`](app/api/deps.py:36)

**验证项目**：
- ✅ JWT token 格式有效性
- ✅ Redis 缓存中的 expires_at 检查 (第 67-73 行)
- ✅ 数据库中的 session.expires_at 检查 (第 145-148 行)
- ✅ IP 地址变化检查
- ✅ 会话是否 active

```python
# Redis 缓存过期检查 (deps.py:67-73)
if expires_at < get_utc_now():
    delete_cached_session(token_hash)
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Session expired"
    )

# 数据库过期检查 (deps.py:145-148)
if session.expires_at < get_utc_now():
    db.delete(session)
    db.commit()
    raise HTTPException(status_code=401, detail="Session expired")
```

---

## 五、接口鉴权使用情况

### 5.1 使用 `get_current_user` (无 Session 过期验证)

| API 文件 | 接口数量 | 说明 |
|----------|----------|------|
| `consumable_orders.py` | 8 | 所有订单接口 |
| `reagent_orders.py` | 6 | 所有订单接口 |
| `reagent_orders_workflow.py` | 5 | 所有工作流接口 |
| `inventory.py` | 2 | 库存相关接口 |
| `inventory_extended_routes.py` | 9 | 扩展库存接口 |
| `users.py` | 6 | 用户管理接口 |
| `cart_sync.py` | 2 | 购物车同步接口 |
| `chemical_info.py` | 1 | 化学信息查询 |
| `announcements.py` | 10 | 公告管理接口 |
| `user_logs.py` | 2 | 日志查询接口 |

**总计：约 51 个接口使用 `get_current_user`，无 Session 过期验证**

### 5.2 使用 `get_current_session` (有 Session 过期验证)

| API 文件 | 接口数量 | 说明 |
|----------|----------|------|
| `error_logs.py` | 1 | 错误日志查询 |
| `user_sessions.py` | 4 | 会话管理相关 |

**仅 5 个接口有 Session 过期验证**

### 5.3 无需鉴权的接口

| 接口路径 | 说明 |
|----------|------|
| `/api/announcements/public` | 公开公告列表 |
| `/` | 根路由 |
| `/health` | 健康检查 |

---

## 六、JWT Token 与 Session 的关系

### 6.1 双重验证设计

```
┌─────────────────────────────────────────────────────────────┐
│                    正确认证流程                               │
├─────────────────────────────────────────────────────────────┤
│  请求带 JWT Token                                           │
│      ↓                                                     │
│  1. 解码 JWT → 获取 user_id ✅                            │
│  2. 查询 Session → 检查是否过期/被撤销 ✅                   │
│      ↓                                                     │
│  两者都需要! 职责不同                                       │
└─────────────────────────────────────────────────────────────┘
```

### 6.2 JWT Token 与 Session 的职责

| 组成部分 | 职责 | 包含信息 |
|----------|------|----------|
| **JWT Token** | 身份标识 | user_id, username, role, username_version, exp |
| **Session** | 状态控制 | 过期时间, 设备信息, IP 地址, 可撤销 |

### 6.3 两者配合使用的场景

| 场景 | JWT 作用 | Session 作用 |
|------|----------|--------------|
| 用户修改密码 | - | 所有 Session 失效 ✅ |
| 管理员踢设备 | - | 特定 Session 失效 ✅ |
| Session 过期 (3天) | - | 拒绝访问 ✅ |
| 用户主动登出 | - | Session 删除 ✅ |
| JWT 过期 (7天) | 拒绝访问，需要重新登录 | - ✅ |

---

## 七、安全问题与风险分析

### 7.1 当前安全风险

```
Session 过期 (3天) → Session 记录被删除
       ↓
get_current_user 检查: session 存在吗? → 不存在 → 拒绝访问 ✅
       ↓
但如果 Session 过期但未清理? (Redis缓存问题)
       ↓
用户仍可访问 7 天 (JWT token 有效期)! ❌
```

### 7.2 问题根源

项目中存在两套认证函数：
- `get_current_user`: 轻量级，只验证 JWT token 有效性
- `get_current_session`: 完整验证，包括 Session 过期检查

大多数接口错误地使用了前者，导致 Session 过期后仍可访问系统。

---

## 八、性能分析

### 8.1 两种认证方式的性能对比

| 认证方式 | DB 查询次数 | 说明 |
|----------|-------------|------|
| `get_current_user` (当前) | **2 次/请求** | 每次都查 DB |
| `get_current_session` | **0-2 次/请求** | 优先 Redis，命中 = 0 次 DB |

### 8.2 结论

**使用 `get_current_session` 不仅不会影响性能，反而因为 Redis 缓存可以减少数据库压力！**

---

## 九、修复建议

### 9.1 推荐方案

在 [`app/core/auth.py`](app/core/auth.py:218) 的 `get_current_user` 函数中，添加 session.expires_at 检查：

```python
# 在检查 session 是否存在后，添加过期时间检查
if not session:
    raise HTTPException(...)

# 添加以下检查
if session.expires_at < get_utc_now():
    db.delete(session)
    db.commit()
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Session expired, please login again"
    )
```

### 9.2 修复范围

只需修改一个函数 (`get_current_user`)，约 51 个接口将自动获得 Session 过期验证能力。

---

## 十、结论

| 检查项 | get_current_user | get_current_session |
|--------|------------------|-------------------|
| JWT 有效性 | ✅ | ✅ |
| Session 存在 | ✅ | ✅ |
| Session 过期 | ❌ | ✅ |
| Redis 缓存过期 | ❌ | ✅ |

**需要立即修复大多数接口的 Session 过期验证问题。修复后不仅安全，而且性能更好。**
