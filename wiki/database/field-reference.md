# 字段参考

本页按业务语义解释主要表里的关键字段，而不是重复展示 schema dump。它更适合作为字段职责速查表；如果要先理解实体之间的关系，可以先看 [数据模型](/database/data-model)。

## `users`

| 字段 | 含义 | 说明 |
| --- | --- | --- |
| `id` | 主键 | 用户唯一标识 |
| `username` | 登录名 | 唯一，受格式限制 |
| `password_hash` | 密码哈希 | 不对外返回 |
| `full_name` | 显示姓名 | 前端常用展示名 |
| `role` | 角色 | `admin` / `user` / `public` |
| `is_active` | 启用状态 | 禁用后不可正常使用 |
| `avatar_url` | 头像地址 | 指向 `/static/` 上传资源，不存二进制 |
| `username_version` | 用户名版本号 | 用于使旧 token 失效 |
| `full_name_pinyin` | 姓名拼音 | 排序和搜索辅助 |
| `full_name_pinyin_initials` | 姓名首字母 | 搜索辅助 |
| `created_at` / `updated_at` | 创建和更新时间 | 审计字段 |

## `user_sessions`

| 字段 | 含义 | 说明 |
| --- | --- | --- |
| `id` | 主键 | 会话记录 id |
| `user_id` | 归属用户 | 关联 `users.id` |
| `device_id` | 设备唯一标识 | 前端 / 浏览器生成 |
| `device_name` | 设备名称 | 便于设备管理页面展示 |
| `ip_address` | 初始登录 IP | 登录时记录 |
| `last_ip_address` | 最近活动 IP | 运行中更新 |
| `user_agent` | 浏览器 / 设备 UA | 设备识别辅助 |
| `token_hash` | token 哈希 | 会话检索关键字段 |
| `created_at` | 首次登录时间 | 审计字段 |
| `last_active_at` | 最后活跃时间 | 会话活跃刷新依据 |
| `expires_at` | 绝对过期时间 | 清理会话依据 |

## `reagent_order`

### 标识与基础信息

| 字段 | 含义 |
| --- | --- |
| `id` | 订单 id |
| `cas_number` | CAS 号，试剂最关键业务标识 |
| `name` | 中文名 |
| `english_name` | 英文名 |
| `alias` | 别名 |
| `category` | 分类 |
| `brand` | 品牌 |

### 规格与采购信息

| 字段 | 含义 |
| --- | --- |
| `initial_quantity` | 单瓶初始量 |
| `unit` | 规格单位 |
| `quantity` | 申购瓶数 |
| `price` | 价格 |
| `order_reason` | 申购原因 |
| `is_hazardous` | 是否危险品 |
| `notes` | 备注 |

### 流程与追溯

| 字段 | 含义 |
| --- | --- |
| `applicant_id` | 申请人 |
| `status` | 订单状态 |
| `created_at` / `updated_at` | 创建与更新时间 |
| `name_pinyin` / `category_pinyin` / `brand_pinyin` | 搜索与排序辅助字段 |
| `*_initials` | 拼音首字母搜索辅助 |

## `consumable_order`

| 字段 | 含义 | 说明 |
| --- | --- | --- |
| `id` | 订单 id | 主键 |
| `name` | 名称 | 耗材中文名 |
| `english_name` | 英文名 | 可选 |
| `product_number` | 货号 | 外部采购平台对接常用 |
| `specification` | 规格型号 | 直接保留原始字符串 |
| `unit` | 单位 | 可选 |
| `quantity` | 数量 | 必填 |
| `price` | 价格 | 可选 |
| `communication` | 沟通信息 | 补充采购沟通内容 |
| `notes` | 备注 | 自由文本 |
| `applicant_id` | 申请人 | 关联用户 |
| `status` | 状态 | `pending/approved/rejected/completed` |
| `name_pinyin` / `name_pinyin_initials` | 搜索辅助 | 拼音和首字母 |
| `created_at` / `updated_at` | 审计时间 | 列表排序常用 |

## `inventory`

### 基础识别

| 字段 | 含义 | 说明 |
| --- | --- | --- |
| `id` | 主键 | 库存记录 id |
| `internal_code` | 内部编号 | 每瓶库存唯一编号 |
| `cas_number` | CAS 号 | 试剂识别关键字段 |
| `name` | 中文名 | 搜索和展示常用 |
| `english_name` | 英文名 | 可选 |
| `alias` | 别名 | 可选 |
| `category` | 分类 | 搜索和筛选辅助 |
| `brand` | 品牌 | 搜索和筛选辅助 |

### 位置与数量

| 字段 | 含义 | 说明 |
| --- | --- | --- |
| `storage_location` | 存放位置 | 位置搜索、货架管理 |
| `initial_quantity` | 初始数量 | 单瓶或单条库存原始量 |
| `remaining_quantity` | 剩余数量 | 当前可用量 |
| `remaining_percent` | 剩余比例 | 为排序和筛选预计算 |
| `unit` | 单位 | 规格单位 |

### 状态与归属

| 字段 | 含义 | 说明 |
| --- | --- | --- |
| `status` | 库存状态 | `in_stock`、`borrowed` 等 |
| `borrower_id` | 当前借用人 | 借出时使用 |
| `last_borrower_id` | 上一次借用人 | 用于追溯 |
| `temporary_keeper_id` | 临时保管人 | 常用货架或交接场景 |
| `created_by_id` | 创建人 | 手动入库 / 导入时记录 |
| `source_order_id` | 来源试剂订单 | 订单复制入库的追溯链路 |

### 展示与搜索辅助

| 字段 | 含义 |
| --- | --- |
| `is_hazardous` | 是否危险品 |
| `notes` | 备注 |
| `name_pinyin` / `category_pinyin` / `brand_pinyin` / `storage_location_pinyin` | 拼音排序和搜索辅助 |
| `*_initials` | 首字母搜索辅助 |
| `created_at` / `updated_at` | 审计时间 |

## `borrowlog`

| 字段 | 含义 | 说明 |
| --- | --- | --- |
| `id` | 主键 | 借还日志 id |
| `inventory_id` | 对应库存 | 关联 `inventory.id` |
| `borrower_id` | 借用人 | 关联 `users.id` |
| `borrow_time` | 借出时间 | 默认创建时记录 |
| `return_time` | 归还时间 | 未归还时为空 |
| `quantity_borrowed` | 借出数量 | 必填 |
| `quantity_returned` | 归还数量 | 部分归还时有意义 |
| `notes` | 备注 | 借还说明 |
| `created_at` | 记录创建时间 | 审计字段 |

## `common_shelf`

| 字段 | 含义 | 说明 |
| --- | --- | --- |
| `id` | 主键 | 常用货架瓶级记录 id |
| `internal_code` | 内部编号 | 每瓶常用货架库存唯一编号 |
| `cas_number` | CAS 号 | 分组和查询关键字段 |
| `name_snapshot` | 名称快照 | 分组显示名称 |
| `brand` / `brand_normalized` | 品牌与归一化品牌 | 分组、合并和显示 |
| `specification_text` / `specification_normalized` | 规格文本与归一化规格 | 分组和合并 |
| `spec_quantity` / `spec_unit` | 规格数量与单位 | 由规格解析得到 |
| `storage_location` / `storage_location_normalized` | 位置与归一化位置 | 位置统计和筛选 |
| `storage_location_pinyin` / `storage_location_pinyin_initials` | 位置拼音与首字母 | 位置搜索辅助 |
| `source_order_id` | 来源试剂订单 | 从试剂订单入常用货架时保留来源 |
| `created_by_id` | 创建人 | 手工添加或入库操作人 |

## `common_shelf_group`

| 字段 | 含义 | 说明 |
| --- | --- | --- |
| `id` | 主键 | 分组记录 id |
| `cas_number` | CAS 号 | 分组身份的一部分 |
| `brand_normalized` | 归一化品牌 | 分组身份的一部分 |
| `specification_normalized` | 归一化规格 | 分组身份的一部分 |
| `is_deleted` | 是否删除 | 删除后释放活动分组唯一约束 |
| `deleted_at` | 删除时间 | 软删除审计字段 |

## `announcements`

| 字段 | 含义 | 说明 |
| --- | --- | --- |
| `id` | 主键 | 公告 id |
| `title` | 标题 | 首页和列表展示 |
| `content` | 正文 | 支持较长文本 |
| `images` | 图片 URL 列表 | JSON 数组，不存图片本体 |
| `is_pinned` | 是否置顶 | 决定排序优先级 |
| `is_visible` | 是否可见 | 控制前台展示 |
| `created_by` | 创建人 | 关联管理员 |
| `created_at` / `updated_at` | 审计时间 | 展示和排序使用 |

## `compound_structure_cache`

| 字段 | 含义 | 说明 |
| --- | --- | --- |
| `cas_number` | 主键 | 标准化 CAS |
| `smiles_canonical` / `smiles_isomeric` | SMILES | 结构检索和展示 |
| `molblock` | MolBlock | 人工结构和结构编辑器交换格式 |
| `inchikey` | InChIKey | 结构身份辅助 |
| `english_name` / `chinese_name` | 外部名称缓存 | 用于结构检索结果展示 |
| `source` / `source_id` | 结构来源 | PubChem、人工或其他来源 |
| `status` | 解析状态 | `pending/resolved/ambiguous/not_found/...` |
| `candidate_count` / `candidates_json` | 候选信息 | CAS 对应多个候选时使用 |
| `manually_verified` | 人工确认标记 | 防止自动解析覆盖人工结构 |

## `log_timeline`

| 字段 | 含义 | 说明 |
| --- | --- | --- |
| `id` | 主键 | 日志读模型 id |
| `occurred_at` | 发生时间 | 时间线排序字段 |
| `is_cli` | 是否来自 CLI | 区分脚本入口和浏览器入口 |
| `actor_user_id` | 操作人 | 关联用户 |
| `subject_user_id` | 受影响用户 | 用户日志筛选字段 |
| `source_table` / `source_log_id` | 源日志定位 | 指向库存、订单、常用货架、用户或借还日志 |
| `search_text` / `search_text_pinyin` | 主搜索文本 | 物料名、CAS 和拼音 |
| `detail_search_text` | 详情搜索文本 | 操作说明、数量、状态等可搜索内容 |

## DTO 与表字段

除了数据库表字段外，项目里还有很多 `Create`、`Update`、`Response` 模型。它们通常有三类差异：

- `Create` 模型更贴近前端输入。
- `Update` 模型通常是可选字段集合。
- `Response` 模型会补充计算字段和显示名。

例如：

- `InventoryResponse` 会带 `specification` 和多种 `*_name`。
- `ReagentOrderCreate` 接收 `specification`，后端再拆成 `initial_quantity + unit`。

## 参考代码

- [app/models/announcement.py](https://github.com/hzb666/LabStorageManager/blob/main/app/models/announcement.py)
- [app/models/common_shelf.py](https://github.com/hzb666/LabStorageManager/blob/main/app/models/common_shelf.py)
- [app/models/compound_structure.py](https://github.com/hzb666/LabStorageManager/blob/main/app/models/compound_structure.py)
- [app/models/consumable_order.py](https://github.com/hzb666/LabStorageManager/blob/main/app/models/consumable_order.py)
- [app/models/inventory.py](https://github.com/hzb666/LabStorageManager/blob/main/app/models/inventory.py)
- [app/models/log_timeline.py](https://github.com/hzb666/LabStorageManager/blob/main/app/models/log_timeline.py)
- [app/models/reagent_order.py](https://github.com/hzb666/LabStorageManager/blob/main/app/models/reagent_order.py)
- [app/models/user.py](https://github.com/hzb666/LabStorageManager/blob/main/app/models/user.py)
- [app/models/user_session.py](https://github.com/hzb666/LabStorageManager/blob/main/app/models/user_session.py)
