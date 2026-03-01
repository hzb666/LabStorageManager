# 试剂订单与库存页面 - 逐代码块深度对比分析报告

## 文档说明

本报告对以下四组文件进行逐代码块对比：
1. `app/models/reagent_order.py` vs `app/models/inventory.py` (数据模型)
2. `app/api/reagent_orders.py` vs `app/api/inventory.py` (后端API)
3. `frontend/src/pages/ReagentOrders.tsx` vs `frontend/src/pages/Inventory.tsx` (前端页面)
4. `frontend/src/api/client.ts` (API客户端)

---

# 第一部分：数据模型对比

## 1.1 模型定义 - Status枚举

### reagent_order.py (第14-20行)
```python
class ReagentOrderStatus(str, Enum):
    """Reagent order status enumeration"""
    PENDING = "pending"       # 已申购
    APPROVED = "approved"     # 已审批（采购完成）
    ARRIVED = "arrived"       # 已到货但未入库
    STOCKED = "stocked"       # 已入库
    REJECTED = "rejected"    # 未通过
```

### inventory.py (第18-23行)
```python
class InventoryStatus(str, Enum):
    """Inventory status enumeration"""
    NOT_IN_STOCK = "not_in_stock"
    IN_STOCK = "in_stock"
    BORROWED = "borrowed"
    CONSUMED = "consumed"
```

**对比分析**:
| 项目 | ReagentOrderStatus | InventoryStatus | 差异 |
|------|-------------------|-----------------|------|
| 枚举数量 | 5个 | 4个 | 不同 |
| 值 | pending/approved/arrived/stocked/rejected | not_in_stock/in_stock/borrowed/consumed | 完全不同 |
| 用途 | 订单流程状态 | 库存使用状态 | 业务不同 |

---

## 1.2 Reason枚举

### reagent_order.py (第23-32行)
```python
class ReagentOrderReason(str, Enum):
    """Order reason enumeration"""
    NONE = "none"
    RUNNING_OUT = "running_out"      # 库存用完
    NOT_STOCKED = "not_stocked"    # 库里没有
    COMMON_PUBLIC = "common_public"  # 公用常用
    NOT_FOUND = "not_found"          # 没找到
    REORDER = "reorder"              # 追加订购
    HIGH_USAGE = "high_usage"        # 大量使用
    DEGRADED = "degraded"            # 变质
```

### inventory.py
**无Reason枚举**

**对比分析**: 试剂订单有申购原因枚举，库存没有（库存不需要原因）

---

## 1.3 Base模型定义

### reagent_order.py (第35-64行) - ReagentOrderBase
```python
class ReagentOrderBase(SQLModel):
    # CAS Number - Critical field for reagents
    cas_number: str = Field(index=True, max_length=50)
    # Chinese name
    name: str = Field(max_length=200)
    # English name
    english_name: Optional[str] = Field(None, max_length=200)
    # Alias (e.g., "酒精, Ethanol")
    alias: Optional[str] = Field(None, max_length=200)
    # Category (e.g., "分析纯", "实验级")
    category: Optional[str] = Field(None, max_length=100)
    # Brand (e.g., "Sigma", "国药")
    brand: Optional[str] = Field(None, max_length=100)
    # Initial quantity value (e.g., 500)
    initial_quantity: Optional[float] = Field(None, ge=0)
    # Unit (e.g., "ml", "g", "L")
    unit: Optional[str] = Field(None, max_length=20)
    # Quantity ordered (number of bottles)
    quantity: int = Field(gt=0)
    # Price
    price: Optional[float] = Field(None, ge=0)
    # Order reason
    order_reason: ReagentOrderReason = ReagentOrderReason.NONE
    # Hazardous flag
    is_hazardous: bool = False
    # Image path (thumbnail in filesystem)
    image_path: Optional[str] = None
    # Notes
    notes: Optional[str] = Field(None, max_length=500)
```

### inventory.py (第26-41行) - InventoryBase
```python
class InventoryBase(SQLModel):
    # Critical: CAS Number copied from Order (already normalized)
    cas_number: str = Field(index=True, max_length=50)
    name: str = Field(index=True, max_length=200)  # 排序/搜索常用
    english_name: Optional[str] = Field(None, max_length=200)  # English name
    alias: Optional[str] = Field(None, max_length=200)
    category: Optional[str] = Field(index=True, max_length=100)  # 排序/搜索常用
    brand: Optional[str] = Field(index=True, max_length=100)  # 排序/搜索常用
    storage_location: Optional[str] = Field(index=True, max_length=200)  # 排序/搜索常用
    initial_quantity: float = Field(gt=0)
    remaining_quantity: float = Field(default=0.0)
    unit: str = Field(max_length=20, default="ml")  # Case-insensitive storage
    is_hazardous: bool = False
    image_path: Optional[str] = None  # Copied from Order
    notes: Optional[str] = Field(None, max_length=500)  # User custom notes
```

**对比分析 - Base模型字段差异**:

| 字段 | ReagentOrderBase | InventoryBase | 差异说明 |
|------|-----------------|---------------|----------|
| cas_number | ✅ 有索引 | ✅ 有索引 | 一致 |
| name | ✅ 无索引 | ✅ 有索引 (index=True) | 库存多了索引 |
| english_name | ✅ 可选 | ✅ 可选 | 一致 |
| alias | ✅ 可选 | ✅ 可选 | 一致 |
| category | ✅ 无索引 | ✅ 有索引 | 库存多了索引 |
| brand | ✅ 无索引 | ✅ 有索引 | 库存多了索引 |
| storage_location | ❌ 无 | ✅ 有 | 库存特有 |
| initial_quantity | Optional[float] | float | 类型不同 |
| remaining_quantity | ❌ 无 | ✅ 有 | 库存特有 |
| unit | Optional[str] | str (有默认值"ml") | 库存有默认值 |
| quantity | ✅ 订单数量 | ❌ 无 | 订单特有 |
| price | ✅ 价格 | ❌ 无 | 订单特有 |
| order_reason | ✅ 申购原因 | ❌ 无 | 订单特有 |
| is_hazardous | ✅ bool | ✅ bool | 一致 |
| image_path | ✅ | ✅ | 一致 |
| notes | ✅ | ✅ | 一致 |

---

## 1.4 主模型定义

### reagent_order.py (第67-80行) - ReagentOrder
```python
class ReagentOrder(ReagentOrderBase, table=True):
    """Reagent Order database model"""
    id: Optional[int] = Field(default=None, primary_key=True)
    applicant_id: Optional[int] = Field(
        default=None,
        foreign_key="users.id",
        ondelete="SET NULL"
    )
    status: ReagentOrderStatus = ReagentOrderStatus.PENDING
    created_at: datetime = Field(default_factory=get_utc_now)
    updated_at: datetime = Field(
        default_factory=get_utc_now,
        sa_column_kwargs={"onupdate": get_utc_now}
    )
```

### inventory.py (第44-83行) - Inventory
```python
class Inventory(InventoryBase, table=True):
    """Inventory database model - Individual item tracking"""
    id: Optional[int] = Field(default=None, primary_key=True)
    # Unique internal code: e.g., "64175-250113-01" (CAS-Date-Sequence)
    internal_code: str = Field(unique=True, index=True, max_length=50)
    status: InventoryStatus = Field(index=True, default=InventoryStatus.IN_STOCK)  # 排序/筛选常用
    borrower_id: Optional[int] = Field(
        default=None,
        index=True,
        foreign_key="users.id",
        ondelete="SET NULL"
    )
    last_borrower_id: Optional[int] = Field(
        default=None,
        foreign_key="users.id",
        ondelete="SET NULL"
    )
    temporary_keeper_id: Optional[int] = Field(
        default=None,
        index=True,
        foreign_key="users.id",
        ondelete="SET NULL"
    )
    created_by_id: Optional[int] = Field(
        default=None,
        index=True,
        foreign_key="users.id",
        ondelete="SET NULL"
    )
    created_at: datetime = Field(default_factory=get_utc_now, index=True)  # 排序常用
    updated_at: datetime = Field(
        default_factory=get_utc_now,
        sa_column_kwargs={"onupdate": get_utc_now}
    )
    
    # 拼音排序字段（预计算，使用数据库索引加速排序）
    name_pinyin: Optional[str] = Field(default=None, index=True)
    category_pinyin: Optional[str] = Field(default=None, index=True)
    brand_pinyin: Optional[str] = Field(default=None, index=True)
    alias_pinyin: Optional[str] = Field(default=None, index=True)
```

**对比分析 - 主模型字段差异**:

| 字段 | ReagentOrder | Inventory | 差异说明 |
|------|-------------|-----------|----------|
| id | ✅ 主键 | ✅ 主键 | 一致 |
| internal_code | ❌ 无 | ✅ 唯一索引 | 库存特有 |
| applicant_id | ✅ 申请人 | ❌ 无 | 订单特有 |
| status | ✅ 订单状态 | ✅ 库存状态 | 不同枚举 |
| borrower_id | ❌ 无 | ✅ 借用人 | 库存特有 |
| last_borrower_id | ❌ 无 | ✅ 上次借用人 | 库存特有 |
| temporary_keeper_id | ❌ 无 | ✅ 临时保管人 | 库存特有 |
| created_by_id | ❌ 无 | ✅ 创建人 | 库存特有 |
| created_at | ✅ | ✅ (有索引) | 库存多了索引 |
| updated_at | ✅ | ✅ | 一致 |
| name_pinyin | ❌ 无 | ✅ | 库存特有 |
| category_pinyin | ❌ 无 | ✅ | 库存特有 |
| brand_pinyin | ❌ 无 | ✅ | 库存特有 |
| alias_pinyin | ❌ 无 | ✅ | 库存特有 |

---

## 1.5 Create DTO对比

### reagent_order.py (第83-99行) - ReagentOrderCreate
```python
class ReagentOrderCreate(SQLModel):
    """DTO for creating a new reagent order
    
    前端传入 specification (规格字符串)，后端解析为 initial_quantity + unit
    """
    cas_number: str = Field(max_length=50)
    name: str = Field(max_length=200)
    english_name: Optional[str] = None
    alias: Optional[str] = None
    category: Optional[str] = None
    brand: Optional[str] = None
    specification: str = Field(max_length=100)  # 前端传入规格字符串，如 "500ml"
    quantity: int = Field(gt=0)
    price: Optional[float] = None
    order_reason: ReagentOrderReason = ReagentOrderReason.NONE
    is_hazardous: bool = False
    notes: Optional[str] = None
```

### inventory.py (第188-201行) - ManualInventoryCreate
```python
class ManualInventoryCreate(SQLModel):
    """DTO for manually adding inventory (not from Order)"""
    cas_number: str = Field(max_length=50)
    name: str = Field(max_length=200)
    english_name: Optional[str] = None
    alias: Optional[str] = None
    specification: str = Field(max_length=50)  # e.g., "500ml"
    initial_quantity: Optional[float] = None  # Optional - derived from specification
    quantity_bottles: int = Field(default=1, ge=1)  # Number of bottles
    storage_location: Optional[str] = None
    is_hazardous: bool = False
    category: Optional[str] = None
    brand: Optional[str] = None
    notes: Optional[str] = None
```

**对比分析 - Create DTO差异**:

| 字段 | ReagentOrderCreate | ManualInventoryCreate | 差异 |
|------|-------------------|----------------------|------|
| cas_number | ✅ | ✅ | 一致 |
| name | ✅ | ✅ | 一致 |
| english_name | ✅ | ✅ | 一致 |
| alias | ✅ | ✅ | 一致 |
| category | ✅ | ✅ | 一致 |
| brand | ✅ | ✅ | 一致 |
| specification | ✅ 必填 | ✅ 必填 | 一致 |
| initial_quantity | ❌ 无 | ✅ 可选 | 不同 |
| quantity | ✅ 数量 | ❌ 无 | 订单用quantity |
| quantity_bottles | ❌ 无 | ✅ 有默认值1 | 库存特有 |
| price | ✅ | ❌ 无 | 订单特有 |
| order_reason | ✅ | ❌ 无 | 订单特有 |
| storage_location | ❌ 无 | ✅ | 库存特有 |
| is_hazardous | ✅ | ✅ | 一致 |
| notes | ✅ | ✅ | 一致 |

---

## 1.6 Response DTO对比

### reagent_order.py (第120-140行) - ReagentOrderResponse
```python
class ReagentOrderResponse(SQLModel):
    """DTO for reagent order API responses"""
    id: int
    cas_number: str
    name: str
    english_name: Optional[str]
    alias: Optional[str]
    category: Optional[str]
    brand: Optional[str]
    initial_quantity: Optional[float]
    unit: Optional[str]
    quantity: int
    price: Optional[float]
    order_reason: ReagentOrderReason
    is_hazardous: bool
    image_path: Optional[str]
    notes: Optional[str]
    applicant_id: Optional[int]
    status: ReagentOrderStatus
    created_at: datetime
    updated_at: datetime
```

### inventory.py (第123-151行) - InventoryResponse
```python
class InventoryResponse(SQLModel):
    """DTO for inventory API responses"""
    id: int
    cas_number: str
    name: str
    english_name: Optional[str]
    alias: Optional[str]
    category: Optional[str]
    brand: Optional[str]
    storage_location: Optional[str]
    initial_quantity: float
    remaining_quantity: float
    unit: str
    status: InventoryStatus
    borrower_id: Optional[int]
    last_borrower_id: Optional[int]
    is_hazardous: bool
    image_path: Optional[str]
    temporary_keeper_id: Optional[int]
    created_by_id: Optional[int]
    notes: Optional[str]
    created_at: datetime
   
    # Computed field: specification updated_at: datetime (e.g., "500ml")
    specification: Optional[str] = None
    # Computed fields: user names
    borrower_name: Optional[str] = None
    last_borrower_name: Optional[str] = None
    created_by_name: Optional[str] = None
```

**对比分析 - Response DTO差异**:

| 字段 | ReagentOrderResponse | InventoryResponse | 差异 |
|------|---------------------|-------------------|------|
| id | ✅ | ✅ | 一致 |
| cas_number | ✅ | ✅ | 一致 |
| name | ✅ | ✅ | 一致 |
| english_name | ✅ | ✅ | 一致 |
| alias | ✅ | ✅ | 一致 |
| category | ✅ | ✅ | 一致 |
| brand | ✅ | ✅ | 一致 |
| storage_location | ❌ 无 | ✅ | 库存特有 |
| initial_quantity | Optional[float] | float | 类型不同 |
| remaining_quantity | ❌ 无 | ✅ | 库存特有 |
| unit | Optional[str] | str | 类型不同 |
| specification | ❌ 无 | ✅ 计算字段 | 库存特有 |
| quantity | ✅ | ❌ 无 | 订单特有 |
| price | ✅ | ❌ 无 | 订单特有 |
| order_reason | ✅ | ❌ 无 | 订单特有 |
| status | 订单状态 | 库存状态 | 不同枚举 |
| borrower_id | ❌ 无 | ✅ | 库存特有 |
| borrower_name | ❌ 无 | ✅ 计算字段 | 库存特有 |
| last_borrower_id | ❌ 无 | ✅ | 库存特有 |
| last_borrower_name | ❌ 无 | ✅ 计算字段 | 库存特有 |
| is_hazardous | ✅ | ✅ | 一致 |
| image_path | ✅ | ✅ | 一致 |
| temporary_keeper_id | ❌ 无 | ✅ | 库存特有 |
| created_by_id | ❌ 无 | ✅ | 库存特有 |
| created_by_name | ❌ 无 | ✅ 计算字段 | 库存特有 |
| notes | ✅ | ✅ | 一致 |
| created_at | ✅ | ✅ | 一致 |
| updated_at | ✅ | ✅ | 一致 |
| applicant_id | ✅ | ❌ 无 | 订单特有 |

---

# 第二部分：后端API对比

## 2.1 API路由定义

### reagent_orders.py (第34行)
```python
router = APIRouter(prefix="/reagent-orders", tags=["ReagentOrders"])
```

### inventory.py (第53行)
```python
router = APIRouter(prefix="/inventory", tags=["Inventory"])
```

**差异**: 前缀不同，tags不同

---

## 2.2 列表查询API - 参数定义

### reagent_orders.py (第134-146行)
```python
@router.get("/")
def list_reagent_orders(
    skip: int = 0,
    limit: int = 50,
    status_filter: Optional[ReagentOrderStatus] = None,
    search: Optional[str] = None,
    search_field: Optional[str] = None,
    fuzzy: bool = False,
    sort_by: Optional[str] = None,
    sort_order: Optional[str] = 'desc',
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
```

### inventory.py (第602-615行)
```python
@router.get("/")
def list_inventory(
    skip: int = 0,
    limit: int = 0,  # 0 表示不分页，返回全部数据
    status_filter: Optional[InventoryStatus] = None,
    cas_filter: Optional[str] = None,
    hazardous_only: bool = False,
    search: Optional[str] = None,
    search_field: Optional[str] = None,
    fuzzy: bool = False,
    sort_by: Optional[str] = None,
    sort_order: Optional[str] = 'desc',
    db: Session = Depends(get_db),
):
```

**对比分析 - list API参数差异**:

| 参数 | reagent_orders | inventory | 差异 |
|------|---------------|-----------|------|
| skip | ✅ 默认0 | ✅ 默认0 | 一致 |
| limit | ✅ 默认50 | ⚠️ 默认0 | **严重差异** |
| status_filter | ✅ | ✅ | 不同枚举类型 |
| search | ✅ | ✅ | 一致 |
| search_field | ✅ | ✅ | 一致 |
| fuzzy | ✅ | ✅ | 一致 |
| sort_by | ✅ | ✅ | 一致 |
| sort_order | ✅ | ✅ | 一致 |
| cas_filter | ❌ 无 | ✅ | 库存特有 |
| hazardous_only | ❌ 无 | ✅ | 库存特有 |
| current_user | ✅ 需要登录 | ❌ 不需要 | 订单需要权限 |

---

## 2.3 列表查询API - 缓存机制

### reagent_orders.py (无缓存)
```python
# 没有缓存相关代码
# 每次请求直接查询数据库
```

### inventory.py (第127-163行, 617-629行)
```python
# ==================== Search Cache ====================
SEARCH_CACHE: Dict[str, tuple[Any, datetime]] = {}
CACHE_TTL_SECONDS = 60  # 缓存有效期60秒

def _get_cached_result(cache_key: str) -> Optional[Dict[str, Any]]:
    """从缓存获取结果"""
    if cache_key in SEARCH_CACHE:
        cached_result, cached_time = SEARCH_CACHE[cache_key]
        if (get_utc_now() - cached_time).total_seconds() < CACHE_TTL_SECONDS:
            return cached_result
        else:
            del SEARCH_CACHE[cache_key]
    return None

# 在 list_inventory 函数中:
cache_key = f"list:{skip}:{limit}:{search or ''}:{status_filter or ''}:..."
if limit == 0 or skip == 0:
    cached = _get_cached_result(cache_key)
    if cached is not None:
        return {**cached, "skip": skip, "limit": limit}
```

**差异**: 库存API有内存缓存机制，订单API没有

---

## 2.4 列表查询API - 搜索处理

### reagent_orders.py (第154-204行)
```python
if search:
    if fuzzy:
        # 模糊搜索：标准化搜索词
        search_normalized = search.strip().replace(" ", "").replace("-", "").replace("_", "")

        from sqlmodel import func as sql_func

        def norm_field(field):
            f = sql_func.replace(field, '-', '')
            f = sql_func.replace(f, ' ', '')
            f = sql_func.replace(f, '\u00A0', '')
            f = sql_func.replace(f, '\u2002', '')
            f = sql_func.replace(f, '\u2003', '')
            f = sql_func.replace(f, '\u2009', '')
            f = sql_func.replace(f, '\u200C', '')
            f = sql_func.replace(f, '\u200D', '')
            f = sql_func.replace(f, '_', '')
            return f

        base = base.where(
            (norm_field(ReagentOrder.cas_number).ilike(f"%{search_normalized}%")) |
            (norm_field(ReagentOrder.name).ilike(f"%{search_normalized}%")) |
            (norm_field(ReagentOrder.brand).ilike(f"%{search_normalized}%")) |
            (norm_field(ReagentOrder.category).ilike(f"%{search_normalized}%"))
        )
    else:
        # 精确搜索
        search_pattern = f"%{search}%"
        if search_field and search_field != 'all':
            field_map = {
                'name': ReagentOrder.name,
                'cas_number': ReagentOrder.cas_number,
                'brand': ReagentOrder.brand,
                'category': ReagentOrder.category,
            }
            if search_field in field_map:
                base = base.where(field_map[search_field].ilike(search_pattern))
            else:
                base = base.where(
                    (ReagentOrder.name.ilike(search_pattern)) |
                    (ReagentOrder.cas_number.ilike(search_pattern)) |
                    (ReagentOrder.brand.ilike(search_pattern)) |
                    (ReagentOrder.category.ilike(search_pattern))
                )
        else:
            base = base.where(
                (ReagentOrder.name.ilike(search_pattern)) |
                (ReagentOrder.cas_number.ilike(search_pattern)) |
                (ReagentOrder.brand.ilike(search_pattern)) |
                (ReagentOrder.category.ilike(search_pattern))
            )
```

### inventory.py (第640-700行)
```python
if search:
    # 模糊搜索：移除空格和连字符后进行标准化匹配
    if fuzzy:
        search_normalized = normalize_search_term(search.strip())
        
        from sqlmodel import func as sql_func
        
        def norm_field(field):
            f = sql_func.replace(field, '-', '')
            f = sql_func.replace(f, ' ', '')
            f = sql_func.replace(f, '\u00A0', '')
            f = sql_func.replace(f, '\u2002', '')
            f = sql_func.replace(f, '\u2003', '')
            f = sql_func.replace(f, '\u2009', '')
            f = sql_func.replace(f, '\u200C', '')
            f = sql_func.replace(f, '\u200D', '')
            f = sql_func.replace(f, '_', '')
            return f
        
        base = base.where(
            (norm_field(Inventory.cas_number).ilike(f"%{search_normalized}%")) |
            (norm_field(Inventory.name).ilike(f"%{search_normalized}%")) |
            (norm_field(Inventory.storage_location).ilike(f"%{search_normalized}%")) |
            (norm_field(Inventory.brand).ilike(f"%{search_normalized}%")) |
            (norm_field(Inventory.category).ilike(f"%{search_normalized}%"))
        )
    else:
        # 精确搜索
        search_pattern = f"%{search}%"
        if search_field and search_field != 'all':
            field_map = {
                'name': Inventory.name,
                'cas_number': Inventory.cas_number,
                'storage_location': Inventory.storage_location,
                'brand': Inventory.brand,
                'category': Inventory.category,
            }
            # ... 类似逻辑
```

**对比分析 - 搜索逻辑差异**:

| 项目 | reagent_orders | inventory | 差异 |
|------|---------------|-----------|------|
| 模糊搜索实现 | SQL REPLACE函数 | SQL REPLACE函数 | 一致 |
| 搜索字段 | name/cas_number/brand/category | + storage_location | 库存多了位置 |
| 标准化逻辑 | 相同 | 相同(定义了normalize_search_term函数) | 一致 |

---

## 2.5 列表查询API - 排序处理

### reagent_orders.py (第209-230行)
```python
sort_field_map = {
    'cas_number': ReagentOrder.cas_number,
    'name': ReagentOrder.name,
    'category': ReagentOrder.category,
    'brand': ReagentOrder.brand,
    'quantity': ReagentOrder.quantity,
    'price': ReagentOrder.price,
    'status': ReagentOrder.status,
    'order_reason': ReagentOrder.order_reason,
    'created_at': ReagentOrder.created_at,
    'updated_at': ReagentOrder.updated_at,
}

order_direction = sort_order.lower() if sort_order else 'Desc'
order_column = sort_field_map.get(sort_by, ReagentOrder.created_at)

if order_direction == 'asc':
    order_expr = order_column.asc()
else:
    order_expr = order_column.desc()

secondary_order = ReagentOrder.created_at.desc()
```

### inventory.py (第704-759行)
```python
# 支持的排序字段映射
# 使用 CASE 表达式处理 initial_quantity 为 0 的情况
from sqlmodel import case as sql_case

remaining_percent_expr = sql_case(
    (Inventory.initial_quantity > 0, Inventory.remaining_quantity * 1.0 / Inventory.initial_quantity),
    else_=0
)

# 拼音排序字段映射（使用数据库索引加速排序）
pinyin_sort_field_map = {
    'name': Inventory.name_pinyin,
    'category': Inventory.category_pinyin,
    'brand': Inventory.brand_pinyin,
    'alias': Inventory.alias_pinyin,
}

sort_field_map = {
    'cas_number': Inventory.cas_number,
    'name': Inventory.name,
    'category': Inventory.category,
    'storage_location': Inventory.storage_location,
    'brand': Inventory.brand,
    'remaining_quantity': Inventory.remaining_quantity,
    'remaining_percent': remaining_percent_expr,
    'initial_quantity': Inventory.initial_quantity,
    'status': Inventory.status,
    'created_at': Inventory.created_at,
    'updated_at': Inventory.updated_at,
}

# 中文拼音排序字段列表
pinyin_sort_fields = {'name', 'category', 'brand', 'alias'}

# 判断是否需要使用拼音排序
use_pinyin_sort = sort_by in pinyin_sort_fields

if use_pinyin_sort:
    # 使用数据库索引排序（高效）
    order_column = pinyin_sort_field_map.get(sort_by)
else:
    order_column = sort_field_map.get(sort_by, Inventory.created_at)

secondary_order = Inventory.created_at.desc()
```

**对比分析 - 排序差异**:

| 项目 | reagent_orders | inventory | 差异 |
|------|---------------|-----------|------|
| 排序字段数 | 10个 | 12个 | 库存多了 |
| quantity | ✅ | ❌ 无 | 订单特有 |
| price | ✅ | ❌ 无 | 订单特有 |
| order_reason | ✅ | ❌ 无 | 订单特有 |
| storage_location | ❌ 无 | ✅ | 库存特有 |
| remaining_quantity | ❌ 无 | ✅ | 库存特有 |
| remaining_percent | ❌ 无 | ✅ (计算字段) | 库存特有 |
| 拼音排序 | ❌ 无 | ✅ 支持 | 库存特有 |
| 次级排序 | created_at desc | created_at desc | 一致 |

---

## 2.6 列表查询API - 用户名字段处理

### reagent_orders.py (第234-239行)
```python
# Enrich with applicant names
applicant_ids = {o.applicant_id for o in orders if o.applicant_id}
users_map: dict[int, str] = {}
if applicant_ids:
    users = db.exec(select(User).where(User.id.in_(applicant_ids))).all()
    users_map = {u.id: u.full_name or u.username for u in users}

return {
    "data": [
        {**ReagentOrderResponse.model_validate(o).model_dump(), "applicant_name": users_map.get(o.applicant_id, "")}
        for o in orders
    ],
    "total": total,
    "skip": skip,
    "limit": limit,
}
```

### inventory.py (第767-797行)
```python
# ================= 性能优化核心：批量查询用户（消除 N+1） =================
user_ids = set()
for item in items:
    if item.borrower_id:
        user_ids.add(item.borrower_id)
    if item.last_borrower_id:
        user_ids.add(item.last_borrower_id)
    if item.created_by_id:
        user_ids.add(item.created_by_id)

users_map = {}
if user_ids:
    users = db.exec(select(User).where(User.id.in_(user_ids))).all()
    users_map = {u.id: (u.full_name or u.username) for u in users}

result_data = []
for item in items:
    item_dict = InventoryResponse.model_validate(item).model_dump()
    item_dict = _add_specification(item_dict)
    item_dict["borrower_name"] = users_map.get(item.borrower_id)
    item_dict["last_borrower_name"] = users_map.get(item.last_borrower_id)
    item_dict["created_by_name"] = users_map.get(item.created_by_id)
    result_data.append(item_dict)
```

**对比分析 - 用户名处理差异**:

| 项目 | reagent_orders | inventory | 差异 |
|------|---------------|-----------|------|
| 查询用户IDs | applicant_id | borrower_id/last_borrower_id/created_by_id | 库存3个 |
| 附加字段 | applicant_name | borrower_name/last_borrower_name/created_by_name | 库存3个 |
| 批量查询 | ✅ | ✅ | 一致 |

---

## 2.7 列表查询API - 分页逻辑

### reagent_orders.py (第232行)
```python
orders = db.exec(base.order_by(order_expr, secondary_order).offset(skip).limit(limit)).all()
```

### inventory.py (第762-765行)
```python
if limit > 0:
    items = db.exec(base.order_by(order_expr, secondary_order).offset(skip).limit(limit)).all()
else:
    items = db.exec(base.order_by(order_expr, secondary_order)).all()
```

**差异**: inventory.py 有特殊逻辑，当limit=0时不分页返回全部数据

---

# 第三部分：前端页面对比

## 3.1 组件导入对比

### ReagentOrders.tsx (第1-59行)
```typescript
import React, { useState, useEffect, useMemo, useCallback, useRef, startTransition } from 'react'
import {
  createColumnHelper,
  getCoreRowModel,
  getExpandedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import type { SortingState, ColumnSizingState, RowData, Table } from '@tanstack/react-table'
import { useInfiniteQuery, keepPreviousData, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { valibotResolver } from '@hookform/resolvers/valibot'

// UI 组件
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Checkbox } from '@/components/ui/Checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { HazardousIcon } from '@/components/ui/HazardousIcon'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { DataTable } from '@/components/ui/DataTable'
import { MoleculeStructure } from '@/components/ui/MoleculeStructure'
import { toast } from '@/components/ui/Toast'

// 业务组件
import { BaseForm } from '@/components/BaseForm'
import useDialogState from '@/hooks/useDialogState'
import { useAuthStore } from '@/store/useStore'

// 工具与API
import { reagentOrderAPI } from '@/api/client'
import { formatDate, cn } from '@/lib/utils'
import { ReagentOrderSchema } from '@/lib/validationSchemas'
import type { ReagentOrderFormData } from '@/lib/validationSchemas'
import { 
  getReagentOrderFormFields, 
  defaultReagentOrderValues 
} from '@/lib/formConfigs'

// 图标
import {
  Search,
  Loader2,
  X,
  Plus,
  Pencil,
  FlaskConical,
  AlertTriangle,
  ChevronsDownUp,
  ChevronsUpDown,
  ArrowUpFromLine,
} from 'lucide-react'
```

### Inventory.tsx (第1-55行)
```typescript
import React, { useState, useEffect, useMemo, useCallback, useRef, startTransition } from 'react'
import {
  createColumnHelper,
  getCoreRowModel,
  getExpandedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import type { SortingState, ColumnSizingState, RowData, Table } from '@tanstack/react-table'
import { useInfiniteQuery, keepPreviousData, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { valibotResolver } from '@hookform/resolvers/valibot'

// UI 组件
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Checkbox } from '@/components/ui/Checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { HazardousIcon } from '@/components/ui/HazardousIcon'
import { QuantityIndicator } from '@/components/ui/QuantityIndicator'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { DataTable } from '@/components/ui/DataTable'
import { MoleculeStructure } from '@/components/ui/MoleculeStructure'
import { toast } from '@/components/ui/Toast'

// 业务组件
import { BaseForm } from '@/components/BaseForm'
import useDialogState from '@/hooks/useDialogState'

// 工具与API
import { inventoryAPI } from '@/api/client'
import { formatDate, cn } from '@/lib/utils'
import { InventoryFormSchema, parseSpecification } from '@/lib/validationSchemas'
import type { InventoryFormData } from '@/lib/validationSchemas'

// 图标
import {
  Search,
  Package,
  Loader2,
  ArrowUpFromLine,
  ChevronsDownUp,
  ChevronsUpDown,
  Plus,
  X,
  Pencil,
  Trash2,
  AlertTriangle,
} from 'lucide-react'
```

**对比分析 - 导入差异**:

| 项目 | ReagentOrders.tsx | Inventory.tsx | 差异 |
|------|-------------------|----------------|------|
| React Hooks | 相同 | 相同 | 一致 |
| TanStack Table | 相同 | 相同 | 一致 |
| React Query | 相同 | 相同 | 一致 |
| 表单 | useForm | useForm | 一致 |
| API导入 | reagentOrderAPI | inventoryAPI | 不同 |
| 表单Schema | ReagentOrderSchema | InventoryFormSchema | 不同 |
| 验证Schema | ReagentOrderFormData | InventoryFormData | 不同 |
| 表单配置 | getReagentOrderFormFields | getInventoryFormFields | 不同 |
| useAuthStore | ✅ | ❌ 无 | 订单需要权限 |
| QuantityIndicator | ❌ 无 | ✅ | 库存特有 |
| 图标 | FlaskConical | Package | 不同 |

---

## 3.2 接口类型定义

### ReagentOrders.tsx (第75-95行)
```typescript
interface ReagentOrder {
  id: number
  cas_number: string
  name: string
  english_name: string | null
  alias: string | null
  category: string | null
  brand: string | null
  specification: string
  quantity: number
  price: number | null
  order_reason: string
  is_hazardous: boolean
  image_path: string | null
  notes: string | null
  applicant_id: number | null
  applicant_name: string | null
  status: string
  created_at: string
  updated_at: string
}
```

### Inventory.tsx (第75-98行)
```typescript
interface InventoryItem {
  id: number
  cas_number: string
  name: string
  english_name: string | null
  alias: string | null
  category: string | null
  brand: string | null
  storage_location: string | null
  initial_quantity: number
  remaining_quantity: number
  unit: string
  status: string
  is_hazardous: boolean
  created_at: string
  notes: string | null
  specification?: string
  created_by_id?: number | null
  created_by_name?: string | null
  borrower_id?: number | null
  borrower_name?: string | null
  last_borrower_id?: number | null
  last_borrower_name?: string | null
}
```

**对比分析 - 接口差异**:

| 字段 | ReagentOrder | InventoryItem | 差异 |
|------|--------------|---------------|------|
| id | ✅ | ✅ | 一致 |
| cas_number | ✅ | ✅ | 一致 |
| name | ✅ | ✅ | 一致 |
| english_name | ✅ | ✅ | 一致 |
| alias | ✅ | ✅ | 一致 |
| category | ✅ | ✅ | 一致 |
| brand | ✅ | ✅ | 一致 |
| specification | ✅ | ✅ (可选) | 库存可选 |
| storage_location | ❌ 无 | ✅ | 库存特有 |
| quantity | ✅ | ❌ 无 | 订单特有 |
| initial_quantity | ❌ 无 | ✅ | 库存特有 |
| remaining_quantity | ❌ 无 | ✅ | 库存特有 |
| unit | ❌ 无 | ✅ | 库存特有 |
| price | ✅ | ❌ 无 | 订单特有 |
| order_reason | ✅ | ❌ 无 | 订单特有 |
| is_hazardous | ✅ | ✅ | 一致 |
| image_path | ✅ | ❌ 无 | 订单有 |
| notes | ✅ | ✅ | 一致 |
| applicant_id | ✅ | ❌ 无 | 订单特有 |
| applicant_name | ✅ | ❌ 无 | 订单特有 |
| created_by_id | ❌ 无 | ✅ | 库存特有 |
| created_by_name | ❌ 无 | ✅ | 库存特有 |
| borrower_id | ❌ 无 | ✅ | 库存特有 |
| borrower_name | ❌ 无 | ✅ | 库存特有 |
| last_borrower_id | ❌ 无 | ✅ | 库存特有 |
| last_borrower_name | ❌ 无 | ✅ | 库存特有 |
| status | ✅ | ✅ | 一致 |
| created_at | ✅ | ✅ | 一致 |
| updated_at | ✅ | ❌ 无 | 订单有 |

---

## 3.3 表格状态定义

### ReagentOrders.tsx (第144-198行)
```typescript
export function ReagentOrdersPage() {
  const queryClient = useQueryClient()
  const currentUser = useAuthStore((state) => state.user)
  const isAdmin = currentUser?.role === 'admin'

  // 表格状态
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('reagent-orders-table-col-sizes') || '{}')
      const filtered: ColumnSizingState = {}
      for (const [key, size] of Object.entries(saved)) {
        if (typeof size === 'number' && size > 0) {
          filtered[key] = size
        }
      }
      return Object.keys(filtered).length > 0 ? filtered : {}
    } catch { return {} }
  })
  const [isAllExpanded, setIsAllExpanded] = useState<boolean>(() => {
    return localStorage.getItem('reagent-orders-table-expand-all') === 'expanded'
  })
  
  // 搜索过滤状态
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [searchField, setSearchField] = useState('all')
  const [fuzzySearch, setFuzzySearch] = useState(false)
  const sortingRef = useRef<SortingState>([])

  // 总数统计
  const [grandTotal, setGrandTotal] = useState(0)
  const grandTotalRef = useRef(0)

  // 防抖搜索
  useEffect(() => {
    const timer = setTimeout(() => {
      if (globalFilter !== searchInput) {
        setIsAllExpanded(false)
        if (tableRef.current) tableRef.current.resetExpanded()
        setGlobalFilter(searchInput)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [searchInput, globalFilter])
```

### Inventory.tsx (第195-290行)
```typescript
export function InventoryPage() {
  const queryClient = useQueryClient()

  const [sorting, setSorting] = useState<SortingState>([])
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(() => {
    try { return JSON.parse(localStorage.getItem('inventory-table-col-sizes') || '{}') } catch { return {} }
  })
  const [isAllExpanded, setIsAllExpanded] = useState<boolean>(() => {
    return localStorage.getItem('inventory-table-expand-all') === 'expanded'
  })

  // 优化 1：使用节流/防抖降低 localStorage 写入频率
  useEffect(() => {
    const timer = setTimeout(() => {
      localStorage.setItem('inventory-table-col-sizes', JSON.stringify(columnSizing))
    }, 500)
    return () => clearTimeout(timer)
  }, [columnSizing])

  const toggleExpandAll = useCallback(() => setIsAllExpanded(prev => !prev), [])

  const sortingRef = useRef<SortingState>([])

  // 优化 2：分离输入框状态与接口查询状态，防抖 300ms 避免网络请求风暴
  const [searchInput, setSearchInput] = useState('')
  const [globalFilter, setGlobalFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [searchField, setSearchField] = useState('all')
  const [fuzzySearch, setFuzzySearch] = useState(false)
```

**对比分析 - 状态定义差异**:

| 项目 | ReagentOrders | Inventory | 差异 |
|------|--------------|-----------|------|
| queryClient | ✅ | ✅ | 一致 |
| useAuthStore | ✅ | ❌ 无 | 订单需要 |
| isAdmin | ✅ | ❌ 无 | 订单需要 |
| sorting | ✅ | ✅ | 一致 |
| columnSizing | ✅ (带过滤) | ✅ | 基本一致 |
| isAllExpanded | ✅ | ✅ | 一致 |
| globalFilter | ✅ | ✅ | 一致 |
| searchInput | ✅ | ✅ | 一致 |
| statusFilter | ✅ | ✅ | 一致 |
| searchField | ✅ | ✅ | 一致 |
| fuzzySearch | ✅ | ✅ | 一致 |
| sortingRef | ✅ | ✅ | 一致 |
| grandTotal | ✅ | ✅ | 一致 |
| 防抖时间 | 300ms | 300ms | 一致 |
| localStorage key | reagent-orders-* | inventory-* | 不同 |

---

## 3.4 Query函数对比

### ReagentOrders.tsx (第249-268行)
```typescript
const queryFn = useCallback(async ({ pageParam = 0 }: { pageParam: number }) => {
  const currentSorting = sorting.length > 0 ? sorting : sortingRef.current
  const sort = currentSorting[0]

  const params: Record<string, unknown> = { skip: pageParam, limit: 50 }

  if (statusFilter !== 'all') params.status_filter = statusFilter
  if (globalFilter) {
    params.search = globalFilter
    if (searchField !== 'all') params.search_field = searchField
    if (fuzzySearch) params.fuzzy = true
  }
  if (sort) {
    params.sort_by = sort.id
    params.sort_order = sort.desc ? 'desc' : 'asc'
  }

  const response = await reagentOrderAPI.list(params as any)
  return response.data
}, [statusFilter, globalFilter, searchField, fuzzySearch, sorting])
```

### Inventory.tsx (第239-258行)
```typescript
const queryFn = useCallback(async ({ pageParam = 0 }: { pageParam: number }) => {
  const currentSorting = sorting.length > 0 ? sorting : sortingRef.current
  const sort = currentSorting[0]

  const params: Record<string, unknown> = { skip: pageParam, limit: 50 }

  if (statusFilter !== 'all') params.status_filter = statusFilter
  if (globalFilter) {
    params.search = globalFilter
    if (searchField !== 'all') params.search_field = searchField
    if (fuzzySearch) params.fuzzy = true
  }
  if (sort) {
    params.sort_by = sort.id
    params.sort_order = sort.desc ? 'desc' : 'asc'
  }

  const response = await inventoryAPI.list(params as any)
  return response.data
}, [statusFilter, globalFilter, searchField, fuzzySearch, sorting])
```

**对比分析 - queryFn差异**:

| 项目 | ReagentOrders | Inventory | 差异 |
|------|--------------|-----------|------|
| pageParam默认值 | 0 | 0 | 一致 |
| 分页参数 | skip: pageParam, limit: 50 | skip: pageParam, limit: 50 | 一致 |
| status_filter | ✅ | ✅ | 一致 |
| search | ✅ | ✅ | 一致 |
| search_field | ✅ | ✅ | 一致 |
| fuzzy | ✅ | ✅ | 一致 |
| sort_by | ✅ | ✅ | 一致 |
| sort_order | ✅ | ✅ | 一致 |
| API调用 | reagentOrderAPI.list | inventoryAPI.list | 不同 |

---

## 3.5 useInfiniteQuery配置对比

### ReagentOrders.tsx (第270-286行)
```typescript
const {
  data: allData,
  isLoading,
  isFetchingNextPage,
  hasNextPage,
  fetchNextPage,
} = useInfiniteQuery({
  queryKey: ['reagent-orders', statusFilter, globalFilter, searchField, fuzzySearch, sorting],
  queryFn,
  initialPageParam: 0,
  getNextPageParam: (lastPage, allPages) => {
    const currentLoadedCount = allPages.reduce((acc, page) => acc + page.data.length, 0)
    if (currentLoadedCount < (lastPage.total || 0)) return currentLoadedCount
    return null
  },
  placeholderData: keepPreviousData,
})
```

### Inventory.tsx (第260-277行)
```typescript
const {
  data: allData,
  isLoading,
  isFetchingNextPage,
  hasNextPage,
  fetchNextPage,
} = useInfiniteQuery({
  queryKey: ['inventory', statusFilter, globalFilter, searchField, fuzzySearch, sorting],
  queryFn,
  initialPageParam: 0,
  getNextPageParam: (lastPage, allPages) => {
    const currentLoadedCount = allPages.reduce((acc, page) => acc + page.data.length, 0)
    if (currentLoadedCount < (lastPage.total || 0)) return currentLoadedCount
    return null
  },
  placeholderData: keepPreviousData,
  refetchInterval: 10000,
})
```

**对比分析 - useInfiniteQuery差异**:

| 项目 | ReagentOrders | Inventory | 差异 |
|------|--------------|-----------|------|
| queryKey | reagent-orders | inventory | 不同 |
| queryFn | ✅ | ✅ | 一致 |
| initialPageParam | 0 | 0 | 一致 |
| getNextPageParam | 相同逻辑 | 相同逻辑 | 一致 |
| placeholderData | keepPreviousData | keepPreviousData | 一致 |
| refetchInterval | ❌ 无 | 10000 (10秒) | **库存特有** |

---

## 3.6 表格列定义对比

### ReagentOrders.tsx (第474-583行)
```typescript
const columns = useMemo(() => [
  columnHelper.accessor('cas_number', {
    header: 'CAS号', size: 120, minSize: 100, maxSize: 200,
    cell: info => (/* 高亮组件 */),
  }),
  columnHelper.accessor('name', {
    header: '名称', size: 250, minSize: 200, maxSize: 500,
    cell: info => (/* 名称+危险品图标+高亮 */),
  }),
  columnHelper.accessor('specification', {
    header: '规格', size: 120, minSize: 100, maxSize: 200,
    cell: info => <span className="break-all">{info.getValue()}</span>,
  }),
  columnHelper.accessor('quantity', {
    header: '数量', size: 80, minSize: 60, maxSize: 100,
    cell: info => <span>×{info.getValue()}</span>,
  }),
  columnHelper.accessor('price', {
    header: '价格', size: 100, minSize: 80, maxSize: 150,
    cell: info => info.getValue() ? `¥${info.getValue()}` : '-',
  }),
  columnHelper.accessor('applicant_name', {
    header: '申请人', size: 100, minSize: 80, maxSize: 150,
    cell: info => info.getValue() || '-',
  }),
  columnHelper.accessor('status', {
    header: '状态', size: 100, minSize: 80, maxSize: 120,
    cell: info => <StatusBadge status={info.getValue()} />,
  }),
  columnHelper.display({
    id: 'actions', header: '操作', size: 200, minSize: 180, maxSize: 300,
    cell: info => (/* 审批/驳回/确认到货/一键入库按钮 */),
  }),
], [isAdmin, handleEditClick, handleApprove, handleReject, handleConfirmArrival, handleStockIn])
```

### Inventory.tsx (第478-570行)
```typescript
const columns = useMemo(() => [
  columnHelper.accessor('cas_number', {
    header: 'CAS号', size: 120, minSize: 100, maxSize: 200,
    cell: info => (/* 高亮组件 */),
  }),
  columnHelper.accessor('name', {
    header: '名称', size: 250, minSize: 200, maxSize: 500,
    cell: info => (/* 名称+危险品图标+高亮 */),
  }),
  columnHelper.accessor('category', {
    header: '分类', size: 100, minSize: 80, maxSize: 150,
    cell: info => (/* 高亮组件 */),
  }),
  columnHelper.accessor('storage_location', {
    id: 'storage_location', header: '位置', size: 100, minSize: 80, maxSize: 150,
    sortDescFirst: false, sortingFn: 'text',
    cell: info => (/* 高亮组件 */),
  }),
  columnHelper.accessor('brand', {
    header: '品牌', size: 100, minSize: 80, maxSize: 150,
    cell: info => (/* 高亮组件 */),
  }),
  columnHelper.accessor('remaining_quantity', {
    id: 'remaining_percent', header: '剩余/规格', size: 140, minSize: 120, maxSize: 200,
    cell: info => (
      <QuantityIndicator
        remaining={info.getValue()}
        initial={info.row.original.initial_quantity}
        unit={info.row.original.unit}
      />
    ),
  }),
  columnHelper.accessor('status', {
    header: '状态', size: 80, minSize: 80, maxSize: 120,
    cell: info => <StatusBadge status={info.getValue()} />,
  }),
  columnHelper.display({
    id: 'actions', header: '操作', size: 100, minSize: 100, maxSize: 150,
    cell: info => (/* 编辑/借用按钮 */),
  }),
], [])
```

**对比分析 - 表格列差异**:

| 列 | ReagentOrders | Inventory | 差异 |
|----|--------------|-----------|------|
| cas_number | ✅ | ✅ | 一致 |
| name | ✅ | ✅ | 一致 |
| category | ❌ 无 | ✅ | 库存特有 |
| specification | ✅ | ❌ 无 | 订单特有 |
| storage_location | ❌ 无 | ✅ | 库存特有 |
| brand | ❌ 无 | ✅ | 库存特有 |
| quantity | ✅ | ❌ 无 | 订单特有 |
| remaining_quantity | ❌ 无 | ✅ (remaining_percent) | 库存特有 |
| price | ✅ | ❌ 无 | 订单特有 |
| applicant_name | ✅ | ❌ 无 | 订单特有 |
| status | ✅ | ✅ | 一致 |
| actions | 审批/驳回/到货/入库 | 编辑/借用 | 不同业务 |

---

## 3.7 搜索UI对比

### ReagentOrders.tsx (第638-692行)
```typescript
<div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
  {/* 搜索输入框 */}
  <div className="relative flex-1 min-w-50">
    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
    <Input
      placeholder="搜索试剂名称、CAS号..."
      value={searchInput}
      onChange={(e) => setSearchInput(e.target.value)}
      className="pl-9 pr-8 text-base w-full inline-flex leading-none"
    />
    {/* 清除按钮 */}
    {searchInput && (
      <button onClick={() => setSearchInput('')}>...</button>
    )}
  </div>
  
  {/* 模糊搜索复选框 */}
  <label className="flex items-center gap-2 text-base cursor-pointer whitespace-nowrap">
    <Checkbox checked={fuzzySearch} onCheckedChange={(checked) => { ... }} />
    <span className="text-base pr-2">模糊搜索</span>
  </label>
  
  {/* 搜索字段选择 */}
  <Select value={searchField} onValueChange={...}>
    <SelectTrigger className="w-30 min-h-10"><SelectValue placeholder="全部" /></SelectTrigger>
    <SelectContent>
      <SelectItem value="all">全部</SelectItem>
      <SelectItem value="name">名称</SelectItem>
      <SelectItem value="cas_number">CAS号</SelectItem>
      <SelectItem value="brand">品牌</SelectItem>
      <SelectItem value="category">分类</SelectItem>
    </SelectContent>
  </Select>
  
  {/* 状态过滤 */}
  <Select value={statusFilter} onValueChange={...}>
    <SelectTrigger className="w-30 min-h-10"><SelectValue placeholder="全部状态" /></SelectTrigger>
    <SelectContent>
      <SelectItem value="all">全部状态</SelectItem>
      <SelectItem value="pending">待审批</SelectItem>
      <SelectItem value="approved">已审批</SelectItem>
      <SelectItem value="arrived">已到货</SelectItem>
      <SelectItem value="stocked">已入库</SelectItem>
      <SelectItem value="rejected">已驳回</SelectItem>
    </SelectContent>
  </Select>
</div>
```

### Inventory.tsx (第625-678行)
```typescript
<div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
  {/* 搜索输入框 - 相同结构 */}
  <div className="relative flex-1 min-w-50">
    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
    <Input
      placeholder="搜索名称、CAS号、位置..."
      value={searchInput}
      onChange={(e) => setSearchInput(e.target.value)}
      ...
    />
  </div>
  
  {/* 模糊搜索复选框 - 相同 */}
  <label className="flex items-center gap-2 text-base cursor-pointer whitespace-nowrap">
    <Checkbox checked={fuzzySearch} onCheckedChange={...} />
    <span className="text-base pr-2">模糊搜索</span>
  </label>
  
  {/* 搜索字段选择 - 多了storage_location */}
  <Select value={searchField} onValueChange={...}>
    <SelectTrigger className="w-30 min-h-10"><SelectValue placeholder="全部" /></SelectTrigger>
    <SelectContent>
      <SelectItem value="all">全部</SelectItem>
      <SelectItem value="name">名称</SelectItem>
      <SelectItem value="cas_number">CAS号</SelectItem>
      <SelectItem value="storage_location">位置</SelectItem>
      <SelectItem value="brand">品牌</SelectItem>
      <SelectItem value="category">分类</SelectItem>
    </SelectContent>
  </Select>
  
  {/* 状态过滤 - 不同状态值 */}
  <Select value={statusFilter} onValueChange={...}>
    <SelectTrigger className="w-30 min-h-10"><SelectValue placeholder="全部状态" /></SelectTrigger>
    <SelectContent>
      <SelectItem value="all">全部状态</SelectItem>
      <SelectItem value="in_stock">在库</SelectItem>
      <SelectItem value="borrowed">借出</SelectItem>
      <SelectItem value="consumed">已用完</SelectItem>
    </SelectContent>
  </Select>
</div>
```

**对比分析 - 搜索UI差异**:

| 项目 | ReagentOrders | Inventory | 差异 |
|------|--------------|-----------|------|
| 搜索输入框 | 试剂名称、CAS号 | 名称、CAS号、位置 | 库存多了位置 |
| 模糊搜索 | ✅ | ✅ | 一致 |
| 搜索字段 | name/cas_number/brand/category | + storage_location | 库存多了 |
| 状态过滤 | pending/approved/arrived/stocked/rejected | in_stock/borrowed/consumed | 不同枚举 |

---

## 3.8 表单配置对比

### ReagentOrders.tsx - 使用 getReagentOrderFormFields
```typescript
import { getReagentOrderFormFields, defaultReagentOrderValues } from '@/lib/formConfigs'
// 表单字段配置来自 formConfigs.tsx
```

### Inventory.tsx - 使用 getInventoryFormFields (第122-158行)
```typescript
const getInventoryFormFields = (isEdit: boolean, initialQuantity?: number) => {
  // 编辑模式下显示：剩余量 + 规格（只读）；添加模式下显示：瓶数 + 规格
  const quantityFields = isEdit && initialQuantity !== undefined
    ? [
        { name: 'remaining_quantity' as const, label: '剩余量', type: 'input' as const, required: true, placeholder: '如: 100' },
        { name: 'specification' as const, label: '规格', type: 'input' as const, placeholder: '如: 500ml' }
      ]
    : [
        { name: 'quantity_bottles' as const, label: '瓶数', type: 'input' as const, required: true, placeholder: '如: 1' },
        { name: 'specification' as const, label: '规格', type: 'input' as const, required: true, placeholder: '如: 500ml' }
      ]

  return [
    { name: 'name' as const, label: '试剂名称', type: 'input' as const, required: true, colSpan: 2, placeholder: '如: 乙醇' },
    { name: 'cas_number' as const, label: 'CAS号', type: 'input' as const, required: !isEdit, readOnly: isEdit, placeholder: '如: 64-17-5' },
    { name: 'english_name' as const, label: '英文名称', type: 'input' as const, colSpan: 2, placeholder: '如: Ethanol' },
    { name: 'alias' as const, label: '别名', type: 'input' as const, placeholder: '如: 酒精' },
    { name: 'storage_location' as const, label: '存放位置', type: 'input' as const, placeholder: '如: A-1-1 柜' },
    ...quantityFields,
    { name: 'brand' as const, label: '品牌', type: 'input' as const, placeholder: '如: Sigma' },
    { name: 'category' as const, label: '分类', type: 'input' as const, placeholder: '如: 有机试剂' },
    {
      name: 'is_hazardous' as const,
      label: '危险品',
      type: 'checkbox' as const,
      checkboxLabel: (/* 危险品复选框 */)
    },
    { name: 'notes' as const, label: '备注', type: 'input' as const, colSpan: 3, placeholder: '其他说明...' },
  ]
}
```

---

# 第四部分：API客户端对比

## 4.1 reagentOrderAPI (client.ts:107-142)
```typescript
export const reagentOrderAPI = {
  list: (params?: PaginationParams & {
    status_filter?: string
    search?: string
    search_field?: string
    fuzzy?: boolean
    sort_by?: string
    sort_order?: string
  }) => api.get('/reagent-orders', { params }),
  get: (id: number) => api.get(`/reagent-orders/${id}`),
  create: (data: {...}) => api.post('/reagent-orders', data),
  update: (id: number, data: Record<string, unknown>) => api.put(`/reagent-orders/${id}`, data),
  delete: (id: number) => api.delete(`/reagent-orders/${id}`),
  approve: (id: number) => api.post(`/reagent-orders/${id}/approve`),
  reject: (id: number, reason: string) => api.post(`/reagent-orders/${id}/reject`, { reason }),
  confirmArrival: (id: number, notes?: string) => api.post(`/reagent-orders/${id}/confirm-arrival`, { arrival_notes: notes }),
  stockIn: (id: number) => api.post(`/reagent-orders/${id}/stock-in`),
  getMyOrders: () => api.get('/reagent-orders/dashboard/my-orders'),
  getArrivedOrders: () => api.get('/reagent-orders/dashboard/arrived-orders'),
  exportOrders: () => api.get('/reagent-orders/export', { responseType: 'blob' }),
}
```

## 4.2 inventoryAPI (client.ts:172-205)
```typescript
export const inventoryAPI = {
  list: (params?: PaginationParams & { 
    status_filter?: string; 
    cas_filter?: string; 
    hazardous_only?: boolean 
  }) => api.get('/inventory', { params }),
  get: (id: number) => api.get(`/inventory/${id}`),
  getByCode: (code: string) => api.get(`/inventory/code/${code}`),
  checkCAS: (casNumber: string) => api.get(`/inventory/cas/${casNumber}`),
  borrow: (id: number) => api.post(`/inventory/${id}/borrow`),
  return: (id: number, data: { remaining_quantity: number; unit?: string }) =>
    api.post(`/inventory/${id}/return`, data),
  update: (id: number, data: Record<string, unknown>) => api.put(`/inventory/${id}`, data),
  delete: (id: number) => api.delete(`/inventory/${id}`),
  getMyBorrows: () => api.get('/inventory/dashboard/my-borrows'),
  getPendingStockin: () => api.get('/inventory/dashboard/pending-stockin'),
  getBorrowHistory: (id: number) => api.get(`/inventory/${id}/borrow-history`),
  getImportTemplate: () => api.get('/inventory/import/template'),
  importExcel: (file: FormData) => api.post('/inventory/import', file, {...}),
  manualAdd: (data: {...}) => api.post('/inventory/manual-add', data),
  exportInventory: () => api.get('/inventory/export', { responseType: 'blob' }),
}
```

**对比分析 - API客户端差异**:

| 方法 | reagentOrderAPI | inventoryAPI | 差异 |
|------|---------------|--------------|------|
| list | ✅ 基本参数 | ✅ + cas_filter/hazardous_only | 库存多参数 |
| get | ✅ | ✅ | 一致 |
| create | ✅ create | manualAdd | 不同 |
| update | ✅ | ✅ | 一致 |
| delete | ✅ | ✅ | 一致 |
| approve | ✅ | ❌ 无 | 订单特有 |
| reject | ✅ | ❌ 无 | 订单特有 |
| confirmArrival | ✅ | ❌ 无 | 订单特有 |
| stockIn | ✅ | ❌ 无 | 订单特有 |
| getMyOrders | ✅ | getMyBorrows | 不同业务 |
| getArrivedOrders | ✅ | ❌ 无 | 订单特有 |
| getByCode | ❌ 无 | ✅ | 库存特有 |
| checkCAS | ❌ 无 | ✅ | 库存特有 |
| borrow | ❌ 无 | ✅ | 库存特有 |
| return | ❌ 无 | ✅ | 库存特有 |
| getBorrowHistory | ❌ 无 | ✅ | 库存特有 |
| getImportTemplate | ❌ 无 | ✅ | 库存特有 |
| importExcel | ❌ 无 | ✅ | 库存特有 |
| exportOrders/ExportInventory | ✅ | ✅ | 一致 |

---

# 第五部分：核心差异总结

## 5.1 不仅仅是字段不同

经过逐代码块对比，可以确认**不仅仅是字段不同**，两个系统在以下方面存在显著差异：

### 5.1.1 业务逻辑差异

| 差异点 | ReagentOrders | Inventory | 说明 |
|--------|--------------|-----------|------|
| 缓存机制 | 无 | 有 (SEARCH_CACHE, TTL=60s) | 库存有内存缓存 |
| 自动刷新 | 无 | refetchInterval=10000 | 库存每10秒刷新 |
| 拼音排序 | 无 | 有 (name_pinyin等) | 库存支持中文拼音排序 |
| 排序字段 | 10个 | 12个 + 拼音 | 库存更丰富 |
| 搜索字段 | 4个 | 5个 | 库存多了storage_location |
| 用户字段 | applicant_name | 3个用户名字段 | 库存更复杂 |
| 权限控制 | 需要current_user | 不需要 | 订单需要登录 |

### 5.1.2 数据模型差异

- 订单有: quantity, price, order_reason, applicant_id, specification
- 库存有: storage_location, remaining_quantity, internal_code, borrower_id, last_borrower_id, created_by_id, 拼音字段

### 5.1.3 UI交互差异

- 订单: 审批/驳回/确认到货/一键入库按钮
- 库存: 编辑/借用按钮 + QuantityIndicator组件
- 状态选项完全不同

### 5.1.4 并发控制差异

- 库存借用使用原子SQL更新 (inventory.py:920-956)
- 订单没有类似并发控制

---

# 第六部分：发现的问题

## 6.1 严重问题

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| 1 | inventory.py 默认 limit=0 | inventory.py:605 | 不分页，与前端50条不匹配 |
| 2 | 库存有缓存，前端不知道 | inventory.py:127-163 | 数据不一致风险 |

## 6.2 中等问题

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| 3 | 库存有自动刷新，订单没有 | Inventory.tsx:276 | 行为不一致 |
| 4 | 排序字段不同 | 后端API | 功能差异 |

---

*报告完成 - 基于代码逐块对比分析*
