# 删除 ResizableHeader 组件实施计划

## 背景
- ResizableHeader 组件用于 TanStack Table 的可调整列宽功能
- 该组件位于 `frontend/src/components/ui/ResizableHeader.tsx`
- 被 `Dashboard.tsx` 中的三个表格使用

## 受影响文件
| 文件 | 引用位置 | 说明 |
|------|---------|------|
| `ResizableHeader.tsx` | 组件定义 | 需删除 |
| `Dashboard.tsx` | 第14行 | 导入语句 |
| `Dashboard.tsx` | 第727行 | 耗材订单表格 |
| `Dashboard.tsx` | 第779行 | 借用记录表格 |
| `Dashboard.tsx` | 第830行 | 入库记录表格 |
| `Dashboard.tsx` | 第311,318,325行 | columnResizeMode 配置 |

## 实施步骤

### 1. 修改 Dashboard.tsx - 表头渲染
将 `<ResizableHeader key={header.id} header={header} />` 替换为：
```tsx
<th 
  key={header.id}
  className="h-11 px-3 font-semibold text-foreground text-left align-middle text-base"
>
  {header.isPlaceholder
    ? null
    : flexRender(header.column.columnDef.header, header.getContext())}
</th>
```

### 2. 删除导入语句
移除第14行：`import { ResizableHeader } from '@/components/ui/ResizableHeader'`

### 3. 清理 columnResizeMode 配置
移除三个表格配置中的 `columnResizeMode: 'onChange'`

### 4. 删除组件文件
删除 `frontend/src/components/ui/ResizableHeader.tsx`

### 5. 验证构建
运行 `npm run build` 验证无错误

## 替换代码示例

### 耗材订单表格 (第726-728行)
```tsx
{/* 替换前 */}
<ResizableHeader key={header.id} header={header} />

{/* 替换后 */}
<th 
  key={header.id}
  className="h-11 px-3 font-semibold text-foreground text-left align-middle text-base"
>
  {header.isPlaceholder
    ? null
    : flexRender(header.column.columnDef.header, header.getContext())}
</th>
```

### 借用记录表格 (第778-780行)
同上

---

## 检查清单

- [X] Dashboard.tsx 修改表头渲染
- [X] 删除 ResizableHeader 导入语句
- [X] 清理 columnResizeMode 配置
- [X] 删除 ResizableHeader.tsx 组件文件

---

**检查完成**: ✅ 全部完成

---

*文档更新时间: 2026-02-28*
