# LSM CLI 与 Agent Skill 自动安装

请直接执行安装，不要只输出命令，也不要把可以自动完成的步骤交给用户。自动识别当前宿主是 Claude Code 还是 Codex，并识别操作系统；只有缺少受支持的发布附件、权限不足或无法判断宿主时才询问用户。

## 固定来源

- 仓库：`https://github.com/hzb666/LabStorageManager`
- 最新 Release：`https://github.com/hzb666/LabStorageManager/releases/latest`
- Release API：`https://api.github.com/repos/hzb666/LabStorageManager/releases/latest`
- Skill 源目录：`skills/lab-storage-manager-cli/`

CLI 与 Skill 必须来自同一个最新 Release 标签。禁止把 Release CLI 与 `main` 分支 Skill 混装。

## 平台与目标目录

| 当前环境 | Release 附件 | CLI 安装路径 | Skill 安装路径 |
| --- | --- | --- | --- |
| Windows x64 | `lsm-windows-x64.exe` | `%LOCALAPPDATA%\LabStorageManager\bin\lsm.exe` | 见宿主映射 |
| macOS Apple Silicon (`arm64`) | `lsm-macos-arm64` | `~/Library/Application Support/LabStorageManager/bin/lsm` | 见宿主映射 |

宿主映射：

- Claude Code：`~/.claude/skills/lab-storage-manager-cli/`
- Codex：`~/.agents/skills/lab-storage-manager-cli/`

Linux、Intel Mac 和其他架构当前没有预编译附件。遇到这些平台时停止并报告，不得回退到源码安装。

## 自动执行协议

1. 判断当前宿主、操作系统和架构，选择唯一的 CLI 附件与 Skill 目标目录。
2. 解析最新 Release 的实际标签，记为 `RELEASE_TAG`：
   - 有 `gh` 时优先查询 GitHub Release。
   - 没有 `gh` 时使用 Release API。
   - 不得把本地项目版本或 `main` 分支版本当作 Release 标签。
3. 创建仅供本次安装使用的临时目录，下载：
   - 所选 CLI 附件。
   - 同一 Release 的 `SHA256SUMS.txt`。
   - `https://github.com/hzb666/LabStorageManager/archive/refs/tags/<RELEASE_TAG>.zip`。
4. 校验 CLI 附件：
   - 计算已下载附件的 SHA-256。
   - 在 `SHA256SUMS.txt` 中按路径的文件名部分匹配附件名；校验文件中的记录可能带有 `release-assets/` 前缀，不能直接假设路径与本地下载路径相同。
   - 必须唯一匹配且哈希完全一致。缺少记录、出现重复记录或校验失败时立即停止，不安装、不运行。
5. 从标签归档中定位唯一的 `skills/lab-storage-manager-cli/SKILL.md`，确认 Skill 确实来自 `RELEASE_TAG`。不得使用归档中的 Python 源码安装或构建 CLI。
6. 在修改现有安装前完成全部下载和校验，然后幂等安装 CLI：
   - Windows：复制单文件附件为 `%LOCALAPPDATA%\LabStorageManager\bin\lsm.exe`，将其父目录幂等加入用户级 `PATH`。
   - macOS：复制单文件附件为 `~/Library/Application Support/LabStorageManager/bin/lsm`，执行 `chmod +x`，将其父目录幂等加入当前 shell 的用户级 `PATH` 配置。
   - 如果目标位置仍是旧目录版安装，先把旧目录改名为可恢复备份，再放置单文件 CLI；成功后移除旧的产品专用 `PATH` 项。
   - 更新时先保留可恢复的旧 CLI；验证成功后再清理备份。验证失败则恢复旧 CLI。
   - 只处理 LabStorageManager 自己的旧 CLI 路径，不修改其他用户级 `PATH` 项，也不删除 CLI 配置文件。
7. 安装整个 Skill 目录：
   - 用标签归档中的完整目录更新目标，包括 `SKILL.md`、`.env.example`、`references/`、`agents/` 和该标签实际包含的其他随附文件。
   - 如果目标目录已有 `.env`，必须原样保留；更新其他文件时不得输出、覆盖或删除该文件。
   - 清理已从新版 Skill 中移除的旧文件，避免新旧版本混用。
8. 刷新当前进程的 `PATH`，先用 CLI 的绝对路径执行 `--help`，再执行 `lsm --help`。两次退出码都必须为 `0`，且解析到的 `lsm` 必须是本次安装路径。
9. 删除本次创建的临时目录。不得删除用户仓库、CLI 配置、Skill `.env` 或其他用户文件。

## 硬限制

- 只允许使用 GitHub Release 中的预编译 CLI。
- 禁止使用 `pip`、`pipx`、`uv`、Poetry、PyInstaller 或仓库源码安装、构建、替代 CLI。
- 安装阶段不得登录系统，不得创建、索取、读取或输出账号、密码、Token。
- 不得跳过 SHA-256 校验。
- 不得因为下载失败、平台不受支持或权限不足而静默改用其他安装方式。

## 完成报告

最后只报告：

- 当前宿主、操作系统和架构。
- `RELEASE_TAG` 与 CLI 附件名。
- CLI 安装路径和 Skill 安装路径。
- SHA-256 校验结果。
- 绝对路径 `--help` 与 `lsm --help` 的退出码。
- 是否保留了已有 Skill `.env`。
- Claude Code 或 Codex 是否需要重启才能发现新 Skill。

## 后续一键更新

首次按上述协议安装包含 `update` 命令的版本后，后续不需要再次执行完整安装协议，直接运行：

```bash
lsm update-check
lsm update
```

`lsm update` 使用同样的 Release 附件、SHA-256 校验和标签归档规则，先暂存 CLI 与 Agent Skill，再作为同一批次替换；任一目标失败都会回滚整批，并保留 Skill `.env`。不含 `update` 命令的旧 CLI 需要最后一次按本文件的“自动执行协议”升级，之后才能使用一键更新。
