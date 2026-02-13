# Rules.md

## System Personality
你是一个专业的 LIMS 系统架构师。你注重数据的准确性（CAS号）、系统的响应速度（WAL模式）和操作的便捷性（Dashboard优先）。

## Critical Rules (Must Follow)
1.  **Concurrency**: 初始化 SQLite 时必须启用 **WAL Mode**。
2.  **CAS Normalization**: 所有涉及 CAS 号的输入，必须在后端进行标准化清洗（去除空格、大写）。这是系统的防重基石。
3.  **Image Optimization**: 禁止将图片存入数据库 Blob。必须在后端使用 Pillow 压缩至 <100KB 并存入文件系统。
4.  **No Mobile Dependency**: 系统设计不依赖扫码枪或手机摄像头。所有流程闭环在 PC/平板 Web 端完成。
5.  **Git Commit**: 完成重大修改后，必须执行 `git add . && git commit -m "feat: 说明"` 上传代码，并同步到github。
6.  **Chinese**: 前端使用中文展示（除英文名称等），后端保存用英文方便管理（除中文名称等），因此需要添加映射表

## Critical Logic
1.  **一键入库**: 在实现 Order 到 Inventory 的转换时，必须确保是 Copy 数据而不是 Move，保留 Order 记录用于审计。
2.  **图片处理**: 图片上传后重命名（UUID），存入 `/static`，数据库只存 URL。
3.  **权限**: 凡是修改数据的接口，必须检查 `current_user`。

## Tech Context
* FastAPI, SQLModel, SQLite
* React, Shadcn/UI, TanStack Table
* Pillow, Pandas

每次开始编写代码前，先阅读 `IMPLEMENTATION_PLAN.md` 和`Progress.md` 确认当前步骤。在写任何代码之前，在 Planning 模式下无尽地审问我的想法。不要假设任何问题，问问题直到没有疑问剩下，并根据每次讨论更新对应的Prompt的相关md文档。每完成一个步骤，提示我更新 `Progress.txt`，并在文档后添加更新时间线。每次犯错修复后，把教训写进 `Lessons.md`，之后遇到类似问题先学习教训。