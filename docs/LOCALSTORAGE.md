# LocalStorage 文档

本文档列出项目中所有 localStorage 的功能、失效时间和刷新逻辑。

---

## 1. 认证状态 (auth-storage)

| 属性 | 值 |
|------|-----|
| **键名** | `auth-storage` |
| **功能** | 存储用户登录状态和用户信息（包含 avatar_url） |
| **失效时间** | 3 天 |
| **刷新逻辑** | 登录时设置；刷新页面时调用 `/users/me` API 重新获取最新用户信息 |
| **文件** | `store/useStore.ts` |

---

## 2. 侧边栏状态 (sidebar-storage)

| 属性 | 值 |
|------|-----|
| **键名** | `sidebar-storage` |
| **功能** | 存储侧边栏展开/收起状态 |
| **失效时间** | 3 天 |
| **刷新逻辑** | 用户点击切换时保存 |
| **文件** | `store/useStore.ts` |

---

## 3. 设备 ID

| 属性 | 值 |
|------|-----|
| **键名** | `lab_device_id` |
| **功能** | 唯一设备标识（UUID v4），用于设备管理 |
| **失效时间** | 永久 |
| **刷新逻辑** | 首次生成后永久保存 |
| **文件** | `lib/deviceId.ts` |

---

## 4. 设备名称

| 属性 | 值 |
|------|-----|
| **键名** | `lab_device_name` |
| **功能** | 从 User-Agent 解析的设备名称（如 Chrome Browser） |
| **失效时间** | 永久 |
| **刷新逻辑** | 首次解析后永久保存 |
| **文件** | `lib/deviceId.ts` |

---

## 5. 主题

| 属性 | 值 |
|------|-----|
| **键名** | `theme` |
| **功能** | 存储 light/dark 主题偏好 |
| **失效时间** | 永久 |
| **刷新逻辑** | 用户手动切换时保存；首次加载时检查系统偏好 |
| **文件** | `hooks/useTheme.ts` |

---

## 6. 公告关闭状态

| 属性 | 值 |
|------|-----|
| **键名** | `announcement_closed` |
| **功能** | 存储用户手动关闭的置顶公告 ID 和关闭时间 |
| **失效时间** | 24 小时（公告有更新时自动失效） |
| **刷新逻辑** | 用户点击公告上的关闭按钮时保存 |
| **文件** | `components/AnnouncementBanner.tsx` |

---

## 7. 公告已读状态

| 属性 | 值 |
|------|-----|
| **键名** | `announcement_read` |
| **功能** | 存储用户已阅读的公告 ID 和阅读时间 |
| **失效时间** | 永久（公告有更新时自动失效） |
| **刷新逻辑** | 用户点击公告项时保存 |
| **文件** | `components/AnnouncementButton.tsx` |

---

## 8. Bug 反馈按钮隐藏状态

| 属性 | 值 |
|------|-----|
| **键名** | `bug_button_hidden_until` |
| **功能** | 右键点击隐藏反馈按钮，存储隐藏截止时间戳 |
| **失效时间** | 1 天（可配置，默认1天） |
| **刷新逻辑** | 用户右键点击按钮时设置 |
| **文件** | `components/BugReportButton.tsx` |

---

## 9. 表格列宽

| 属性 | 值 |
|------|-----|
| **键名格式** | `{storageKeyPrefix}-{tableId}` |
| **功能** | 存储表格列宽配置 |
| **失效时间** | 永久 |
| **刷新逻辑** | 用户拖拽调整列宽时自动保存（防抖 150ms） |
| **文件** | `hooks/useTableState.tsx` |

**示例键名**：
- `filtertable-reagent-orders-table`
- `filtertable-consumable-orders-table`

---

## 10. 表格展开状态

| 属性 | 值 |
|------|-----|
| **键名格式** | `{tableId}-expand-all` |
| **功能** | 存储表格"展开全部"状态（expanded/collapsed） |
| **失效时间** | 永久 |
| **刷新逻辑** | 用户点击"展开全部/收起"时保存 |
| **文件** | `hooks/useTableState.tsx` |

**示例键名**：
- `reagent-orders-table-expand-all`
- `consumable-orders-table-expand-all`

---

## 11. 仪表盘活动标签

| 属性 | 值 |
|------|-----|
| **键名** | `dashboard_active_tab` |
| **功能** | 存储仪表盘当前激活的标签页 |
| **失效时间** | 3 天 |
| **刷新逻辑** | 用户切换标签时保存 |
| **文件** | `pages/Dashboard.tsx` |

---

## 总结表

| 键名 | 失效时间 | 刷新条件 |
|------|----------|----------|
| auth-storage | 3天 | 登录/刷新页面 |
| sidebar-storage | 3天 | 点击切换 |
| lab_device_id | 永久 | 首次生成 |
| lab_device_name | 永久 | 首次解析 |
| theme | 永久 | 切换主题 |
| announcement_closed | 24小时 | 关闭公告 |
| announcement_read | 永久* | 阅读公告 |
| bug_button_hidden_until | 1天 | 右键隐藏 |
| {tableId}-列宽 | 永久 | 拖拽列宽 |
| {tableId}-expand-all | 永久 | 点击展开 |
| dashboard_active_tab | 3天 | 切换标签 |

> *公告已读状态为永久，但当公告内容更新时会自动失效，视为未读
