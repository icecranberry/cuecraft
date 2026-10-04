# 球杆作品分享与智能客服发布

状态：implemented
类型：feature
Owner：backend/package/yuxi/services/customer_service_service.py

## 问题

球杆作品只有登录后的预览和管理员 SKU 导入入口；作品成本分析缺少 Skill 选择、持久对话和版本上下文。厂家还不能用 Yuxi Agent 搭建可测试、可发布的匿名客服入口，也无法确认公开分享指向哪一版配置。

## 决策

- 作品分享固定到创建时的 `CueDesignVersion`，并保存创建时标题。所有者可以撤销链接；撤销后公开快照和素材图片均不可读。
- 每个作品保留一条 AI 对话历史，Skill 从当前用户可访问的 Yuxi Skills 中选择。成本预测自动使用 `cue-cost-estimation`；矢量转换入口使用 `cue-vector-conversion-placeholder` 并只说明尚未实现。成本输出标记为非正式人民币估算。
- 作品级 AI 可以读取当前用户保存的作品快照。SKU 表单写入厂家共享目录，并保留来源作品版本；只收录设计者填写或确认的目录字段，不将估价、BOM 或工艺路线写成制造事实。
- 客服草稿与已发布配置分开保存。发布时复制 Agent 配置为仅所有者可见的快照。分享、iframe、Webhook 和 MCP 均使用可轮换、可撤销的匿名凭据；客服测试对话与外部客户对话使用不同来源和线程空间。
- iframe 发布要求精确的 Origin 白名单；Webhook 使用 Bearer 凭据、幂等键与 Redis 限流；MCP 由单独的 Streamable HTTP JSON-RPC 入口提供客服会话工具，不复用 Yuxi 出站 MCP 客户端配置。

### 实现方案

`cue_sharing_service` 负责固定作品版本、素材授权和作品级 Skill 对话；`cue_service` 负责从指定作品版本写入共享 SKU。`customer_service_service` 保存草稿、复制已发布 Agent 快照、校验凭据与接入模式，并通过现有 AgentRun 链路处理内部测试和匿名客户消息。两个 FastAPI 路由模块适配登录态与公开 HTTP 协议；Vue 页面只通过 `src/apis` 发起 Yuxi API 请求，公开页在无登录状态下加载分享内容和客服对话。

## 替代方案

- 只提供链接而不固定作品或 Agent 版本，会让后续修改静默改变已发出的内容。
- 仅允许管理员导入 SKU，会打断设计师从已完成作品建立目录项的流程。
- 把 MCP 展示为 Yuxi 出站 `/api/system/mcp-servers`，会误把客户端连接配置当成可供外部连接的服务端工具。

## 后果

- 用户可从作品菜单分享指定版本、预测成本、进入矢量转换占位提示或填写 SKU 表单；作品级 AI 对话及当前 Skill 会持久化。
- 成本区间是模型推断，不能代表厂家报价；SKU 来源规格代表目录录入结果，不等于已核实的制造工艺。
- 客服发布快照作为普通 Agent 的受限内部记录进入现有 AgentRun 主链路。匿名客服请求以部署所有者作为数据 Owner，运行超时会返回明确错误，原 Run 可在 Yuxi 历史中核查。
- 公共凭据只在创建或轮换时返回明文；数据库只保存摘要。轮换令旧凭据立即失效，撤销会关闭所有公开入口。

## 验证

- 真实 PostgreSQL Schema 升级：`test_schema_migration_version.py` 13 项通过，包含从 v11 升级到 v12 并重复执行。
- 当前本地数据库版本为 business=12、knowledge=2，分享、作品助手与客服部署表均已存在；无需再次运行存储迁移。
- 客服管理 HTTP 生命周期与匿名入口：`test_customer_service_api.py` 因本机未配置 `TEST_USERNAME` / `TEST_PASSWORD` 跳过；FastAPI HTTP router 单测的 MCP 和 Webhook 正向路径通过。
- 后端相关单测 50 项通过，覆盖 Skill 发现、作品契约、模式与 Origin 校验、MCP JSON-RPC、Webhook、嵌入标题转义和迁移编排。
- Web lint、`typecheck:cue` 与 production build 通过。完整 Web 单测 397 项中 395 项通过；另外 2 项失败分别是品牌标题仍断言 `Yuxi`，以及数据库存储测试被 React `jsx` 弃用警告输出干扰。
- 浏览器已在 `http://localhost:5175/customer-service` 确认导航、测试对话空态和右侧配置/分享/Webhook/MCP 面板正常渲染；尚未通过页面点击完成发布后客户消息的端到端验证。
- 后端全量单测首次汇总 5 项失败：3 项由本工作树内已新增的 Cue Agent 与 Skills 未进入原精确清单引起，已更新断言并通过相关 49 项定向单测；其余 2 项来自 `config/options.py` 默认模型值与旧测试断言不一致。完整全量单测未重新达到全绿。
