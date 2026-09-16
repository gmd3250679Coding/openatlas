import type {
  AipptAgentAdapter,
  AipptDeckDocument,
  AipptDeckGenerateResponse,
  AipptDeckSaveResponse,
  AipptDeckSnapshotInput,
  AipptDeckVersion,
  AipptKeyValueStorage,
  AipptResearchAdapter,
  AipptResearchResponse,
  AipptSlideActionRequest,
  AipptSlideActionResponse,
  AipptStorageAdapter,
} from './adapters';
import {
  GENERIC_OPERATIONS_DEMO_PROMPT,
  buildGenericOperationsDemo,
  buildOpenAtlasInvestorDemo,
} from './fixtures';
import type { DeckConfig, DeckPlan, DeckSlide, KnowledgeCard, SlideVisualSpec } from './schema';

export const LOCAL_AIPPT_STORAGE_KEY = 'aippt.local-store.v1';

interface LocalAipptStore {
  decks: AipptDeckDocument[];
  versions: Record<string, AipptDeckVersion[]>;
}

export function createMemoryKeyValueStorage(): AipptKeyValueStorage {
  const rows = new Map<string, string>();
  return {
    getItem: (key) => rows.get(key) ?? null,
    setItem: (key, value) => rows.set(key, value),
    removeItem: (key) => rows.delete(key),
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function timestamp() {
  return new Date().toISOString();
}

function makeId(prefix: string) {
  const randomPart = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${randomPart}`;
}

function emptyStore(): LocalAipptStore {
  return { decks: [], versions: {} };
}

function readStore(storage: AipptKeyValueStorage): LocalAipptStore {
  const raw = storage.getItem(LOCAL_AIPPT_STORAGE_KEY);
  if (!raw) return emptyStore();
  try {
    const parsed = JSON.parse(raw) as Partial<LocalAipptStore>;
    return {
      decks: Array.isArray(parsed.decks) ? parsed.decks as AipptDeckDocument[] : [],
      versions: parsed.versions && typeof parsed.versions === 'object' ? parsed.versions as Record<string, AipptDeckVersion[]> : {},
    };
  } catch {
    return emptyStore();
  }
}

function writeStore(storage: AipptKeyValueStorage, store: LocalAipptStore) {
  storage.setItem(LOCAL_AIPPT_STORAGE_KEY, JSON.stringify(store));
}

function snapshotToDeck(id: string, body: AipptDeckSnapshotInput, previous?: AipptDeckDocument): AipptDeckDocument {
  const now = timestamp();
  return {
    id,
    title: body.plan.title || body.config.topic || previous?.title || 'AIPPT Deck',
    useCase: body.config.useCase,
    aspectRatio: body.config.aspectRatio,
    styleKey: body.config.styleKey,
    status: body.status || previous?.status || 'outline_review',
    source: previous?.source || 'local-storage',
    model: previous?.model || 'local-adapter',
    query: body.query || previous?.query || '',
    config: clone(body.config),
    plan: clone(body.plan),
    warnings: previous?.warnings || [],
    slide_count: body.plan.slides.length,
    knowledge_count: body.plan.knowledge.length,
    created_at: previous?.created_at || now,
    updated_at: now,
  };
}

function makeVersion(deck: AipptDeckDocument, summary?: string): AipptDeckVersion {
  return {
    id: makeId('version'),
    deck_id: deck.id,
    version_no: 1,
    title: deck.title,
    change_summary: summary || 'Local snapshot',
    created_at: timestamp(),
    config: clone(deck.config),
    plan: deck.plan ? clone(deck.plan) : undefined,
  };
}

function pushVersion(store: LocalAipptStore, deck: AipptDeckDocument, summary?: string) {
  const rows = store.versions[deck.id] || [];
  const version = makeVersion(deck, summary);
  version.version_no = rows.length + 1;
  store.versions[deck.id] = [version, ...rows];
  return version;
}

export function createLocalAipptStorageAdapter(options: {
  storage?: AipptKeyValueStorage;
} = {}): AipptStorageAdapter {
  const storage = options.storage || createMemoryKeyValueStorage();
  return {
    async listDecks() {
      return clone(readStore(storage).decks).sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
    },
    async getDeck(id) {
      const deck = readStore(storage).decks.find((item) => item.id === id);
      if (!deck) throw new Error(`Local AIPPT deck not found: ${id}`);
      return clone(deck);
    },
    async createSnapshot(body) {
      const store = readStore(storage);
      const deck = snapshotToDeck(makeId('deck'), body);
      store.decks = [deck, ...store.decks];
      const version = pushVersion(store, deck, body.change_summary || 'Created local deck');
      writeStore(storage, store);
      return { ...clone(deck), version };
    },
    async saveSnapshot(id, body) {
      const store = readStore(storage);
      const previous = store.decks.find((item) => item.id === id);
      if (!previous) throw new Error(`Local AIPPT deck not found: ${id}`);
      const deck = snapshotToDeck(id, body, previous);
      store.decks = store.decks.map((item) => item.id === id ? deck : item);
      const version = pushVersion(store, deck, body.change_summary || 'Saved local deck');
      writeStore(storage, store);
      return { ...clone(deck), version };
    },
    async listVersions(id) {
      return clone(readStore(storage).versions[id] || []);
    },
    async restoreVersion(deckId, versionId) {
      const store = readStore(storage);
      const version = (store.versions[deckId] || []).find((item) => item.id === versionId);
      if (!version?.config || !version.plan) throw new Error(`Local AIPPT version not found: ${versionId}`);
      const previous = store.decks.find((item) => item.id === deckId);
      if (!previous) throw new Error(`Local AIPPT deck not found: ${deckId}`);
      const deck = snapshotToDeck(deckId, {
        query: previous.query,
        config: version.config,
        plan: version.plan,
        status: previous.status,
        change_summary: `Restored v${version.version_no}`,
      }, previous);
      store.decks = store.decks.map((item) => item.id === deckId ? deck : item);
      const restoreRecord = pushVersion(store, deck, `Restored v${version.version_no}`);
      writeStore(storage, store);
      return { ...clone(deck), version: restoreRecord };
    },
  };
}

function chooseFixture(query: string) {
  if (/融资|路演|投资|InsightLab/u.test(query)) return buildOpenAtlasInvestorDemo();
  return buildGenericOperationsDemo();
}

function remapDeckForRequest(query: string, config: DeckConfig): { config: DeckConfig; plan: DeckPlan } {
  const fixture = chooseFixture(query || GENERIC_OPERATIONS_DEMO_PROMPT);
  const nextConfig: DeckConfig = {
    ...fixture.config,
    ...config,
    topic: config.topic || fixture.config.topic,
  };
  const plan = clone(fixture.plan);
  plan.title = config.topic && config.topic !== fixture.config.topic
    ? `${config.topic}｜Mock AIPPT 样例`
    : plan.title;
  plan.generatedAt = timestamp();
  return { config: nextConfig, plan };
}

function slidePatchForAction(action: AipptSlideActionRequest['action'], slide: DeckSlide): Partial<DeckSlide> {
  if (action === 'roadshow_style') {
    return {
      headline: `${slide.headline}，并突出商业价值与行动请求`,
      renderHints: Array.from(new Set([...(slide.renderHints || []), 'emphasis=商业价值', 'tone=roadshow'])),
      speakerNotes: `${slide.speakerNotes || ''}\n补充投资人视角：讲清市场机会、差异化和下一步动作。`.trim(),
      status: 'draft',
    };
  }
  if (action === 'enhance_chart') {
    const visualSpec: SlideVisualSpec = {
      ...(slide.visualSpec || {}),
      type: 'combo_metrics',
      chart: {
        kind: 'line',
        labels: ['基线', '第4周', '第8周', '第12周'],
        series: [{ name: '目标改善', values: [42, 55, 66, 75], unit: '%' }],
        source: 'MockAipptAgentAdapter 示例数据',
        methodology: '离线 mock 口径，用于验证图表增强和可信度字段。',
        estimated: true,
      },
      metrics: [
        { label: '目标达成', value: '75%', detail: '第 12 周目标值' },
        { label: '提升幅度', value: '+33pt', detail: '相对基线改善' },
        { label: '数据状态', value: 'Mock', detail: '待替换为真实来源' },
      ],
    };
    return {
      layout: 'metrics',
      visual: '折线图 + 指标卡',
      visualSpec,
      renderHints: Array.from(new Set([...(slide.renderHints || []), 'chart=line', 'source=mock'])),
      status: 'draft',
    };
  }
  return {
    title: slide.title,
    headline: `${slide.headline}（已重写）`,
    bullets: slide.bullets.map((item, index) => `${index + 1}. ${item.replace(/^[\d.、\s]+/u, '')}`),
    speakerNotes: `${slide.speakerNotes || ''}\nMock 重写建议：保留本页结构，强化结论前置和表达清晰度。`.trim(),
    status: 'draft',
  };
}

export function createMockAipptAgentAdapter(options: {
  delayMs?: number;
} = {}): AipptAgentAdapter {
  const delayMs = Math.max(0, options.delayMs ?? 0);
  const sleep = () => new Promise((resolve) => globalThis.setTimeout(resolve, delayMs));
  const generateDeck = async (body: { query: string; config: DeckConfig }): Promise<AipptDeckGenerateResponse> => {
    await sleep();
    const { config, plan } = remapDeckForRequest(body.query, body.config);
    return {
      id: makeId('mock-deck'),
      source: 'mock-agent',
      model: 'mock-aippt-agent',
      config,
      plan,
      warnings: ['当前由 MockAipptAgentAdapter 生成，正式环境请替换为 Hermes/OpenAI-compatible adapter。'],
      generated_at: timestamp(),
    };
  };
  return {
    generateDeck,
    async *streamDeckPlan(body, opts) {
      const generated = await generateDeck(body);
      if (opts?.signal?.aborted) {
        yield { event_type: 'aborted', message: 'aborted' };
        return;
      }
      yield {
        event_type: 'progress',
        stage: 'outline_planning',
        message: 'Mock Agent 正在生成可编辑 AIPPT 大纲。',
        source: 'mock-agent',
        model: 'mock-aippt-agent',
      };
      if (opts?.signal?.aborted) {
        yield { event_type: 'aborted', message: 'aborted' };
        return;
      }
      yield {
        event_type: 'complete',
        id: generated?.id,
        source: generated?.source,
        model: generated?.model,
        config: generated?.config,
        plan: generated?.plan,
        warnings: generated?.warnings,
        message: `Mock Agent 已生成 ${generated?.plan.slides.length || 0} 页 AIPPT Schema。`,
      };
    },
    async runSlideAction(deckId, body): Promise<AipptSlideActionResponse> {
      await sleep();
      const patch = slidePatchForAction(body.action, body.slide);
      return {
        id: makeId('mock-patch'),
        action: body.action,
        slide_id: body.slide.id,
        slide_patch: patch,
        rationale: 'Mock Agent 根据当前 slide schema 生成可审阅补丁。',
        warnings: ['Mock patch 仅用于离线验证，请在真实环境接入 LLM adapter。'],
        source: 'mock-agent',
        diff_summary: Object.keys(patch).map((field) => `更新 ${field}`),
        quality: {
          fallback: false,
          repaired: false,
          warning_count: 1,
          changed_fields: Object.keys(patch),
          context_slide_count: body.plan.slides.length,
          knowledge_count: body.plan.knowledge.length,
        },
        generated_at: timestamp(),
      };
    },
  };
}

export function createMockAipptResearchAdapter(options: {
  delayMs?: number;
} = {}): AipptResearchAdapter {
  const delayMs = Math.max(0, options.delayMs ?? 0);
  const sleep = () => new Promise((resolve) => globalThis.setTimeout(resolve, delayMs));
  return {
    async researchKnowledge(body): Promise<AipptResearchResponse> {
      await sleep();
      const knowledge: KnowledgeCard = {
        ...body.knowledge,
        source: 'Mock Research Adapter',
        detail: `${body.knowledge.detail}\n已补充 mock 资料摘要：建议替换为真实 WebSearch 或企业知识库来源。`.trim(),
        status: 'ready',
      };
      return {
        id: makeId('mock-research'),
        knowledge,
        slide_patch: body.slide?.id ? {
          evidenceRole: '已通过 mock research 标记为待替换真实来源。',
        } : undefined,
        sources: [
          {
            title: 'Mock knowledge source',
            url: 'https://example.com/aippt-mock-source',
            snippet: '离线 mock 来源，用于验证资料补充和知识卡关联流程。',
          },
        ],
        warnings: ['Mock 资料不可用于正式汇报。'],
        generated_at: timestamp(),
      };
    },
  };
}
