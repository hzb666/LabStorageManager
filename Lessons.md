# Lessons

## 2026-04-25 Dashboard summary 不能用全量数组支撑查看全部

- 触发信号：summary 接口为了弹窗“查看全部”把列表查询改成 `limit=None`。
- 根因 / 约束：summary 是首屏接口，只能承载 preview 和 count；全量数据必须放到分页详情接口。
- 正确做法：新增 section count 与分页接口，再让前端展开组件通过统一 detail source 获取详情。
- 验证方式：检查 summary 里没有 `limit=None` 列表查询；切换分页大小后总页数按当前 `pageSize` 计算。
- 适用范围：dashboard、看板、首页卡片、摘要接口和任何“预览 + 查看全部”的列表。
