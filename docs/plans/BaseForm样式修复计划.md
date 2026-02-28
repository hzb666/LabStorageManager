# BaseForm 样式修复计划

## 问题概述

1. **BaseForm 样式与手写表单不一致**：需要确保 UI 完全一致，包括标签和输入框距离、错误文字距离、大小、输入框间距等
2. **危险品 checkbox 未显示图标**：需要在 BaseForm 的危险品字段旁边显示 AlertTriangle 图标
3. **布局不是 flex 布局，屏幕变窄时还是固定列数**

## 当前代码分析

### 手写表单样式（Inventory-old.tsx）

```jsx
// 布局使用 grid
<div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
  // 每个字段
  <div>
    <Label ...>规格</Label>
    <Input ... />
    {error && <p>错误</p>}
  </div>
</div>
```

- 使用 `grid-cols-1 sm:grid-cols-3`，响应式列数
- 每个字段是单独的 div，没有额外间距类

### BaseForm 当前样式

- 使用 `grid` 布局但列数固定：`style={{ gridTemplateColumns: repeat(${columns}, minmax(0, 1fr)) }}`
- 没有响应式调整

## 修复方案

### 1. 修改 FormField 组件

**文件**: `frontend/src/components/ui/FormField.tsx`

调整样式使其与手写表单一致：
- 移除 `space-y-2`，使用更精确的间距控制
- Label: 保持 `text-base mb-1.5 block`
- 错误文字: 保持 `text-sm text-destructive mt-1`

### 2. 修改 BaseForm 组件

**文件**: `frontend/src/components/BaseForm.tsx`

- 为 checkbox 类型字段添加特殊处理
- 当字段名包含 "hazardous" 或 "危险品" 时，在复选框旁边显示 AlertTriangle 图标

### 3. 具体修改

#### FormField.tsx 修改

```tsx
// 当前
<div className={cn("space-y-2", className)}>

// 修改为
<div className={cn("flex flex-col", className)}>
```

#### BaseForm.tsx checkbox 字段修改

添加 AlertTriangle 图标到危险品复选框旁边。

## 验收标准

1. BaseForm 生成的表单样式与 Inventory-old.tsx 手写表单完全一致
2. 危险品复选框旁边显示黄色 AlertTriangle 图标
3. 标签与输入框的间距一致
4. 错误文字与输入框的间距一致
5. 输入框与输入框之间的上下间距一致
