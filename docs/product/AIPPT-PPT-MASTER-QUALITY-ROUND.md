# AIPPT PPT 生成质量对标与本轮改进记录

更新时间：2026-07-01

## 对标来源

- `ppt-master` README_CN: https://github.com/hugohe3/ppt-master/blob/main/README_CN.md
- `ppt-master` skill workflow: https://github.com/hugohe3/ppt-master/blob/main/skills/ppt-master/SKILL.md

## 可落地架构点

`ppt-master` 的高价值点不是单个模板，而是生成纪律：

- 先确认需求再生成，避免一次性把不稳定意图直接导出。
- `spec_lock` 作为版式和素材路由事实源，每页生成时重读 lock。
- 生成前预读模板、图表、图片能力，生成后用 QA gate 复查。
- PPTX 以原生图表、文本、形状为优先，图片化只作为例外。
- 复杂 deck 拆成 outline、逐页扩写、导出验证，而不是让单次 prompt 同时承担所有责任。

## 本仓根因

本轮检查发现当前 AIPPT 已有模板 registry、Spec Lock v2、PPTX 原生导出和 QA 脚本，但还有三个会拉低最终美观度/一致性的点：

- `visualSpec.templateId` 一旦存在，旧模板会跨 layout 强行生效；当编排器把页面从 metrics 改成 compare/diagram 时，旧 line_chart/bar_chart 仍可能影响 HTML/PPTX。
- Spec Lock 生成后缺少“写回 slide”的强约束；渲染器和导出器仍主要从 slide 字段重新推断，容易出现 lock、HTML、PPTX 三者漂移。
- QA 报告能看到模板覆盖、重复和 overflow，但没有把 route drift 汇总成机器 gate。

## 本轮落地

- 后端新增 Spec Lock route resolver：旧 `aippt-spec-lock-v2` 会先写回 `slide.layout/renderHints/visualSpec.templateId`，再重新生成一致的 lock。
- 后端显式模板增加 layout 对齐条件：模板 registry 中的 layout 与当前 slide.layout 不一致时，不再采用该显式模板。
- `visualSpec` 补全增强：矩阵、架构、流程、时间线、指标页会从 bullets 补齐 `columns/layers/rows/metrics`，减少导出层纯文字 fallback。
- PPTX QA 增加 `spec_lock_route_alignment` error 检查。
- `aippt_export_qa.py` 增加 `machineGate`，同时检查 PPTX 包、Spec Lock 覆盖、route drift、连续重复和潜在溢出。
- `aippt_export_qa.py` 增加 PPTX -> PDF 后的截图级视觉 gate：逐页检查页数一致、空白/低视觉密度、明显贴边裁切，并把相邻页高相似作为 warning。
- `aippt_template_gallery.py` 将同一视觉 gate 接入 33 模板画廊，避免模板库只通过结构检查但打开后观感失真。
- 前端 schema 增加 `applySpecLockToSlide()`、`specLockRouteDrifts()`，并让 `normalizePlanLayouts()` 执行 lock 写回，不改 Designer 页面。

## 本轮子任务增量：PPT 生成质量

本轮子任务只改后端生成链路与本文档，未修改前端，也未修改导出视觉 QA 脚本。

新增目标是把“模板库存在”提升为“生成链路会主动使用模板库”：

- 交付前始终执行叙事编排器，不再只在发现连续重复时才修复。保存/导出前会重新分配 `layout`、`chartTemplate`、`visualSpec`，再重建 `specLock`。
- 编排器会清理旧 `specLock` 后再重建，避免旧 lock 覆盖新 layout/template 路由，降低大纲、HTML、PPTX 三者漂移。
- 新增模板候选选择器：同一 layout 内按语义切换模板，例如 `metrics` 可在 `kpi_cards`、`metric_dashboard`、`line_chart`、`bar_chart`、`horizontal_bar_chart`、`funnel_chart`、`unit_economics` 等模板间选择；`compare`、`diagram`、`process`、`timeline` 也有各自候选池。
- 首尾页纪律更明确：第一页优先 `cover`；最后一页如果是行动/合作/联系，优先 `checklist`；如果是愿景/总结/金句，优先 `quote`。
- 模板路由强写回：`templateId/chartTemplate` 变更时，同步覆盖 `visualSpec.type` 和 `visualSpec.chart.kind`，避免 PPTX exporter 读到旧的图表类型。
- Prompt 纪律补充：Hermes 不只输出 layout，还要输出 rhythm、chartTemplate、visualSpec，并明确同一 layout 内也要换模板。
- QA 信号补充：新增 layout 家族丰富度、视觉模板丰富度、two_column 占比、首尾页叙事角色检查。模板画廊/QA fixture 跳过首尾叙事检查，避免误报。

本轮对标 `ppt-master` 的重点不是复制实现，而是吸收它的 harness 思路：模型负责结构化意图，后端编排器负责把意图锁成可复现的 Spec，PPTX 导出器读取同一条路由生成可编辑元素。

## 验收口径

本轮本地最低验收：

```bash
python backend/scripts/aippt_chain_contract.py
python backend/scripts/aippt_template_gallery.py --outdir /tmp/aippt-gallery
python -m py_compile backend/app/main.py backend/scripts/aippt_chain_contract.py backend/scripts/aippt_export_qa.py backend/scripts/aippt_template_gallery.py
```

机器判断重点：

- `specLock.version == aippt-spec-lock-v2`
- `specLockRouteDrift == []`
- `layoutRepetition == []`
- `templateRepetition == []`
- `potentialOverflows == []`
- `machineGate.ok == true`
- `summary.pptxPdfVisual.gateOk == true`
- `summary.pptxPdfVisual.pageCount == summary.pptxPdfVisual.expectedPageCount`

当前本地基线（2026-07-01）：

- 33/33 核心模板覆盖。
- 5 个原生 PowerPoint chart。
- 409 个可编辑文本形状。
- PPTX 转 PDF 视觉 gate：33 页，0 个硬错误，3 个相邻页偏相似 warning。

## 云端质量门增量

本轮把 PPTX 视觉 QA 从“本地可跑”推进为“腾讯云发布后必须可跑”：

- `deploy/deploy_tencent.sh` 默认安装 `libreoffice-impress`、`libreoffice-writer`、`fonts-noto-cjk`、`fonts-noto-color-emoji` 和 `fontconfig`，让 CVM 可在 headless 环境执行 PPTX -> PDF。
- 后端依赖新增 `PyMuPDF==1.27.2.3`，云端 backend venv 可以直接执行 PDF 截图级视觉分析。
- 新增 `deploy/aippt_cloud_quality_gate.sh`：统一验证 health、Python 编译、AIPPT chain contract、33 模板画廊、PPTX package gate、PPTX -> PDF visual gate。
- 默认 `REQUIRE_PDF_VISUAL=1`，如果云端缺 `soffice` 或缺 PDF 分析依赖导致 visual gate 被跳过，质量门会失败。

云端基线（2026-07-01，release `/opt/openatlas/releases/20260701024441`）：

- `deploy/aippt_cloud_quality_gate.sh`：通过。
- `soffice=/usr/bin/soffice`，`PyMuPDF=1.27.2.3`。
- Chain contract：8 页，`specLockRouteDrift=[]`，`nativeChartCount=2`。
- Gallery：33/33 核心模板覆盖，5 个原生 PowerPoint chart，399 个可编辑文本形状，`layoutRepetition=[]`，`templateRepetition=[]`，`potentialOverflowCount=0`。
- PPTX 转 PDF 视觉 gate：真实执行，`skipped=false`，33/33 页，0 个硬错误，4 个 warning。
- Batch Golden Prompt：8/8 案例通过，平均分 95.35，最低分 91.6；主要剩余 penalty 为 `chart_richness`、`metric_density`。
- 云端 Playwright：`aippt-renderer.spec.ts` 6/6 通过，`aippt-designer.spec.ts` 5/5 通过。

## 本轮子任务增量：业务 Golden Prompt 批量门

新增 `backend/scripts/aippt_batch_quality_gate.py`，用于把 AIPPT 从“单个 demo 看起来不错”推进到“多场景批量稳定”：

- 默认覆盖 8 个真实业务 prompt：融资路演、CIO 汇报、销售运营复盘、产品发布、数据安全培训、政企项目阶段汇报、客户成功复盘、制造业质检培训。
- 每个案例都会生成 `DeckConfig`、`DeckPlan`、PPTX、case QA report，并统计 layout/template 多样性、chart-like 页面数量、native chart 数量、two_column 占比、visualSpec 覆盖率、机器门和导出门。
- 批量报告输出到 `aippt-batch-quality.report.json`，包含平均分、最低分、通过率、失败案例和 penalty 聚合。
- 云端 `deploy/aippt_cloud_quality_gate.sh` 已接入该批量门，发布后会与 chain contract、33 模板画廊和 PPTX->PDF visual gate 一起执行。

本轮修复点：

- fallback bullets 从通用占位句改为按页面语义生成短句标签，不再使用 `2.1/8.3` 这类会被误识别为业务指标的编号。
- `核心结论/关键判断` 自动路由到 metrics 页，形成结论仪表盘，而不是普通两列页。
- rich chart 场景中，metrics 页优先选择 `line_chart/bar_chart/grouped_bar_chart/horizontal_bar_chart` 等可导出原生 chart 的模板。
- 图表页缺真实数据时，生成明确标注 `estimated=true` 的示意 series，并写入 source/methodology，避免空图或静默编造。
- PPTX 文本溢出扫描对小字号短中文双行单元格做更贴近实际放映的预算，减少对比矩阵误报。
- PPTX->PDF 视觉分析区分整页背景和前景内容贴边，避免把全屏渐变/浅色底图误判为内容裁切。
- 批量 Golden Prompt 单例报告记录 PDF visual warning/issue 类型和样例，方便定位真实导出问题。
- AIPPT 主页面创建独立 Designer 草稿失败时，不再回退到旧版弹窗 Designer，避免用户进入与 HTML 预览不同源的编辑器。

本地批量基线（2026-07-01，`backend/.venv/bin/python backend/scripts/aippt_batch_quality_gate.py --limit 8 --outdir /tmp/aippt-batch-quality-full`）：

- 8/8 案例通过。
- 平均分：95.35。
- 最低分：91.6。
- 平均内容页 layout 覆盖：5.25 类。
- 平均内容页 template 覆盖：8.25 个。
- 平均 chart-like 页面：2.25 页。
- 主要剩余 penalty：`chart_richness`、`metric_density`，说明下一轮应继续补更强的数据页/图表页密度。
- 本地 backend venv 缺 PyMuPDF/Pillow 视觉分析依赖，PPTX->PDF visual 处于 skipped；云端质量门仍要求 `REQUIRE_PDF_VISUAL=1` 真实执行。
