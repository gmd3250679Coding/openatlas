/**
 * InsightLab API service — all data from backend, no mock.
 *
 * ID model: per spec §3.3, all entity IDs are UUID strings.  To minimize
 * touching the existing component code that uses `number | null` for
 * `employee_id`, this layer coerces the string UUID to a stable numeric
 * hash for *display only* (route keys, Map lookups).  The original UUID
 * is preserved in `__id` (string) on every record.
 *
 * Auth: Bearer token from /api/auth/login, stored in localStorage.
 */

function resolveApiBase(): string {
  const configured = import.meta.env.VITE_API_BASE as string | undefined;
  if (configured) return configured.replace(/\/$/, '');
  return '/api';
}

const API_BASE = resolveApiBase();
const TOKEN_KEY = 'openatlas_access_token';

// 32-bit FNV-1a hash of a UUID → 31-bit non-negative integer
function hashToInt(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h & 0x7fffffff;
}

function withIdShim<T extends { id: string }>(o: T): T & { id: number; __id: string } {
  return { ...o, id: hashToInt(o.id), __id: o.id };
}

function withNullableIdShim<T extends { id: string | null }>(o: T): T & { id: number | null; __id: string | null } {
  return { ...o, id: o.id == null ? null : hashToInt(o.id), __id: o.id };
}

/* ── Types — string IDs per spec ── */

export interface Employee {
  __id: string;
  id: number;            // derived numeric for legacy components
  display_name: string;
  name: string;          // alias = display_name
  avatar_char: string;
  avatar: string;
  avatar_image_url?: string | null;
  card_image_url?: string | null;
  visual_profile?: {
    avatar_image_url?: string;
    card_image_url?: string;
  };
  description: string;
  status: string;
  status_text: string;
  mood: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  profile_name: string;
  model: string;
  provider: string;
  temperature: number;
  max_tokens: number;
  system_prompt: string;
  toolsets: string[];
  allowed_toolsets?: string[] | null;
  // legacy fields used by older components/pages, optional
  department?: { name: string; color: string } | null;
  skills?: string[];
  conversation_count?: number;
  today_conversation_count?: number;
  total_messages?: number;
  last_conversation_at?: string | null;
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  avg_response_ms?: number | null;
  success_rate?: number | null;
  run_count?: number;
  recent_activity?: Array<{
    id: string;
    topic: string;
    user: string;
    time: string | null;
    status: string;
    message_count?: number;
  }>;
  runtime_params?: {
    model?: string;
    provider?: string;
    temperature?: number;
    max_tokens?: number;
    run_event_idle_timeout_seconds?: number;
    top_p?: number | null;
    frequency_penalty?: number | null;
  };
  role?: string;
}

export interface Conversation {
  __id: string;
  id: number;
  employee_id: string | null;
  hermes_session_id: string;
  title: string;
  status: string;
  task_status?: string;
  task_summary?: string;
  progress?: any;
  created_at: string;
  updated_at: string;
  last_message: string;
  message_count: number;
  is_stale?: boolean;
  is_group?: boolean;
  participant_ids?: string[] | null;
  pinned?: boolean;
  workspace?: string;
  model_override?: string;
}

export interface Message {
  id: number;
  conversation_id: number;
  role: string;
  content: string;
  token_count: number;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  speaker_employee_id?: string | number | null;
  speaker_name?: string;
  turn_index?: number | null;
  created_at: string;
}

export interface MemoryEntry {
  __id: string;
  id: number;
  scope: 'global' | 'tenant' | 'user' | 'employee';
  title: string;
  content: string;
  tags: string[];
  priority: number;
  visibility: string;
  mutable: boolean;
  status: string;
  version: number;
  employee_id: number | null;
  created_at: string;
  updated_at: string;
  source?: 'openatlas' | 'hermes';
  locked?: boolean;
}

export interface SkillPackage {
  __id: string;
  id: number;
  scope: 'global' | 'tenant' | 'user' | 'employee';
  name: string;
  slug: string;
  description: string;
  system_prompt?: string;
  input_schema?: string;
  output_schema?: string;
  few_shot_examples?: string;
  category: string;
  version: string;
  visibility: string;
  mutable: boolean;
  status: string;
  source_ref?: string;
  binding_count?: number;
  bound_employee_count?: number;
  disable_impact?: { binding_count?: number; employee_count?: number };
  ability_description?: string;
  input_example?: string;
  output_example?: string;
  suitable_employees?: string[];
  risk_level?: string;
  health?: {
    run_count?: number;
    failure_count?: number;
    failure_rate?: number;
    last_run_at?: string | null;
    last_error?: string | null;
  };
  created_at: string;
}

export interface WhiteboardDocument {
  id: string;
  title: string;
  description: string;
  kind: string;
  summary: string;
  element_count: number;
  created_at: string | null;
  updated_at: string | null;
  scene?: any;
}

export interface WhiteboardGenerateResult {
  title: string;
  kind: string;
  scene: any;
  summary: string;
  library_asset_refs?: string[];
  asset_plan?: Array<Record<string, any>>;
  skill: string;
}

export interface WhiteboardReadResult {
  summary: string;
  prompt: string;
  element_count: number;
  texts: string[];
  asset_refs?: string[];
  asset_plan?: Array<Record<string, any>>;
  skill: string;
}

export interface WhiteboardRefineResult {
  scene: any;
  patch_elements: any[];
  summary: string;
  change_plan: string[];
  library_asset_refs?: string[];
  asset_plan?: Array<Record<string, any>>;
  skill: string;
}

export type PresentationDeckUseCase = 'report' | 'roadshow' | 'training';
export type PresentationDeckAspectRatio = '16:9' | '3:1';
export type PresentationDeckDensity = 'clean' | 'standard' | 'dense';
export type PresentationDeckChartLevel = 'light' | 'balanced' | 'rich';
export type PresentationDeckStyleKey = 'executive_blue' | 'tech_launch' | 'teaching_clear';
export type PresentationSlideStatus = 'draft' | 'confirmed' | 'needs_source' | 'locked';

export interface PresentationDeckConfig {
  topic: string;
  useCase: PresentationDeckUseCase;
  aspectRatio: PresentationDeckAspectRatio;
  styleKey: PresentationDeckStyleKey;
  audience: string;
  durationMinutes: number;
  pageCount: number;
  density: PresentationDeckDensity;
  chartLevel: PresentationDeckChartLevel;
  speakerNotes: boolean;
}

export interface PresentationDeckSection {
  id: string;
  title: string;
  purpose: string;
}

export interface PresentationKnowledgeCard {
  id: string;
  title: string;
  source: string;
  detail: string;
  status: 'ready' | 'missing' | 'assumption';
}

export type PresentationDeckLayout =
  | 'cover'
  | 'section'
  | 'two_column'
  | 'compare'
  | 'metrics'
  | 'process'
  | 'timeline'
  | 'diagram'
  | 'checklist'
  | 'quote';

export type PresentationDeckRhythm = 'anchor' | 'dense' | 'breathing';
export type PresentationVisualSpecType = 'matrix' | 'architecture' | 'combo_metrics' | 'scorecard' | 'bar' | 'line' | 'process' | 'timeline' | 'roadmap' | 'generic';

export interface PresentationVisualSpecItem {
  label?: string;
  title?: string;
  value?: string | number;
  unit?: string;
  detail?: string;
  items?: string[];
  score?: 'high' | 'medium' | 'low' | number;
}

export interface PresentationVisualSpec {
  type?: PresentationVisualSpecType;
  templateId?: string;
  chartTemplate?: string;
  visualTemplate?: string;
  title?: string;
  description?: string;
  columns?: PresentationVisualSpecItem[];
  rows?: PresentationVisualSpecItem[];
  layers?: PresentationVisualSpecItem[];
  metrics?: PresentationVisualSpecItem[];
  chart?: {
    kind?: 'scorecard' | 'bar' | 'line';
    labels?: string[];
    series?: Array<{ name?: string; values?: number[]; unit?: string }>;
    unit?: string;
    source?: string;
    methodology?: string;
    estimated?: boolean;
  };
  callouts?: string[];
}

export interface PresentationDeckSlide {
  id: string;
  sectionId: string;
  index: number;
  title: string;
  headline: string;
  bullets: string[];
  visual: string;
  layout: PresentationDeckLayout;
  knowledgeIds: string[];
  status: PresentationSlideStatus;
  speakerNotes: string;
  designIntent?: string;
  renderHints?: string[];
  evidenceRole?: string;
  visualSpec?: PresentationVisualSpec;
}

export interface PresentationDeckSpecLockPage {
  slideId: string;
  index: number;
  layout: PresentationDeckLayout | string;
  rhythm: PresentationDeckRhythm | string;
  templateId?: string;
  layoutPlan?: {
    role?: string;
    density?: PresentationDeckRhythm | string;
    visualSlot?: string;
  };
  chartTemplate?: string;
  templateFamily?: string;
  visualSpecType?: string;
  pptxSupport?: string;
}

export interface PresentationDeckSpecLock {
  version: string;
  templateCatalogVersion?: string;
  canvas: {
    aspectRatio: PresentationDeckAspectRatio | string;
    size?: string;
  };
  style: {
    styleKey: PresentationDeckStyleKey | string;
    name?: string;
    colors?: Record<string, unknown>;
    typography?: Record<string, unknown>;
  };
  pageRhythm: Record<string, PresentationDeckRhythm | string>;
  pageLayouts: Record<string, PresentationDeckLayout | string>;
  pageCharts: Record<string, string>;
  pageTemplates?: Record<string, string>;
  layoutPlan?: {
    version: string;
    pages: PresentationDeckSpecLockPage[];
    diversity: {
      maxSameLayoutRun: number;
      maxSameTemplateRun: number;
      maxTwoColumnShare: number;
    };
  };
  font?: {
    family: string;
    titleMinPt: number;
    bodyMinPt: number;
    scale?: number;
  };
  color?: Record<string, unknown>;
  rhythm?: {
    pageRhythm: Record<string, PresentationDeckRhythm | string>;
    maxSameLayoutRun?: number;
    maxSameTemplateRun?: number;
  };
  imagePolicy?: Record<string, Record<string, string>>;
  exportPolicy?: {
    htmlRenderer: string;
    designerRenderer: string;
    pptxExporter: string;
    nativeChartTemplates: string[];
    nativeShapeTemplates: string[];
    shapeFallbackTemplates: string[];
  };
  pages: PresentationDeckSpecLockPage[];
  qaPolicy?: Record<string, unknown>;
}

export interface PresentationDeckPlan {
  title: string;
  sections: PresentationDeckSection[];
  slides: PresentationDeckSlide[];
  knowledge: PresentationKnowledgeCard[];
  generatedAt: string;
  specLock?: PresentationDeckSpecLock;
}

export interface PresentationDeckGenerateResponse {
  id: string;
  source: 'hermes' | 'hermes-stream' | 'hermes-stream-partial' | 'hermes-segmented' | 'hermes-segmented-partial' | 'hermes-error' | string;
  model: string;
  config: PresentationDeckConfig;
  plan: PresentationDeckPlan;
  warnings?: string[];
  generated_at?: string;
}

export interface PresentationDeckStreamEvent {
  event?: string;
  event_type?: string;
  id?: string;
  source?: 'hermes' | 'hermes-stream' | 'hermes-stream-partial' | 'hermes-segmented' | 'hermes-segmented-partial' | 'hermes-error' | string;
  model?: string;
  stage?: string;
  partial?: boolean;
  config?: PresentationDeckConfig;
  plan?: PresentationDeckPlan;
  warnings?: string[];
  message?: string;
}

export interface PresentationDeckDocument {
  id: string;
  title: string;
  useCase: PresentationDeckUseCase;
  aspectRatio: PresentationDeckAspectRatio | string;
  styleKey: PresentationDeckStyleKey | string;
  status: 'outline_review' | 'outline_partial' | 'failed' | string;
  source: string;
  model: string;
  query: string;
  config: PresentationDeckConfig;
  plan?: PresentationDeckPlan;
  warnings?: string[];
  slide_count: number;
  knowledge_count: number;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface PresentationDeckVersion {
  id: string;
  deck_id: string;
  version_no: number;
  title: string;
  change_summary: string;
  created_at?: string | null;
  config?: PresentationDeckConfig;
  plan?: PresentationDeckPlan;
}

export interface PresentationDeckResearchResponse {
  id: string;
  knowledge: PresentationKnowledgeCard;
  slide_patch?: Partial<PresentationDeckSlide>;
  sources?: Array<{ title: string; url: string; snippet?: string }>;
  warnings?: string[];
  generated_at?: string;
}

export interface PresentationDeckSaveResponse extends PresentationDeckDocument {
  version?: PresentationDeckVersion;
}

export interface PresentationSlideActionResponse {
  id: string;
  action: 'rewrite' | 'enhance_chart' | 'roadshow_style' | string;
  slide_id: string;
  slide_patch: Partial<PresentationDeckSlide>;
  rationale?: string;
  warnings?: string[];
  source?: string;
  diff_summary?: string[];
  quality?: {
    fallback?: boolean;
    repaired?: boolean;
    warning_count?: number;
    changed_fields?: string[];
    context_slide_count?: number;
    knowledge_count?: number;
  };
  generated_at?: string;
}

export interface OfficialWritingFieldDef {
  key: string;
  label: string;
  control: 'input' | 'textarea' | 'select' | string;
  required: boolean;
  value: any;
  status: 'recognized' | 'defaulted' | 'needs_confirm' | 'optional' | string;
  placeholder?: string;
  options?: Array<{ label: string; value: string }>;
  rows?: number;
}

export interface OfficialWritingComplianceItem {
  key: string;
  label: string;
  status: 'pass' | 'warn' | string;
  detail: string;
}

export interface OfficialA2UIAction {
  id: string;
  label: string;
  intent: string;
  style?: 'primary' | 'default' | 'danger' | string;
  icon?: string;
  disabled?: boolean;
}

export interface OfficialA2UIEvidenceItem {
  field?: string;
  label: string;
  value: string;
  source_text?: string;
  confidence?: number;
}

export interface OfficialA2UIBlock {
  id: string;
  type: 'render_card' | 'render_form' | 'render_template_picker' | 'render_review_panel' | 'render_actions' | string;
  variant?: string;
  title?: string;
  subtitle?: string;
  icon?: string;
  accent?: string;
  badges?: Array<{ label: string; tone?: string }>;
  layout?: 'two_column' | 'one_column' | string;
  fields?: OfficialWritingFieldDef[];
  values?: Record<string, any>;
  validation?: Record<string, any>;
  value?: string;
  options?: Array<{ key: string; label: string; description?: string }>;
  content?: string;
  compliance?: OfficialWritingComplianceItem[];
  actions?: OfficialA2UIAction[];
  items?: OfficialA2UIEvidenceItem[];
}

export interface OfficialA2UIPayload {
  schema_version: string;
  surface_id: string;
  renderer: 'react-antd' | string;
  component_registry: Record<string, string>;
  state: Record<string, any>;
  state_machine: Record<string, any>;
  validation: {
    mode?: string;
    rules?: Record<string, any>;
    missing?: string[];
  };
  ui_blocks: OfficialA2UIBlock[];
}

export interface OfficialWritingSurface {
  version: string;
  surface_id: string;
  component: string;
  title: string;
  subtitle: string;
  intent: {
    doc_type: string;
    label: string;
    group: 'official' | 'publicity' | string;
    confidence: number;
    accent?: string;
  };
  template_key: string;
  template_options: Array<{ key: string; label: string; description: string }>;
  fields: Record<string, any>;
  field_defs: OfficialWritingFieldDef[];
  missing: string[];
  compliance: OfficialWritingComplianceItem[];
  draft_preview?: string;
  actions: Array<{ id: string; label: string; intent: string }>;
  a2ui?: OfficialA2UIPayload;
  ui_blocks?: OfficialA2UIBlock[];
  state?: Record<string, any>;
  state_machine?: Record<string, any>;
  validation?: OfficialA2UIPayload['validation'];
  component_registry?: Record<string, string>;
}

export interface OfficialDocumentVersion {
  id: string;
  document_id: string;
  version_no: number;
  kind: 'docx' | string;
  name: string;
  mime_type: string;
  size: number;
  extracted_chars: number;
  change_summary: string;
  preview_url: string;
  download_url: string;
  created_at?: string | null;
}

export interface OfficialDocument {
  id: string;
  title: string;
  doc_type: string;
  doc_type_label: string;
  template_key: string;
  status: string;
  query: string;
  summary: string;
  draft_excerpt?: string;
  current_version_id?: string | null;
  version_count: number;
  fields?: Record<string, any>;
  compliance?: OfficialWritingComplianceItem[];
  versions?: OfficialDocumentVersion[];
  a2ui?: OfficialA2UIPayload;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ContractReviewIssue {
  id: string;
  contract_id: string;
  severity: 'high' | 'medium' | 'low' | string;
  category: string;
  title: string;
  clause_ref: string;
  page_no?: number | null;
  paragraph_index?: number | null;
  excerpt: string;
  risk: string;
  recommendation: string;
  proposed_revision: string;
  status: 'open' | 'accepted' | 'ignored' | string;
  confidence?: number;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ContractVersion {
  id: string;
  contract_id: string;
  version_no: number;
  kind: 'original' | 'revised' | 'report' | string;
  name: string;
  mime_type: string;
  size: number;
  extracted_chars: number;
  change_summary: string;
  preview_url: string;
  download_url: string;
  created_at?: string | null;
}

export interface ContractReviewDocument {
  id: string;
  title: string;
  contract_type: string;
  review_perspective: string;
  status: string;
  summary: string;
  current_version_id?: string | null;
  issue_counts: Record<string, number>;
  issue_count: number;
  version_count: number;
  review_skill?: {
    id: string;
    name: string;
    slug: string;
    version: string;
    category: string;
    status: string;
    description: string;
    source_ref?: string;
  };
  versions?: ContractVersion[];
  issues?: ContractReviewIssue[];
  source_preview?: {
    version_id: string;
    name: string;
    mime_type: string;
    content: string;
    preview_kind: string;
    download_url: string;
  };
  created_at?: string | null;
  updated_at?: string | null;
}

export interface AuditLog {
  id: number;
  user: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  created_at: string;
}

export interface StreamChunk {
  event_type?: string;
  event?: string;
  content?: string;
  done?: boolean;
  conversation_id?: number | string;
  error?: string;
  tool?: {
    name: string;
    label?: string;
    status?: string;
    toolCallId?: string;
    args?: any;
    result?: any;
    error?: string;
    duration?: number | string;
    waitDurationMs?: number | string;
    startedAt?: string;
    completedAt?: string;
    preview?: string;
    command?: string;
    delta?: string;
    hermes_run_id?: string;
    runtime_event?: string;
  };
  memories?: MemoryEntry[];
  files?: UploadedFile[];
  skills?: any[];
  artifacts?: any[];
  capability_plan?: any;
  collaboration_policy?: any;
  aborted?: boolean;
  openatlas_session_id?: string;
  items?: any[];
  delta?: string;
  tool_name?: string;
  label?: string;
  tool_call_id?: string;
  message?: string;
  detail?: string;
  text?: string;
  run_id?: string;
  hermes_run_id?: string;
  agent_id?: number | string;
  speaker_employee_id?: number | string | null;
  speaker_name?: string;
  turn_index?: number | null;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
  reasoning?: { text?: string; hermes_run_id?: string };
  approval_required?: {
    hermes_run_id?: string;
    run_id?: string;
    approval_id?: string;
    command?: string;
    description?: string;
    pattern_key?: string;
    pattern_keys?: string[];
    choices?: string[];
    tool_name?: string;
    source?: string;
    timeout_ms?: number;
  };
  approval_responded?: { choice?: string; reason?: string; resolved?: number; hermes_run_id?: string };
  task_state?: {
    session_id?: string;
    task_status?: string;
    reason?: string;
    openatlas_session_id?: string;
  };
  trace?: any;
}

export interface ChatResponse {
  message: Message;
  conversation_id: number;
}

export interface ToolEvent {
  name: string;
  label?: string;
  toolCallId?: string;
  status?: 'running' | 'completed' | string;
  args?: any;
  result?: any;
  error?: unknown;
  duration?: number | string;
  waitDurationMs?: number | string;
  startedAt?: string;
  completedAt?: string;
  preview?: string;
  command?: string;
  delta?: string;
  hermes_run_id?: string;
  runtime_event?: string;
}

export interface LoginIn { email: string; password: string; }
export interface RegisterIn { email: string; password: string; username?: string; }
export interface LoginOut { access_token: string; user: any; tenant: any; }

/* ── Helpers ── */

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem(TOKEN_KEY);
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string> | undefined),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (options?.body && !headers['Content-Type'] && !headers['content-type']) {
    headers['Content-Type'] = 'application/json';
  }
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw err;
    }
    const raw = String(err?.message || err || '');
    const hint = typeof window !== 'undefined' && /wangsix-atlas\.cloud/i.test(window.location.hostname)
      ? '当前域名可能被云厂商备案/拦截页接管，请先使用公网 IP 入口访问。'
      : '请确认 InsightLab 后端服务已启动，并且当前访问入口可以连到 /api。';
    throw new Error(`InsightLab API 暂时不可达。${hint}${raw ? ` 原始错误：${raw}` : ''}`);
  }
  if (response.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    if (!path.startsWith('/auth/')) window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let detail = text || response.statusText;
    try {
      const j = JSON.parse(text);
      if (j?.detail) detail = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail);
    } catch { /* not JSON */ }
    throw new Error(`API ${response.status}: ${detail}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

/* ── Auth ── */

export async function login(email: string, password: string): Promise<LoginOut> {
  const out = await apiFetch<LoginOut>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  localStorage.setItem(TOKEN_KEY, out.access_token);
  return out;
}

// Legacy aliases for components that haven't been migrated
export const loginApi = login;

export async function registerApi(email: string, password: string, username?: string): Promise<LoginOut> {
  const out = await apiFetch<LoginOut>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, username }),
  });
  localStorage.setItem(TOKEN_KEY, out.access_token);
  return out;
}

export function logout() {
  localStorage.removeItem(TOKEN_KEY);
  window.location.href = '/login';
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

let currentUserRequest: { token: string; promise: Promise<any> } | null = null;

export async function fetchMe(): Promise<any> {
  const token = getToken();
  if (!token) throw new Error('Missing auth token');
  if (currentUserRequest?.token === token) return currentUserRequest.promise;
  const promise = apiFetch('/auth/me').finally(() => {
    if (currentUserRequest?.token === token) {
      currentUserRequest = null;
    }
  });
  currentUserRequest = { token, promise };
  return promise;
}

// Legacy alias used by AuthContext.tsx
export const fetchCurrentUser = fetchMe;

/* ── Employees ── */

function normalizeEmployee(e: any) {
  return {
    ...e,
    name: e.display_name,
    avatar_char: e.avatar,
    status_text: e.status,
    mood: '',
    is_active: e.status === 'active',
    conversation_count: Number(e.conversation_count || 0),
    today_conversation_count: Number(e.today_conversation_count || 0),
    total_messages: Number(e.total_messages || 0),
    total_tokens: Number(e.total_tokens || 0),
    input_tokens: Number(e.input_tokens || 0),
    output_tokens: Number(e.output_tokens || 0),
    avg_response_ms: e.avg_response_ms ?? null,
    success_rate: e.success_rate ?? null,
    run_count: Number(e.run_count || 0),
    recent_activity: Array.isArray(e.recent_activity) ? e.recent_activity : [],
    runtime_params: e.runtime_params || {},
  };
}

export async function fetchEmployees(options?: RequestInit): Promise<Employee[]> {
  const r = await apiFetch<{ items: any[] }>('/employees', options);
  return r.items
    .filter((e) => e?.status !== 'archived')
    .map((e) => withIdShim(normalizeEmployee(e))) as any;
}

export async function fetchEmployeeDetail(id: string): Promise<Employee & { skills: any[] }> {
  const realId = await resolveEmployeeUuid(id);
  const e = await apiFetch<any>(`/employees/${realId || id}`);
  return { ...withIdShim(normalizeEmployee(e)),
           skills: e.skills || [] } as any;
}

export async function createEmployee(body: {
  display_name: string;
  description?: string;
  avatar?: string;
  avatar_image_url?: string;
  card_image_url?: string;
  system_prompt?: string;
  toolsets?: string[];
  initial_skill_ids?: string[];
  model?: string;
}): Promise<Employee> {
  const e = await apiFetch<any>('/employees', { method: 'POST', body: JSON.stringify(body) });
  return withIdShim(normalizeEmployee(e)) as any;
}

export async function patchEmployee(id: string, body: any): Promise<Employee> {
  const e = await apiFetch<any>(`/employees/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
  return withIdShim(normalizeEmployee(e)) as any;
}

export async function dismissEmployee(id: string): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/employees/${id}`, { method: 'DELETE' });
}

/* ── Sessions / chat ── */

export async function fetchSessions(): Promise<Conversation[]> {
  const r = await apiFetch<{ items: any[] }>('/sessions?limit=100');
  return r.items.map((s) => withIdShim({ ...s, status: 'active' })) as any;
}

// Bug 3/4/11 (2026-06-06): 加 participantIds 参 (群聊接力员工 UUID 列表).
// 之前 createSession 只发 { employee_id, title } 不传 relays, 后端收到的是
// 空 list, 群聊 = 单聊.  现在后端 SessionRecord.participant_ids 存 relays,
// list_sessions 透传, chat stream 串行 dispatch.
export async function createSession(
  employeeId: string | null,
  title: string,
  participantIds?: string[],
): Promise<Conversation> {
  const s = await apiFetch<any>('/sessions', {
    method: 'POST',
    body: JSON.stringify({
      employee_id: employeeId,
      title,
      participant_ids: participantIds || [],
    }),
  });
  return withIdShim({ ...s, status: 'active' }) as any;
}

export async function fetchSessionMessages(id: string | number): Promise<{ data: Message[] }> {
  // FNV-1a shim safety: resolve shim int → real UUID before hitting backend.
  const realId = await resolveRealSessionId(id);
  const r = await apiFetch<any>(`/sessions/${realId}/messages`);
  return { data: r.data || r.items || [] };
}

export async function approveHermesRun(
  runId: string,
  choice: 'once' | 'session' | 'always' | 'deny' = 'deny',
  resolveAll = false,
  approvalId?: string,
): Promise<any> {
  return apiFetch(`/hermes-runs/${encodeURIComponent(runId)}/approval`, {
    method: 'POST',
    body: JSON.stringify({ choice, resolve_all: resolveAll, approval_id: approvalId }),
  });
}

export async function stopHermesRun(runId: string, reason = 'user_requested'): Promise<any> {
  return apiFetch(`/hermes-runs/${encodeURIComponent(runId)}/stop`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export async function forkSession(
  id: string | number,
  title = '',
): Promise<Conversation> {
  const realId = await resolveRealSessionId(id);
  const r = await apiFetch<any>(`/sessions/${realId}/fork`, {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
  return withIdShim({ ...r, status: 'active' }) as any;
}

export async function patchSession(
  id: string | number,
  patch: {
    title?: string;
    pinned?: boolean;
    workspace?: string;
    model_override?: string;
  },
): Promise<Conversation> {
  const realId = await resolveRealSessionId(id);
  const r = await apiFetch<any>(`/sessions/${realId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return withIdShim({ ...r, status: 'active' }) as any;
}

export async function* streamChat(
  sessionId: string, message: string,
  opts?: {
    attachmentIds?: string[];
    relayEmployeeIds?: string[];
    primaryEmployeeId?: string | null;
    reasoningEffort?: string;
    signal?: AbortSignal;
  },
): AsyncGenerator<StreamChunk, void, undefined> {
  const token = getToken();
  const resp = await fetch(`${API_BASE}/sessions/${sessionId}/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      message,
      ...(opts?.attachmentIds?.length ? { attachment_ids: opts.attachmentIds } : {}),
      ...(opts?.relayEmployeeIds?.length ? { relay_employee_ids: opts.relayEmployeeIds } : {}),
      ...(opts?.primaryEmployeeId ? { primary_employee_id: opts.primaryEmployeeId } : {}),
      ...(opts?.reasoningEffort ? { reasoning_effort: opts.reasoningEffort } : {}),
    }),
    signal: opts?.signal,  // P3.12 3.4.3: 切会话时 abort
  });
  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => '');
    yield { event_type: 'error', error: text || resp.statusText };
    return;
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        let evName = 'message';
        let dataLines: string[] = [];
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) evName = line.slice(6).trim();
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
        }
        const dataStr = dataLines.join('\n');
        if (!dataStr && evName === 'message') continue;
        let parsed: any = {};
        try { parsed = dataStr ? JSON.parse(dataStr) : {}; } catch { parsed = { raw: dataStr }; }
        yield { event: evName, event_type: evName, ...parsed } as StreamChunk;
      }
    }
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      yield { event_type: 'aborted', aborted: true };
    } else {
      yield { event_type: 'error', error: String(e) };
    }
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }
}

export async function* streamSessionEvents(
  sessionId: string | number,
  opts?: { signal?: AbortSignal },
): AsyncGenerator<any, void, undefined> {
  const realId = await resolveRealSessionId(sessionId);
  const token = getToken();
  const resp = await fetch(`${API_BASE}/sessions/${realId}/events`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: opts?.signal,
  });
  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => '');
    yield { event_type: 'error', error: text || resp.statusText };
    return;
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        let evName = 'message';
        const dataLines: string[] = [];
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) evName = line.slice(6).trim();
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
        }
        const dataStr = dataLines.join('\n');
        if (!dataStr && evName === 'message') continue;
        let parsed: any = {};
        try { parsed = dataStr ? JSON.parse(dataStr) : {}; } catch { parsed = { raw: dataStr }; }
        yield { event: evName, event_type: evName, ...parsed };
      }
    }
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      yield { event_type: 'aborted', aborted: true };
    } else {
      yield { event_type: 'error', error: String(e) };
    }
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }
}

/* ── Capabilities / models / runtime ── */

export async function fetchCapabilities(): Promise<any> { return apiFetch('/capabilities'); }
export async function fetchModels(): Promise<any> { return apiFetch('/models'); }
export async function fetchToolsets(): Promise<any> { return apiFetch('/toolsets'); }
export async function fetchToolsetGovernance(): Promise<any> { return apiFetch('/toolsets/governance'); }
export async function updateEmployeeToolsets(employeeId: string, toolsets: string[]): Promise<any> {
  return apiFetch(`/employees/${employeeId}/toolsets`, {
    method: 'PATCH',
    body: JSON.stringify({ toolsets }),
  });
}
export async function fetchRuntimeHealth(): Promise<any> { return apiFetch('/runtime/health'); }
export async function fetchRuntimeStatus(): Promise<any> { return apiFetch('/runtime/status'); }
export async function fetchRuntimeDiagnostics(): Promise<any> { return apiFetch('/runtime/diagnostics'); }
export async function fetchRuntimeLogs(kind = 'gateway', tail = 120): Promise<any> {
  const q = new URLSearchParams({ kind, tail: String(tail) });
  return apiFetch(`/runtime/logs?${q.toString()}`);
}
export async function runRuntimeOperation(action: string): Promise<any> {
  return apiFetch(`/runtime/ops/${encodeURIComponent(action)}`, { method: 'POST', body: '{}' });
}
export async function fetchTenantIsolation(): Promise<any> { return apiFetch('/tenant/isolation'); }
export async function fetchJobs(): Promise<any> { return apiFetch('/jobs'); }

/* ── Skill Market ── */

export async function fetchSkillMarket(): Promise<SkillPackage[]> {
  const r = await apiFetch<{ items: any[] }>('/skill-market');
  return r.items.map((s) => withIdShim(s)) as any;
}

export async function createSkill(body: {
  name: string; slug: string; description?: string; category?: string;
  scope: 'global' | 'tenant' | 'user'; visibility?: string; mutable?: boolean;
}): Promise<SkillPackage> {
  const s = await apiFetch<any>('/skill-market', { method: 'POST', body: JSON.stringify(body) });
  return withIdShim(s) as any;
}

export async function syncHermesSkills(): Promise<any> {
  const r = await apiFetch<any>('/skill-market/sync-hermes', { method: 'POST', body: '{}' });
  return { ...r, items: (r.items || []).map((s: any) => withIdShim(s)) };
}

export async function fetchSkillHealth(): Promise<any> {
  return apiFetch('/skill-market/health');
}

export async function reconcileHermesSkills(): Promise<any> {
  return apiFetch('/skill-market/reconcile-hermes');
}

export async function browseHermesSkillsHub(params: {
  page?: number; size?: number; source?: string;
} = {}): Promise<any> {
  const q = new URLSearchParams();
  if (params.page) q.set('page', String(params.page));
  if (params.size) q.set('size', String(params.size));
  if (params.source) q.set('source', params.source);
  return apiFetch(`/hermes-skills/hub/browse?${q.toString()}`);
}

export async function searchHermesSkillsHub(params: {
  q: string; source?: string; limit?: number; only_installable?: boolean;
}): Promise<any> {
  const q = new URLSearchParams({ q: params.q });
  if (params.source) q.set('source', params.source);
  if (params.limit) q.set('limit', String(params.limit));
  q.set('only_installable', String(params.only_installable ?? true));
  return apiFetch(`/hermes-skills/hub/search?${q.toString()}`);
}

export async function inspectHermesSkill(identifier: string): Promise<any> {
  const q = new URLSearchParams({ identifier });
  return apiFetch(`/hermes-skills/hub/inspect?${q.toString()}`);
}

export async function installHermesSkill(body: {
  identifier: string; source?: string; category?: string; name?: string; force?: boolean;
}): Promise<any> {
  return apiFetch('/hermes-skills/hub/install', { method: 'POST', body: JSON.stringify(body) });
}

export async function hermesSkillLifecycleAction(
  action: 'check' | 'update' | 'audit' | 'uninstall' | 'opt-out' | 'opt-in' | 'reset' | 'repair-official',
  body: {
    name?: string; deep?: boolean; restore?: boolean; remove?: boolean; sync?: boolean; force?: boolean;
  } = {},
): Promise<any> {
  return apiFetch(`/hermes-skills/hub/${action}`, { method: 'POST', body: JSON.stringify(body) });
}

export async function exportHermesSkillSnapshot(): Promise<any> {
  return apiFetch('/hermes-skills/hub/snapshot/export', { method: 'POST', body: '{}' });
}

export async function importHermesSkillSnapshot(path: string, force = false): Promise<any> {
  return apiFetch('/hermes-skills/hub/snapshot/import', {
    method: 'POST',
    body: JSON.stringify({ path, force }),
  });
}

export async function listHermesSkillTaps(): Promise<any> {
  return apiFetch('/hermes-skills/hub/taps');
}

export async function addHermesSkillTap(repo: string): Promise<any> {
  return apiFetch('/hermes-skills/hub/taps', { method: 'POST', body: JSON.stringify({ name: repo }) });
}

export async function removeHermesSkillTap(name: string): Promise<any> {
  return apiFetch(`/hermes-skills/hub/taps/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

export async function bindSkill(skillId: string, body: {
  target_type: 'user' | 'employee'; target_id: string; binding_mode?: string;
}): Promise<any> {
  return apiFetch(`/skill-market/${skillId}/bind`, {
    method: 'POST',
    body: JSON.stringify({ ...body, skill_id: skillId }),
  });
}

/* ── Memory Center ── */

export async function fetchMemories(scope?: string): Promise<MemoryEntry[]> {
  const q = scope ? `?scope=${encodeURIComponent(scope)}` : '';
  const r = await apiFetch<{ items: any[] }>(`/memories${q}`);
  return r.items.map((m) => withNullableIdShim({ ...m, source: 'openatlas' as const })) as any;
}

export async function createMemory(body: {
  scope: 'global' | 'tenant' | 'user' | 'employee';
  title: string; content: string; tags?: string[];
  priority?: number; visibility?: string; mutable?: boolean;
  employee_id?: string;
}): Promise<MemoryEntry> {
  const m = await apiFetch<any>('/memories', { method: 'POST', body: JSON.stringify(body) });
  return withNullableIdShim({ ...m, source: 'openatlas' as const }) as any;
}

export async function patchMemory(id: string, body: any): Promise<MemoryEntry> {
  const m = await apiFetch<any>(`/memories/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
  return withNullableIdShim({ ...m, source: 'openatlas' as const }) as any;
}

export async function archiveMemory(id: string): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/memories/${id}/archive`, { method: 'POST' });
}

export async function fetchEffectiveMemories(employeeId?: string): Promise<MemoryEntry[]> {
  const q = employeeId ? `?employee_id=${encodeURIComponent(employeeId)}` : '';
  const r = await apiFetch<{ items: any[] }>(`/memories/effective${q}`);
  return r.items.map((m) => withNullableIdShim({ ...m, source: 'openatlas' as const, locked: m.locked })) as any;
}
/* ── Dashboard ── */

export async function fetchDashboardMe(): Promise<any> { return apiFetch('/dashboard/me'); }
export async function fetchDashboardTenant(): Promise<any> { return apiFetch('/dashboard/tenant'); }
export async function fetchDashboardSystem(): Promise<any> { return apiFetch('/dashboard/system'); }
export async function maintainStaleSessions(limit = 20): Promise<any> {
  const q = new URLSearchParams({ limit: String(limit) });
  return apiFetch(`/sessions/maintenance/stale?${q.toString()}`, { method: 'POST', body: '{}' });
}

export async function refreshSessionSummary(sessionId: string | number): Promise<any> {
  const realId = await resolveRealSessionId(sessionId);
  return apiFetch(`/sessions/${realId}/summary`, { method: 'POST', body: '{}' });
}

export async function patchSessionTaskStatus(sessionId: string | number, task_status: string): Promise<any> {
  const realId = await resolveRealSessionId(sessionId);
  return apiFetch(`/sessions/${realId}/task-status`, {
    method: 'PATCH',
    body: JSON.stringify({ task_status }),
  });
}

export async function fetchRunQueue(): Promise<any[]> {
  const r = await apiFetch<{ items: any[] }>('/run-queue');
  return r.items || [];
}

export async function resumeSessionTask(sessionId: string | number, message = ''): Promise<any> {
  const realId = await resolveRealSessionId(sessionId);
  return apiFetch(`/sessions/${realId}/resume`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
}

export async function recoverSessionTask(sessionId: string | number): Promise<any> {
  const realId = await resolveRealSessionId(sessionId);
  return apiFetch(`/sessions/${realId}/recover`, { method: 'POST', body: '{}' });
}

export async function fetchSessionHealth(sessionId: string | number, reconcile = false): Promise<any> {
  const realId = await resolveRealSessionId(sessionId);
  const q = new URLSearchParams();
  if (reconcile) q.set('reconcile', 'true');
  return apiFetch(`/sessions/${realId}/health${q.toString() ? `?${q.toString()}` : ''}`);
}

export async function fetchSessionContext(sessionId: string | number): Promise<any> {
  const realId = await resolveRealSessionId(sessionId);
  return apiFetch(`/sessions/${realId}/context`);
}

export async function fetchSessionArtifacts(sessionId: string | number): Promise<any> {
  const realId = await resolveRealSessionId(sessionId);
  return apiFetch(`/sessions/${realId}/artifacts`);
}

export async function fetchArtifacts(opts: {
  sessionId?: string;
  employeeId?: string;
  status?: string;
  kind?: string;
  managedStatus?: string;
  query?: string;
  includeArchived?: boolean;
  limit?: number;
} = {}): Promise<{ items: any[] }> {
  const q = new URLSearchParams();
  if (opts.sessionId) q.set('session_id', opts.sessionId);
  if (opts.employeeId) q.set('employee_id', opts.employeeId);
  if (opts.status) q.set('status', opts.status);
  if (opts.kind) q.set('kind', opts.kind);
  if (opts.managedStatus) q.set('managed_status', opts.managedStatus);
  if (opts.query) q.set('q', opts.query);
  if (opts.includeArchived) q.set('include_archived', 'true');
  if (opts.limit) q.set('limit', String(opts.limit));
  return apiFetch(`/artifacts${q.toString() ? `?${q.toString()}` : ''}`);
}

export async function archiveArtifact(artifactId: string): Promise<any> {
  return apiFetch(`/artifacts/${artifactId}/archive`, { method: 'POST', body: '{}' });
}

export async function patchArtifact(artifactId: string, patch: { name?: string; status?: string }): Promise<any> {
  return apiFetch(`/artifacts/${artifactId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}


/* ════════════════════════════════════════════════════════════════════════
 * Phase 3.5 — Job lifecycle, Skill Market publish/fork/disable, Memory fork/bind
 * ════════════════════════════════════════════════════════════════════════ */

/* Jobs */

export async function createJob(body: {
  name: string; description?: string; schedule_kind?: string;
  schedule_expr?: string; employee_id?: string | null;
  skills?: string[]; toolsets?: string[];
  deliver?: string; prompt?: string;
}): Promise<any> {
  return apiFetch('/jobs', { method: 'POST', body: JSON.stringify(body) });
}
export async function getJob(id: string): Promise<any> { return apiFetch(`/jobs/${id}`); }
export async function patchJob(id: string, body: any): Promise<any> {
  return apiFetch(`/jobs/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}
export async function deleteJob(id: string): Promise<{ ok: true }> {
  return apiFetch(`/jobs/${id}`, { method: 'DELETE' });
}
export async function pauseJob(id: string): Promise<any> {
  return apiFetch(`/jobs/${id}/pause`, { method: 'POST', body: '{}' });
}
export async function resumeJob(id: string): Promise<any> {
  return apiFetch(`/jobs/${id}/resume`, { method: 'POST', body: '{}' });
}
export async function runJob(id: string): Promise<any> {
  return apiFetch(`/jobs/${id}/run`, { method: 'POST', body: '{}' });
}

/* Skill Market — extended CRUD */

export async function getSkill(id: string): Promise<any> { return apiFetch(`/skill-market/${id}`); }
export async function patchSkill(id: string, body: any): Promise<any> {
  return apiFetch(`/skill-market/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}
export async function publishSkill(id: string): Promise<any> {
  return apiFetch(`/skill-market/${id}/publish`, { method: 'POST', body: '{}' });
}
export async function disableSkill(id: string): Promise<any> {
  return apiFetch(`/skill-market/${id}/disable`, { method: 'POST', body: '{}' });
}
export async function forkSkill(id: string, target_scope: 'user' | 'employee', target_id?: string): Promise<any> {
  return apiFetch(`/skill-market/${id}/fork`, { method: 'POST', body: JSON.stringify({ target_scope, target_id }) });
}

/* Phase 3.7: ZIP import — multipart upload */
export async function importSkillFromZip(file: File, scope: 'user' | 'tenant' | 'global' = 'user'): Promise<any> {
  const fd = new FormData();
  fd.append('file', file);
  const token = localStorage.getItem(TOKEN_KEY) || '';
  // We must NOT use apiFetch because it adds Content-Type: application/json which breaks multipart.
  // Use raw fetch and bypass the JSON wrapper.
  const url = `${API_BASE}/skill-market/import?scope=${encodeURIComponent(scope)}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: fd,
  });
  if (!resp.ok) {
    let detail: any = `HTTP ${resp.status}`;
    try { const j = await resp.json(); detail = j.detail || j.message || j; } catch { /* non-json */ }
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }
  return resp.json();
}

export async function deleteSkillBinding(bindingId: string): Promise<{ ok: true }> {
  return apiFetch(`/skill-bindings/${bindingId}`, { method: 'DELETE' });
}

/* Phase 3.9: List skill bindings (used by EmployeeDetail + Skills page) */
export interface SkillBindingRow {
  id: string;
  skill_id: string;
  skill_name: string;
  skill_version: string;
  skill_scope: string;
  skill_category: string;
  target_type: string;
  target_id: string;
  binding_mode: string;
  enabled: boolean;
  locked: boolean;
  created_at: string | null;
}
export async function fetchSkillBindings(opts: {
  target_type?: 'employee' | 'user' | 'tenant';
  target_id?: string;
  skill_id?: string;
} = {}): Promise<SkillBindingRow[]> {
  const q = new URLSearchParams();
  if (opts.target_type) q.set('target_type', opts.target_type);
  if (opts.target_id) q.set('target_id', opts.target_id);
  if (opts.skill_id) q.set('skill_id', opts.skill_id);
  const qs = q.toString();
  const r = await apiFetch<{ items: SkillBindingRow[] }>(`/skill-bindings${qs ? `?${qs}` : ''}`);
  return r.items || [];
}

/* Memory — fork + bind + unbind */

export async function getMemory(id: string): Promise<any> { return apiFetch(`/memories/${id}`); }
export async function forkMemory(id: string, body: { target_scope: 'user' | 'employee'; employee_id?: string }): Promise<any> {
  return apiFetch(`/memories/${id}/fork`, { method: 'POST', body: JSON.stringify(body) });
}
export async function bindMemory(id: string, body: { target_type: string; target_id: string; injection_mode?: string; priority?: number }): Promise<any> {
  return apiFetch(`/memories/${id}/bind`, { method: 'POST', body: JSON.stringify(body) });
}
export async function deleteMemoryBinding(bindingId: string): Promise<{ ok: true }> {
  return apiFetch(`/memory-bindings/${bindingId}`, { method: 'DELETE' });
}


/* ════════════════════════════════════════════════════════════════════════
 * Legacy / shim layer — older components still import these names.  They
 * delegate to the new names above and adapt payloads.
 * ════════════════════════════════════════════════════════════════════════ */

// Conversational-sympathy aliases (old: Conversation, new: same; old: createConversation, new: createSession)
export const fetchConversations = fetchSessions;
async function resolveEmployeeUuid(id: number | string | null | undefined): Promise<string | null> {
  if (id == null) return null;
  if (typeof id === 'string' && id.includes('-')) return id;
  const emps = await fetchEmployees() as any[];
  const cached = emps.find((e: any) => e.id === id || e.__id === id || String(e.id) === String(id));
  return cached?.__id || (typeof id === 'string' ? id : null);
}

function titleFromQuery(query?: string | null) {
  const clean = String(query || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return '';
  return clean.length > 42 ? `${clean.slice(0, 42)}...` : clean;
}

export const createConversation = async (employeeId: number | string | null, title?: string) =>
  createSession(await resolveEmployeeUuid(employeeId), titleFromQuery(title));
// Bug 3/4/11 (2026-06-06): createGroupConversation 真传 relays.  之前只
// 调 createSession(employeeIds[0], title) 不传 relays, 后端收到空 list, 群聊
// 变单聊.  现在用 fetchEmployees() 拉一遍 (拿 __id 真 uuid) 把除主员工外的
// 所有员工 ID 传 participant_ids, 后端落库 SessionRecord.participant_ids.
export const createGroupConversation = async (
  employeeIds: (number | string)[] | number | string,
  relayIdsOrTitle?: (number | string)[] | string,
  maybeTitle?: string,
) => {
  const ids = Array.isArray(employeeIds)
    ? employeeIds
    : [employeeIds, ...(Array.isArray(relayIdsOrTitle) ? relayIdsOrTitle : [])];
  const title = typeof relayIdsOrTitle === 'string' ? relayIdsOrTitle : maybeTitle;
  if (ids.length === 0) {
    return createSession(null, title || '多员工群聊', []);
  }
  const primary = ids[0] ?? '';
  const relayIds = ids.slice(1) || [];
  if (relayIds.length === 0) {
    return createSession(await resolveEmployeeUuid(primary), title || '群聊', []);
  }
  // relays 可能是 shim int (CommandCenter 调), 必须 fetch 真 uuid
  const emps = await fetchEmployees() as any[];
  const primaryUuid = await resolveEmployeeUuid(primary);
  const relayUuids = relayIds
    .map((id) => {
      const cached = emps.find((e) => (
        (e as any).id === id
        || (e as any).__id === id
        || String((e as any).id) === String(id)
        || String((e as any).__id) === String(id)
      )) as any;
      return cached?.__id || (typeof id === 'string' ? id : null);
    })
    .filter(Boolean) as string[];
  return createSession(primaryUuid, title || '群聊', relayUuids);
};
export const deleteConversation = async (id: string | number) => {
  const realId = await resolveRealSessionId(id);
  return apiFetch<{ ok: true }>(`/sessions/${realId}`, { method: 'DELETE' });
};

// Canvas state — store on the session in the backend
export async function patchCanvasState(sessionId: string | number, state: any): Promise<{ ok: true }> {
  const realId = await resolveRealSessionId(sessionId);
  return apiFetch<{ ok: true }>(`/sessions/${realId}/canvas-state`, {
    method: 'PATCH',
    body: JSON.stringify(state),
  });
}
export async function getCanvasState(sessionId: string | number): Promise<any> {
  const realId = await resolveRealSessionId(sessionId);
  return apiFetch(`/sessions/${realId}/canvas-state`);
}
export async function logCanvasEvent(sessionId: string | number, payload?: any): Promise<any> {
  const realId = await resolveRealSessionId(sessionId);
  const employeeId = payload?.employee_id ? await resolveEmployeeUuid(payload.employee_id).catch(() => payload.employee_id) : null;
  return apiFetch(`/sessions/${realId}/canvas-events`, {
    method: 'POST',
    body: JSON.stringify({
      employee_id: employeeId,
      event_type: payload?.event_type || payload?.type || 'canvas.event',
      node_id: payload?.node_id || payload?.nodeId || '',
      edge_id: payload?.edge_id || payload?.edgeId || '',
      payload: payload || {},
    }),
  });
}

export async function fetchWhiteboards(): Promise<WhiteboardDocument[]> {
  const r = await apiFetch<{ items: WhiteboardDocument[] }>('/whiteboards');
  return r.items || [];
}

export async function createWhiteboard(body: {
  title: string;
  description?: string;
  kind?: string;
  scene: any;
  summary?: string;
}): Promise<WhiteboardDocument> {
  return apiFetch<WhiteboardDocument>('/whiteboards', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function getWhiteboard(id: string): Promise<WhiteboardDocument> {
  return apiFetch<WhiteboardDocument>(`/whiteboards/${id}`);
}

export async function patchWhiteboard(id: string, body: {
  title?: string;
  description?: string;
  kind?: string;
  scene?: any;
  summary?: string;
}): Promise<WhiteboardDocument> {
  return apiFetch<WhiteboardDocument>(`/whiteboards/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function deleteWhiteboard(id: string): Promise<{ ok: true; id: string }> {
  return apiFetch<{ ok: true; id: string }>(`/whiteboards/${id}`, { method: 'DELETE' });
}

export async function generateWhiteboard(body: {
  kind: 'flowchart' | 'ppt' | 'architecture' | 'wireframe' | string;
  prompt: string;
  title?: string;
  slide_count?: number;
}): Promise<WhiteboardGenerateResult> {
  return apiFetch<WhiteboardGenerateResult>('/whiteboards/generate', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function refineWhiteboard(body: {
  scene: any;
  instruction: string;
  mode?: string;
  title?: string;
}): Promise<WhiteboardRefineResult> {
  return apiFetch<WhiteboardRefineResult>('/whiteboards/refine', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function readWhiteboard(body: {
  scene: any;
  target?: string;
  title?: string;
}): Promise<WhiteboardReadResult> {
  return apiFetch<WhiteboardReadResult>('/whiteboards/read', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/* ── AIPPT Workspace ── */

export async function fetchPresentationDecks(): Promise<PresentationDeckDocument[]> {
  const r = await apiFetch<{ items: PresentationDeckDocument[] }>('/presentation-canvas/decks');
  return r.items || [];
}

export async function getPresentationDeck(id: string): Promise<PresentationDeckDocument> {
  return apiFetch<PresentationDeckDocument>(`/presentation-canvas/decks/${encodeURIComponent(id)}`);
}

export async function createPresentationDeckSnapshot(body: {
  query?: string;
  config: PresentationDeckConfig;
  plan: PresentationDeckPlan;
  status?: string;
  change_summary?: string;
}): Promise<PresentationDeckSaveResponse> {
  return apiFetch<PresentationDeckSaveResponse>('/presentation-canvas/decks', {
    method: 'POST',
    body: JSON.stringify({
      query: body.query || '',
      config: body.config,
      plan: body.plan,
      status: body.status || 'outline_review',
      change_summary: body.change_summary || '',
    }),
  });
}

export async function savePresentationDeckSnapshot(id: string, body: {
  query?: string;
  config: PresentationDeckConfig;
  plan: PresentationDeckPlan;
  status?: string;
  change_summary?: string;
}): Promise<PresentationDeckSaveResponse> {
  return apiFetch<PresentationDeckSaveResponse>(`/presentation-canvas/decks/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({
      query: body.query || '',
      config: body.config,
      plan: body.plan,
      status: body.status || 'outline_review',
      change_summary: body.change_summary || '',
    }),
  });
}

export async function fetchPresentationDeckVersions(id: string): Promise<PresentationDeckVersion[]> {
  const r = await apiFetch<{ items: PresentationDeckVersion[] }>(`/presentation-canvas/decks/${encodeURIComponent(id)}/versions`);
  return r.items || [];
}

export async function restorePresentationDeckVersion(deckId: string, versionId: string): Promise<PresentationDeckSaveResponse> {
  return apiFetch<PresentationDeckSaveResponse>(
    `/presentation-canvas/decks/${encodeURIComponent(deckId)}/versions/${encodeURIComponent(versionId)}/restore`,
    { method: 'POST' },
  );
}

export async function downloadPresentationDeckPptx(deckId: string, body: {
  query?: string;
  config: PresentationDeckConfig;
  plan: PresentationDeckPlan;
  status?: string;
  change_summary?: string;
}): Promise<Blob> {
  const token = localStorage.getItem(TOKEN_KEY);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API_BASE}/presentation-canvas/decks/${encodeURIComponent(deckId)}/export-pptx`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      query: body.query || '',
      config: body.config,
      plan: body.plan,
      status: body.status || 'outline_review',
      change_summary: body.change_summary || '',
    }),
  });
  if (response.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`API ${response.status}: ${text || response.statusText}`);
  }
  return response.blob();
}

export interface PresentationDeckPptxValidationReport {
  ok: boolean;
  checks: Array<{ key: string; ok: boolean; detail: string; severity?: 'error' | 'warning' }>;
  quality?: Array<{ key: string; ok: boolean; detail: string; severity?: 'error' | 'warning' }>;
  warnings: string[];
  errors: string[];
  compatibility_scope?: string;
}

export async function validatePresentationDeckPptx(deckId: string, body: {
  query?: string;
  config: PresentationDeckConfig;
  plan: PresentationDeckPlan;
  status?: string;
  change_summary?: string;
}): Promise<PresentationDeckPptxValidationReport> {
  return apiFetch<PresentationDeckPptxValidationReport>(`/presentation-canvas/decks/${encodeURIComponent(deckId)}/validate-pptx`, {
    method: 'POST',
    body: JSON.stringify({
      query: body.query || '',
      config: body.config,
      plan: body.plan,
      status: body.status || 'outline_review',
      change_summary: body.change_summary || '',
    }),
  });
}

export async function runPresentationSlideAction(deckId: string, body: {
  action: 'rewrite' | 'enhance_chart' | 'roadshow_style';
  instruction?: string;
  config: PresentationDeckConfig;
  plan: PresentationDeckPlan;
  slide: PresentationDeckSlide;
}): Promise<PresentationSlideActionResponse> {
  return apiFetch<PresentationSlideActionResponse>(`/presentation-canvas/decks/${encodeURIComponent(deckId)}/slide-action`, {
    method: 'POST',
    body: JSON.stringify({
      action: body.action,
      instruction: body.instruction || '',
      config: body.config,
      plan: body.plan,
      slide: body.slide,
    }),
  });
}

export async function generatePresentationDeckPlan(body: {
  query: string;
  config: PresentationDeckConfig;
}): Promise<PresentationDeckGenerateResponse> {
  return apiFetch<PresentationDeckGenerateResponse>('/presentation-canvas/generate', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function* streamPresentationDeckPlan(
  body: {
    query: string;
    config: PresentationDeckConfig;
  },
  opts?: { signal?: AbortSignal },
): AsyncGenerator<PresentationDeckStreamEvent, void, undefined> {
  const token = getToken();
  const resp = await fetch(`${API_BASE}/presentation-canvas/generate/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: opts?.signal,
  });
  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => '');
    yield { event_type: 'error', message: text || resp.statusText };
    return;
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        let evName = 'message';
        const dataLines: string[] = [];
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) evName = line.slice(6).trim();
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
        }
        const dataStr = dataLines.join('\n');
        if (!dataStr && evName === 'message') continue;
        let parsed: any = {};
        try { parsed = dataStr ? JSON.parse(dataStr) : {}; } catch { parsed = { raw: dataStr }; }
        yield { ...parsed, event: evName, event_type: evName === 'message' ? (parsed.event_type || evName) : evName };
      }
    }
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      yield { event_type: 'aborted', message: 'aborted' };
    } else {
      yield { event_type: 'error', message: String(e) };
    }
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }
}

export async function researchPresentationDeckKnowledge(body: {
  query: string;
  config: PresentationDeckConfig;
  knowledge: PresentationKnowledgeCard;
  slide?: Partial<PresentationDeckSlide> | null;
}): Promise<PresentationDeckResearchResponse> {
  return apiFetch<PresentationDeckResearchResponse>('/presentation-canvas/research', {
    method: 'POST',
    body: JSON.stringify({
      query: body.query,
      config: body.config,
      knowledge: body.knowledge,
      slide: body.slide || {},
    }),
  });
}

/* ── Official Writing Workspace ── */

export async function fetchOfficialDocuments(): Promise<OfficialDocument[]> {
  const r = await apiFetch<{ items: OfficialDocument[] }>('/official-documents');
  return r.items || [];
}

export async function extractOfficialDocumentIntent(query: string): Promise<OfficialWritingSurface> {
  return apiFetch<OfficialWritingSurface>('/official-documents/intent', {
    method: 'POST',
    body: JSON.stringify({ query }),
  });
}

export async function generateOfficialDocument(body: {
  query?: string;
  doc_type: string;
  template_key?: string;
  fields: Record<string, any>;
}): Promise<OfficialDocument> {
  return apiFetch<OfficialDocument>('/official-documents/generate', {
    method: 'POST',
    body: JSON.stringify({
      query: body.query || '',
      doc_type: body.doc_type,
      template_key: body.template_key || 'gbt9704',
      fields: body.fields || {},
    }),
  });
}

export async function reviseOfficialDocument(
  id: string,
  body: {
    instruction: string;
    fields?: Record<string, any>;
  },
): Promise<OfficialDocument> {
  return apiFetch<OfficialDocument>(`/official-documents/${id}/revise`, {
    method: 'POST',
    body: JSON.stringify({
      instruction: body.instruction || '',
      fields: body.fields || {},
    }),
  });
}

export async function getOfficialDocument(id: string): Promise<OfficialDocument> {
  return apiFetch<OfficialDocument>(`/official-documents/${id}`);
}

export function officialDocumentVersionPreviewUrl(versionId: string): string {
  return `${API_BASE}/official-documents/versions/${encodeURIComponent(versionId)}/preview`;
}

export function officialDocumentVersionDownloadUrl(versionId: string): string {
  return `${API_BASE}/official-documents/versions/${encodeURIComponent(versionId)}/download`;
}

export async function previewOfficialDocumentVersion(versionId: string): Promise<any> {
  return apiFetch(`/official-documents/versions/${versionId}/preview`);
}

/* ── Contract Review Workspace ── */

export async function fetchContractReviews(): Promise<ContractReviewDocument[]> {
  const r = await apiFetch<{ items: ContractReviewDocument[] }>('/contract-reviews');
  return r.items || [];
}

export async function uploadContractReview(
  file: File,
  opts: { contractType?: string; reviewPerspective?: string } = {},
): Promise<ContractReviewDocument> {
  const fd = new FormData();
  fd.append('file', file);
  const token = localStorage.getItem(TOKEN_KEY) || '';
  const q = new URLSearchParams({
    contract_type: opts.contractType || 'general',
    review_perspective: opts.reviewPerspective || 'balanced',
  });
  const resp = await fetch(`${API_BASE}/contract-reviews/upload?${q.toString()}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: fd,
  });
  if (!resp.ok) {
    let detail = `HTTP ${resp.status}`;
    try {
      const j = await resp.json();
      detail = typeof j?.detail === 'string' ? j.detail : JSON.stringify(j?.detail || j);
    } catch { /* ignore */ }
    throw new Error(detail);
  }
  return resp.json();
}

export async function fetchContractReview(id: string): Promise<ContractReviewDocument> {
  return apiFetch<ContractReviewDocument>(`/contract-reviews/${id}`);
}

export async function runContractReview(
  id: string,
  body: {
    contract_type?: string;
    review_perspective?: string;
    review_template?: string;
    focus?: string[];
  } = {},
): Promise<ContractReviewDocument> {
  return apiFetch<ContractReviewDocument>(`/contract-reviews/${id}/review`, {
    method: 'POST',
    body: JSON.stringify({
      contract_type: body.contract_type || 'general',
      review_perspective: body.review_perspective || 'balanced',
      review_template: body.review_template || 'standard',
      focus: body.focus || [],
    }),
  });
}

export async function patchContractIssue(issueId: string, status: 'open' | 'accepted' | 'ignored'): Promise<ContractReviewIssue> {
  return apiFetch<ContractReviewIssue>(`/contract-reviews/issues/${issueId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export async function regenerateContractDeliverables(id: string): Promise<ContractReviewDocument> {
  return apiFetch<ContractReviewDocument>(`/contract-reviews/${id}/deliverables/regenerate`, {
    method: 'POST',
  });
}

export function contractVersionPreviewUrl(versionId: string): string {
  return `${API_BASE}/contract-reviews/versions/${encodeURIComponent(versionId)}/preview`;
}

export function contractVersionDownloadUrl(versionId: string): string {
  return `${API_BASE}/contract-reviews/versions/${encodeURIComponent(versionId)}/download`;
}

export async function previewContractVersion(versionId: string): Promise<any> {
  return apiFetch(`/contract-reviews/versions/${versionId}/preview`);
}

export async function saveSessionTemplate(
  sessionId: string | number,
  body: {
    name: string;
    description?: string;
    category?: string;
    visibility?: string;
    strategy?: string;
    failure_strategy?: string;
    default_prompt?: string;
    output_type?: string;
  },
): Promise<any> {
  const realId = await resolveRealSessionId(sessionId);
  return apiFetch(`/sessions/${realId}/save-template`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function fetchCollaborationTemplates(): Promise<any[]> {
  const r = await apiFetch<{ items: any[] }>('/collaboration-templates');
  return r.items || [];
}

export async function createSessionFromTemplate(
  templateId: string,
  body: { title?: string } = {},
): Promise<Conversation> {
  const s = await apiFetch<any>(`/collaboration-templates/${templateId}/sessions`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return withIdShim({ ...s, status: 'active' }) as any;
}

// Admin / identity
export async function fetchAdminStats(): Promise<any> {
  return fetchDashboardMe();
}
export async function fetchTenants(): Promise<any[]> {
  const r = await apiFetch<{ items: any[] }>('/admin/tenants');
  return r.items || [];
}
export async function patchTenant(id: string, body: any): Promise<any> {
  return apiFetch(`/admin/tenants/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}
export async function fetchAdminTenantIsolation(id: string): Promise<any> {
  return apiFetch(`/admin/tenants/${id}/isolation`);
}
export async function fetchIdentityOverview(tenantId?: string): Promise<any> {
  const q = tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : '';
  return apiFetch(`/admin/identity/overview${q}`);
}
export async function fetchOrgUnits(tenantId?: string): Promise<any[]> {
  const q = tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : '';
  const r = await apiFetch<{ items: any[] }>(`/admin/org-units${q}`);
  return r.items || [];
}
export async function createOrgUnit(body: any): Promise<any> {
  return apiFetch('/admin/org-units', { method: 'POST', body: JSON.stringify(body) });
}
export async function patchOrgUnit(id: string, body: any): Promise<any> {
  return apiFetch(`/admin/org-units/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}
export async function deleteOrgUnit(id: string): Promise<{ ok: true }> {
  return apiFetch(`/admin/org-units/${id}`, { method: 'DELETE' });
}
export async function fetchAdminUsers(filter: { tenant_id?: string; org_unit_id?: string; q?: string } = {}): Promise<any[]> {
  const params = new URLSearchParams();
  if (filter.tenant_id) params.set('tenant_id', filter.tenant_id);
  if (filter.org_unit_id) params.set('org_unit_id', filter.org_unit_id);
  if (filter.q) params.set('q', filter.q);
  const qs = params.toString();
  const r = await apiFetch<{ items: any[] }>(`/admin/users${qs ? '?' + qs : ''}`);
  return r.items || [];
}
export async function createAdminUser(body: any): Promise<any> {
  return apiFetch('/admin/users', { method: 'POST', body: JSON.stringify(body) });
}
export async function fetchAdminUserDetail(id: string): Promise<any> {
  return apiFetch(`/admin/users/${id}/detail`);
}
export async function patchAdminUser(id: string, body: any): Promise<any> {
  return apiFetch(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}
export async function moveAdminUsersOrg(body: { user_ids: string[]; org_unit_id?: string | null }): Promise<any> {
  return apiFetch('/admin/users/move-org', { method: 'POST', body: JSON.stringify(body) });
}
export async function deleteAdminUser(id: string): Promise<{ ok: true; user: any }> {
  return apiFetch(`/admin/users/${id}`, { method: 'DELETE' });
}
export async function fetchPermissionMatrix(tenantId?: string): Promise<any> {
  const q = tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : '';
  return apiFetch(`/admin/permission-matrix${q}`);
}
export async function patchPermissionMatrix(body: { tenant_id?: string | null; role: string; capability: string; allowed: boolean }): Promise<any> {
  return apiFetch('/admin/permission-matrix', { method: 'PATCH', body: JSON.stringify(body) });
}
export async function fetchAuditLogs(filter?: any): Promise<AuditLog[]> {
  const params = new URLSearchParams();
  ['action', 'resource_type', 'resource_id', 'user_id', 'since', 'until', 'q',
   'employee_id', 'skill_id', 'file_id', 'session_id'].forEach((key) => {
    if (filter?.[key]) params.set(key, filter[key]);
  });
  if (filter?.limit) params.set('limit', String(filter.limit));
  const qs = params.toString();
  const r = await apiFetch<{ items?: any[] } | any[]>(`/audit${qs ? '?' + qs : ''}`);
  const items = Array.isArray(r) ? r : (r.items || []);
  return items as any;
}

export async function exportAuditCsv(filter?: any): Promise<void> {
  const params = new URLSearchParams();
  params.set('fmt', 'csv');
  ['action', 'resource_type', 'resource_id', 'user_id', 'since', 'until', 'q',
   'employee_id', 'skill_id', 'file_id', 'session_id'].forEach((key) => {
    if (filter?.[key]) params.set(key, filter[key]);
  });
  const tok = getToken();
  const r = await fetch(`${API_BASE}/audit?${params.toString()}`, {
    headers: tok ? { Authorization: `Bearer ${tok}` } : {},
  });
  if (!r.ok) throw new Error(`csv export failed: ${r.status}`);
  const blob = await r.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `openatlas-audit-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 100);
}
export async function fetchDepartments(): Promise<any[]> {
  return [];
}
export async function fetchKnowledgeBases(): Promise<any[]> {
  return [];
}
export async function fetchSolutions(): Promise<any[]> {
  return [];
}

// Conversational detail (used by CommandCenter)
export async function fetchConversationDetail(id: string | number): Promise<any> {
  // FNV-1a shim safety: callers may pass either the shim int (key={item.id})
  // or a real UUID. Resolve to the real UUID before hitting backend.
  const realId = await resolveRealSessionId(id);
  const meta = await apiFetch<any>(`/sessions/${realId}`);
  const msgs = await fetchSessionMessages(realId);
  return { ...meta, messages: msgs.data || [] };
}

// Resolve a possibly-shimmed session identifier to the real backend UUID.
// Strategy: if `id` is a number OR a short numeric string, look up the full
// session list and find the one whose shim matches. Otherwise pass through.
async function resolveRealSessionId(id: string | number | undefined | null): Promise<string> {
  if (id == null) return '';
  const s = String(id);
  // Looks like a UUID already?
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return s;
  if (/^api_/.test(s)) return s; // hermes sid; pass through (calls may 404 but caller can disambiguate)
  // Try the list lookup
  try {
    const all = await fetchSessions();
    const hit = all.find((x: any) => String(x.id) === s || x.__id === s);
    if (hit?.__id) return hit.__id;
  } catch { /* ignore */ }
  return s; // best effort
}

// executeSkill — for now, return a synthetic tool event
export async function executeSkill(..._payload: any[]): Promise<any> {
  return { ok: true, message: 'skill executed (stub)' };
}

// updateMyQuickPrompts — store in localStorage
export async function updateMyQuickPrompts(prompts: string[]): Promise<{ ok: true; quick_prompts: string[] }> {
  localStorage.setItem('openatlas_quick_prompts', JSON.stringify(prompts));
  return { ok: true, quick_prompts: prompts };
}

// P3.12 (2026-06-07) Bug 7 / 3.4.1: uploadFile 真调后端, 返回 attachment_id
export interface UploadedFile {
  id: string;
  url?: string;  // 现在后端不返 url, 只返 id (前端要拿内容要再调 /api/files/{id})
  name: string;
  mime: string;
  size: number;
  status: string;
  extracted_chars: number;
  summary?: string;
  snippets?: Array<{ index: number; text: string }>;
  expires_at?: string | null;
  is_expired?: boolean;
}

export interface FilePreviewPayload {
  id: string;
  name: string;
  mime_type: string;
  size: number;
  preview_kind: 'html' | 'markdown' | 'json' | 'csv' | 'docx_html' | 'document_text' | 'pdf_text' | 'image' | 'text' | string;
  renderable: boolean;
  content: string;
  download_url: string;
  source: string;
}

export interface WorkspaceFileItem {
  name: string;
  path: string;
  kind: 'file' | 'directory';
  mime_type: string;
  size: number;
  preview_kind: string;
  previewable: boolean;
  modified_at: string;
}

export async function uploadFile(
  file: File,
  opts?: { sessionId?: string; employeeId?: string },
): Promise<UploadedFile> {
  const token = localStorage.getItem('openatlas_access_token') || '';
  const fd = new FormData();
  fd.append('file', file);
  const params = new URLSearchParams();
  if (opts?.sessionId) params.set('session_id', opts.sessionId);
  if (opts?.employeeId) params.set('employee_id', opts.employeeId);
  const qs = params.toString();
  const res = await fetch(`${API_BASE}/files/upload${qs ? '?' + qs : ''}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: fd,
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`upload failed (${res.status}): ${errText.slice(0, 200)}`);
  }
  const fa = await res.json();
  return {
    id: fa.id,
    name: fa.original_name,
    mime: fa.mime_type,
    size: fa.size,
    status: fa.status,
    extracted_chars: fa.extracted_chars,
    summary: fa.summary,
    snippets: fa.snippets || [],
    expires_at: fa.expires_at,
    is_expired: fa.is_expired,
  };
}

export async function previewUploadedFile(fileId: string): Promise<FilePreviewPayload> {
  return apiFetch(`/files/${encodeURIComponent(fileId)}/preview`);
}

export async function previewArtifact(artifactId: string): Promise<FilePreviewPayload> {
  return apiFetch(`/artifacts/${encodeURIComponent(artifactId)}/preview`);
}

export async function fetchWorkspaceFiles(opts: {
  sessionId?: string | null;
  scope?: 'workspace' | 'uploads' | 'shared' | string;
  path?: string;
} = {}): Promise<{ scope: string; session_id?: string | null; path: string; items: WorkspaceFileItem[] }> {
  const q = new URLSearchParams();
  if (opts.sessionId) q.set('session_id', opts.sessionId);
  if (opts.scope) q.set('scope', opts.scope);
  if (opts.path) q.set('path', opts.path);
  return apiFetch(`/workspace/files${q.toString() ? `?${q.toString()}` : ''}`);
}

export async function previewWorkspaceFile(opts: {
  sessionId?: string | null;
  scope?: string;
  path: string;
}): Promise<FilePreviewPayload> {
  const q = new URLSearchParams();
  if (opts.sessionId) q.set('session_id', opts.sessionId);
  if (opts.scope) q.set('scope', opts.scope);
  q.set('path', opts.path);
  return apiFetch(`/workspace/files/preview?${q.toString()}`);
}

function resolveProtectedUrl(downloadUrl: string): string {
  return downloadUrl.startsWith('/api/')
    ? `${API_BASE}${downloadUrl.slice(4)}`
    : downloadUrl.startsWith('/' )
      ? `${API_BASE}${downloadUrl}`
      : downloadUrl;
}

export async function fetchProtectedFileBlob(downloadUrl: string): Promise<Blob> {
  const token = localStorage.getItem(TOKEN_KEY);
  const url = resolveProtectedUrl(downloadUrl);
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`download failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return res.blob();
}

export async function downloadProtectedFile(downloadUrl: string, filename?: string): Promise<void> {
  const blob = await fetchProtectedFileBlob(downloadUrl);
  const token = localStorage.getItem(TOKEN_KEY);
  const url = resolveProtectedUrl(downloadUrl);
  let headerName = '';
  try {
    const head = await fetch(url, { method: 'HEAD', headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const cd = head.headers.get('content-disposition') || '';
    const match = cd.match(/filename\*=UTF-8''([^;]+)/i) || cd.match(/filename="?([^";]+)"?/i);
    headerName = match ? decodeURIComponent(match[1]) : '';
  } catch {
    headerName = '';
  }
  const name = filename || headerName || `openatlas-download-${Date.now()}`;
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
}

export async function fetchFiles(opts: {
  sessionId?: string;
  employeeId?: string;
  limit?: number;
} = {}): Promise<UploadedFile[]> {
  const q = new URLSearchParams();
  if (opts.sessionId) q.set('session_id', opts.sessionId);
  if (opts.employeeId) q.set('employee_id', opts.employeeId);
  if (opts.limit) q.set('limit', String(opts.limit));
  const r = await apiFetch<{ items: any[] }>(`/files${q.toString() ? `?${q.toString()}` : ''}`);
  return (r.items || []).map((fa) => ({
    id: fa.id,
    name: fa.original_name,
    mime: fa.mime_type,
    size: fa.size,
    status: fa.status,
    extracted_chars: fa.extracted_chars,
    summary: fa.summary,
    snippets: fa.snippets || [],
    expires_at: fa.expires_at,
    is_expired: fa.is_expired,
  }));
}

export async function deleteFile(fileId: string): Promise<void> {
  await apiFetch(`/files/${fileId}`, { method: 'DELETE' });
}

export async function pruneExpiredFiles(): Promise<{ ok: true; deleted: number; ttl_days: number }> {
  return apiFetch('/files/prune-expired', { method: 'POST' });
}

// routeToEmployee — emit a custom event the router can pick up
export async function routeToEmployee(id: number | string): Promise<{ employee_id: number }> {
  window.dispatchEvent(new CustomEvent('openatlas:route', { detail: { kind: 'employee', id } }));
  const emps = await fetchEmployees().catch(() => []);
  const input = String(id ?? '').trim().toLowerCase();
  const receptionist = (emps as any[]).find((e: any) => String(e.name || e.display_name || '').trim() === '行政小六')
    || (emps as any[]).find((e: any) => /行政小六|行政|接待|atlas/i.test(String(e.name || e.display_name || '')));
  if (typeof id === 'number') {
    const byId = (emps as any[]).find((e: any) => e.id === id);
    if (byId) return { employee_id: Number(byId.id) };
  }
  const mentions = Array.from(input.matchAll(/@([^\s@,，。；;:：]+)/g))
    .map((m) => m[1]?.trim().toLowerCase())
    .filter(Boolean);
  const matched = input
    ? (emps as any[]).find((e: any) => {
      const name = String(e.name || e.display_name || '').trim().toLowerCase();
      if (!name) return false;
      if (mentions.length > 0) {
        return mentions.some((mention) => name === mention || name.includes(mention) || mention.includes(name));
      }
      return input === name || input.includes(`@${name}`) || (name.length >= 2 && input.includes(name));
    })
    : null;
  const chosen = matched || receptionist || (emps[0] as any);
  return { employee_id: Number(chosen?.id || 1) };
}

/* ════════════════════════════════════════════════════════════════════════
 * Type shims — legacy components import these names.
 * ════════════════════════════════════════════════════════════════════════ */
export type EmployeeDetail = Employee;
export type KnowledgeBase = { id: number; name: string; description: string; doc_count: number; type: string; size: string; status: string; };
export type Department = { id: number; name: string; color: string; employee_count: number; };
export type Solution = { id: number; name: string; description: string; icon: string; employee_count: number; };
export type SkillCreate = { skill_name: string; description?: string; config?: any; };
export type EmployeeCreate = { name: string; avatar_char?: string; department_id: number; system_prompt?: string; status_text?: string; mood?: string; skills: SkillCreate[]; allowed_toolsets?: string[] | null; hermes_skills?: string[] | null; model_override?: string | null; };
export type DismissResponse = { id: number; name: string; was_active: boolean; is_active: boolean; message: string; };
export type AuditLogFilter = any;
export type PlatformStats = any;
export type Tenant = any;
export type Attachment = {
  id?: string;
  url?: string;
  name: string;
  mime: string;
  size: number;
  status?: string;
  extracted_chars?: number;
  summary?: string;
  snippets?: Array<{ index: number; text: string }>;
  expires_at?: string | null;
  is_expired?: boolean;
};
export type CanvasStatePayload = any;
export type CanvasReplay = {
  employee_name?: string;
  session_title?: string;
  total?: number;
  events: any[];
  steps?: any[];
  checkpoints?: any[];
  forks?: any[];
  runs?: any[];
  artifacts?: any[];
  workflow_run?: any;
};

/* ════════════════════════════════════════════════════════════════════════
 * Function shims — legacy components import these names.
 * ════════════════════════════════════════════════════════════════════════ */

// hireEmployee: alias for createEmployee
export const hireEmployee = createEmployee;

// listSkills: alias for fetchSkillMarket
export const listSkills = fetchSkillMarket;

function normalizeToolError(value: unknown): unknown {
  if (value === false || value == null || value === '') return undefined;
  if (typeof value === 'string') {
    const clean = value.trim().toLowerCase();
    if (!clean || clean === 'false' || clean === 'null' || clean === 'undefined') return undefined;
  }
  return value;
}

function isFalseErrorMarker(value: unknown): boolean {
  return value === false || (typeof value === 'string' && value.trim().toLowerCase() === 'false');
}

function normalizeToolStatus(status: unknown, error: unknown): 'running' | 'completed' | string | undefined {
  const raw = status == null ? '' : String(status);
  if (isFalseErrorMarker(error) && (raw === 'failed' || raw === 'error')) return 'completed';
  return raw || undefined;
}

// chatWithEmployeeStream — P3.12 (2026-06-07) 3.4.2 群聊签名重整:
//   - 单一签名: chatWithEmployeeStream(employeeId, message, opts?)
//   - opts.sessionId, opts.relayEmployeeIds, opts.attachmentIds, opts.signal
//   - 返回 yield 字段统一: { conversation_id } / { content } / { tool } / { memories, files, done, error, aborted }
//   - 删除 _employeeId/_attachments 隐式丢参 (那是 P3.11 之前的 bug)
//   - conversationChatStream 改为 alias 但接新签名
export async function* chatWithEmployeeStream(
  employeeId: string | number,
  userInput: string,
  opts?: {
    sessionId?: string | null;
    relayEmployeeIds?: Array<string | number>;
    attachmentIds?: string[];
    reasoningEffort?: string;
    signal?: AbortSignal;
  },
): AsyncGenerator<any, void, undefined> {
  let sessionId: string = opts?.sessionId || '';
  const primaryEmployeeId = await resolveEmployeeUuid(employeeId);
  let relayUuids: string[] = [];
  if (opts?.relayEmployeeIds && opts.relayEmployeeIds.length > 0) {
    const emps = await fetchEmployees().catch(() => []) as any[];
    relayUuids = opts.relayEmployeeIds
      .map((id) => {
        const cached = emps.find((e: any) => e.id === id || e.__id === id || String(e.id) === String(id));
        return cached?.__id || (typeof id === 'string' && id.includes('-') ? id : null);
      })
      .filter(Boolean) as string[];
  }
  if (!sessionId) {
    const conv = await createSession(primaryEmployeeId, titleFromQuery(userInput), relayUuids);
    // P3.12 late (2026-06-07): FNV-1a shim 后 conv.id 是 number, conv.__id 是真 UUID.
    // 后端 /api/sessions/{sid}/chat/stream 走 db.get(SessionRecord, sid) 必须 UUID, 传 shim int 会 500.
    // shim 数据是 shim 写回 {id: shim_int, __id: real_uuid, ...} — 必须用 __id.
    sessionId = (conv as any).__id || '';
    if (sessionId) {
      yield { conversation_id: sessionId, _origin: 'openatlas' };
    }
  }
  if (!sessionId) {
    yield { error: 'failed to create session' };
    return;
  }
  for await (const ev of streamChat(sessionId, userInput, {
    attachmentIds: opts?.attachmentIds,
    relayEmployeeIds: relayUuids,
    primaryEmployeeId,
    reasoningEffort: opts?.reasoningEffort,
    signal: opts?.signal,
  })) {
    const evAny = ev as any;
    const evName = ev.event || ev.event_type;
    const payload = evAny.data && typeof evAny.data === 'object' ? evAny.data : evAny;
    // P3.12 3.4.3: openatlas_session_id 校验 — 不属于当前 active session 的事件不 yield
    if (ev.openatlas_session_id && ev.openatlas_session_id !== sessionId) {
      // 跨 session 事件, 忽略 (防串台)
      continue;
    }
    if (evName === 'openatlas.memories') {
      yield { memories: payload.items || ev.items || [] };
      continue;
    }
    if (evName === 'openatlas.files') {
      yield { files: payload.items || ev.items || [] };
      continue;
    }
    if (evName === 'openatlas.trace') {
      yield {
        event_type: evName,
        event: evName,
        trace: payload,
        speaker_employee_id: payload.speaker_employee_id ?? ev.speaker_employee_id,
        speaker_name: payload.speaker_name ?? ev.speaker_name,
        turn_index: payload.turn_index ?? ev.turn_index,
        openatlas_session_id: payload.openatlas_session_id ?? ev.openatlas_session_id,
      };
      continue;
    }
    if (evName === 'openatlas.capability_plan') {
      yield {
        event_type: evName,
        event: evName,
        capability_plan: payload.plan || payload.capability_plan || payload,
        collaboration_policy: payload.collaboration_policy || payload.policy,
        openatlas_session_id: payload.openatlas_session_id ?? ev.openatlas_session_id,
      };
      continue;
    }
    if (evName === 'openatlas.reasoning') {
      yield {
        event_type: evName,
        event: evName,
        reasoning: {
          text: payload.text || ev.text || '',
          hermes_run_id: payload.hermes_run_id || ev.hermes_run_id || payload.run_id || ev.run_id,
        },
        speaker_employee_id: payload.speaker_employee_id ?? ev.speaker_employee_id,
        speaker_name: payload.speaker_name ?? ev.speaker_name,
        turn_index: payload.turn_index ?? ev.turn_index,
      };
      continue;
    }
    if (evName === 'openatlas.approval_required') {
      yield {
        event_type: evName,
        event: evName,
        approval_required: {
          hermes_run_id: payload.hermes_run_id || payload.run_id || ev.hermes_run_id || ev.run_id,
          run_id: payload.run_id || ev.run_id,
          approval_id: payload.approval_id || payload.approvalId,
          command: payload.command,
          description: payload.description,
          pattern_key: payload.pattern_key,
          pattern_keys: payload.pattern_keys,
          choices: payload.choices,
          tool_name: payload.tool_name || payload.tool,
          source: payload.source,
          timeout_ms: payload.timeout_ms || payload.timeoutMs,
        },
        speaker_employee_id: payload.speaker_employee_id ?? ev.speaker_employee_id,
        speaker_name: payload.speaker_name ?? ev.speaker_name,
        turn_index: payload.turn_index ?? ev.turn_index,
      };
      continue;
    }
    if (evName === 'openatlas.approval_responded') {
      yield {
        event_type: evName,
        event: evName,
        approval_responded: {
          choice: payload.choice,
          reason: payload.reason,
          resolved: payload.resolved,
          hermes_run_id: payload.hermes_run_id || payload.run_id || ev.hermes_run_id || ev.run_id,
        },
        speaker_employee_id: payload.speaker_employee_id ?? ev.speaker_employee_id,
        speaker_name: payload.speaker_name ?? ev.speaker_name,
        turn_index: payload.turn_index ?? ev.turn_index,
      };
      continue;
    }
    if (evName === 'openatlas.task_state') {
      yield {
        event_type: evName,
        event: evName,
        task_state: {
          session_id: payload.session_id || payload.openatlas_session_id || ev.openatlas_session_id,
          task_status: payload.task_status,
          reason: payload.reason,
          openatlas_session_id: payload.openatlas_session_id ?? ev.openatlas_session_id,
        },
        speaker_employee_id: payload.speaker_employee_id ?? ev.speaker_employee_id,
        speaker_name: payload.speaker_name ?? ev.speaker_name,
        turn_index: payload.turn_index ?? ev.turn_index,
      };
      continue;
    }
    if (evName === 'openatlas.quota_waiting') {
      yield {
        event_type: evName,
        event: evName,
        quota_waiting: true,
        task_state: {
          session_id: payload.session_id || payload.openatlas_session_id || ev.openatlas_session_id,
          task_status: 'quota_waiting',
          reason: payload.reason || payload.message || '模型服务处于限流等待，可稍后继续。',
          retry_after_seconds: payload.retry_after_seconds,
          openatlas_session_id: payload.openatlas_session_id ?? ev.openatlas_session_id,
        },
        speaker_employee_id: payload.speaker_employee_id ?? ev.speaker_employee_id,
        speaker_name: payload.speaker_name ?? ev.speaker_name,
        turn_index: payload.turn_index ?? ev.turn_index,
      };
      continue;
    }
    if (evName === 'openatlas.context') {
      yield {
        event_type: evName,
        event: evName,
        skills: payload.skills || [],
        memories: payload.memories || [],
        files: payload.files || [],
        speaker_employee_id: payload.speaker_employee_id ?? ev.speaker_employee_id,
        speaker_name: payload.speaker_name ?? ev.speaker_name,
        turn_index: payload.turn_index ?? ev.turn_index,
        openatlas_session_id: payload.openatlas_session_id ?? ev.openatlas_session_id,
      };
      continue;
    }
    if (evName === 'openatlas.artifacts') {
      yield {
        event_type: evName,
        event: evName,
        artifacts: payload.items || payload.artifacts || ev.items || [],
        items: payload.items || payload.artifacts || ev.items || [],
        speaker_employee_id: payload.speaker_employee_id ?? ev.speaker_employee_id,
        speaker_name: payload.speaker_name ?? ev.speaker_name,
        turn_index: payload.turn_index ?? ev.turn_index,
        openatlas_session_id: payload.openatlas_session_id ?? ev.openatlas_session_id,
      };
      continue;
    }
    if (evName === 'agent_join' || evName === 'agent_leave') {
      yield {
        event_type: evName,
        agent_id: payload.speaker_employee_id ?? ev.speaker_employee_id,
        speaker_employee_id: payload.speaker_employee_id ?? ev.speaker_employee_id,
        speaker_name: payload.speaker_name ?? ev.speaker_name,
        turn_index: payload.turn_index ?? ev.turn_index,
      };
      continue;
    }
    if (evName === 'run.completed') {
      const usage = payload.usage;
      if (usage) yield {
        event_type: evName,
        event: evName,
        usage,
        speaker_employee_id: payload.speaker_employee_id ?? ev.speaker_employee_id,
        speaker_name: payload.speaker_name ?? ev.speaker_name,
        turn_index: payload.turn_index ?? ev.turn_index,
      };
      continue;
    }
    if (evName === 'run.started') {
      yield {
        event_type: evName,
        event: evName,
        run_id: payload.run_id || ev.run_id,
        hermes_run_id: payload.hermes_run_id || payload.run_id || ev.hermes_run_id || ev.run_id,
        speaker_employee_id: payload.speaker_employee_id ?? ev.speaker_employee_id,
        speaker_name: payload.speaker_name ?? ev.speaker_name,
        turn_index: payload.turn_index ?? ev.turn_index,
      };
      continue;
    }
    if (evName === 'openatlas.run_idle' || evName === 'openatlas.run_detached') {
      yield {
        event_type: evName,
        event: evName,
        message: payload.message || '',
        idle_seconds: payload.idle_seconds,
        idle_timeout_seconds: payload.idle_timeout_seconds,
        detach_after_seconds: payload.detach_after_seconds,
        hermes_run_id: payload.hermes_run_id || ev.hermes_run_id,
        detached: evName === 'openatlas.run_detached',
        speaker_employee_id: payload.speaker_employee_id ?? ev.speaker_employee_id,
        speaker_name: payload.speaker_name ?? ev.speaker_name,
        turn_index: payload.turn_index ?? ev.turn_index,
      };
      continue;
    }
    if (evName === 'message.started') {
      continue;
    }
    if (evName === 'assistant.delta') {
      const content =
        payload.delta ??
        payload.content ??
        payload.text ??
        payload.message?.content ??
        payload.message?.delta ??
        '';
      if (typeof content === 'string' && content.length > 0) yield {
        content,
        speaker_employee_id: payload.speaker_employee_id ?? ev.speaker_employee_id,
        speaker_name: payload.speaker_name ?? ev.speaker_name,
        turn_index: payload.turn_index ?? ev.turn_index,
      };
      continue;
    }
    if (evName === 'assistant.completed') {
      continue;
    }
    if (evName === 'tool.started' || evName === 'tool.progress' || evName === 'tool.completed' || evName === 'tool.failed') {
      yield {
        event_type: evName,
        event: evName,
        tool: {
          name: payload.tool_name || payload.name || payload.tool || ev.tool_name || 'tool',
          label: payload.label || payload.preview || payload.command || ev.label || payload.tool_name || ev.tool_name,
          status: normalizeToolStatus(
            evName === 'tool.started' ? 'running' : evName === 'tool.completed' ? 'completed' : evName === 'tool.failed' ? 'failed' : 'progress',
            payload.error,
          ),
          toolCallId: payload.tool_call_id || payload.id || payload.call_id || ev.tool_call_id,
          args: payload.args ?? payload.input ?? payload.parameters,
          result: payload.result ?? payload.output,
          error: normalizeToolError(payload.error),
          duration: payload.duration,
          waitDurationMs: payload.wait_duration_ms ?? payload.waitDurationMs,
          startedAt: payload.started_at ?? payload.startedAt,
          completedAt: payload.completed_at ?? payload.completedAt,
          preview: payload.preview,
          command: payload.command,
          delta: payload.delta ?? ev.delta,
          hermes_run_id: payload.hermes_run_id || ev.hermes_run_id,
          runtime_event: evName,
        },
        speaker_employee_id: payload.speaker_employee_id ?? ev.speaker_employee_id,
        speaker_name: payload.speaker_name ?? ev.speaker_name,
        turn_index: payload.turn_index ?? ev.turn_index,
      };
      continue;
    }
    if (evName === 'error') {
      const message = payload.message || payload.error || ev.message || ev.detail || 'stream error';
      const isQuotaWaiting = payload.task_status === 'quota_waiting' || /429|quota|rate.?limit|限流|额度|频率|请求过多/i.test(String(message || ''));
      if (isQuotaWaiting) {
        yield {
          event_type: 'openatlas.quota_waiting',
          event: 'openatlas.quota_waiting',
          quota_waiting: true,
          task_state: {
            session_id: payload.session_id || payload.openatlas_session_id || ev.openatlas_session_id,
            task_status: 'quota_waiting',
            reason: message || '模型服务处于限流等待，可稍后继续。',
            retry_after_seconds: payload.retry_after_seconds,
            openatlas_session_id: payload.openatlas_session_id ?? ev.openatlas_session_id,
          },
          speaker_employee_id: payload.speaker_employee_id ?? ev.speaker_employee_id,
          speaker_name: payload.speaker_name ?? ev.speaker_name,
          turn_index: payload.turn_index ?? ev.turn_index,
        };
        return;
      }
      yield { error: message };
      return;
    }
    if (evName === 'aborted') {
      yield { aborted: true };
      return;
    }
    if (evName === 'done') {
      yield { done: true };
      return;
    }
  }
  yield { done: true };
}
// P3.12 3.4.2: 新签名, 不再是 streamChat alias. 老 streamChat alias 保留 (单聊场景直接用)
export const conversationChatStream = chatWithEmployeeStream;

export async function replayEmployeeEvents(id: number | string): Promise<CanvasReplay> {
  const employeeId = await resolveEmployeeUuid(id).catch(() => String(id));
  const q = new URLSearchParams({ employee_id: employeeId || String(id), limit: '100' });
  const r = await apiFetch<{ items?: any[]; total?: number }>(`/canvas-events?${q.toString()}`);
  return { employee_name: '员工', total: r.total ?? (r.items || []).length, events: r.items || [] };
}

export async function replaySessionEvents(sessionId: number | string): Promise<CanvasReplay> {
  const realId = await resolveRealSessionId(sessionId);
  const r = await apiFetch<any>(`/sessions/${realId}/replay`);
  return {
    employee_name: r?.session?.title || '当前会话',
    session_title: r?.session?.title || '当前会话',
    total: r?.total ?? 0,
    events: Array.isArray(r?.events) ? r.events : [],
    steps: Array.isArray(r?.steps) ? r.steps : [],
    checkpoints: Array.isArray(r?.checkpoints) ? r.checkpoints : [],
    forks: Array.isArray(r?.forks) ? r.forks : [],
    runs: Array.isArray(r?.runs) ? r.runs : [],
    artifacts: Array.isArray(r?.artifacts) ? r.artifacts : [],
    workflow_run: r?.workflow_run || null,
  };
}

export async function actionWorkflowNode(
  sessionId: number | string,
  nodeRunId: string,
  action: 'retry' | 'continue',
  message = '',
): Promise<any> {
  const realId = await resolveRealSessionId(sessionId);
  return apiFetch(`/sessions/${realId}/workflow-nodes/${encodeURIComponent(nodeRunId)}/action`, {
    method: 'POST',
    body: JSON.stringify({ action, message }),
  });
}

export async function resumeWorkflowCheckpoint(
  sessionId: number | string,
  checkpointId: string,
  opts: { mode?: 'fork_resume' | 'prompt_only'; message?: string } = {},
): Promise<any> {
  const realId = await resolveRealSessionId(sessionId);
  return apiFetch(`/sessions/${realId}/workflow-checkpoints/${encodeURIComponent(checkpointId)}/resume`, {
    method: 'POST',
    body: JSON.stringify({ mode: opts.mode || 'fork_resume', message: opts.message || '' }),
  });
}

export async function actionWorkflowStep(
  sessionId: number | string,
  stepEventId: string,
  action: 'retry' | 'skip',
  message = '',
): Promise<any> {
  const realId = await resolveRealSessionId(sessionId);
  return apiFetch(`/sessions/${realId}/workflow-steps/${encodeURIComponent(stepEventId)}/action`, {
    method: 'POST',
    body: JSON.stringify({ action, message }),
  });
}
