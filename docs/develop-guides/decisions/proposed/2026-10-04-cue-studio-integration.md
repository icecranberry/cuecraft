# 球杆设计业务接入 Yuxi

状态：proposed
类型：architecture
Owner：backend/package/yuxi/services/cue_service.py

## 问题

CueCraft 已有可交互的 Three.js 球杆、表面纹样、材质和图片导出，但界面、AI 配置、素材和作品保存在独立 React 应用及浏览器 IndexedDB 中。目标是以 Yuxi 为唯一应用底座，把球杆设计、共享素材、个人作品和单厂家 SKU 目录接入同一套登录、存储和界面，并提供两条专业 AI 工作流。球杆业务不能依赖 Skill 的提示词或文件约定承担状态与执行逻辑。

## 提案

### 实现方案

**界面与 3D 边界。** 在 Yuxi `AppLayout` 增加四个一级菜单和鉴权路由：`/cue/design`、`/cue/assets`、`/cue/works`、`/cue/skus`。所有可见表单、列表、工具栏、弹窗和状态反馈使用 Vue 3、Ant Design Vue、`@lucide/vue`、`PageHeader`、`PageShoulder`、`ResourceEmptyState` 等现有组件，并使用 `base.css` / `base.dark.css` 的 token。CueCraft 只迁入几何、材质、UV/图层合成、相机与渲染导出能力；将 R3F 场景重构为只绘制 WebGL 的 React 画布，由 Vue 容器通过明确的 `design`、`selection`、`view` 属性和事件驱动。移走画布内 React HTML 操作按钮、CueCraft 导航、弹窗和旧样式；设计页没有 AI 按钮。桌面画布两侧为部件/图层和属性面板，窄屏纵向排列面板，不重复创建 WebGL 画布。

| 页面/入口 | 复用的 Yuxi 组件与控件 | 只新增的领域界面 |
| --- | --- | --- |
| 球杆设计 | `PageHeader`、`a-tabs`、`a-tree`、`a-form`、`a-select`、`a-slider`、`a-drawer` | WebGL 画布、部件/图层属性编辑 |
| 素材库 | `PageHeader`、`PageShoulder`、`InfoCard`、`ResourceEmptyState`、`a-upload`、`a-tag`、`a-modal` | 光杆参数、纹样/包裹预览和生成任务状态 |
| 我的作品 | `PageHeader`、`InfoCard`、`ResourceEmptyState`、`a-modal` | 只读 3D 预览和导出面板 |
| SKU 管理 | `PageHeader`、`PageShoulder`、`ResourceEmptyState`、`a-table`、`a-upload`、`a-modal` | 批量导入预览与字段错误提示 |
| 球杆方案对话 | `AgentChatComponent` 及现有对话布局 | 三个方案入口卡，点击后在作品路由预览 3D |

**业务状态。** PostgreSQL 保存 `CueAsset`、`CueDesign`、`CueDesignVersion`、`CueSku`、`CueProposal`；生成状态复用 Yuxi `TaskRecord`，MinIO 保存素材原图。`CueAsset.kind` 为 `blank`、`pattern`、`wrap`：光杆使用毫米制连续杆段（轴向起止、起止直径、材质槽、可印刷范围），纹样包含清晰图片、标签和介绍，包裹图包含适用的完整圆周及轴向尺寸。`CueDesignSnapshot` 冻结光杆参数、素材版本、材料覆盖、表面图层顺序和变换；素材内容替换创建新版本，旧作品保持原效果。作品仅归本人，成功生成的素材对登录用户共享，SKU 可供所有登录用户查询、仅 Yuxi 管理员维护。Demo 只支持一家厂家，不设置审核流；AI 光杆标记为“尺寸草案”，SKU 导入的尺寸为目录事实。

**API 与任务。** 路由层只处理认证和输入，`yuxi.services.cue_*.py` 执行用例，repository 管 PostgreSQL，对象存储沿用 Yuxi MinIO。新增 `/api/cue/assets`、`/api/cue/designs`、`/api/cue/skus`、`/api/cue/skus/import`、`/api/cue/ai/jobs` 和 `/api/cue/ai/proposals`；耗时生成使用 Yuxi Durable Task/worker，数据库是任务终态 Owner。前端 API 集中在 `web/src/apis/cue_api.js`。按 Yuxi storage-migrator 增加业务 Schema 迁移，不在 API 启动时建表。

**AI 工作流一：素材生产。** 素材库选择光杆、纹样或包裹，输入描述、可选参考图；包裹再指定目标杆段。API 创建任务并返回任务 ID，worker 从 Yuxi 模型配置读取服务端凭据：聊天模型生成光杆结构化参数及素材说明，图片模型生成纹样或整圈包裹图。服务端校验杆段连续性与尺寸、图片格式和分辨率；包裹检查圆周接缝及目标选区的有效像素密度。成功后写入 MinIO/PG 并立即成为共享素材；不合格或服务失败的任务保留明确原因，可在素材库重试，不产生半成品素材。当前 Yuxi 模型类型只有 chat/embedding/rerank，因此在现有模型管理中增加 `image` 类型及图片接口适配，先支持现有 `chat/completions` 图片中转协议和标准 Images 协议；素材页不保存或展示 API Key。球杆业务不调用现有 `image-gen` Skill。

**AI 工作流二：球杆方案。** 在 Yuxi 原生对话中预置“球杆方案顾问”Agent 入口，将球杆领域服务注册为 Agent 可调用的内置工具，不创建 Skill；Agent 只负责收集需求、调用工具和解释结果，方案结构与写入由服务端拥有。输入自然语言需求、可选 SKU、参考图或旧作品；服务检索 SKU、光杆和共享素材，使用 Yuxi 管理的聊天模型生成三套 `CueProposal`（光杆/来源 SKU、材料覆盖、按部件定位的纹样与包裹图层、简短理由）。服务端只接受目录内素材 ID，校验适用杆段、尺寸及图层参数，并保存方案集；Yuxi 对话显示三个方案入口卡，点击后在作品路由打开只读 3D 预览。用户选择后以 `/cue/design?proposal=<id>` 打开可编辑副本，原方案不被覆盖；后续“颜色更深”等对话基于现有快照生成新的方案版本。模型输出无效时展示可理解的失败原因，不写入作品。

**其他页面与迁移。** `/cue/works?preview=<id>` 在当前路由以 `a-modal` 展示只读 3D，沿用 CueCraft 当前视角/整杆/细节与 2K/4K PNG 导出。SKU 管理使用固定 CSV/Excel 模板，必填 SKU 编号、名称、类别，允许系列、尺寸、材质、图片等可选字段；导入先预览错误，确认后按 SKU 编号新增或更新，并可“一键以此杆开稿”。旧 CueCraft 从 IndexedDB `cue:*:v2` 导出包含图片字节的资料包；Yuxi 导入时映射素材 ID、作品和图片，旧版本分别成为作品，重复资料包不会创建重复记录。

**实施顺序。** 先完成 Schema、授权、素材/作品/SKU API 与图片模型管理，再接 Vue 页面和只保留画布的 3D 桥接；随后交付素材生产、方案生成、旧数据迁移，最后完成实际浏览器体验和回归验证。每一步完成后以真实数据库、对象和 UI 状态核对结果。作品版本对比和实体凹凸镶嵌留待后续迭代。

## 替代方案

- 直接嵌入完整 CueCraft React 应用：保留两套导航、控件和样式，无法满足 Yuxi 界面规范，因此只复用 3D 画布及计算能力。
- 把球杆方案写成 Skill：Skill 适合可复用操作说明，不能拥有业务持久化、模型协议、参数校验和失败恢复，因此使用内置服务、任务和工具。
- 将现有 R3F 场景全部改写成 Vue/原生 Three.js：会重做已存在的拾取、贴图和摄影导出链路；首版保留画布内的 React 渲染实现，外层 UI 完全 Vue 化。

## 验收标准

| 验收主张 | 失败面 | 语义 Owner | 直接证据 / 命令 | 负向案例 | 当前结果 |
| --- | --- | --- | --- | --- | --- |
| 四个球杆页面符合 Yuxi UI，设计页无 AI 控件 | 双套样式、暗色穿帮、路由失效 | `web/src/views/cue/`、`AppLayout.vue` | 浏览器检查 1440/1024/768/375px、浅/深色；`pnpm run lint:check`、`pnpm run build` | 快速切换路由/窄屏后画布重建或控件溢出 | Not run |
| 3D 编辑、包裹、材质与 PNG 导出可用 | 状态桥接或 UV 漂移 | 3D 画布桥接及 cue renderer | 真实浏览器保存重开并比较部件/图层、导出 2K/4K 图片 | 图层跨缝、素材被替换后旧作品变样 | Not run |
| 素材生成经 Yuxi 管理的模型并可靠入库 | Key 泄漏、任务半提交 | cue service、model provider、Durable Task | 本地 API/worker 实际生成光杆和纹样；任务 success，回读 PG 素材，鉴权下载 MinIO 图片 | 图片服务超时、无效模型响应、低分辨率包裹 | Passed |
| 三套方案基于现存 SKU/素材，可打开并修改 | 模型编造 ID、参数越界 | cue proposal service、只读预览卡 | 真实 HTTP/浏览器从对话生成至编辑器并回读快照 | 无效素材 ID、失效 SKU、无权读取的作品 | Not run |
| SKU 导入和旧作品迁移完整且幂等 | 重复行、丢图、跨用户可见 | cue repository、导入 service | 真实 PostgreSQL/MinIO integration，重复导入并核对计数与字节 | 重复 SKU、缺必填列、损坏的旧资料包 | Not run |

## 风险

- 当前图片中转返回格式与标准 Images API 不同；由图片模型适配器封装协议，并用真实响应验证，不能把任意聊天模型当图片模型。
- CueCraft 场景目前依赖 Zustand 且含 React HTML 控件；必须先分离画布状态接口，再引入 Vue 页面，避免把旧 UI 一并带入。
- 浏览器 IndexedDB 按 origin 隔离；旧作品只能经导出资料包迁移，不能让新站直接读取旧站数据。
- AI 提供的光杆尺寸仅作 Demo 设计草案，不作为加工规格；从 SKU 开稿时以导入的厂家尺寸为准。

## 当前实现与验证状态

- 前后端页面、服务、Schema 和旧版迁移入口已编码；CueCraft 与 Yuxi 前端构建通过，Yuxi ESLint 通过，相关 Python 单元测试通过。工程约束脚本和测试通过。
- 用户提供的图片中转站和模型已直接请求成功，返回 `choices[0].message.content` 中的 Markdown data URL；图片适配器已覆盖此格式。参考图片生成也已收到实际 PNG。Yuxi 内建供应商配置通过 `CUE_IMAGE_API_KEY` 引用本地忽略文件，不在 Git 中保存密钥。
- 本机 DeepSeek 密钥已通过本地忽略文件提供给 Yuxi；`deepseek-flash` 的聊天、`cue_catalog` 工具调用和光杆参数生成均已成功。原生 `cue-design-advisor` 通过真实 `/agent/runs` 调用目录和保存工具；三套候选均成功写入 PostgreSQL，并经鉴权 API 回读确认引用同一厂家 SKU 与真实纹样。
- 本机 PostgreSQL、Redis、MinIO、内存 sandbox provisioner、Yuxi API 和 worker 均已运行；`/api/system/ready` 返回 `ready`。最后一次原生 Agent 方案 E2E 为 completed，三套候选回读均引用目标 SKU 与图层，`runtime_cleanup_pending=false`。
- 浏览器测试停在本地登录页的用户协议/隐私协议确认框前；尚未取得用户同意代其接受条款，因此真实登录后的编辑器、3D 方案预览和 PNG 导出未验证。Docker Desktop 的 containerd blob 仍报 I/O 错误，Compose 服务当前无法启动。
- 当前方案卡需要点击后才能打开 3D 预览；SKU 导入尚无图片字段；旧作品的历史版本按独立作品导入。这些属于下一轮能力完善。
