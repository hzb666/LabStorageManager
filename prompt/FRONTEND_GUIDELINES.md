# FRONTEND_GUIDELINES.md

## UI Style
* **Theme**: "Zinc" (Shadcn 默认灰阶风格)，科研严谨风。
* **Density**: 使用 **Compact Table** (紧凑模式)，减少行高，一屏展示更多试剂条目。
* **Alerts**:
    * 剩余量 < 20%: 显示红色 Badge/Text。
    * 危险品: 显示黄色 Warning Icon。

## Notifications
* **Toast 通知**: 使用自定义 `toast.tsx` 组件替代 `alert()`
    * `toast.success(msg)` - 绿色成功提示
    * `toast.error(msg)` - 红色错误提示
    * `toast.warning(msg)` - 黄色警告提示
    * `toast.info(msg)` - 蓝色信息提示
* **位置**: 右上角固定，3.5 秒自动关闭
* **禁止使用**: `alert()`, `confirm()`, `prompt()`

## Components
* **Images**: 列表页显示 40px 小图，悬停/点击显示大图 (Popover)。
* **Dashboard**: 采用两栏布局 (Grid Layout)。左侧 2/3 为"借用卡片"，右侧 1/3 为"订购通知"。

## Navigation
* **路由导航**: 使用 React Router 的 `useNavigate` hook，禁止 `window.location.href`
* **侧边栏**: 固定左侧导航，包含试剂订购、耗材订购、库存管理、导入库存、用户管理（仅管理员可见）

## Excel/CSV Import UI
* **Button**: "批量导入" button in Inventory page toolbar
* **Upload Flow**:
    1. Click button -> Navigate to /import page
    2. Accept .csv, .xlsx, .xls files
    3. Show template download link (CSV with UTF-8 BOM)
    4. Progress display during upload
    5. Result: Success count, error list
* **Error Display**: 
    * Show row number and error message for each failed row
    * Allow user to fix and re-upload
* **Template**: Provide downloadable CSV template with correct column headers

## Icon Conventions
* **导入/批量导入**: `Import` (lucide-react)
* **导出**: `Download` (lucide-react)
* **新增**: `Plus` (lucide-react)
* **危险品**: `AlertTriangle` (lucide-react, yellow)
* **搜索**: `Search` (lucide-react)
