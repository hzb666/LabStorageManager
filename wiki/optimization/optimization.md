# 优化思路

## 这套系统的优化思路

LabStorageManager 的优化不是单点黑科技，而是“前端少渲染、后端少扫表、SQLite 少锁、Redis 少依赖、事件流只补必要增量”的组合策略。真正支撑大列表与高频查询的关键点有五类：

- SQLite WAL 与索引
- FTS 与搜索匹配器
- 拼音预计算与规范化字段
- 前端无限滚动与虚拟列表
- 短 TTL 缓存与 SSE 增量同步

## SQLite WAL 与查询层

### WAL 是并发基线

数据库初始化时，后端会在每个新连接上执行：

- `PRAGMA journal_mode=WAL`
- `PRAGMA foreign_keys=ON`

WAL 让读取和写入可以更平滑地并行，不必每次写操作都把所有读请求锁死。对这个项目尤其重要，因为库存借还、订单审批、导入、公告修改都可能和列表查询同时发生。

### 性能索引不是可选项

`init_db()` 不只是建表，还会执行 `ensure_sqlite_performance_indexes()`。它的意义在于把搜索、排序和聚合常用路径提前索引化，避免列表页在真实数据量上退化成全表扫描。

开发者新增字段后，如果它会进入：

- 列表排序
- 搜索筛选
- 仪表盘聚合
- 设备/会话查询

就要同步评估是否需要补索引。

## FTS 搜索

### 为什么要有 FTS

库存、试剂订单、耗材订单和用户搜索都存在“模糊关键字 + 多字段”的需求。纯 `LIKE` 在数据量上来后会越来越吃力，尤其是：

- 名称、品牌、分类、位置的组合搜索
- 中英文混搜
- 较长关键字的包含匹配

因此项目在 SQLite 启动阶段就会构建这些 FTS5 虚拟表：

- `inventory_fts`
- `reagent_order_fts`
- `consumable_order_fts`
- `users_fts`

并通过触发器保持与主表同步。

### 不是所有搜索都走 FTS

系统并没有把任何关键字都硬塞给 FTS。`search_matchers` 和 `inventory_fts` / `order_fts` 采用“智能选路”：

- 关键字太短时，通常不用 FTS。
- fuzzy 模式下，很多搜索会退回 `LIKE`。
- CAS 精确匹配和前缀匹配优先走普通索引。
- 全字段搜索会先构造候选 ID，再回到 ORM 查询实体。

这类“先选 ID，再查实体”的方式，兼顾了 FTS 的召回能力和业务查询层的可维护性。

## 拼音预计算与规范化

### 拼音字段不是装饰字段

系统并不在查询时临时把中文转拼音，而是在写入或更新时预计算：

- `name_pinyin`
- `name_pinyin_initials`
- `brand_pinyin`
- `category_pinyin`
- `storage_location_pinyin`

这样做有两个好处：

- 排序可以直接走现成字段，而不是运行时做昂贵转换。
- 搜索时可以把中文原文、全拼、首字母一起纳入匹配范围。

### 标准化是去重和命中的前提

CAS、位置、规格等字段在后端都经过标准化。没有这个环节，就会出现：

- `64-17-5`、`64 17 5`、`64175` 被当成不同值
- 位置字符串因为空格、大小写或符号不同导致筛选失真
- 搜索缓存 key 对等价查询重复存储

性能优化不只是“快”，也是“结果稳定”。

## 前端虚拟无限滚动

## 为什么不是传统分页页码

大表格页面使用的是 `useInfiniteQuery` + 虚拟滚动，而不是“用户翻页一次，整页重渲染一次”。目标是：

- 首屏先出前 50 条
- 接近底部时自动拉下一页
- DOM 中只保留视口附近的可见行

### 关键组成

## 运行时与缓存优化补充
- WAL/索引：启动时 `init_db()` 自动创建索引与 FTS，执行 `ANALYZE` + `PRAGMA optimize`，不要跳过 lifespan（<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/main.py#L168-L184" />、<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/database.py#L52-L207" />）。
- 列表缓存：首页无查询参数命中内存缓存 `LIST_CACHE_PREFIX`，写操作会按前缀清理；避免对长列表反复命中数据库（<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/api_utils.py#L22-L69" />）。
- Redis 断路器：Redis 不可用时自动回退数据库/内存，保持可用性但吞吐下降；监控 `X-Redis-Status`（<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/core/redis.py#L30-L120" />）。
- SSE：跨进程序号用 Redis INCR，失败时回退本地计数；慢客户端自动断开，防止背压（<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/sse_manager.py#L136-L225" />）。

## 数据层与搜索优化补充
- FTS tri-gram + 拼音字段支持中英文模糊；当 FTS 异常自动降级 LIKE，确保查询成功但性能下降（<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/search_matchers.py#L120-L207" />）。
- CAS/规格标准化流水线减少重复下单，触发器保证 FTS 同步；新增字段要同步 FTS schema 与触发器。

## 导入导出与 IO 优化
- 上传限额：上传路径在进入路由前被 413 拦截，保护后端免受大文件；新增上传接口需同步 `_is_upload_request`（<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/main.py#L135-L260" />）。
- 批量导入：限制 2MB、逐行校验，失败短路返回，减少内存占用（<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory.py#L551-L720" />）。
- 静态资源：`CachedStaticFiles` 设置 immutable 缓存，降低重复请求（<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/main.py#L150-L352" />）。

## 验证清单
- 启动：日志包含 WAL enabled / FTS initialized；并完成 `PRAGMA journal_mode`、`PRAGMA foreign_keys` 与 FTS 行数一致性核对。
- 搜索：删除一个 FTS 触发器后重启应自动重建；FTS 故障时接口应降级成功返回。
- Redis 故障演练：登录、列表、SSE 应可用但带 `X-Redis-Status: unavailable`；跨实例 SSE 不应工作。
- SSE 背压：模拟慢消费者，连接应被断开且服务无显著内存增长。

- `useTableState` 负责分页参数、搜索、排序、列宽、展开状态和 React Query 缓存。
- `DataTable` 使用 `@tanstack/react-virtual` 的 `useVirtualizer` 控制可视区域。
- `useDataTableScroll` 在接近底部时触发 `fetchNextPage()`，并在展开行时做平滑滚动修正。
- `FilterTable` 负责把表格状态、筛选器、空态、标题和操作栏编排在一起。

### 为什么展开行也能和虚拟滚动共存

展开行会改变真实行高，因此实现里没有偷懒写死高度，而是：

- 根据展开态估算行高
- 在批量展开时调整 overscan
- 用稳定的 item key 避免虚拟项错位复用
- 展开视口上方行时把它平滑滚回可见区域顶部

这部分是二次开发最容易被破坏的地方。如果后续新增“超高展开内容”或“嵌套详情卡片”，要优先验证虚拟高度估算是否仍然成立。

## 缓存层设计

### 后端短 TTL 缓存

列表查询在后端有短 TTL 内存缓存，主要目的是抵消短时间内的重复查询。它适合：

- 同一页面频繁刷新
- 多个组件在很短时间内请求同一列表
- 刚切换筛选条件又回到默认条件

这种缓存不是长期缓存，因此修改数据后需要积极失效。

### Redis 不是全局真理

Redis 在这个项目里主要承担：

- 会话缓存
- 登录限流
- SSE 跨进程 bridge

但它实现了断路器和降级，所以系统不会因为 Redis 一次短故障就完全不可用。优化目标不是“所有东西都进 Redis”，而是“Redis 在时更快，不在时也能继续跑”。

### 浏览器侧状态缓存

前端也有自己的本地状态缓存：

- 列宽
- 展开状态
- 模糊搜索开关
- 扩展导入批次

这让用户在刷新后保持使用连续性，同时避免把纯 UI 偏好同步到后端。

## SSE 与缓存协同

如果只有缓存，没有实时同步，列表会越来越旧；如果只有实时同步，没有缓存，列表页会频繁全量重拉。当前做法是：

1. HTTP 先拿快照。
2. SSE 只做安全范围内的局部 patch。
3. 一旦发现搜索/排序语义可能被破坏，就标记 stale。
4. 由用户或页面显式刷新，重新获取权威快照。

这是一种更稳的优化方式，因为它优先保证一致性，再争取更少的网络和更少的渲染。

## 导入、导出与图片处理

### 导入

导入性能的瓶颈通常不在上传，而在：

- 规格解析
- 批量校验
- 拼音字段生成
- FTS / 索引同步

因此导入相关优化应优先关注批量写入和错误聚合，而不是单纯追求更大的上传上限。

### 导出

导出是“面向用户的文件生成”，不是把页面已有数据简单另存一份。优化重点在于：

- 后端直接生成最终文件
- 前端只负责发起下载
- 避免让浏览器做大批量格式转换

### 图片

图片策略同样带有优化意图：

- 压缩后再落盘
- 数据库只存 URL
- 静态资源走长期缓存

这既减少数据库压力，也让代理层和浏览器缓存更有效。

## 二次开发时的优化检查清单

- 新列表页是否复用了 `useTableState`、`FilterTable` 和 `DataTable` 的既有能力。
- 新搜索字段是否补了索引、FTS 字段和标准化逻辑。
- 新增写操作是否会导致缓存失效和 SSE 广播。
- 新的展开行内容是否验证过虚拟滚动高度估算。
- 新增外部依赖是否像 Redis 一样具备降级策略，而不是一断就拖垮主流程。

## 参考代码
- [app/api/inventory.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory.py)（行551）
- [app/core/redis.py](https://github.com/hzb666/LabStorageManager/blob/main/app/core/redis.py)（行30）
- [app/database.py](https://github.com/hzb666/LabStorageManager/blob/main/app/database.py)（行52）
- [app/main.py](https://github.com/hzb666/LabStorageManager/blob/main/app/main.py)（行135，150，168）
- [app/services/api_utils.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/api_utils.py)（行22）
- [app/services/search_matchers.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/search_matchers.py)（行120）
- [app/services/sse_manager.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/sse_manager.py)（行136）
