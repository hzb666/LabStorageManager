# 组件层

`frontend/src/components/` 承担视图复用与交互封装职责，按能力分为两层：

- `components/ui/`：基础 UI 组件，服务于通用展示、输入与交互
- `components/*.tsx`：业务组件，服务于特定页面或领域对象

## 基础 UI 组件

### 表单与输入

| 组件 | 职责 |
| --- | --- |
| `Input` / `Textarea` / `Select` / `Checkbox` / `RadioGroup` | 提供基础输入能力 |
| `PasswordInput` | 封装密码可见性与输入体验 |
| `Autocomplete` | 提供带提示的输入交互 |
| `FormField` | 统一字段布局与错误承载 |
| `Label` / `Separator` | 提供基础信息组织能力 |

### 对话框与反馈

| 组件 | 职责 |
| --- | --- |
| `Dialog` | 提供统一弹窗容器 |
| `Toast` | 承载全局通知展示 |
| `Tooltip` | 提供补充说明层 |
| `LoadingButton` | 统一按钮加载态 |
| `ConfirmDeleteButton` | 在删除前提供同按钮二次确认，可复用普通按钮或加载按钮外观 |

### 表格与列表

| 组件 | 职责 |
| --- | --- |
| `DataTable` | 提供表格渲染骨架 |
| `DataTableHeader` | 处理表头排序与列宽交互 |
| `DataTableBody` | 处理行渲染、展开与虚拟区 |
| `FilterTable` | 组合筛选、表格和分页形成页面骨架 |
| `TableFilters` | 统一搜索、筛选与空状态入口 |
| `Pagination` | 提供分页控制 |
| `StaleBanner` | 提示列表数据已过期，需要刷新 |

### 展示组件

| 组件 | 职责 |
| --- | --- |
| `StatusBadge` | 显示状态标签 |
| `QuantityIndicator` | 显示数量状态 |
| `HighlightText` | 显示关键词高亮结果 |
| `HazardousIcon` | 显示危险品标识 |
| `NoteDisplay` | 展示长文本备注 |
| `MoleculeStructure` | 展示分子结构 |
| `Avatar` / `Card` / `Tabs` | 提供通用展示容器 |

## 业务组件

### 表单与对话框

| 组件 | 职责 |
| --- | --- |
| `BaseForm` | 基于配置渲染表单 |
| `BorrowDialog` | 提供借用确认流程 |
| `UserEditDialog` | 提供用户编辑、头像和密码管理 |
| `ReagentBrandManagementDialogs` | 提供试剂品牌列表、新增、编辑和停用流程 |
| `EditDialogActions` | 提供编辑弹窗底部动作区，并复用删除二次确认按钮 |

### 表格展开与详情

| 组件 | 职责 |
| --- | --- |
| `ReagentOrderExpandedRow` | 展示试剂订单展开详情 |
| `ConsumableOrderExpandedRow` | 展示耗材订单展开详情 |
| `ReagentCasDuplicateWarning` | 提示同 CAS 风险 |

### 公告与反馈

| 组件 | 职责 |
| --- | --- |
| `AnnouncementBanner` | 展示顶部公告条 |
| `AnnouncementButton` | 提供公告入口 |
| `AnnouncementDetail` | 展示公告详情 |
| `BugReportButton` | 提供问题反馈入口 |

### 页面级辅助

| 组件 | 职责 |
| --- | --- |
| `SidebarLogo` | 提供侧栏品牌展示 |
| `TableActionButtons` | 统一列表操作按钮 |
| `ErrorBoundary` | 作为页面级运行时兜底 |

## 职责边界

组件层只负责视图表达和局部交互，不承载这些职责：

- 拼接后端地址
- 管理复杂缓存策略
- 将完整表单规则硬编码进 JSX

这些职责应分别放入 `hooks/`、`lib/` 和 `api/client.ts`。

## 改动入口

- 新增通用输入或弹窗能力时，优先考虑 `components/ui/`
- 新增页面专用交互时，优先放入 `components/*.tsx`
- 表单字段、校验、表格列定义应分别回到 `lib/` 的配置层
- 涉及状态或请求逻辑时，不应继续向组件层堆叠

## 阅读顺序

### 理解表格页

1. `FilterTable`
2. `DataTable`
3. `DataTableHeader`
4. `DataTableBody`
5. `TableFilters`

### 理解表单体系

1. `BaseForm`
2. `FormField`
3. `Dialog`
4. `lib/formConfigs.tsx`
5. `lib/validationSchemas.ts`

## 验证要点

- 新组件是否只承担单一职责
- 组件是否避免直接依赖接口地址和缓存实现
- 业务组件是否复用已有基础 UI 组件
- 表单和表格相关改动是否能在现有配置层完成

## 参考代码
- [frontend/src/components/AnnouncementBanner.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/components/AnnouncementBanner.tsx)
- [frontend/src/components/BaseForm.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/components/BaseForm.tsx)
- [frontend/src/components/BorrowDialog.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/components/BorrowDialog.tsx)
- [frontend/src/components/ConfirmDeleteButton.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/components/ConfirmDeleteButton.tsx)
- [frontend/src/components/ErrorBoundary.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/components/ErrorBoundary.tsx)
- [frontend/src/components/ReagentOrderExpandedRow.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/components/ReagentOrderExpandedRow.tsx)
- [frontend/src/components/ReagentBrandManagementDialogs.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/components/ReagentBrandManagementDialogs.tsx)
- [frontend/src/components/TableActionButtons.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/components/TableActionButtons.tsx)
- [frontend/src/components/UserEditDialog.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/components/UserEditDialog.tsx)
- [frontend/src/components/ui/DataTable.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/components/ui/DataTable.tsx)
- [frontend/src/components/ui/FilterTable.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/components/ui/FilterTable.tsx)
- [frontend/src/components/ui/Toast.tsx](https://github.com/hzb666/LabStorageManager/blob/main/frontend/src/components/ui/Toast.tsx)
