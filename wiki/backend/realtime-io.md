# SSE、导入导出与外围能力

本页覆盖三类容易被混在一起的能力：实时事件流、批量导入导出、以及图片/外部信息这类外围服务。它们的共同点是都不直接承载核心业务状态，但会影响前端刷新、数据落地和安全边界。

## SSE 职责

`GET /api/events` 是统一事件流入口。它不负责首屏数据加载，首屏仍然由普通 REST 接口完成；SSE 只处理“列表已加载后，数据又发生变化”的增量同步与 stale 提示。

当前允许的房间包括：

- `inventory`
- `common_shelf`
- `reagent_orders`
- `consumable_orders`
- `dashboard`

客户端使用 `rooms=inventory,common_shelf` 这样的逗号分隔参数订阅，服务端会先校验房间白名单。

## SSE 运行机制

[app/services/sse_manager.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/sse_manager.py) 维护了“本地队列 + Redis bridge”的混合实现：

- 单个浏览器连接对应一个 `SSEClient`，内部保存队列、订阅房间和 `last_seq_by_room`。
- `broadcast()` 先为房间分配递增序号，再推送给本地订阅者。
- Redis 可用时会同步 `publish`，用于多进程或多实例同步。
- `stream()` 持续产出事件，并按固定间隔发送 heartbeat，避免代理层断开长连接。

前端不会无条件接受所有推送：`useListSSE` 只对不影响搜索和排序语义的更新做安全 patch，其余情况会直接标记 stale。

## 导入链路

### Excel 导入

库存导入由 `/api/inventory/import/preview`、`/api/inventory/import/confirm` 和 `/api/inventory/import/template` 共同提供。后端在导入链路中完成以下判定：

- 文件大小、扩展名和内容的早期校验
- 表头与字段映射校验
- 规格解析、CAS 标准化、拼音字段生成
- 预览阶段返回逐行校验结果
- 预览成功后创建绑定用户的一次性令牌，默认有效期 15 分钟
- 确认阶段重新执行完整校验，批量创建库存并在失败时回滚批次

因此前端只负责上传和展示结果，不应复制导入规则。

### 浏览器插件导入

购物车同步也是导入能力，但它分成“采集”和“写入系统”两段：

1. 浏览器插件在外部平台采集购物车与商品详情。
2. popup 把最近一次导入批次写入 `chrome.storage.local`。
3. 导入页桥接脚本把批次复制到页面 `localStorage.cart_import_batch_latest`。
4. 前端导入页逐条调用标准的试剂订单或耗材订单创建接口。

`/api/cart-sync` 用于匹配分析。页面主链路使用标准订单接口，保证导入行为与手工建单一致。

## 导出链路

导出链路属于正式数据输出能力，不能直接转存 REST 列表 JSON：

- 库存、常用货架、试剂订单、耗材订单都支持导出。
- 统一由专门的导出服务生成面向用户的文件结构。
- 前端通过 blob 下载，文件名由页面和后端共同约定。
- 后端按每批 2000 条读取，单次最多导出 20000 条，超出上限时通过响应头返回总数与实际导出数。
- 同一用户在每个导出范围内默认每分钟最多执行 2 次。

新增导出页面沿用“后端生成文件，前端触发下载”的模式。

## 图片与 `/static/`

项目坚持图片不上数据库：

- 头像、公告图片、订单相关图片都写入文件系统。
- 数据库只存 URL 或文件名。
- 运行目录是 `static/`；Docker Compose 中对应 `/data/static`。
- `CachedStaticFiles` 将资源挂载到 `/static/`，并统一写入超长缓存头和安全头。
- Nginx 将 `/static/` 转发到后端，便于不同入口访问。

新增图片类字段时，优先复用 `image_service` 的压缩、命名和路径策略；禁止将二进制写入模型。

## 化学信息服务

[app/services/chemical_info.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/chemical_info.py) 同时承担服务和路由职责：

- 路由是 `GET /api/chemical-info/{cas_number}`。
- 请求会先做 CAS 校验和标准化。
- 英文名优先来自 PubChem，中文名来自 chemblink；必要时可结合翻译能力。
- 内部有独立缓存和外部请求安全限制，避免 SSRF 风险。

这部分能力可复用于入库页、订单页和脚本工具，并通过后端统一对外暴露。前端禁止直接请求第三方站点。

## 补充：房间、序号与降级路径

- 房间白名单：`inventory` / `common_shelf` / `reagent_orders` / `consumable_orders` / `dashboard`，在 `/api/events` 中校验。
- 序号生成优先使用 Redis `INCR`，失败时回退本地计数 `fallback_seq`。
- `sse_manager.broadcast` 会调用 `redis_pubsub.publish`，Redis 不可用时只保留本地推送。
- 慢客户端队列满时会被断开，避免阻塞服务器。
- `event_generator` 会定期发送 `: heartbeat`，前端 `useSSE` 会把 `stale` 作为重连后的刷新信号。

## 补充：导入与导出

- Excel 导入接口限制 2MB，只接受 `csv/xlsx/xls`，逐行错误会汇总返回；确认请求必须携带当前用户对应的一次性预览令牌。
- 购物车导入页主链路对应标准订单创建接口，成功后由订单接口广播相关房间；`/api/cart-sync` 用于匹配分析。
- 导出接口只负责产出文件，通过批次读取、硬上限和用户级限流控制资源占用。

## 边界与风险

- 新增 SSE 房间时，要同时更新服务端白名单和前端订阅列表。
- Redis 不可用时，消息只在当前实例可见，多副本部署会丢失跨实例广播。
- 导入文件超限或格式错误时要正确返回 400/413，前端也需要匹配提示。
- 新增外部数据抓取能力时，要继续沿用 `chemical_info` 的出站访问限制和缓存策略。

## 验证要点

- 手动断开 Redis，确认当前实例仍能广播，但跨实例不可达。
- 压测 SSE，确认慢客户端会被自动断开。
- 上传超 2MB 或不支持的扩展名，确认会立即拒绝。
- 成功导入后，确认 SSE 推送能让前端列表刷新。

## 二次开发规则

- 需要实时同步的新列表，优先复用现有 SSE 房间和 `useListSSE` 模式。
- 新增导入接口时，要同时考虑上传大小限制、缓存失效和 SSE 广播。
- 新增导出接口时，保持“后端生成正式文件格式”的边界。
- 新增外部数据抓取能力时，继续通过后端统一暴露，不要把第三方调用直接暴露给浏览器。

## 参考代码

- [app/api/cart_sync.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/cart_sync.py)
- [app/api/events.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/events.py)
- [app/api/inventory.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory.py)
- [app/services/chemical_info.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/chemical_info.py)
- [app/services/export_batch.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/export_batch.py)
- [app/services/inventory_import_preview_sessions.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/inventory_import_preview_sessions.py)
- [app/services/sse_manager.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/sse_manager.py)
- [app/services/sse_redis.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/sse_redis.py)
