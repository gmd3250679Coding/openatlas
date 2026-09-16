# AIPPT Schema 驱动 PPT Designer 需求与开发任务

更新时间：2026-06-29

## 1. 产品定位

AIPPT Designer 不是完整 PowerPoint 替代品，而是面向 AI 生成 PPT 的低代码编辑器。它解决的核心问题是：AI 生成后的 HTML-PPT 不能只停留在预览和下载，用户需要在结构化 Deck Schema 上继续编辑、保存、回退，并把修改再次交给 Agent 局部增强。

当前阶段目标设定到 Round 5。Round 5 完成后，产品应具备独立演示、独立部署、独立开源的基本条件；Round 6 的数智员工赋能暂不作为当前主线，避免在开源拆分前过早绑定 OpenAtlas 内部业务体系。

核心差异化：

- AI 先生成 Deck Schema，再由 HTML-PPT Renderer 渲染。
- 用户编辑 Schema，而不是直接改 HTML。
- Agent 能针对单页 schema 做重写、图表增强、风格改写。
- 最终产物既能全屏演示，也能继续进入低代码编辑闭环。

## 2. 当前基线

已完成：

- 独立 Designer 路由：`/presentation-canvas/designer/:deckId`
- 左侧页列表：新增、复制、删除、拖拽排序
- 中间实时 HTML-PPT iframe 预览
- 右侧 Inspector：标题、核心观点、内容要点、版式、visualSpec、图表数据、指标卡、视觉提示词、演讲备注
- Deck Schema 保存版本、版本列表、回退
- 单页 AI 动作：重写本页、增强图表、改成路演风格
- Schema 容错：历史 deck 或 AI patch 缺少数组字段时不崩溃

主要不足：

- Designer 还没有完整的 schema 版本迁移和校验提示。
- Inspector 可编辑项已经覆盖主字段，但复杂页面如架构图、矩阵、流程图还需要更专业的编辑控件。
- AI 单页动作已有链路，但 prompt、上下文、失败重试、差异预览还需要产品化。
- HTML-PPT Renderer 已能体现图表/指标，但版式智能选择和视觉一致性还需要继续增强。
- 全屏演示、导出、历史资产管理还需要做成可放心交付的体验。

## 3. Deck Schema v1 范围

第一版 schema 应稳定以下结构，不急于复杂化：

```ts
type DeckSchema = {
  title: string;
  subtitle?: string;
  sections: DeckSection[];
  slides: DeckSlide[];
  knowledge: KnowledgeCard[];
  generatedAt?: string;
  warnings?: string[];
};

type DeckSlide = {
  id: string;
  sectionId?: string;
  index: number;
  title: string;
  headline: string;
  bullets: string[];
  layout: DeckLayout;
  visual?: string;
  visualSpec?: SlideVisualSpec;
  knowledgeIds?: string[];
  status?: "draft" | "pending" | "confirmed" | "missing_info";
  speakerNotes?: string;
  designIntent?: string;
  renderHints?: string[];
};
```

关键原则：

- Schema 是唯一可编辑事实源。
- HTML 是渲染产物，可以丢弃重建。
- Agent patch 必须是结构化 patch，不能返回整段 HTML。
- Renderer 允许容错，但保存前要给出字段质量提示。

## 4. 功能需求

### 4.1 Designer 页面

- 独立页面承载，不再用弹窗。
- 页面分为三栏：左侧页面列表、中间实时预览、右侧 Inspector。
- 顶部需要有返回、保存版本、预览、全屏、下载 HTML。
- 未保存状态要明显显示。

验收标准：

- 刷新页面后能按 deckId 恢复 schema。
- 编辑任意主字段后 iframe 实时变化。
- 保存后版本号递增。
- 无 schema 缺字段导致的白屏。

### 4.2 左侧页管理

- 新增页：插入到当前页之后。
- 复制页：复制当前页 schema，生成新 id，并重新编号。
- 删除页：至少保留一页，有确认弹窗。
- 拖拽排序：更新 slides 顺序和 index。

验收标准：

- 所有操作只更新 Deck Schema。
- 操作后 selected slide 正确。
- 保存再刷新后顺序不丢失。

### 4.3 右侧 Inspector

第一批字段：

- 页面标题：`slide.title`
- 核心观点：`slide.headline`
- 内容要点：`slide.bullets`
- 页面版式：`slide.layout`
- visualSpec 类型：`slide.visualSpec.type`
- 图表类型：`slide.visualSpec.chart.kind`
- 图表标签和数值：`labels / series.values`
- 指标卡：`visualSpec.metrics`
- 视觉提示词：`slide.visual` 或 `visualSpec.prompt`
- 演讲备注：`slide.speakerNotes`
- 渲染提示词：`slide.renderHints`

第二批字段：

- 架构图 layers 编辑器
- 矩阵 columns/rows 编辑器
- 流程/时间线节点编辑器
- 资料引用 knowledgeIds 选择器
- 单页状态和质量检查项

验收标准：

- 字段修改后 schema、预览、保存 payload 一致。
- 图表数据异常时不崩溃，并提示“待补真实数据”。
- 指标卡支持新增、删除、编辑。

### 4.4 版本管理

- 保存当前 schema 为新版本。
- 版本列表显示版本号、摘要、时间。
- 回退版本时创建一条新的回退记录，避免历史丢失。
- 未来支持版本 diff：显示本次改了哪些 slide/字段。

验收标准：

- 保存 vN 后刷新还能看到 vN。
- 回退后 deck 当前 schema 等于目标版本。
- 回退本身生成新版本记录。

### 4.5 AI 单页动作

动作：

- 重写本页：优化标题、核心观点、要点、备注，不改变整套 deck 结构。
- 增强图表：补齐 visualSpec、chart、metrics、renderHints。
- 改成路演风格：强化投资人语言、商业指标、叙事张力。

Agent 输出要求：

- 只输出 JSON patch。
- 不能输出 HTML。
- 保留 slide id、sectionId、index。
- patch 必须可被前端 merge 到当前 slide。
- 缺真实数据时用 `待补` 并说明数据口径，不编造。

验收标准：

- 动作执行中有 loading。
- 成功后 Inspector 和预览同步变化。
- 失败时保留原 slide，并给出可读错误。
- 至少有一次 fallback patch，不能让用户空等。

### 4.6 HTML-PPT Renderer

Renderer 要覆盖：

- cover
- section
- two_column
- compare
- metrics
- process
- timeline
- diagram
- checklist
- quote

视觉组件要覆盖：

- 指标卡
- 柱状图
- 折线图
- 图表 + 指标组合
- 对比矩阵
- 架构分层图
- 时间线
- 行动清单

验收标准：

- 同一 deck 内不能全部长得一样。
- outline 中规划的 visualSpec 必须尽量在 HTML 中体现。
- 不同 style token 要带来明显视觉差异。
- 全屏演示不出现底部遮挡、滚动错位、页面比例异常。

## 5. 开发任务分轮

当前主线只推进到 Round 5。Round 5 完成后进入“开源拆分准备”，不默认继续做 Round 6。

开源拆分判断标准：

- AIPPT 核心功能不依赖 OpenAtlas 登录态、租户模型、数智员工任务状态。
- Deck Schema、HTML Renderer、Designer Inspector、Agent prompt 可以作为独立模块说明。
- LLM 接入通过 adapter 完成，至少支持 OpenAI-compatible 和 Hermes-compatible。
- 本地开发能用 mock 数据跑通生成、编辑、预览、保存、导出。
- Demo 数据不包含内部客户、内部环境、密钥或专有业务配置。

### Round 1：Designer MVP 稳定化

目标：让当前功能从“能用”变成“可靠可测”。

任务：

- 补 schema normalization：sections/slides/knowledge/visualSpec 全入口容错。
- 给 save/restore/slide-action 写 API smoke 脚本。
- 给 Designer 页面加 Playwright 主链路测试。
- 修复全屏演示比例和滚动遮挡。
- 最近 AIPPT 卡片直接进入 Designer。

验收：

- 本地和云端都能打开 Designer。
- 创建、保存、回退、刷新、下载 HTML 全链路通过。
- 控制台无 error。

完成后建议：

- 如果主链路稳定，进入 Round 2 做 Inspector 专业化。
- 如果仍有白屏/保存失败，优先补 schema migration 和错误边界。

### Round 2：Inspector 专业化

目标：让用户能编辑更多“AI 规划的视觉内容”，不只是改文字。

任务：

- 矩阵编辑器：列、能力项、强弱等级。
- 架构图编辑器：层级、说明、调用关系。
- 时间线/流程编辑器：节点、阶段、负责人、时间。
- 图表编辑器增强：多 series、单位、来源、口径说明。
- Knowledge 引用选择和缺资料提示。

验收：

- 用户能把 outline 中的 diagram/compare/metrics 真实改进到 HTML 里。
- visualSpec 和 HTML 渲染一致。
- 修改复杂 visualSpec 后保存/回退不丢字段。

完成后建议：

- 如果复杂视觉编辑可用，进入 Round 3 做 AI patch 的差异化能力。
- 如果用户仍需要直接改 HTML，说明 Inspector 控件覆盖不够，继续补控件。

### Round 3：AI Patch 工作流

目标：让 Designer 真正成为 AI 协作编辑器，而不是纯手工表单。

任务：

- 单页动作增加上下文：deck config、相邻页、目标受众、style token、knowledge。
- 加差异预览：AI patch 应用前显示变更摘要。
- 加可撤销：本地 undo 或临时 patch preview。
- 强化 prompt：路演/汇报/培训分别有 action policy。
- 加重试与 JSON 修复链路可视化。

验收：

- AI patch 不破坏 slide id/index。
- 用户能看到“改了什么”，再确认应用。
- Patch 质量比简单 fallback 明显更好。

完成后建议：

- 如果 AI patch 稳定，进入 Round 4 做 Renderer 质量提升。
- 如果 patch 经常失败，优先优化 Hermes prompt、JSON repair、schema validator。

### Round 4：Renderer 视觉质量

目标：让最终 HTML-PPT 具备可演示的设计质量和明显风格差异。

任务：

- 版式调度器：根据 visualSpec 自动选 layout。
- 每套 style token 扩展 typography、spacing、chartPalette、surface、accent。
- 不同页面生成不同视觉组件，避免同质化。
- 全屏演示模式重做：键盘翻页、适配 16:9/3:1、退出提示。
- 导出 HTML 包含完整自运行脚本和样式。

验收：

- 同一 deck 至少 60% 页面呈现不同结构。
- 指标页必须有指标卡或图表。
- compare/architecture/timeline 规划必须在 HTML 中出现对应视觉表达。
- 全屏演示无底部遮挡。

完成后建议：

- 如果 HTML 质量达标，进入 Round 5 做素材、资料和联网增强。
- 如果视觉仍像模板套壳，继续强化 visualSpec-to-layout 映射。

### Round 5：资料与可信度

目标：让 AIPPT 不只漂亮，还能有依据。

任务：

- 缺资料卡片：显示缺什么、为什么缺、建议补什么。
- 联网补充按钮带上下文 prompt。
- WebSearch 结果写入 knowledge，并关联到 slide.knowledgeIds。
- 图表数据必须记录 source、unit、口径、是否估算。
- 导出时保留备注中的来源摘要。

验收：

- 用户能从“缺资料”直接补知识。
- 补充后相关页面自动刷新 visualSpec。
- 不编造数据，估算数据要明确标识。

完成后建议：

- 如果可信度链路稳定，进入开源拆分准备：收口依赖、整理 README、抽离 OpenAtlas 专有接口、准备 Demo 数据。
- 如果联网资料质量不稳，先做资料筛选、引用可信度和人工确认。

### Round 6：暂缓，开源后再评估

目标：当前不纳入主线。待 AIPPT 作为独立开源产品稳定后，再评估是否做 OpenAtlas 数智员工、组织级模板、多租户协作等集成能力。

暂缓原因：

- 产品准备剥离出去单独开源，当前应优先降低 OpenAtlas 内部耦合。
- 数智员工集成会引入租户、权限、skill 市场、组织模板等复杂度，不适合作为开源前必做项。
- Round 5 已覆盖 MVP 到可交付产品的关键闭环：稳定、可编辑、AI patch、Renderer 质量、资料可信度。

开源前替代任务：

- 抽象 AIPPT 独立包边界：Deck Schema、Renderer、Designer、Agent adapter、Storage adapter。
- 替换 OpenAtlas 专有 API 为可插拔 adapter。
- 提供本地 mock LLM / OpenAI-compatible / Hermes-compatible 三类接入方式。
- 准备示例 deck、示例 prompt、示例 style token。
- 补开源 README、架构图、快速启动、贡献指南和 License 选择。

完成后建议：

- 开源后再决定是否启动 Round 6：多人协作、模板市场、数智员工 skill、企业品牌 token。

## 6. 每轮修复交付格式

每一轮完成后固定输出：

```md
本轮目标：
- ...

已完成：
- ...

验证结果：
- API：
- 前端：
- 浏览器：

发现的问题：
- ...

下一步建议：
1. ...
2. ...
3. ...
```

判断下一步优先级的规则：

- 只要有白屏、保存失败、历史丢失，优先稳定性。
- 主链路稳定后，优先补 Inspector 对 visualSpec 的覆盖。
- Inspector 可用后，优先提升 AI patch 质量。
- AI patch 稳后，再追求 Renderer 视觉质量和风格差异。
- 视觉达标后，再做资料可信度。
- Round 5 达标后，优先做独立开源拆分准备，不再默认进入数智员工赋能。

## 7. 近期建议

下一步优先做 Round 1 的稳定化收口：

- 补 e2e：打开 Designer、编辑标题、保存版本、回退版本、复制删除页面。
- 修全屏演示遮挡问题。
- 加 schema validator，把缺字段问题从“白屏”变成“可读质量提示”。
- 把最近 AIPPT 卡片入口和 Designer 打通。

## 8. Round 1 执行记录

执行日期：2026-06-29

本轮目标：

- 让 Designer MVP 从“能用”进入“可测、可解释、可继续迭代”的稳定状态。

已完成：

- 增加 Deck Schema validator，覆盖 deck/section/slide/knowledge 基础结构、重复 id、缺标题/观点/要点、未知 layout、图表标签和数值不一致、矩阵/架构缺结构等问题。
- Designer 右侧增加“Schema 质量”卡片，错误、风险和优化建议可视化展示。
- 保存版本时如果存在 error/warning，会提示“已保存但仍有质量提醒”，不硬阻塞用户。
- HTML-PPT Renderer 去掉 1440px 固定宽度上限，改为按全屏视口动态计算 slide 宽高。
- 主页面预览和 Designer 预览都改为优先全屏容器，再由 iframe 填满容器，降低全屏遮挡和底部大空白风险。
- 最近 AIPPT 卡片点击后直接进入 Designer。
- 新增 `e2e/aippt-designer.spec.ts`，覆盖 API 创建、保存、回退，以及 Designer 页面实时预览、保存版本、复制/删除页面。

验证结果：

- 后端编译：`backend/.venv/bin/python -m py_compile backend/app/main.py backend/app/db/models.py backend/app/db/session.py`
- 前端构建：`npm run build`
- E2E：`npx playwright test e2e/aippt-designer.spec.ts --project=chromium`
- 结果：1 个 AIPPT Designer 测试通过。

发现的问题：

- 当前测试会留下 `E2E AIPPT Designer ...` 历史 deck，因为后端还没有 presentation deck 删除接口。
- Schema validator 已能提示质量问题，但还没有独立的“展开全部/定位到页面”交互。
- 全屏演示已修布局策略，但还需要在云端和大屏投影尺寸做截图回归。

下一步建议：

1. 进入 Round 2：优先做 Inspector 专业化，补矩阵、架构、流程/时间线、多 series 图表的结构化编辑控件。
2. 同步补一个 presentation deck 删除/归档接口，方便清理 E2E 数据和用户历史。
3. 给全屏演示加视觉回归截图，覆盖 16:9、3:1、桌面宽屏和普通笔记本视口。

## 9. Round 2 执行记录

执行日期：2026-06-29

本轮目标：

- 让 Designer Inspector 从“文本框改 schema”升级为“按 visualSpec 类型分工的专业编辑器”。

已完成：

- 图表数据支持多 series 编辑，可分别维护序列名、数值和单位。
- 矩阵页增加结构化矩阵编辑器，支持矩阵标题、列名、强/中/弱标记、列内能力点。
- 架构页增加结构化架构编辑器，支持架构标题、层级名称、职责/组件/输入输出。
- 流程、时间线、行动清单页增加节点编辑器，节点会同步写入 `visualSpec.rows` 和兼容渲染用的 `bullets`。
- HTML-PPT Renderer 增强为优先读取 `visualSpec.rows`，流程/时间线/行动清单不再只依赖普通 bullet。
- E2E 增加“数据序列 / 添加序列”入口断言，保护多 series 图表编辑能力。

验证结果：

- 前端构建：`npm run build`
- E2E：`npx playwright test e2e/aippt-designer.spec.ts --project=chromium`
- 结果：1 个 AIPPT Designer 测试通过。

发现的问题：

- 本轮主要覆盖独立 Designer 页面，旧 Canvas 内嵌 Inspector 仍是旧交互，后续需要统一或下线旧入口。
- 多 series 已可编辑，但 HTML-PPT 折线/柱状图当前仍主要渲染首个序列，下一轮需要让 Renderer 真正画出多 series。
- 矩阵/架构/流程编辑器还没有拖拽排序，当前依赖页面列表排序能力，细粒度结构排序需要补。

下一步建议：

1. Round 3 优先做多 series Renderer：柱状分组/堆叠、折线多线、图例、单位和来源。
2. 补 Inspector 内部条目拖拽排序，覆盖矩阵列、架构层、流程节点、图表 series。
3. 给“重写本页 / 增强图表 / 改成路演风格”接入 schema diff 预览，让 AI patch 可审阅后再应用。

## 10. Round 3 执行记录：AI Patch 审阅流

执行日期：2026-06-29

本轮目标：

- 把单页 AI 动作从“生成后立即应用”升级为“生成 schema patch、预览差异、用户确认后应用”。

已完成：

- 后端 slide-action prompt 增强，增加相邻页、关联 knowledge、action policy、renderer contract、style contract。
- Hermes JSON repair 成功时会返回可见 warning，前端可识别“经过结构化修复”。
- `/slide-action` 返回新增 `source`、`diff_summary`、`quality`，包含 fallback、repaired、warning_count、changed_fields、context_slide_count、knowledge_count。
- Designer 增加 pending patch 状态，AI patch 不再直接写入 Deck Schema。
- 中间 HTML-PPT iframe 支持临时预览 patch 后效果，应用前不污染真实 schema。
- Inspector 增加“AI 补丁预览”卡，展示来源、是否 JSON 修复、rationale、字段 diff、warnings，并提供“应用补丁 / 放弃”。
- E2E 用 mock slide-action 覆盖审阅流：生成补丁、预览变化、应用后表单写入。

验证结果：

- 后端编译：`backend/.venv/bin/python -m py_compile backend/app/main.py`
- 前端构建：`npm run build`
- E2E：`npx playwright test e2e/aippt-designer.spec.ts --project=chromium`
- 结果：1 个 AIPPT Designer 测试通过。

发现的问题：

- 当前“可撤销”主要体现为应用前可放弃；应用后的 undo 仍依赖保存版本/回退版本，还没有本地一步撤销。
- 差异预览目前是字段级摘要，不是结构化 JSON diff；复杂 visualSpec 改动还需要更细粒度展示。
- 后端已返回 quality 元信息，但前端暂未展示 context_slide_count、knowledge_count 等详细诊断。

下一步建议：

1. 继续 Round 3：补本地 undo、结构化 visualSpec diff、AI patch retry/repair 状态时间线。
2. 同步推进 Round 4 前置项：多 series Renderer，让 Round 2 已能编辑的数据真正显示为多线/分组柱状。
3. 为开源拆分提前抽象 Agent adapter，避免 Hermes 字段散落在前端和业务 API 中。

### Round 3 追加记录：Undo 与结构化 Diff

执行日期：2026-06-29

本轮目标：

- 补齐 AI patch 应用后的本地撤销能力，并让复杂 `visualSpec` 变化更可读。

已完成：

- Designer 增加 `lastAppliedPatch`，应用 AI patch 后保留应用前 slide/config。
- Inspector 增加“最近 AI 应用”撤销卡，支持一键撤销最近一次 AI patch 应用。
- 手工编辑、页面结构操作、重新加载、版本回退会清理撤销点，避免 stale undo 覆盖用户后续编辑。
- `visualSpec` diff 从整对象摘要升级为子字段 diff，覆盖 `type/title/description/columns/rows/layers/metrics/chart/callouts`。
- AI 补丁预览卡展示更多 quality 诊断：变更项、上下文页数、关联知识数、提醒数。
- E2E 覆盖结构化 `visualSpec.type` diff、quality 诊断展示、应用后撤销并恢复原始核心观点。

验证结果：

- 后端编译：`backend/.venv/bin/python -m py_compile backend/app/main.py`
- 前端构建：`npm run build`
- E2E：`npx playwright test e2e/aippt-designer.spec.ts --project=chromium`
- 结果：1 个 AIPPT Designer 测试通过。

发现的问题：

- 当前 undo 是单步本地撤销，不是多步历史栈。
- retry/repair 仍然只是通过 source、warning 和 JSON 修复标签表达，还没有完整状态时间线。
- `visualSpec` diff 已拆子字段，但 chart/metrics 内部还不是逐 series/逐指标 diff。

下一步建议：

1. 继续 Round 3 最后一块：AI patch retry/repair 状态时间线，把“调用中、修复中、fallback、成功”显示成过程状态。
2. Round 4 前置继续做多 series Renderer，优先折线多线、分组柱状和图例。
3. 抽象 `AIPPTAgentAdapter`/`AIPPTStorageAdapter` 文档草案，为 Round 5 后独立开源拆分做准备。

### Round 3 追加记录：Patch 状态线

执行日期：2026-06-29

本轮目标：

- 让 AI patch 的生成、修复、fallback 和确认路径更可解释。

已完成：

- AI 补丁预览卡新增状态线：构造上下文、Hermes 生成、JSON 修复、等待确认。
- 状态线会根据 `source`、`quality.fallback`、`quality.repaired` 展示正常、修复或 warning 状态。
- E2E 增加“缺省 Hermes 生成”和“等待确认”状态线断言。

验证结果：

- 后端编译：`backend/.venv/bin/python -m py_compile backend/app/main.py`
- 前端构建：`npm run build`
- E2E：`npx playwright test e2e/aippt-designer.spec.ts --project=chromium`
- 结果：1 个 AIPPT Designer 测试通过。

发现的问题：

- 当前状态线基于后端最终响应归纳，还不是服务端事件流。
- 如果后续要显示“调用中/修复中”的实时进度，需要把 slide-action 改成 streaming 或 job 模式。

下一步建议：

1. 进入 Round 4 前置：多 series Renderer，先把已能编辑的 chart.series 真正渲染出来。
2. 同时补 `AIPPTAgentAdapter` 设计文档，把 Hermes-compatible、OpenAI-compatible、mock 三类接入边界定义清楚。
3. 再做 Inspector 内部条目拖拽排序，提升低代码编辑器的真实可用性。

## 11. Round 4 前置记录：多 Series Renderer

执行日期：2026-06-29

本轮目标：

- 让 Round 2 已经能编辑的 `chart.series` 在最终 HTML-PPT 中真实渲染，而不是只使用第一条数据序列。

已完成：

- 新增 `chartSeriesFromVisualSpec`，从 `visualSpec.chart.labels/series` 读取完整多序列数据。
- 折线图支持多 series：统一坐标系、多条 polyline、圆点、图例和最新值标签。
- 柱状图支持 grouped bar：每个 label 下展示多条 series 分组柱。
- `combo_metrics` 支持多 series 折线 + 指标卡组合。
- 保持单 series 和旧 deck 兼容，仍可走原有简洁折线/柱状/指标卡渲染。
- E2E fixture 增加 `MRR` 与 `Pipeline` 两条 series，并断言 iframe 中出现“多序列趋势”、图例和最新值标签。

验证结果：

- 后端编译：`backend/.venv/bin/python -m py_compile backend/app/main.py`
- 前端构建：`npm run build`
- E2E：`npx playwright test e2e/aippt-designer.spec.ts --project=chromium`
- 结果：1 个 AIPPT Designer 测试通过。

发现的问题：

- 多 series 图表已可渲染，但还没有截图级视觉回归。
- grouped bar 目前最多展示 4 条 series、6 个 label，适合演示页；更大数据表需要后续抽象成图表表格或分页。
- chart/metrics 的 diff 还没有逐 series 展开，仍是 `visualSpec.chart` 子字段级。

下一步建议：

1. 继续 Round 4：补 layout scheduler，让 visualSpec 自动驱动 metrics/compare/diagram/process/timeline 版式选择。
2. 给 HTML-PPT 预览加截图回归，覆盖 16:9 与 3:1。
3. 启动开源拆分设计文档：`AIPPTAgentAdapter`、`AIPPTStorageAdapter`、`DeckSchema`、`Renderer` 的独立包边界。

## 12. Designer 同源编辑审计与本轮收口

执行日期：2026-07-01

本轮目标：

- 让 Designer 更像面向 HTML-PPT 的低代码编辑器，而不是独立于最终预览的弱控制层。
- 验证用户在设计器里的编辑会写入同一份 Deck Schema，并由同一个 HTML renderer 渲染到最终预览。

架构审计结论：

- 当前正确路线是“最终 HTML iframe + Designer overlay 控制层”，不是再做一套 Canvas 专用渲染器。
- HTML renderer 已提供 `data-aippt-element` 契约，Designer 可以读取最终 HTML 元素 bounds，再把用户拖拽、缩放、样式、图片和自定义组件写回 `slide.design`。
- 设计器与最终 HTML 产生差异的主要原因不是渲染器缺失，而是用户缺少可见的 schema 同步证据、对象操作入口不够像设计工具、E2E 之前没有覆盖“编辑后保存 payload 仍是同一份 schema”。

已完成：

- Designer 设计态增加对象操作条：编辑文字、替换图片、复制对象、隐藏/删除、方向键微调提示。
- 对象操作条改为跟随当前选区上下浮动；工具条背景不再拦截画布点击，只保留按钮本身响应鼠标，避免低代码编辑入口反过来影响选择、拖拽和缩放。
- 增加键盘设计手感：方向键微调，Shift+方向键快速移动，Delete/Backspace 删除自定义组件或隐藏结构对象，Enter 进入选中对象编辑。
- 每次 schema 编辑都会更新 `Deck Schema rev` 和最后 mutation label，预览容器暴露 `data-schema-revision`、`data-design-mode`、`data-custom-element-count`，用于人工判断和自动测试。
- 低代码插入/复制/图片替换仍写入 `slide.design.customElements` 或 `slide.design.media`，不直接改 HTML。
- E2E 新增保存 payload 断言：画布双击编辑标题、插入文本框、缩放、方向键移动后，保存请求里的 `Deck Schema` 包含同样的标题、`freeform` 模式和 custom element 几何数据；最终 HTML `srcdoc` 同步出现这些变化。

验证标准：

- 设计画布、HTML 预览、保存 payload 三者必须围绕同一份 Deck Schema 闭环。
- 结构对象如果进入自由编辑态，必须保留原 HTML bounds 作为初始坐标，后续变更由 `slide.design.elements` 覆盖。
- 自定义元素只能作为 schema custom element 存储，最终 HTML 由 renderer 重建，不允许保存手写 HTML 片段。

剩余风险：

- 当前 overlay 仍是 DOM 控制层，不是完整 Fabric/Moveable 级设计器；复杂富文本分段、图片裁剪、组件专用编辑态还需要继续做。
- 结构对象的“删除”目前表现为隐藏，避免破坏 AI 生成的主字段；如果后续用户要求真正删除字段，需要定义 schema migration。
- 图片素材仍以 data URL / URL 写入 schema，未来开源版本需要独立 asset storage adapter。

下一步建议：

1. 引入可插拔设计器内核边界：`DeckSchemaStore`、`RendererBridge`、`SelectionController`、`AssetAdapter`，方便开源拆分。
2. 对标低代码设计器继续补框内富文本、图片裁剪/替换、组件双击专用编辑态。
3. 把 Designer 的 overlay bounds 与 HTML renderer screenshot 做视觉回归，防止未来 renderer 改版后控制层漂移。

### Round 4 追加记录：Layout Scheduler

执行日期：2026-06-29

本轮目标：

- 让 `visualSpec` 自动驱动 HTML-PPT 页面版式，修正 Agent 常见的 `two_column + visualSpec` 不一致问题。

已完成：

- 新增 `layoutFromVisualSpec`，根据 `columns/layers/rows/chart/metrics/type` 推断 compare、diagram、metrics、process、timeline、checklist。
- 新增 `scheduledLayoutForSlide`，保留 cover/section/quote 等强叙事页，其他页面优先使用高置信 visualSpec 布局。
- `normalizePlanLayouts` 接入 layout scheduler，加载/生成/保存后的 Deck Schema 会自动修正布局。
- `buildHtmlDeck` 接入渲染兜底，即使外部传入未 normalize 的 deck，也会按 visualSpec 渲染。
- E2E fixture 增加 `layout=two_column` 但 `visualSpec.type=architecture` 的页面，并验证 iframe 渲染出 Architecture 页面。

验证结果：

- 后端编译：`backend/.venv/bin/python -m py_compile backend/app/main.py`
- 前端构建：`npm run build`
- E2E：`npx playwright test e2e/aippt-designer.spec.ts --project=chromium`
- 结果：1 个 AIPPT Designer 测试通过。

发现的问题：

- Scheduler 目前是确定性规则，还没有基于内容密度和页面相邻关系做更细的版式调度。
- cover/section/quote 会被保留，若 Agent 错把结构页设为 quote，仍需要 AI patch 或手工修正。
- 还缺截图级视觉回归来证明不同 style token 下版式稳定。

下一步建议：

1. 继续 Round 4：补 HTML-PPT 预览截图回归，覆盖 16:9、3:1、多 series、architecture、matrix。
2. 扩展 style token 对 typography、spacing、chartPalette 的影响，让不同模板差异更明显。
3. 启动开源拆分设计文档，定义 `DeckSchema`、`Renderer`、`AgentAdapter`、`StorageAdapter` 独立边界。

### Round 4 追加记录：HTML-PPT 视觉回归

执行日期：2026-06-29

本轮目标：

- 给 HTML-PPT 预览建立截图级护栏，避免后续迭代再次出现页面空白、比例异常或 visualSpec 没有被最终 HTML 体现的问题。

已完成：

- AIPPT Designer E2E 新增视觉回归用例，自动创建 16:9 与 3:1 两份 Deck Schema。
- 覆盖三类核心视觉页面：多 series 指标页、架构图页、矩阵对比页。
- 对 Designer iframe 中的真实渲染页面截图，并保存到 `frontend/output/playwright/aippt-visual/`。
- 增加像素采样检查：截图尺寸、非白像素占比、色彩桶数量、亮度方差，防止“文字存在但画面空白/单色”的退化。
- 增加比例检查，确保 16:9 与 3:1 预览在低代码 Designer 容器内仍保持合理画幅。

验证结果：

- 后端编译：`backend/.venv/bin/python -m py_compile backend/app/main.py`
- 前端构建：`npm run build`
- E2E：`npx playwright test e2e/aippt-designer.spec.ts --project=chromium`
- 结果：2 个 AIPPT Designer 测试通过。

发现的问题：

- 当前是非空白/非单色级视觉护栏，还不是固定 baseline 的逐像素对比。
- 截图覆盖 Designer 预览容器，尚未覆盖全屏演示模式。
- 视觉产物还没有纳入 CI artifact 自动归档和清理策略。

下一步建议：

1. 继续 Round 4：扩展 style token 对字体层级、留白、图表配色、装饰密度的影响，让“汇报/路演/培训”三套模板差异进一步拉开。
2. 补全全屏演示模式的截图回归，重点看滚动、缩放、画幅居中和背景露出问题。
3. 进入 Round 5 文档化：抽出 `DeckSchema`、`Renderer`、`AgentAdapter`、`StorageAdapter` 的开源包边界。

### Round 4 追加记录：全屏演示与模板差异化

执行日期：2026-06-29

本轮目标：

- 修正 HTML-PPT 全屏/独立演示时可能出现的外层背景露出、滚动条和画幅不稳定问题。
- 让“汇报 / 路演 / 培训”三套 style token 在最终 HTML-PPT 中形成更明显的视觉差异，而不只是配置项不同。

已完成：

- HTML deck 根容器改为固定视口布局，使用 `100vh/100dvh` 双保险，避免独立演示页出现页面级滚动。
- 全屏预览 modal 与 iframe 改为 `100vw/100vh` 铺满，减少底部大面积空白和外层背景露出。
- 主 AIPPT 页全屏入口改为可解释流程：预览未挂载时先打开预览并提示用户点击弹窗全屏；预览已存在时直接请求全屏，失败会给出提示。
- Designer 全屏入口增加失败提示，便于线上定位浏览器权限或用户激活限制。
- Renderer 新增 `STYLE_RENDER_TUNING`，把 styleKey 映射为标题尺度、正文尺度、页面留白、图表线宽、卡片边框强度。
- 最终 HTML 增加 `pattern-*`、`cover-*`、`layout-*` 类名，为后续开源 Renderer 和更多主题扩展留下稳定挂点。
- 三套模板增加差异化 CSS：
  - 高管汇报蓝：顶部结论条、证据分隔线、白底数据卡，更偏正式汇报。
  - 科技路演黑：深色舞台、强调线、发光式图表卡，更偏发布会/融资路演。
  - 清晰教学绿：左侧课程进度线、虚线流程卡、偏大正文，更偏培训课件。
- E2E 视觉回归会先激活目标 slide 再截图，避免截图隐藏页导致弱验证。
- E2E 新增独立 HTML 演示视口检查：校验 deck 铺满视口、无页面滚动、16:9/3:1 比例稳定、关键页非空白。
- E2E 新增 style token 落地检查：校验三套模板的主题类名、背景、主色、圆角、标题尺度和图表线宽都进入最终 HTML。

验证结果：

- 后端编译：`backend/.venv/bin/python -m py_compile backend/app/main.py`
- 前端构建：`npm run build`
- E2E：`npx playwright test e2e/aippt-designer.spec.ts --project=chromium`
- 结果：3 个 AIPPT Designer 测试通过。

发现的问题：

- Playwright 当前验证的是独立 HTML 视口，不直接触发浏览器原生 fullscreen 权限流；原生全屏失败仍依赖运行时提示。
- 模板差异已经进入最终 HTML，但还没有形成可配置主题包或外部 theme registry。
- 视觉回归仍是阈值型护栏，不是基线截图比对。

下一步建议：

1. 进入 Round 5：整理开源拆分边界，优先定义 `DeckSchema`、`Renderer`、`ThemePreset`、`AgentAdapter`、`StorageAdapter`。
2. 抽出 Renderer 纯函数和 schema validator，降低后续独立开源时对 OpenAtlas 主应用的耦合。
3. 给 AI Patch 增加 chart.series 级 diff 和可视化编辑提示，把“增强图表”的改动审阅再做细一层。

## 12. Round 5 启动记录：资料可信度与开源边界

执行日期：2026-06-29

本轮目标：

- 让 AIPPT 的图表数据开始具备可审查来源，而不只是视觉上“像图表”。
- 为后续独立开源拆分定义模块边界和 Adapter 契约。

已完成：

- `visualSpec.chart` 扩展可信度字段：`source`、`methodology`、`estimated`。
- 前端 normalizer 支持兼容 `methodology/caliber/scope` 和 `estimated/isEstimated/estimate`。
- HTML-PPT Renderer 在柱状图、折线图、多序列图表底部显示 `Source`、`口径` 和 `估算数据`。
- Schema validator 增加 Round 5 质量提示：
  - 有图表数值但缺少 source。
  - 有图表数值但缺少统一单位或序列单位。
  - 估算数据缺少 methodology。
  - 指标卡缺少单位或口径说明。
- Hermes AIPPT prompt / renderer contract / slide patch prompt 增加数据可信度要求：有 `values` 时尽量输出 `source/unit/methodology/estimated`，估算数据必须 `estimated=true`。
- E2E fixture 增加图表 source、methodology、estimated，并断言最终 HTML 中可见。
- 新增开源拆分契约文档：[AIPPT-OPEN-SOURCE-ADAPTERS.md](./AIPPT-OPEN-SOURCE-ADAPTERS.md)，覆盖 `DeckSchema`、`Renderer`、`ThemePreset`、`AgentAdapter`、`StorageAdapter`、`ResearchAdapter`。

验证结果：

- 后端编译：`backend/.venv/bin/python -m py_compile backend/app/main.py`
- 前端构建：`npm run build`
- E2E：`npx playwright test e2e/aippt-designer.spec.ts --project=chromium`
- 结果：3 个 AIPPT Designer 测试通过。

发现的问题：

- 可信度字段已进入 schema 和 renderer，但 Designer Inspector 还没有专门编辑 `chart.source/methodology/estimated` 的控件。
- AI Patch diff 仍按 `visualSpec.chart` 整体展示，还没有逐 series/逐来源字段展开。
- Adapter 目前是契约文档，还没有真实拆包。

下一步建议：

1. 补 Designer Inspector 的图表可信度编辑器：来源、口径、估算开关。
2. 补 chart.series 级 diff，让 AI 增强图表时能审阅每条序列和 source 变化。
3. 开始抽出 `@aippt/schema` 的第一步：把类型、normalize、validate 从页面文件迁移到独立模块。

### Round 5 追加记录：可信图表编辑与细粒度 Diff

执行日期：2026-06-29

本轮目标：

- 让用户在 Designer Inspector 内直接编辑图表来源、统计口径和估算标记。
- 让 AI Patch 审阅区不再把 `visualSpec.chart` 当作整块 JSON，而是能审阅 chart source 和 series 级变化。

已完成：

- Designer 图表数据区新增“数据来源”“统计口径”“估算数据”控件，编辑后直接写回 `DeckSchema.visualSpec.chart` 并实时刷新 HTML-PPT iframe。
- 估算数据使用明确开关，避免用户只能在文本里描述估算状态。
- AI Patch diff 拆解 `visualSpec.chart`：
  - `kind`
  - `labels`
  - `unit`
  - `source`
  - `methodology`
  - `estimated`
  - `series.count`
  - `series[n].名称 / 数值 / 单位`
- E2E 增加人工编辑可信度字段的断言：编辑 source/methodology 后最终 HTML 立即显示，关闭/打开 estimated 后“估算数据”同步消失/出现。
- E2E 增加 AI 增强图表 patch 的断言：审阅区显示 `visualSpec.chart.source`、`visualSpec.chart.methodology`、`visualSpec.chart.estimated` 和 `visualSpec.chart.series[n].数值`。

验证结果：

- 后端编译：`backend/.venv/bin/python -m py_compile backend/app/main.py`
- 前端构建：`npm run build`
- E2E：`npx playwright test e2e/aippt-designer.spec.ts --project=chromium`
- 结果：3 个 AIPPT Designer 测试通过。

发现的问题：

- Diff 已能看到 series 级变化，但还不是表格化对比；复杂多序列图表后续适合做专门 diff viewer。
- 图表来源字段已可编辑，但 knowledge 引用和 chart source 之间还没有结构化关联。
- `@aippt/schema` 仍未真实拆包，下一轮需要开始迁移类型和 validator。

下一步建议：

1. 抽出 `@aippt/schema` 第一批文件：types、normalize、validate。
2. 给 chart source 增加可选 knowledge 绑定，形成“图表数据来自哪张知识卡”的闭环。
3. 继续完善开源 README 和 demo deck，准备从 OpenAtlas 页面中逐步剥离。

### Round 5 追加记录：Schema 模块抽离第一步

执行日期：2026-06-29

本轮目标：

- 把 Designer 依赖的 Deck Schema 类型、规格化、校验和视觉辅助函数从页面文件里拆出来。
- 为后续独立开源的 `@aippt/schema` 包建立第一层代码边界。

已完成：

- 新增 `frontend/src/features/aippt/schema.ts`，集中承载 AIPPT 纯数据协议能力：
  - `DeckConfig / DeckPlan / DeckSlide / SlideVisualSpec`
  - `normalizeVisualSpec / normalizePlanLayouts`
  - `validateDeckSchema`
  - layout scheduler、chart kind、matrix/architecture/metrics 等视觉推断 helper
  - Designer 编辑器复用的 parse/compact helper
- `PresentationDesigner` 已改为从 `features/aippt/schema` 引入 schema、validator、normalizer 和 inspector helper。
- `PresentationDesigner` 仍只从 `PresentationCanvas` 引入 HTML 渲染、下载和主题选择等页面/渲染能力，减少 Designer 对大页面文件的隐式耦合。

验证结果：

- 后端编译：`backend/.venv/bin/python -m py_compile backend/app/main.py`
- 前端构建：`npm run build`
- E2E：`npx playwright test e2e/aippt-designer.spec.ts --project=chromium`
- 结果：3 个 AIPPT Designer 测试通过。

发现的问题：

- `PresentationCanvas` 目前仍保留一份历史 schema/helper 实现，短期用于降低迁移风险；后续需要把 Canvas 渲染端也迁移到 `features/aippt/schema`，再删除重复代码。
- 这还不是正式 npm 包，只是 repo 内模块边界；真正开源时还需要补 package 入口、类型导出、fixture 和独立测试。

下一步建议：

1. 把 `PresentationCanvas` 的 schema/helper 引用也切到 `features/aippt/schema`，消除重复实现。
2. 抽出 `features/aippt/renderer`，让 HTML-PPT 生成从页面组件中独立出来。
3. 为 `@aippt/schema` 增加 fixture-based 单元测试，覆盖 normalize、validate、layout scheduler、visualSpec 推断。

### Round 5 追加记录：Canvas 接入统一 Schema

执行日期：2026-06-29

本轮目标：

- 消除 `PresentationCanvas` 和 `PresentationDesigner` 各自维护一份 schema/helper 的分叉风险。
- 让主 AIPPT 生成页、Designer 编辑页和 HTML renderer 都读取同一套 schema 类型、规格化、校验与视觉推断函数。

已完成：

- `PresentationCanvas` 已改为从 `frontend/src/features/aippt/schema.ts` 引入并兼容转出以下能力：
  - Deck/Slide/VisualSpec 类型
  - `USE_CASE_LABEL / STATUS_LABEL / DECK_LAYOUT_OPTIONS / VISUAL_SPEC_TYPE_OPTIONS`
  - `inferSlideLayout / normalizePlanLayouts / validateDeckSchema`
  - `normalizeVisualSpec / visualSpecOfSlide / chartKindFromSlide`
  - `metricDataFromVisualSpec / metricDataFromBullets`
  - Designer inspector 使用的 parse/compact helper
- 删除 Canvas 内历史重复实现，保留 HTML renderer、ReactFlow 画布、主题 preset、图表 SVG/HTML 绘制函数。
- `features/aippt/schema.ts` 导出 `splitSpecItems`，供矩阵 renderer 复用同一套文本拆分规则。

验证结果：

- 后端编译：`backend/.venv/bin/python -m py_compile backend/app/main.py`
- 前端完整构建：`npm run build:full`
- E2E：`npx playwright test e2e/aippt-designer.spec.ts --project=chromium`
- 结果：3 个 AIPPT Designer 测试通过。

发现的问题：

- HTML renderer 仍在 `PresentationCanvas.tsx` 中，下一步需要抽出 `features/aippt/renderer`，才能形成真正独立开源的核心包。
- 当前 schema 模块还没有独立单测，仍主要依赖页面 E2E 覆盖。

下一步建议：

1. 抽出 `features/aippt/renderer`：`buildHtmlDeck`、slide renderer、theme tuning、chart renderer。
2. 增加 `features/aippt/schema.test.ts` 或 fixture smoke，覆盖 schema normalize/validate/visual inference。
3. 把 demo fixture 移到 `features/aippt/fixtures`，形成开源产品的示例入口。

### Round 5 追加记录：HTML Renderer 模块抽离第一步

执行日期：2026-06-29

本轮目标：

- 把 HTML-PPT 生成能力从 `PresentationCanvas` 页面组件中拆出，形成可被 Canvas、Designer 和未来开源包共同复用的纯 renderer。
- 保留现有页面交互与预览行为不回退，先完成稳定边界，再逐步删除页面内历史渲染 helper。

已完成：

- 新增 `frontend/src/features/aippt/renderer.ts`：
  - 导出 `DeckRenderStyle`，把渲染 token 从 React 页面类型中解耦。
  - 导出 `buildHtmlDeck(plan, config, style)`，内部负责主题 token、比例、slide class、图表、矩阵、架构图、流程/时间线等 HTML 渲染。
  - 复用 `features/aippt/schema.ts` 的 layout scheduler、visualSpec 推断、指标数据解析、矩阵/架构推断能力。
- `PresentationCanvas` 已改为调用 `features/aippt/renderer` 的 `buildHtmlDeck`。
- `PresentationDesigner` 已改为直接从 `features/aippt/renderer` 引入 `buildHtmlDeck`，不再通过 Canvas 页面组件间接取 HTML-PPT renderer。
- `PresentationCanvas` 暂时保留一份历史 `buildLegacyHtmlDeck` 和老渲染 helper，降低本轮拆分风险；真实预览路径已经切到新 renderer。

验证结果：

- 后端编译：`backend/.venv/bin/python -m py_compile backend/app/main.py`
- 前端完整构建：`npm run build:full`
- 构建结果通过。

下一步建议：

1. 跑 AIPPT Designer E2E，确认新 renderer 的图表来源、全屏比例、主题 token 差异和视觉截图仍然稳定。
2. 删除 `PresentationCanvas` 内历史 `buildLegacyHtmlDeck` 与未再使用的渲染 helper，把页面文件体积继续降下来。
3. 给 `features/aippt/renderer` 增加 fixture smoke，直接校验 HTML 中的 slide class、CSS vars、chart source、matrix/architecture 结构。

### Round 5 追加记录：Renderer Smoke 与页面瘦身

执行日期：2026-06-29

本轮目标：

- 让 HTML-PPT renderer 有不依赖产品页面、不依赖后端的直接验证。
- 删除 `PresentationCanvas` 中已经迁出的旧 renderer，避免页面内 legacy renderer 与 `features/aippt/renderer` 分叉。

已完成：

- 新增 `frontend/e2e/aippt-renderer.spec.ts`：
  - 直接 import `features/aippt/renderer` 的 `buildHtmlDeck`。
  - 使用完整 Deck fixture 覆盖封面、指标页、矩阵页、架构页。
  - 校验 HTML 字符串中的主题 class、CSS vars、chart source、口径、估算标记。
  - 在浏览器中校验 `.deck`、slide count、16:9 比例、无滚动溢出、矩阵列数和架构层数。
- `PresentationCanvas` 已删除旧 `STYLE_RENDER_TUNING`、旧 `buildLegacyHtmlDeck` 以及旧 HTML renderer helper。
- `PresentationCanvas` 本地 schema import 已进一步瘦身，只保留页面交互真正使用的 schema helper；兼容 re-export 继续保留。

当前边界：

- `features/aippt/schema.ts`：Deck Schema、规格化、校验、visualSpec/layout 推断。
- `features/aippt/renderer.ts`：Schema -> HTML-PPT 的纯 renderer。
- `PresentationCanvas.tsx`：AIPPT 工作台、ReactFlow 画布、流式生成、资料补充、主题 preset。
- `PresentationDesigner.tsx`：Schema 驱动低代码编辑器和单页 AI Patch 工作流。

验证结果：

- `backend/.venv/bin/python -m py_compile backend/app/main.py`
- `npm run build:full`
- `npx playwright test e2e/aippt-renderer.spec.ts --project=chromium`
- `npx playwright test e2e/aippt-designer.spec.ts --project=chromium`
- 结果：Renderer smoke 1 个测试通过；Designer E2E 3 个测试通过。

### Round 5 追加记录：主题、Fixture 与 Browser Util 抽离

执行日期：2026-06-29

本轮目标：

- 继续降低 AIPPT 核心能力对 OpenAtlas 页面组件的耦合。
- 把开源演示需要的主题 preset、富图表 demo deck、浏览器下载工具迁到 `features/aippt` 模块边界。

已完成：

- 新增 `frontend/src/features/aippt/styles.ts`：
  - 导出 `STYLE_PRESETS`、`preferredStyle`、`selectedStyle`、`styleName`。
  - 三套风格 `executive_blue / tech_launch / teaching_clear` 已独立于 Canvas 页面组件。
- 新增 `frontend/src/features/aippt/fixtures.ts`：
  - 导出 `OPENATLAS_INVESTOR_DEMO_PROMPT`。
  - 导出 12 页 `buildOpenAtlasInvestorDemo()` 富图表样例，覆盖 cover、metrics、diagram、process、compare、timeline、quote。
- 新增 `frontend/src/features/aippt/browser.ts`：
  - 导出 `safeFileTitle` 与 `downloadText`。
  - Canvas 和 Designer 不再互相引用浏览器工具函数。
- `PresentationDesigner` 不再从 `PresentationCanvas` 引入任何能力，改为直接依赖 `features/aippt/schema`、`renderer`、`styles`、`browser`。
- `PresentationCanvas` 只保留工作台交互、ReactFlow 画布、流式生成和页面级 UI，核心 schema/renderer/styles/fixtures 已迁出。
- `e2e/aippt-renderer.spec.ts` 扩展第二个 smoke：直接渲染内置投资人路演样例，校验 12 页、6 个指标页、矩阵、架构、时间线和主题 token。

当前边界：

- `features/aippt/schema.ts`：Deck Schema、规格化、校验、visualSpec/layout 推断。
- `features/aippt/renderer.ts`：Schema -> HTML-PPT 的纯 renderer。
- `features/aippt/styles.ts`：主题 preset、场景默认主题和主题名。
- `features/aippt/fixtures.ts`：开源演示 prompt 与示例 deck。
- `features/aippt/browser.ts`：文件名清洗和浏览器下载工具。
- `PresentationCanvas.tsx`：AIPPT 工作台、ReactFlow 画布、流式生成、资料补充和页面级 UI。
- `PresentationDesigner.tsx`：Schema 驱动低代码编辑器和单页 AI Patch 工作流。

验证结果：

- 后端编译：`backend/.venv/bin/python -m py_compile backend/app/main.py`
- 前端完整构建：`npm run build:full`
- Renderer smoke：`npx playwright test e2e/aippt-renderer.spec.ts --project=chromium`
- Designer E2E：`npx playwright test e2e/aippt-designer.spec.ts --project=chromium`
- 结果：Renderer smoke 2 个测试通过；Designer E2E 3 个测试通过。

发现的问题：

- 现在仍是 repo 内模块边界，还不是独立 npm package。
- `features/aippt/fixtures.ts` 仍含 OpenAtlas 品牌样例；开源前需要再补一个中性行业 demo。
- Agent adapter、storage adapter 仍停留在契约文档，还没有真实代码接口。

下一步建议：

1. 继续 Round 5 收口：抽象 `AIPPTAgentAdapter` 与 `AIPPTStorageAdapter` 的代码接口，先用当前 Hermes/API 实现做适配。
2. 增加中性 demo fixture，避免开源样例只绑定 OpenAtlas 融资叙事。
3. 将 renderer smoke 从 Playwright E2E 再拆一层轻量单测，覆盖 schema normalize、layout scheduler 和 renderer 输出稳定性。

### Round 5 追加记录：Agent 与 Storage Adapter 代码接口

执行日期：2026-06-29

本轮目标：

- 把 Designer 对 OpenAtlas 后端 API 的直接依赖收束到 adapter 实现里。
- 为后续独立开源产品预留 Hermes-compatible、OpenAI-compatible、local mock、local storage 等替换点。

已完成：

- 新增 `frontend/src/features/aippt/adapters.ts`：
  - `AipptStorageAdapter`：`listDecks/getDeck/saveSnapshot/listVersions/restoreVersion`。
  - `AipptAgentAdapter`：`runSlideAction`。
  - `AipptDeckDocument`、`AipptDeckVersion`、`AipptSlideActionRequest/Response` 等协议类型。
- 新增 `frontend/src/features/aippt/openatlas-adapters.ts`：
  - `createOpenAtlasAipptStorageAdapter()` 封装当前 `/presentation-canvas` deck/version API。
  - `createOpenAtlasAipptAgentAdapter()` 封装当前 slide-action API。
  - 导出 `OPENATLAS_AIPPT_STORAGE_ADAPTER` 和 `OPENATLAS_AIPPT_AGENT_ADAPTER`。
- `PresentationDesigner` 已从直接调用 `services/api` 改为通过 AIPPT adapter 读取 deck、保存版本、回退版本和执行单页 AI patch。
- Renderer、schema、styles、fixtures、browser、adapters 已形成当前 AIPPT 独立化第一批模块边界。

验证结果：

- TypeScript：`npx tsc -b --pretty false`
- 后端编译：`backend/.venv/bin/python -m py_compile backend/app/main.py`
- 前端完整构建：`npm run build:full`
- Renderer smoke：`npx playwright test e2e/aippt-renderer.spec.ts --project=chromium`
- Designer E2E：`npx playwright test e2e/aippt-designer.spec.ts --project=chromium`
- 结果：Renderer smoke 2 个测试通过；Designer E2E 3 个测试通过。

发现的问题：

- Adapter 已有代码接口，但 Canvas 生成页仍直接调用 `services/api` 的 stream/research/deck API，下一步需要继续迁移。
- `AipptAgentAdapter` 目前只覆盖单页 AI patch，还没覆盖大纲流式生成、资料补充和 HTML 生成后的再加工。
- Storage adapter 仍是服务端存储实现，没有 localStorage / IndexedDB mock storage。

下一步建议：

1. 把 Canvas 的流式大纲生成、资料补充和 deck snapshot API 也切到 adapter，形成完整 AIPPT API 面。
2. 增加 `MockAipptAgentAdapter` 与 `LocalAipptStorageAdapter`，让开源版可以不依赖 OpenAtlas 后端启动。
3. 增加中性 demo fixture 与 adapter smoke，验证独立产品最小闭环：生成 schema、编辑、保存、渲染、下载。

### Round 5 追加记录：Canvas Adapter 迁移与中性样例

执行日期：2026-06-29

本轮目标：

- 让 AIPPT 主 Canvas 生成页也通过 adapter 调用生成、资料补充和 deck 存储能力。
- 增加不绑定 OpenAtlas 品牌叙事的中性 demo，降低开源样例的业务耦合。

已完成：

- `AipptStorageAdapter` 扩展为覆盖完整 deck 生命周期：
  - `listDecks`
  - `getDeck`
  - `createSnapshot`
  - `saveSnapshot`
  - `listVersions`
  - `restoreVersion`
- `AipptAgentAdapter` 扩展：
  - `streamDeckPlan`
  - `generateDeck`
  - `runSlideAction`
- 新增 `AipptResearchAdapter`：
  - `researchKnowledge`
- `openatlas-adapters.ts` 已封装当前 OpenAtlas `/presentation-canvas` 生成流、资料补充、deck、version、slide-action API。
- `PresentationCanvas` 已从直接调用 `services/api` 改为通过：
  - `OPENATLAS_AIPPT_STORAGE_ADAPTER`
  - `OPENATLAS_AIPPT_AGENT_ADAPTER`
  - `OPENATLAS_AIPPT_RESEARCH_ADAPTER`
- 新增中性 demo fixture：
  - `GENERIC_OPERATIONS_DEMO_PROMPT`
  - `buildGenericOperationsDemo()`
  - 8 页“企业知识库运营升级汇报｜中性样例”，覆盖 cover、metrics、diagram、compare、process、timeline、checklist。
- Canvas 示例按钮新增“中性图表样例”，点击后可直接载入中性 HTML-PPT 样例。
- Renderer smoke 新增中性样例测试，确保样例不包含 OpenAtlas 专属融资内容，并校验主题 token、图表来源、架构、矩阵、时间线和 checklist。

当前边界：

- `features/aippt/schema.ts`：Deck Schema、规格化、校验、visualSpec/layout 推断。
- `features/aippt/renderer.ts`：Schema -> HTML-PPT 的纯 renderer。
- `features/aippt/styles.ts`：主题 preset、场景默认主题和主题名。
- `features/aippt/fixtures.ts`：OpenAtlas 富图表样例 + 中性运营升级样例。
- `features/aippt/browser.ts`：文件名清洗和浏览器下载工具。
- `features/aippt/adapters.ts`：Agent / Storage / Research adapter 协议。
- `features/aippt/openatlas-adapters.ts`：当前 OpenAtlas API 的 adapter 实现。
- `PresentationCanvas.tsx`：AIPPT 工作台、ReactFlow 画布、流式生成 UI 和页面级状态。
- `PresentationDesigner.tsx`：Schema 驱动低代码编辑器和单页 AI Patch 工作流。

验证结果：

- TypeScript：`npx tsc -b --pretty false`
- 后端编译：`backend/.venv/bin/python -m py_compile backend/app/main.py`
- 前端完整构建：`npm run build:full`
- Renderer smoke：`npx playwright test e2e/aippt-renderer.spec.ts --project=chromium`
- Designer E2E：`npx playwright test e2e/aippt-designer.spec.ts --project=chromium`
- Canvas 中性样例 smoke：登录本地页面后点击“中性图表样例”，确认 8 页中性样例可加载。
- 结果：Renderer smoke 3 个测试通过；Designer E2E 3 个测试通过；Canvas 中性样例 smoke 通过。

发现的问题：

- Adapter 已覆盖当前 OpenAtlas 生成/存储/资料补充主链路，但还没有 mock/local 实现。
- Canvas 页面仍承载较多 UI 状态和流式生成状态机，后续开源拆包时可继续拆 `useAipptCanvasController`。
- 中性样例已可见，但还没有从 UI 直接进入 Designer 并保存为本地 mock deck 的无后端链路。

下一步建议：

1. 增加 `MockAipptAgentAdapter` 和 `LocalAipptStorageAdapter`，让开源版可以离线跑通生成、编辑、保存、渲染、下载。
2. 给 Canvas adapter 链路补正式 Playwright 用例，而不是只保留一次性 smoke 脚本。
3. 开始整理开源 README 草案：模块边界、快速启动、adapter 实现、demo fixture、主题扩展方式。

### Round 5 追加记录：离线 Mock/Local Adapter 闭环

执行日期：2026-06-29

本轮目标：

- 让 AIPPT 开源版在没有 OpenAtlas 后端、没有 Hermes 的情况下，也能跑通最小产品闭环。
- 用真实 adapter 契约验证生成、编辑、保存、回退、资料补充、AI patch、HTML 渲染和下载前置能力。

已完成：

- 新增 `frontend/src/features/aippt/local-adapters.ts`：
  - `createMemoryKeyValueStorage()`：内存型 key-value storage，适合测试和本地 demo。
  - `createLocalAipptStorageAdapter()`：实现 `AipptStorageAdapter`，支持 list/get/create/save/version/restore。
  - `createMockAipptAgentAdapter()`：实现 `AipptAgentAdapter`，支持 generate、stream、rewrite、enhance_chart、roadshow_style。
  - `createMockAipptResearchAdapter()`：实现 `AipptResearchAdapter`，支持知识卡补资料和 mock source 返回。
- `adapters.ts` 新增 `AipptKeyValueStorage` 协议，方便后续接 localStorage、IndexedDB 或文件存储。
- Mock Agent 默认根据 query 选择 OpenAtlas 投资人样例或中性知识库运营样例，并输出完整 Deck Schema。
- Mock slide-action 返回结构化 slide patch、diff summary、quality 诊断和可见 warning，继续符合 Designer 的可审阅 AI patch 工作流。
- Mock research 会把 missing/assumption knowledge 转为 ready，并返回 source、warning 和 slide patch。
- 新增 `frontend/e2e/aippt-adapters.spec.ts`：
  - 离线生成 schema。
  - 流式输出 progress/complete。
  - 本地创建 deck、保存版本、列版本、回退版本。
  - mock research 补资料。
  - mock enhance_chart 生成图表 patch。
  - 使用 `buildHtmlDeck` 渲染最终 HTML，并在浏览器中检查 slide 和图表来源。

验证结果：

- TypeScript：`npx tsc -b --pretty false`
- Adapter + Renderer smoke：`npx playwright test e2e/aippt-adapters.spec.ts e2e/aippt-renderer.spec.ts --project=chromium`
- 后端编译：`backend/.venv/bin/python -m py_compile backend/app/main.py`
- 前端完整构建：`npm run build:full`
- Designer E2E：`npx playwright test e2e/aippt-designer.spec.ts --project=chromium`
- 结果：Adapter smoke 1 个测试通过；Renderer smoke 3 个测试通过；Designer E2E 3 个测试通过。

发现的问题：

- Mock/Local adapter 已具备代码能力，但还没有接入一个“离线启动模式”的 UI 入口。
- Local storage 当前默认内存存储；浏览器 `localStorage` 持久化需要由开源壳或 demo app 注入。
- Canvas 页面状态机仍在页面组件中，后续要开源成独立产品时，建议抽 `useAipptCanvasController`。

下一步建议：

1. 整理开源 README 草案：模块边界、快速启动、adapter 接入方式、主题扩展、demo fixture。
2. 增加一个最小 demo shell 或示例入口，显式使用 `MockAipptAgentAdapter + LocalAipptStorageAdapter`。
3. 把 Canvas 生成状态机抽成 hook，为独立开源包继续减页面耦合。

### Round 5 追加记录：离线 Demo Shell

执行日期：2026-06-29

本轮目标：

- 提供一个可见、可操作、无需 OpenAtlas 后端的 AIPPT demo shell。
- 验证开源用户可以直接体验 Mock Agent、Local Storage、HTML Renderer 的最小闭环。

已完成：

- 新增公开路由：`/aippt-offline-demo`。
- 新增页面：`frontend/src/pages/AipptOfflineDemo.tsx`。
- 离线页面能力：
  - Mock 生成 Deck Schema。
  - iframe 实时预览 HTML-PPT。
  - Local Storage 创建 deck 和保存版本。
  - 本地版本列表与回退入口。
  - Mock Agent 增强图表。
  - Mock Research 补资料。
  - 下载 standalone HTML。
  - 事件日志展示生成、保存、patch、research 状态。
- `AuthProvider` 对 `/aippt-offline-demo` 跳过 token 校验，避免无后端 demo 被 `/auth/me` 牵连。
- 新增 E2E：`frontend/e2e/aippt-offline-demo.spec.ts`，确认：
  - 页面可在只启动 Vite、不启动后端的情况下打开。
  - 完成 Mock 生成、保存、增强图表、补资料、再次保存。
  - iframe 内 HTML-PPT 渲染正常。
  - 全程没有 `/api` 请求。

验证结果：

- Offline Demo E2E：`OPENATLAS_E2E_BASE_URL=http://127.0.0.1:3381 npx playwright test e2e/aippt-offline-demo.spec.ts --project=chromium`
- TypeScript + 构建：`npm run build:full`
- 后端编译：`backend/.venv/bin/python -m py_compile backend/app/main.py`
- Adapter + Renderer smoke：`npx playwright test e2e/aippt-adapters.spec.ts e2e/aippt-renderer.spec.ts --project=chromium`
- 结果：Offline Demo E2E 1 个测试通过；Adapter smoke 1 个测试通过；Renderer smoke 3 个测试通过。

发现的问题：

- 离线 Demo Shell 已可运行，但还没有独立 README 中的截图和操作说明。
- 它仍使用主应用的 Vite/React 壳，真正开源时可再抽出更小的 demo app。
- Canvas 主页面状态机仍未抽 hook。

下一步建议：

1. 补正式开源 README/Quickstart，把 `/aippt-offline-demo` 作为第一入口。
2. 抽 `useAipptCanvasController`，把生成状态机从页面组件中剥离。
3. 增加 OpenAI-compatible adapter 草案或最小实现，验证真实 LLM 不依赖 Hermes。

### Round 5 追加记录：Canvas Controller 抽离

执行日期：2026-06-29

本轮目标：

- 继续降低 AIPPT 主 Canvas 对 OpenAtlas 页面组件的耦合。
- 先抽离“状态与派生值控制器”，为后续开源版 Designer/Canvas shell 复用同一套生成阶段、进度、选中页和 HTML 渲染状态做准备。

已完成：

- 新增 `frontend/src/features/aippt/use-canvas-controller.ts`：
  - 定义 `AipptDeckStage` 和 `AipptGenerationMeta`。
  - 抽出 `realSlidesOfPlan()`、`isStreamingPlaceholderSlide()`，统一流式占位页和真实页识别。
  - 抽出 `aipptStageLabel()`、`aipptOutlineProgressPercent()`、`aipptOutlineProgressText()`，统一生成状态、进度和用户反馈文案。
  - 新增 `useAipptCanvasController()`，管理 prompt/config/plan/activeDeckId、选中节点、生成阶段、最近历史、资料补充状态，并派生 style/htmlDeck/selectedSlide/selectedVisualSpec/selectedKnowledge 等页面所需状态。
- `PresentationCanvas.tsx` 已切到 `useAipptCanvasController()`：
  - 页面仍保留 ReactFlow 节点、预览弹窗、Designer 弹窗等纯 UI 状态。
  - AIPPT 数据状态、生成阶段、HTML 渲染和选中页派生值从页面组件中移出。
- 新增 `frontend/e2e/aippt-canvas-controller.spec.ts`：
  - 验证 stage label。
  - 验证流式占位节点进度。
  - 验证 `realSlidesOfPlan()` 不把 `stream-placeholder-*` 当成真实 slide。

验证结果：

- TypeScript：`npx tsc -b --pretty false`
- Canvas Controller smoke：`npx playwright test e2e/aippt-canvas-controller.spec.ts --project=chromium`
- 结果：Canvas Controller smoke 2 个测试通过。

发现的问题：

- 当前 hook 已抽出状态和派生值，但生成动作 `generatePlan()`、资料补充 `researchKnowledge()`、保存/打开最近 deck 仍在页面组件中。
- ReactFlow 的节点布局和交互仍是页面私有逻辑，开源拆包时可以继续抽 `useAipptFlowGraph()`。
- 开源 README 还没有把“离线 demo shell + controller + adapter”串成最小架构图。

下一步建议：

1. 抽第二层 `useAipptGenerationWorkflow`，把 `streamDeckPlan` 事件处理、confirm/build/reset 这条状态机从页面里继续移出。
2. 增加 OpenAI-compatible adapter 最小实现，验证真实 LLM 不依赖 Hermes。
3. 补正式开源 README/Quickstart，把 `/aippt-offline-demo`、adapter、controller、renderer 串成一条可复用链路。
