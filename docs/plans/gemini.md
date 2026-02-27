### 1. 高危安全漏洞修复 (Security)

根据深度安全审计，当前库存模块存在多个越权（IDOR）和并发业务逻辑漏洞。

#### 1.1 修复库存详情接口的未授权访问 (IDOR)

在 `inventory.py` 中，`get_inventory` 接口完全没有使用认证依赖，任何未登录的外部访问者都可以读取库存数据。

**🔧 修复代码 (`app/api/inventory.py` 约777行):**

**Python**

```
@router.get("/{inventory_id}", response_model=InventoryResponse)
def get_inventory(
    inventory_id: int, 
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)  # 修复：添加当前用户认证依赖
):
    """Get inventory item by ID"""
    item = _get_by_id(db, inventory_id)
    # ... 后续逻辑保持不变
```

#### 1.2 修复借用操作的竞态条件 (TOCTOU)

`borrow_item` 函数在检查库存状态和更新库存状态之间存在时间差，如果存在并发请求，会导致同一件物品被多个人同时借出。

**🔧 修复代码 (`app/api/inventory.py` 约833行):**
需引入悲观锁（Pessimistic Locking），在查询时锁定该行数据：

**Python**

```
from sqlmodel import select

@router.post("/{inventory_id}/borrow", response_model=InventoryResponse)
def borrow_item(
    inventory_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # 修复：使用 with_for_update() 锁定该行，防止并发修改
    statement = select(Inventory).where(Inventory.id == inventory_id).with_for_update()
    item = db.exec(statement).first()
  
    if not item:
        raise HTTPException(status_code=404, detail="Inventory item not found")

    if item.status != InventoryStatus.IN_STOCK:
        raise HTTPException(status_code=400, detail=f"Cannot borrow item with status: {item.status}")

    # ... 执行借出逻辑与 db.commit()
```

---

### 2. 严重性能瓶颈优化 (Performance)

#### 2.1 消除 N+1 查询风暴

在原代码的 `_add_user_names` 辅助函数中，针对列表中的每一项数据，都会发起最多 3 次 `db.get(User, id)` 查询。如果列表包含 100 条数据，将额外触发 300 次数据库查询。

**🔧 优化方案：改用批量映射获取用户信息**
废弃原本针对单条记录查询的 `_add_user_names`，在 `list_inventory` 接口中统一进行批量抓取：

**Python**

```
# 替换 list_inventory 中原有的列表推导式
items = db.exec(base.order_by(order_expr).offset(skip).limit(limit)).all()

# 1. 收集当前页面所有涉及到的 user_id
user_ids = set()
for item in items:
    if item.borrower_id: user_ids.add(item.borrower_id)
    if item.last_borrower_id: user_ids.add(item.last_borrower_id)
    if item.created_by_id: user_ids.add(item.created_by_id)

# 2. 一次性查出所有 User
users_map = {}
if user_ids:
    users = db.exec(select(User).where(User.id.in_(user_ids))).all()
    users_map = {u.id: (u.full_name or u.username) for u in users}

# 3. 组装数据，不再进行额外的 DB 查询
result_data = []
for item in items:
    item_dict = _add_specification(InventoryResponse.model_validate(item).model_dump())
    item_dict["borrower_name"] = users_map.get(item.borrower_id)
    item_dict["last_borrower_name"] = users_map.get(item.last_borrower_id)
    item_dict["created_by_name"] = users_map.get(item.created_by_id)
    result_data.append(item_dict)
```

#### 2.2 修复拼音排序导致的全表加载

当用户使用拼音排序时，原始代码逻辑是 `items = db.exec(base.order_by(order_expr)).all()`，即使设定了 `limit` 也会拉取全部数据到内存中，有极大的 OOM 内存溢出风险。
由于代码中已经添加了 `pinyin_sort_field_map`，需确保 `offset` 和 `limit` 在所有排序场景下都生效：

**Python**

```
# 修复 inventory.py 约 740 行左右的逻辑：
if limit > 0:
    items = db.exec(base.order_by(order_expr).offset(skip).limit(limit)).all()
else:
    items = db.exec(base.order_by(order_expr)).all()
```

---

### 3. 前端质量与架构同步优化 (Frontend Architecture)

根据《代码质量.md》，由于后端 API 的调整（特别是去除了冗余查询和提升了响应速度），前端也应同步进行瘦身以避免页面卡顿：

1. **组件职责拆分** ：当前 `Inventory.tsx` 长达近 900 行。应当将“新增入库”和“编辑库存”的弹窗（Modal）完全抽离为独立的组件，比如 `<AddInventoryModal />`。这能阻止弹窗内用户的输入导致整个大型数据表格重渲染。
2. **引入现代数据获取库** ：目前的 React 页面依然在使用 `useEffect` 和手动状态管理（`loading`, `data`, `error`）来拉取数据。建议将后端刚优化好的分页与缓存逻辑搭配 `@tanstack/react-query` 使用，以原生支持请求防抖与数据缓存。
