# 代码审查修复计划文档

> **创建日期**: 2026-02-25  
> **项目**: 实验室库存管理系统 (LIMS)  
> **技术栈**: FastAPI + SQLModel + React + SQLite

---

## 📊 修复统计总览

| 审查轮次 | 日期 | 修复数量 | 状态 |
|---------|------|---------|------|
| 代码审查 #1 | 2026-02-14 | 7 | ✅ 已完成 |
| 代码审查 #2 | 2026-02-14 | 3 | ✅ 已完成 |
| 全面代码审查重构 | 2026-02-16 | 14 | ✅ 已完成 |
| PR Review 修复 | 2026-02-17 | 4 | ✅ 已完成 |
| 安全审计 | 2026-02-22 | 8 | ✅ 已完成 |
| **总计** | - | **36** | ✅ |

---

## ✅ 已完成修复详情

### 第一轮代码审查 (2026-02-14) - 7项

| # | 类别 | 问题描述 | 修复文件 | 状态 |
|---|------|---------|---------|------|
| 1 | 安全 | 生产环境密钥硬编码问题 | `app/core/config.py` | ✅ |
| 2 | 安全 | SQL注入风险 (CAS LIKE模式) | `app/services/internal_code.py` | ✅ |
| 3 | UX | 使用 window.prompt() | `frontend/src/pages/Dashboard.tsx` | ✅ |
| 4 | 功能 | 未实现的导出按钮 | `inventory.py`, `client.ts`, `Inventory.tsx` | ✅ |
| 5 | 验证 | 订单入库数量验证缺失 | `app/api/orders.py` | ✅ |
| 6 | 并发 | 库存序号竞态条件 | `app/api/inventory.py` | ✅ |
| 7 | 安全 | 用户创建接口无认证 | `app/api/users.py` | ✅ |

### 第二轮代码审查 (2026-02-14) - 3项

| # | 类别 | 问题描述 | 修复文件 | 状态 |
|---|------|---------|---------|------|
| 8 | Bug | 函数名冲突 get_inventory_by_code | `app/api/inventory.py` | ✅ |
| 9 | Bug | 遗留 stock_in_order 使用错误的 generate_internal_code | `app/api/inventory.py` | ✅ |
| 10 | Bug | 驳回原因未存储 | `reagent_orders.py`, `consumable_orders.py` | ✅ |

### 全面代码审查重构 (2026-02-16) - 14项

#### P0 - 阻断性问题

| # | 类别 | 问题描述 | 修复文件 | 状态 |
|---|------|---------|---------|------|
| 11 | 性能 | WAL 模式未正确启用 | `app/database.py` | ✅ |
| 12 | Bug | generate_internal_code 双实现冲突 | `cas_utils.py`, `inventory.py` | ✅ |
| 13 | 安全 | 用户注册接口无认证 | `app/api/users.py` | ✅ |
| 14 | Bug | Dashboard 入库按钮状态逻辑 | `Dashboard.tsx`, `reagent_orders.py` | ✅ |
| 15 | Bug | reject/confirm-arrival 参数不匹配 | `reagent_orders.py`, `consumable_orders.py` | ✅ |

#### P1 - 重要改进

| # | 类别 | 问题描述 | 修复文件 | 状态 |
|---|------|---------|---------|------|
| 16 | 冗余 | 旧 stock-in 路由冗余 | `app/api/inventory.py` | ✅ |
| 17 | 安全 | 订单列表接口无认证 | `reagent_orders.py`, `consumable_orders.py` | ✅ |
| 18 | 验证 | 归还数量无上限校验 | `app/api/inventory.py` | ✅ |
| 19 | Bug | 路由顺序 + 函数名冲突 | `app/api/inventory.py` | ✅ |

#### P2 - 代码质量

| # | 类别 | 问题描述 | 修复文件 | 状态 |
|---|------|---------|---------|------|
| 20 | 优化 | CSV 导出返回 JSON | `app/api/inventory.py` | ✅ |
| 21 | 配置 | CORS 硬编码 | `app/main.py`, `app/core/config.py` | ✅ |
| 22 | 日志 | 日志缺失 | `app/main.py`, `app/database.py` | ✅ |
| 23 | Bug | Token 双重存储 | `useStore.ts`, `client.ts` | ✅ |
| 24 | 代码 | 前端状态映射分散 | `frontend/src/lib/constants.ts` | ✅ |
| 25 | Bug | spec_utils 单位大小写 | `app/services/spec_utils.py` | ✅ |
| 26 | Bug | /dashboard/my-borrows 时区问题 | `app/api/inventory.py` | ✅ |

### PR Review 修复 (2026-02-17) - 4项

| # | 类别 | 问题描述 | 修复文件 | 状态 |
|---|------|---------|---------|------|
| 27 | Bug | pd.read_csv 参数错误 | `app/services/excel_service.py` | ✅ |
| 28 | Bug | 驳回操作覆盖 notes 备注 | `reagent_orders.py`, `consumable_orders.py` | ✅ |
| 29 | 安全 | APPROVED 一键入库缺少权限检查 | `app/api/reagent_orders.py` | ✅ |
| 30 | Bug | common_public 订单可被错误入库 | `reagent_orders.py`, `Dashboard.tsx` | ✅ |
| 31 | Bug | 切换每页条数后数据不变化 | `app/api/inventory.py` | ✅ |

### 安全审计修复 (2026-02-22) - 8项

| # | 类别 | 问题描述 | 修复文件 | 状态 |
|---|------|---------|---------|------|
| 32 | 安全 | JWT 密钥硬编码 | `app/core/config.py` | ✅ |
| 33 | 安全 | 库存更新缺少权限控制 | `app/api/inventory.py` | ✅ |
| 34 | 安全 | 敏感 API 端点缺少认证 | `app/api/inventory.py` | ✅ |
| 35 | 安全 | Cookie 安全配置不足 | `app/api/users.py` | ✅ |
| 36 | 安全 | 用户更新可提升权限 | `app/api/users.py` | ✅ |
| 37 | 安全 | 权限检查使用字符串而非枚举 | `reagent_orders.py`, `consumable_orders.py` | ✅ |
| 38 | 安全 | 消耗品订单更新缺少权限检查 | `app/api/consumable_orders.py` | ✅ |
| 39 | 安全 | 前端角色检查非安全边界 | `frontend/src/App.tsx` | ✅ |

---

## 📋 经验教训总结

### 开发规范

| # | 教训 | 规则 |
|---|------|------|
| 1 | WAL 模式不能通过 URL 参数设置 | 使用 `event.listens_for(engine, "connect")` + `PRAGMA` |
| 2 | FastAPI 路由顺序至关重要 | 具名路由必须在通配 ID 路由之前 |
| 3 | 辅助函数与路由函数不能同名 | 内部函数用下划线前缀 `_get_by_id` |
| 4 | 参数传递一致性 | 修改操作用 Pydantic Body，查询用 Query |
| 5 | Token 单一来源原则 | 认证状态由一个 store 管理 |
| 6 | CSV 导出使用 StreamingResponse | 直接下载而非 JSON 包装 |

### 安全规范

| # | 教训 | 规则 |
|---|------|------|
| 1 | JWT 密钥不能硬编码 | 使用 `secrets.token_urlsafe()` 生成 |
| 2 | API 端点必须验证认证状态 | 新增端点必须添加 `Depends(get_current_user)` |
| 3 | 权限比较必须使用枚举 | 使用 `UserRole.ADMIN` 而非字符串 `"admin"` |
| 4 | Cookie 生产环境启用 secure | `secure=settings.env != "development"` |
| 5 | 前端路由也需要权限保护 | 使用 `AdminRoute` 组件 |

### 前后端协作

| # | 教训 | 规则 |
|---|------|------|
| 1 | 前后端状态校验必须一致 | 前端按钮对应的后端接口必须支持该状态 |
| 2 | SQLite datetime 往返丢失时区 | 算术运算时确保 tz-awareness 一致 |
| 3 | PowerShell 语法差异 | 使用 `;` 而非 `&&`，不支持 Unix 命令 |

---

## 🔜 后续建议（未完成项）

### 低优先级项

| # | 项目 | 原因 | 建议处理方式 |
|---|------|------|-------------|
| 1 | 登录速率限制内存存储 | 当前场景够用 | 未来使用 Redis |
| 2 | 密码强度要求 | 最小复杂度已足够 | 可选增强 |
| 3 | CSRF 保护 | JWT + httpOnly Cookie 足够 | 可选增强 |
| 4 | 缺少日志审计 | 已添加基础日志 | 可选增强操作日志 |

---

## 🔄 定期审查计划

### 建议周期

| 审查类型 | 周期 | 重点 |
|---------|------|------|
| 代码审查 | 每完成一个功能 | 代码质量、Bug、安全 |
| 安全审计 | 每季度 | 认证、授权、数据保护 |
| 性能审计 | 每半年 | 缓存、查询优化 |

### 审查清单

**新增 API 端点必检项**:
- [ ] 添加了 `Depends(get_current_user)` 或 `Depends(require_admin)`
- [ ] 权限比较使用枚举 `UserRole.ADMIN`
- [ ] 参数使用 Pydantic Body 模型
- [ ] 路由顺序正确（具名路由在前）

**新增前端页面必检项**:
- [ ] 使用语义化颜色（bg-background, text-foreground 等）
- [ ] 使用 toast 通知而非 alert
- [ ] 操作按钮状态与后端逻辑一致

---

## 📁 相关文档

- [BUGS.md](prompt/BUGS.md) - 问题详细记录
- [Lessons.md](prompt/Lessons.md) - 经验教训总结
- [SECURITY_AUDIT_REPORT.md](prompt/SECURITY_AUDIT_REPORT.md) - 安全审计报告
- [Progress.md](prompt/Progress.md) - 项目进度
- [milestone.md](prompt/milestone.md) - 提交历史

---

*文档更新时间: 2026-02-25*
