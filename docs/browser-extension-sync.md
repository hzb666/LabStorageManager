# 浏览器插件购物车同步 - 详细开发文档

## 一、概述

本功能实现北大医学部试剂平台购物车到实验室管理系统的批量导入。

### 1.1 工作流程

```
┌─────────────────────────────────────────────────────────────────┐
│  北医学部购物车页面                                               │
│                                                                  │
│  1. 用户点击插件图标                                              │
│  2. 插件自动判断类型（检测CAS号：有=试剂，无=耗材）                   │
│  3. 点击"识别"按钮                                                │
│  4. 显示已提交订单列表（复选框，默认全选）                           │
│  5. 点击"导入" → 跳转 + storage传递数据                           │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  系统 /import 批量入库页面                                        │
│                                                                  │
│  7. 左侧：商品列表（复选框 + 名称 + 类型图标）                       │
│     右侧：表单（与现有订单弹窗完全一致）                             │
│  8. 顶部：类型切换（耗材/试剂）                                    │
│  9. 用户补充信息 → 点击"提交并下一条"                               │
│  10. 左侧列表标记✅ → 自动跳转到下一条                              │
│  11. 全部完成 → 提示完成                                          │
└─────────────────────────────────────────────────────────────────┘
```

---

## 二、插件端开发

### 2.1 文件修改清单

| 文件 | 修改内容 |
|------|----------|
| `content/script.js` | 添加CAS号检测，返回order_type |
| `popup.js` | 移除订单类型下拉框，使用识别结果 |
| `popup.html` | 移除订单类型下拉框HTML |

### 2.2 content/script.js - 自动识别订单类型

#### 2.2.1 修改位置

在 `extractItemBasicInfo` 函数中添加CAS号检测逻辑。

#### 2.2.2 检测逻辑

```javascript
// 提取CAS号 - 匹配格式如 7664-41-7
const casMatch = element.textContent.match(/\d{2,7}-\d{2}-\d/);
const isReagent = !!casMatch;

// 设置订单类型
const orderType = isReagent ? 'reagent' : 'consumable';
```

#### 2.2.3 返回数据格式

```javascript
return {
  productId: productId,
  cartItemId: cartItemId,
  quantity: quantity,
  price: price,
  detailUrl: detailUrl,
  is_dangerous: isDangerous,
  cas_number: casMatch ? casMatch[0] : '',  // 新增
  order_type: orderType,                     // 新增
};
```

#### 2.2.4 完整代码修改

```javascript
// 从商品项中提取基本信息
function extractItemBasicInfo(element) {
  let productId = '';
  let cartItemId = '';
  let quantity = 1;
  let price = 0;
  let detailUrl = '';
  let isDangerous = false;
  let casNumber = '';       // 新增
  let orderType = 'consumable';  // 新增

  // ... 现有逻辑 ...

  // 5. 检测危险品 - 通过 wxp.png 图片判断
  const dangerousImg = element.querySelector('img[src*="wxp.png"]');
  isDangerous = !!dangerousImg;

  // 6. 检测CAS号并判断订单类型
  const casMatch = element.textContent.match(/\d{2,7}-\d{2}-\d/);
  if (casMatch) {
    casNumber = casMatch[0];
    orderType = 'reagent';  // 有CAS号=试剂
  }

  return {
    productId: productId,
    cartItemId: cartItemId,
    quantity: quantity,
    price: price,
    detailUrl: detailUrl,
    is_dangerous: isDangerous,
    cas_number: casNumber,
    order_type: orderType,
  };
}
```

### 2.3 popup.js - 移除下拉框

#### 2.3.1 修改内容

1. 移除订单类型下拉框变量
2. 移除订单类型下拉框事件绑定
3. 保存数据时使用识别到的order_type

#### 2.3.2 保存数据格式

```javascript
// 保存待导入的商品数据到storage
async function saveCartItemsToStorage(items, orderType) {
  const data = {
    items: items,
    // orderType 改为从第一个商品获取（插件识别结果）
    orderType: items.length > 0 ? items[0].order_type : 'consumable',
    timestamp: Date.now()
  };
  await chrome.storage.local.set({ pendingCartItems: data });
}
```

### 2.4 popup.html - 移除下拉框HTML

删除以下HTML代码：
```html
<div class="form-group">
  <label class="form-label">订单类型</label>
  <select id="orderType" class="select" style="width: 100%;">
    <option value="consumable">耗材订单</option>
    <option value="reagent">试剂订单</option>
  </select>
</div>
```

---

## 三、前端开发

### 3.1 文件修改清单

| 文件 | 修改内容 |
|------|----------|
| `src/App.tsx` | 添加 `/import` 路由 |
| `src/pages/Import.tsx` | **新建** - 批量入库页面 |

### 3.2 App.tsx - 添加路由

```tsx
// 添加导入页面路由
import { ImportPage } from './pages/Import'

// 在路由配置中添加
<Route path="/import" element={<ImportPage />} />
```

### 3.3 ImportPage 组件设计

#### 3.3.1 组件结构

```
┌────────────────────────────────────────────────────────────────────────┐
│  批量入库                                           [○ 耗材] [● 试剂]   │
├────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐  ┌────────────────────────────────────────┐   │
│  │ ☐ 氨 GR     🔴   │  │                                        │   │
│  │ ☑ 丙酮     🔵   │  │  [表单内容与现有订单弹窗完全一致]        │   │
│  │ ☑ 甲苯     🔵   │  │                                        │   │
│  │                   │  │                                        │   │
│  │ 已处理: 1/3       │  │                                        │   │
│  └──────────────────┘  └────────────────────────────────────────┘   │
│                                                                        │
│                           ┌─────────────┐  ┌─────────────┐             │
│                           │ 提交并下一条 │  │    取消    │             │
│                           └─────────────┘  └─────────────┘             │
└────────────────────────────────────────────────────────────────────────┘
```

#### 3.3.2 Props 接口

```typescript
// 商品项类型 - 与插件传递的数据一致
interface CartItem {
  name: string
  specification?: string
  quantity: number
  price?: number
  brand?: string
  cas_number?: string
  english_name?: string
  order_type: 'consumable' | 'reagent'
  is_dangerous?: boolean
  detail_url?: string
  product_id?: string
}
```

#### 3.3.3 组件状态

```typescript
interface ImportPageState {
  // 数据相关
  items: CartItem[]           // 全部商品列表
  submitted: boolean[]        // 提交状态数组

  // UI相关
  currentIndex: number        // 当前编辑的索引
  orderType: 'consumable' | 'reagent'  // 当前表单类型

  // 加载状态
  isLoading: boolean
  isSubmitting: boolean
}
```

#### 3.3.4 核心逻辑

##### 读取storage数据

```typescript
useEffect(() => {
  // 读取 chrome.storage.local 中的商品数据
  chrome.storage.local.get('pendingCartItems', (result) => {
    if (result.pendingCartItems) {
      const { items } = result.pendingCartItems;
      setItems(items);
      setSubmitted(new Array(items.length).fill(false));
      // 默认使用第一个商品的类型
      if (items.length > 0) {
        setOrderType(items[0].order_type);
      }
    }
  });
}, []);
```

##### 表单初始值

```typescript
// 根据当前商品和类型构建表单初始值
const getInitialValues = (item: CartItem, type: 'consumable' | 'reagent') => {
  if (type === 'reagent') {
    return {
      name: item.name || '',
      cas_number: item.cas_number || '',
      english_name: item.english_name || '',
      category: '',
      brand: item.brand || '',
      specification: item.specification || '',
      quantity: item.quantity || 1,
      price: item.price,
      supplier: '',
      order_reason: undefined,
      is_hazardous: item.is_dangerous || false,
      notes: '',
    };
  } else {
    return {
      name: item.name || '',
      english_name: item.english_name || '',
      category: '',
      brand: item.brand || '',
      specification: item.specification || '',
      quantity: item.quantity || 1,
      price: item.price,
      order_reason: undefined,
      is_hazardous: item.is_dangerous || false,
      notes: '',
    };
  }
};
```

##### 提交逻辑

```typescript
const handleSubmit = async (data: ReagentOrderFormData | ConsumableOrderFormData) => {
  setIsSubmitting(true);

  try {
    if (orderType === 'reagent') {
      await reagentOrdersAPI.create(data as ReagentOrderFormData);
    } else {
      await consumableOrdersAPI.create(data as ConsumableOrderFormData);
    }

    // 标记当前项为已提交
    const newSubmitted = [...submitted];
    newSubmitted[currentIndex] = true;
    setSubmitted(newSubmitted);

    // 清除storage
    chrome.storage.local.remove('pendingCartItems');

    // 跳转到下一条或完成
    if (currentIndex < items.length - 1) {
      // 查找下一个未提交的
      const nextIndex = items.findIndex((_, i) => i > currentIndex && !newSubmitted[i]);
      if (nextIndex !== -1) {
        setCurrentIndex(nextIndex);
        setOrderType(items[nextIndex].order_type);
      }
    } else {
      // 全部完成
      toast.success('导入完成');
    }
  } catch (error) {
    toast.error('提交失败，请重试');
  } finally {
    setIsSubmitting(false);
  }
};
```

### 3.4 表单配置复用

#### 3.4.1 导入现有配置

```typescript
import {
  getReagentOrderFormFields,
  getConsumableOrderFormFields,
} from '@/lib/formConfigs'

import {
  ReagentOrderSchema,
  ConsumableOrderSchema,
} from '@/lib/validationSchemas'
```

#### 3.4.2 动态获取表单字段

```typescript
const fields = orderType === 'reagent'
  ? getReagentOrderFormFields(false)
  : getConsumableOrderFormFields(false);
```

#### 3.4.3 表单验证

```typescript
const schema = orderType === 'reagent'
  ? ReagentOrderSchema
  : ConsumableOrderSchema;
```

### 3.5 完整组件代码

```tsx
import React, { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { v } from 'valibot'
import { BaseForm } from '@/components/BaseForm'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { toast } from '@/components/ui/Toast'
import { RadioGroup, RadioGroupItem } from '@/components/ui/RadioGroup'
import { Label } from '@/components/ui/Label'
import { Checkbox } from '@/components/ui/Checkbox'
import { Loader2, FlaskConical, Package } from 'lucide-react'
import {
  getReagentOrderFormFields,
  getConsumableOrderFormFields,
} from '@/lib/formConfigs'
import {
  ReagentOrderSchema,
  ConsumableOrderSchema,
  type ReagentOrderFormData,
  type ConsumableOrderFormData,
} from '@/lib/validationSchemas'
import { consumableOrdersAPI, reagentOrdersAPI } from '@/api/client'

// 商品项类型
interface CartItem {
  name: string
  specification?: string
  quantity: number
  price?: number
  brand?: string
  cas_number?: string
  english_name?: string
  order_type: 'consumable' | 'reagent'
  is_dangerous?: boolean
  detail_url?: string
  product_id?: string
}

export function ImportPage() {
  const [items, setItems] = useState<CartItem[]>([])
  const [submitted, setSubmitted] = useState<boolean[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [orderType, setOrderType] = useState<'consumable' | 'reagent'>('consumable')
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // 表单
  const form = useForm<ReagentOrderFormData | ConsumableOrderFormData>()

  // 读取storage数据
  useEffect(() => {
    chrome.storage.local.get('pendingCartItems', (result) => {
      if (result.pendingCartItems?.items) {
        const loadedItems = result.pendingCartItems.items;
        setItems(loadedItems);
        setSubmitted(new Array(loadedItems.length).fill(false));
        if (loadedItems.length > 0) {
          setOrderType(loadedItems[0].order_type);
        }
      }
      setIsLoading(false);
    });
  }, []);

  // 当前商品
  const currentItem = items[currentIndex];

  // 表单初始值
  useEffect(() => {
    if (currentItem) {
      const initialValues = orderType === 'reagent'
        ? {
            name: currentItem.name || '',
            cas_number: currentItem.cas_number || '',
            english_name: currentItem.english_name || '',
            category: '',
            brand: currentItem.brand || '',
            specification: currentItem.specification || '',
            quantity: currentItem.quantity || 1,
            price: currentItem.price,
            supplier: '',
            order_reason: undefined,
            is_hazardous: currentItem.is_dangerous || false,
            notes: '',
          }
        : {
            name: currentItem.name || '',
            english_name: currentItem.english_name || '',
            category: '',
            brand: currentItem.brand || '',
            specification: currentItem.specification || '',
            quantity: currentItem.quantity || 1,
            price: currentItem.price,
            order_reason: undefined,
            is_hazardous: currentItem.is_dangerous || false,
            notes: '',
          };
      form.reset(initialValues as any);
    }
  }, [currentItem, orderType]);

  // 获取表单字段
  const fields = orderType === 'reagent'
    ? getReagentOrderFormFields(false)
    : getConsumableOrderFormFields(false);

  // 提交处理
  const handleSubmit = async (data: ReagentOrderFormData | ConsumableOrderFormData) => {
    setIsSubmitting(true);
    try {
      if (orderType === 'reagent') {
        await reagentOrdersAPI.create(data as ReagentOrderFormData);
      } else {
        await consumableOrdersAPI.create(data as ConsumableOrderFormData);
      }

      // 标记已提交
      const newSubmitted = [...submitted];
      newSubmitted[currentIndex] = true;
      setSubmitted(newSubmitted);

      // 清除storage
      chrome.storage.local.remove('pendingCartItems');

      // 跳转到下一条
      const nextIndex = items.findIndex((_, i) => i > currentIndex && !newSubmitted[i]);
      if (nextIndex !== -1) {
        setCurrentIndex(nextIndex);
        setOrderType(items[nextIndex].order_type);
        toast.success('提交成功，继续下一条');
      } else if (newSubmitted.every(s => s)) {
        toast.success('全部导入完成');
      }
    } catch (error) {
      toast.error('提交失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 加载状态
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  // 无数据
  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card>
          <CardContent className="p-6">
            <p>暂无导入数据</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <div className="flex items-center gap-4 mb-6">
        <h1 className="text-2xl font-bold">批量入库</h1>
        <RadioGroup
          value={orderType}
          onValueChange={(v) => setOrderType(v as 'consumable' | 'reagent')}
          className="flex gap-4"
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem value="consumable" id="consumable" />
            <Label htmlFor="consumable" className="flex items-center gap-1">
              <Package className="w-4 h-4" /> 耗材
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="reagent" id="reagent" />
            <Label htmlFor="reagent" className="flex items-center gap-1">
              <FlaskConical className="w-4 h-4" /> 试剂
            </Label>
          </div>
        </RadioGroup>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* 左侧：商品列表 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">商品列表</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {items.map((item, index) => (
              <div
                key={index}
                className={`flex items-center gap-2 p-2 rounded cursor-pointer ${
                  index === currentIndex ? 'bg-primary/10 border border-primary' : ''
                } ${submitted[index] ? 'opacity-50' : ''}`}
                onClick={() => !submitted[index] && setCurrentIndex(index)}
              >
                <Checkbox
                  checked={submitted[index]}
                  disabled
                />
                <span className="flex-1 truncate">{item.name}</span>
                {item.order_type === 'reagent' ? (
                  <FlaskConical className="w-4 h-4 text-red-500" />
                ) : (
                  <Package className="w-4 h-4 text-blue-500" />
                )}
              </div>
            ))}
            <div className="pt-2 text-sm text-muted-foreground">
              已处理: {submitted.filter(s => s).length} / {items.length}
            </div>
          </CardContent>
        </Card>

        {/* 右侧：表单 */}
        <Card className="col-span-2">
          <CardHeader>
            <CardTitle className="text-lg">
              {orderType === 'reagent' ? '试剂订单' : '耗材订单'} - {currentItem?.name}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <BaseForm
              form={form}
              fields={fields}
              onSubmit={handleSubmit}
              disabled={isSubmitting}
              submitText={currentIndex < items.length - 1 ? '提交并下一条' : '提交完成'}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
```

---

## 四、后端清理

### 4.1 删除文件

| 文件 | 说明 |
|------|------|
| `app/api/cart_sync.py` | 不再需要匹配功能 |

---

## 五、API 调用

### 5.1 复用现有接口

| 接口 | 用途 |
|------|------|
| `POST /api/consumable-orders` | 创建耗材订单 |
| `POST /api/reagent-orders` | 创建试剂订单 |

### 5.2 请求格式

与现有订单创建接口完全一致，无需修改后端。

---

## 六、输入验证

### 6.1 前端验证

使用现有的 valibot schema：

| 类型 | Schema |
|------|--------|
| 试剂 | `ReagentOrderSchema` |
| 耗材 | `ConsumableOrderSchema` |

### 6.2 后端验证

直接调用现有的订单创建接口，后端已有验证逻辑。

---

## 七、开发顺序

```
1. content/script.js - 添加CAS号检测和order_type
2. popup.js - 移除下拉框，使用识别结果
3. popup.html - 移除下拉框HTML
4. App.tsx - 添加 /import 路由
5. ImportPage - 实现批量入库页面
6. 删除 app/api/cart_sync.py
7. 测试联调
```

---

## 八、注意事项

1. **浏览器扩展API**: 使用 `chrome.storage.local` 需要在 manifest.json 中声明 `storage` 权限
2. **类型切换**: 用户可以修改订单类型，表单字段会动态变化
3. **数据清理**: 提交完成后清除 storage 中的数据
4. **错误处理**: 提交失败时停留在当前页面，允许重试
