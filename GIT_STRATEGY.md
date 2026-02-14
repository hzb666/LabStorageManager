# Git 分支管理规范

## 1. 分支类型说明

本项目采用 Git Flow 工作流的简化版本，结合实际项目需求进行管理。

| 分支类型 | 用途 | 生命周期 | 合并目标 |
|---------|------|---------|---------|
| `main` | 生产环境分支，记录最终稳定版本 | 长期 | - |
| `develop` | 开发主分支，包含最新开发成果 | 长期 | `main` |
| `feature/*` | 功能开发分支，用于开发新功能 | 临时 | `develop` |
| `fix/*` | Bug修复分支，用于修复线上问题 | 临时 | `develop` |
| `docs/*` | 文档更新分支，用于更新文档 | 临时 | `develop` |
| `refactor/*` | 代码重构分支，用于代码优化 | 临时 | `develop` |
| `hotfix/*` | 紧急修复分支，用于生产环境紧急修复 | 临时 | `main` + `develop` |

## 2. 分支命名规范

### 2.1 命名格式

```
<类型>/<问题编号>-<简短描述>
```

### 2.2 命名示例

```bash
# 功能开发
feature/user-authentication
feature/inventory-export
feature/phase8-notification

# Bug修复
fix/login-validation
fix/database-connection

# 文档更新
docs/update-readme
docs/api-documentation

# 代码重构
refactor/database-model
refactor/api-structure

# 紧急修复
hotfix/security-vulnerability
hotfix-production-error
```

### 2.3 命名规则

- 使用小写字母
- 使用连字符 `-` 分隔单词
- 描述简洁明了，不超过 50 个字符
- 涉及任务编号时使用对应的编号

## 3. 工作流程

### 3.1 功能开发流程

```bash
# 1. 从 develop 创建功能分支
git checkout develop
git pull origin develop
git checkout -b feature/xxx-description

# 2. 在功能分支上开发
git add .
git commit -m "feat: 添加新功能描述"

# 3. 同步更新（保持分支最新）
git fetch origin
git rebase origin/develop

# 4. 开发完成后，合并到 develop
git checkout develop
git merge --no-ff feature/xxx-description

# 5. 删除功能分支
git branch -d feature/xxx-description
git push origin --delete feature/xxx-description
```

### 3.2 Bug修复流程

```bash
# 1. 从 develop 创建修复分支
git checkout develop
git pull origin develop
git checkout -b fix/xxx-bug-description

# 2. 修复问题并提交
git add .
git commit -m "fix: 修复xxx问题"

# 3. 合并到 develop
git checkout develop
git merge --no-ff fix/xxx-bug-description
```

### 3.3 紧急修复流程

```bash
# 1. 从 main 创建热修复分支
git checkout main
git checkout -b hotfix/xxx-urgent-fix

# 2. 修复问题并提交
git add .
git commit -m "hotfix: 紧急修复xxx问题"

# 3. 同时合并到 main 和 develop
git checkout main
git merge --no-ff hotfix/xxx-urgent-fix
git push origin main

git checkout develop
git merge --no-ff hotfix/xxx-urgent-fix
git push origin develop
```

## 4. 提交信息规范

### 4.1 提交类型

| 类型 | 说明 |
|-----|------|
| `feat` | 新功能开发 |
| `fix` | Bug修复 |
| `docs` | 文档更新 |
| `refactor` | 代码重构 |
| `perf` | 性能优化 |
| `test` | 测试相关 |
| `chore` | 构建过程或辅助工具变动 |

### 4.2 提交格式

```
<类型>: <简短描述>

[可选的详细说明]
```

### 4.3 提交示例

```bash
# 简单提交
git commit -m "feat: 添加用户认证功能"

# 带详细说明的提交
git commit -m "fix: 修复库存列表查询性能问题

- 添加数据库索引
- 优化SQL查询语句
- 减少返回字段"
```

## 5. 常用 Git 命令示例

### 5.1 分支管理

```bash
# 查看分支
git branch -a                    # 查看所有分支
git branch -r                    # 查看远程分支
git branch -vv                   # 查看分支追踪关系

# 创建分支
git checkout -b feature/xxx      # 创建并切换到新分支
git checkout -b feature/xxx develop  # 基于 develop 创建

# 删除分支
git branch -d feature/xxx        # 删除本地分支（已合并）
git branch -D feature/xxx        # 强制删除本地分支
git push origin --delete xxx     # 删除远程分支
```

### 5.2 提交管理

```bash
# 查看提交历史
git log --oneline                # 简洁格式
git log --oneline --all          # 查看所有分支
git log -10                      # 最近10条提交
git log --graph --oneline        # 图形化展示

# 撤销操作
git reset --soft HEAD~1          # 撤销最近一次提交，保留修改
git reset --hard HEAD~1          # 撤销最近一次提交，丢弃修改
git revert HEAD                  # 创建新提交来撤销修改

# 修改提交
git commit --amend               # 修改最后一次提交
```

### 5.3 远程操作

```bash
# 拉取代码
git fetch origin                 # 获取远程更新
git pull origin develop          # 拉取并合并
git pull --rebase origin develop # 使用 rebase 拉取

# 推送代码
git push origin develop          # 推送到远程
git push -u origin feature/xxx   # 推送并设置上游分支
```

### 5.4 暂存操作

```bash
# 暂存当前工作
git stash                        # 暂存当前修改
git stash push -m "message"      # 带说明的暂存
git stash list                   # 查看暂存列表
git stash pop                    # 恢复最近暂存
git stash apply stash@{0}        # 恢复指定暂存
```

## 6. 代码审查流程

根据项目规则，完成重大修改后需要：

1. 切换到 Review 模式进行 Code Review
2. 给出审查报告与项目负责人讨论
3. 讨论后执行提交

```bash
# 提交代码
git add .
git commit -m "feat: 说明"

# 推送到远程
git push origin feature/xxx
```

## 7. 项目提交历史参考

以下是从项目初始化以来的提交类型统计：

- **feat**: 功能开发 (~20+)
- **fix**: Bug修复 (~10+)
- **docs**: 文档更新 (~10+)
- **refactor**: 代码重构 (~5+)

### 重要里程碑提交

| 提交哈希 | 描述 |
|---------|------|
| `60cac7a` | 初始提交 |
| `ec1e885` | Phase 1.1 后端初始化 |
| `cf23049` | Phase 1.2 JWT认证 |
| `9ffd75b` | Phase 5.1 前端初始化 |
| `679ee10` | Phase 7 用户管理 |
| `a4881d6` | Phase 8 通知提醒 |
| `55619a4` | 耗材和试剂订购分离 |

## 8. 注意事项

1. **永远不要直接在 main 分支上开发**
2. **保持分支的原子性**，一个分支只做一件事
3. **定期同步主分支**，避免合并冲突
4. **使用有意义的提交信息**，便于追溯
5. **删除已合并的分支**，保持仓库整洁
6. **遵循本规范**，保证团队协作效率
