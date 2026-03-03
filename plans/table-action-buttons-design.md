# TableActionButtons 通用操作按钮组件设计

## 一、设计思路

将操作按钮抽象为一个通用组件，通过配置化 Props 传入不同的行为和样式，而不是为每个页面单独创建组件。

**重要约束：必须保持与 Inventory.tsx 现有样式和行为完全一致，使用 LoadingButton 组件。**

## 二、组件接口设计

```typescript
import { LoadingButton } from '@/components/ui/LoadingButton'

// 操作按钮配置项
interface ActionButtonConfig<T> {
  /** 唯一标识 */
  id: string
  /** 显示文本 */
  label: string
  /** 按钮变体 */
  variant?: 'default' | 'morden' | 'destructive' | 'secondary' | 'ghost'
  /** 按钮尺寸 */
  size?: 'sm' | 'md' | 'lg'
  /** 自定义样式类 */
  className?: string
  /** 图标（可选，用于自定义图标按钮） */
  icon?: React.ReactNode
  /** 是否显示（根据数据判断） */
  showWhen?: (item: T, isAdmin?: boolean) => boolean
  /** 点击回调 */
  onClick: (item: T) => void
  /** 是否需要二次确认 */
  confirm?: boolean
  /** 确认文案 */
  confirmMessage?: string
  /** 是否显示加载状态 */
  loading?: boolean
  /** 权限要求 */
  requiredRole?: 'admin' | 'user'
  /** 是否为图标按钮（只有图标没有文字） */
  iconOnly?: boolean
  /** 图标按钮的 title */
  title?: string
}

// 组件 Props
interface TableActionButtonsProps<T> {
  /** 数据项 */
  item: T
  /** 操作按钮配置列表 */
  actions: ActionButtonConfig<T>[]
  /** 是否显示编辑按钮（默认 true） */
  showEdit?: boolean
  /** 编辑按钮回调 */
  onEdit?: (item: T) => void
  /** 管理员权限 */
  isAdmin?: boolean
  /** 自定义渲染（覆盖默认按钮） */
  renderCustomActions?: (item: T) => React.ReactNode
  /** 紧凑模式 */
  compact?: boolean
  /** 状态字段名（用于判断状态，如 'status'） */
  statusField?: keyof T
  /** 状态值映射（如 { in_stock: '借用', borrowed: '归还' }） */
  statusLabels?: Record<string, string>
}
```

## 三、样式要求（必须与 Inventory.tsx 完全一致）

### Inventory.tsx 现有样式参考：
```typescript
// 编辑按钮
<Button variant="morden" size="sm" className="h-8 w-8 p-0" title="编辑" onClick={...}>
  <Pencil className="w-3.5 h-3.5" />
</Button>

// 借用按钮（带 LoadingButton 和确认逻辑）
<LoadingButton
  size="sm"
  className={cn(
    "h-8 text-sm/4 px-3 border-0",
    isConfirming
      ? isLoading
        ? "text-destructive-foreground opacity-100 cursor-wait bg-destructive/70 transition-none"
        : "bg-destructive text-destructive-foreground hover:bg-destructive/70 transition-none"
      : "bg-primary hover:bg-primary/80"
  )}
  onClick={handleClick}
  isLoading={isLoading}
>
  {isConfirming ? '确认' : '借用'}
</LoadingButton>

// 借出状态显示
{status === 'borrowed' && (
  <div className="flex items-center gap-1 text-sm text-muted-foreground">
    <span className="text-blue-800 dark:text-blue-200">
      {item.borrower_name ? `${item.borrower_name}借用` : '借用中'}
    </span>
  </div>
)}
```
```

## 三、使用示例

### 3.1 Inventory 页面

```typescript
const inventoryActions: ActionButtonConfig<InventoryItem>[] = [
  {
    id: 'borrow',
    label: '借用',
    variant: 'default',
    showWhen: (item) => item.status === 'in_stock',
    onClick: handleBorrow,
    confirm: true,
    confirmMessage: '确认借用此物品？'
  }
]

// 渲染
<TableActionButtons
  item={item}
  actions={inventoryActions}
  showEdit={true}
  onEdit={handleEdit}
  isAdmin={isAdmin}
/>
```

### 3.2 ConsumableOrders 页面

```typescript
const orderActions: ActionButtonConfig<ConsumableOrder>[] = [
  {
    id: 'approve',
    label: '审批',
    showWhen: (item, isAdmin) => isAdmin && item.status === 'pending',
    onClick: handleApprove
  },
  {
    id: 'reject',
    label: '驳回',
    variant: 'destructive',
    showWhen: (item, isAdmin) => isAdmin && item.status === 'pending',
    onClick: handleReject
  },
  {
    id: 'complete',
    label: '确认完成',
    variant: 'secondary',
    showWhen: (item) => item.status === 'approved',
    onClick: handleComplete
  }
]
```

## 四、实现要点

1. **React.memo + 自定义 isEqual**：只在该变的属性变化时重渲染
2. **内联状态管理**：每个按钮的 confirm/loading 状态在组件内部管理
3. **权限控制**：通过 isAdmin 和 showWhen 控制按钮显示
4. **事件冒泡阻止**：点击按钮时阻止事件冒泡到行

## 五、优势

| 方面 | 描述 |
|------|------|
| **复用性** | 一个组件满足所有表格操作场景 |
| **可维护性** | 新增操作只需添加配置，无需改代码 |
| **一致性** | 所有表格的操作按钮样式和行为统一 |
| **性能** | React.memo + 自定义 isEqual 优化 |

## 六、待确认问题

1. 是否需要支持自定义渲染函数（覆盖默认按钮行为）？
2. 是否需要支持按钮分组（多个按钮组合）？
3. 确认弹窗是否需要自定义组件，还是使用内置逻辑？
