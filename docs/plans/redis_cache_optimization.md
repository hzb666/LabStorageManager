# Redis 缓存优化方案

> 基于 Redis Best Practices 审查完善

---

## 1. 当前 Redis 使用情况

| 功能 | 实现位置 | 状态 |
|------|----------|------|
| Session 缓存 | `app/core/redis.py` | ✅ 已实现 |
| 用户会话管理 | `app/api/users.py` | ✅ 已实现 |
| 设备管理 API | `app/api/user_sessions.py` | ✅ 已实现 |

---

## 2. Redis Best Practices 审查

### 2.1 连接与性能 (HIGH Priority)

| 规则 | 状态 | 说明 |
|------|------|------|
| `conn-pooling` 连接池 | ✅ 已实现 | 使用 `redis.ConnectionPool` |
| `conn-timeouts` 超时配置 | ✅ 已实现 | `socket_connect_timeout=2`, `socket_timeout=2` |
| `conn-blocking` 避免慢命令 | ✅ 已实现 | 仅使用基本 Redis 命令 |
| 熔断机制 | ✅ 已实现 | `_last_error_time` 30秒冷却 |

### 2.2 内存与过期 (HIGH Priority)

| 规则 | 状态 | 说明 |
|------|------|------|
| `ram-ttl` TTL 设置 | ✅ 已实现 | Session TTL = 168小时（7天） |
| `ram-limits` 内存限制 | ⚠️ 待配置 | Redis 服务端需配置 maxmemory |

### 2.3 数据结构与 Key (HIGH Priority)

| 规则 | 状态 | 说明 |
|------|------|------|
| `data-key-naming` Key 命名 | ✅ 已实现 | 使用 `session:{token_hash}` 格式 |
| `data-choose-structure` 数据结构 | ✅ 已实现 | 使用 JSON 字符串存储 |

### 2.4 安全 (HIGH Priority)

| 规则 | 状态 | 说明 |
|------|------|------|
| `security-auth` 认证 | ✅ 已实现 | 支持 `redis_password` 配置 |
| `security-network` 网络安全 | ⚠️ 待配置 | Redis 服务端需配置 bind |

---

## 3. 当前实现分析

### 3.1 优点 ✅

```python
# 1. 连接池复用
pool = redis.ConnectionPool(
    host=settings.redis_host,
    port=settings.redis_port,
    db=settings.redis_db,
    decode_responses=True,
    socket_connect_timeout=2,
    socket_timeout=2
)

# 2. TTL 自动过期
redis_client.setex(key, ttl_seconds, json.dumps(data))

# 3. 熔断机制
if time.time() - _last_error_time < REDIS_COOLDOWN_SECONDS:
    return None

# 4. 错误降级
def get_redis():
    if redis_client is None:
        return None  # 降级到数据库
```

### 3.2 可改进项 ⚠️

| 项目 | 当前状态 | 建议 |
|------|----------|------|
| Redis 服务端内存限制 | 未配置 | 添加 `maxmemory` 配置 |
| Redis 服务端网络安全 | 未配置 | 限制 `bind` 地址 |
| Pipeline 批量操作 | 未使用 | 批量写入时可考虑 |
| 客户端缓存 | 未使用 | 可考虑用于只读数据 |

---

## 4. 缓存场景分析

### 4.1 不适合直接缓存的场景

| 数据类型 | 原因 | 现状 |
|----------|------|------|
| 库存数量 (`remaining_quantity`) | 实时变化，借用/归还/消耗操作频繁 | ✅ 走数据库 |
| 库存状态 (`status`) | 实时变化 | ✅ 走数据库 |
| 借用人信息 (`borrower`) | 实时变化 | ✅ 走数据库 |
| 库存列表 | 2万+条，筛选条件组合多 | ✅ 已用分页+索引 |

**结论**：库存实时数据不适合用 Redis 缓存，数据库索引已足够。

### 4.2 适合缓存的场景

| 缓存内容 | 理由 | TTL | 预期收益 |
|----------|------|-----|----------|
| **CAS 基础信息** | CAS号对应的名称、品牌、分类相对稳定 | 24小时 | 高 |
| **分类/品牌列表** | 数据量小，变化少 | 1小时 | 中 |
| **用户权限/角色** | 用户信息高频访问 | 24小时 | 高 |
| **下拉选项数据** | 筛选、下拉框用 | 1小时 | 中 |

---

## 5. 优化方案

### 5.1 方案一：CAS 基础信息缓存（推荐）

**目标**：缓存 CAS 号的静态属性，减少数据库查询

**缓存内容**：
```json
{
  "cas_number": "64-17-5",
  "name": "乙醇",
  "english_name": "Ethanol",
  "category": "有机溶剂",
  "brand": "Sigma-Aldrich",
  "alias": "酒精, 无水乙醇",
  "is_hazardous": true,
  "unit": "ml"
}
```

**实现代码**：

```python
# app/core/redis_cache.py

CAS_INFO_PREFIX = "cas:info:"
CAS_INFO_TTL = 86400  # 24小时

def cache_cas_info(cas_number: str, info: dict) -> None:
    """缓存 CAS 基础信息"""
    redis_client = get_redis()
    if redis_client is None:
        return
    key = f"{CAS_INFO_PREFIX}{cas_number.upper().replace(' ', '')}"
    try:
        redis_client.setex(key, CAS_INFO_TTL, json.dumps(info, default=str))
    except redis.RedisError as e:
        logger.error(f"缓存 CAS 信息失败: {e}")

def get_cached_cas_info(cas_number: str) -> Optional[dict]:
    """获取缓存的 CAS 基础信息"""
    redis_client = get_redis()
    if redis_client is None:
        return None
    key = f"{CAS_INFO_PREFIX}{cas_number.upper().replace(' ', '')}"
    try:
        data = redis_client.get(key)
        if data:
            return json.loads(data)
    except (redis.RedisError, json.JSONDecodeError) as e:
        logger.error(f"读取 CAS 缓存失败: {e}")
    return None

def invalidate_cas_info(cas_number: str) -> None:
    """失效 CAS 缓存（当 CAS 信息更新时）"""
    redis_client = get_redis()
    if redis_client is None:
        return
    key = f"{CAS_INFO_PREFIX}{cas_number.upper().replace(' ', '')}"
    redis_client.delete(key)
```

**使用场景**：
- 新建订单时，自动填充 CAS 对应的名称、类别、品牌
- 库存列表中相同 CAS 号只查一次数据库

### 4.3 缓存失效策略

缓存的最大挑战是**缓存失效（Cache Invalidation）**。以下是针对不同字段的处理策略：

#### 缓存字段与失效规则

| 缓存字段 | 说明 | 更新时处理 |
|----------|------|------------|
| `name` | 中文名称 | 删除缓存 |
| `english_name` | 英文名称 | 删除缓存 |
| `brand` | 品牌 | 删除缓存 |
| `category` | 分类 | 删除缓存 |
| `alias` | 别名 | 删除缓存 |
| `is_hazardous` | 是否危化品 | 删除缓存 |
| `unit` | 单位 | 删除缓存 |
| `specification` | 规格（初始值） | 删除缓存 |
| `initial_quantity` | 初始数量（默认值参考） | 删除缓存 |
| `price` | 价格（参考价） | 删除缓存 |

#### 失效策略：写入时删除（Write Invalidate）

```python
def update_cas_info(cas_number: str, info: dict):
    """更新 CAS 信息"""
    # 1. 更新数据库
    db.update(...)

    # 2. 删除缓存（强制下次查询回源数据库）
    invalidate_cas_info(cas_number)

def create_order(cas_number: str, order_data: dict):
    """创建订单时填充 CAS 信息"""
    # 1. 查询 CAS 信息（优先缓存）
    cas_info = get_cached_cas_info(cas_number)
    if not cas_info:
        cas_info = db.query(CASInfo).filter_by(cas_number=cas_number).first()
        if cas_info:
            # 2. 写入缓存
            cache_cas_info(cas_number, cas_info.to_dict())

    # 3. 填充订单
    order_data['name'] = cas_info['name']
    order_data['brand'] = cas_info['brand']
```

#### TTL 作为最终保障

```python
CAS_INFO_TTL = 86400  # 24小时
```

#### 需要失效缓存的场景

1. **库存编辑** - 修改了 CAS 对应的名称/品牌/分类
2. **手动入库** - 新增 CAS 信息
3. **批量导入** - 导入新的 CAS 数据

### 5.2 方案二：分类/品牌列表缓存

**目标**：缓存分类和品牌列表，快速加载下拉选项

```python
# 缓存 Key 设计
CATEGORY_LIST_KEY = "inventory:categories"
BRAND_LIST_KEY = "inventory:brands"
LIST_TTL = 3600  # 1小时

def get_cached_categories() -> list:
    """获取缓存的分类列表"""
    redis_client = get_redis()
    if redis_client is None:
        return None
    try:
        data = redis_client.get(CATEGORY_LIST_KEY)
        return json.loads(data) if data else None
    except:
        return None
```

### 5.3 方案三：用户权限缓存

**目标**：减少用户表和权限表查询

```python
USER_PERMS_PREFIX = "user:perms:"
USER_PERMS_TTL = 86400  # 24小时

def get_user_permissions(user_id: int) -> list:
    """获取用户权限（优先缓存）"""
    # 1. 尝试从 Redis 获取
    cached = get_cached(f"{USER_PERMS_PREFIX}{user_id}")
    if cached:
        return cached

    # 2. 缓存未命中，查询数据库
    perms = db.query(UserPermission).filter_by(user_id=user_id).all()

    # 3. 写入缓存
    cache_set(f"{USER_PERMS_PREFIX}{user_id}", perms, USER_PERMS_TTL)
    return perms

def invalidate_user_cache(user_id: int) -> None:
    """用户权限变更时失效缓存"""
    cache_delete(f"{USER_PERMS_PREFIX}{user_id}")
```

---

## 6. 搜索/排序/筛选的优化思路

### 6.1 为什么 Redis 不适合？

| 场景 | Redis 适用性 | 原因 |
|------|--------------|------|
| 精确搜索 (CAS号) | ⚠️ 有限 | 数据库索引已够 |
| 模糊搜索 | ❌ 不适合 | 需全文检索 |
| 排序 | ❌ 不适合 | 数据库索引已优化 |
| 分页 | ❌ 不适合 | 已有分页+虚拟滚动 |

### 6.2 其他优化思路

#### 思路一：数据库层面优化

- **已有**：拼音排序索引 ✅
- **可添加**：复合索引
  ```sql
  CREATE INDEX idx_inventory_status_category ON inventory(status, category);
  CREATE INDEX idx_inventory_status_brand ON inventory(status, brand);
  ```

#### 思路二：前端缓存

- **搜索历史**：localStorage 缓存最近搜索词
- **筛选状态**：URL 参数持久化，避免重复输入
- **表格列配置**：用户自定义列宽/顺序本地保存

#### 思路三：Elasticsearch（可选）

如果未来数据量超过 10 万，需要全文搜索、聚合分析：

```
当前：SQLite → 2万条 → 分页
未来：SQLite → 实时同步 → Elasticsearch → 复杂搜索
```

---

## 7. 其他项目适用场景

| 项目类型 | Redis 适用场景 | 预期收益 |
|----------|----------------|----------|
| **用户权限系统** | 角色/权限缓存、菜单缓存 | 高频访问，减少DB |
| **配置/字典表** | 分类、品牌、状态枚举 | 极高命中率 |
| **API 限流** | 接口限流计数器 | 防恶意请求 |
| **分布式锁** | 库存扣减、并发控制 | 数据一致性 |
| **实时通知** | WebSocket 消息推送 | 实时性要求高 |
| **验证码** | 短信/邮箱验证码 | 过期自动失效 |

---

## 8. 实施优先级

| 优先级 | 任务 | 工作量 | 收益 |
|--------|------|--------|------|
| P0 | CAS 基础信息缓存 | 中 | 高 |
| P1 | 分类/品牌列表缓存 | 低 | 中 |
| P1 | 用户权限缓存 | 中 | 高 |
| P2 | 复合索引优化 | 低 | 中 |

---

## 9. 关键原则

1. **缓存静态数据**：CAS 号、分类、品牌等不常变化的数据
2. **缓存失效要完整**：数据更新时及时失效缓存，保证时效性
3. **降级处理**：Redis 不可用时回退到数据库，不影响主流程
4. **不过度缓存**：实时数据（库存数量）坚决不走缓存

---

## 10. 检查清单

### Redis Best Practices 审查

- [X] `conn-pooling` 连接池
- [X] `conn-timeouts` 超时配置
- [X] `conn-blocking` 避免慢命令
- [X] 熔断机制
- [X] `ram-ttl` TTL 设置
- [X] `data-key-naming` Key 命名
- [X] `data-choose-structure` 数据结构
- [X] `security-auth` 认证支持
- [ ] `ram-limits` Redis 服务端内存限制（需服务端配置）
- [ ] `security-network` Redis 服务端网络安全（需服务端配置）

### 功能实现

- [X] Redis 客户端初始化
- [X] Session 缓存功能
- [X] 设备管理后端 API
- [X] 禁用用户时清理 Session 缓存
- [X] 缓存失效策略文档（写入时删除 + TTL）

### 缓存失效策略

- [X] `invalidate_cas_info` 函数定义
- [X] 缓存字段列表（name, english_name, brand, category, alias, is_hazardous, unit）
- [X] 失效场景说明（库存编辑、手动入库、批量导入）

### 待实现

- [ ] CAS 基础信息缓存
- [ ] 分类/品牌列表缓存
- [ ] 用户权限缓存
- [ ] 实现缓存失效调用（在库存编辑、手动入库、批量导入时）

---

**文档更新时间**: 2026-02-28
