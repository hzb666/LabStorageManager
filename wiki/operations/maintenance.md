# 日常维护

## 维护重点

这个项目的维护重点不只在数据库，还包括：

- 用户与会话
- Redis 可用性
- static 目录中的图片资源
- 浏览器扩展与导入页桥接

## 推荐巡检项

1. `/health` 是否正常
2. 登录、登出、设备管理是否正常
3. 主要列表页是否还能正常加载与筛选
4. 扩展导入链路是否还可用
5. static 图片访问是否正常

## 文档维护原则

- 以代码为准
- 修改了关键流程时，同步更新对应 wiki 页面
- 不把一次性的计划稿、审计稿直接塞进正式 wiki

## 参考代码

- `app/models/user_session.py:13`
- `app/models/announcement.py:14`
- `docker-compose.yml:41`
- `browser-extension/content/import-bridge.js:15`
