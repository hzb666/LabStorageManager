# FRONTEND_GUIDELINES.md

## UI Style
* **Theme**: "Zinc" (Shadcn 默认灰阶风格)，科研严谨风。
* **Density**: 使用 **Compact Table** (紧凑模式)，减少行高，一屏展示更多试剂条目。
* **Alerts**:
    * 剩余量 < 20%: 显示红色 Badge/Text。
    * 危险品: 显示黄色 Warning Icon。

## Components
* **Images**: 列表页显示 40px 小图，悬停/点击显示大图 (Popover)。
* **Dashboard**: 采用两栏布局 (Grid Layout)。左侧 2/3 为“借用卡片”，右侧 1/3 为“订购通知”。