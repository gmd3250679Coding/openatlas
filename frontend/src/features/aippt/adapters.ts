import type { DeckConfig, DeckPlan, DeckSlide, KnowledgeCard } from './schema';

export type AipptSlideAction = 'rewrite' | 'enhance_chart' | 'roadshow_style';

export interface AipptDeckDocument {
  id: string;
  title: string;
  useCase: DeckConfig['useCase'];
  aspectRatio: DeckConfig['aspectRatio'] | string;
  styleKey: DeckConfig['styleKey'] | string;
  status: string;
  source: string;
  model: string;
  query: string;
  config: DeckConfig;
  plan?: DeckPlan;
  warnings?: string[];
  slide_count: number;
  knowledge_count: number;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface AipptDeckVersion {
  id: string;
  deck_id: string;
  version_no: number;
  title: string;
  change_summary: string;
  created_at?: string | null;
  config?: DeckConfig;
  plan?: DeckPlan;
}

export interface AipptDeckSnapshotInput {
  query?: string;
  config: DeckConfig;
  plan: DeckPlan;
  status?: string;
  change_summary?: string;
}

export interface AipptDeckSaveResponse extends AipptDeckDocument {
  version?: AipptDeckVersion;
}

export interface AipptKeyValueStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem?: (key: string) => void;
}

export interface AipptDeckGenerateResponse {
  id: string;
  source: string;
  model: string;
  config: DeckConfig;
  plan: DeckPlan;
  warnings?: string[];
  generated_at?: string;
}

export interface AipptDeckStreamEvent {
  event?: string;
  event_type?: string;
  id?: string;
  source?: string;
  model?: string;
  stage?: string;
  partial?: boolean;
  config?: DeckConfig;
  plan?: DeckPlan;
  warnings?: string[];
  message?: string;
}

export interface AipptResearchSource {
  title: string;
  url: string;
  snippet?: string;
}

export interface AipptResearchRequest {
  query: string;
  config: DeckConfig;
  knowledge: KnowledgeCard;
  slide?: Partial<DeckSlide> | null;
}

export interface AipptResearchResponse {
  id: string;
  knowledge: KnowledgeCard;
  slide_patch?: Partial<DeckSlide>;
  sources?: AipptResearchSource[];
  warnings?: string[];
  generated_at?: string;
}

export interface AipptSlideActionQuality {
  fallback?: boolean;
  repaired?: boolean;
  warning_count?: number;
  changed_fields?: string[];
  context_slide_count?: number;
  knowledge_count?: number;
}

export interface AipptSlideActionRequest {
  action: AipptSlideAction;
  instruction?: string;
  config: DeckConfig;
  plan: DeckPlan;
  slide: DeckSlide;
}

export interface AipptSlideActionResponse {
  id: string;
  action: AipptSlideAction | string;
  slide_id: string;
  slide_patch: Partial<DeckSlide>;
  rationale?: string;
  warnings?: string[];
  source?: string;
  diff_summary?: string[];
  quality?: AipptSlideActionQuality;
  generated_at?: string;
}

export interface AipptStorageAdapter {
  listDecks: () => Promise<AipptDeckDocument[]>;
  getDeck: (id: string) => Promise<AipptDeckDocument>;
  createSnapshot: (body: AipptDeckSnapshotInput) => Promise<AipptDeckSaveResponse>;
  saveSnapshot: (id: string, body: AipptDeckSnapshotInput) => Promise<AipptDeckSaveResponse>;
  listVersions: (id: string) => Promise<AipptDeckVersion[]>;
  restoreVersion: (deckId: string, versionId: string) => Promise<AipptDeckSaveResponse>;
}

export interface AipptAgentAdapter {
  generateDeck?: (body: { query: string; config: DeckConfig }) => Promise<AipptDeckGenerateResponse>;
  streamDeckPlan: (
    body: { query: string; config: DeckConfig },
    opts?: { signal?: AbortSignal },
  ) => AsyncGenerator<AipptDeckStreamEvent, void, undefined>;
  runSlideAction: (deckId: string, body: AipptSlideActionRequest) => Promise<AipptSlideActionResponse>;
}

export interface AipptResearchAdapter {
  researchKnowledge: (body: AipptResearchRequest) => Promise<AipptResearchResponse>;
}
