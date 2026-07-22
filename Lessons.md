# Lessons

## 2026-07-20 GitHub 发布版本以 tag 为准

- 现象：发布工作流把 `.env.example` 中的 `APP_VERSION` 也纳入版本一致性校验。
- 原因：混淆了发布身份来源与部署配置示例；环境文件不会随生产部署保持为可靠的发布元数据。
- 做法：GitHub Release 以触发工作流的 `v*` tag 为唯一版本来源，只校验仓库中的包和源码元数据是否与 tag 一致；`.env.example` 仅作为配置文档，不参与发布门禁。

## 2026-07-20 全局操作时间线的操作者需要主体兜底

- 现象：管理面板中的部分“用户退出”日志显示操作者为“系统”。
- 原因：部分用户自身动作没有 `actor_user_id`，但 `subject_user_id` 仍指向实际用户；只按 actor 查姓名会丢失归属。
- 做法：全局近期操作优先使用 `actor_user_id`，缺失时回退到 `subject_user_id`；仅两者都为空时显示“系统”。

## 2026-07-20 Ruff 执行环境以仓库命令为准

- 现象：使用虚拟环境解释器执行 `python -m ruff` 时提示未安装 Ruff。
- 原因：仓库把 Ruff 作为系统级开发工具使用，项目虚拟环境只包含运行依赖。
- 做法：按项目文档直接运行 `ruff check ...`；虚拟环境解释器仅用于需要项目运行依赖的 Python 检查脚本。

## 2026-07-20 文件接口错误解析与导出防重入

- 现象：普通 JSON 接口能显示后端中文错误，但导出接口同样的错误退回 Axios 英文状态；按钮快速点击还会额外消耗导出限流次数。
- 原因：`responseType: 'blob'` 同时作用于成功和失败响应，错误体必须异步读取；仅依赖 React state 禁用按钮，在重新渲染前仍存在同帧重复触发窗口。
- 做法：文件接口统一使用异步错误解析器读取 Blob 中的 `detail`，未知纯英文错误回退到中文场景文案；共享异步动作同时使用 LoadingButton 和同步 ref guard，分别负责交互反馈与请求防重入。

## 2026-07-20 错误语言与机器契约必须分层

- 现象：为了让 Blob 导出错误显示中文，后端限流包装器直接返回了中文 `detail`，造成浏览器显示正确但 API 契约违反后端英文规范。
- 原因：把传输层错误解析、机器可读错误分类和用户展示文案混成了同一个字符串；前端依赖后端展示文本，CLI 又依赖 `detail` 为字符串，不能直接把它改成对象。
- 做法：保持 `{ detail: string }` 向后兼容并使用英文详情；另用 `X-Error-Code` 提供稳定英文错误码，参数通过 `Retry-After` 等标准头传递；前端按错误码优先汉化、英文详情仅作兼容兜底。

## 2026-07-20 导入模板与解析器必须共享表头契约

- 现象：系统自己生成的 Excel 模板原样上传也无法通过预览，且具体缺列原因被通用英文错误覆盖。
- 原因：模板给必填列增加了展示标记，但解析器按完整字符串匹配；生成端与消费端各自维护了隐式表头规则。
- 做法：解析展示型表头时先规范化可选标记，再匹配业务字段；为“生成模板后立即预览”增加回归验证；可预期校验错误应保留到 API 边界，并在前端统一本地化。

## 2026-07-20 Web 字体不得作为首屏显示门禁

- 现象：Google Fonts 仅比 1 秒阈值慢约几百毫秒，却触发 8 MB 本地字体回退，并让整个页面保持不可见约 18 秒。
- 原因：把字体“加载完成”错误地当成页面“允许显示”的前置条件，且 `Promise.race` 超时只结束等待，不会取消仍在进行的网络请求。
- 做法：首屏先用系统字体渲染，Web Font 只做后台渐进增强；不要用整页 `visibility: hidden` 避免字体切换，也不要用短超时把可恢复的字体延迟放大成重复下载。

## 2026-07-19 前端集合排序兼容性

- 现象：高亮区间合并首次使用 `Array.prototype.toSorted()`，TypeScript 生产构建报 `TS2550`。
- 原因：当前项目的 TypeScript `lib` 目标未包含 ES2023；ESLint 不会发现运行库目标缺失。
- 做法：需要非变异排序时使用 `[...items].sort(...)`，并在声明完成前运行正式 `npm run build` 验证 TypeScript 目标兼容性。

## 2026-07-19 输入预测层文本基线

- 现象：搜索输入预测后缀与用户已输入文字没有完全对齐，预测文字略微偏上。
- 原因：真实 `Input` 强制使用 40px 行高，而覆盖层的预测文字使用 16px 行高并单独居中，两套文本排版上下文产生了基线偏差。
- 做法：覆盖层需要复用真实输入框的字体与行高，并让前缀占位和预测后缀从同一容器继承排版样式；不要用 `translate-y` 等像素偏移掩盖差异。
# React state must wrap stored callback values

- Passing a callback directly to a React state setter treats it as an updater and invokes it.
- When state intentionally stores a function identity, use `setState(() => callback)`.
- Confirm destructive UI behavior in a live browser because static control-flow review will not expose this runtime distinction.

# Validate temporary paths with the platform separator

- Build Windows containment-check prefixes with `Path.DirectorySeparatorChar`; a quoted `\\` can accidentally represent two separators and reject a valid child path.

## 2026-07-21 导入预览必须覆盖最终持久化约束

- 现象：批量导入预览可接受负数、无穷值、超长文本、非法危险品值和非法日期，确认后才可能形成不符合业务约束的数据。
- 原因：SQLModel 表模型直接构造和 SQLite 的 `VARCHAR` 长度声明不会自动形成可靠的写入门禁，宽松解析还会把非法值静默降级为默认值。
- 做法：预览与确认复用同一准备流程；文本长度从模型元数据读取，数量显式检查有限非负范围，非空布尔值和日期解析失败必须按行报错。

## 2026-07-21 派生实体索引的删除必须使用删除语义

- 现象：试剂和耗材订单删除后，搜索补全索引仍保留该订单的数据并持续累积。
- 原因：删除路由复用了更新路径的缓存清理函数，提交后又同步了一次已删除的 ORM 对象。
- 做法：业务删除提交后必须按端点和实体 ID 删除派生索引，不能同步已删除对象；对已有孤儿数据使用持久化索引版本触发一次性全量重建，重建成功后再清除待重建标记。

## 2026-07-22 虚拟列表不要永久提升每一行为合成层

- 现象：虚拟表格滚动流畅，但部分行的 Arial 和中文文字比普通表格更灰、更虚。
- 原因：为了避免滚动重绘，对每个虚拟行永久设置 `translate3d + will-change: transform`，把一次性能提示变成了逐行固定光栅策略。
- 做法：先用同一浏览器工作负载建立帧间隔、慢帧、脚本耗时和合成层基线；虚拟行使用取整的二维位移，把层提升交给浏览器判断；优化必须同时通过清晰度门禁和性能预算。

## 2026-07-22 依赖族升级后必须验证干净安装

- 现象：锁文件已声明一致版本，但现有 `node_modules` 中 Ketcher 三包版本不同，构建阶段才暴露缺失导出。
- 原因：`npm install --package-lock-only` 和 `npm audit fix --package-lock-only` 只更新锁文件，不会修复当前安装树；运行中的 Vite 还可能锁定原生模块，使 `npm ci` 无法清理目录。
- 做法：紧密耦合的依赖族使用相同精确版本；升级后先停止占用依赖文件的开发进程，再用项目规定的 Node/npm 版本执行 `npm ci`，并以 `npm ls`、类型检查和生产构建共同验证。

## 2026-07-22 静态站点 base 必须由部署目标决定

- 现象：同一份 VitePress 配置用于不同子路径时，HTML 可以返回，但 CSS、JavaScript 和站内链接会指向另一个部署前缀。
- 原因：VitePress 在构建阶段把 `base` 写入静态资源和内部链接，部署服务器无法从访问路径自动修正产物内容。
- 做法：为每个部署目标分别构建；本地配置使用服务器默认前缀，CI 通过构建环境变量显式覆盖目标前缀，并检查生成 HTML 中的资源路径。
