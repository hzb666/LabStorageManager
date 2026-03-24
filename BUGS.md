# BUGS

## 2026-03-25

- `frontend/src/components/ui/FilterTable.tsx`
  - 问题: 地址栏从带 `search`/`field` 参数切换到仅保留其他查询参数时，表格仍保留旧的搜索词和搜索字段。
  - 影响: 用户清空或切换 URL 后，界面结果与地址栏不一致，容易误判当前筛选条件。
  - 处理: 当 URL 中不再包含 `search`/`field` 时，主动同步为空搜索并恢复默认搜索字段。

- `frontend/src/fontLoader.ts`
  - 问题: 新增的本地字体回退逻辑引用 `/lib/SourceHanSansCN-VF.woff2`，但前端静态资源目录中缺少该文件。
  - 影响: Google 字体加载失败时，本地回退路径也会失败，导致字体加载策略失效。
  - 处理: 将字体资源补充到 `frontend/public/lib/SourceHanSansCN-VF.woff2`，保证回退链路可用。
