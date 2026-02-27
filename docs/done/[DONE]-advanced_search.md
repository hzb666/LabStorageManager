# 高级搜索功能设计方案

## 需求分析

1. **精确搜索（搜索具体字段）**：用户可以指定搜索哪个字段（名称、CAS号、位置、品牌、分类）
2. **模糊搜索（忽略空格）**：搜索时自动忽略空格，例如搜索 "64 17 5" 也能匹配 "64-17-5"

---

## 实现方案

### 1. 后端 API 修改

#### 1.1 新增搜索参数
```python
@router.get("/")
def list_inventory(
    skip: int = 0,
    limit: int = 50,
    status_filter: Optional[InventoryStatus] = None,
    cas_filter: Optional[str] = None,
    hazardous_only: bool = False,
    search: Optional[str] = None,
    search_field: Optional[str] = None,  # 新增：精确搜索指定字段
    fuzzy: bool = False,                 # 新增：模糊搜索（忽略空格）
    db: Session = Depends(get_db),
):
```

#### 1.2 搜索逻辑
```python
def _build_search_query(search: str, search_field: Optional[str], fuzzy: bool):
    """构建搜索查询"""
    if not search:
        return None
    
    # 模糊搜索：移除空格
    if fuzzy:
        search = search.replace(" ", "").replace("-", "").replace("_", "")
    
    search_pattern = f"%{search}%"
    
    # 精确搜索指定字段
    if search_field:
        field_map = {
            "name": Inventory.name,
            "cas_number": Inventory.cas_number,
            "location": Inventory.location,
            "brand": Inventory.brand,
            "category": Inventory.category,
        }
        if search_field in field_map:
            return field_map[search_field].ilike(search_pattern)
    
    # 默认：搜索所有字段
    return (
        (Inventory.name.ilike(search_pattern)) |
        (Inventory.cas_number.ilike(search_pattern)) |
        (Inventory.location.ilike(search_pattern)) |
        (Inventory.brand.ilike(search_pattern)) |
        (Inventory.category.ilike(search_pattern))
    )
```

### 2. 前端 UI 修改

#### 2.1 添加搜索模式选择器
在搜索输入框旁边添加：
- 下拉菜单选择搜索字段（名称/CAS号/位置/品牌/分类/全部）
- 模糊搜索开关（复选框）

```tsx
// 搜索字段选项
const SEARCH_FIELDS = [
  { value: 'all', label: '全部' },
  { value: 'name', label: '名称' },
  { value: 'cas_number', label: 'CAS号' },
  { value: 'location', label: '位置' },
  { value: 'brand', label: '品牌' },
  { value: 'category', label: '分类' },
]
```

#### 2.2 修改 API 调用
```typescript
// 在 loadInventory 中添加参数
const params: Record<string, any> = {
  skip: (page - 1) * pageSize,
  limit: pageSize,
}
if (statusFilter !== 'all') params.status_filter = statusFilter
if (apiFilter) {
  params.search = apiFilter
  if (searchField !== 'all') params.search_field = searchField
  if (fuzzySearch) params.fuzzy = 'true'
}
```

---

## UI 设计

```
┌─────────────────────────────────────────────────────────────────┐
│  [搜索名称、CAS号、位置...] [▼ 全部] [ ] 模糊搜索    [X]       │
└─────────────────────────────────────────────────────────────────┘
```

搜索字段下拉菜单：
- 全部（默认）
- 名称
- CAS号
- 位置
- 品牌
- 分类

---

## 确认问题

1. 是否同意此实现方案？
2. 模糊搜索的具体逻辑：是否移除所有空格和连字符？
3. 是否需要保存用户的搜索偏好（localStorage）？

---

## 检查清单

### 后端 API

- [X] search 参数支持
- [X] search_field 参数支持（精确搜索指定字段）
- [X] fuzzy 参数支持（模糊搜索忽略空格）

### 前端 UI

- [X] 搜索字段下拉菜单
- [X] 模糊搜索开关
- [X] API 调用传递参数

### 验证

- [X] Inventory.tsx 实现了高级搜索功能

---

**检查完成**: ✅ 全部完成

---

*文档更新时间: 2026-02-28*
