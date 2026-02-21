# Frontend 迁移到 shadcn-admin 计划文档

## 一、项目现状分析

### 1.1 现有 frontend 项目结构

| 模块 | 技术栈 | 说明 |
|------|--------|------|
| **路由** | React Router v7 | 使用 `BrowserRouter` + `Routes` + `Route` |
| **状态管理** | Zustand | `useAuthStore` 管理认证状态 |
| **UI 组件** | 自定义简化版 | button, card, dialog, input, pagination, toast |
| **表格** | TanStack Table v8 | 自定义列定义和渲染 |
| **表单** | React Hook Form + Zod | 表单验证 |
| **主题** | Tailwind CSS + CSS 变量 | 暗黑模式支持 |
| **HTTP** | Axios | API 客户端 |

#### 页面结构
```
frontend/src/pages/
├── Login.tsx          # 登录页
├── Dashboard.tsx      # 仪表盘（订单、借用、待入库）
├── Inventory.tsx      # 库存管理（CRUD、搜索、分页）
├── ReagentOrders.tsx  # 试剂订购（订单管理）
├── ConsumableOrders.tsx # 耗材订购
├── Import.tsx         # 批量导入
└── AdminUsers.tsx     # 用户管理（仅管理员）
```

#### UI 组件
```
frontend/src/components/ui/
├── button.tsx      # Button 组件
├── card.tsx        # Card 组件族
├── dialog.tsx      # Dialog 组件（简化版）
├── input.tsx       # Input 组件
├── pagination.tsx  # 分页组件
└── toast.tsx       # Toast 通知
```

### 1.2 shadcn-admin 项目结构

| 模块 | 技术栈 | 说明 |
|------|--------|------|
| **路由** | TanStack Router | 文件路由系统，自动生成 `routeTree.gen.ts` |
| **状态管理** | Zustand + TanStack Query | 认证状态 + 服务端状态管理 |
| **UI 组件** | 完整 shadcn/ui | 30+ 组件，包含表单、选择器等 |
| **表格** | TanStack Table + Data Table | 高级表格功能（排序、筛选、分页） |
| **布局** | 可配置侧边栏 | 响应式、主题切换、布局配置 |
| **通知** | Sonner | 现代通知组件 |

#### 目录结构
```
shadcn-admin/src/
├── components/
│   ├── ui/                    # shadcn/ui 组件库
│   ├── layout/                # 布局组件
│   │   ├── app-sidebar.tsx    # 侧边栏
│   │   ├── authenticated-layout.tsx
│   │   ├── header.tsx
│   │   └── data/sidebar-data.ts
│   ├── data-table/            # 表格组件
│   └── ...
├── features/                  # 功能模块
│   ├── auth/                  # 认证相关
│   ├── dashboard/             # 仪表盘
│   ├── users/                 # 用户管理
│   ├── tasks/                 # 任务示例
│   └── ...
├── routes/                    # TanStack Router 文件路由
│   ├── __root.tsx
│   ├── _authenticated/
│   │   ├── index.tsx
│   │   ├── users/
│   │   └── ...
│   └── (auth)/
├── stores/                    # Zustand stores
├── context/                   # React Context
└── styles/
    ├── index.css
    └── theme.css
```

---

## 二、迁移计划

### 2.1 技术架构升级

| 升级项 | 当前 | 目标 | 优先级 |
|--------|------|------|--------|
| 路由系统 | React Router v7 | TanStack Router | P0 |
| HTTP 状态管理 | 仅 Zustand | TanStack Query | P1 |
| UI 组件库 | 简化版 6 个 | 完整 shadcn/ui 30+ | P0 |
| 表格组件 | 自定义 | Data Table 封装 | P1 |
| 通知组件 | 自定义 Toast | Sonner | P2 |

### 2.2 依赖更新

#### 需要添加的依赖
```json
{
  "@tanstack/react-query": "^5.x",
  "@tanstack/react-router": "^1.x",
  "@tanstack/router-plugin": "^1.x",
  "@radix-ui/react-alert-dialog": "^1.x",
  "@radix-ui/react-avatar": "^1.x",
  "@radix-ui/react-checkbox": "^1.x",
  "@radix-ui/react-collapsible": "^1.x",
  "@radix-ui/react-dropdown-menu": "^1.x",
  "@radix-ui/react-popover": "^1.x",
  "@radix-ui/react-radio-group": "^1.x",
  "@radix-ui/react-select": "^1.x",
  "@radix-ui/react-separator": "^1.x",
  "@radix-ui/react-switch": "^1.x",
  "@radix-ui/react-tabs": "^1.x",
  "@radix-ui/react-tooltip": "^1.x",
  "recharts": "^2.x",
  "sonner": "^1.x",
  "date-fns": "^3.x",
  "input-otp": "^1.x",
  "@tanstack/react-table": "^8.x",
  "cmdk": "^1.x"
}
```

#### 需要移除的依赖
- 自定义的 `pagination.tsx`（使用 shadcn 版本）
- 自定义的 `toast.tsx`（使用 sonner）

---

## 三、UI 组件映射表

### 3.1 现有组件 → shadcn/ui 组件

| 现有组件 | shadcn/ui 组件 | 迁移说明 |
|----------|----------------|----------|
| `Button` | `Button` | 直接替换，保持 props 一致 |
| `Input` | `Input` | 直接替换 |
| `Card`, `CardHeader`, `CardTitle`, `CardContent`, `CardDescription` | 同名组件 | 直接替换 |
| `Dialog` | `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogFooter` | 需适配 Radix API |
| 自定义 `Pagination` | `Pagination` (shadcn) | 需适配新 API |
| 自定义 `Toast` | `Sonner` | 完全重写通知逻辑 |

### 3.2 需要新增的 shadcn/ui 组件

根据页面需求，需要添加以下组件：

| 组件 | 用途 | 页面 |
|------|------|------|
| `Select` | 下拉选择 | 库存管理、订单筛选 |
| `DropdownMenu` | 右键菜单、操作菜单 | 表格行操作 |
| `Table`, `TableHeader`, `TableRow`, `TableCell` | 表格结构 | 库存、订单页面 |
| `Badge` | 状态标签 | 订单状态、库存状态 |
| `Avatar` | 用户头像 | 用户管理、侧边栏用户信息 |
| `Tabs` | 标签页 | 设置页面、部分业务页面 |
| `Sheet` | 侧边抽屉 | 移动端菜单、详情面板 |
| `Popover` | 弹出层 | 日期选择、筛选器 |
| `Calendar` | 日历 | 日期范围筛选 |
| `Tooltip` | 提示 | 按钮提示 |
| `Checkbox` | 复选框 | 批量选择 |
| `Form`, `FormField`, `FormItem`, `FormLabel`, `FormControl`, `FormMessage` | 表单组件 | 所有表单页面 |
| `Label` | 标签 | 表单标签 |
| `Separator` | 分隔线 | 页面分隔 |
| `Alert`, `AlertTitle`, `AlertDescription` | 警告提示 | 错误提示 |
| `ScrollArea` | 滚动区域 | 侧边栏、内容区 |
| `Switch` | 开关 | 设置页面 |
| `Command`, `CommandInput`, `CommandList`, `CommandItem` | 命令面板 | 搜索功能 |

---

## 四、路由结构迁移

### 4.1 当前路由 (React Router)

```tsx
// frontend/src/App.tsx
<Routes>
  <Route path="/login" element={<Login />} />
  <Route path="/" element={<Layout />}>
    <Route index element={<Dashboard />} />
    <Route path="reagents" element={<ReagentOrdersPage />} />
    <Route path="consumables" element={<ConsumableOrdersPage />} />
    <Route path="inventory" element={<InventoryPage />} />
    <Route path="import" element={<ImportPage />} />
    <Route path="admin/users" element={<AdminUsersPage />} />
  </Route>
</Routes>
```

### 4.2 目标路由 (TanStack Router)

```
shadcn-admin/src/routes/
├── __root.tsx                      # 根路由
├── (auth)/
│   └── sign-in.tsx                # 登录页 -> /sign-in
├── _authenticated/
│   ├── route.tsx                  # 认证布局
│   ├── index.tsx                  # 首页 -> /
│   ├── dashboard/
│   │   └── index.tsx              # 仪表盘 -> /dashboard
│   ├── inventory/
│   │   └── index.tsx              # 库存管理 -> /inventory
│   ├── orders/
│   │   ├── reagents.tsx           # 试剂订购 -> /orders/reagents
│   │   └── consumables.tsx        # 耗材订购 -> /orders/consumables
│   ├── import/
│   │   └── index.tsx              # 批量导入 -> /import
│   └── admin/
│       └── users.tsx              # 用户管理 -> /admin/users
└── (errors)/
    ├── 401.tsx
    ├── 403.tsx
    ├── 404.tsx
    └── 500.tsx
```

### 4.3 路由迁移步骤

1. **创建文件路由结构**
   - 将 `pages/` 目录重组为 `features/` + `routes/` 结构
   - 使用 TanStack Router 文件路由约定

2. **创建认证布局**
   - 迁移现有 `Layout.tsx` 到 `routes/_authenticated/route.tsx`
   - 使用 `authenticated-layout.tsx` 组件

3. **处理认证保护**
   - 创建 `route.tsx` 加载器进行认证检查
   - 重定向未认证用户到 `/sign-in`

4. **更新页面组件**
   - 将 React Router 的 `useNavigate` 替换为 TanStack Router 的 `useRouter`
   - 将 `useLocation` 替换为 `useLocation` from `@tanstack/react-router`

---

## 五、页面迁移详情

### 5.1 登录页 (Login.tsx)

| 项目 | 当前 | 目标 |
|------|------|------|
| 路由 | `/login` | `/sign-in` |
| 表单 | 手动 Controlled | React Hook Form + Zod + shadcn Form |
| 主题切换 | 自定义 Button | ThemeSwitch 组件 |
| 错误提示 | 自定义 div | Alert 组件 |
| 加载状态 | Button disabled | Button + Sonner |

**迁移要点**:
- 使用 `sign-in/index.tsx` 作为登录页面
- 集成 `useAuthStore` 进行认证
- 使用 Sonner 替代自定义 Toast

### 5.2 仪表盘 (Dashboard.tsx)

| 项目 | 当前 | 目标 |
|------|------|------|
| 路由 | `/` | `/` 或 `/dashboard` |
| 统计卡片 | Card 组件 | 复用，保持一致 |
| 订单列表 | 自定义列表 | 迁移到 features/dashboard |
| Modal | 固定定位 div | Dialog 组件 |
| 分页 | 自定义 Pagination | shadcn Pagination |

**迁移要点**:
- 迁移到 `features/dashboard/index.tsx`
- 使用 TanStack Query 获取数据
- 优化 Modal 为 Dialog 组件

### 5.3 库存管理 (Inventory.tsx)

| 项目 | 当前 | 目标 |
|------|------|------|
| 表格 | 自定义 TanStack Table | shadcn Data Table |
| 搜索 | Input + X 按钮 | Command 组件（命令面板） |
| 筛选 | 原生 select | Select 组件 |
| 编辑弹窗 | 自定义 Dialog | shadcn Dialog |
| 导出 | 自定义 CSV | 复用现有逻辑 |

**迁移要点**:
- 迁移到 `features/inventory/index.tsx`
- 使用 `DataTable` 组件封装
- 使用 `ColumnDef` 保持列定义
- 集成 TanStack Query 进行数据缓存

### 5.4 试剂/耗材订单 (ReagentOrders, ConsumableOrders)

| 项目 | 当前 | 目标 |
|------|------|------|
| 路由 | `/reagents`, `/consumables` | `/orders/reagents`, `/orders/consumables` |
| 表格 | 自定义 | Data Table |
| 状态筛选 | select | Select |
| 创建订单 | Dialog | Dialog + Form |

**迁移要点**:
- 迁移到 `features/orders/` 目录
- 复用 shadcn 的表单组件
- 使用 Select 进行状态筛选

### 5.5 用户管理 (AdminUsers.tsx)

| 项目 | 当前 | 目标 |
|------|------|------|
| 路由 | `/admin/users` | `/users` (仅管理员) |
| 用户表格 | 自定义 | Data Table |
| 用户操作 | Dialog | AlertDialog + DropdownMenu |

**迁移要点**:
- 迁移到 `features/users/index.tsx`
- 复用 `users` 功能模块
- 权限检查在路由守卫实现

---

## 六、样式和主题迁移

### 6.1 Tailwind 配置

当前 `tailwind.config.js` 已有完整的 CSS 变量配置，直接迁移到 shadcn-admin 的 `theme.css` 即可。

### 6.2 暗黑模式

当前使用自定义 `useTheme` hook，迁移到 shadcn-admin 的 `ThemeProvider`。

### 6.3 布局样式

| 项目 | 当前 | 目标 |
|------|------|------|
| 侧边栏 | 固定 224px | 使用 Sidebar 组件（可折叠） |
| 头部 | 无 | Header 组件 |
| 内容区 | ml-56 p-8 | 使用 Main 组件 |
| 响应式 | 手动媒体查询 | 容器查询 |

---

## 七、实施步骤

### 阶段一：基础设施搭建 (第 1-2 天)

1. **创建新项目结构**
   ```bash
   # 基于 shadcn-admin 创建新目录结构
   mkdir -p src/features/{dashboard,inventory,orders,import,users}
   mkdir -p src/routes/{_authenticated,(auth)}
   ```

2. **安装依赖**
   ```bash
   npm install @tanstack/react-query @tanstack/react-router sonner recharts date-fns
   # 添加 shadcn/ui 组件
   npx shadcn@latest add button card input dialog select dropdown-menu table badge avatar tabs sheet popover calendar tooltip checkbox form label separator alert scroll-area switch command
   ```

3. **配置 Vite**
   - 更新 `vite.config.ts` 添加 TanStack Router 插件
   - 配置路径别名 `@`

### 阶段二：布局和路由迁移 (第 3-4 天)

1. **迁移 Layout**
   - 创建认证布局组件
   - 集成 Sidebar 组件
   - 配置导航菜单

2. **迁移路由系统**
   - 创建文件路由结构
   - 实现认证守卫
   - 处理登录重定向

### 阶段三：UI 组件替换 (第 5-7 天)

1. **替换基础组件**
   - Button, Input, Card
   - Dialog (Radix API 适配)
   - Toast → Sonner

2. **添加新组件**
   - Select, DropdownMenu
   - Table, DataTable
   - Form 组件族

### 阶段四：页面迁移 (第 8-14 天)

1. **登录页** - 第 8 天
2. **仪表盘** - 第 9-10 天
3. **库存管理** - 第 11-12 天
4. **订单页面** - 第 13 天
5. **用户管理** - 第 14 天

### 阶段五：测试和优化 (第 15-16 天)

1. **功能测试**
   - 登录/登出
   - 数据 CRUD
   - 搜索筛选
   - 暗黑模式

2. **性能优化**
   - TanStack Query 缓存配置
   - 路由预加载
   - 组件懒加载

---

## 八、风险和注意事项

### 8.1 主要风险

1. **TanStack Router 学习曲线**
   - 需要熟悉文件路由约定
   - 加载器和预加载机制

2. **Radix UI API 差异**
   - 自定义 Dialog 和 Radix Dialog API 不同
   - 需要重写部分弹窗逻辑

3. **表单组件复杂度**
   - shadcn Form 需要更多代码
   - 需要定义 Zod schema

### 8.2 注意事项

1. **保持 API 兼容性**
   - 后端 API 不变
   - 只需更新前端调用方式

2. **数据迁移**
   - Zustand store 保持不变
   - TanStack Query 作为补充

3. **渐进式迁移**
   - 可以逐步替换组件
   - 不需要一次性完成所有迁移

---

## 九、建议

1. **分阶段实施**: 建议按照实施步骤分阶段进行，每个阶段完成后进行测试
2. **组件复用**: 尽量复用现有业务逻辑，只替换 UI 层
3. **类型安全**: 继续使用 TypeScript，保持类型安全
4. **测试覆盖**: 建议添加单元测试和 E2E 测试

---

*文档版本: 1.0*
*创建日期: 2026-02-21*
