# SSE、导入导出与外围能力

## SSE 的职责

`GET /api/events` 是系统的统一事件流入口。它不承担首屏数据加载，首屏依旧通过普通 REST 获取；SSE 负责的是“有人修改了列表，而你此刻正在看这个列表”这一场景下的增量同步与 stale 提醒。

事件流当前支持的房间包括：

- `inventory`
- `common_shelf`
- `reagent_orders`
- `consumable_orders`
- `dashboard`

客户端通过 `rooms=inventory,common_shelf` 这种逗号分隔方式订阅，服务端会校验房间是否在允许集合内。

## SSE 运行机制

<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/sse_manager.py" /> 维持一套“本地队列 + Redis bridge”的混合实现：

- 单个浏览器连接对应一个 `SSEClient`，内部有队列、订阅房间和 `last_seq_by_room`。
- `broadcast()` 先为房间分配递增序号，再把事件推送到本地订阅者。
- 若 Redis 可用，还会同时 publish，用于多进程或多实例之间同步。
- `stream()` 会持续产出事件，并按固定心跳间隔发送 heartbeat，防止代理层把连接当成闲置连接断开。

前端不会盲目信任所有推送：`useListSSE` 只对“命中当前已加载记录、且不影响搜索/排序语义”的更新做安全 patch，其余情况直接标记 stale，让用户刷新。

## 导入链路

### Excel 导入

库存导入由 `/api/inventory/import` 提供，重点并不只是“上传一个文件”，而是后端会在服务层完成这些动作：

- 文件大小、扩展名与内容的早期校验
- 表头与字段映射校验
- 规格解析、CAS 标准化、拼音字段生成
- 批量创建库存
- 在必要时回滚失败批次

因此二次开发时不要把导入逻辑复制到前端，前端只负责上传和展示结果。

### 浏览器扩展导入

购物车同步也属于导入能力，但它分成“采集”和“写入系统”两段：

1. 扩展在北医试剂平台采集购物车与商品详情。
2. popup 把最近一次导入批次写入 `chrome.storage.local`。
3. 导入页桥接脚本把批次复制到页面 `localStorage`。
4. 前端再调 `/api/cart-sync` 和 `/api/cart-sync/import`。

这使得扩展可以独立升级采集逻辑，而后端只需要维护最终订单写入接口。

## 导出链路

导出不是 REST 列表 JSON 的简单转存，而是正式的数据输出能力：

- 库存、常用货架、试剂订单、耗材订单都支持导出。
- 统一由专门的导出服务生成面向用户的文件结构。
- 前端通过 blob 下载，文件名由页面或后端共同约定。

如果新增新的导出页面，建议继续沿用“后端生成文件，前端只负责触发下载”的模式。

## 图片与静态资源

这个项目坚持图片不上数据库：

- 头像、公告图片、订单相关图片都写入文件系统。
- 数据库只存 URL 或文件名。
- `CachedStaticFiles` 为静态资源统一打上超长缓存头和安全头。
- Nginx 同时转发 `/static/` 和 `/api/static/`，便于不同入口访问。

开发者如果新增图片类字段，应优先复用 `image_service` 的压缩、命名和路径策略，而不是直接把二进制写进模型。

## 化学信息服务

<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/chemical_info.py" /> 同时扮演了“服务”和“路由”角色：

- 路由是 `GET /api/chemical-info/{cas_number}`。
- 它会先做 CAS 校验和标准化。
- 英文名优先来自 PubChem，中文名来自 chemblink；必要时可结合翻译能力。
- 内部有独立缓存和外部请求安全限制，避免 SSRF 风险。

这部分能力很适合被复用于入库页、订单页、脚本工具，但应继续通过后端统一对外暴露，不建议让前端直接请求第三方站点。

## 二次开发建议

## 补充：房间、序号与降级路径
- 房间白名单：`inventory` / `common_shelf` / `reagent_orders` / `consumable_orders` / `cart_sync`，在 `/api/events` 校验（<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/events.py#L21-L77" />）。
- 序号生成：优先 Redis INCR（跨进程全局顺序），失败时回退本地计数 `fallback_seq`（<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/sse_manager.py#L136-L168" />）。
- 发布与订阅：`sse_manager.broadcast` 调用 `redis_pubsub.publish`，Redis 不可用则跳过远端仅本地推送（<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/sse_redis.py#L24-L43" />）。
- 慢客户端：本地队列满会按阈值断开，避免阻塞服务器（<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/services/sse_manager.py#L175-L225" />）。
- 心跳：`event_generator` 定期发送 `: heartbeat` 保持连接；前端 `useSSE` 识别 `stale` 并在重连后全量刷新。

## 导入/导出补充
- Excel 导入接口：限制 2MB、只接受 csv/xlsx/xls，逐行错误会汇总返回（<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory.py#L551-L720" />）。
- 购物车导入：见 `/api/cart-sync/sync` 与 `/api/cart-sync/import` 两步，导入后广播相关房间（<InlineCodeRef href="https://github.com/hzb666/LabStorageManager/blob/main/app/api/cart_sync.py#L25-L241" />）。
- 导出：库存/订单导出接口完成后不会写缓存，只产出文件供下载。

## 边界与风险
- 新增 SSE 房间必须同时更新 `ALLOWED_SSE_ROOMS` 和前端订阅列表；否则订阅会被拒绝 400。
- Redis 不可用时消息只在单进程内可见，多副本部署会丢失跨实例广播。
- 导入文件超限或格式错误需正确返回 400/413，前端需提示用户；模板变更要同步下载模板。

## 验证建议
- 手动断开 Redis：发布事件应仍在当前实例生效，但跨实例不可达；`X-Redis-Status` 应提示 unavailable。
- 压测 SSE：模拟慢客户端，应被自动断开且服务器不积压。
- 导入：超 2MB 或非受支持扩展名应立即拒绝；成功导入后 SSE 推送应让前端列表刷新。

- 需要实时同步的新列表，优先复用现有 SSE 房间和 `useListSSE` 模式，而不是为局部页面单独发明另一套同步协议。
- 新增导入接口时，要同时考虑上传大小限制、缓存失效和 SSE 广播。
- 新增导出接口时，保持“后端生成正式文件格式”的边界，不要把导出格式逻辑下沉到前端。
- 新增外部数据抓取能力时，参考 `chemical_info` 的出站访问限制和缓存策略，避免把第三方调用直接暴露给浏览器。

## 参考代码
- [app/api/cart_sync.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/cart_sync.py)（行25）
- [app/api/events.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/events.py)（行21）
- [app/api/inventory.py](https://github.com/hzb666/LabStorageManager/blob/main/app/api/inventory.py)（行551）
- [app/services/chemical_info.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/chemical_info.py)
- [app/services/sse_manager.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/sse_manager.py)（行136，175）
- [app/services/sse_redis.py](https://github.com/hzb666/LabStorageManager/blob/main/app/services/sse_redis.py)（行24）


