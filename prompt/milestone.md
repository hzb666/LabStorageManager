# 项目里程碑

## 提交历史（按功能分类）

### Phase 1: 后端基础

| 提交哈希 | 描述 | 类型 |
|---------|------|------|
| `60cac7a` | 初始提交 | feat |
| `ec1e885` | Phase 1.1 后端初始化 - FastAPI + SQLModel with WAL mode | feat |
| `cf23049` | Phase 1.2 JWT认证 - login, get_current_user, protected endpoints | feat |

### Phase 2: 工作流

| 提交哈希 | 描述 | 类型 |
|---------|------|------|
| `11f10c0` | 添加时间线到Progress.md | docs |
| `d62b7aa` | Phase 2.5 工作流调整 | feat |

### Phase 3: 库存管理

| 提交哈希 | 描述 | 类型 |
|---------|------|------|
| `90980e5` | 添加README | docs |
| `75d6785` | Phase 4 Excel导入后端 | feat |
| `03cefe4` | 启用完整JWT认证 - 替换所有hardcoded user_id=1 | feat |
| `d9505a4` | 清理未使用的imports | refactor |
| `27a7eda` | 保留imports以备未来使用 | refactor |

### Phase 4: 前端开发

| 提交哈希 | 描述 | 类型 |
|---------|------|------|
| `9ffd75b` | Phase 5.1 前端初始化 - React + Vite + Shadcn/UI | feat |
| `bb455c4` | 代码审查修复 - CORS安全、Excel导入user_id、Dashboard状态 | fix |
| `ca54e34` | 前端页面开发 - 订单表单、库存表格、Excel导入 | feat |
| `7ee0b82` | 更新Progress.md，添加Phase 6计划 | docs |
| `418f55a` | 添加Phase 6用户管理API设计文档 | docs |
| `9ad6c77` | 整理文档结构，Progress.md简化，IMPLEMENTATION_PLAN.md添加Phase 6详情 | docs |
| `b048582` | 更新Progress.md，添加Phase 7通知系统 | docs |
| `a446da3` | 优化确认收货逻辑，consumable和common_public直接完成 | feat |
| `7ec9e65` | 更新确认收货逻辑文档 | docs |
| `a0bae19` | 更新Progress和IMPLEMENTATION_PLAN，添加Phase 2.6 | docs |
| `022222a` | 重写IMPLEMENTATION_PLAN.md，标明所有已实现功能 | docs |

### Phase 5: 库存操作

| 提交哈希 | 描述 | 类型 |
|---------|------|------|
| `297e360` | 实现手动入库功能 | feat |
| `6bd40e2` | 修复安全漏洞 - 补充缺失的current_user权限检查 | fix |
| `2e6fce4` | 更新Lessons.md记录审查发现和修复经验 | docs |
| `fd58c1b` | 修复SQLite语法和安全配置问题 | fix |
| `7b5e459` | 更新Lessons.md记录SQL语法和安全配置修复 | docs |
| `4a6fd33` | 代码审查修复 - 安全漏洞、功能缺陷和用户体验改进 | fix |
| `bb7383a` | 更新README添加库存导出API说明 | docs |
| `841b96e` | 代码审查修复 - prompt()替换、枚举比较优化、导出权限控制 | fix |

### Phase 6: 用户管理

| 提交哈希 | 描述 | 类型 |
|---------|------|------|
| `d3db8de` | 更新Progress.md - 记录代码审查修复 | docs |
| `679ee10` | Phase 7 用户管理 - 软删除、启用API、搜索筛选、前端页面 | feat |
| `0163e7f` | 更新Progress.md - Phase 7用户管理完成 | docs |
| `5fe454b` | 用户列表API - 添加role筛选异常处理、改为require_admin权限 | fix |
| `da243de` | 修复代码审查发现的问题 - 添加CAS预警接口认证、创建gitignore、替换alert | fix |

### Phase 7: 通知系统

| 提交哈希 | 描述 | 类型 |
|---------|------|------|
| `a4881d6` | Phase 8 通知提醒 - CAS预警、入库按钮优化 | feat |

### Phase 8: 订单系统优化

| 提交哈希 | 描述 | 类型 |
|---------|------|------|
| `55619a4` | 耗材和试剂订购分离 - 独立订单系统 | feat |
| `fbf8184` | 修复代码审查问题 | fix |

### Phase 9: 代码质量与重构

| 提交哈希 | 描述 | 类型 |
|---------|------|------|
| `be4b3fc` | 文档更新 | docs |
| `844cd4a` | 代码审查修复 - 修复 P0/P1/P2 问题（14项） | refactor |
| `69ffc92` | 合并 PR #1 - code quality | merge |
| `2778ba6` | 更新过期文档，记录全部审查修复 | docs |
| `ed1b55c` | 修复剩余代码质量问题 | fix |
| `cc988c1` | 替换全部 alert() 为 toast 通知组件 | refactor |
| `7fb52e7` | 全量代码审查 - 修复8个问题（安全漏洞、Bug、代码质量） | fix |
| `1689238` | 代码审查修复 - 文件类型验证、错误字段映射、内存泄漏等 | fix |
| `09ebecb` | 移除导入页面的默认位置和危险品选项 | refactor |
| `796f69a` | 美化库存状态筛选下拉框 | style |
| `8d9a4b2` | 导出图标改为 ExternalLink | refactor |
| `962f914` | 导入图标从 Upload 改为 Import | refactor |
| `cc4c84a` | 简化 GIT_STRATEGY.md 文档 | chore |

### 文档与配置

| 提交哈希 | 描述 | 类型 |
|---------|------|------|
| `c7b1dd4` | 添加Git分支管理规范文档GIT_STRATEGY.md | docs |
| `834388c` | 从Git移除Python缓存文件 | chore |
| `fedbd29` | 优化导入功能并统一图标样式 | feat |
| `05c82b1` | 清理根目录文件 | chore |

---

## 功能分支

| 分支 | 功能 | 状态 |
|-----|------|------|
| `feature/backend-init` | 后端初始化 | ✅ 已完成 |
| `feature/frontend-init` | 前端初始化 | ✅ 已完成 |
| `feature/user-management` | 用户管理 | ✅ 已完成 |
| `feature/notification` | 通知系统 | ✅ 已完成 |
| `feature/consumable-reagent-split` | 耗材/试剂分离 | ✅ 已完成 |
| `feature/code-quality` | 代码质量优化 | ✅ 已完成 |

---

## 提交类型统计

| 类型 | 数量 |
|-----|------|
| feat | ~25+ |
| fix | ~15+ |
| docs | ~15+ |
| refactor | ~10+ |
| chore | ~5+ |
| merge | ~2+ |
| style | ~1+ |
