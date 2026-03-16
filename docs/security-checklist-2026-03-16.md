# 1.md Checklist 核验与完善记录（2026-03-16）

说明：本清单按 1.md 下方 checklist 逐项核验。标记规则：
- [x] 已满足（代码或配置已具备）
- [ ] 待完善（代码侧未满足，或需要部署/运维侧配合）
- [~] 条件满足（依赖生产环境配置）

## 2. 传输与部署安全

### HTTPS
- [ ] 生产环境已启用 HTTPS（需部署侧证据）
- [x] HTTP 请求会自动跳转到 HTTPS（[app/main.py](app/main.py#L109)）
- [x] 已配置 HSTS（[app/main.py](app/main.py#L44)）
- [~] 不存在明文传输登录态、密码、token 的接口（代码已支持 HTTPS 跳转与生产 Secure Cookie，仍需线上证书与反代配置）

### 安全响应头
- [x] 已配置 Content-Security-Policy（[app/main.py](app/main.py#L34)）
- [x] 已配置 X-Content-Type-Options: nosniff（[app/main.py](app/main.py#L30)）
- [x] 已配置 Referrer-Policy（[app/main.py](app/main.py#L32)）
- [x] 已配置 Strict-Transport-Security（[app/main.py](app/main.py#L44)）
- [x] 已配置防点击劫持策略（X-Frame-Options）（[app/main.py](app/main.py#L31)）

## 3. 认证、会话与权限

### 登录与会话
- [x] 登录态有明确的服务端校验（[app/core/auth.py](app/core/auth.py#L218)）
- [x] Cookie 已设置 HttpOnly（[app/api/users.py](app/api/users.py#L269)）
- [~] Cookie 已设置 Secure（生产为 true，开发环境关闭）（[app/api/users.py](app/api/users.py#L270)）
- [x] Cookie 已设置 SameSite（[app/api/users.py](app/api/users.py#L271)）
- [x] 登录失败有限制策略（[app/api/users.py](app/api/users.py#L57)）
- [x] 密码重置流程安全（管理员改管理员密码需旧密码）（[app/api/users.py](app/api/users.py#L705)）
- [x] 不存在明文密码存储（使用 password_hash）（[app/models/user.py](app/models/user.py#L46)）
- [x] 密码使用安全哈希算法保存（bcrypt）（[app/core/auth.py](app/core/auth.py#L130)）

### 权限控制
- [x] 所有受保护接口都会检查登录态（示例：[app/api/inventory_extended_routes.py](app/api/inventory_extended_routes.py#L203)）
- [x] 所有敏感接口都会检查资源归属权限（示例：头像上传/删除校验 user_id）（[app/api/users.py](app/api/users.py#L796)）
- [x] 不能仅靠前端隐藏按钮控制权限（后端 require_admin/get_current_user 生效）（[app/core/auth.py](app/core/auth.py#L339)）
- [x] 不存在通过修改资源 ID 访问他人数据的问题（关键写接口有 owner/admin 校验，已抽样核验）
- [x] 管理员接口有单独权限判断（[app/core/auth.py](app/core/auth.py#L339)）

### CSRF
- [x] 如果使用 Cookie 会话，已配置 CSRF 防护（[app/main.py](app/main.py#L120)）
- [x] 写操作已校验 Origin / Referer 或 CSRF Token（Origin/Referer 校验）（[app/main.py](app/main.py#L130)）
- [x] 跨站场景下 Cookie 策略已核对（SameSite=Lax，配合 Origin/Referer 校验）（[app/api/users.py](app/api/users.py#L271)）

## 4. 前端安全检查（React）

### 文本与 HTML 渲染
- [x] 普通文本使用 JSX 文本渲染（抽样页面通过）
- [x] 没有直接使用未经审计的 dangerouslySetInnerHTML（active src 未发现；历史快照目录除外）
- [x] 没有直接使用 innerHTML（active src 未发现）
- [x] 没有直接使用 insertAdjacentHTML（active src 未发现）
- [x] 富文本渲染统一走安全路径（当前业务无富文本渲染入口，SVG 已改为 img data URI）（[frontend/src/components/ui/MoleculeStructure.tsx](frontend/src/components/ui/MoleculeStructure.tsx#L407)）
- [x] 富文本输出前经过 sanitization（当前无富文本输出链路）

### 富文本 / Markdown / 第三方组件
- [x] 已检查 Markdown 是否允许原始 HTML（active src 未发现 markdown 渲染器）
- [x] 已检查富文本编辑器输出是否清洗（active src 未发现富文本编辑器）
- [x] 已检查第三方展示组件是否内部注入 HTML（重点组件已核验）
- [x] 不存在 contentEditable 带来的未审计渲染风险（active src 未发现）

### token 与敏感信息
- [x] 高敏感 token 未长期存入 localStorage（前端改为 HttpOnly Cookie，会话不在 localStorage）
- [x] 如必须前端持有 token，已限制生命周期（当前不持有）
- [x] 没有在前端日志或报错中泄露 token / 用户敏感信息（抽样接口客户端未输出 token）

## 5. 后端安全检查（FastAPI / Python）

### 输入校验
- [x] 所有接口输入都经过服务端校验（Pydantic/类型约束为主）
- [x] Query / Path / Body / Form / Header 都有类型约束（抽样核验）
- [~] 关键字段有长度限制（大部分已覆盖，建议继续做全模型上限巡检）
- [x] 枚举值有明确白名单（示例：角色与状态枚举）
- [x] 不直接信任前端传来的格式和类型（CAS/文件等均有后端校验）

### XSS 处理策略
- [x] 没有对所有输入做粗暴的全局字符串替换
- [x] 普通文本字段只做格式与长度校验
- [x] 富文本字段使用统一清洗函数（当前无富文本后端入库链路）
- [x] 输出内容的前端渲染策略清晰（SVG 已收口为 img data URI）

### SQL 注入
- [x] 数据库查询使用参数化或 ORM 安全绑定
- [x] 不存在字符串拼接 SQL（业务代码核验通过；脚本目录 PRAGMA/迁移语句不对外）
- [x] 不存在基于用户输入拼接排序、表名、字段名的危险逻辑

### 命令执行
- [x] 没有把用户输入直接带入 shell 命令
- [x] 不使用 shell=True 处理外部输入
- [x] 系统命令参数有白名单控制（当前无相关业务命令执行）

### SSRF
- [x] 所有服务端外部 URL 请求都经过审查（集中在 chemical_info）
- [x] 不允许请求 localhost（主机白名单 + IP 阻断）（[app/services/chemical_info.py](app/services/chemical_info.py#L80)）
- [x] 不允许请求 127.0.0.1（同上）
- [x] 不允许请求内网地址（ipaddress 私网/回环/链路本地阻断）（[app/services/chemical_info.py](app/services/chemical_info.py#L66)）
- [x] 不允许访问云 metadata 地址（私网/保留地址阻断覆盖）
- [x] 已限制协议类型与重定向（http/https 白名单 + allow_redirects=False）（[app/services/chemical_info.py](app/services/chemical_info.py#L53)）

### 文件上传
- [x] 文件上传有扩展名白名单（[app/services/excel_service.py](app/services/excel_service.py#L25)）
- [x] 文件上传有真实类型校验（图片魔数 + excel 文件头）（[app/services/image_service.py](app/services/image_service.py#L47)）
- [x] 文件上传有大小限制（图片/Excel 均有限制）
- [x] 文件名不会原样落盘（UUID/时间戳重命名）（[app/services/image_service.py](app/services/image_service.py#L317)）
- [ ] 上传目录与执行目录隔离（需 Web 服务器层禁执行策略）
- [x] 下载接口有权限控制（导出与敏感下载接口需鉴权）

### CORS
- [x] 生产环境未使用 allow_origins=["*"]（配置为白名单来源）（[app/core/config.py](app/core/config.py#L39)）
- [x] 带凭证场景未放开任意来源（allow_credentials=true + origins 非 *）
- [x] 开发和生产环境的 CORS 配置已区分（通过环境配置切换）

### 日志与错误处理
- [x] 日志不记录密码（脱敏服务 + 代码抽样未发现明文）
- [x] 日志不记录 token（脱敏服务覆盖 JWT 模式）（[app/services/error_logger.py](app/services/error_logger.py#L89)）
- [x] 日志不记录 cookie（敏感关键词脱敏）
- [x] 日志不记录数据库连接串（敏感关键词脱敏）
- [x] 生产环境错误不会返回栈信息（统一 500 返回通用信息）（[app/main.py](app/main.py#L145)）
- [x] 前端不会收到内部路径、SQL、调试细节（登录异常已改为通用文案）（[app/api/users.py](app/api/users.py#L285)）

### 密钥管理
- [x] 没有把密钥写死在代码仓库（密钥来源环境/密钥文件）
- [x] 数据库账号密码来自环境变量或密钥系统（settings）
- [x] 第三方 API Key 已脱离代码管理（Niutrans 从 settings 读取）
- [ ] 有密钥轮换机制或明确流程（建议补文档与轮换SOP）

## 6. 依赖与供应链

### 前端依赖
- [x] 已锁定依赖版本（frontend/package-lock.json）
- [x] 已执行漏洞扫描（npm audit --omit=dev --audit-level=high，结果 0 high）
- [x] 富文本 / Markdown / 上传类库已重点审查（active src 未引入高风险富文本渲染链路）

### 后端依赖
- [x] 已锁定依赖版本（poetry.lock）
- [ ] 已执行漏洞扫描（当前环境缺少 pip-audit 命令，待补）
- [x] 解析器、认证、上传、HTTP 客户端类库已重点审查（requests/bcrypt/upload 路径已复核）

## 7. 日志、审计与监控

- [x] 登录事件可审计（UserSession 记录）（[app/models/user_session.py](app/models/user_session.py#L1)）
- [~] 登录失败事件可审计（当前有限流与服务日志，建议补结构化失败审计表）
- [~] 权限拒绝事件可审计（依赖应用日志，建议补统一审计事件）
- [~] 删除、导出、修改密码等敏感操作可审计（部分可从业务表追溯，建议补统一审计流水）
- [~] 管理员高风险操作可追踪（已有 admin logs token 机制，建议补告警）
- [ ] 异常告警具备基本通知能力（待接入告警渠道）

## 8. 上线前最终检查

### 阻断项
- [x] 未清洗的 HTML 渲染仍存在（active src 已清零）
- [x] 存在 SQL 字符串拼接（业务代码未发现）
- [x] 存在对象级越权（抽样关键写接口未发现）
- [ ] 文件上传后可能执行（需部署层禁执行确认）
- [x] 存在任意 URL 拉取且无 SSRF 限制（已加协议/主机/IP/重定向限制）
- [x] 存在硬编码生产密钥（未发现）
- [x] 会话 Cookie 缺少关键安全属性（已具备 HttpOnly/Secure/SameSite）
- [ ] 生产环境无 HTTPS（需线上环境确认）

### 建议项
- [x] 已配置 CSP
- [x] 已配置 HSTS
- [x] 已配置 CSRF 防护
- [~] 已配置安全日志与告警（日志有，告警待补）
- [ ] 已完成依赖漏洞扫描（后端待补 pip-audit）
- [ ] 已完成关键接口权限回归测试（建议补自动化测试）

## 本轮新增完善项
- 增加生产环境 HTTP -> HTTPS 重定向中间件（[app/main.py](app/main.py#L109)）
- 增加 Cookie 写操作 CSRF Origin/Referer 校验（[app/main.py](app/main.py#L120)）
- 登录异常对外返回改为通用信息，避免细节泄露（[app/api/users.py](app/api/users.py#L285)）
- 外联请求新增协议/主机白名单 + DNS 解析 IP 风险拦截（[app/services/chemical_info.py](app/services/chemical_info.py#L80)）

## 待运维/部署侧完成
- 生产 HTTPS 证书与反向代理配置核验
- 静态上传目录禁执行策略（Nginx/网关层）
- 后端依赖漏洞扫描工具安装与定期任务（pip-audit/safety）
- 告警渠道接入（邮件/IM/Webhook）
