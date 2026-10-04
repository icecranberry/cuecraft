# 球杆设计工作区与光杆模型细化

状态：implemented
类型：feature
Owner：web/src/views/cue/CueDesignView.vue

## 问题

球杆设计入口、3D 预览、部件属性、素材模型与 AI 对话缺少连贯的工作区行为。切换花纹或部件时编辑区高度会变化；光杆不能从设计页切换，素材库也无法对模型进行只读检查。观看预览、图层计数、新建设计确认及 AI 输入区还没有统一的工作方式。

## 决策

- 进入设计路由时收起主侧栏。预览提供自旋转和背景切换；观看模式仅铺满 3D 预览。球杆以固定中点绕世界竖直轴转动，初始杆头在屏幕左上、杆尾在右下，杆头先向屏幕内、杆尾先向屏幕外运动，并同时保持原有自旋；可用退出按钮或 Escape 返回。
- 底部部件/花纹调整区统一为 140px 高。花纹操作按钮保持单行横向滚动，避免多行把工具区撑高；选中部件时展示长、宽、高只读尺寸。属性仍跟随左侧部件，不受花纹选择影响。
- 从花纹选择器首次应用素材时，贴图尺寸覆盖所选圆柱部位的完整展开面或端面的完整边界，之后仍可在花纹调整区修改大小。
- 将顶栏光杆选择器连接至内置光杆目录。目录包含现有大头杆、两种两段杆与一种三段旅行杆；杆长与展示拆解参数是公开名义规格或示意值，不作为加工规格。素材库可打开只读 3D 预览及全部部位参数。
- 新建设计或切换光杆遇到未保存修改时先询问保存、放弃或取消，不迁移旧模型的贴花和设置。离开设计页查看作品或素材时不触发保存确认，保留缓存的编辑草稿；只有编辑器内切换到另一份设计时才确认。AI 对话吸底固定、属性区独立滚动；本地参考图只作为页面附件，不发送给模型。
- 素材库和作品详情为模型与右侧规格栏设置固定可视高度，长规格只在右栏内滚动。我的作品以素材库的只读光杆模型展示杆型和拆解尺寸，并把作品内花纹作为缩略图排列，可悬停或键盘聚焦查看大图。
- 我的作品页右侧常驻作品 AI 助手，先选择作品后可继续该作品的持久对话；选择 Skill、发送消息和作品菜单中的成本/矢量入口共用这一面板，不使用抽屉。
- 图层数量以红色角标显示。部件选中提示支持手动关闭并在 2 秒后消失。

### 实现方案

`backend/package/yuxi/services/builtin_cues.py` 是内置目录规格 Owner，cue API 与 `cue_service` 将它投影到素材列表和设计路由；`CueAssetsView` 和 `CueWorksView` 将规格传给只读 `CueModelPreview`，作品视图单独加载其花纹缩略图。`CueDesignView` 选择规格并更新画布模板；路由监听在设计页离开时保留草稿，只有切换编辑目标时才进入未保存确认。Vue 状态经 `web/src/cue-engine/bridge.tsx` 传入保持挂载的 Three.js 画布。`three/watchSpin.ts` 负责观看姿态，`Scene.tsx` 只推进角度并保留轴向自旋；`stickers/patternPlacement.ts` 给初次上杆花纹完整部位尺寸，后续编辑仍由贴花状态负责。设计页本地状态管理预览模式和 AI 输入，参考图片不加入 AI 请求。作品快照由原有保存 API 管理；内置模型切换只替换当前模板，取消时不提交更改。

## 替代方案

- 把所有模型的参数做成精确制造规格：缺少厂商完整拆解数据，采用公开名义杆长加示意几何，并显式标注数据状态。
- 让部件面板随当前画布对象变化：会在选择花纹时隐藏部件参数；保持左侧部件为属性面板的独立状态 Owner。
- 将花纹按原始图片比例只放在部位局部：长部位上的图案只占一小段；首次应用以完整表面为准，精确比例留给用户后续调整。
- 让整杆绕屏幕法线旋转：杆头会转到屏幕下方；改为绕世界竖直轴旋转并固定倾角。
- 把本地参考图上传给聊天模型：这次只要求提供图像参考入口，没有要求视觉理解，因此附件留在页面状态，不改变聊天请求。

## 后果

- 设计页可在完整大头杆拆解和两段/三段简化模型间切换；素材规格只读，模型切换会清空此前贴花和设置并提示用户处理未保存设计。
- 只读作品展示不提示保存，也不改写作品；切换到作品列表和预览后再回到设计页，未保存草稿仍保留。作品详情的长规格不会带动整个对话框滚动，花纹可先览缩略图再展开大图。
- 作品页右侧 AI 助手在列表与预览开关期间保持显示；在作品选择器切换上下文后继续加载该作品的对话和 Skill。
- 窄屏下作品列表与 AI 助手上下排列；该路由移除桌面外壳的 450px 最小宽度，避免出现整页横向滚动。
- 观看模式隐藏编辑工具栏，回到设计时不重建画布。自旋转由画布状态驱动，背景切换只改变场景背景。
- 观看公转时球杆在视图中的水平位置和景深变化，但中点不移动，杆头始终高于杆尾。新放置的花纹会随部位比例拉伸以占满表面；可在工具区修改宽高。
- 内置非大头杆数据服务于交互展示，不可用作采购、加工或质检依据。

## 验证

- `node --test test/unit/cueWatchAndPattern.test.js test/unit/cueStickerSelection.test.js`：5 项通过，覆盖观看姿态、转向与中心不动、初次花纹覆盖部位，以及既有花纹选择/缩放行为。

- `docker compose exec -T api uv run --no-sync --group test pytest test/unit/test_cue_studio.py -q`：9 项通过。
- `docker compose exec -T web node --test test/unit/cueStickerSelection.test.js`：3 项通过，覆盖花纹属性保持、四角缩放和圆柱部位旋转缩放。
- `docker compose exec -T api uvx --from ruff ruff check --no-cache package/yuxi/services/builtin_cues.py package/yuxi/services/cue_ai_service.py package/yuxi/services/cue_service.py server/routers/cue_router.py test/unit/test_cue_studio.py`：通过。
- `docker compose exec -T web pnpm run typecheck:cue`、`pnpm run lint:check`、`pnpm run build`：通过；构建仍输出依赖弃用和大 chunk 提示。期间发现 router 引用的既有 `CueWorksView.vue` 不在当前工作树；恢复同一会话此前完成的版本后，完整构建通过。
- 页面检查已确认侧栏自动收起、模型选项/资产预览、部件只读尺寸、新建设计保存提示、背景及自旋转控件、红色图层计数和观看模式入口。为修复响应式模型模板的 `structuredClone` 代理错误，将 bridge 改为先 `toRaw`；该最终修复后的交互回归尚未完成：重启本地 web 服务后 `/cue/design` 被重定向到登录页，当前会话没有可用的登录凭据。观看模式隐藏底部调整区的样式已通过构建，但该最终样式未在浏览器截图复核。
- `pnpm run test:unit`：394 项中 391 项通过，3 项既有失败涉及 API 边界、一个仍断言品牌为 `Yuxi` 的测试，以及数据库存储测试被 Vite 的 React `jsx` 配置警告输出干扰。
- 后端全量单测 `pytest test/unit -m 'not slow' -q`：运行至约 81% 后连续 9 分钟无进展而中断；中断前已出现与 cue 无关的 builtin discovery、options、agent deep research 失败。此结果没有全量汇总，不能视为通过。
- `python3 scripts/verify_engineering_contracts.py`：失败项来自既有客服改动：proposed 记录 `2026-10-04-cue-work-sharing-and-customer-service.md` 的 Owner 与必需章节不符合格式；`CustomerServiceView.vue` 还有 5 个 API 路径越过 `web/src/apis` 边界。
- 本地启动检查先发现数据库业务 Schema 为 10，服务要求 11；随后当前工作树更新到要求 12。两次执行官方迁移器前都确认没有旧文件迁移或 workdir cutover；应用迁移并重启 API/worker 后，`/api/system/ready` 返回 200 且 `status=ready`。web 可渲染登录页，但 `/cue/design` 需要有效登录；当前浏览器会话停在登录表单，无法完成最终修复后的页面交互回归。
- 本轮预览细化后 `pnpm --dir web run lint:check`、`pnpm --dir web run typecheck:cue` 和 `pnpm --dir web run build` 通过；构建仍提示既有 Vite 弃用项与大 chunk。
- 在 `http://localhost:5175/cue/works` 实际打开作品，确认只读光杆 3D、右侧规格栏内部滚动与常驻 AI 面板；素材库光杆详情也确认规格栏独立滚动。将设计名称临时改为验证值后切到作品页，没有保存弹窗，返回设计页名称仍保留；随后恢复原值，未保存验证数据。
- 390px 窄屏回归确认作品列表与 AI 面板上下排列、`document.scrollWidth` 与视口同为 390px；作品详情在窄屏下继续采用模型在上、信息栏独立滚动的布局。测试后已恢复浏览器默认尺寸。
