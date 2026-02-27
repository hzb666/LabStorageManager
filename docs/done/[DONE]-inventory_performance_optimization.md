# 库存列表性能优化方案

## 1. 业务背景与问题描述

当前系统前端采用 `@tanstack/react-virtual` 进行虚拟滚动，但在处理库存表约 **20,000 条数据** 时，首屏加载出现严重卡顿。核心诉求是实现**首屏秒开**，并显著降低服务器、网络和客户端的资源消耗。

## 2. 问题根因分析

经过系统排查，导致首屏加载缓慢的核心瓶颈有三个：

1. **N+1 查询问题（致命瓶颈）：** 后端在序列化数据时，每条记录都会触发 3 次独立的用户表查询（借用人、最后借用人、创建人）。20,000 条记录会导致 **60,000 次** 额外的数据库往返，极大拖慢了接口响应速度。
2. **一次性全量数据传输与解析（内存/网络瓶颈）：** API 一次性返回 20,000 条 JSON 数据。庞大的 Payload 不仅拉长了网络下载时间，前端浏览器在将这些 JSON 字符串解析为 JavaScript 对象时，会引发严重的内存暴涨和主线程阻塞。
3. **Python 端内存全量排序（CPU瓶颈）：** 触发中文拼音排序时，代码在 Python 运行时层面对全量数据执行 $O(N \log N)$ 复杂度的 `sorted` 操作。这消耗了大量 CPU 资源，高并发场景下极易拖垮服务。

---

## 3. 解决方案：数据库索引排序 + 分页

### 3.1 架构设计

采用**预计算拼音字段** + **数据库索引排序** + **分页查询**的方案：

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         数据流架构                                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   用户点击排序 ──▶ 前端传递 sort_by 参数 ──▶ 后端使用数据库索引排序      │
│                                                                          │
│   预计算拼音字段：                                                       │
│   - name_pinyin: 名称拼音（如 "乙醇" -> "yichun"）                      │
│   - category_pinyin: 类别拼音                                            │
│   - brand_pinyin: 品牌拼音                                              │
│   - alias_pinyin: 别名拼音                                              │
│                                                                          │
│   数据库索引加速：                                                       │
│   - ix_inventory_name_pinyin                                            │
│   - ix_inventory_category_pinyin                                        │
│   - ix_inventory_brand_pinyin                                            │
│   - ix_inventory_alias_pinyin                                           │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 技术实现

**数据库字段定义**：

```python
# app/models/inventory.py
class Inventory(SQLModel, table=True):
    # 拼音排序字段（预计算，使用数据库索引加速排序）
    name_pinyin: Optional[str] = Field(default=None, index=True)
    category_pinyin: Optional[str] = Field(default=None, index=True)
    brand_pinyin: Optional[str] = Field(default=None, index=True)
    alias_pinyin: Optional[str] = Field(default=None, index=True)
```

**API 排序逻辑**：

```python
# app/api/inventory.py
# 拼音排序字段映射（使用数据库索引加速排序）
pinyin_sort_field_map = {
    'name': Inventory.name_pinyin,
    'category': Inventory.category_pinyin,
    'brand': Inventory.brand_pinyin,
    'alias': Inventory.alias_pinyin,
}

# 判断是否需要使用拼音排序
if sort_by in pinyin_sort_fields:
    order_column = pinyin_sort_field_map.get(sort_by)
    # 使用数据库索引排序（高效）
```

---

## 4. 实施计划

| 阶段 | 任务 | 状态 | 说明 |
|------|------|------|------|
| Phase 1 | 后端游标分页 API | ✅ 已完成 | 支持 `cursor` + `limit` 参数 |
| Phase 2 | 后端 joinedload 优化 | ✅ 已完成 | 消除 N+1 查询 |
| Phase 3 | 前端 useInfiniteQuery | ✅ 已完成 | 集成 TanStack Query |
| Phase 4 | 前端 Virtual 联动 | ✅ 已完成 | 虚拟滚动 + 触底加载 |
| Phase 5 | 拼音排序优化 | ✅ 已完成 | 数据库索引排序 |

### Phase 5 详细实施记录（2026-02-27 修复）

**问题**：原代码使用 Python 端 `sorted()` 排序，每次排序都要遍历全部数据，性能差。

**修复内容**：

1. **模型字段添加** - `app/models/inventory.py`：
   - 新增 4 个拼音字段：`name_pinyin`, `category_pinyin`, `brand_pinyin`, `alias_pinyin`
   - 添加数据库索引

2. **API 排序优化** - `app/api/inventory.py`：
   - 添加拼音字段映射 `pinyin_sort_field_map`
   - 使用数据库字段排序替代 Python `sorted()` 排序

3. **数据库迁移**：
   ```sql
   ALTER TABLE inventory ADD COLUMN name_pinyin TEXT;
   ALTER TABLE inventory ADD COLUMN category_pinyin TEXT;
   ALTER TABLE inventory ADD COLUMN brand_pinyin TEXT;
   ALTER TABLE inventory ADD COLUMN alias_pinyin TEXT;
   
   CREATE INDEX ix_inventory_name_pinyin ON inventory(name_pinyin);
   CREATE INDEX ix_inventory_category_pinyin ON inventory(category_pinyin);
   CREATE INDEX ix_inventory_brand_pinyin ON inventory(brand_pinyin);
   CREATE INDEX ix_inventory_alias_pinyin ON inventory(alias_pinyin);
   ```

4. **历史数据处理**：
   - 批量重建脚本：`scripts/rebuild_pinyin.py`
   - 处理记录数：23,080 条

---

## 5. 预期性能提升

| 指标 | 优化前 | 优化后 | 提升 |
|------|--------|--------|------|
| 拼音排序响应时间 | O(N log N) Python | O(log N) 索引 | 50x ↓ |
| 排序内存占用 | 高（Python 排序） | 低（SQL 排序） | 10x ↓ |
| 首屏数据量 | 20,000 条 | 50 条 | 400x ↓ |
| API 响应时间 | 3-5 秒 | 200-500ms | 10x ↓ |

---

## 6. 相关代码文件

- 后端：`app/api/inventory.py` - 拼音排序 API
- 模型：`app/models/inventory.py` - 拼音字段定义
- 脚本：`scripts/rebuild_pinyin.py` - 批量重建脚本
- 数据库：`lab_inventory.db` - 拼音数据和索引
