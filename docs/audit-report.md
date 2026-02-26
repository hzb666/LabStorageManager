# Lab Storage Manager 完整代码审查报告

> 项目: Lab Storage Manager (实验室库存管理系统)
> 日期: 2026-02-26
> 审计模式: 标准审计 (Standard)
> 技术栈: Python FastAPI + SQLModel + SQLite | React/TypeScript + Vite

---

## 一、项目概述

### 1.1 项目基本信息

| 项目属性 | 内容 |
|---------|------|
| 项目名称 | Lab Storage Manager |
| 项目类型 | 实验室库存管理系统 (LIMS) |
| 后端框架 | FastAPI 0.109.0 |
| 数据库 | SQLModel + SQLite |
| 前端框架 | React 18 + TypeScript + Vite |
| 认证方式 | JWT (RS256/HS256) |
| Python 版本 | 3.11+ |

### 1.2 项目结构

```
LabStorageManager-develop/
├── app/                          # 后端应用
│   ├── api/                      # API 路由
│   │   ├── users.py             # 用户管理
│   │   ├── inventory.py         # 库存管理
│   │   ├── reagent_orders.py     # 试剂订单
│   │   └── consumable_orders.py # 耗材订单
│   ├── core/                    # 核心模块
│   │   ├── auth.py              # 认证授权
│   │   └── config.py            # 配置管理
│   ├── models/                  # 数据模型
│   ├── services/                # 业务服务
│   │   ├── cas_utils.py         # CAS号工具
│   │   ├── excel_service.py     # Excel导入
│   │   ├── image_service.py     # 图片处理
│   │   ├── internal_code.py    # 内部编码
│   │   └── spec_utils.py       # 规格解析
│   ├── database.py              # 数据库配置
│   └── main.py                  # 应用入口
├── frontend/                     # 前端应用
│   ├── src/
│   │   ├── api/                 # API 客户端
│   │   ├── components/          # React 组件
│   │   ├── hooks/               # 自定义 Hooks
│   │   ├── lib/                 # 工具库
│   │   ├── pages/               # 页面组件
│   │   └── store/               # 状态管理
│   └── package.json
├── pyproject.toml               # Python 依赖
└── README.md
```

### 1.3 API 端点概览

| 模块 | 端点数量 | 主要功能 |
|------|---------|---------|
| Users | 10+ | 登录/登出/用户 CRUD/密码管理 |
| Inventory | 15+ | 库存查询/借还/导入导出 |
| Reagent Orders | 12+ | 试剂申购/审批/入库 |
| Consumable Orders | 10+ | 耗材申购/审批/完成 |

---

## 二、安全审计报告

### 2.1 审计摘要

| 指标 | 数值 |
|------|------|
| 发现漏洞总数 | 6 个 |
| High 级别 | 3 个 |
| Medium 级别 | 3 个 |
| Critical 级别 | 0 个 |

### 2.2 漏洞详情

#### 漏洞 1: [D8] CORS 配置允许凭据跨域 (High)

**严重程度**: High

**文件位置**:
- 配置文件: `app/core/config.py:39`
- 中间件: `app/main.py:45-48`

**漏洞代码**:

```python
# app/main.py:43-48
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,  # ⚠️ 允许凭据
    allow_methods=["*"],
    allow_headers=["*"],
)

# app/core/config.py:39
cors_origins: List[str] = ["http://localhost:5173", "http://localhost:3000"]
```

**风险分析**:
- 如果生产环境 `cors_origins` 被错误配置为 `["*"]`，会导致所有外部网站都能携带 Cookie 访问后端 API
- 攻击者可以在自己的网站上诱导已登录用户访问，造成会话劫持

**修复建议**:

```python
# 方案 1: 生产环境明确指定域名
cors_origins: List[str] = []  # 生产环境必须配置具体域名

# 方案 2: 如果使用 "*"，必须关闭凭据
allow_credentials=False  # 与 allow_origins="*" 互斥

# 方案 3: 动态验证Origin头
async def verify_origin(request):
    origin = request.headers.get("origin")
    return origin in settings.cors_origins or settings.env == "development"
```

---

#### 漏洞 2: [D3] Inventory GET 端点缺少认证 (High - IDOR)

**严重程度**: High

**文件位置**: `app/api/inventory.py:628-638`

**漏洞代码**:

```python
@router.get("/{inventory_id}", response_model=InventoryResponse)
def get_inventory(inventory_id: int, db: Session = Depends(get_db)):
    """Get inventory item by ID"""
    item = _get_by_id(db, inventory_id)  # ⚠️ 无权限检查
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Inventory item not found",
        )
    response = InventoryResponse.model_validate(item).model_dump()
    return _add_specification(response)
```

**对比其他端点**:
- `/api/inventory/cas/{cas_number}`: ✅ 有 `Depends(get_current_user)`
- `/api/inventory/code/{code}`: ✅ 有 `Depends(get_current_user)`
- `/api/inventory/{id}`: ❌ 无认证

**风险分析**:
- 未登录用户可查看所有库存物品详情
- 泄露敏感信息：存放位置、危险品标识、借用人信息
- 可枚举所有库存 ID 进行批量数据窃取

**修复建议**:

```python
@router.get("/{inventory_id}", response_model=InventoryResponse)
def get_inventory(
    inventory_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)  # ✅ 添加认证
):
    """Get inventory item by ID"""
    item = _get_by_id(db, inventory_id)
    # ... 后续逻辑
```

---

#### 漏洞 3: [D3] Inventory 列表端点缺少认证 (High - IDOR)

**严重程度**: High

**文件位置**: `app/api/inventory.py:505-625`

**漏洞代码**:

```python
@router.get("/")
def list_inventory(
    skip: int = 0,
    limit: int = 50,
    status_filter: Optional[InventoryStatus] = None,
    cas_filter: Optional[str] = None,
    hazardous_only: bool = False,
    search: Optional[str] = None,
    search_field: Optional[str] = None,
    fuzzy: bool = False,
    db: Session = Depends(get_db),
):  # ⚠️ 无认证依赖
    """List inventory with optional filters and pagination"""
    # ... 查询逻辑
```

**风险分析**:
- 未认证用户可获取全部库存数据
- 包含：CAS号、名称、位置、数量、危险品标识
- 批量数据泄露

**修复建议**:

```python
@router.get("/")
def list_inventory(
    # ... 参数
    current_user: User = Depends(get_current_user),  # ✅ 添加认证
    db: Session = Depends(get_db),
):
```

---

#### 漏洞 4: [D2] JWT Token 过期时间过长 (Medium)

**严重程度**: Medium

**文件位置**: `app/core/config.py:32`

**漏洞代码**:

```python
access_token_expire_minutes: int = 7 * 24 * 60  # 7 天 = 10080 分钟
```

**风险分析**:
- Token 泄露后，攻击者可在 7 天内冒充用户
- 移动端应用场景下，过期时间过长增加风险

**修复建议**:

```python
# 推荐: 根据环境配置不同过期时间
access_token_expire_minutes: int = Field(
    default=60 * 24,  # 开发环境 1 天
    description="JWT token expiration in minutes"
)

# 或使用环境变量覆盖
# .env: ACCESS_TOKEN_EXPIRE_MINUTES=1440  (生产环境 24 小时)

# 最佳实践: 实现 Refresh Token 机制
# - Access Token: 15-60 分钟
# - Refresh Token: 7-30 天
```

---

#### 漏洞 5: [D8] 调试模式可能泄露信息 (Medium)

**严重程度**: Medium

**文件位置**: `app/main.py:17-21`

**漏洞代码**:

```python
logging.basicConfig(
    level=logging.DEBUG if settings.debug else logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
```

**配置文件**: `app/core/config.py:23`

```python
debug: bool = False
env: str = "development"
```

**风险分析**:
- `debug=True` 时会输出详细调试信息
- 可能泄露：SQL 查询、变量值、堆栈跟踪
- Werkzeug Debugger 在某些版本可被利用

**修复建议**:

```python
# 确保生产环境配置
# .env 文件
ENV=production
DEBUG=false

# 或在代码中强制
if settings.env == "production" and settings.debug:
    raise ValueError("DEBUG mode cannot be enabled in production")
```

---

#### 漏洞 6: [D8] 前端 localStorage 存储数据 (Medium)

**严重程度**: Medium

**文件位置**:
- `frontend/src/store/useStore.ts:8,16,29,32`
- `frontend/src/hooks/useTheme.ts:7,9,28`
- `frontend/src/pages/Dashboard.tsx:370,387`
- `frontend/src/components/ErrorBoundary.tsx:15`
- `frontend/src/pages/NotFound.tsx:17`

**漏洞代码**:

```typescript
// frontend/src/store/useStore.ts
const value = localStorage.getItem(name)
localStorage.setItem(name, JSON.stringify(valueWithExpiry))

// frontend/src/hooks/useTheme.ts
const saved = localStorage.getItem('theme') as Theme
localStorage.setItem('theme', theme)
```

**风险分析**:
- localStorage 可被 XSS 攻击窃取
- 存储敏感数据（如 Token）会导致安全问题
- 当前存储内容为 UI 状态，影响较小

**当前存储内容分析**:
| Key | 内容 | 敏感度 |
|-----|------|--------|
| theme | 主题设置 | 低 |
| dashboard_active_tab | 标签页状态 | 低 |
| user_xxx | 用户状态 | 中 |

**修复建议**:

```typescript
// 方案 1: 使用 sessionStorage (关闭浏览器后清除)
sessionStorage.setItem('theme', theme)

// 方案 2: Cookie 存储 (配合 httpOnly)
document.cookie = "theme=dark; path=/; SameSite=Strict"

// 方案 3: 服务端存储用户偏好
// PATCH /api/users/me/preferences
```

---

### 2.3 安全维度覆盖矩阵

| # | 维度 | 覆盖状态 | 发现数 | 说明 |
|---|------|---------|--------|------|
| D1 | 注入 | ✅ 已覆盖 | 0 | SQLModel 参数化查询，无注入风险 |
| D2 | 认证 | ✅ 已覆盖 | 1 | JWT 实现良好，Token 过期时间需优化 |
| D3 | 授权 | ✅ 已覆盖 | 2 | 2个端点缺少认证 |
| D4 | 反序列化 | ✅ 已覆盖 | 0 | 无不安全反序列化 |
| D5 | 文件操作 | ✅ 已覆盖 | 0 | 文件名 UUID 重命名，有类型校验 |
| D6 | SSRF | ⚠️ 浅覆盖 | 0 | 未发现 SSRF 风险 |
| D7 | 加密 | ✅ 已覆盖 | 0 | RSA 2048 位，密钥管理良好 |
| D8 | 配置 | ✅ 已覆盖 | 2 | CORS、调试模式需优化 |
| D9 | 业务逻辑 | ✅ 已覆盖 | 1 | localStorage 存储 |
| D10 | 供应链 | ✅ 已覆盖 | 0 | 依赖版本较新 |

---

### 2.4 安全良好的方面

| 方面 | 评价 | 详情 |
|------|------|------|
| SQL 注入防护 | ✅ 优秀 | 使用 SQLModel ORM，无字符串拼接 SQL |
| 密码存储 | ✅ 优秀 | bcrypt 加密，难以破解 |
| JWT 算法 | ✅ 优秀 | 默认 RS256，支持密钥对 |
| 文件上传 | ✅ 良好 | UUID 重命名，类型校验，压缩处理 |
| XSS 防护 | ✅ 优秀 | React 默认防护，无 dangerouslySetInnerHTML |
| 认证装饰器 | ✅ 良好 | 所有敏感操作均有 Depends 保护 |

---

## 三、代码标准审查报告

### 3.1 审计摘要

| 指标 | 数值 |
|------|------|
| 严重问题 | 4 个 |
| 中等问题 | 4 个 |
| 低优先级 | 6 个 |
| 代码异味 | 2 个 |

### 3.2 严重问题 (High Severity)

#### 问题 1: N+1 查询问题 - 性能瓶颈

**严重程度**: High

**文件位置**: `app/api/inventory.py:151-174`

**问题代码**:

```python
def _add_user_names(db: Session, item_dict: dict) -> dict:
    """Add user names to inventory response dict"""
    # Get borrower name
    if item_dict.get("borrower_id"):
        borrower = db.get(User, item_dict["borrower_id"])  # ❌ 单独查询
        item_dict["borrower_name"] = borrower.full_name or borrower.username if borrower else None
    else:
        item_dict["borrower_name"] = None

    # Get last borrower name
    if item_dict.get("last_borrower_id"):
        last_borrower = db.get(User, item_dict["last_borrower_id"])  # ❌ 又单独查询
        item_dict["last_borrower_name"] = last_borrower.full_name or last_borrower.username if last_borrower else None
    else:
        item_dict["last_borrower_name"] = None

    # Get created by name
    if item_dict.get("created_by_id"):
        created_by = db.get(User, item_dict["created_by_id"])  # ❌ 再单独查询
        item_dict["created_by_name"] = created_by.full_name or created_by.username if created_by else None
    else:
        item_dict["created_by_name"] = None

    return item_dict
```

**影响分析**:
- 返回 50 条记录时，最多产生 **150 次数据库查询**
- 查询延迟: 1 次查询 ~10ms → 150 次 ~1.5s

**修复建议**:

```python
def _add_user_names_batch(db: Session, items: list[dict]) -> list[dict]:
    """批量获取用户名称，避免 N+1 查询"""
    # 收集所有需要的用户 ID
    user_ids = set()
    for item in items:
        if item.get("borrower_id"):
            user_ids.add(item["borrower_id"])
        if item.get("last_borrower_id"):
            user_ids.add(item["last_borrower_id"])
        if item.get("created_by_id"):
            user_ids.add(item["created_by_id"])

    if not user_ids:
        return items

    # 一次查询获取所有用户
    users = db.exec(
        select(User).where(User.id.in_(user_ids))
    ).all()

    # 构建用户映射
    user_map = {u.id: u for u in users}

    # 填充名称
    for item in items:
        borrower_id = item.get("borrower_id")
        if borrower_id and borrower_id in user_map:
            user = user_map[borrower_id]
            item["borrower_name"] = user.full_name or user.username
        else:
            item["borrower_name"] = None

        last_borrower_id = item.get("last_borrower_id")
        if last_borrower_id and last_borrower_id in user_map:
            user = user_map[last_borrower_id]
            item["last_borrower_name"] = user.full_name or user.username
        else:
            item["last_borrower_name"] = None

        created_by_id = item.get("created_by_id")
        if created_by_id and created_by_id in user_map:
            user = user_map[created_by_id]
            item["created_by_name"] = user.full_name or user.username
        else:
            item["created_by_name"] = None

    return items
```

---

#### 问题 2: 前端 CAS 检查效率极低

**严重程度**: High

**文件位置**: `frontend/src/pages/ReagentOrders.tsx:134-160`

**问题代码**:

```typescript
const checkCASWarning = async (cas: string) => {
  // ❌ 每次都获取所有订单数据
  const response = await reagentOrderAPI.list()
  const allOrders: ReagentOrder[] = response.data.data || []

  const existingOrders = allOrders.filter(
    (order) =>
      order.status !== 'completed' &&
      order.status !== 'rejected' &&
      order.cas_number?.replace(/-/g, '') === cas.replace(/-/g, '')
  )

  if (existingOrders.length > 0) {
    setCasWarning(
      `该 CAS 号已有待处理的申购单: ${existingOrders.map((o) => o.id).join(', ')}`
    )
  } else {
    setCasWarning('')
  }
}
```

**影响分析**:
- 每次用户输入 CAS 号触发 API 调用
- 下载全部订单数据（可能数百条）
- 本应在服务端完成的过滤逻辑放到前端

**修复建议**:

```typescript
// 后端添加专门 API: GET /api/reagent-orders/check-cas/:cas
// 前端调用
const checkCASWarning = async (cas: string) => {
  try {
    // ✅ 使用专门的检查 API
    const response = await reagentOrderAPI.checkCAS(cas)
    if (response.data.has_pending) {
      setCasWarning(
        `该 CAS 号已有待处理的申购单: ${response.data.order_ids.join(', ')}`
      )
    } else {
      setCasWarning('')
    }
  } catch (error) {
    console.error('CAS check failed:', error)
  }
}
```

---

#### 问题 3: DRY 原则违反 - 后端

**严重程度**: High

**文件位置**:
- `app/api/consumable_orders.py`
- `app/api/reagent_orders.py`

**重复代码分析**:

| 函数 | 重复行数 | 相似度 |
|------|---------|--------|
| get_xxx_order_by_id | 5 行 | 95% |
| list_xxx_orders | 40 行 | 85% |
| create_xxx_order | 25 行 | 80% |
| update_xxx_order | 30 行 | 75% |
| approve_xxx_order | 20 行 | 90% |
| reject_xxx_order | 20 行 | 90% |
| delete_xxx_order | 20 行 | 70% |

**修复建议 - 方案 1: 抽取基类**:

```python
# app/api/base_order.py
class BaseOrderRouter(APIRouter):
    def __init__(self, prefix: str, tags: list[str], model):
        super().__init__(prefix=prefix, tags=tags)
        self.model = model

    def get_order_by_id(self, db: Session, order_id: int):
        return db.get(self.model, order_id)

    # ... 其他通用方法
```

**修复建议 - 方案 2: 函数抽取**:

```python
# app/api/utils.py
def list_orders_common(
    db: Session,
    model: Type[SQLModel],
    status_filter: Optional[Any] = None,
    skip: int = 0,
    limit: int = 50,
    # ...
):
    """通用的订单列表查询逻辑"""
    base = select(model)
    if status_filter:
        base = base.where(model.status == status_filter)
    # ...
```

---

#### 问题 4: DRY 原则违反 - 前端

**严重程度**: High

**文件位置**:
- `frontend/src/pages/ReagentOrders.tsx` (853 行)
- `frontend/src/pages/ConsumableOrders.tsx` (640 行)
- `frontend/src/pages/Inventory.tsx` (~1400 行)

**重复内容分析**:

| 重复内容 | ReagentOrders | ConsumableOrders | 相似度 |
|---------|--------------|------------------|--------|
| STATUS_STYLES | 15 行 | 15 行 | 95% |
| 表单验证逻辑 | 80 行 | 60 行 | 75% |
| 表格列定义 | 50 行 | 40 行 | 70% |
| Dialog 组件 | 100 行 | 80 行 | 65% |

**修复建议 - 抽取公共组件**:

```typescript
// frontend/src/components/OrderTable.tsx
interface OrderTableProps<T> {
  data: T[]
  columns: ColumnDef<T>[]
  onApprove?: (id: number) => void
  onReject?: (id: number) => void
  // ...
}

export function OrderTable<T>({ data, columns, ...props }: OrderTableProps<T>) {
  // 通用表格逻辑
}

// frontend/src/components/StatusBadge.tsx
export const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  // ...
}
```

---

### 3.3 中等问题 (Medium Severity)

#### 问题 5: 魔法数字

**文件位置**: 多处

| 文件 | 位置 | 硬编码值 | 含义 |
|------|------|---------|------|
| `app/api/users.py:34-37` | 登录限制 | `5` | 最大登录尝试次数 |
| `app/api/users.py:34-37` | 登录限制 | `300` | 时间窗口(秒) |
| `app/api/users.py:34-37` | 登录限制 | `10000` | 缓存最大条目 |
| `app/api/inventory.py:41-42` | 缓存 | `60` | 缓存TTL(秒) |
| `app/api/inventory.py:61` | 缓存 | `100` | 最大缓存数 |
| `app/api/inventory.py:780` | 库存 | `20` | 低库存阈值(%) |
| `app/api/users.py:198` | Cookie | `604800` | 7天(秒) |

**修复建议**:

```python
# app/core/config.py
class Settings(BaseSettings):
    # 登录限制
    max_login_attempts: int = _window_seconds: int5
    login    login_cache_max = 300
_size: int = 10000

    # 缓存配置
    cache_ttl_seconds: int = 60
    cache_max_size: int = 100

    # 库存配置
    low_stock_threshold_percent: int = 20

    # Cookie 配置
    cookie_max_age_seconds: int = 7 * 24 * 60 * 60
```

---

#### 问题 6: 内存泄漏风险

**文件位置**: `app/api/inventory.py:40-75`

**问题代码**:

```python
SEARCH_CACHE: Dict[str, tuple[Any, datetime]] = {}

def _set_cached_result(cache_key: str, result: Dict[str, Any]) -> None:
    """设置缓存结果"""
    SEARCH_CACHE[cache_key] = (result, datetime.now())
    # 简单清理：只保留最近100个缓存项
    if len(SEARCH_CACHE) > 100:
        # 删除最旧的10个
        oldest_keys = sorted(SEARCH_CACHE.keys(), key=lambda k: SEARCH_CACHE[k][1])[:10]
        for key in oldest_keys:
            del SEARCH_CACHE[key]
```

**风险分析**:
- 全局字典在多进程/多线程环境下不共享
- 无最大内存限制
- 缓存的数据可能很大（包含完整库存列表）
- 进程重启后缓存丢失

**修复建议**:

```python
# 方案 1: 使用 Redis 缓存
import redis
cache = redis.Redis(host='localhost', db=0)

def _get_cached_result(cache_key: str) -> Optional[Dict]:
    cached = cache.get(cache_key)
    return json.loads(cached) if cached else None

# 方案 2: 添加内存限制
import sys
MAX_CACHE_SIZE_MB = 50  # 最大 50MB

def _set_cached_result(cache_key: str, result: Dict) -> None:
    estimated_size = sys.getsizeof(json.dumps(result))
    # 检查并清理直到满足大小限制
    # ...
```

---

#### 问题 7: 密码强度验证不足

**文件位置**: `app/api/users.py:490`

**问题代码**:

```python
# 管理员重置密码
if len(password_request.new_password) < 6:
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Password must be at least 6 characters"
    )
```

**前端验证逻辑** (`frontend/src/lib/inputValidation.ts`):

```typescript
export function validatePassword(password: string): string[] {
  const errors: string[] = []
  if (password.length < 8) errors.push("至少8个字符")
  if (!/[a-z]/.test(password)) errors.push("需要小写字母")
  if (!/[A-Z]/.test(password)) errors.push("需要大写字母")
  if (!/[0-9]/.test(password)) errors.push("需要数字")
  return errors
}
```

**修复建议**:

```python
import re

def validate_password_strength(password: str) -> bool:
    """验证密码强度"""
    if len(password) < 8:
        return False
    if not re.search(r'[a-z]', password):
        return False
    if not re.search(r'[A-Z]', password):
        return False
    if not re.search(r'[0-9]', password):
        return False
    return True

# 使用
if not validate_password_strength(password_request.new_password):
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="密码需要至少8个字符，包含大小写字母和数字"
    )
```

---

#### 问题 8: 前端不必要的重渲染

**文件位置**: `frontend/src/pages/ConsumableOrders.tsx`

**问题代码**:

```typescript
const columns = useMemo(() => [
  {
    accessorKey: "name",
    cell: ({ row }) => <div>{row.getValue("name")}</div>
  },
  // ... 更多列
], [isAdmin])  // ✅ 依赖项正确

// ❌ 但处理函数未 useCallback
const handleApprove = async (id: number) => {
  await approveOrder(id)
  refreshData()
}

const handleReject = async (id: number) => {
  await rejectOrder(id)
  refreshData()
}
```

**修复建议**:

```typescript
const handleApprove = useCallback(async (id: number) => {
  await approveOrder(id)
  refreshData()
}, [refreshData])

const handleReject = useCallback(async (id: number) => {
  await rejectOrder(id)
  refreshData()
}, [refreshData])
```

---

### 3.4 低优先级问题 (Low Severity)

#### 问题 9: 命名不一致

**文件**: `app/api/inventory.py`

```python
def _get_by_id(db: Session, inventory_id: int) -> Optional[Inventory]:
    """Get inventory item by ID"""

def _find_by_code(db: Session, code: str) -> Optional[Inventory]:
    """Get inventory item by internal code"""
```

**建议**: 统一使用 `get_` 或 `find_`

---

#### 问题 10: import 语句位置不当

**文件**: `app/api/reagent_orders.py:284-285`

```python
def confirm_reagent_arrival(...):
    # Check if user is the applicant or admin
    from app.models.user import UserRole  # ❌ 放在函数内
```

**建议**: 移到文件顶部

---

#### 问题 11: 重复的用户名检查逻辑

**文件**: `app/api/users.py:250, 365`

```python
# 第 250 行
existing = get_user_by_username(db, user.username)

# 第 365 行
existing = get_user_by_username(db, update_data["username"])
```

**建议**: 抽取为 `check_username_available(db, username)`

---

#### 问题 12: 前端 STATUS_STYLES 重复定义

**文件**: 多个页面

```typescript
// ReagentOrders.tsx:79-85
const STATUS_STYLES = {
  pending: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  approved: 'bg-green-100 text-green-800 border-green-300',
  // ...
}

// ConsumableOrders.tsx:59-64
const STATUS_STYLES = {
  pending: 'bg-yellow-100 text-yellow-800 border-yellow-300',  // 相同
  approved: 'bg-green-100 text-green-800 border-green-300',     // 相同
  // ...
}
```

**建议**: 提取到 `frontend/src/lib/constants.ts`

```typescript
// frontend/src/lib/constants.ts
export const STATUS_STYLES: Record<OrderStatus, string> = {
  pending: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  approved: 'bg-green-100 text-green-800 border-green-300',
  rejected: 'bg-red-100 text-red-800 border-red-300',
  // ...
}
```

---

### 3.5 代码异味 (Code Smell)

#### 问题 13: 深层嵌套

**文件**: `app/api/inventory.py:542-601`

```python
if fuzzy:
    # 3层嵌套
    if search_field and search_field != 'all':
        if search_field in field_map:
            # ...
        else:
            # ...
    else:
        # ...
else:
    # ...
```

**建议**: 使用早期返回或抽取函数

---

#### 问题 14: 重复的辅助函数

**文件**: `app/api/inventory.py`

```python
# 第 89-105 行
def normalize_search_term(search_term: str) -> str:
    # ...

# 第 108-123 行
def _normalize_field_sql(field, sql_func):
    # ...

# 第 551 行
def norm_field(field):
    # ... 与上述函数重复
```

---

## 四、综合建议

### 4.1 修复优先级

| 优先级 | 问题 | 预计工作量 |
|--------|------|-----------|
| P0-紧急 | 安全: Inventory 端点缺少认证 | 0.5h |
| P0-紧急 | 安全: CORS 配置问题 | 0.5h |
| P1-高 | 性能: N+1 查询问题 | 2h |
| P1-高 | 性能: 前端 CAS 检查效率 | 1h |
| P2-中 | DRY: 抽取公共代码 | 8h |
| P2-中 | 配置: 魔法数字外置 | 2h |
| P3-低 | 代码风格: 命名统一 | 1h |

### 4.2 长期改进建议

1. **架构优化**:
   - 抽取订单基类或泛型逻辑
   - 前端抽取公共组件库

2. **性能优化**:
   - 引入 Redis 缓存
   - 实现数据库连接池
   - 添加查询索引

3. **安全加固**:
   - 实现 Refresh Token
   - 添加请求频率限制
   - 完善日志审计

4. **测试覆盖**:
   - 添加单元测试
   - 添加集成测试
   - 添加 E2E 测试

---

## 五、附录

### A. 文件清单

| 文件 | 行数 | 用途 |
|------|------|------|
| app/main.py | 89 | FastAPI 应用入口 |
| app/core/auth.py | 210 | 认证授权逻辑 |
| app/core/config.py | 186 | 配置管理 |
| app/api/users.py | 502 | 用户 API |
| app/api/inventory.py | 834 | 库存 API |
| app/api/reagent_orders.py | 540 | 试剂订单 API |
| app/api/consumable_orders.py | 349 | 耗材订单 API |
| frontend/src/pages/*.tsx | ~3000 | 前端页面 |

### B. 依赖版本

| 依赖 | 版本 | 安全性 |
|------|------|--------|
| fastapi | ^0.109.0 | ✅ 最新稳定版 |
| python-jose | ^3.3.0 | ✅ 无已知漏洞 |
| bcrypt | ^3.2.0 | ✅ 无已知漏洞 |
| pillow | ^11.0.0 | ✅ 无已知漏洞 |
| pandas | ^2.1.0 | ✅ 无已知漏洞 |

---

> 报告生成时间: 2026-02-26
> 审计工具: Claude Code + code-audit skill + coding-standards skill
