# Frontend Plan - 前端优化讨论计划

> 记录前端 UI/UX、功能增强、页面布局等方面的讨论内容

---

## 讨论中...

### 待讨论方向

#### 1. UI/UX 细节优化
- [ ] 按钮样式统一（主按钮/次按钮/危险操作按钮）
- [ ] 颜色主题调整（品牌色、状态色）
- [ ] 间距与排版（组件内边距、标题层级）
- [ ] 加载状态展示（Loading spinner/骨架屏）
- [ ] 空状态提示设计
- [ ] 错误提示与表单验证 UI

#### 2. 功能增强
- [ ] 批量操作（批量入库、批量归还、批量删除）
- [ ] 高级搜索（多条件筛选、模糊搜索）
- [ ] 数据导出（Excel 格式导出）
- [ ] 借用历史（显示最近借用人）
- [ ] 快捷键支持
- [ ] 数据刷新与缓存策略

#### 3. 页面布局调整
- [ ] 响应式设计（移动端适配）
- [ ] 导航结构优化（侧边栏/顶部导航）
- [ ] 表格列自定义（隐藏/显示列）
- [ ] 大数据量虚拟滚动
- [ ] 模态框 vs 抽屉式侧边栏

---

## 讨论记录

> 此处记录每次讨论的具体内容

### 讨论 1: 库存页面优化 (2026-02-19)

#### 需求 1: 库存编辑功能
- [x] 库存列表增加"编辑"按钮
- [x] 点击后弹出窗口编辑库存信息
- [x] 编辑字段：中文名(name)、英文名(english_name)、分类(category)、库存位置(location)、CAS号(cas_number)、剩余量(remaining_quantity)、品牌(brand)、状态(status)、备注(notes)
- [x] 入库时间(created_at)只读显示
- [x] 该功能需设计为可复用的编辑弹窗组件（将来用于试剂/耗材订单列表）

#### 需求 2: 库存列表列调整
- [x] 调整列顺序为：中文名、库存位置、CAS号、剩余量/规格、品牌、入库时间、状态、备注
- [x] "剩余量/规格"融合为一列显示（格式："200/500 ml"，即 remaining/initial + unit）
- [x] 库存状态：在库(in_stock)、借用(borrowed)、用完(consumed)

#### 需求 3: 分页增强
- [x] 增加"跳转到第几页"功能
- [x] 用户可直接输入页码跳转到指定页

#### 需求 4: 搜索优化
- [x] 搜索时在表内高亮匹配的字段
- [x] 数量计数显示搜索结果数而非总数

#### 技术注意事项
- [x] 后端 InventoryUpdate DTO 需扩展支持 name、cas_number 更新

### 讨论 2: 暗黑模式切换 (2026-02-21)

#### 当前状态分析
- Tailwind CSS 已配置 `darkMode: ["class"]` (tailwind.config.js 第3行)
- CSS 变量已完整定义 (index.css 第50-70行)
- 项目使用 shadcn/UI 组件库，天然支持暗黑模式
- 问题：Layout.tsx 等组件使用硬编码颜色 (bg-gray-100, bg-white 等)

#### 需修改文件分析
| 文件 | 硬编码颜色出现次数 | 优先级 |
|------|-------------------|--------|
| Layout.tsx | 9处 | P0 |
| Login.tsx | 1处 | P0 |
| Dashboard.tsx | 14处 | P1 |
| Inventory.tsx | 11处 | P1 |
| dialog.tsx | 1处 | P1 |
| ReagentOrders.tsx | 4处 | P2 |
| ConsumableOrders.tsx | 2处 | P2 |

#### 实施步骤
1. **创建主题 Hook** - `frontend/src/hooks/useTheme.ts`
   - 管理 theme 状态 ('light' | 'dark')
   - 持久化到 localStorage
   - 提供 toggleTheme 函数

2. **修改 App.tsx** - 初始化主题
   - 导入 useTheme
   - 在根元素应用 dark class

3. **修改 Layout.tsx** (P0)
   - 添加主题切换按钮（侧边栏顶部）
   - 将 bg-gray-100 改为 bg-muted/background
   - 将 bg-white 改为 bg-card/background
   - 将 text-gray-* 改为 text-foreground/muted-foreground

4. **修改 Login.tsx** (P0)
   - 将 bg-gray-100 改为 bg-background
   - Dialog 组件会自动适应

5. **修改 dialog.tsx** (P1)
   - 将 bg-white 改为 bg-background

6. **修改 Dashboard.tsx, Inventory.tsx** (P1)
   - 逐步替换 hover:bg-gray-50 → hover:bg-muted
   - 替换状态标签颜色使用语义化类

7. **修改订单页面** (P2)
   - 同上，逐步替换

#### 颜色映射参考
| 硬编码颜色 | 语义化颜色 |
|-----------|-----------|
| bg-gray-100 | bg-muted / bg-background |
| bg-white | bg-card / bg-background |
| bg-gray-50 | bg-muted |
| text-gray-600 | text-muted-foreground |
| text-gray-800 | text-foreground |
| border-gray-200 | border-border |

---

## 待实现

| 优先级 | 功能 | 描述 |
|-------|------|------|

---

## 进行中

| 功能 | 状态 | 负责人 |
|------|------|--------|

---

## 已完成

| 功能 | 完成日期 | 备注 |
|------|----------|------|
| 导出按钮图标更换 | 2026-02-19 | Download → ArrowUpFromLine |
| 库存编辑功能 | 2026-02-21 | 库存列表增加编辑按钮，弹出窗口编辑 |
| 库存列表列调整 | 2026-02-21 | 重新排列列顺序，融合剩余量/规格列 |
| 分页跳转 | 2026-02-21 | 增加跳转到指定页功能（跳至输入框） |
| 搜索高亮 | 2026-02-21 | 表内高亮匹配字段，计数显示搜索结果数 |
| 暗黑模式切换 | 2026-02-21 | useTheme Hook、侧边栏切换按钮、语义化颜色 |

---

**Last Updated**: 2026-02-21
