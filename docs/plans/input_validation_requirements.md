# 输入检查需求清单

## 用户需求摘要

1. **所有必填项**：添加非空检查
2. **CAS号**：增加校验码验证（符合CAS Registry Number规范）
3. **错误提示**：样式与现有的一致

---

## 已创建的工具函数

已在 `frontend/src/lib/inputValidation.ts` 创建统一的验证工具，包含：

| 函数名 | 功能 |
|--------|------|
| `validateCASNumber(cas)` | CAS号格式+校验码验证 |
| `normalizeCASNumber(cas)` | CAS号标准化（去空格、转大写） |
| `validateRequired(value, name)` | 必填验证 |
| `validateStringLength(value, min, max, name)` | 字符串长度验证 |
| `validatePositiveNumber(value, name)` | 正数验证 |
| `validateNonNegativeNumber(value, name)` | 非负数验证 |
| `validateUsername(username)` | 用户名格式验证 |
| `validatePassword(password)` | 密码强度验证 |
| `validateLocation(location)` | 位置格式验证 |
| `validateSpecification(spec)` | 规格格式验证 |
| `validatePrice(price, min, max)` | 价格范围验证 |

---

## 修改清单

### 1. 登录页面 (Login.tsx)

| 输入框ID | 标签 | 必填 | 现有检查 | 需要添加的检查 |
|----------|------|:----:|----------|---------------|
| username | 用户名 | ✅ | z.string().min(1) | 建议保持Zod，或改用统一工具 |
| password | 密码 | ✅ | z.string().min(1) | 建议保持Zod，或改用统一工具 |

**建议**：Login页面已使用Zod，可保持现状，或迁移到统一工具

---

### 2. 用户管理页面 (AdminUsers.tsx)

#### 创建用户表单
| 输入框ID | 标签 | 必填 | 需要添加的检查 |
|----------|------|:---:|---------------|
| create_username | 用户名 | ✅ | 格式验证 + 非空 + 长度 |
| create_password | 密码 | ✅ | 强度验证(6+位) + 非空 |
| create_fullname | 姓名 | ✅ | **新增必填** + 非空 |
| create_role | 角色 | ❌ | - |

#### 编辑用户表单
| 输入框ID | 标签 | 必填 | 需要添加的检查 |
|----------|------|:---:|---------------|
| edit_fullname | 姓名 | ❌ | - |

---

### 3. 试剂订单页面 (ReagentOrders.tsx)

#### 创建订单表单
| 输入框ID | 标签 | 必填 | 需要添加的检查 |
|----------|------|:---:|---------------|
| create_cas | CAS号 | ✅ | **校验码验证** + 非空 |
| create_name | 名称 | ✅ | 非空 |
| create_english_name | 英文名称 | ✅ | **新增必填** + 非空 |
| create_alias | 别名 | ❌ | - |
| create_category | 级别/规格 | ✅ | **新增必填** + 非空 |
| create_brand | 品牌 | ✅ | **新增必填** + 非空 |
| create_specification | 规格 | ✅ | 非空 + 格式验证 |
| create_quantity | 数量 | ✅ | 正数验证 |
| create_price | 价格 | ✅ | **新增必填** + 非负数 |
| create_order_reason | 订购原因 | ✅ | **新增必填** |
| create_notes | 备注 | ❌ | - |

---

### 4. 耗材订单页面 (ConsumableOrders.tsx)

#### 创建订单表单
| 输入框ID | 标签 | 必填 | 需要添加的检查 |
|----------|------|:---:|---------------|
| create_name | 名称 | ✅ | 非空 |
| create_english_name | 英文名称 | ❌ | - |
| create_alias | 别名 | ❌ | - |
| create_category | 分类 | ❌ | - |
| create_brand | 品牌 | ❌ | - |
| create_specification | 规格 | ✅ | 非空 + 格式验证 |
| create_quantity | 数量 | ✅ | 正数验证 |
| create_price | 价格 | ✅ | **新增必填** + 非负数 |
| create_notes | 备注 | ❌ | - |

---

### 5. 库存管理页面 (Inventory.tsx)

#### 入库表单 (add)
| 输入框ID | 标签 | 必填 | 需要添加的检查 |
|----------|------|:---:|---------------|
| add_name | 试剂名称 | ✅ | 非空 |
| add_cas | CAS号 | ✅ | **校验码验证** + 非空 |
| add_english_name | 英文名称 | ❌ | - |
| add_alias | 别名 | ❌ | - |
| add_location | 存放位置 | ❌ | ~~删除验证~~（确认非必填） |
| add_spec | 规格 | ✅ | 非空 + 格式验证 |
| add_quantity | 瓶数 | ✅ | 正数验证 |
| add_brand | 品牌 | ❌ | - |
| add_category | 分类 | ❌ | - |
| add_notes | 备注 | ❌ | - |

#### 编辑表单 (edit)
| 输入框ID | 标签 | 必填 | 需要添加的检查 |
|----------|------|:---:|---------------|
| edit_name | 名称 | ✅ | 非空 |
| edit_remaining | 剩余量 | ✅ | 非负数验证 |
| edit_spec | 规格 | ✅ | 非空 + 格式验证 |

---

### 6. 仪表盘页面 (Dashboard.tsx)

| 输入框ID | 标签 | 必填 | 需要添加的检查 |
|----------|------|:---:|---------------|
| return_quantity | 归还数量 | ✅ | 非负数验证 |
| stockin_location | 入库位置 | ❌ | 格式验证（可选） |

---

## 其他优化建议

### 1. 即时验证（onBlur）
- 数量、价格等字段可在 `onBlur` 时即时验证
- 现有：只在提交时显示错误
- 建议：失去焦点时立即验证并显示错误

### 2. 错误样式统一
- 现有：使用 `border-destructive` 类
- 建议：使用 Input 组件的 error 状态或自定义错误类

### 3. 搜索框防抖
- 现有：每次输入立即触发
- 建议：增加 debounce（如300ms）减少API请求

### 4. 密码强度指示器
- 建议：在创建用户时显示密码强度（弱/中/强）

### 5. CAS号自动格式化
- 用户输入时可自动添加连字符（如输入64175自动转为64-17-5）

### 6. 表单重置逻辑
- 建议：在每个对话框关闭后统一重置表单状态

---

## 实施优先级

| 优先级 | 任务 | 页面 |
|:------:|------|------|
| P0 | CAS号校验码验证 | ReagentOrders, Inventory |
| P0 | 所有必填项非空检查 | 所有页面 |
| P1 | 规格格式验证 | ReagentOrders, ConsumableOrders, Inventory |
| P1 | 数量/价格正数验证 | ReagentOrders, ConsumableOrders, Inventory |
| P2 | 用户名格式验证 | AdminUsers |
| P2 | 密码强度验证 | AdminUsers |
| P3 | 位置格式验证 | Dashboard |
| P3 | 即时验证 onBlur | 所有页面 |
