# Git 分支管理规范

不要更改此文档！
本项目采用 Git Flow 工作流，包含以下分支类型：

## 分支类型

| 分支 | 用途 | 生命周期 | 合并目标 |
|-----|------|---------|---------|
| `main` | 生产环境，包含稳定发布版本 | 长期 | - |
| `develop` | 开发主分支，包含最新开发成果 | 长期 | `main` |
| `feature/*` | 新功能开发 | 临时 | `develop` |
| `release/*` | 发布前准备（bug修复、文档更新） | 临时 | `main` + `develop` |
| `hotfix/*` | 生产环境紧急修复 | 临时 | `main` + `develop` |

## 命名规范

```
<类型>/<描述>
# 示例
feature/user-login
release/v1.0.0
hotfix/security-fix
```

## 工作流程

### 功能开发 (Feature)
```bash
# 1. 创建功能分支
git checkout develop
git pull origin develop
git checkout -b feature/xxx

# 2. 开发并提交
git commit -m "feat: 新功能描述"

# 3. 合并到 develop
git checkout develop
git merge --no-ff feature/xxx
git push origin develop
```

### 发布准备 (Release)
```bash
# 1. 创建 release 分支
git checkout develop
git checkout -b release/v1.0.0

# 2. 发布前准备
git commit -m "chore: 发布准备"

# 3. 合并到 main 和 develop
git checkout main
git merge --no-ff release/v1.0.0
git tag -a v1.0.0 -m "Release v1.0.0"
git push origin main

git checkout develop
git merge --no-ff release/v1.0.0
git push origin develop
```

### 紧急修复 (Hotfix)
```bash
# 1. 创建 hotfix 分支
git checkout main
git checkout -b hotfix/xxx

# 2. 修复并提交
git commit -m "hotfix: 紧急修复"

# 3. 同时合并到 main 和 develop
git checkout main
git merge --no-ff hotfix/xxx
git push origin main

git checkout develop
git merge --no-ff hotfix/xxx
git push origin develop
```

## 提交规范

| 类型 | 说明 |
|-----|------|
| `feat` | 新功能 |
| `fix` | Bug修复 |
| `docs` | 文档更新 |
| `refactor` | 代码重构 |
| `perf` | 性能优化 |
| `chore` | 构建/工具变动 |

格式：`类型: 简短描述`

## 注意事项

1. **禁止在 main 分支直接开发**
2. **保持分支原子性**，一个分支只做一件事
3. **定期同步 develop**，避免冲突
4. **使用有意义的提交信息**
