export type DeckUseCase = 'report' | 'roadshow' | 'training';
export type DeckAspectRatio = '16:9' | '3:1';
export type DeckDensity = 'clean' | 'standard' | 'dense';
export type DeckChartLevel = 'light' | 'balanced' | 'rich';
export type DeckStyleKey = 'executive_blue' | 'tech_launch' | 'teaching_clear';
export type SlideStatus = 'draft' | 'confirmed' | 'needs_source' | 'locked';
export type DeckLayout = 'cover' | 'section' | 'two_column' | 'compare' | 'metrics' | 'process' | 'timeline' | 'diagram' | 'checklist' | 'quote';
export type DeckRhythm = 'anchor' | 'dense' | 'breathing';
export type DataChartKind = 'scorecard' | 'bar' | 'line';
export type VisualSpecType = 'matrix' | 'architecture' | 'combo_metrics' | 'scorecard' | 'bar' | 'line' | 'process' | 'timeline' | 'roadmap' | 'generic';
export type SlideDesignElementKey = 'eyebrow' | 'title' | 'headline' | 'bullets' | 'visual';
export type SlideDesignCustomElementType = 'text' | 'shape' | 'image' | 'metric';
export type SlideDesignAlign = 'left' | 'center' | 'right';
export type SlideDesignMediaFit = 'cover' | 'contain';
export type AipptTemplateId = string;

export interface SlideDesignElementStyle {
  name?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  zIndex?: number;
  fontSize?: number;
  color?: string;
  fontWeight?: number;
  align?: SlideDesignAlign;
  background?: string;
  radius?: number;
  visible?: boolean;
  locked?: boolean;
}

export interface SlideDesignMedia {
  id: string;
  type: 'image';
  url: string;
  alt?: string;
  fit?: SlideDesignMediaFit;
}

export interface SlideDesignCustomElement extends SlideDesignElementStyle {
  id: string;
  type: SlideDesignCustomElementType;
  content?: string;
  label?: string;
  value?: string | number;
  unit?: string;
  url?: string;
  alt?: string;
  fit?: SlideDesignMediaFit;
  shape?: 'rectangle' | 'pill' | 'circle';
}

export interface SlideDesignSpec {
  mode?: 'auto' | 'freeform';
  elements?: Partial<Record<SlideDesignElementKey, SlideDesignElementStyle>>;
  media?: SlideDesignMedia[];
  customElements?: SlideDesignCustomElement[];
}

export interface VisualSpecItem {
  label?: string;
  title?: string;
  value?: string | number;
  unit?: string;
  detail?: string;
  items?: string[];
  score?: 'high' | 'medium' | 'low' | number;
}

export interface VisualSpecChart {
  kind?: DataChartKind;
  labels?: string[];
  series?: Array<{
    name?: string;
    values?: number[];
    unit?: string;
  }>;
  unit?: string;
  source?: string;
  methodology?: string;
  estimated?: boolean;
}

export interface SlideVisualSpec {
  type?: VisualSpecType;
  templateId?: AipptTemplateId;
  chartTemplate?: AipptTemplateId;
  visualTemplate?: AipptTemplateId;
  title?: string;
  description?: string;
  columns?: VisualSpecItem[];
  rows?: VisualSpecItem[];
  layers?: VisualSpecItem[];
  metrics?: VisualSpecItem[];
  chart?: VisualSpecChart;
  callouts?: string[];
}

export interface DeckConfig {
  topic: string;
  useCase: DeckUseCase;
  aspectRatio: DeckAspectRatio;
  styleKey: DeckStyleKey;
  audience: string;
  durationMinutes: number;
  pageCount: number;
  density: DeckDensity;
  chartLevel: DeckChartLevel;
  speakerNotes: boolean;
}

export interface DeckSection {
  id: string;
  title: string;
  purpose: string;
}

export interface KnowledgeCard {
  id: string;
  title: string;
  source: string;
  detail: string;
  status: 'ready' | 'missing' | 'assumption';
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
  status: SlideStatus;
  speakerNotes: string;
  designIntent?: string;
  renderHints?: string[];
  evidenceRole?: string;
  visualSpec?: SlideVisualSpec;
  design?: SlideDesignSpec;
}

export interface DeckSpecLockPage {
  slideId: string;
  index: number;
  layout: DeckLayout | string;
  rhythm: DeckRhythm | string;
  templateId?: string;
  routeSignature?: string;
  layoutPlan?: {
    role?: string;
    density?: DeckRhythm | string;
    visualSlot?: 'none' | 'chart' | 'diagram' | 'media' | string;
  };
  chartTemplate?: string;
  templateFamily?: string;
  visualSpecType?: string;
  pptxSupport?: string;
}

export interface DeckSpecLock {
  version: 'aippt-spec-lock-v1' | 'aippt-spec-lock-v2' | string;
  templateCatalogVersion?: string;
  canvas: {
    aspectRatio: DeckAspectRatio | string;
    size?: string;
  };
  style: {
    styleKey: DeckStyleKey | string;
    name?: string;
    colors?: Record<string, unknown>;
    typography?: Record<string, unknown>;
  };
  font?: {
    family: string;
    titleMinPt: number;
    bodyMinPt: number;
    scale?: number;
  };
  color?: {
    background?: string;
    surface?: string;
    primary?: string;
    accent?: string;
    text?: string;
    muted?: string;
    palette?: unknown[];
  };
  rhythm?: {
    pageRhythm: Record<string, DeckRhythm | string>;
    maxSameLayoutRun?: number;
    maxSameTemplateRun?: number;
  };
  layoutPlan?: {
    version: string;
    pages: DeckSpecLockPage[];
    diversity: {
      maxSameLayoutRun: number;
      maxSameTemplateRun: number;
      maxTwoColumnShare: number;
    };
  };
  pageTemplates?: Record<string, string>;
  pageRhythm: Record<string, DeckRhythm | string>;
  pageLayouts: Record<string, DeckLayout | string>;
  pageCharts: Record<string, string>;
  imagePolicy?: Record<string, Record<string, string>>;
  exportPolicy?: {
    htmlRenderer: string;
    designerRenderer: string;
    pptxExporter: string;
    nativeChartTemplates: string[];
    nativeShapeTemplates: string[];
    shapeFallbackTemplates: string[];
    routeSource?: string;
  };
  pages: DeckSpecLockPage[];
  qaPolicy?: Record<string, unknown>;
}

export interface DeckPlan {
  title: string;
  sections: DeckSection[];
  slides: DeckSlide[];
  knowledge: KnowledgeCard[];
  generatedAt: string;
  specLock?: DeckSpecLock;
}

export type DeckSchemaIssueLevel = 'error' | 'warning' | 'info';

export interface DeckSchemaIssue {
  level: DeckSchemaIssueLevel;
  scope: 'deck' | 'section' | 'slide' | 'knowledge';
  message: string;
  field?: string;
  slideId?: string;
  nodeId?: string;
}

export interface DeckSpecLockRouteDrift {
  slideId: string;
  index: number;
  field: 'layout' | 'templateId' | 'visualSpec.templateId' | 'specLock.pages';
  locked: string;
  actual: string;
}

export interface MetricDatum {
  label: string;
  value: number | null;
  display: string;
  unit: string;
  detail: string;
}

export const USE_CASE_LABEL: Record<DeckUseCase, string> = {
  report: '汇报',
  roadshow: '路演',
  training: '培训',
};

export const STATUS_LABEL: Record<SlideStatus, string> = {
  draft: '待确认',
  confirmed: '已确认',
  needs_source: '缺资料',
  locked: '已锁定',
};

export const STATUS_COLOR: Record<SlideStatus, string> = {
  draft: 'processing',
  confirmed: 'success',
  needs_source: 'warning',
  locked: 'default',
};

export const DECK_LAYOUT_OPTIONS: Array<{ value: DeckLayout; label: string }> = [
  { value: 'cover', label: '封面' },
  { value: 'section', label: '章节页' },
  { value: 'two_column', label: '双栏' },
  { value: 'compare', label: '对比' },
  { value: 'metrics', label: '指标' },
  { value: 'process', label: '流程' },
  { value: 'timeline', label: '时间线' },
  { value: 'diagram', label: '图解' },
  { value: 'checklist', label: '清单' },
  { value: 'quote', label: '金句/收束' },
];

const CONTENT_LAYOUTS: DeckLayout[] = ['compare', 'metrics', 'diagram', 'process', 'timeline', 'checklist', 'two_column'];

const STYLE_LAYOUT_BIAS: Record<DeckStyleKey, DeckLayout[]> = {
  executive_blue: ['metrics', 'compare', 'timeline', 'checklist'],
  tech_launch: ['compare', 'diagram', 'metrics', 'quote'],
  teaching_clear: ['process', 'diagram', 'checklist', 'timeline'],
};

export interface AipptTemplateDefinition {
  id: AipptTemplateId;
  layout: DeckLayout;
  family: string;
  visualType: VisualSpecType;
  pptxSupport: 'native_chart' | 'native_shapes' | 'shape_fallback' | 'none';
  summary: string;
  aliases?: string[];
  chartKind?: DataChartKind;
  visualSlot?: 'none' | 'chart' | 'diagram' | 'media';
}

export const AIPPT_TEMPLATE_CATALOG_VERSION = 'aippt-template-catalog-v2';

export const AIPPT_TEMPLATE_REGISTRY: Record<AipptTemplateId, AipptTemplateDefinition> = {
  cover: { id: 'cover', layout: 'cover', family: 'narrative', visualType: 'generic', pptxSupport: 'native_shapes', summary: '封面或主张页，锁定主题、受众和价值承诺。', visualSlot: 'media' },
  section: { id: 'section', layout: 'section', family: 'narrative', visualType: 'generic', pptxSupport: 'native_shapes', summary: '章节转场页，承接叙事节奏。', visualSlot: 'none' },
  quote: { id: 'quote', layout: 'quote', family: 'narrative', visualType: 'generic', pptxSupport: 'native_shapes', summary: '收束金句或关键判断页。', visualSlot: 'none' },
  kpi_cards: { id: 'kpi_cards', layout: 'metrics', family: 'metrics', visualType: 'scorecard', pptxSupport: 'native_shapes', summary: '4-8 个独立指标卡，适合经营结果、效果口径、阶段成果。', aliases: ['metric_cards', 'kpi'], chartKind: 'scorecard', visualSlot: 'chart' },
  hero_metric: { id: 'hero_metric', layout: 'metrics', family: 'metrics', visualType: 'scorecard', pptxSupport: 'native_shapes', summary: '单个超大数字加解释，适合强调一个关键结论。', chartKind: 'scorecard', visualSlot: 'chart' },
  metric_dashboard: { id: 'metric_dashboard', layout: 'metrics', family: 'metrics', visualType: 'scorecard', pptxSupport: 'native_shapes', summary: '主指标加辅助指标组合，适合投资人或高管看板。', chartKind: 'scorecard', visualSlot: 'chart' },
  bullet_chart: { id: 'bullet_chart', layout: 'metrics', family: 'metrics', visualType: 'scorecard', pptxSupport: 'native_shapes', summary: '目标、实际、完成率表达，适合预算或目标达成。', chartKind: 'scorecard', visualSlot: 'chart' },
  line_chart: { id: 'line_chart', layout: 'metrics', family: 'trend', visualType: 'line', pptxSupport: 'native_chart', summary: '1-3 条时间序列趋势，适合增长、转化、成本走势。', aliases: ['combo_line_metrics', 'comboLineMetrics', 'line_metrics'], chartKind: 'line', visualSlot: 'chart' },
  multi_line_chart: { id: 'multi_line_chart', layout: 'metrics', family: 'trend', visualType: 'line', pptxSupport: 'native_chart', summary: '多序列趋势对比，适合同一指标多对象走势。', chartKind: 'line', visualSlot: 'chart' },
  bar_chart: { id: 'bar_chart', layout: 'metrics', family: 'category', visualType: 'bar', pptxSupport: 'native_chart', summary: '单序列分类对比，适合行业、区域、模块对比。', chartKind: 'bar', visualSlot: 'chart' },
  grouped_bar_chart: { id: 'grouped_bar_chart', layout: 'metrics', family: 'category', visualType: 'bar', pptxSupport: 'native_chart', summary: '2-4 序列并排柱状图，适合多对象多阶段对比。', chartKind: 'bar', visualSlot: 'chart' },
  horizontal_bar_chart: { id: 'horizontal_bar_chart', layout: 'metrics', family: 'ranking', visualType: 'bar', pptxSupport: 'native_chart', summary: '长标签排名或横向占比对比。', chartKind: 'bar', visualSlot: 'chart' },
  waterfall_chart: { id: 'waterfall_chart', layout: 'metrics', family: 'finance', visualType: 'bar', pptxSupport: 'native_shapes', summary: '收入、利润或成本拆解的桥图。', chartKind: 'bar', visualSlot: 'chart' },
  funnel_chart: { id: 'funnel_chart', layout: 'metrics', family: 'conversion', visualType: 'bar', pptxSupport: 'native_shapes', summary: '线索、转化、留存等漏斗阶段。', chartKind: 'bar', visualSlot: 'chart' },
  comparison_table: { id: 'comparison_table', layout: 'compare', family: 'compare', visualType: 'matrix', pptxSupport: 'native_shapes', summary: '2-4 个对象的密集能力比较表。', visualSlot: 'diagram' },
  comparison_columns: { id: 'comparison_columns', layout: 'compare', family: 'compare', visualType: 'matrix', pptxSupport: 'native_shapes', summary: '并排方案、套餐或服务层级卡。', visualSlot: 'diagram' },
  feature_matrix_table: { id: 'feature_matrix_table', layout: 'compare', family: 'compare', visualType: 'matrix', pptxSupport: 'native_shapes', summary: '竞品能力 checklist 或强弱项矩阵。', visualSlot: 'diagram' },
  quadrant_text_bullets: { id: 'quadrant_text_bullets', layout: 'compare', family: 'framework', visualType: 'matrix', pptxSupport: 'native_shapes', summary: '2x2 象限，适合优先级、SWOT、影响投入。', visualSlot: 'diagram' },
  matrix_2x2: { id: 'matrix_2x2', layout: 'compare', family: 'framework', visualType: 'matrix', pptxSupport: 'native_shapes', summary: '二维坐标矩阵，适合定位图或战略选择。', visualSlot: 'diagram' },
  layered_architecture: { id: 'layered_architecture', layout: 'diagram', family: 'architecture', visualType: 'architecture', pptxSupport: 'native_shapes', summary: '3-6 层架构或能力栈。', aliases: ['architecture'], visualSlot: 'diagram' },
  hub_spoke: { id: 'hub_spoke', layout: 'diagram', family: 'architecture', visualType: 'architecture', pptxSupport: 'native_shapes', summary: '中心能力加周边模块关系。', visualSlot: 'diagram' },
  system_map: { id: 'system_map', layout: 'diagram', family: 'architecture', visualType: 'architecture', pptxSupport: 'native_shapes', summary: '系统组件关系图，适合产品或技术架构。', visualSlot: 'diagram' },
  journey_map: { id: 'journey_map', layout: 'process', family: 'process', visualType: 'process', pptxSupport: 'native_shapes', summary: '用户或客户旅程，强调阶段体验与触点。', visualSlot: 'diagram' },
  process_flow: { id: 'process_flow', layout: 'process', family: 'process', visualType: 'process', pptxSupport: 'native_shapes', summary: '3-8 个顺序步骤的流程图。', visualSlot: 'diagram' },
  pipeline_with_stages: { id: 'pipeline_with_stages', layout: 'process', family: 'process', visualType: 'process', pptxSupport: 'native_shapes', summary: '阶段管线加交付物，适合销售、实施或数据链路。', visualSlot: 'diagram' },
  numbered_steps: { id: 'numbered_steps', layout: 'process', family: 'process', visualType: 'process', pptxSupport: 'native_shapes', summary: '3-6 个横向编号步骤。', visualSlot: 'diagram' },
  agenda_list: { id: 'agenda_list', layout: 'checklist', family: 'process', visualType: 'process', pptxSupport: 'native_shapes', summary: '目录、议程或行动项列表。', visualSlot: 'diagram' },
  timeline: { id: 'timeline', layout: 'timeline', family: 'timeline', visualType: 'timeline', pptxSupport: 'native_shapes', summary: '3-8 个横向里程碑。', visualSlot: 'diagram' },
  roadmap_vertical: { id: 'roadmap_vertical', layout: 'timeline', family: 'timeline', visualType: 'roadmap', pptxSupport: 'native_shapes', summary: '纵向路线图，适合季度或月度计划。', visualSlot: 'diagram' },
  gantt_chart: { id: 'gantt_chart', layout: 'timeline', family: 'timeline', visualType: 'timeline', pptxSupport: 'native_shapes', summary: '任务持续时间、依赖和排期。', visualSlot: 'diagram' },
  business_model_canvas: { id: 'business_model_canvas', layout: 'diagram', family: 'business', visualType: 'matrix', pptxSupport: 'native_shapes', summary: '商业模式九宫格或关键模块拆解。', aliases: ['business_canvas'], visualSlot: 'diagram' },
  unit_economics: { id: 'unit_economics', layout: 'metrics', family: 'business', visualType: 'scorecard', pptxSupport: 'native_shapes', summary: 'CAC、LTV、毛利、回收期等单位经济模型。', visualSlot: 'chart' },
  case_study_cards: { id: 'case_study_cards', layout: 'two_column', family: 'proof', visualType: 'generic', pptxSupport: 'native_shapes', summary: '客户案例或场景案例卡片组。', visualSlot: 'diagram' },
};

export const AIPPT_HIGH_FREQUENCY_TEMPLATE_IDS = [
  'cover',
  'section',
  'quote',
  'kpi_cards',
  'hero_metric',
  'metric_dashboard',
  'bullet_chart',
  'line_chart',
  'multi_line_chart',
  'bar_chart',
  'grouped_bar_chart',
  'horizontal_bar_chart',
  'waterfall_chart',
  'funnel_chart',
  'comparison_table',
  'comparison_columns',
  'feature_matrix_table',
  'quadrant_text_bullets',
  'matrix_2x2',
  'layered_architecture',
  'hub_spoke',
  'system_map',
  'journey_map',
  'process_flow',
  'pipeline_with_stages',
  'numbered_steps',
  'agenda_list',
  'timeline',
  'roadmap_vertical',
  'gantt_chart',
  'business_model_canvas',
  'unit_economics',
  'case_study_cards',
] as const;

const TEMPLATE_ALIAS_TO_ID = Object.values(AIPPT_TEMPLATE_REGISTRY).reduce<Record<string, string>>((acc, template) => {
  acc[template.id] = template.id;
  template.aliases?.forEach((alias) => {
    acc[alias] = template.id;
  });
  return acc;
}, {});

const TEMPLATE_FAMILY: Record<string, string> = Object.fromEntries(
  Object.values(AIPPT_TEMPLATE_REGISTRY).map((template) => [template.id, template.family]),
);

export const VISUAL_SPEC_TYPE_OPTIONS: Array<{ value: VisualSpecType; label: string }> = [
  { value: 'generic', label: '常规' },
  { value: 'scorecard', label: '数字卡' },
  { value: 'bar', label: '柱状图' },
  { value: 'line', label: '折线图' },
  { value: 'combo_metrics', label: '图表+指标' },
  { value: 'matrix', label: '矩阵' },
  { value: 'architecture', label: '架构' },
  { value: 'process', label: '流程' },
  { value: 'timeline', label: '时间线' },
  { value: 'roadmap', label: '路线图' },
];

export const DATA_CHART_LABEL: Record<DataChartKind, string> = {
  scorecard: '数字卡片',
  bar: '柱状图',
  line: '折线图',
};

export function inferSlideLayout(title: string, visual = '', index = 1, useCase: DeckUseCase = 'report'): DeckLayout {
  const text = `${title} ${visual}`.toLowerCase();
  if (index <= 1 || /封面|开场|标题页|cover|hero/u.test(text)) return 'cover';
  if (/章节|转场|section/u.test(text)) return 'section';
  if (/对比|比较|差异|竞品|矩阵|左右|左侧|右侧|\bvs\b|versus|compare/u.test(text)) return 'compare';
  if (/指标|数据|收益|效果|roi|kpi|数字|增长|转化|metrics/u.test(text)) return 'metrics';
  if (/时间线|里程碑|阶段|路线图|roadmap|timeline/u.test(text)) return 'timeline';
  if (/路径|流程|步骤|计划|操作|闭环|链路|process|flow/u.test(text)) return 'process';
  if (/架构|地图|分层|能力|模型|曲线|图谱|因果|旅程|系统|diagram|map/u.test(text)) return 'diagram';
  if (/清单|检查|任务|待办|行动项|checklist|todo/u.test(text)) return 'checklist';
  if (/结束|愿景|口号|总结|收束|quote|slogan/u.test(text)) return 'quote';
  if (useCase === 'training' && index % 4 === 0) return 'checklist';
  return 'two_column';
}

export function deckHintText(slide: DeckSlide) {
  return [
    ...(slide.renderHints || []),
    slide.visual,
    slide.designIntent || '',
    slide.evidenceRole || '',
  ].filter(Boolean).join('；');
}

export function hintValueFromHints(slide: DeckSlide, keys: string[]) {
  const text = deckHintText(slide);
  for (const key of keys) {
    const pattern = new RegExp(`${key}\\s*[=:：]\\s*([^；;\\n]+)`, 'iu');
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return '';
}

export function canonicalTemplateId(value: unknown): string {
  const clean = String(value || '').trim().replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '');
  return clean ? TEMPLATE_ALIAS_TO_ID[clean] || clean : '';
}

export function templateDefinitionForId(value: unknown): AipptTemplateDefinition | null {
  const id = canonicalTemplateId(value);
  return id ? AIPPT_TEMPLATE_REGISTRY[id] || null : null;
}

export function templateFamilyForId(value: unknown) {
  return templateDefinitionForId(value)?.family || '';
}

export function pptxSupportForTemplate(value: unknown) {
  return templateDefinitionForId(value)?.pptxSupport || 'none';
}

function explicitTemplateFromSpec(spec: SlideVisualSpec | null | undefined) {
  return canonicalTemplateId(spec?.templateId || spec?.chartTemplate || spec?.visualTemplate);
}

export function explicitTemplateIdFromSlide(slide: DeckSlide) {
  const spec = normalizeVisualSpec(slide.visualSpec);
  return explicitTemplateFromSpec(spec) || canonicalTemplateId(hintValueFromHints(slide, ['templateId', 'chartTemplate', 'chart模板', 'visualTemplate']));
}

function asSpecText(value: unknown) {
  if (typeof value === 'number') return String(value);
  return typeof value === 'string' ? value.trim() : '';
}

function asSpecBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value !== 'string') return undefined;
  const clean = value.trim().toLowerCase();
  if (!clean) return undefined;
  if (/^(true|yes|y|1|estimated|estimate)$/u.test(clean) || /估算|假设|推算/u.test(clean)) return true;
  if (/^(false|no|n|0|verified)$/u.test(clean) || /真实|实数|核验/u.test(clean)) return false;
  return undefined;
}

export function splitSpecItems(value: string) {
  return value
    .split(/[、,，/；;]+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeSpecItems(value: unknown): VisualSpecItem[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry): VisualSpecItem | null => {
    if (typeof entry === 'string' || typeof entry === 'number') {
      return { label: String(entry) };
    }
    if (!entry || typeof entry !== 'object') return null;
    const row = entry as Record<string, unknown>;
    const label = asSpecText(row.label) || asSpecText(row.title) || asSpecText(row.name);
    const title = asSpecText(row.title) || label;
    const detail = asSpecText(row.detail) || asSpecText(row.description) || asSpecText(row.summary);
    const value = typeof row.value === 'number' || typeof row.value === 'string' ? row.value : undefined;
    const items = Array.isArray(row.items)
      ? row.items.map((item) => asSpecText(item)).filter(Boolean)
      : splitSpecItems(asSpecText(row.items));
    return {
      label,
      title,
      detail,
      value,
      unit: asSpecText(row.unit),
      score: typeof row.score === 'number' || typeof row.score === 'string' ? row.score as VisualSpecItem['score'] : undefined,
      items,
    };
  }).filter(Boolean) as VisualSpecItem[];
}

export function normalizeVisualSpec(raw: unknown): SlideVisualSpec | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const type = asSpecText(source.type) as VisualSpecType;
  const templateId = canonicalTemplateId(source.templateId || source.chartTemplate || source.chart_template || source.visualTemplate || source.template);
  const chartRaw = source.chart && typeof source.chart === 'object' && !Array.isArray(source.chart)
    ? source.chart as Record<string, unknown>
    : null;
  const seriesRaw = chartRaw?.series;
  const chart: VisualSpecChart | undefined = chartRaw ? {
    kind: asSpecText(chartRaw.kind) as DataChartKind,
    labels: Array.isArray(chartRaw.labels) ? chartRaw.labels.map((item) => asSpecText(item)).filter(Boolean) : [],
    series: Array.isArray(seriesRaw)
      ? seriesRaw.map((item) => {
        if (!item || typeof item !== 'object') return null;
        const row = item as Record<string, unknown>;
        return {
          name: asSpecText(row.name),
          values: Array.isArray(row.values) ? row.values.map((value) => Number(value)).filter(Number.isFinite) : [],
          unit: asSpecText(row.unit),
        };
      }).filter(Boolean) as VisualSpecChart['series']
      : [],
    unit: asSpecText(chartRaw.unit),
    source: asSpecText(chartRaw.source),
    methodology: asSpecText(chartRaw.methodology) || asSpecText(chartRaw.caliber) || asSpecText(chartRaw.scope) || asSpecText(chartRaw.metricDefinition),
    estimated: asSpecBoolean(chartRaw.estimated ?? chartRaw.isEstimated ?? chartRaw.estimate),
  } : undefined;
  const spec: SlideVisualSpec = {
    type,
    templateId: templateId || undefined,
    chartTemplate: templateId || undefined,
    title: asSpecText(source.title),
    description: asSpecText(source.description),
    columns: normalizeSpecItems(source.columns),
    rows: normalizeSpecItems(source.rows),
    layers: normalizeSpecItems(source.layers),
    metrics: normalizeSpecItems(source.metrics),
    chart,
    callouts: Array.isArray(source.callouts) ? source.callouts.map((item) => asSpecText(item)).filter(Boolean) : [],
  };
  const template = templateDefinitionForId(templateId);
  if (!spec.type) {
    if (template) spec.type = template.visualType;
    else if (spec.columns?.length) spec.type = 'matrix';
    else if (spec.layers?.length) spec.type = 'architecture';
    else if (spec.rows?.length) spec.type = 'process';
    else if (spec.metrics?.length && spec.chart?.kind === 'line') spec.type = 'combo_metrics';
  }
  if (template?.chartKind && spec.chart && !spec.chart.kind) spec.chart.kind = template.chartKind;
  return spec.type || spec.columns?.length || spec.layers?.length || spec.metrics?.length || spec.chart ? spec : null;
}

function parseParenPart(value: string) {
  const clean = value
    .replace(/^(?:左侧|右侧|中间|左边|右边|左列|右列|中列|左|右)\s*/u, '')
    .trim();
  const match = clean.match(/^([^（(：:，,]+)[（(]([^）)]+)[）)]/u);
  if (!match) return { label: clean.slice(0, 18), items: splitSpecItems(clean) };
  return {
    label: match[1].trim(),
    items: splitSpecItems(match[2]),
  };
}

export function inferMatrixColumns(slide: DeckSlide): VisualSpecItem[] {
  const text = deckHintText(slide);
  const body = (text.split(/[：:]/u).slice(1).join('：') || text).trim();
  const chunks = body
    .split(/\s*(?:vs|VS|Vs|VERSUS|versus)\s*/u)
    .map((item) => item.trim())
    .filter((item) => item.length > 2);
  if (chunks.length < 3 && !/三列|多列|矩阵/u.test(text)) return [];
  const source = chunks.length >= 3 ? chunks : splitSpecItems(body).slice(0, 3);
  return source.slice(0, 4).map((chunk) => {
    const parsed = parseParenPart(chunk);
    return {
      label: parsed.label || '对比对象',
      items: parsed.items.length ? parsed.items : [chunk],
      detail: chunk,
    };
  });
}

export function inferArchitectureLayers(slide: DeckSlide): VisualSpecItem[] {
  const text = deckHintText(slide);
  const body = (text.split(/[：:]/u).slice(1).join('：') || text).trim();
  let parts = body
    .split(/\s*(?:→|->|=>|—>|-->)\s*/u)
    .map((item) => item.trim())
    .filter((item) => item.length > 1);
  if (parts.length < 3 && /感知.*记忆.*规划.*执行/u.test(text)) {
    parts = ['感知', '记忆', '规划', '执行'].map((label) => {
      const match = text.match(new RegExp(`${label}[^）)。；;]*[）)]?`, 'u'));
      return match?.[0] || label;
    });
  }
  if (parts.length < 2 && !/架构|分层|四层|三层|层级|链路/u.test(text)) return [];
  return parts.slice(0, 6).map((part) => {
    const parsed = parseParenPart(part);
    return {
      label: parsed.label || part,
      detail: parsed.items.join(' / ') || part,
      items: parsed.items,
    };
  });
}

function cleanMetricText(value: string) {
  return value
    .replace(/^\s*\d+(?:\.\d+)*\s*/u, '')
    .replace(/^[一二三四五六七八九十]+[、.．]\s*/u, '')
    .trim();
}

function truncateMetricLabel(value: string, max = 16) {
  const clean = cleanMetricText(value)
    .replace(/[-+]?\d+(?:\.\d+)?\s*(?:%|％|倍|x|X|天|小时|分钟|人|个|项|万|亿|元|万元|亿元)?/gu, '')
    .split(/[，,。；;：:]/u)[0]
    .trim();
  return (clean || cleanMetricText(value) || '关键指标').slice(0, max);
}

function metricDatumFromSpecItem(item: VisualSpecItem): MetricDatum {
  const label = item.label || item.title || '关键指标';
  const raw = item.value;
  const rawText = raw === undefined ? '' : String(raw);
  const match = rawText.match(/([-+]?\d+(?:\.\d+)?)\s*(%|％|倍|x|X|天|小时|分钟|人|个|项|万|亿|元|万元|亿元)?/u);
  const numeric = typeof raw === 'number'
    ? raw
    : match ? Number(match[1]) : null;
  const unit = item.unit || match?.[2] || '';
  return {
    label: truncateMetricLabel(label, 14),
    value: numeric !== null && Number.isFinite(numeric) ? numeric : null,
    display: rawText ? `${rawText}${typeof raw === 'number' ? unit : ''}` : '待补',
    unit,
    detail: item.detail || label,
  };
}

export function metricDataFromVisualSpec(spec: SlideVisualSpec): MetricDatum[] {
  if (spec.metrics?.length) {
    return spec.metrics.map(metricDatumFromSpecItem).slice(0, 5);
  }
  const firstSeries = spec.chart?.series?.[0];
  if (firstSeries?.values?.length) {
    const labels = spec.chart?.labels || [];
    return firstSeries.values.slice(0, 6).map((value, index) => ({
      label: labels[index] || `阶段 ${index + 1}`,
      value,
      display: `${value}${firstSeries.unit || spec.chart?.unit || ''}`,
      unit: firstSeries.unit || spec.chart?.unit || '',
      detail: firstSeries.name || spec.title || '趋势数据',
    }));
  }
  return [];
}

export function metricDataFromBullets(items: string[]): MetricDatum[] {
  const segments = (items.length ? items : ['关键指标待补充'])
    .flatMap((item) => {
      const clean = cleanMetricText(item);
      const parts = clean.split(/[，,；;、]\s*/u).map((part) => part.trim()).filter(Boolean);
      return parts.some((part) => /[-+]?\d+(?:\.\d+)?/u.test(part)) ? parts : [clean];
    })
    .filter(Boolean);
  const rows = segments.slice(0, 5).map((item, index) => {
    const clean = cleanMetricText(item);
    const match = clean.match(/([-+]?\d+(?:\.\d+)?)\s*(%|％|倍|x|X|天|小时|分钟|人|个|项|万|亿|元|万元|亿元)?/u);
    const unit = match?.[2] || '';
    const value = match ? Number(match[1]) : null;
    const display = match ? `${match[1]}${unit}` : '待补';
    return {
      label: truncateMetricLabel(clean, index === 0 ? 18 : 14),
      value: value !== null && Number.isFinite(value) ? value : null,
      display,
      unit,
      detail: clean || item,
    };
  });
  while (rows.length < 3) {
    rows.push({
      label: ['效率', '成本', '体验'][rows.length] || '指标',
      value: null,
      display: '待补',
      unit: '',
      detail: '等待补充真实业务数据或可引用来源。',
    });
  }
  return rows;
}

function inferVisualSpecFromSlide(slide: DeckSlide): SlideVisualSpec {
  const text = deckHintText(slide);
  const matrixColumns = inferMatrixColumns(slide);
  if (matrixColumns.length >= 3) {
    return {
      type: 'matrix',
      templateId: 'feature_matrix_table',
      chartTemplate: 'feature_matrix_table',
      title: hintValueFromHints(slide, ['matrixTitle', '矩阵标题']) || '能力对比矩阵',
      columns: matrixColumns,
      description: /色块深浅|能力等级/u.test(text) ? '用色块深浅表达能力等级。' : '',
    };
  }
  const architectureLayers = inferArchitectureLayers(slide);
  if (architectureLayers.length >= 2) {
    return {
      type: 'architecture',
      templateId: 'layered_architecture',
      chartTemplate: 'layered_architecture',
      title: hintValueFromHints(slide, ['architectureTitle', '架构标题']) || '分层架构图',
      layers: architectureLayers,
      callouts: /反馈|闭环|环形/u.test(text) ? ['环形反馈'] : [],
    };
  }
  if (/左侧.*折线.*右侧.*指标卡|折线图.*指标卡|line.*scorecard/i.test(text)) {
    return {
      type: 'combo_metrics',
      templateId: 'line_chart',
      chartTemplate: 'line_chart',
      title: hintValueFromHints(slide, ['chartTitle', '图表标题']) || '指标趋势',
      chart: { kind: 'line' },
      metrics: metricDataFromBullets(slide.bullets).map((row) => ({
        label: row.label,
        value: row.value === null ? row.display : row.value,
        unit: row.unit,
        detail: row.detail,
      })),
    };
  }
  if (slide.layout === 'metrics') {
    const templateId = explicitTemplateIdFromSlide(slide) || (chartKindFromSlide(slide) === 'line' ? 'line_chart' : chartKindFromSlide(slide) === 'bar' ? 'bar_chart' : 'kpi_cards');
    return {
      type: chartKindFromSlide(slide),
      templateId,
      chartTemplate: templateId,
      chart: { kind: chartKindFromSlide(slide) },
    };
  }
  return { type: 'generic' };
}

export function visualSpecOfSlide(slide: DeckSlide): SlideVisualSpec {
  return normalizeVisualSpec(slide.visualSpec) || inferVisualSpecFromSlide(slide);
}

export function chartKindFromSlide(slide: DeckSlide): DataChartKind {
  const spec = normalizeVisualSpec(slide.visualSpec);
  if (spec?.chart?.kind && ['scorecard', 'bar', 'line'].includes(spec.chart.kind)) return spec.chart.kind;
  const template = templateDefinitionForId(explicitTemplateFromSpec(spec) || hintValueFromHints(slide, ['templateId', 'chartTemplate', 'chart模板', 'visualTemplate']));
  if (template?.chartKind) return template.chartKind;
  if (spec?.type === 'bar' || spec?.type === 'line' || spec?.type === 'scorecard') return spec.type;
  if (spec?.type === 'combo_metrics') return 'line';
  const explicit = hintValueFromHints(slide, ['chart', '图表', 'chartType', 'dataVisual']).toLowerCase();
  if (/line|trend|curve|折线|趋势|曲线|走势/u.test(explicit)) return 'line';
  if (/bar|column|柱状|柱形|条形/u.test(explicit)) return 'bar';
  if (/score|card|metric|number|数字|指标卡/u.test(explicit)) return 'scorecard';
  const text = deckHintText(slide).toLowerCase();
  if (/折线|趋势|曲线|走势|增长曲线|变化/u.test(text)) return 'line';
  if (/柱状|柱形|条形|排行|排名|分布|占比|结构|对比图/u.test(text)) return 'bar';
  return 'scorecard';
}

export function withChartHint(hints: string[] | undefined, chart: DataChartKind) {
  const next = (hints || []).filter((hint) => !/^chart\s*[=:：]/iu.test(hint.trim()));
  return [`chart=${chart}`, ...next].slice(0, 4);
}

export function visualTypeToLayout(type: VisualSpecType): DeckLayout {
  if (type === 'matrix') return 'compare';
  if (type === 'architecture') return 'diagram';
  if (type === 'scorecard' || type === 'bar' || type === 'line' || type === 'combo_metrics') return 'metrics';
  if (type === 'process') return 'process';
  if (type === 'timeline' || type === 'roadmap') return 'timeline';
  return 'two_column';
}

export function layoutFromVisualSpec(spec: SlideVisualSpec | null | undefined, fallback: DeckLayout = 'two_column'): DeckLayout {
  if (!spec) return fallback;
  const template = templateDefinitionForId(explicitTemplateFromSpec(spec));
  if (template) return template.layout;
  if ((spec.columns?.length || 0) >= 2 || spec.type === 'matrix') return 'compare';
  if ((spec.layers?.length || 0) >= 2 || spec.type === 'architecture') return 'diagram';
  if ((spec.chart?.series?.length || 0) > 0 || (spec.metrics?.length || 0) > 0 || ['scorecard', 'bar', 'line', 'combo_metrics'].includes(spec.type || '')) return 'metrics';
  if ((spec.rows?.length || 0) >= 2) {
    const text = `${spec.title || ''} ${spec.description || ''} ${(spec.rows || []).map((row) => `${row.label || row.title || ''} ${row.detail || ''}`).join(' ')}`;
    if (/时间|阶段|路线|里程碑|季度|月份|周|day|month|timeline/i.test(text)) return 'timeline';
    if (/清单|行动|待办|check|todo|事项/u.test(text)) return 'checklist';
    return 'process';
  }
  return spec.type ? visualTypeToLayout(spec.type) : fallback;
}

export function scheduledLayoutForSlide(slide: DeckSlide, config: DeckConfig): DeckLayout {
  const current = slide.layout || inferSlideLayout(slide.title, slide.visual, slide.index, config.useCase);
  if (slide.index <= 1 || current === 'cover' || current === 'section' || current === 'quote') {
    return slide.index <= 1 ? 'cover' : current;
  }
  const spec = normalizeVisualSpec(slide.visualSpec);
  if (!spec) return current;
  const scheduled = layoutFromVisualSpec(spec, current);
  if (scheduled !== 'two_column') return scheduled;
  return current;
}

function layoutHint(layout: DeckLayout): string | null {
  if (layout === 'compare') return 'leftLabel=现状，rightLabel=目标';
  if (layout === 'metrics') return 'chart=scorecard';
  if (layout === 'process') return 'flow=step';
  if (layout === 'timeline') return 'flow=timeline';
  if (layout === 'diagram') return 'flow=layered';
  if (layout === 'checklist') return 'emphasis=行动清单';
  return null;
}

function hintKey(hint: string) {
  return String(hint || '').split(/[=:：]/)[0]?.trim();
}

function hardTemplateLockFromHints(slide: DeckSlide) {
  const hints = Array.isArray(slide.renderHints) ? slide.renderHints : [];
  for (const hint of hints) {
    const key = hintKey(hint);
    if (!['templateId', 'chartTemplate', 'chart模板', 'visualTemplate'].includes(key)) continue;
    const [, value = ''] = String(hint).split(/[=:：]/u);
    const clean = canonicalTemplateId(value);
    if (AIPPT_TEMPLATE_REGISTRY[clean]) return clean;
  }
  return '';
}

function slideSignal(slide: DeckSlide) {
  return [
    slide.title,
    slide.headline,
    slide.visual,
    ...(slide.bullets || []),
    ...(slide.renderHints || []),
    slide.designIntent || '',
    slide.evidenceRole || '',
  ].join(' ').toLowerCase();
}

function slideRhythm(slide: DeckSlide, layout: DeckLayout, config: DeckConfig): DeckRhythm {
  if (slide.index <= 1 || ['cover', 'section', 'quote'].includes(layout)) return 'anchor';
  const signal = slideSignal(slide);
  const bullets = Array.isArray(slide.bullets) ? slide.bullets : [];
  if (['metrics', 'compare'].includes(layout) || bullets.length >= 4 || /数据|指标|对比|矩阵|清单|表格|成本|收益|效率/u.test(signal)) {
    return 'dense';
  }
  if (['diagram', 'process', 'timeline'].includes(layout)) {
    return bullets.length >= 4 ? 'dense' : 'breathing';
  }
  if (config.density === 'clean' || bullets.length <= 2 || /一句话|核心观点|愿景|结论|暂停|转折/u.test(signal)) {
    return 'breathing';
  }
  return 'dense';
}

function chartTemplateForSlide(slide: DeckSlide, layout: DeckLayout): string | null {
  const signal = slideSignal(slide);
  const spec = normalizeVisualSpec(slide.visualSpec);
  const explicit = explicitTemplateFromSpec(spec) || canonicalTemplateId(hintValueFromHints(slide, ['templateId', 'chartTemplate', 'chart模板', 'visualTemplate']));
  if (explicit && AIPPT_TEMPLATE_REGISTRY[explicit]) {
    const template = AIPPT_TEMPLATE_REGISTRY[explicit];
    if (!template.layout || template.layout === layout) {
      return ['cover', 'section', 'quote'].includes(explicit) ? null : explicit;
    }
  }
  const chartKind = spec?.chart?.kind || (spec?.type === 'bar' || spec?.type === 'line' || spec?.type === 'scorecard' ? spec.type : '');
  const series = spec?.chart?.series || [];
  if (layout === 'metrics') {
    if (chartKind === 'line') return 'line_chart';
    if (chartKind === 'bar' && series.length >= 2) return 'grouped_bar_chart';
    if (chartKind === 'bar') return /排行|排名|rank|top|长标签/i.test(signal) ? 'horizontal_bar_chart' : 'bar_chart';
    if ((spec?.metrics?.length || 0) >= 4 || chartKind === 'scorecard') return 'kpi_cards';
    if (/目标|实际|完成率|baseline|target/i.test(signal)) return 'bullet_chart';
    return 'kpi_cards';
  }
  if (layout === 'compare') {
    if ((spec?.columns?.length || 0) >= 3 || /特性|功能|能力项|check|feature/i.test(signal)) return 'feature_matrix_table';
    if (/2x2|四象限|象限|swot|优先级|影响.*投入|impact.*effort/i.test(signal)) return 'quadrant_text_bullets';
    if (/价格|套餐|服务层级|tier|pricing/i.test(signal)) return 'comparison_columns';
    return 'comparison_table';
  }
  if (layout === 'diagram') {
    if ((spec?.layers?.length || 0) >= 2 || /架构|分层|层级|architecture|layer/i.test(signal)) return 'layered_architecture';
    return 'hub_spoke';
  }
  if (layout === 'process') {
    if (/产物|交付物|artifact|pipeline|管线|etl/i.test(signal)) return 'pipeline_with_stages';
    if ((spec?.rows?.length || 0) <= 3 || /步骤|入门|方法论|getting started/i.test(signal)) return 'numbered_steps';
    return 'process_flow';
  }
  if (layout === 'timeline') {
    if (/周期|持续|工期|依赖|甘特|duration|dependency|task/i.test(signal)) return 'gantt_chart';
    if (/路线图|roadmap|状态|status/i.test(signal)) return 'roadmap_vertical';
    return 'timeline';
  }
  if (layout === 'checklist') return /议程|目录|agenda|会议/i.test(signal) ? 'agenda_list' : 'numbered_steps';
  return null;
}

export function templateIdForSlide(slide: DeckSlide, layout: DeckLayout = slide.layout): string {
  const chartTemplate = chartTemplateForSlide(slide, layout);
  if (chartTemplate) return chartTemplate;
  if (layout === 'cover' || layout === 'section' || layout === 'quote') return layout;
  return layout;
}

function alternateTemplateForLayout(layout: DeckLayout, current: string, index: number): string {
  const byLayout = Object.values(AIPPT_TEMPLATE_REGISTRY)
    .filter((template) => template.layout === layout && !['cover', 'section', 'quote'].includes(template.id))
    .map((template) => template.id);
  if (!byLayout.length) return current;
  const candidates = byLayout.filter((templateId) => templateId !== current);
  return candidates[index % Math.max(1, candidates.length)] || current;
}

function alternateLayout(slide: DeckSlide, index: number, config: DeckConfig, avoid: Set<DeckLayout>): DeckLayout {
  const signal = slideSignal(slide);
  const semantic: Array<[DeckLayout, RegExp]> = [
    ['metrics', /指标|数据|收益|效果|roi|kpi|数字|增长|转化|留存|成本|效率|规模|趋势|收入|利润/i],
    ['compare', /对比|比较|差异|竞品|矩阵|左右|\bvs\b|versus|机会|问题|困境|方案/i],
    ['diagram', /架构|地图|分层|能力|模型|图谱|因果|旅程|系统|组件|产品/i],
    ['timeline', /时间线|里程碑|阶段|路线图|roadmap|季度|月份|周期/i],
    ['process', /路径|流程|步骤|计划|操作|闭环|链路|落地|实施|推进/i],
    ['checklist', /清单|检查|任务|待办|行动项|下一步|决策/i],
  ];
  for (const [layout, pattern] of semantic) {
    if (!avoid.has(layout) && pattern.test(signal)) return layout;
  }
  const cycle = [...STYLE_LAYOUT_BIAS[config.styleKey], ...CONTENT_LAYOUTS]
    .filter((layout, offset, arr) => arr.indexOf(layout) === offset);
  for (let offset = 0; offset < cycle.length; offset += 1) {
    const layout = cycle[(index + offset) % cycle.length];
    if (!avoid.has(layout)) return layout;
  }
  return 'two_column';
}

function withLayoutHint(slide: DeckSlide, config: DeckConfig): DeckSlide {
  const chartTemplate = chartTemplateForSlide(slide, slide.layout);
  const nextHints = [
    layoutHint(slide.layout),
    `rhythm=${slideRhythm(slide, slide.layout, config)}`,
    chartTemplate ? `chartTemplate=${chartTemplate}` : null,
  ].filter(Boolean) as string[];
  if (!nextHints.length) return slide;
  const nextKeys = new Set(nextHints.map(hintKey));
  const hints = slide.renderHints || [];
  const preserved = hints.filter((item) => {
    const key = hintKey(item);
    return key && !nextKeys.has(key) && key !== 'rhythm' && key !== 'chartTemplate';
  });
  return { ...slide, renderHints: [...preserved, ...nextHints].slice(0, 6) };
}

function withForcedChartTemplate(slide: DeckSlide, templateId: string): DeckSlide {
  const clean = canonicalTemplateId(templateId);
  if (!clean) return slide;
  const hints = slide.renderHints || [];
  const preserved = hints.filter((item) => {
    const key = hintKey(item);
    return key !== 'chartTemplate' && key !== 'templateId' && key !== 'visualTemplate';
  });
  const spec: SlideVisualSpec = normalizeVisualSpec(slide.visualSpec) || slide.visualSpec || {};
  return {
    ...slide,
    renderHints: [...preserved, `chartTemplate=${clean}`].slice(0, 6),
    visualSpec: {
      ...spec,
      templateId: clean,
      chartTemplate: clean,
      type: spec.type || templateDefinitionForId(clean)?.visualType || 'generic',
    },
  };
}

function isDeckLayout(value: unknown): value is DeckLayout {
  return DECK_LAYOUT_OPTIONS.some((item) => item.value === value);
}

function specLockPages(plan: Pick<DeckPlan, 'specLock'> | null | undefined): DeckSpecLockPage[] {
  const pages = Array.isArray(plan?.specLock?.pages) ? plan.specLock.pages : [];
  if (pages.length) return pages.filter(Boolean);
  const layoutPages = Array.isArray(plan?.specLock?.layoutPlan?.pages) ? plan.specLock.layoutPlan.pages : [];
  return layoutPages.filter(Boolean);
}

export function specLockPageForSlide(plan: Pick<DeckPlan, 'specLock'> | null | undefined, slide: DeckSlide, offset = 0): DeckSpecLockPage | null {
  const pages = specLockPages(plan);
  if (!pages.length) return null;
  const slideId = String(slide.id || '');
  if (slideId) {
    const matched = pages.find((page) => String(page.slideId || '') === slideId);
    if (matched) return matched;
  }
  const index = Number.isFinite(Number(slide.index)) ? Number(slide.index) : offset + 1;
  return pages.find((page) => Number(page.index) === index) || null;
}

export function applySpecLockToSlide(slide: DeckSlide, plan: Pick<DeckPlan, 'specLock'> | null | undefined, offset = 0): DeckSlide {
  const page = specLockPageForSlide(plan, slide, offset);
  if (!page) return slide;
  const lockedTemplate = canonicalTemplateId(page.templateId || page.chartTemplate);
  const template = templateDefinitionForId(lockedTemplate);
  const lockedLayout = template?.layout || (isDeckLayout(page.layout) ? page.layout : slide.layout);
  const rhythm = ['anchor', 'dense', 'breathing'].includes(String(page.rhythm || ''))
    ? String(page.rhythm)
    : '';
  const routeKeys = new Set(['rhythm', 'templateId', 'chartTemplate', 'visualTemplate']);
  const preservedHints = (slide.renderHints || []).filter((item) => {
    const key = hintKey(item);
    return key && !routeKeys.has(key);
  });
  const routeHints = [
    layoutHint(lockedLayout),
    rhythm ? `rhythm=${rhythm}` : null,
    lockedTemplate && !['cover', 'section', 'quote'].includes(lockedTemplate) ? `chartTemplate=${lockedTemplate}` : null,
  ].filter(Boolean) as string[];
  const spec: SlideVisualSpec = normalizeVisualSpec(slide.visualSpec) || slide.visualSpec || {};
  if (lockedTemplate && template) {
    spec.templateId = lockedTemplate;
    spec.chartTemplate = lockedTemplate;
    spec.type = template.visualType || spec.type || 'generic';
    if (template.chartKind) {
      spec.chart = { ...(spec.chart || {}), kind: spec.chart?.kind || template.chartKind };
    }
  } else if (page.visualSpecType && !spec.type) {
    spec.type = page.visualSpecType as VisualSpecType;
  }
  return {
    ...slide,
    layout: lockedLayout,
    renderHints: [...preservedHints, ...routeHints].slice(0, 6),
    visualSpec: spec,
  };
}

export function specLockRouteDrifts(plan: DeckPlan | null | undefined): DeckSpecLockRouteDrift[] {
  const slides = Array.isArray(plan?.slides) ? plan.slides : [];
  const pages = specLockPages(plan);
  if (!slides.length || !pages.length) return [];
  const drifts: DeckSpecLockRouteDrift[] = [];
  slides.forEach((slide, offset) => {
    const page = specLockPageForSlide(plan, slide, offset);
    const slideId = slide.id || `slide-${offset + 1}`;
    if (!page) {
      drifts.push({ slideId, index: offset + 1, field: 'specLock.pages', locked: '', actual: 'missing' });
      return;
    }
    const lockedTemplate = canonicalTemplateId(page.templateId || page.chartTemplate);
    const lockedLayout = templateDefinitionForId(lockedTemplate)?.layout || (isDeckLayout(page.layout) ? page.layout : '');
    const actualLayout = slide.layout || 'two_column';
    if (lockedLayout && lockedLayout !== actualLayout) {
      drifts.push({ slideId, index: offset + 1, field: 'layout', locked: lockedLayout, actual: actualLayout });
    }
    const actualTemplate = templateIdForSlide(slide, actualLayout);
    if (lockedTemplate && actualTemplate && lockedTemplate !== actualTemplate) {
      drifts.push({ slideId, index: offset + 1, field: 'templateId', locked: lockedTemplate, actual: actualTemplate });
    }
    const spec = normalizeVisualSpec(slide.visualSpec);
    const specTemplate = explicitTemplateFromSpec(spec);
    if (lockedTemplate && ['metrics', 'compare', 'diagram', 'process', 'timeline', 'checklist'].includes(actualLayout) && specTemplate !== lockedTemplate) {
      drifts.push({ slideId, index: offset + 1, field: 'visualSpec.templateId', locked: lockedTemplate, actual: specTemplate });
    }
  });
  return drifts.slice(0, 40);
}

function buildDeckSpecLock(slides: DeckSlide[], config: DeckConfig, existing?: DeckSpecLock): DeckSpecLock {
  const pageRhythm: Record<string, string> = {};
  const pageLayouts: Record<string, string> = {};
  const pageCharts: Record<string, string> = {};
  const pageTemplates: Record<string, string> = {};
  const imagePolicy: Record<string, Record<string, string>> = {};
  const pages: DeckSpecLockPage[] = slides.map((slide, offset) => {
    const slideId = slide.id || `slide-${offset + 1}`;
    const layout = slide.layout || 'two_column';
    const rhythm = slideRhythm(slide, layout, config);
    const chartTemplate = chartTemplateForSlide(slide, layout) || '';
    const template = templateIdForSlide(slide, layout);
    const templateDef = templateDefinitionForId(template);
    const spec = visualSpecOfSlide({ ...slide, layout });
    pageRhythm[slideId] = rhythm;
    pageLayouts[slideId] = layout;
    pageTemplates[slideId] = template;
    if (chartTemplate) pageCharts[slideId] = chartTemplate;
    imagePolicy[slideId] = {
      policy: slide.design?.media?.length ? 'user_media' : templateDef?.visualSlot === 'chart' ? 'chart' : templateDef?.visualSlot === 'diagram' ? 'diagram_or_chart' : 'none',
      placement: 'visual',
      fit: slide.design?.media?.[0]?.fit || 'cover',
    };
    return {
      slideId,
      index: Number.isFinite(Number(slide.index)) ? Number(slide.index) : offset + 1,
      layout,
      rhythm,
      templateId: template,
      routeSignature: `${layout}:${template}:${rhythm}`,
      layoutPlan: {
        role: TEMPLATE_FAMILY[template] || layout,
        density: rhythm,
        visualSlot: templateDef?.visualSlot || 'none',
      },
      chartTemplate: chartTemplate || undefined,
      templateFamily: TEMPLATE_FAMILY[template] || undefined,
      visualSpecType: spec.type || 'generic',
      pptxSupport: templateDef?.pptxSupport || 'none',
    };
  });
  const font = {
    family: 'Microsoft YaHei, PingFang SC, Inter, Arial',
    titleMinPt: 34,
    bodyMinPt: 14,
  };
  const nativeChartTemplates = Object.values(AIPPT_TEMPLATE_REGISTRY).filter((item) => item.pptxSupport === 'native_chart').map((item) => item.id);
  const nativeShapeTemplates = Object.values(AIPPT_TEMPLATE_REGISTRY).filter((item) => item.pptxSupport === 'native_shapes').map((item) => item.id);
  const shapeFallbackTemplates = Object.values(AIPPT_TEMPLATE_REGISTRY).filter((item) => item.pptxSupport === 'shape_fallback').map((item) => item.id);
  return {
    version: 'aippt-spec-lock-v2',
    templateCatalogVersion: AIPPT_TEMPLATE_CATALOG_VERSION,
    canvas: {
      aspectRatio: config.aspectRatio,
      size: config.aspectRatio === '3:1' ? '15x5' : '13.333x7.5',
    },
    style: {
      styleKey: config.styleKey,
      name: existing?.style?.name,
      colors: existing?.style?.colors,
      typography: existing?.style?.typography || font,
    },
    font,
    color: (existing?.color || existing?.style?.colors || {}) as DeckSpecLock['color'],
    rhythm: {
      pageRhythm,
      maxSameLayoutRun: 2,
      maxSameTemplateRun: 2,
    },
    layoutPlan: {
      version: 'aippt-layout-plan-v2',
      pages,
      diversity: {
        maxSameLayoutRun: 2,
        maxSameTemplateRun: 2,
        maxTwoColumnShare: 0.35,
      },
    },
    pageTemplates,
    pageRhythm,
    pageLayouts,
    pageCharts,
    imagePolicy,
    exportPolicy: {
      htmlRenderer: 'schema-html-renderer-v2',
      designerRenderer: 'schema-designer-renderer-v2',
      pptxExporter: 'python-pptx-native-shapes-v2',
      nativeChartTemplates,
      nativeShapeTemplates,
      shapeFallbackTemplates,
      routeSource: 'specLock.pages -> slide.layout/renderHints/visualSpec.templateId',
    },
    pages,
    qaPolicy: existing?.qaPolicy || {
      maxSameLayoutRun: 2,
      maxSameTemplateRun: 2,
      requireChartTemplateFor: ['metrics', 'compare', 'diagram', 'process', 'timeline'],
      requireSpecLockRouteAlignment: true,
      exportLoop: ['spec_lock_route_alignment', 'html_pdf_or_screenshot', 'pptx_pdf', 'overflow_scan', 'layout_repetition_scan'],
    },
  };
}

function enforcePlanLayoutDiversity(slides: DeckSlide[], config: DeckConfig): DeckSlide[] {
  const normalized: DeckSlide[] = [];
  slides.forEach((rawSlide, offset) => {
    const hardTemplate = hardTemplateLockFromHints(rawSlide);
    const hardLayout = templateDefinitionForId(hardTemplate)?.layout;
    const scheduled = hardLayout || scheduledLayoutForSlide(rawSlide, config);
    const protectedLayout = offset === 0 || ['cover', 'section', 'quote'].includes(scheduled);
    const previous = normalized[offset - 1]?.layout;
    const previousTwo = normalized[offset - 2]?.layout;
    const layout = !protectedLayout && previous === scheduled && previousTwo === scheduled
      ? alternateLayout(rawSlide, offset, config, new Set([scheduled, previous].filter(Boolean) as DeckLayout[]))
      : scheduled;
    normalized.push(withLayoutHint({
      ...rawSlide,
      layout,
      designIntent: rawSlide.designIntent || (!['cover', 'section'].includes(layout)
        ? `版式编排器按叙事功能分配为 ${layout}，避免整套页面节奏单一。`
        : rawSlide.designIntent),
    }, config));
  });
  const contentIndexes = normalized
    .map((slide, index) => ({ slide, index }))
    .filter(({ slide }) => !['cover', 'section', 'quote'].includes(slide.layout))
    .map(({ index }) => index);
  const maxTwoColumn = Math.max(1, Math.ceil(contentIndexes.length * 0.35));
  const twoColumnIndexes = contentIndexes.filter((index) => normalized[index].layout === 'two_column');
  twoColumnIndexes.slice(maxTwoColumn).forEach((index) => {
    if (hardTemplateLockFromHints(normalized[index])) return;
    const previous = normalized[index - 1]?.layout;
    normalized[index] = withLayoutHint({
      ...normalized[index],
      layout: alternateLayout(normalized[index], index, config, new Set(['two_column', previous].filter(Boolean) as DeckLayout[])),
    }, config);
  });
  const maxDominantLayout = Math.max(2, Math.ceil(contentIndexes.length * 0.45));
  const counts = new Map<DeckLayout, number>();
  contentIndexes.forEach((index) => {
    const layout = normalized[index].layout;
    const nextCount = (counts.get(layout) || 0) + 1;
    counts.set(layout, nextCount);
    if (nextCount <= maxDominantLayout) return;
    if (hardTemplateLockFromHints(normalized[index])) return;
    const previous = normalized[index - 1]?.layout;
    const nextLayout = alternateLayout(normalized[index], index, config, new Set([layout, previous].filter(Boolean) as DeckLayout[]));
    normalized[index] = withLayoutHint({ ...normalized[index], layout: nextLayout }, config);
    counts.set(nextLayout, (counts.get(nextLayout) || 0) + 1);
  });
  contentIndexes.forEach((index) => {
    if (index < 2 || ['cover', 'section', 'quote'].includes(normalized[index].layout)) return;
    const template = templateIdForSlide(normalized[index]);
    const previousTemplate = templateIdForSlide(normalized[index - 1]);
    const previousTwoTemplate = templateIdForSlide(normalized[index - 2]);
    if (!template || template !== previousTemplate || template !== previousTwoTemplate) return;
    const currentLayout = normalized[index].layout;
    const previousLayout = normalized[index - 1]?.layout;
    const nextLayout = alternateLayout(normalized[index], index, config, new Set([currentLayout, previousLayout].filter(Boolean) as DeckLayout[]));
    if (nextLayout !== currentLayout) {
      normalized[index] = withLayoutHint({ ...normalized[index], layout: nextLayout }, config);
    }
    const nextTemplate = templateIdForSlide(normalized[index]);
    if (nextTemplate === template) {
      const alternateTemplate = alternateTemplateForLayout(normalized[index].layout, nextTemplate, index);
      if (alternateTemplate !== nextTemplate) {
        normalized[index] = withForcedChartTemplate(normalized[index], alternateTemplate);
      }
    }
  });
  return normalized;
}

function withResolvedTemplateSpec(slide: DeckSlide): DeckSlide {
  const templateId = templateIdForSlide(slide);
  const chartTemplate = chartTemplateForSlide(slide, slide.layout) || '';
  const template = templateDefinitionForId(templateId);
  const spec = normalizeVisualSpec(slide.visualSpec) || visualSpecOfSlide(slide);
  const nextSpec: SlideVisualSpec = {
    ...spec,
    type: spec.type || template?.visualType || 'generic',
    templateId,
    chartTemplate: chartTemplate || templateId,
  };
  if (template?.chartKind) {
    nextSpec.chart = { ...(nextSpec.chart || {}), kind: nextSpec.chart?.kind || template.chartKind };
  }
  return { ...slide, visualSpec: nextSpec };
}

export function normalizePlanLayouts(nextPlan: DeckPlan, config: DeckConfig): DeckPlan {
  const safeSections = Array.isArray(nextPlan.sections) ? nextPlan.sections : [];
  const safeKnowledge = Array.isArray(nextPlan.knowledge) ? nextPlan.knowledge : [];
  const safeSlides = Array.isArray(nextPlan.slides) ? nextPlan.slides : [];
  const slides = safeSlides.map((rawSlide, offset) => {
    const slide = {
      ...rawSlide,
      id: rawSlide.id || `slide-${offset + 1}`,
      index: Number.isFinite(Number(rawSlide.index)) ? Number(rawSlide.index) : offset + 1,
      title: rawSlide.title || `第 ${offset + 1} 页`,
      headline: rawSlide.headline || rawSlide.title || '补充核心观点',
      bullets: Array.isArray(rawSlide.bullets) ? rawSlide.bullets : [],
      knowledgeIds: Array.isArray(rawSlide.knowledgeIds) ? rawSlide.knowledgeIds : [],
      renderHints: Array.isArray(rawSlide.renderHints) ? rawSlide.renderHints : [],
      status: ['draft', 'confirmed', 'needs_source', 'locked'].includes(String(rawSlide.status || ''))
        ? rawSlide.status
        : String(rawSlide.status || '') === 'missing_info'
          ? 'needs_source'
          : 'draft',
    };
    const layout = slide.layout && DECK_LAYOUT_OPTIONS.some((item) => item.value === slide.layout)
      ? slide.layout
      : inferSlideLayout(slide.title, slide.visual, slide.index, config.useCase);
    const scheduledLayout = scheduledLayoutForSlide({ ...slide, layout } as DeckSlide, config);
    const shouldReinfer = scheduledLayout === layout && layout === 'two_column' && /对比|比较|差异|竞品|矩阵|左右|左侧|右侧|\bvs\b|指标|数据|流程|路径|阶段|路线|架构|能力|地图|清单/u.test(`${slide.title} ${slide.visual}`);
    return {
      ...slide,
      layout: shouldReinfer ? inferSlideLayout(slide.title, slide.visual, slide.index, config.useCase) : scheduledLayout,
    } as DeckSlide;
  });
  const inputLockedSlides = slides.map((slide, offset) => applySpecLockToSlide(slide, nextPlan, offset));
  const normalizedSlides = enforcePlanLayoutDiversity(inputLockedSlides, config).map(withResolvedTemplateSpec);
  const firstSpecLock = buildDeckSpecLock(normalizedSlides, config, nextPlan.specLock);
  const lockedPlan = { ...nextPlan, slides: normalizedSlides, specLock: firstSpecLock };
  const lockedSlides = normalizedSlides
    .map((slide, offset) => applySpecLockToSlide(slide, lockedPlan, offset))
    .map(withResolvedTemplateSpec);
  return {
    ...nextPlan,
    sections: safeSections,
    knowledge: safeKnowledge,
    slides: lockedSlides,
    specLock: buildDeckSpecLock(lockedSlides, config, nextPlan.specLock),
  };
}

export function validateDeckSchema(plan: DeckPlan | null, config?: DeckConfig | null): DeckSchemaIssue[] {
  const issues: DeckSchemaIssue[] = [];
  const sections = Array.isArray(plan?.sections) ? plan.sections : [];
  const slides = Array.isArray(plan?.slides) ? plan.slides : [];
  const knowledge = Array.isArray(plan?.knowledge) ? plan.knowledge : [];
  const sectionIds = new Set<string>();
  const slideIds = new Set<string>();
  const knowledgeIds = new Set(knowledge.map((item) => item.id).filter(Boolean));
  const allowedLayouts = new Set(DECK_LAYOUT_OPTIONS.map((item) => item.value));

  if (!plan) {
    return [{ level: 'error', scope: 'deck', message: '缺少 Deck Schema，无法渲染或保存。' }];
  }
  if (!String(plan.title || '').trim()) {
    issues.push({ level: 'warning', scope: 'deck', field: 'title', message: 'Deck 标题为空，建议补充可识别的汇报标题。' });
  }
  if (!sections.length) {
    issues.push({ level: 'warning', scope: 'deck', field: 'sections', message: '缺少章节结构，页面仍可渲染，但目录和页归属会变弱。' });
  }
  if (!slides.length) {
    issues.push({ level: 'error', scope: 'deck', field: 'slides', message: '至少需要 1 页 slide。' });
  }
  if (!knowledge.length) {
    issues.push({ level: 'info', scope: 'deck', field: 'knowledge', message: '没有知识依赖，后续可补充引用资料提升可信度。' });
  }
  const routeDrifts = specLockRouteDrifts(plan);
  routeDrifts.slice(0, 6).forEach((drift) => {
    issues.push({
      level: 'error',
      scope: 'slide',
      field: drift.field,
      slideId: drift.slideId,
      message: `Spec Lock 路由偏移：第 ${drift.index} 页 ${drift.field} 锁定为 ${drift.locked || '空'}，实际为 ${drift.actual || '空'}。`,
    });
  });

  sections.forEach((section, index) => {
    const id = String(section.id || '');
    if (!id) {
      issues.push({ level: 'warning', scope: 'section', field: 'id', message: `第 ${index + 1} 个章节缺少 id。` });
      return;
    }
    if (sectionIds.has(id)) {
      issues.push({ level: 'error', scope: 'section', field: 'id', nodeId: id, message: `章节 id 重复：${id}` });
    }
    sectionIds.add(id);
    if (!String(section.title || '').trim()) {
      issues.push({ level: 'warning', scope: 'section', field: 'title', nodeId: id, message: `章节 ${index + 1} 标题为空。` });
    }
  });

  slides.forEach((slide, index) => {
    const slideId = String(slide.id || '');
    const label = slide.title || `第 ${index + 1} 页`;
    if (!slideId) {
      issues.push({ level: 'error', scope: 'slide', field: 'id', message: `${label} 缺少 slide id。` });
    } else if (slideIds.has(slideId)) {
      issues.push({ level: 'error', scope: 'slide', field: 'id', slideId, message: `slide id 重复：${slideId}` });
    }
    if (slideId) slideIds.add(slideId);
    if (slide.index !== index + 1) {
      issues.push({ level: 'info', scope: 'slide', field: 'index', slideId, message: `${label} 页码与数组顺序不一致，保存前会按顺序重排。` });
    }
    if (!String(slide.title || '').trim()) {
      issues.push({ level: 'warning', scope: 'slide', field: 'title', slideId, message: `${label} 缺少页面标题。` });
    }
    if (!String(slide.headline || '').trim()) {
      issues.push({ level: 'warning', scope: 'slide', field: 'headline', slideId, message: `${label} 缺少核心观点。` });
    }
    if (!Array.isArray(slide.bullets) || slide.bullets.length === 0) {
      issues.push({ level: 'warning', scope: 'slide', field: 'bullets', slideId, message: `${label} 缺少内容要点。` });
    }
    if (!allowedLayouts.has(slide.layout)) {
      issues.push({ level: 'error', scope: 'slide', field: 'layout', slideId, message: `${label} 使用了未知页面版式：${slide.layout || '空'}` });
    }
    if (slide.sectionId && sectionIds.size && !sectionIds.has(slide.sectionId)) {
      issues.push({ level: 'warning', scope: 'slide', field: 'sectionId', slideId, message: `${label} 关联了不存在的章节。` });
    }
    const missingKnowledge = (Array.isArray(slide.knowledgeIds) ? slide.knowledgeIds : []).filter((id) => !knowledgeIds.has(id));
    if (missingKnowledge.length) {
      issues.push({ level: 'warning', scope: 'slide', field: 'knowledgeIds', slideId, message: `${label} 有 ${missingKnowledge.length} 条知识依赖不存在。` });
    }

    const spec = slide.visualSpec || {};
    const specType = spec.type || 'generic';
    const metrics = Array.isArray(spec.metrics) ? spec.metrics : [];
    const series = Array.isArray(spec.chart?.series) ? spec.chart?.series : [];
    const labels = Array.isArray(spec.chart?.labels) ? spec.chart.labels : [];
    const firstValues = Array.isArray(series[0]?.values) ? series[0].values : [];
    const chartHasNumbers = series.some((item) => Array.isArray(item.values) && item.values.some((value) => Number.isFinite(value)));
    const chartSource = String(spec.chart?.source || '').trim();
    const chartMethodology = String(spec.chart?.methodology || '').trim();
    const chartEstimated = spec.chart?.estimated === true || /估算|假设|演示|推算/u.test(`${chartSource} ${chartMethodology}`);
    if (['metrics', 'compare', 'diagram'].includes(slide.layout) && specType === 'generic' && !metrics.length && !labels.length) {
      issues.push({ level: 'info', scope: 'slide', field: 'visualSpec', slideId, message: `${label} 是视觉页，但 visualSpec 还比较弱。` });
    }
    if (['scorecard', 'bar', 'line', 'combo_metrics'].includes(specType) && !metrics.length && !firstValues.length) {
      issues.push({ level: 'warning', scope: 'slide', field: 'visualSpec.metrics', slideId, message: `${label} 需要补充图表数据或指标卡。` });
    }
    if (labels.length && firstValues.length && labels.length !== firstValues.length) {
      issues.push({ level: 'warning', scope: 'slide', field: 'visualSpec.chart', slideId, message: `${label} 图表标签和数值数量不一致。` });
    }
    if (chartHasNumbers && !chartSource) {
      issues.push({ level: 'warning', scope: 'slide', field: 'visualSpec.chart.source', slideId, message: `${label} 图表已有数值，但缺少 source，建议补充数据来源。` });
    }
    if (chartHasNumbers && !spec.chart?.unit && series.some((item) => !item.unit)) {
      issues.push({ level: 'info', scope: 'slide', field: 'visualSpec.chart.unit', slideId, message: `${label} 图表数值缺少统一单位或序列单位。` });
    }
    if (chartEstimated && !chartMethodology) {
      issues.push({ level: 'warning', scope: 'slide', field: 'visualSpec.chart.methodology', slideId, message: `${label} 图表疑似估算数据，需要补充估算口径。` });
    }
    if (chartEstimated && chartMethodology) {
      issues.push({ level: 'info', scope: 'slide', field: 'visualSpec.chart.estimated', slideId, message: `${label} 使用估算数据，导出前建议替换为真实来源或保留估算说明。` });
    }
    if (metrics.some((item) => /待补|TBD|todo/i.test(String(item.value ?? item.detail ?? '')))) {
      issues.push({ level: 'info', scope: 'slide', field: 'visualSpec.metrics', slideId, message: `${label} 存在待补指标，建议补充真实口径。` });
    }
    if (metrics.some((item) => item.value !== undefined && !item.unit && !item.detail)) {
      issues.push({ level: 'info', scope: 'slide', field: 'visualSpec.metrics', slideId, message: `${label} 部分指标缺少单位或口径说明。` });
    }
    if (specType === 'matrix' && (!Array.isArray(spec.columns) || spec.columns.length < 2)) {
      issues.push({ level: 'warning', scope: 'slide', field: 'visualSpec.columns', slideId, message: `${label} 的矩阵至少需要 2 列。` });
    }
    if (specType === 'architecture' && (!Array.isArray(spec.layers) || spec.layers.length < 2)) {
      issues.push({ level: 'warning', scope: 'slide', field: 'visualSpec.layers', slideId, message: `${label} 的架构图至少需要 2 层。` });
    }
  });

  if (config && slides.length && config.pageCount && Math.abs(slides.length - config.pageCount) >= 4) {
    issues.push({ level: 'info', scope: 'deck', field: 'config.pageCount', message: `当前 ${slides.length} 页，与配置页数 ${config.pageCount} 差距较大。` });
  }

  return issues.slice(0, 40);
}

export function chartKindFromVisualType(type: VisualSpecType): DataChartKind {
  if (type === 'bar' || type === 'line' || type === 'scorecard') return type;
  if (type === 'combo_metrics') return 'line';
  return 'scorecard';
}

export function designerMetricsFromSlide(slide: DeckSlide): VisualSpecItem[] {
  const spec = visualSpecOfSlide(slide);
  if (spec.metrics?.length) return spec.metrics.slice(0, 6);
  const chartRows = metricDataFromVisualSpec(spec);
  const rows = chartRows.length ? chartRows : metricDataFromBullets(slide.bullets);
  return rows.slice(0, 6).map((row) => ({
    label: row.label,
    value: row.value === null ? row.display : row.value,
    unit: row.unit,
    detail: row.detail,
  }));
}

export function parseDelimitedLabels(value: string) {
  return value.split(/[,\n，、]/u).map((item) => item.trim()).filter(Boolean).slice(0, 12);
}

export function parseDelimitedNumbers(value: string) {
  return value
    .split(/[,\n，、]/u)
    .map((item) => Number(item.trim().replace(/[^\d.+-]/g, '')))
    .filter((item) => Number.isFinite(item))
    .slice(0, 12);
}

export function splitEditorDetail(value: string) {
  return value.split(/[，,、/|]/u).map((item) => item.trim()).filter(Boolean).slice(0, 8);
}

export function specItemsToEditorText(items: VisualSpecItem[] | undefined) {
  return (items || [])
    .map((item) => {
      const detail = item.detail || item.items?.join('、') || '';
      return `${item.label || item.title || '未命名'}${detail ? `：${detail}` : ''}`;
    })
    .join('\n');
}

export function parseSpecItemsFromEditorText(value: string): VisualSpecItem[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8)
    .map((line) => {
      const [label, ...detailParts] = line.split(/[:：]/u);
      const detail = detailParts.join('：').trim();
      return {
        label: (label || line).trim(),
        detail,
        items: splitEditorDetail(detail),
      };
    });
}

export function compactSpecJson(spec: SlideVisualSpec | null) {
  if (!spec) return '{}';
  return JSON.stringify(spec, null, 2);
}
