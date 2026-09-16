# AIPPT 开源拆分与 Adapter 契约草案

更新时间：2026-06-29

## 1. 拆分目标

AIPPT 独立开源时应保留“AI 生成 Deck Schema、用户编辑 Schema、Renderer 生成 HTML-PPT”的核心闭环，同时移除 OpenAtlas 专有的租户、权限、Hermes 路由和审计依赖。

第一阶段不追求完整 PowerPoint 替代品，只抽出可复用内核：

- `DeckSchema`：演示内容、页面结构、知识依赖和可视化协议。
- `Renderer`：把 `DeckSchema + DeckConfig + ThemePreset` 渲染为 HTML。
- `Designer`：低代码编辑器，所有编辑都写回 Schema。
- `AgentAdapter`：接入 Hermes、OpenAI-compatible 或 mock LLM。
- `StorageAdapter`：保存 deck、版本和最近历史。
- `ResearchAdapter`：可选资料补充能力，输出 knowledge 和 slide patch。

## 2. 包边界建议

```text
@aippt/schema
  DeckSchema types
  normalizeDeckSchema()
  validateDeckSchema()
  createEmptyDeck()

@aippt/renderer-html
  buildHtmlDeck()
  ThemePreset registry
  visualSpec-to-layout scheduler

@aippt/designer-react
  React Designer page
  Inspector components
  version/diff UI primitives

@aippt/agent
  AgentAdapter interface
  prompt builders
  JSON repair helpers

@aippt/storage
  StorageAdapter interface
  localStorage/indexedDB/file/mock implementations
```

OpenAtlas 主应用未来只保留一层 glue code：

```text
OpenAtlas route/page
  -> OpenAtlasStorageAdapter
  -> HermesAgentAdapter
  -> OpenAtlasResearchAdapter
  -> @aippt/designer-react
```

## 3. Deck Schema v1

```ts
export interface DeckSchema {
  title: string;
  subtitle?: string;
  sections: DeckSection[];
  slides: DeckSlide[];
  knowledge: KnowledgeCard[];
  generatedAt?: string;
  warnings?: string[];
}

export interface DeckSlide {
  id: string;
  sectionId: string;
  index: number;
  title: string;
  headline: string;
  bullets: string[];
  visual: string;
  layout: DeckLayout;
  knowledgeIds: string[];
  status: "draft" | "confirmed" | "needs_source" | "locked";
  speakerNotes: string;
  designIntent?: string;
  renderHints?: string[];
  evidenceRole?: string;
  visualSpec?: SlideVisualSpec;
}
```

可信度字段必须进入 `visualSpec.chart`：

```ts
export interface VisualSpecChart {
  kind?: "scorecard" | "bar" | "line";
  labels?: string[];
  series?: Array<{ name?: string; values?: number[]; unit?: string }>;
  unit?: string;
  source?: string;
  methodology?: string;
  estimated?: boolean;
}
```

规则：

- 有 `values` 时尽量给 `source`、`unit`、`methodology`、`estimated`。
- 没有可信数字时不要编造 `values`，用 `metrics.value = "待补"` 和 `knowledge.status = "missing"` 表达缺口。
- `estimated=true` 的图表必须在 Renderer 中可见。

## 4. Renderer 契约

```ts
export interface HtmlRenderer {
  buildHtmlDeck(input: {
    deck: DeckSchema;
    config: DeckConfig;
    theme: ThemePreset;
  }): string;
}
```

Renderer 必须满足：

- 只读 Schema，不修改输入对象。
- 缺字段时降级渲染，不白屏。
- `visualSpec.type` 优先于 `slide.layout` 做版式调度。
- `ThemePreset` 控制颜色、字体尺度、留白、图表线宽和页面装饰。
- 独立 HTML 在 `16:9` 和 `3:1` 下无页面级滚动。

## 5. AgentAdapter 契约

```ts
export interface AgentAdapter {
  generateOutline(input: GenerateOutlineInput): AsyncIterable<AgentEvent> | Promise<DeckSchema>;
  completeDeck(input: CompleteDeckInput): AsyncIterable<AgentEvent> | Promise<DeckSchema>;
  patchSlide(input: PatchSlideInput): Promise<SlidePatchResult>;
  repairJson?(input: JsonRepairInput): Promise<unknown>;
}
```

Agent 输出约束：

- 只输出 JSON/NDJSON，不输出 HTML。
- 大纲阶段可以缺 bullets，但必须给 layout、visual、evidenceRole 和 knowledge 缺口。
- 完整页必须给 bullets、speakerNotes、designIntent、renderHints。
- 单页 patch 必须保留 `id`、`sectionId`、`index`。
- `fallback` 只能作为状态和错误解释，不应替换成另一份假草案。

当前 repo 内已落地的适配目标：

- `OpenAtlasAipptAgentAdapter`：使用 OpenAtlas/Hermes 当前接口，代码位于 `frontend/src/features/aippt/openatlas-adapters.ts`。
- `MockAipptAgentAdapter`：本地 demo 和测试，代码位于 `frontend/src/features/aippt/local-adapters.ts`。

后续适配目标：

- `OpenAICompatibleAgentAdapter`：使用 `/v1/chat/completions`。
- `HermesAgentAdapter`：开源版如果仍需 Hermes-compatible，可作为独立实现保留，不直接耦合 OpenAtlas route。

## 6. StorageAdapter 契约

```ts
export interface StorageAdapter {
  listDecks(): Promise<DeckSummary[]>;
  getDeck(id: string): Promise<DeckDocument | null>;
  createDeck(input: CreateDeckInput): Promise<DeckDocument>;
  updateDeck(id: string, input: UpdateDeckInput): Promise<DeckDocument>;
  listVersions(deckId: string): Promise<DeckVersion[]>;
  saveVersion(deckId: string, input: SaveVersionInput): Promise<DeckVersion>;
  restoreVersion(deckId: string, versionId: string): Promise<DeckDocument>;
}
```

开源默认实现：

- `LocalAipptStorageAdapter`：浏览器 demo 或内存 demo，代码位于 `frontend/src/features/aippt/local-adapters.ts`。
- `MemoryKeyValueStorage`：单元测试和离线 smoke。
- `FileStorageAdapter`：Node 本地开发，后续可补。

OpenAtlas 私有实现继续处理租户、用户、审计和数据库。

## 7. ResearchAdapter 契约

```ts
export interface ResearchAdapter {
  researchKnowledge(input: {
    query: string;
    config: DeckConfig;
    knowledge: KnowledgeCard;
    slide?: DeckSlide;
  }): Promise<ResearchResult>;
}
```

输出：

```ts
export interface ResearchResult {
  knowledge: KnowledgeCard;
  slidePatch?: Partial<DeckSlide>;
  sources?: Array<{ title: string; url: string; snippet?: string }>;
  warnings?: string[];
}
```

规则：

- ResearchAdapter 不直接改 deck，由调用方审阅后应用。
- WebSearch 结果必须写入 `knowledge.detail/source`，并关联 `slide.knowledgeIds`。
- 无法确认的数据只能作为 assumption 或 missing，不得静默变成 ready。

## 8. Round 5 验收口径

Round 5 收口前至少具备：

- Schema validator 能识别缺资料、缺图表来源、估算缺口径。
- HTML Renderer 能显示图表 source、methodology、estimated。
- Designer 中 AI patch 可审阅再应用。
- 独立 HTML 预览和全屏视口有 E2E 视觉护栏。
- 三套 ThemePreset 在最终 HTML 中有可验证差异。
- Adapter 契约文档足够支撑后续从 OpenAtlas 中剥离。

## 9. 当前代码落点

当前还不是正式 npm package，但 repo 内模块边界已经按开源拆分方向收敛：

```text
frontend/src/features/aippt/schema.ts
  DeckConfig / DeckPlan / DeckSlide / SlideVisualSpec
  normalizePlanLayouts()
  validateDeckSchema()
  layout scheduler 与 visualSpec helper

frontend/src/features/aippt/renderer.ts
  buildHtmlDeck()
  DeckRenderStyle
  schema -> standalone HTML-PPT

frontend/src/features/aippt/styles.ts
  STYLE_PRESETS
  preferredStyle()
  selectedStyle()

frontend/src/features/aippt/fixtures.ts
  buildOpenAtlasInvestorDemo()
  buildGenericOperationsDemo()

frontend/src/features/aippt/adapters.ts
  AipptAgentAdapter
  AipptStorageAdapter
  AipptResearchAdapter
  AipptKeyValueStorage

frontend/src/features/aippt/openatlas-adapters.ts
  OPENATLAS_AIPPT_AGENT_ADAPTER
  OPENATLAS_AIPPT_STORAGE_ADAPTER
  OPENATLAS_AIPPT_RESEARCH_ADAPTER

frontend/src/features/aippt/local-adapters.ts
  createMockAipptAgentAdapter()
  createLocalAipptStorageAdapter()
  createMockAipptResearchAdapter()
  createMemoryKeyValueStorage()

frontend/src/features/aippt/use-canvas-controller.ts
  useAipptCanvasController()
  aipptStageLabel()
  aipptOutlineProgressPercent()
  aipptOutlineProgressText()
  realSlidesOfPlan()
```

## 10. 离线最小闭环示例

```ts
import { buildHtmlDeck } from "./renderer";
import { selectedStyle } from "./styles";
import {
  createLocalAipptStorageAdapter,
  createMemoryKeyValueStorage,
  createMockAipptAgentAdapter,
  createMockAipptResearchAdapter,
} from "./local-adapters";

const storage = createLocalAipptStorageAdapter({
  storage: createMemoryKeyValueStorage(),
});
const agent = createMockAipptAgentAdapter();
const research = createMockAipptResearchAdapter();

const generated = await agent.generateDeck({
  query: "生成一份企业知识库运营升级汇报",
  config,
});

const deck = await storage.createSnapshot({
  query: "生成一份企业知识库运营升级汇报",
  config: generated.config,
  plan: generated.plan,
  status: "outline_review",
});

const patch = await agent.runSlideAction(deck.id, {
  action: "enhance_chart",
  config: deck.config,
  plan: deck.plan,
  slide: deck.plan.slides[1],
});

const researched = await research.researchKnowledge({
  query: "补充资料来源",
  config: deck.config,
  knowledge: deck.plan.knowledge[0],
  slide: deck.plan.slides[1],
});

const html = buildHtmlDeck(deck.plan, deck.config, selectedStyle(deck.config));
```

对应验证：

- `npx playwright test e2e/aippt-adapters.spec.ts --project=chromium`
- 覆盖离线生成、流式事件、本地保存、版本回退、资料补充、单页 patch 和 HTML 渲染。

## 11. 下一步开源工作

- 已提供公开离线 demo shell：`/aippt-offline-demo`，显式使用 `MockAipptAgentAdapter + LocalAipptStorageAdapter`，不依赖 OpenAtlas 后端。
- 对应页面：`frontend/src/pages/AipptOfflineDemo.tsx`。
- 对应验证：`npx playwright test e2e/aippt-offline-demo.spec.ts --project=chromium`。
- 已抽出 `useAipptCanvasController`，把 Canvas 数据状态、生成阶段、选中页派生和 HTML 渲染状态从 OpenAtlas 页面中剥离。
- 对应验证：`npx playwright test e2e/aippt-canvas-controller.spec.ts --project=chromium`。
- 继续抽 `useAipptGenerationWorkflow`，把 `streamDeckPlan` 事件处理、confirm/build/reset 状态机从页面中剥离。
- 增加 `OpenAICompatibleAgentAdapter`，验证不依赖 Hermes 的真实 LLM 生成路径。
- 增加 `FileStorageAdapter` 或 IndexedDB 版本，支持本地长期保存 deck。
- 准备开源 README、License、贡献指南、demo screenshots 和主题扩展说明。
