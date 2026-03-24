# 术语表

## 核心业务术语

- `试剂订单`：面向试剂采购的订单对象，后续可能进入库存
- `耗材订单`：面向耗材采购的订单对象，不进入试剂库存链路
- `库存`：试剂入库后生成的瓶级记录
- `常用货架`：库存的一种使用场景，通过 `is_common` 维度与普通库存区分
- `借用日志`：记录借出和归还信息的历史表
- `一键入库`：把试剂订单批量转换为库存记录的动作
- `到货确认`：订单审批后，由申请人或相关人员确认货物已到
- `归还`：借用后填报剩余量并回写库存状态
- `剩余百分比`：`remaining_quantity / initial_quantity`
- `CAS`：化学品标识字段，系统会做标准化和搜索

## 技术术语

- `WAL`：SQLite 的 Write-Ahead Logging 模式，提高并发读写体验
- `FTS`：全文检索，当前实现使用 SQLite FTS5 trigram
- `拼音字段`：为中文排序和检索预计算的拼音及首字母字段
- `SSE`：Server-Sent Events，后端向前端推送列表更新
- `HTTPOnly Cookie`：登录态存储方式之一，前端脚本不可直接读取
- `Bearer Token`：另一种认证方式，常用于 API 调试或非浏览器场景
- `CSRF`：跨站请求伪造防护，Cookie 场景下要额外校验来源
- `Persist Storage`：Zustand 的持久化能力，用于保存认证状态和界面状态
- `Query Key`：TanStack Query 用于识别与缓存请求结果的键
- `Infinite Query`：分页列表的一种前端取数方式

## 系统角色术语

- `admin`：管理员
- `user`：普通成员
- `public`：受限公共账号
- `temporary_keeper`：暂管人，通常与待补位置或待处理库存有关
- `created_by`：创建人
- `applicant`：订单申请人
- `borrower`：借用人

## 参考代码

- `app/models/user.py:19`
- `app/models/reagent_order.py:107`
- `app/models/consumable_order.py:17`
- `app/models/user_session.py:13`
- `app/database.py:120`
