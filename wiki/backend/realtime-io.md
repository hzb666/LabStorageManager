# SSE、导入导出与外围能力

## SSE 的角色

当前系统通过 `/api/events` 提供 SSE 订阅入口。它的价值不是聊天式流式输出，而是让前端列表在库存、订单、常用货架变化后更快同步。

## 导入

后端支持库存导入，重点不是“上传文件”本身，而是：

- 解析规格
- 校验字段
- 批量创建记录
- 在必要时整批失败回滚

这决定了导入链路必须依赖服务层而不是只在路由里做浅层处理。

## 导出

项目里存在专门的 `xlsx_export` 服务，说明导出不是简单把列表 JSON 直接塞给前端，而是把面向用户的导出格式也当成正式能力维护。

## 图片

图片不进数据库，而是落在文件系统，由数据库保存 URL 或路径。这一策略适用于头像和公告图片，也与 Nginx 的 `/static` 转发配合。

## 化学信息

`chemical_info` 是一个值得注意的例外：它作为服务模块直接参与路由暴露，说明这个仓库里“服务”和“API”边界并不总是严格按目录分层。

## 参考代码

- `app/api/events.py:1`
- `app/services/sse_manager.py:1`
- `app/services/xlsx_export.py:1`
- `app/services/image_service.py:1`
- `app/services/chemical_info.py:1`
- `app/main.py:33`
