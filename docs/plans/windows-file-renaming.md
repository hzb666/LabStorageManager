# Windows下文件大小写重命名解决方案

## 问题原因

Windows文件系统默认大小写不敏感，`Button.tsx` 和 `button.tsx` 被视为同一文件。直接重命名会导致文件丢失。

## 解决方案

### 方法1：使用两阶段重命名（推荐）

通过中间文件名实现大小写修改：

```powershell
# 示例：将 button.tsx 重命名为 Button.tsx

# 阶段1：先重命名为临时名称
Rename-Item button.tsx button_temp.tsx

# 阶段2：再重命名为目标名称
Rename-Item button_temp.tsx Button.tsx
```

### 方法2：修改Git全局配置启用大小写敏感

```powershell
# 启用Git大小写敏感
git config --global core.ignorecase false
```

然后使用 `git mv` 命令：

```powershell
git mv button.tsx Button.tsx
```

### 方法3：使用专用脚本

创建一个PowerShell脚本来批量处理：

```powershell
# rename-files.ps1
$files = @(
    @{old="button.tsx"; new="Button.tsx"},
    @{old="input.tsx"; new="Input.tsx"},
    @{old="checkbox.tsx"; new="Checkbox.tsx"},
    # ... 更多文件
)

foreach ($file in $files) {
    $tempName = $file.old -replace '\.tsx$', '_temp.tsx'
    Rename-Item $file.old $tempName
    Rename-Item $tempName $file.new
    Write-Host "Renamed: $($file.old) -> $($file.new)"
}
```

## 批量重命名清单

### Hooks目录 (frontend/src/hooks/)
| 当前文件 | 目标文件 |
|---------|---------|
| use-dialog-state.tsx | useDialogState.tsx |
| use-mobile.tsx | useMobile.tsx |
| use-table-url-state.ts | useTableUrlState.ts |

### UI组件目录 (frontend/src/components/ui/)
| 当前文件 | 目标文件 |
|---------|---------|
| button.tsx | Button.tsx |
| input.tsx | Input.tsx |
| checkbox.tsx | Checkbox.tsx |
| label.tsx | Label.tsx |
| select.tsx | Select.tsx |
| card.tsx | Card.tsx |
| dialog.tsx | Dialog.tsx |
| toast.tsx | Toast.tsx |
| pagination.tsx | Pagination.tsx |
| radio-group.tsx | RadioGroup.tsx |
| separator.tsx | Separator.tsx |
| tabs.tsx | Tabs.tsx |

## 执行步骤

1. **备份项目**（以防万一）
2. **启用Git大小写敏感**：`git config --global core.ignorecase false`
3. **使用git mv逐个重命名**：
   ```powershell
   git mv button.tsx Button.tsx
   git mv input.tsx Input.tsx
   # ... 继续其他文件
   ```
4. **更新所有引用**（需要修改import语句）
5. **测试运行**：`cd frontend && npm run dev`
6. **提交更改**：`git add -A && git commit -m "refactor: 文件命名规范化"`
