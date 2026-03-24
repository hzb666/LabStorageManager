# 表格与表单体系

## 列表页不是一页一个轮子

这个项目的列表页有明确复用骨架：

- `FilterTable`
- `DataTable`
- `TableFilters`
- `useTableState`

这套组合负责：

- 搜索
- 状态筛选
- 排序
- 分页
- 列宽持久化
- 展开状态

## `useTableState` 是关键状态机

它不是一个简单的小 hook，而是把列表页面的大部分交互状态统一托管了，包括：

- 输入框与防抖搜索
- 搜索字段切换
- 模糊搜索开关
- 排序
- 列宽
- 展开状态
- 无限分页查询

## 表单体系

表单侧的复用核心是：

- `BaseForm`
- `formConfigs.tsx`
- `validationSchemas.ts`

这说明项目倾向于“配置驱动表单 + 统一验证”，而不是把每个表单都写成完全独立的 JSX 和手写校验。

## 为什么这部分重要

因为新增一个典型业务页时，最应该复用的不是 CSS，而是这套列表和表单骨架。

## 参考代码

- `frontend/src/components/ui/FilterTable.tsx:1`
- `frontend/src/hooks/useTableState.tsx:161`
- `frontend/src/components/BaseForm.tsx:1`
- `frontend/src/lib/formConfigs.tsx:1`
- `frontend/src/lib/validationSchemas.ts:29`
