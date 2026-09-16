import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Empty,
  Input,
  InputNumber,
  Modal,
  Segmented,
  Select,
  Spin,
  Switch,
  Tag,
  Tooltip,
  message,
} from 'antd';
import {
  AlignCenterOutlined,
  AlignLeftOutlined,
  AlignRightOutlined,
  AppstoreAddOutlined,
  ArrowLeftOutlined,
  BarChartOutlined,
  BorderHorizontalOutlined,
  BorderOutlined,
  ColumnHeightOutlined,
  ColumnWidthOutlined,
  CopyOutlined,
  DashboardOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  FileImageOutlined,
  FilePptOutlined,
  FontSizeOutlined,
  FullscreenOutlined,
  FundProjectionScreenOutlined,
  LockOutlined,
  MenuOutlined,
  PlusOutlined,
  RedoOutlined,
  ReloadOutlined,
  SaveOutlined,
  ThunderboltOutlined,
  UndoOutlined,
  UnlockOutlined,
  UploadOutlined,
  VerticalAlignBottomOutlined,
  VerticalAlignTopOutlined,
} from '@ant-design/icons';
import { downloadBlob, downloadText, safeFileTitle } from '../features/aippt/browser';
import { fileToDataUrl, filenameForImage, isImageLikeUrl, isSupportedImageFile, svgTextToDataUrl } from '../features/aippt/assets';
import {
  OPENATLAS_AIPPT_AGENT_ADAPTER,
  OPENATLAS_AIPPT_STORAGE_ADAPTER,
} from '../features/aippt/openatlas-adapters';
import { buildHtmlDeck } from '../features/aippt/renderer';
import { selectedStyle } from '../features/aippt/styles';
import { downloadPresentationDeckPptx, validatePresentationDeckPptx } from '../services/api';
import type { AipptDeckVersion, AipptSlideActionResponse } from '../features/aippt/adapters';
import {
  chartKindFromSlide,
  chartKindFromVisualType,
  compactSpecJson,
  DATA_CHART_LABEL,
  DECK_LAYOUT_OPTIONS,
  designerMetricsFromSlide,
  inferArchitectureLayers,
  inferMatrixColumns,
  normalizePlanLayouts,
  parseDelimitedLabels,
  parseDelimitedNumbers,
  STATUS_COLOR,
  STATUS_LABEL,
  USE_CASE_LABEL,
  validateDeckSchema,
  visualSpecOfSlide,
  visualTypeToLayout,
  withChartHint,
  type DataChartKind,
  type DeckConfig,
  type DeckLayout,
  type DeckPlan,
  type DeckSlide,
  type SlideDesignCustomElement,
  type SlideDesignCustomElementType,
  type SlideDesignElementKey,
  type SlideDesignElementStyle,
  type SlideDesignMediaFit,
  type SlideDesignSpec,
  type SlideVisualSpec,
  type VisualSpecItem,
  type VisualSpecType,
} from '../features/aippt/schema';
import '../styles/presentation-canvas.css';

type SlideAction = 'rewrite' | 'enhance_chart' | 'roadshow_style';
type VisualSpecItemField = 'columns' | 'layers' | 'rows';
type ChartSeries = NonNullable<NonNullable<SlideVisualSpec['chart']>['series']>;
type ChartSeriesItem = ChartSeries[number];
type SlideDiffItem = { field: string; before: string; after: string };
type PatchTimelineItem = { label: string; detail: string; status: 'done' | 'active' | 'warning' };
type PendingSlidePatch = {
  id: string;
  action: SlideAction;
  slideId: string;
  originalSlide: DeckSlide;
  patch: Partial<DeckSlide>;
  mergedSlide: DeckSlide;
  previewConfig: DeckConfig;
  rationale: string;
  warnings: string[];
  diffItems: SlideDiffItem[];
  quality?: AipptSlideActionResponse['quality'];
  source?: string;
  generatedAt?: string;
};
type AppliedSlidePatch = {
  id: string;
  action: SlideAction;
  slideId: string;
  previousSlide: DeckSlide;
  nextSlide: DeckSlide;
  previousConfig: DeckConfig;
  nextConfig: DeckConfig;
  diffItems: SlideDiffItem[];
  appliedAt: string;
};
type UpdatePlanOptions = {
  clearPending?: boolean;
  clearUndo?: boolean;
  recordHistory?: boolean;
  historyLabel?: string;
};
type DesignerHistoryEntry = {
  plan: DeckPlan;
  config: DeckConfig;
  selectedSlideId: string | null;
  label: string;
};
type DesignerSchemaMutation = {
  label: string;
  slideId: string | null;
  at: string;
};
type DesignerInspectTab = 'content' | 'object' | 'visual' | 'notes';
type DesignerViewMode = 'design' | 'html';
type HtmlSlideBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};
type HtmlElementSnapshot = ResizeBox & {
  fontSize?: number;
  color?: string;
  fontWeight?: number;
  align?: SlideDesignElementStyle['align'];
  background?: string;
  radius?: number;
};
type HtmlElementBounds = Partial<Record<SlideDesignElementKey, HtmlElementSnapshot>>;
type DesignerLayer = {
  key: SlideDesignElementKey;
  label: string;
  name: string;
  style: SlideDesignElementStyle;
};
type DesignerAlignTarget = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
type DesignerDistributeAxis = 'horizontal' | 'vertical';
type DesignerGuide = {
  orientation: 'vertical' | 'horizontal';
  position: number;
  label?: string;
};
type DesignerMarqueeState = {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  rect: DOMRect;
};
type DesignerContextMenuState = {
  x: number;
  y: number;
  key: SlideDesignElementKey | null;
};
type DesignerInteractionFeedback = {
  kind: 'drag' | 'resize';
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
};
type InlineEditTarget =
  | { kind: 'slide'; key: SlideDesignElementKey }
  | { kind: 'custom'; id: string; field: 'content' | 'label' | 'value' | 'alt' };
type ResizeHandleKey = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
type ResizeBox = { x: number; y: number; width: number; height: number };
type ResizeState =
  | {
      kind: 'slide';
      key: SlideDesignElementKey;
      handle: ResizeHandleKey;
      startX: number;
      startY: number;
      rect: DOMRect;
      original: ResizeBox;
    }
  | {
      kind: 'custom';
      id: string;
      handle: ResizeHandleKey;
      startX: number;
      startY: number;
      rect: DOMRect;
      original: ResizeBox;
    };
type ElementDragState = {
  keys: SlideDesignElementKey[];
  startX: number;
  startY: number;
  origins: Partial<Record<SlideDesignElementKey, { x: number; y: number }>>;
  initialStyles: Partial<Record<SlideDesignElementKey, SlideDesignElementStyle>>;
  rect: DOMRect;
};
type CustomElementDragState = {
  ids: string[];
  startX: number;
  startY: number;
  origins: Record<string, { x: number; y: number }>;
  initialStyles: Record<string, SlideDesignCustomElement>;
  rect: DOMRect;
};
type DesignerToolboxGroup = 'basic' | 'chart' | 'layout' | 'asset';
type DesignerToolboxTemplateElement = {
  type: SlideDesignCustomElementType;
  patch?: Partial<SlideDesignCustomElement>;
};
type DesignerToolboxItem = {
  id: string;
  group: DesignerToolboxGroup;
  kind: 'element' | 'template';
  label: string;
  detail: string;
  icon: ReactNode;
  type?: SlideDesignCustomElementType;
  elements?: DesignerToolboxTemplateElement[];
};

const DESIGNER_ELEMENT_LABEL: Record<SlideDesignElementKey, string> = {
  eyebrow: '章节标签',
  title: '标题',
  headline: '核心观点',
  bullets: '内容要点',
  visual: '图片/视觉区',
};

const DESIGNER_ELEMENT_KEYS = Object.keys(DESIGNER_ELEMENT_LABEL) as SlideDesignElementKey[];

const RESIZE_HANDLES: ResizeHandleKey[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const RESIZE_HANDLE_LABEL: Record<ResizeHandleKey, string> = {
  nw: '左上角缩放',
  n: '顶部缩放',
  ne: '右上角缩放',
  e: '右侧缩放',
  se: '右下角缩放',
  s: '底部缩放',
  sw: '左下角缩放',
  w: '左侧缩放',
};

const DESIGNER_TOOLBOX_GROUPS: Array<{ value: DesignerToolboxGroup; label: string }> = [
  { value: 'basic', label: '基础' },
  { value: 'chart', label: '图表' },
  { value: 'layout', label: '版式' },
  { value: 'asset', label: '素材' },
];

const VISUAL_TEMPLATE_OPTIONS: Array<{ value: VisualSpecType; label: string; detail: string; group: string }> = [
  { value: 'generic', label: '常规图文页', detail: '保留当前版式，用文字和视觉说明表达。', group: '页面视觉模板' },
  { value: 'scorecard', label: '数字指标卡', detail: '适合展示 1-4 个核心经营指标。', group: '图表模板' },
  { value: 'bar', label: '柱状对比图', detail: '适合横向对比排名、占比和阶段差异。', group: '图表模板' },
  { value: 'line', label: '折线趋势图', detail: '适合展示时间序列、增长趋势和多序列变化。', group: '图表模板' },
  { value: 'combo_metrics', label: '趋势图 + 指标卡', detail: '图表和 KPI 同屏，适合经营汇报页。', group: '图表模板' },
  { value: 'matrix', label: '对比矩阵', detail: '适合能力、竞品、方案或优先级对比。', group: '结构模板' },
  { value: 'architecture', label: '分层架构图', detail: '适合系统、Agent、流程架构和模块关系。', group: '结构模板' },
  { value: 'process', label: '流程步骤', detail: '适合节点、动作、责任人和产出说明。', group: '结构模板' },
  { value: 'timeline', label: '时间线 / 路线图', detail: '适合阶段计划、里程碑和节奏表达。', group: '结构模板' },
  { value: 'roadmap', label: '路线图', detail: '适合产品规划、季度计划和交付路径。', group: '结构模板' },
];

const VISUAL_TEMPLATE_LABEL = VISUAL_TEMPLATE_OPTIONS.reduce((acc, item) => {
  acc[item.value] = item.label;
  return acc;
}, {} as Record<VisualSpecType, string>);

const DATA_VISUAL_TYPES = new Set<VisualSpecType>(['scorecard', 'bar', 'line', 'combo_metrics']);

const HTML_ELEMENT_SELECTORS: Record<SlideDesignElementKey, string[]> = {
  eyebrow: ['[data-aippt-element="eyebrow"]', '.slide-eyebrow', '.deck-kicker', '.matrix-title span', '.architecture-note span', '.quote-stage span'],
  title: ['[data-aippt-element="title"]', '.slide-header h1', '.cover-copy h1', '.section-stage h1', '.quote-stage blockquote'],
  headline: ['[data-aippt-element="headline"]', '.slide-header h2', '.cover-copy h2', '.section-stage h2'],
  bullets: ['[data-aippt-element="bullets"]', '.cover-points', '.section-chips', '.insight-list', '.compact-list', '.process-lane', '.timeline-lane', '.action-board'],
  visual: ['[data-aippt-element="visual"]', '.data-layout', '.combo-metrics', '.matrix-stage', '.architecture-stage', '.visual-panel', '.evidence-panel', '.diagram-layout', '.compare-board', '.cover-brief'],
};

const INSPECT_TAB_META: Record<DesignerInspectTab, { title: string; detail: string }> = {
  content: { title: '内容编辑', detail: '修改页面文案、版式和核心叙事。' },
  object: { title: '对象编辑', detail: '管理图层、位置、尺寸、样式和锁定状态。' },
  visual: { title: '图表/结构编辑', detail: '编辑图表数据、图片、矩阵、流程和架构结构。' },
  notes: { title: '备注与约束', detail: '维护演讲备注、渲染约束和结构摘要。' },
};

const VISUAL_EDITOR_TYPES = new Set<VisualSpecType>([
  'scorecard',
  'bar',
  'line',
  'combo_metrics',
  'matrix',
  'architecture',
]);

const DESIGNER_TOOLBOX_ITEMS: DesignerToolboxItem[] = [
  { id: 'text-box', group: 'basic', kind: 'element', type: 'text', label: '文本框', detail: '补一句结论、说明或批注', icon: <FontSizeOutlined /> },
  { id: 'shape-block', group: 'basic', kind: 'element', type: 'shape', label: '形状', detail: '色块、强调底板、装饰线索', icon: <BorderOutlined /> },
  { id: 'callout-note', group: 'basic', kind: 'template', label: '重点提示', detail: '强调条 + 说明文字', icon: <ThunderboltOutlined />, elements: [
    { type: 'shape', patch: { name: '提示底板', x: 54, y: 63, width: 34, height: 12, background: 'rgba(34,211,238,0.16)', radius: 10, zIndex: 70 } },
    { type: 'text', patch: { name: '提示文字', content: '这里补充一个关键提醒或结论。', x: 57, y: 66, width: 28, height: 6, background: 'transparent', fontSize: 16, fontWeight: 820, zIndex: 92 } },
  ] },
  { id: 'metric-card', group: 'chart', kind: 'element', type: 'metric', label: '指标卡', detail: '突出数字、进度和经营指标', icon: <DashboardOutlined /> },
  { id: 'kpi-strip', group: 'chart', kind: 'template', label: '三指标组', detail: '一排 KPI 卡片', icon: <BarChartOutlined />, elements: [
    { type: 'metric', patch: { name: '指标卡 1', label: '收入增速', value: '22%', x: 49, y: 61, width: 13, height: 15, zIndex: 90 } },
    { type: 'metric', patch: { name: '指标卡 2', label: '留存率', value: '94%', x: 64, y: 61, width: 13, height: 15, background: '#DCFCE7', color: '#059669', zIndex: 91 } },
    { type: 'metric', patch: { name: '指标卡 3', label: 'NDR', value: '128%', x: 79, y: 61, width: 13, height: 15, background: '#EEF2FF', color: '#4F46E5', zIndex: 92 } },
  ] },
  { id: 'mini-bars', group: 'chart', kind: 'template', label: '迷你柱图', detail: '可编辑柱状视觉', icon: <BarChartOutlined />, elements: [
    { type: 'shape', patch: { name: '柱 1', shape: 'rectangle', x: 58, y: 66, width: 5, height: 14, background: '#1D4ED8', radius: 5, zIndex: 76 } },
    { type: 'shape', patch: { name: '柱 2', shape: 'rectangle', x: 66, y: 58, width: 5, height: 22, background: '#10B981', radius: 5, zIndex: 77 } },
    { type: 'shape', patch: { name: '柱 3', shape: 'rectangle', x: 74, y: 51, width: 5, height: 29, background: '#F59E0B', radius: 5, zIndex: 78 } },
    { type: 'text', patch: { name: '图表标题', content: '增长趋势', x: 58, y: 45, width: 22, height: 5, background: 'transparent', fontSize: 15, fontWeight: 900, zIndex: 95 } },
  ] },
  { id: 'two-column-block', group: 'layout', kind: 'template', label: '双列模块', detail: '左右内容块', icon: <ColumnWidthOutlined />, elements: [
    { type: 'text', patch: { name: '左列标题', content: '现状', x: 52, y: 26, width: 17, height: 7, fontSize: 20, fontWeight: 900, background: '#EAF2FF', radius: 10, zIndex: 86 } },
    { type: 'text', patch: { name: '左列内容', content: '补充现状、问题或背景。', x: 52, y: 35, width: 17, height: 20, fontSize: 14, background: 'rgba(255,255,255,0.86)', radius: 10, zIndex: 86 } },
    { type: 'text', patch: { name: '右列标题', content: '目标', x: 73, y: 26, width: 17, height: 7, fontSize: 20, fontWeight: 900, background: '#DCFCE7', radius: 10, zIndex: 87 } },
    { type: 'text', patch: { name: '右列内容', content: '补充目标、方案或收益。', x: 73, y: 35, width: 17, height: 20, fontSize: 14, background: 'rgba(255,255,255,0.86)', radius: 10, zIndex: 87 } },
  ] },
  { id: 'section-band', group: 'layout', kind: 'template', label: '章节横幅', detail: '大色条 + 标题', icon: <BorderHorizontalOutlined />, elements: [
    { type: 'shape', patch: { name: '章节底板', shape: 'rectangle', x: 8, y: 78, width: 84, height: 10, background: 'rgba(29,78,216,0.12)', radius: 8, zIndex: 8 } },
    { type: 'text', patch: { name: '章节文字', content: '下一阶段行动重点', x: 11, y: 80, width: 48, height: 6, background: 'transparent', fontSize: 22, fontWeight: 920, zIndex: 96 } },
  ] },
  { id: 'image-box', group: 'asset', kind: 'element', type: 'image', label: '图片', detail: '插入截图、SVG 或素材占位', icon: <FileImageOutlined /> },
  { id: 'image-caption', group: 'asset', kind: 'template', label: '图片说明', detail: '图片位 + 标注文字', icon: <FileImageOutlined />, elements: [
    { type: 'image', patch: { name: '图片素材', x: 58, y: 32, width: 30, height: 26, zIndex: 86 } },
    { type: 'text', patch: { name: '图片说明', content: '补充图片来源或说明。', x: 58, y: 61, width: 30, height: 6, fontSize: 13, color: '#64748B', background: 'transparent', zIndex: 87 } },
  ] },
];

const DESIGNER_ELEMENT_DEFAULTS: Record<SlideDesignElementKey, Required<Pick<SlideDesignElementStyle, 'x' | 'y' | 'width' | 'height' | 'zIndex' | 'fontSize' | 'color' | 'fontWeight' | 'align' | 'visible' | 'locked' | 'radius'>>> = {
  eyebrow: { x: 8, y: 8, width: 44, height: 6, zIndex: 10, fontSize: 15, color: '#0f766e', fontWeight: 850, align: 'left', visible: true, locked: false, radius: 0 },
  title: { x: 8, y: 18, width: 63, height: 16, zIndex: 20, fontSize: 52, color: '#101828', fontWeight: 950, align: 'left', visible: true, locked: false, radius: 0 },
  headline: { x: 8, y: 39, width: 68, height: 10, zIndex: 40, fontSize: 26, color: '#344054', fontWeight: 720, align: 'left', visible: true, locked: false, radius: 0 },
  bullets: { x: 8, y: 56, width: 47, height: 30, zIndex: 30, fontSize: 21, color: '#1d2939', fontWeight: 680, align: 'left', visible: true, locked: false, radius: 0 },
  visual: { x: 60, y: 48, width: 32, height: 34, zIndex: 5, fontSize: 20, color: '#1d2939', fontWeight: 780, align: 'left', visible: true, locked: false, radius: 16 },
};

const CUSTOM_ELEMENT_DEFAULTS: Record<SlideDesignCustomElementType, Omit<SlideDesignCustomElement, 'id' | 'type'>> = {
  text: {
    name: '文本框',
    content: '补充一条关键说明',
    x: 56,
    y: 26,
    width: 26,
    height: 12,
    zIndex: 80,
    fontSize: 18,
    color: '#111827',
    fontWeight: 760,
    align: 'left',
    background: 'rgba(255,255,255,0.82)',
    radius: 8,
    visible: true,
    locked: false,
  },
  image: {
    name: '图片',
    content: '图片/素材',
    alt: '图片素材',
    fit: 'cover',
    x: 61,
    y: 50,
    width: 27,
    height: 24,
    zIndex: 82,
    fontSize: 16,
    color: '#1d4ed8',
    fontWeight: 850,
    align: 'center',
    background: 'rgba(239,246,255,0.92)',
    radius: 14,
    visible: true,
    locked: false,
  },
  shape: {
    name: '形状',
    shape: 'pill',
    x: 58,
    y: 72,
    width: 24,
    height: 8,
    zIndex: 4,
    fontSize: 14,
    color: '#111827',
    fontWeight: 700,
    align: 'center',
    background: 'rgba(34,211,238,0.22)',
    radius: 999,
    visible: true,
    locked: false,
  },
  metric: {
    name: '指标卡',
    label: '核心指标',
    value: '128%',
    unit: '',
    x: 66,
    y: 58,
    width: 20,
    height: 18,
    zIndex: 86,
    fontSize: 28,
    color: '#1d4ed8',
    fontWeight: 930,
    align: 'left',
    background: 'rgba(234,242,255,0.96)',
    radius: 12,
    visible: true,
    locked: false,
  },
};

function clampValue(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeDesignElementStyle(key: SlideDesignElementKey, style?: SlideDesignElementStyle): SlideDesignElementStyle {
  const defaults = DESIGNER_ELEMENT_DEFAULTS[key];
  return {
    ...defaults,
    ...style,
    name: style?.name?.trim() || undefined,
    x: clampValue(Number(style?.x ?? defaults.x), -20, 120),
    y: clampValue(Number(style?.y ?? defaults.y), -20, 120),
    width: clampValue(Number(style?.width ?? defaults.width), 4, 120),
    height: clampValue(Number(style?.height ?? defaults.height), 3, 120),
    zIndex: clampValue(Number(style?.zIndex ?? defaults.zIndex), -100, 1000),
    fontSize: clampValue(Number(style?.fontSize ?? defaults.fontSize), 8, 96),
    fontWeight: clampValue(Number(style?.fontWeight ?? defaults.fontWeight), 300, 1000),
    radius: clampValue(Number(style?.radius ?? defaults.radius), 0, 40),
    visible: style?.visible !== false,
    locked: style?.locked === true,
    align: style?.align || defaults.align,
  };
}

function normalizeCustomElement(element: SlideDesignCustomElement): SlideDesignCustomElement {
  const defaults = CUSTOM_ELEMENT_DEFAULTS[element.type] || CUSTOM_ELEMENT_DEFAULTS.text;
  return {
    ...defaults,
    ...element,
    name: element.name?.trim() || defaults.name,
    x: clampValue(Number(element.x ?? defaults.x ?? 0), -20, 120),
    y: clampValue(Number(element.y ?? defaults.y ?? 0), -20, 120),
    width: clampValue(Number(element.width ?? defaults.width ?? 16), 4, 120),
    height: clampValue(Number(element.height ?? defaults.height ?? 10), 3, 120),
    zIndex: clampValue(Number(element.zIndex ?? defaults.zIndex ?? 80), -100, 1000),
    fontSize: clampValue(Number(element.fontSize ?? defaults.fontSize ?? 18), 8, 96),
    fontWeight: clampValue(Number(element.fontWeight ?? defaults.fontWeight ?? 700), 300, 1000),
    radius: clampValue(Number(element.radius ?? defaults.radius ?? 8), 0, 999),
    visible: element.visible !== false,
    locked: element.locked === true,
    align: element.align || defaults.align || 'left',
    fit: element.fit || defaults.fit || 'cover',
    shape: element.shape || defaults.shape || 'rectangle',
  };
}

function customElementDisplayName(element: SlideDesignCustomElement) {
  const normalized = normalizeCustomElement(element);
  return normalized.name || normalized.label || normalized.content || CUSTOM_ELEMENT_DEFAULTS[normalized.type]?.name || '组件';
}

function toolboxItemElements(item: DesignerToolboxItem): DesignerToolboxTemplateElement[] {
  if (item.kind === 'element' && item.type) return [{ type: item.type }];
  return item.elements || [];
}

function designerLayerName(key: SlideDesignElementKey, style?: SlideDesignElementStyle) {
  return style?.name?.trim() || DESIGNER_ELEMENT_LABEL[key];
}

function styleBox(style: SlideDesignElementStyle) {
  const x = Number(style.x || 0);
  const y = Number(style.y || 0);
  const width = Number(style.width || 0);
  const height = Number(style.height || 0);
  return {
    x,
    y,
    width,
    height,
    left: x,
    top: y,
    right: x + width,
    bottom: y + height,
    centerX: x + width / 2,
    centerY: y + height / 2,
  };
}

function resizeBoxFromStyle(style: SlideDesignElementStyle): ResizeBox {
  return {
    x: Number(style.x || 0),
    y: Number(style.y || 0),
    width: Number(style.width || 0),
    height: Number(style.height || 0),
  };
}

function hasExplicitElementGeometry(style?: SlideDesignElementStyle) {
  return ['x', 'y', 'width', 'height'].some((key) => style?.[key as keyof SlideDesignElementStyle] !== undefined);
}

function clientRectToResizeBox(rect: DOMRect, hostRect: DOMRect): ResizeBox {
  return {
    x: clampValue(((rect.left - hostRect.left) / hostRect.width) * 100, -20, 120),
    y: clampValue(((rect.top - hostRect.top) / hostRect.height) * 100, -20, 120),
    width: clampValue((rect.width / hostRect.width) * 100, 4, 120),
    height: clampValue((rect.height / hostRect.height) * 100, 3, 120),
  };
}

function cssAlignToDesignAlign(value: string | undefined): SlideDesignElementStyle['align'] | undefined {
  if (value === 'center' || value === 'right' || value === 'left') return value;
  if (value === 'end') return 'right';
  if (value === 'start') return 'left';
  return undefined;
}

function cssColorOrUndefined(value: string | undefined) {
  if (!value || value === 'transparent' || value === 'rgba(0, 0, 0, 0)') return undefined;
  return value;
}

function clientElementToSnapshot(element: HTMLElement, hostRect: DOMRect): HtmlElementSnapshot {
  const rect = element.getBoundingClientRect();
  const computed = element.ownerDocument.defaultView?.getComputedStyle(element);
  return {
    ...clientRectToResizeBox(rect, hostRect),
    fontSize: Number.parseFloat(computed?.fontSize || '') || undefined,
    color: cssColorOrUndefined(computed?.color),
    fontWeight: Number.parseFloat(computed?.fontWeight || '') || undefined,
    align: cssAlignToDesignAlign(computed?.textAlign),
    background: cssColorOrUndefined(computed?.backgroundColor),
    radius: Number.parseFloat(computed?.borderTopLeftRadius || '') || undefined,
  };
}

function firstVisibleElement(root: HTMLElement, selectors: string[]): HTMLElement | null {
  for (const selector of selectors) {
    const candidates = Array.from(root.querySelectorAll<HTMLElement>(selector));
    const element = candidates.find((item) => {
      const rect = item.getBoundingClientRect();
      const style = item.ownerDocument.defaultView?.getComputedStyle(item);
      return rect.width >= 4 && rect.height >= 4 && style?.display !== 'none' && style?.visibility !== 'hidden' && Number(style?.opacity ?? 1) > 0.05;
    });
    if (element) return element;
  }
  return null;
}

function htmlElementBoundsAlmostEqual(a: HtmlElementBounds, b: HtmlElementBounds) {
  return DESIGNER_ELEMENT_KEYS.every((key) => {
    const left = a[key];
    const right = b[key];
    if (!left && !right) return true;
    if (!left || !right) return false;
    return Math.abs(left.x - right.x) < 0.5
      && Math.abs(left.y - right.y) < 0.5
      && Math.abs(left.width - right.width) < 0.5
      && Math.abs(left.height - right.height) < 0.5
      && Math.abs(Number(left.fontSize || 0) - Number(right.fontSize || 0)) < 0.5
      && Math.abs(Number(left.fontWeight || 0) - Number(right.fontWeight || 0)) < 1
      && left.color === right.color
      && left.align === right.align
      && left.background === right.background;
  });
}

function resizeBoxForHandle(original: ResizeBox, handle: ResizeHandleKey, dx: number, dy: number, keepRatio: boolean): ResizeBox {
  let { x, y, width, height } = original;
  const minWidth = 4;
  const minHeight = 3;
  const hasWest = handle.includes('w');
  const hasEast = handle.includes('e');
  const hasNorth = handle.includes('n');
  const hasSouth = handle.includes('s');

  if (hasEast) width = original.width + dx;
  if (hasWest) {
    x = original.x + dx;
    width = original.width - dx;
  }
  if (hasSouth) height = original.height + dy;
  if (hasNorth) {
    y = original.y + dy;
    height = original.height - dy;
  }

  if (keepRatio && (hasWest || hasEast) && (hasNorth || hasSouth) && original.width > 0 && original.height > 0) {
    const ratio = original.width / original.height;
    const widthDelta = Math.abs(width - original.width) / original.width;
    const heightDelta = Math.abs(height - original.height) / original.height;
    if (widthDelta >= heightDelta) {
      const nextHeight = width / ratio;
      if (hasNorth) y = original.y + original.height - nextHeight;
      height = nextHeight;
    } else {
      const nextWidth = height * ratio;
      if (hasWest) x = original.x + original.width - nextWidth;
      width = nextWidth;
    }
  }

  if (width < minWidth) {
    if (hasWest) x = original.x + original.width - minWidth;
    width = minWidth;
  }
  if (height < minHeight) {
    if (hasNorth) y = original.y + original.height - minHeight;
    height = minHeight;
  }

  return {
    x: clampValue(x, -20, 120),
    y: clampValue(y, -20, 120),
    width: clampValue(width, minWidth, 120),
    height: clampValue(height, minHeight, 120),
  };
}

function geometryNumber(value: number) {
  return value.toFixed(1).replace(/\.0$/u, '');
}

function geometryFeedback(kind: DesignerInteractionFeedback['kind'], box: ResizeBox, label: string): DesignerInteractionFeedback {
  return {
    kind,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    label: `${label} · X ${geometryNumber(box.x)}% Y ${geometryNumber(box.y)}% · W ${geometryNumber(box.width)}% H ${geometryNumber(box.height)}%`,
  };
}

function unionBoxes(boxes: ReturnType<typeof styleBox>[]) {
  const left = Math.min(...boxes.map((box) => box.left));
  const top = Math.min(...boxes.map((box) => box.top));
  const right = Math.max(...boxes.map((box) => box.right));
  const bottom = Math.max(...boxes.map((box) => box.bottom));
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    left,
    top,
    right,
    bottom,
    centerX: left + (right - left) / 2,
    centerY: top + (bottom - top) / 2,
  };
}

function boxesIntersect(a: ReturnType<typeof styleBox>, b: ReturnType<typeof styleBox>) {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}

function slideDesignOf(slide: DeckSlide | null): SlideDesignSpec {
  return {
    mode: slide?.design?.mode || 'auto',
    elements: slide?.design?.elements || {},
    media: slide?.design?.media || [],
    customElements: (slide?.design?.customElements || []).map(normalizeCustomElement),
  };
}

function renumberSlides(slides: DeckSlide[]) {
  return slides.map((slide, index) => ({ ...slide, index: index + 1 }));
}

function cloneSlide(slide: DeckSlide, id: string): DeckSlide {
  return {
    ...JSON.parse(JSON.stringify(slide)),
    id,
    index: slide.index + 1,
    title: `${slide.title} 副本`,
    status: 'draft',
  };
}

function makeSlide(plan: DeckPlan, after: DeckSlide | null): DeckSlide {
  const id = `slide-${Date.now()}`;
  return {
    id,
    sectionId: after?.sectionId || plan.sections[0]?.id || 'section-1',
    index: (after?.index || plan.slides.length) + 1,
    title: '新增页面',
    headline: '补充一个新的关键观点',
    bullets: ['说明本页要解决的问题。', '补充必要的数据、案例或决策点。', '明确这页和前后页面的关系。'],
    visual: '自定义版式',
    layout: 'two_column',
    knowledgeIds: [plan.knowledge[0]?.id || 'k-topic'].filter(Boolean),
    status: 'draft',
    speakerNotes: '补充讲述备注。',
    renderHints: [],
  };
}

function actionLabel(action: SlideAction) {
  if (action === 'enhance_chart') return '增强图表';
  if (action === 'roadshow_style') return '改成路演风格';
  return '重写本页';
}

function numericValuesFromMetrics(metrics: VisualSpecItem[]) {
  return metrics
    .map((item) => Number(String(item.value ?? '').replace(/[^\d.+-]/g, '')))
    .filter((item) => Number.isFinite(item));
}

function textToSpecItems(value: string) {
  return value
    .split(/[\n；;]/u)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function specItemDetailText(item: VisualSpecItem) {
  if (item.items?.length) return item.items.join('\n');
  return item.detail || '';
}

function isFlowLayout(layout?: DeckLayout) {
  return layout === 'process' || layout === 'timeline' || layout === 'checklist';
}

function flowRowLabel(layout: DeckLayout, index: number) {
  if (layout === 'timeline') return `阶段 ${index + 1}`;
  if (layout === 'checklist') return `行动 ${index + 1}`;
  return `节点 ${index + 1}`;
}

function flowRowToBullet(row: VisualSpecItem, index: number, layout: DeckLayout) {
  const label = row.label || row.title || flowRowLabel(layout, index);
  const detail = row.detail || row.items?.join('、') || String(row.value ?? '');
  return detail ? `${label}：${detail}` : label;
}

function stringifyValue(value: unknown) {
  if (Array.isArray(value)) return value.join(' / ');
  if (value && typeof value === 'object') return JSON.stringify(value);
  return String(value ?? '');
}

function summarizeValue(value: unknown, limit = 90) {
  const text = stringifyValue(value).replace(/\s+/g, ' ').trim();
  if (!text) return '空';
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function stableJson(value: unknown) {
  return JSON.stringify(value ?? null);
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function isEditableEventTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target.isContentEditable;
}

type VisualSpecChart = NonNullable<SlideVisualSpec['chart']>;

function chartSubDiffs(before: VisualSpecChart | undefined, after: VisualSpecChart | undefined): SlideDiffItem[] {
  const beforeChart = before || {};
  const afterChart = after || {};
  const fields: Array<{ key: keyof VisualSpecChart; label: string }> = [
    { key: 'kind', label: '图表类型' },
    { key: 'labels', label: '横轴/阶段标签' },
    { key: 'unit', label: '数据单位' },
    { key: 'source', label: '数据来源' },
    { key: 'methodology', label: '统计口径' },
    { key: 'estimated', label: '是否估算' },
  ];
  const diffs = fields
    .filter(({ key }) => stableJson(beforeChart[key]) !== stableJson(afterChart[key]))
    .map(({ key, label }) => ({
      field: label,
      before: summarizeValue(beforeChart[key]),
      after: summarizeValue(afterChart[key]),
    }));

  const beforeSeries = Array.isArray(beforeChart.series) ? beforeChart.series : [];
  const afterSeries = Array.isArray(afterChart.series) ? afterChart.series : [];
  if (beforeSeries.length !== afterSeries.length) {
    diffs.push({
      field: '数据序列数',
      before: String(beforeSeries.length),
      after: String(afterSeries.length),
    });
  }

  const maxSeries = Math.max(beforeSeries.length, afterSeries.length);
  for (let index = 0; index < maxSeries; index += 1) {
    const beforeItem = beforeSeries[index];
    const afterItem = afterSeries[index];
    const label = `数据序列 ${index + 1}`;
    if (!beforeItem || !afterItem) {
      diffs.push({
        field: label,
        before: summarizeValue(beforeItem),
        after: summarizeValue(afterItem),
      });
      continue;
    }
    ([
      ['name', '名称'],
      ['values', '数值'],
      ['unit', '单位'],
    ] as const).forEach(([key, name]) => {
      if (stableJson(beforeItem[key]) !== stableJson(afterItem[key])) {
        diffs.push({
          field: `${label}.${name}`,
          before: summarizeValue(beforeItem[key], key === 'values' ? 120 : 90),
          after: summarizeValue(afterItem[key], key === 'values' ? 120 : 90),
        });
      }
    });
  }

  return diffs;
}

function visualSpecSubDiffs(before: SlideVisualSpec | undefined, after: SlideVisualSpec | undefined): SlideDiffItem[] {
  const fields: Array<{ key: keyof SlideVisualSpec; label: string }> = [
    { key: 'type', label: '页面视觉模板' },
    { key: 'title', label: '视觉标题' },
    { key: 'description', label: '视觉说明' },
    { key: 'columns', label: '矩阵/对比列' },
    { key: 'rows', label: '流程/时间线节点' },
    { key: 'layers', label: '架构层级' },
    { key: 'metrics', label: '指标卡' },
    { key: 'callouts', label: '重点标注' },
  ];
  const diffs = fields
    .filter(({ key }) => stableJson(before?.[key]) !== stableJson(after?.[key]))
    .map(({ key, label }) => ({
      field: label,
      before: summarizeValue(before?.[key]),
      after: summarizeValue(after?.[key]),
    }));
  if (stableJson(before?.chart) !== stableJson(after?.chart)) {
    const chartDiffs = chartSubDiffs(before?.chart, after?.chart);
    diffs.push(...(chartDiffs.length ? chartDiffs : [{
      field: '图表配置',
      before: summarizeValue(before?.chart),
      after: summarizeValue(after?.chart),
    }]));
  }
  return diffs;
}

function buildSlideDiffItems(before: DeckSlide, after: DeckSlide): SlideDiffItem[] {
  const fields: Array<{ key: keyof DeckSlide; label: string }> = [
    { key: 'title', label: '标题' },
    { key: 'headline', label: '核心观点' },
    { key: 'layout', label: '页面版式' },
    { key: 'visual', label: '视觉说明' },
    { key: 'bullets', label: '内容要点' },
    { key: 'renderHints', label: '高级渲染约束' },
    { key: 'visualSpec', label: '视觉与图表配置' },
    { key: 'speakerNotes', label: '演讲备注' },
    { key: 'status', label: '页面状态' },
  ];
  const diffItems = fields
    .filter(({ key }) => JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null))
    .flatMap(({ key, label }) => {
      if (key === 'visualSpec') return visualSpecSubDiffs(before.visualSpec, after.visualSpec);
      return [{
        field: label,
        before: summarizeValue(before[key]),
        after: summarizeValue(after[key]),
      }];
    });
  return diffItems.length ? diffItems : [];
}

function mergeSlidePatch(slide: DeckSlide, patch: Partial<DeckSlide>): DeckSlide {
  return {
    ...slide,
    ...patch,
    id: slide.id,
    sectionId: slide.sectionId,
    index: slide.index,
    knowledgeIds: patch.knowledgeIds || slide.knowledgeIds || [],
  };
}

function buildPatchTimeline(patch: PendingSlidePatch): PatchTimelineItem[] {
  const quality = patch.quality || {};
  const source = patch.source || 'hermes';
  return [
    {
      label: '构造上下文',
      detail: `相邻/全局 ${quality.context_slide_count || 0} 页，关联知识 ${quality.knowledge_count || 0} 条`,
      status: 'done',
    },
    {
      label: 'Hermes 生成',
      detail: source === 'fallback' || quality.fallback ? '未拿到稳定补丁，进入兜底建议' : `来源：${source}`,
      status: source === 'fallback' || quality.fallback ? 'warning' : 'done',
    },
    {
      label: 'JSON 修复',
      detail: quality.repaired ? '已通过结构化修复转为合法 JSON' : '无需修复或已直接解析',
      status: quality.repaired ? 'warning' : 'done',
    },
    {
      label: '等待确认',
      detail: '预览已更新，应用前不会写入 Deck Schema',
      status: 'active',
    },
  ];
}

export default function PresentationDesigner() {
  const { deckId = '' } = useParams();
  const navigate = useNavigate();
  const [messageApi, contextHolder] = message.useMessage();
  const [modalApi, modalContextHolder] = Modal.useModal();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [query, setQuery] = useState('');
  const [config, setConfig] = useState<DeckConfig | null>(null);
  const [plan, setPlan] = useState<DeckPlan | null>(null);
  const [selectedSlideId, setSelectedSlideId] = useState<string | null>(null);
  const [selectedElementKey, setSelectedElementKey] = useState<SlideDesignElementKey>('title');
  const [selectedElementKeys, setSelectedElementKeys] = useState<SlideDesignElementKey[]>(['title']);
  const [selectedCustomElementId, setSelectedCustomElementId] = useState<string | null>(null);
  const [selectedCustomElementIds, setSelectedCustomElementIds] = useState<string[]>([]);
  const [toolboxGroup, setToolboxGroup] = useState<DesignerToolboxGroup>('basic');
  const [inspectTab, setInspectTab] = useState<DesignerInspectTab>('content');
  const [viewMode, setViewMode] = useState<DesignerViewMode>('html');
  const [htmlSlideBounds, setHtmlSlideBounds] = useState<HtmlSlideBounds | null>(null);
  const [htmlElementBounds, setHtmlElementBounds] = useState<HtmlElementBounds>({});
  const [versions, setVersions] = useState<AipptDeckVersion[]>([]);
  const [draggingSlideId, setDraggingSlideId] = useState<string | null>(null);
  const [elementDrag, setElementDrag] = useState<ElementDragState | null>(null);
  const [customElementDrag, setCustomElementDrag] = useState<CustomElementDragState | null>(null);
  const [resizeState, setResizeState] = useState<ResizeState | null>(null);
  const [marquee, setMarquee] = useState<DesignerMarqueeState | null>(null);
  const [snapGuides, setSnapGuides] = useState<DesignerGuide[]>([]);
  const [interactionFeedback, setInteractionFeedback] = useState<DesignerInteractionFeedback | null>(null);
  const [contextMenu, setContextMenu] = useState<DesignerContextMenuState | null>(null);
  const [renamingLayerKey, setRenamingLayerKey] = useState<SlideDesignElementKey | null>(null);
  const [actionLoading, setActionLoading] = useState<SlideAction | null>(null);
  const [exportingPptx, setExportingPptx] = useState(false);
  const [validatingPptx, setValidatingPptx] = useState(false);
  const [pendingPatch, setPendingPatch] = useState<PendingSlidePatch | null>(null);
  const [lastAppliedPatch, setLastAppliedPatch] = useState<AppliedSlidePatch | null>(null);
  const [inlineEditTarget, setInlineEditTarget] = useState<InlineEditTarget | null>(null);
  const [inlineEditValue, setInlineEditValue] = useState('');
  const [historyTick, setHistoryTick] = useState(0);
  const [schemaRevision, setSchemaRevision] = useState(0);
  const [lastSchemaMutation, setLastSchemaMutation] = useState<DesignerSchemaMutation | null>(null);
  const artboardRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const inlineEditorRef = useRef<HTMLTextAreaElement>(null);
  const skipNextInlineCommitRef = useRef(false);
  const isCommittingInlineRef = useRef(false);
  const undoStackRef = useRef<DesignerHistoryEntry[]>([]);
  const redoStackRef = useRef<DesignerHistoryEntry[]>([]);
  const copiedSlideRef = useRef<DeckSlide | null>(null);
  const copiedCustomElementsRef = useRef<SlideDesignCustomElement[]>([]);
  const pasteHandledAtRef = useRef(0);
  const historyTickle = () => setHistoryTick((value) => value + 1);

  const previewConfig = pendingPatch && pendingPatch.slideId === selectedSlideId ? pendingPatch.previewConfig : config;
  const previewPlan = useMemo(() => {
    if (!plan || !pendingPatch || pendingPatch.slideId !== selectedSlideId) return plan;
    return {
      ...plan,
      slides: plan.slides.map((slide) => slide.id === pendingPatch.slideId ? pendingPatch.mergedSlide : slide),
    };
  }, [pendingPatch, plan, selectedSlideId]);
  const style = useMemo(() => (config ? selectedStyle(config) : null), [config]);
  const previewStyle = useMemo(() => (previewConfig ? selectedStyle(previewConfig) : null), [previewConfig]);
  const selectedPreviewSlideIndex = useMemo(() => {
    if (!previewPlan?.slides.length) return 0;
    const index = previewPlan.slides.findIndex((slide) => slide.id === selectedSlideId);
    return index >= 0 ? index : 0;
  }, [previewPlan, selectedSlideId]);
  const htmlDeck = useMemo(() => (
    previewPlan && previewConfig && previewStyle
      ? buildHtmlDeck(previewPlan, previewConfig, previewStyle, { initialSlide: selectedPreviewSlideIndex })
      : ''
  ), [previewConfig, previewPlan, previewStyle, selectedPreviewSlideIndex]);
  const selectedSlide = useMemo(() => plan?.slides.find((slide) => slide.id === selectedSlideId) || plan?.slides[0] || null, [plan, selectedSlideId]);
  const activePendingPatch = pendingPatch && pendingPatch.slideId === selectedSlide?.id ? pendingPatch : null;
  const activeAppliedPatch = lastAppliedPatch && lastAppliedPatch.slideId === selectedSlide?.id ? lastAppliedPatch : null;
  const selectedVisualSpec = useMemo(() => (selectedSlide ? visualSpecOfSlide(selectedSlide) : null), [selectedSlide]);
  const selectedMetrics = useMemo(() => (selectedSlide ? designerMetricsFromSlide(selectedSlide) : []), [selectedSlide]);
  const selectedDesign = useMemo(() => slideDesignOf(selectedSlide), [selectedSlide]);
  const customElements = useMemo(() => selectedDesign.customElements || [], [selectedDesign.customElements]);
  const selectedCustomElement = useMemo(() => (
    selectedCustomElementId
      ? customElements.find((element) => element.id === selectedCustomElementId) || null
      : null
  ), [customElements, selectedCustomElementId]);
  const selectedCustomElementStyle = useMemo(() => (
    selectedCustomElement ? normalizeCustomElement(selectedCustomElement) : null
  ), [selectedCustomElement]);
  const selectedCustomElements = useMemo(() => (
    selectedCustomElementIds
      .map((id) => customElements.find((element) => element.id === id))
      .filter((element): element is SlideDesignCustomElement => !!element)
      .map(normalizeCustomElement)
  ), [customElements, selectedCustomElementIds]);
  const filteredToolboxItems = useMemo(() => (
    DESIGNER_TOOLBOX_ITEMS.filter((item) => item.group === toolboxGroup)
  ), [toolboxGroup]);
  const effectiveDesignElementStyle = useCallback((key: SlideDesignElementKey) => {
    const rawValue = selectedDesign.elements?.[key];
    const normalized = normalizeDesignElementStyle(key, rawValue);
    const measured = htmlElementBounds[key];
    if (!measured || (selectedDesign.mode === 'freeform' && hasExplicitElementGeometry(rawValue))) {
      return normalized;
    }
    return normalizeDesignElementStyle(key, {
      ...normalized,
      ...measured,
    });
  }, [htmlElementBounds, selectedDesign.elements, selectedDesign.mode]);
  const selectedElementStyle = useMemo(() => (
    effectiveDesignElementStyle(selectedElementKey)
  ), [effectiveDesignElementStyle, selectedElementKey]);
  const activeSelectionKeys = selectedElementKeys.length ? selectedElementKeys : [selectedElementKey];
  const selectedElementLocked = activeSelectionKeys.some((key) => effectiveDesignElementStyle(key).locked === true);
  const selectedLayerNames = activeSelectionKeys.map((key) => designerLayerName(key, selectedDesign.elements?.[key]));
  const selectedObjectStatusText = useMemo(() => {
    const value = selectedCustomElementStyle || selectedElementStyle;
    const name = selectedCustomElementStyle
      ? customElementDisplayName(selectedCustomElementStyle)
      : designerLayerName(selectedElementKey, selectedDesign.elements?.[selectedElementKey]);
    const sync = selectedCustomElementStyle
      ? 'Schema 自定义组件'
      : htmlElementBounds[selectedElementKey]
        ? '已贴合 HTML'
        : selectedDesign.mode === 'freeform'
          ? 'Schema 自由层'
          : '等待 HTML 测量';
    return `${name} · ${sync} · X ${geometryNumber(Number(value.x || 0))}% Y ${geometryNumber(Number(value.y || 0))}% · W ${geometryNumber(Number(value.width || 0))}% H ${geometryNumber(Number(value.height || 0))}%`;
  }, [htmlElementBounds, selectedCustomElementStyle, selectedDesign.elements, selectedDesign.mode, selectedElementKey, selectedElementStyle]);
  const selectedObjectName = useMemo(() => (
    selectedCustomElementStyle
      ? customElementDisplayName(selectedCustomElementStyle)
      : designerLayerName(selectedElementKey, selectedDesign.elements?.[selectedElementKey])
  ), [selectedCustomElementStyle, selectedDesign.elements, selectedElementKey]);
  const selectedObjectCanInlineEdit = useMemo(() => (
    selectedCustomElementStyle
      ? selectedCustomElementStyle.type === 'text' || selectedCustomElementStyle.type === 'metric'
      : selectedElementKey !== 'visual'
  ), [selectedCustomElementStyle, selectedElementKey]);
  const selectedObjectCanReplaceImage = useMemo(() => (
    selectedCustomElementStyle?.type === 'image' || selectedElementKey === 'visual'
  ), [selectedCustomElementStyle, selectedElementKey]);
  const selectedObjectToolbarStyle = useMemo<CSSProperties>(() => {
    const box = styleBox(selectedCustomElementStyle || selectedElementStyle);
    const top = box.top > 14
      ? clampValue(box.top - 10, 1, 88)
      : clampValue(box.bottom + 2, 1, 88);
    const leftAnchor = box.centerX > 62 ? box.right - 34 : box.left;
    return {
      position: 'absolute',
      top: `${top}%`,
      left: `${clampValue(leftAnchor, 1, 62)}%`,
      zIndex: 1600,
      display: 'flex',
      gap: 6,
      alignItems: 'center',
      maxWidth: 'calc(100% - 24px)',
      padding: '6px 8px',
      borderRadius: 10,
      background: 'rgba(255,255,255,0.9)',
      boxShadow: '0 10px 28px rgba(15,23,42,0.14)',
      backdropFilter: 'blur(10px)',
      pointerEvents: 'none',
    };
  }, [selectedCustomElementStyle, selectedElementStyle]);
  const designLayers = useMemo<DesignerLayer[]>(() => (
    DESIGNER_ELEMENT_KEYS
      .map((key) => ({
        key,
        label: DESIGNER_ELEMENT_LABEL[key],
        name: designerLayerName(key, selectedDesign.elements?.[key]),
        style: effectiveDesignElementStyle(key),
      }))
      .sort((a, b) => Number(b.style.zIndex || 0) - Number(a.style.zIndex || 0))
  ), [effectiveDesignElementStyle, selectedDesign.elements]);
  const customLayers = useMemo(() => (
    customElements
      .map(normalizeCustomElement)
      .sort((a, b) => Number(b.zIndex || 0) - Number(a.zIndex || 0))
  ), [customElements]);
  const artboardLayers = useMemo<DesignerLayer[]>(() => (
    [...designLayers].sort((a, b) => Number(a.style.zIndex || 0) - Number(b.style.zIndex || 0))
  ), [designLayers]);
  const selectedMedia = selectedDesign.media?.[0] || null;
  const schemaIssues = useMemo(() => (plan && config ? validateDeckSchema(plan, config) : []), [config, plan]);
  const schemaErrorCount = schemaIssues.filter((issue) => issue.level === 'error').length;
  const schemaWarningCount = schemaIssues.filter((issue) => issue.level === 'warning').length;
  const schemaInfoCount = schemaIssues.filter((issue) => issue.level === 'info').length;
  const chartKind = selectedSlide ? chartKindFromSlide(selectedSlide) : 'scorecard';
  const chartLabels = selectedVisualSpec?.chart?.labels?.length
    ? selectedVisualSpec.chart.labels
    : selectedMetrics.map((item) => String(item.label || item.title || '指标'));
  const chartSeries = selectedVisualSpec?.chart?.series?.length
    ? selectedVisualSpec.chart.series
    : [{
        name: '当前值',
        values: numericValuesFromMetrics(selectedMetrics),
        unit: selectedVisualSpec?.chart?.unit || '',
      }];
  const matrixColumns: VisualSpecItem[] = selectedSlide
    ? (selectedVisualSpec?.columns?.length ? selectedVisualSpec.columns : inferMatrixColumns(selectedSlide))
    : [];
  const architectureLayers: VisualSpecItem[] = selectedSlide
    ? (selectedVisualSpec?.layers?.length ? selectedVisualSpec.layers : inferArchitectureLayers(selectedSlide))
    : [];
  const flowRows: VisualSpecItem[] = selectedSlide && isFlowLayout(selectedSlide.layout)
    ? (selectedVisualSpec?.rows?.length
        ? selectedVisualSpec.rows
        : selectedSlide.bullets.map((item, index) => ({
            label: flowRowLabel(selectedSlide.layout, index),
            detail: item,
          })))
    : [];
  const canUndo = historyTick >= 0 && undoStackRef.current.length > 0;
  const canRedo = historyTick >= 0 && redoStackRef.current.length > 0;

  const inspectorTabForSlide = (slide: DeckSlide): DesignerInspectTab => {
    const spec = visualSpecOfSlide(slide);
    if (VISUAL_EDITOR_TYPES.has((spec.type || 'generic') as VisualSpecType) || isFlowLayout(slide.layout)) return 'visual';
    return 'content';
  };

  const inspectorTabForElement = (key: SlideDesignElementKey): DesignerInspectTab => {
    if (key === 'visual') return 'visual';
    return 'content';
  };

  const selectSlideFromList = (slide: DeckSlide) => {
    setSelectedSlideId(slide.id);
    setSelectedCustomElementId(null);
    setSelectedCustomElementIds([]);
    setElementSelection(['title'], 'title');
    setInspectTab(inspectorTabForSlide(slide));
  };

  const enterDesignMode = () => {
    setViewMode('design');
    window.setTimeout(() => {
      artboardRef.current?.focus();
    }, 0);
  };

  const loadVersions = useCallback(async () => {
    if (!deckId) return;
    try {
      setVersions(await OPENATLAS_AIPPT_STORAGE_ADAPTER.listVersions(deckId));
    } catch {
      setVersions([]);
    }
  }, [deckId]);

  const measureHtmlSlideBounds = useCallback(() => {
    const frame = frameRef.current;
    const doc = frame?.contentDocument;
    const slideHost = doc?.querySelector<HTMLElement>('.slides');
    const htmlSlides = doc ? Array.from(doc.querySelectorAll<HTMLElement>('.slide')) : [];
    const slideForElements = htmlSlides[selectedPreviewSlideIndex]
      || doc?.querySelector<HTMLElement>('.slide.active')
      || htmlSlides[0];
    if (!frame || !doc || !slideHost || !slideForElements) {
      setHtmlSlideBounds(null);
      setHtmlElementBounds({});
      return;
    }
    const rect = slideHost.getBoundingClientRect();
    const elementHostRect = slideForElements.getBoundingClientRect();
    if (rect.width < 24 || rect.height < 24) {
      setHtmlSlideBounds(null);
      setHtmlElementBounds({});
      return;
    }
    const nextElementBounds = DESIGNER_ELEMENT_KEYS.reduce((acc, key) => {
      const element = firstVisibleElement(slideForElements, HTML_ELEMENT_SELECTORS[key]);
      if (element) acc[key] = clientElementToSnapshot(element, elementHostRect);
      return acc;
    }, {} as HtmlElementBounds);
    const next = {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
    setHtmlSlideBounds((prev) => (
      prev
      && Math.abs(prev.left - next.left) < 0.5
      && Math.abs(prev.top - next.top) < 0.5
      && Math.abs(prev.width - next.width) < 0.5
      && Math.abs(prev.height - next.height) < 0.5
        ? prev
        : next
    ));
    setHtmlElementBounds((prev) => htmlElementBoundsAlmostEqual(prev, nextElementBounds) ? prev : nextElementBounds);
  }, [selectedPreviewSlideIndex]);

  const handleFrameLoad = () => {
    window.requestAnimationFrame(measureHtmlSlideBounds);
    window.setTimeout(measureHtmlSlideBounds, 180);
  };

  useEffect(() => {
    setHtmlSlideBounds(null);
    setHtmlElementBounds({});
  }, [selectedSlideId]);

  useEffect(() => {
    const refresh = () => measureHtmlSlideBounds();
    window.requestAnimationFrame(refresh);
    const timer = window.setTimeout(refresh, 240);
    const frameWindow = frameRef.current?.contentWindow || null;
    window.addEventListener('resize', refresh);
    frameWindow?.addEventListener('resize', refresh);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('resize', refresh);
      frameWindow?.removeEventListener('resize', refresh);
    };
  }, [htmlDeck, measureHtmlSlideBounds, selectedSlideId, viewMode]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const detail = await OPENATLAS_AIPPT_STORAGE_ADAPTER.getDeck(deckId);
        if (cancelled) return;
        const nextConfig = detail.config as DeckConfig;
        const nextPlan = detail.plan ? normalizePlanLayouts(detail.plan as DeckPlan, nextConfig) : null;
        setQuery(detail.query || '');
        setConfig(nextConfig);
        setPlan(nextPlan);
        setSelectedSlideId(nextPlan?.slides[0]?.id || null);
        setSelectedElementKey('title');
        setSelectedElementKeys(['title']);
        setSelectedCustomElementId(null);
        setSelectedCustomElementIds([]);
        setPendingPatch(null);
        setLastAppliedPatch(null);
        setSchemaRevision(0);
        setLastSchemaMutation(null);
        undoStackRef.current = [];
        redoStackRef.current = [];
        copiedSlideRef.current = null;
        copiedCustomElementsRef.current = [];
        historyTickle();
        setDirty(false);
        await loadVersions();
      } catch (err: any) {
        if (!cancelled) messageApi.error(err?.message || '加载 AIPPT Designer 失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [deckId, loadVersions, messageApi]);

  useEffect(() => {
    if (!dirty) return undefined;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirty]);

  const leaveDesigner = () => {
    if (!dirty) {
      navigate('/presentation-canvas');
      return;
    }
    modalApi.confirm({
      title: '有未保存的 Designer 编辑',
      content: '返回 AIPPT 首页前建议先保存版本，未保存修改只保留在当前页面状态里。',
      okText: '仍然返回',
      cancelText: '继续编辑',
      onOk: () => navigate('/presentation-canvas'),
    });
  };

  const pushHistory = (label = '编辑') => {
    if (!plan || !config) return;
    undoStackRef.current = [
      ...undoStackRef.current.slice(-49),
      {
        plan: cloneValue(plan),
        config: cloneValue(config),
        selectedSlideId,
        label,
      },
    ];
    redoStackRef.current = [];
    historyTickle();
  };

  const restoreHistoryEntry = (entry: DesignerHistoryEntry, target: 'undo' | 'redo') => {
    if (!plan || !config) return;
    const current: DesignerHistoryEntry = {
      plan: cloneValue(plan),
      config: cloneValue(config),
      selectedSlideId,
      label: target === 'undo' ? '撤销前状态' : '重做前状态',
    };
    if (target === 'undo') {
      redoStackRef.current = [...redoStackRef.current, current].slice(-50);
    } else {
      undoStackRef.current = [...undoStackRef.current, current].slice(-50);
    }
    setPlan(cloneValue(entry.plan));
    setConfig(cloneValue(entry.config));
    setSelectedSlideId(entry.selectedSlideId || entry.plan.slides[0]?.id || null);
    setSelectedElementKeys([selectedElementKey]);
    setSelectedCustomElementId(null);
    setSelectedCustomElementIds([]);
    setPendingPatch(null);
    setLastAppliedPatch(null);
    setDirty(true);
    setSchemaRevision((value) => value + 1);
    setLastSchemaMutation({
      label: target === 'undo' ? `撤销：${entry.label}` : `重做：${entry.label}`,
      slideId: entry.selectedSlideId || entry.plan.slides[0]?.id || null,
      at: new Date().toISOString(),
    });
    historyTickle();
  };

  const undoDesignerEdit = () => {
    const entry = undoStackRef.current.pop();
    if (!entry) {
      messageApi.info('没有可撤销的编辑');
      historyTickle();
      return;
    }
    restoreHistoryEntry(entry, 'undo');
    messageApi.success(`已撤销：${entry.label}`);
  };

  const redoDesignerEdit = () => {
    const entry = redoStackRef.current.pop();
    if (!entry) {
      messageApi.info('没有可重做的编辑');
      historyTickle();
      return;
    }
    restoreHistoryEntry(entry, 'redo');
    messageApi.success(`已重做：${entry.label}`);
  };

  const updatePlan = (updater: (prev: DeckPlan) => DeckPlan, options: UpdatePlanOptions = {}) => {
    const { clearPending = true, clearUndo = true, recordHistory = true, historyLabel = '编辑' } = options;
    if (clearPending) setPendingPatch(null);
    if (clearUndo) setLastAppliedPatch(null);
    if (recordHistory) pushHistory(historyLabel);
    setSchemaRevision((value) => value + 1);
    setLastSchemaMutation({
      label: historyLabel,
      slideId: selectedSlideId,
      at: new Date().toISOString(),
    });
    setPlan((prev) => {
      if (!prev) return prev;
      const next = updater(prev);
      setDirty(true);
      return { ...next, generatedAt: new Date().toISOString() };
    });
  };

  const updateSlide = (id: string, patch: Partial<DeckSlide>, options?: UpdatePlanOptions) => {
    updatePlan((prev) => ({
      ...prev,
      slides: prev.slides.map((slide) => slide.id === id ? { ...slide, ...patch } : slide),
    }), options);
  };

  const updateSelectedSlide = (patch: Partial<DeckSlide>) => {
    if (!selectedSlide) return;
    updateSlide(selectedSlide.id, patch);
  };

  const updateSelectedDesign = (patch: Partial<SlideDesignSpec>) => {
    if (!selectedSlide) return;
    const current = slideDesignOf(selectedSlide);
    updateSlide(selectedSlide.id, {
      design: {
        ...current,
        ...patch,
        elements: patch.elements ? { ...current.elements, ...patch.elements } : current.elements,
        media: patch.media || current.media,
      },
    });
  };

  const anchoredDesignElements = (
    overrides: Partial<Record<SlideDesignElementKey, Partial<SlideDesignElementStyle>>> = {},
  ): Partial<Record<SlideDesignElementKey, SlideDesignElementStyle>> => (
    DESIGNER_ELEMENT_KEYS.reduce((acc, key) => {
      acc[key] = normalizeDesignElementStyle(key, {
        ...effectiveDesignElementStyle(key),
        ...(overrides[key] || {}),
      });
      return acc;
    }, {} as Partial<Record<SlideDesignElementKey, SlideDesignElementStyle>>)
  );

  const updateSelectedElementStyle = (key: SlideDesignElementKey, patch: Partial<SlideDesignElementStyle>, options?: UpdatePlanOptions) => {
    if (!selectedSlide) return;
    const current = slideDesignOf(selectedSlide);
    const base = effectiveDesignElementStyle(key);
    updateSlide(selectedSlide.id, {
      design: {
        ...current,
        mode: 'freeform',
        elements: {
          ...anchoredDesignElements({
            [key]: {
              ...base,
              ...patch,
            },
          }),
        },
      },
    }, { clearPending: true, clearUndo: true, historyLabel: `编辑${DESIGNER_ELEMENT_LABEL[key]}`, ...options });
  };

  const updateCustomElements = (
    producer: (items: SlideDesignCustomElement[]) => SlideDesignCustomElement[],
    historyLabel = '编辑组件',
    options?: UpdatePlanOptions,
  ) => {
    if (!selectedSlide) return;
    const current = slideDesignOf(selectedSlide);
    const nextItems = producer((current.customElements || []).map(normalizeCustomElement)).map(normalizeCustomElement);
    updateSlide(selectedSlide.id, {
      design: {
        ...current,
        mode: 'freeform',
        elements: anchoredDesignElements(),
        customElements: nextItems,
      },
    }, { clearPending: true, clearUndo: true, historyLabel, ...options });
  };

  const patchCustomElement = (id: string, patch: Partial<SlideDesignCustomElement>, options?: UpdatePlanOptions) => {
    updateCustomElements((items) => items.map((item) => (
      item.id === id ? normalizeCustomElement({ ...item, ...patch }) : item
    )), `编辑${selectedCustomElement ? customElementDisplayName(selectedCustomElement) : '组件'}`, options);
  };

  const selectCustomElement = (id: string, additive = false) => {
    if (additive) {
      const next = selectedCustomElementIds.includes(id)
        ? selectedCustomElementIds.filter((item) => item !== id)
        : [...selectedCustomElementIds, id];
      if (!next.length) {
        setElementSelection([selectedElementKey], selectedElementKey);
        setInspectTab('object');
        return;
      }
      setSelectedCustomElementIds(next);
      setSelectedCustomElementId(next.includes(id) ? id : next[0] || null);
    } else {
      setSelectedCustomElementIds([id]);
      setSelectedCustomElementId(id);
    }
    setSelectedElementKeys([]);
    setInspectTab('object');
  };

  const addToolboxItem = (item: DesignerToolboxItem, point?: { x: number; y: number }) => {
    if (!selectedSlide) {
      messageApi.warning('请先选择一页再插入组件');
      return;
    }
    const templates = toolboxItemElements(item);
    if (!templates.length) return;
    const timestamp = Date.now();
    const baseZ = Math.max(90, ...customElements.map((element) => Number(element.zIndex || 0)));
    let elements = templates.map((template, index) => {
      const defaults = CUSTOM_ELEMENT_DEFAULTS[template.type] || CUSTOM_ELEMENT_DEFAULTS.text;
      return normalizeCustomElement({
        ...defaults,
        ...template.patch,
        id: `custom-${template.type}-${timestamp}-${index}`,
        type: template.type,
        zIndex: baseZ + (index + 1) * 5,
      });
    });
    if (point) {
      const bounds = unionBoxes(elements.map((element) => styleBox(element)));
      const dx = point.x - bounds.centerX;
      const dy = point.y - bounds.centerY;
      elements = elements.map((element) => normalizeCustomElement({
        ...element,
        x: clampValue(Number(element.x || 0) + dx, -10, 106),
        y: clampValue(Number(element.y || 0) + dy, -10, 106),
      }));
    }
    updateCustomElements((items) => [...items, ...elements], `插入${item.label}`);
    const ids = elements.map((element) => element.id);
    setSelectedCustomElementIds(ids);
    setSelectedCustomElementId(ids[ids.length - 1] || ids[0] || null);
    setSelectedElementKeys([]);
    setInspectTab('object');
    setViewMode('design');
    messageApi.success(elements.length > 1 ? `已插入${item.label}（${elements.length} 个对象）` : `已插入${item.label}`);
  };

  const deleteCustomElement = (id: string) => {
    const target = customElements.find((item) => item.id === id);
    updateCustomElements((items) => items.filter((item) => item.id !== id), `删除${target ? customElementDisplayName(target) : '组件'}`);
    const next = selectedCustomElementIds.filter((item) => item !== id);
    setSelectedCustomElementIds(next);
    setSelectedCustomElementId(next[0] || null);
    if (!next.length) setElementSelection(['title'], 'title');
  };

  const updateSelectedSlideElements = (
    producer: (elements: Partial<Record<SlideDesignElementKey, SlideDesignElementStyle>>) => Partial<Record<SlideDesignElementKey, SlideDesignElementStyle>>,
    historyLabel: string,
    options?: UpdatePlanOptions,
  ) => {
    if (!selectedSlide) return;
    const current = slideDesignOf(selectedSlide);
    const baseElements = DESIGNER_ELEMENT_KEYS.reduce((acc, key) => {
      acc[key] = effectiveDesignElementStyle(key);
      return acc;
    }, {} as Partial<Record<SlideDesignElementKey, SlideDesignElementStyle>>);
    const nextElements = producer(baseElements);
    updateSlide(selectedSlide.id, {
      design: {
        ...current,
        mode: 'freeform',
        elements: nextElements,
      },
    }, { historyLabel, ...options });
  };

  const setLayerVisibility = (key: SlideDesignElementKey, visible: boolean) => {
    updateSelectedElementStyle(key, { visible }, { historyLabel: `${visible ? '显示' : '隐藏'}${DESIGNER_ELEMENT_LABEL[key]}` });
  };

  const setLayerLocked = (key: SlideDesignElementKey, locked: boolean) => {
    updateSelectedElementStyle(key, { locked }, { historyLabel: `${locked ? '锁定' : '解锁'}${DESIGNER_ELEMENT_LABEL[key]}` });
  };

  const renameLayer = (key: SlideDesignElementKey, name: string) => {
    const trimmed = name.trim();
    updateSelectedElementStyle(key, { name: trimmed || undefined }, { historyLabel: `重命名${DESIGNER_ELEMENT_LABEL[key]}` });
  };

  const moveLayer = (key: SlideDesignElementKey, direction: 1 | -1) => {
    const ascending = [...designLayers].sort((a, b) => Number(a.style.zIndex || 0) - Number(b.style.zIndex || 0));
    const index = ascending.findIndex((item) => item.key === key);
    const swapIndex = index + direction;
    if (index < 0 || swapIndex < 0 || swapIndex >= ascending.length) return;
    const next = [...ascending];
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
    updateSelectedSlideElements((elements) => {
      next.forEach((item, itemIndex) => {
        elements[item.key] = {
          ...normalizeDesignElementStyle(item.key, elements[item.key]),
          zIndex: (itemIndex + 1) * 10,
        };
      });
      return elements;
    }, direction > 0 ? '上移图层' : '下移图层');
  };

  const patchCustomElements = (
    ids: string[],
    producer: (item: SlideDesignCustomElement) => Partial<SlideDesignCustomElement>,
    historyLabel: string,
    options?: UpdatePlanOptions,
  ) => {
    const idSet = new Set(ids);
    updateCustomElements((items) => items.map((item) => {
      if (!idSet.has(item.id)) return item;
      return normalizeCustomElement({ ...item, ...producer(item) });
    }), historyLabel, options);
  };

  const editableSelectionKeys = (keys: SlideDesignElementKey[] = activeSelectionKeys) => (
    keys.filter((key) => {
      const styleValue = effectiveDesignElementStyle(key);
      return styleValue.visible !== false && styleValue.locked !== true;
    })
  );

  const editableCustomSelection = () => (
    selectedCustomElements.filter((element) => element.visible !== false && element.locked !== true)
  );

  const hasEditableSelection = () => editableSelectionKeys().length > 0 || editableCustomSelection().length > 0;

  const alignSelectedCustomElements = (target: DesignerAlignTarget) => {
    const elements = editableCustomSelection();
    if (!elements.length) {
      messageApi.info('选中组件已锁定或隐藏，解锁/显示后才能对齐');
      return;
    }
    if (elements.length === 1) {
      const element = elements[0];
      const patch: Partial<SlideDesignCustomElement> = {};
      if (target === 'left') patch.x = 8;
      if (target === 'center') patch.x = clampValue(50 - Number(element.width || 0) / 2, -20, 120);
      if (target === 'right') patch.x = clampValue(92 - Number(element.width || 0), -20, 120);
      if (target === 'top') patch.y = 8;
      if (target === 'middle') patch.y = clampValue(50 - Number(element.height || 0) / 2, -20, 120);
      if (target === 'bottom') patch.y = clampValue(92 - Number(element.height || 0), -20, 120);
      patchCustomElement(element.id, patch, { historyLabel: `对齐${customElementDisplayName(element)}` });
      return;
    }
    const bounds = unionBoxes(elements.map((element) => styleBox(element)));
    const ids = elements.map((element) => element.id);
    patchCustomElements(ids, (element) => {
      const box = styleBox(element);
      const patch: Partial<SlideDesignCustomElement> = {};
      if (target === 'left') patch.x = bounds.left;
      if (target === 'center') patch.x = bounds.centerX - box.width / 2;
      if (target === 'right') patch.x = bounds.right - box.width;
      if (target === 'top') patch.y = bounds.top;
      if (target === 'middle') patch.y = bounds.centerY - box.height / 2;
      if (target === 'bottom') patch.y = bounds.bottom - box.height;
      return {
        x: patch.x === undefined ? element.x : clampValue(patch.x, -20, 120),
        y: patch.y === undefined ? element.y : clampValue(patch.y, -20, 120),
      };
    }, `对齐 ${elements.length} 个组件`);
  };

  const alignSelectedElements = (target: DesignerAlignTarget) => {
    if (selectedCustomElements.length) {
      alignSelectedCustomElements(target);
      return;
    }
    const keys = editableSelectionKeys();
    if (!keys.length) {
      messageApi.info('选中对象已锁定或隐藏，解锁/显示后才能对齐');
      return;
    }
    if (keys.length === 1) {
      const key = keys[0];
      const styleValue = effectiveDesignElementStyle(key);
      const patch: Partial<SlideDesignElementStyle> = {};
      if (target === 'left') patch.x = 8;
      if (target === 'center') patch.x = clampValue(50 - Number(styleValue.width || 0) / 2, -20, 120);
      if (target === 'right') patch.x = clampValue(92 - Number(styleValue.width || 0), -20, 120);
      if (target === 'top') patch.y = 8;
      if (target === 'middle') patch.y = clampValue(50 - Number(styleValue.height || 0) / 2, -20, 120);
      if (target === 'bottom') patch.y = clampValue(92 - Number(styleValue.height || 0), -20, 120);
      updateSelectedElementStyle(key, patch, { historyLabel: `对齐${designerLayerName(key, styleValue)}` });
      return;
    }
    const boxes = keys.map((key) => styleBox(effectiveDesignElementStyle(key)));
    const bounds = unionBoxes(boxes);
    updateSelectedSlideElements((elements) => {
      keys.forEach((key) => {
        const styleValue = normalizeDesignElementStyle(key, elements[key]);
        const box = styleBox(styleValue);
        const patch: Partial<SlideDesignElementStyle> = {};
        if (target === 'left') patch.x = bounds.left;
        if (target === 'center') patch.x = bounds.centerX - box.width / 2;
        if (target === 'right') patch.x = bounds.right - box.width;
        if (target === 'top') patch.y = bounds.top;
        if (target === 'middle') patch.y = bounds.centerY - box.height / 2;
        if (target === 'bottom') patch.y = bounds.bottom - box.height;
        elements[key] = {
          ...styleValue,
          x: patch.x === undefined ? styleValue.x : clampValue(patch.x, -20, 120),
          y: patch.y === undefined ? styleValue.y : clampValue(patch.y, -20, 120),
        };
      });
      return elements;
    }, `对齐 ${keys.length} 个对象`);
  };

  const distributeCustomElements = (axis: DesignerDistributeAxis) => {
    const candidates = editableCustomSelection();
    if (candidates.length < 3) {
      messageApi.info('至少需要 3 个未锁定且可见组件才能分布');
      return;
    }
    const sorted = [...candidates].sort((a, b) => axis === 'horizontal'
      ? Number(a.x || 0) - Number(b.x || 0)
      : Number(a.y || 0) - Number(b.y || 0));
    const ids = sorted.map((element) => element.id);
    const nextPositions = new Map<string, Partial<SlideDesignCustomElement>>();
    if (axis === 'horizontal') {
      const left = Math.min(...sorted.map((element) => Number(element.x || 0)));
      const right = Math.max(...sorted.map((element) => Number(element.x || 0) + Number(element.width || 0)));
      const total = sorted.reduce((sum, element) => sum + Number(element.width || 0), 0);
      const gap = (right - left - total) / Math.max(sorted.length - 1, 1);
      let cursor = left;
      sorted.forEach((element) => {
        nextPositions.set(element.id, { x: clampValue(cursor, -20, 120) });
        cursor += Number(element.width || 0) + gap;
      });
    } else {
      const top = Math.min(...sorted.map((element) => Number(element.y || 0)));
      const bottom = Math.max(...sorted.map((element) => Number(element.y || 0) + Number(element.height || 0)));
      const total = sorted.reduce((sum, element) => sum + Number(element.height || 0), 0);
      const gap = (bottom - top - total) / Math.max(sorted.length - 1, 1);
      let cursor = top;
      sorted.forEach((element) => {
        nextPositions.set(element.id, { y: clampValue(cursor, -20, 120) });
        cursor += Number(element.height || 0) + gap;
      });
    }
    patchCustomElements(ids, (element) => nextPositions.get(element.id) || {}, axis === 'horizontal' ? '水平分布组件' : '垂直分布组件');
  };

  const distributeElements = (axis: DesignerDistributeAxis) => {
    if (selectedCustomElements.length) {
      distributeCustomElements(axis);
      return;
    }
    const selectedCandidates = editableSelectionKeys();
    const sourceKeys = selectedCandidates.length >= 3 ? selectedCandidates : DESIGNER_ELEMENT_KEYS;
    const candidates = sourceKeys
      .map((key) => ({
        key,
        style: effectiveDesignElementStyle(key),
      }))
      .filter((item) => item.style.visible !== false && item.style.locked !== true);
    if (candidates.length < 3) {
      messageApi.info('至少需要 3 个未锁定且可见对象才能分布');
      return;
    }
    const sorted = candidates.sort((a, b) => axis === 'horizontal'
      ? Number(a.style.x || 0) - Number(b.style.x || 0)
      : Number(a.style.y || 0) - Number(b.style.y || 0));
    updateSelectedSlideElements((elements) => {
      if (axis === 'horizontal') {
        const left = Math.min(...sorted.map((item) => Number(item.style.x || 0)));
        const right = Math.max(...sorted.map((item) => Number(item.style.x || 0) + Number(item.style.width || 0)));
        const total = sorted.reduce((sum, item) => sum + Number(item.style.width || 0), 0);
        const gap = (right - left - total) / Math.max(sorted.length - 1, 1);
        let cursor = left;
        sorted.forEach((item) => {
          elements[item.key] = { ...normalizeDesignElementStyle(item.key, elements[item.key]), x: clampValue(cursor, -20, 120) };
          cursor += Number(item.style.width || 0) + gap;
        });
      } else {
        const top = Math.min(...sorted.map((item) => Number(item.style.y || 0)));
        const bottom = Math.max(...sorted.map((item) => Number(item.style.y || 0) + Number(item.style.height || 0)));
        const total = sorted.reduce((sum, item) => sum + Number(item.style.height || 0), 0);
        const gap = (bottom - top - total) / Math.max(sorted.length - 1, 1);
        let cursor = top;
        sorted.forEach((item) => {
          elements[item.key] = { ...normalizeDesignElementStyle(item.key, elements[item.key]), y: clampValue(cursor, -20, 120) };
          cursor += Number(item.style.height || 0) + gap;
        });
      }
      return elements;
    }, axis === 'horizontal' ? '水平分布对象' : '垂直分布对象');
  };

  const updateSelectedMedia = (patch: { url?: string; alt?: string; fit?: SlideDesignMediaFit }, options?: UpdatePlanOptions) => {
    if (!selectedSlide) return;
    const current = slideDesignOf(selectedSlide);
    const media = current.media?.[0] || {
      id: `media-${Date.now()}`,
      type: 'image' as const,
      url: '',
      alt: selectedSlide.visual || selectedSlide.title,
      fit: 'cover' as const,
    };
    updateSlide(selectedSlide.id, {
      design: {
        ...current,
        mode: 'freeform',
        media: [{ ...media, ...patch }],
        elements: anchoredDesignElements({
          visual: effectiveDesignElementStyle('visual'),
        }),
      },
    }, { historyLabel: '更新图片素材', ...options });
    setSelectedElementKey('visual');
    setInspectTab('visual');
    setViewMode('design');
  };

  const updateSelectedVisualSpec = (patch: Partial<SlideVisualSpec>) => {
    if (!selectedSlide) return;
    const base = visualSpecOfSlide(selectedSlide);
    updateSlide(selectedSlide.id, { visualSpec: { ...base, ...patch } });
  };

  const setSelectedVisualType = (type: VisualSpecType) => {
    if (!selectedSlide) return;
    const chart = chartKindFromVisualType(type);
    const base = visualSpecOfSlide(selectedSlide);
    const nextSpec: SlideVisualSpec = {
      ...base,
      type,
      chart: type === 'generic' || type === 'matrix' || type === 'architecture'
        ? base.chart
        : {
            ...base.chart,
            kind: chart,
            labels: base.chart?.labels?.length ? base.chart.labels : selectedMetrics.map((item) => String(item.label || item.title || '指标')),
            series: base.chart?.series?.length ? base.chart.series : [{
              name: '当前值',
              values: selectedMetrics.map((item) => Number(String(item.value ?? '').replace(/[^\d.+-]/g, ''))).filter(Number.isFinite),
              unit: '',
            }],
          },
      columns: type === 'matrix' ? (base.columns?.length ? base.columns : inferMatrixColumns(selectedSlide)) : base.columns,
      layers: type === 'architecture' ? (base.layers?.length ? base.layers : inferArchitectureLayers(selectedSlide)) : base.layers,
      metrics: ['scorecard', 'bar', 'line', 'combo_metrics'].includes(type) ? selectedMetrics : base.metrics,
    };
    updateSlide(selectedSlide.id, {
      layout: visualTypeToLayout(type),
      visual: selectedSlide.visual || VISUAL_TEMPLATE_LABEL[type] || '自定义可视化',
      renderHints: type === 'generic' || type === 'matrix' || type === 'architecture'
        ? selectedSlide.renderHints
        : withChartHint(selectedSlide.renderHints, chart),
      visualSpec: nextSpec,
    });
  };

  const updateChartKind = (kind: DataChartKind) => {
    if (!selectedSlide) return;
    updateSlide(selectedSlide.id, {
      layout: 'metrics',
      renderHints: withChartHint(selectedSlide.renderHints, kind),
      visual: selectedSlide.visual || DATA_CHART_LABEL[kind],
      visualSpec: {
        ...visualSpecOfSlide(selectedSlide),
        type: kind,
        chart: {
          ...visualSpecOfSlide(selectedSlide).chart,
          kind,
        },
        metrics: selectedMetrics,
      },
    });
  };

  const updateChartSeries = (nextSeries: ChartSeries) => {
    updateSelectedVisualSpec({
      chart: {
        ...selectedVisualSpec?.chart,
        kind: chartKind,
        labels: chartLabels,
        series: nextSeries,
      },
    });
  };

  const updateChartMeta = (patch: Partial<VisualSpecChart>) => {
    updateSelectedVisualSpec({
      chart: {
        ...selectedVisualSpec?.chart,
        kind: chartKind,
        labels: chartLabels,
        series: chartSeries,
        ...patch,
      },
    });
  };

  const patchChartSeries = (index: number, patch: ChartSeriesItem) => {
    const nextSeries = chartSeries.map((series, itemIndex) => itemIndex === index ? { ...series, ...patch } : series);
    updateChartSeries(nextSeries);
  };

  const addChartSeries = () => {
    updateChartSeries([
      ...chartSeries,
      {
        name: `序列 ${chartSeries.length + 1}`,
        values: chartLabels.map(() => 0),
        unit: chartSeries[0]?.unit || '',
      },
    ]);
  };

  const removeChartSeries = (index: number) => {
    updateChartSeries(chartSeries.filter((_, itemIndex) => itemIndex !== index));
  };

  const updateVisualSpecItems = (field: VisualSpecItemField, nextItems: VisualSpecItem[]) => {
    if (!selectedSlide) return;
    const nextSpec: SlideVisualSpec = { ...visualSpecOfSlide(selectedSlide), [field]: nextItems };
    const patch: Partial<DeckSlide> = { visualSpec: nextSpec };
    if (field === 'rows' && isFlowLayout(selectedSlide.layout)) {
      patch.bullets = nextItems.map((item, index) => flowRowToBullet(item, index, selectedSlide.layout)).filter(Boolean);
    }
    updateSlide(selectedSlide.id, patch);
  };

  const patchVisualSpecItem = (field: VisualSpecItemField, items: VisualSpecItem[], index: number, patch: VisualSpecItem) => {
    updateVisualSpecItems(field, items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  };

  const addVisualSpecItem = (field: VisualSpecItemField, items: VisualSpecItem[]) => {
    if (!selectedSlide) return;
    const defaults: Record<VisualSpecItemField, VisualSpecItem> = {
      columns: { label: `对象 ${items.length + 1}`, items: ['补充能力点'], score: 'medium' },
      layers: { label: `层级 ${items.length + 1}`, detail: '补充该层职责、输入输出和关键组件。' },
      rows: { label: flowRowLabel(selectedSlide.layout, items.length), detail: '补充节点动作、时间点或责任人。' },
    };
    updateVisualSpecItems(field, [...items, defaults[field]]);
  };

  const removeVisualSpecItem = (field: VisualSpecItemField, items: VisualSpecItem[], index: number) => {
    updateVisualSpecItems(field, items.filter((_, itemIndex) => itemIndex !== index));
  };

  const updateSelectedBullets = (bullets: string[]) => {
    if (!selectedSlide || !isFlowLayout(selectedSlide.layout)) {
      updateSelectedSlide({ bullets });
      return;
    }
    const baseRows = flowRows.length ? flowRows : [];
    const rows = bullets.map((item, index) => ({
      ...(baseRows[index] || {}),
      label: baseRows[index]?.label || flowRowLabel(selectedSlide.layout, index),
      detail: item,
    }));
    updateSlide(selectedSlide.id, {
      bullets,
      visualSpec: { ...visualSpecOfSlide(selectedSlide), rows },
    });
  };

  const addSlide = () => {
    if (!plan) return;
    const next = makeSlide(plan, selectedSlide);
    updatePlan((prev) => {
      const afterIndex = selectedSlide ? selectedSlide.index : prev.slides.length;
      return {
        ...prev,
        slides: renumberSlides([
          ...prev.slides.slice(0, afterIndex),
          next,
          ...prev.slides.slice(afterIndex),
        ]),
      };
    });
    setSelectedSlideId(next.id);
    setElementSelection(['title'], 'title');
  };

  const duplicateSlide = () => {
    if (!selectedSlide || !plan) return;
    const duplicated = cloneSlide(selectedSlide, `slide-${Date.now()}`);
    updatePlan((prev) => ({
      ...prev,
      slides: renumberSlides([
        ...prev.slides.slice(0, selectedSlide.index),
        duplicated,
        ...prev.slides.slice(selectedSlide.index),
      ]),
    }));
    setSelectedSlideId(duplicated.id);
    setElementSelection(['title'], 'title');
  };

  const deleteSlide = () => {
    if (!selectedSlide || !plan) return;
    if (plan.slides.length <= 1) {
      messageApi.warning('至少需要保留一页');
      return;
    }
    modalApi.confirm({
      title: '删除当前页面？',
      content: `将删除「${selectedSlide.title}」并重新编号。`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => {
        const removedIndex = selectedSlide.index - 1;
        updatePlan((prev) => {
          const slides = renumberSlides(prev.slides.filter((slide) => slide.id !== selectedSlide.id));
          window.setTimeout(() => setSelectedSlideId(slides[Math.max(0, removedIndex - 1)]?.id || slides[0]?.id || null), 0);
          return { ...prev, slides };
        });
      },
    });
  };

  const moveSlide = (sourceId: string, targetId: string) => {
    if (!plan || sourceId === targetId) return;
    updatePlan((prev) => {
      const sourceIndex = prev.slides.findIndex((slide) => slide.id === sourceId);
      const targetIndex = prev.slides.findIndex((slide) => slide.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0) return prev;
      const slides = [...prev.slides];
      const [source] = slides.splice(sourceIndex, 1);
      slides.splice(targetIndex, 0, source);
      return { ...prev, slides: renumberSlides(slides) };
    });
  };

  const saveVersion = async (summary = 'Designer 手动保存') => {
    if (!plan || !config) return;
    setSaving(true);
    try {
      const saved = await OPENATLAS_AIPPT_STORAGE_ADAPTER.saveSnapshot(deckId, {
        query,
        config,
        plan,
        status: 'outline_review',
        change_summary: summary,
      });
      const nextPlan = saved.plan ? normalizePlanLayouts(saved.plan as DeckPlan, saved.config as DeckConfig) : plan;
      setConfig(saved.config as DeckConfig);
      setPlan(nextPlan);
      setDirty(false);
      await loadVersions();
      if (schemaErrorCount || schemaWarningCount) {
        messageApi.warning(`已保存，但仍有 ${schemaErrorCount + schemaWarningCount} 条 Schema 质量提醒`);
      } else {
        messageApi.success(saved.version ? `已保存 v${saved.version.version_no}` : '已保存 Designer 版本');
      }
    } catch (err: any) {
      messageApi.error(err?.message || '保存版本失败');
    } finally {
      setSaving(false);
    }
  };

  const restoreVersion = async (version: AipptDeckVersion) => {
    modalApi.confirm({
      title: `回退到 v${version.version_no}？`,
      content: '当前草稿会先被服务端保存为一次回退记录，方便再次恢复。',
      okText: '回退',
      cancelText: '取消',
      onOk: async () => {
        try {
          const restored = await OPENATLAS_AIPPT_STORAGE_ADAPTER.restoreVersion(deckId, version.id);
          const nextConfig = restored.config as DeckConfig;
          const nextPlan = restored.plan ? normalizePlanLayouts(restored.plan as DeckPlan, nextConfig) : null;
          setConfig(nextConfig);
          setPlan(nextPlan);
          setSelectedSlideId(nextPlan?.slides[0]?.id || null);
          setSelectedCustomElementId(null);
          setSelectedCustomElementIds([]);
          setPendingPatch(null);
          setLastAppliedPatch(null);
          setDirty(false);
          await loadVersions();
          messageApi.success(`已回退到 v${version.version_no}`);
        } catch (err: any) {
          messageApi.error(err?.message || '回退版本失败');
        }
      },
    });
  };

  const runSlideAction = async (action: SlideAction) => {
    if (!selectedSlide || !plan || !config) return;
    if (activePendingPatch) {
      messageApi.warning('请先应用或放弃当前 AI 补丁');
      return;
    }
    setActionLoading(action);
    try {
      const nextConfig = action === 'roadshow_style'
        ? { ...config, useCase: 'roadshow' as const, styleKey: 'tech_launch' as const, chartLevel: config.chartLevel === 'light' ? 'balanced' as const : config.chartLevel }
        : config;
      const result = await OPENATLAS_AIPPT_AGENT_ADAPTER.runSlideAction(deckId, {
        action,
        instruction: actionLabel(action),
        config: nextConfig,
        plan,
        slide: selectedSlide,
      });
      const patch = result.slide_patch as Partial<DeckSlide>;
      const mergedSlide = mergeSlidePatch(selectedSlide, patch);
      const diffItems = buildSlideDiffItems(selectedSlide, mergedSlide);
      setPendingPatch({
        id: result.id,
        action,
        slideId: selectedSlide.id,
        originalSlide: selectedSlide,
        patch,
        mergedSlide,
        previewConfig: nextConfig,
        rationale: result.rationale || `${actionLabel(action)}已生成 schema 补丁。`,
        warnings: result.warnings || [],
        diffItems,
        quality: result.quality,
        source: result.source,
        generatedAt: result.generated_at,
      });
      messageApi.success(diffItems.length ? 'AI 补丁已生成，请审阅后应用' : 'AI 已返回补丁，但未检测到明显字段变化');
    } catch (err: any) {
      messageApi.error(err?.message || `${actionLabel(action)}失败`);
    } finally {
      setActionLoading(null);
    }
  };

  const applyPendingPatch = () => {
    if (!activePendingPatch || !config) return;
    setLastAppliedPatch({
      id: activePendingPatch.id,
      action: activePendingPatch.action,
      slideId: activePendingPatch.slideId,
      previousSlide: activePendingPatch.originalSlide,
      nextSlide: activePendingPatch.mergedSlide,
      previousConfig: config,
      nextConfig: activePendingPatch.previewConfig,
      diffItems: activePendingPatch.diffItems,
      appliedAt: new Date().toISOString(),
    });
    if (activePendingPatch.action === 'roadshow_style') {
      setConfig(activePendingPatch.previewConfig);
    }
    updateSlide(activePendingPatch.slideId, activePendingPatch.patch, { clearUndo: false });
    messageApi.success(`${actionLabel(activePendingPatch.action)}已应用到当前页`);
  };

  const discardPendingPatch = () => {
    if (!activePendingPatch) return;
    setPendingPatch(null);
    messageApi.info('已放弃当前 AI 补丁');
  };

  const undoAppliedPatch = () => {
    if (!activeAppliedPatch) return;
    setConfig(activeAppliedPatch.previousConfig);
    updateSlide(activeAppliedPatch.slideId, activeAppliedPatch.previousSlide, { clearUndo: false });
    setSelectedSlideId(activeAppliedPatch.slideId);
    setLastAppliedPatch(null);
    messageApi.success(`已撤销「${actionLabel(activeAppliedPatch.action)}」`);
  };

  const downloadHtml = () => {
    if (!plan || !htmlDeck) return;
    downloadText(htmlDeck, `${safeFileTitle(plan.title)}.html`);
  };

  const downloadPptx = async () => {
    if (!plan || !config) return;
    setExportingPptx(true);
    try {
      const blob = await downloadPresentationDeckPptx(deckId, {
        query,
        config,
        plan,
        status: 'outline_review',
        change_summary: '导出可编辑 PPTX',
      });
      downloadBlob(blob, `${safeFileTitle(plan.title || config.topic)}.pptx`);
      messageApi.success('已导出可编辑 PPTX，文本、图片和基础图表可继续在 PowerPoint 中修改');
    } catch (err: any) {
      messageApi.error(err?.message || '导出 PPTX 失败');
    } finally {
      setExportingPptx(false);
    }
  };

  const validatePptxCompatibility = async () => {
    if (!plan || !config) return;
    setValidatingPptx(true);
    try {
      const report = await validatePresentationDeckPptx(deckId, {
        query,
        config,
        plan,
        status: 'outline_review',
        change_summary: 'PPTX Office/WPS 兼容性检查',
      });
      modalApi.info({
        title: report.ok ? 'PPTX 结构兼容性检查通过' : 'PPTX 结构兼容性检查发现问题',
        width: 620,
        okText: '知道了',
        content: (
          <div className="presentation-designer-compat-report" data-testid="aippt-pptx-compat-report">
            <p>{report.compatibility_scope || '结构级自动检查。'}</p>
            <div>
              {(report.checks || []).map((check) => (
                <article className={check.ok ? 'is-ok' : check.severity === 'warning' ? 'is-warning' : 'is-error'} key={check.key}>
                  <b>{check.ok ? '通过' : check.severity === 'warning' ? '提醒' : '失败'}</b>
                  <span>{check.detail}</span>
                </article>
              ))}
            </div>
          </div>
        ),
      });
      if (report.ok) messageApi.success('PPTX 结构兼容性检查通过');
      else messageApi.error('PPTX 结构兼容性检查发现错误');
    } catch (err: any) {
      messageApi.error(err?.message || 'PPTX 兼容性检查失败');
    } finally {
      setValidatingPptx(false);
    }
  };

  const importImageDataUrl = (url: string, alt: string, historyLabel = '粘贴图片素材') => {
    if (!selectedSlide) {
      messageApi.warning('请先选择一页再插入素材');
      return;
    }
    if (selectedCustomElement && selectedCustomElement.type === 'image') {
      if (selectedCustomElement.locked) {
        messageApi.info('当前图片组件已锁定，解锁后才能替换素材');
        return;
      }
      patchCustomElement(selectedCustomElement.id, { url, alt, fit: selectedCustomElement.fit || 'cover' }, { historyLabel });
      setInspectTab('object');
      setViewMode('design');
      messageApi.success('已替换当前图片组件素材');
      return;
    }
    const visualStyle = effectiveDesignElementStyle('visual');
    if (visualStyle.locked) {
      messageApi.info('图片/视觉区已锁定，解锁后才能替换素材');
      return;
    }
    updateSelectedMedia({ url, alt, fit: selectedMedia?.fit || 'cover' }, { historyLabel });
    messageApi.success('已替换当前页视觉区素材');
  };

  const importImageFile = async (file: File, historyLabel = '上传图片素材') => {
    if (!isSupportedImageFile(file)) {
      messageApi.warning('仅支持 PNG、JPG、WebP、GIF、SVG 图片素材');
      return false;
    }
    try {
      const url = await fileToDataUrl(file);
      importImageDataUrl(url, filenameForImage(file, selectedSlide?.title || '图片素材'), historyLabel);
      return true;
    } catch (err: any) {
      messageApi.error(err?.message || '读取图片素材失败');
      return false;
    }
  };

  const importFirstImageFile = async (files: File[], historyLabel = '上传图片素材') => {
    const file = files.find(isSupportedImageFile);
    if (!file) {
      messageApi.warning('没有识别到可用图片素材');
      return false;
    }
    return importImageFile(file, historyLabel);
  };

  const duplicateSelectedObjects = () => {
    if (!selectedSlide) return;
    const timestamp = Date.now();
    const baseZ = Math.max(90, ...customElements.map((element) => Number(element.zIndex || 0)));
    const sourceElements = selectedCustomElements.length
      ? selectedCustomElements
      : selectedElementKeys
        .map(customElementFromSlideElement)
        .filter((element): element is SlideDesignCustomElement => !!element);
    if (!sourceElements.length) {
      messageApi.info('请先选择要复制的对象');
      return;
    }
    const duplicated = sourceElements.map((element, index) => normalizeCustomElement({
      ...element,
      id: `custom-${element.type}-${timestamp}-${index}`,
      name: `${customElementDisplayName(element)} 副本`,
      x: clampValue(Number(element.x || 0) + 3, -10, 106),
      y: clampValue(Number(element.y || 0) + 3, -10, 106),
      zIndex: baseZ + (index + 1) * 5,
      locked: false,
    }));
    updateCustomElements((items) => [...items, ...duplicated], `复制 ${duplicated.length} 个对象`);
    const ids = duplicated.map((element) => element.id);
    setSelectedCustomElementIds(ids);
    setSelectedCustomElementId(ids[ids.length - 1] || ids[0] || null);
    setSelectedElementKeys([]);
    setInspectTab('object');
    setViewMode('design');
    messageApi.success(`已复制 ${duplicated.length} 个对象到当前页`);
  };

  const deleteSelectedObjects = () => {
    if (selectedCustomElements.length) {
      const ids = new Set(selectedCustomElements.map((element) => element.id));
      updateCustomElements((items) => items.filter((item) => !ids.has(item.id)), `删除 ${ids.size} 个组件`);
      setSelectedCustomElementIds([]);
      setSelectedCustomElementId(null);
      setElementSelection(['title'], 'title');
      messageApi.success(`已删除 ${ids.size} 个组件`);
      return;
    }
    const keys = editableSelectionKeys();
    if (!keys.length) {
      messageApi.info('选中对象已锁定，解锁后才能隐藏');
      return;
    }
    updateSelectedSlideElements((elements) => {
      keys.forEach((key) => {
        elements[key] = { ...normalizeDesignElementStyle(key, elements[key]), visible: false };
      });
      return elements;
    }, keys.length > 1 ? `隐藏 ${keys.length} 个对象` : `隐藏${DESIGNER_ELEMENT_LABEL[keys[0]]}`);
    messageApi.success(keys.length > 1 ? `已隐藏 ${keys.length} 个对象` : `已隐藏${DESIGNER_ELEMENT_LABEL[keys[0]]}`);
  };

  const beginSelectedObjectEdit = () => {
    if (selectedCustomElementStyle) {
      beginInlineCustomEdit(selectedCustomElementStyle);
      return;
    }
    beginInlineSlideEdit(selectedElementKey);
  };

  const replaceSelectedImageAsset = () => {
    if (selectedCustomElementStyle?.type === 'image') {
      selectCustomElement(selectedCustomElementStyle.id);
      setInspectTab('object');
    } else {
      selectDesignElement('visual', false, 'visual');
    }
    setViewMode('design');
    imageInputRef.current?.click();
  };

  const nudgeSelectedObjects = (dx: number, dy: number) => {
    if (selectedCustomElements.length) {
      const elements = editableCustomSelection();
      if (!elements.length) {
        messageApi.info('选中组件已锁定或隐藏，解锁/显示后才能移动');
        return;
      }
      const ids = elements.map((element) => element.id);
      patchCustomElements(ids, (element) => ({
        x: clampValue(Number(element.x || 0) + dx, -20, 120),
        y: clampValue(Number(element.y || 0) + dy, -20, 120),
      }), ids.length > 1 ? `键盘微调 ${ids.length} 个组件` : `键盘微调${customElementDisplayName(elements[0])}`);
      const movedBoxes = elements.map((element) => styleBox({
        ...element,
        x: clampValue(Number(element.x || 0) + dx, -20, 120),
        y: clampValue(Number(element.y || 0) + dy, -20, 120),
      }));
      setInteractionFeedback(geometryFeedback('drag', unionBoxes(movedBoxes), ids.length > 1 ? `键盘微调 ${ids.length} 个组件` : `键盘微调${customElementDisplayName(elements[0])}`));
      window.setTimeout(() => setInteractionFeedback(null), 360);
      return;
    }
    const keys = editableSelectionKeys();
    if (!keys.length) {
      messageApi.info('选中对象已锁定或隐藏，解锁/显示后才能移动');
      return;
    }
    const movedBoxes = keys.map((key) => {
      const value = effectiveDesignElementStyle(key);
      return styleBox({
        ...value,
        x: clampValue(Number(value.x || 0) + dx, -20, 120),
        y: clampValue(Number(value.y || 0) + dy, -20, 120),
      });
    });
    updateSelectedSlideElements((elements) => {
      keys.forEach((key) => {
        const value = normalizeDesignElementStyle(key, elements[key]);
        elements[key] = {
          ...value,
          x: clampValue(Number(value.x || 0) + dx, -20, 120),
          y: clampValue(Number(value.y || 0) + dy, -20, 120),
        };
      });
      return elements;
    }, keys.length > 1 ? `键盘微调 ${keys.length} 个对象` : `键盘微调${DESIGNER_ELEMENT_LABEL[keys[0]]}`);
    setInteractionFeedback(geometryFeedback('drag', unionBoxes(movedBoxes), keys.length > 1 ? `键盘微调 ${keys.length} 个对象` : `键盘微调${DESIGNER_ELEMENT_LABEL[keys[0]]}`));
    window.setTimeout(() => setInteractionFeedback(null), 360);
  };

  const handleImageInputChange = async (event: ChangeEvent<HTMLInputElement>) => {
    await importFirstImageFile(Array.from(event.target.files || []), '上传图片素材');
    event.target.value = '';
  };

  const customElementFromSlideElement = (key: SlideDesignElementKey): SlideDesignCustomElement | null => {
    if (!selectedSlide) return null;
    const base = effectiveDesignElementStyle(key);
    const basePatch = {
      id: `copied-${key}-${Date.now()}`,
      name: `${designerLayerName(key, base)} 副本`,
      x: Number(base.x || 0),
      y: Number(base.y || 0),
      width: Number(base.width || 0),
      height: Number(base.height || 0),
      zIndex: Number(base.zIndex || 80),
      fontSize: Number(base.fontSize || 18),
      color: base.color || '#111827',
      fontWeight: Number(base.fontWeight || 700),
      align: base.align || 'left',
      background: base.background || (key === 'visual' ? 'rgba(239,246,255,0.92)' : 'rgba(255,255,255,0.86)'),
      radius: Number(base.radius || (key === 'visual' ? 14 : 8)),
      visible: true,
      locked: false,
    };
    if (key === 'visual' && selectedMedia?.url) {
      return normalizeCustomElement({
        ...basePatch,
        type: 'image',
        url: selectedMedia.url,
        alt: selectedMedia.alt || selectedSlide.visual || selectedSlide.title,
        fit: selectedMedia.fit || 'cover',
      });
    }
    const sectionTitle = plan?.sections.find((section) => section.id === selectedSlide.sectionId)?.title || (config ? USE_CASE_LABEL[config.useCase] : '演示');
    const content = key === 'eyebrow'
      ? `${sectionTitle} · ${style?.name || 'AIPPT'}`
      : key === 'title'
        ? selectedSlide.title
        : key === 'headline'
          ? selectedSlide.headline
          : key === 'bullets'
            ? selectedSlide.bullets.join('\n')
            : selectedSlide.visual || selectedVisualSpec?.title || '图片/视觉区';
    return normalizeCustomElement({
      ...basePatch,
      type: 'text',
      content,
      zIndex: Number(base.zIndex || 80) + 100,
    });
  };

  const copySelectedSlide = () => {
    if (!selectedSlide) return;
    if (selectedCustomElements.length) {
      copiedCustomElementsRef.current = cloneValue(selectedCustomElements);
      copiedSlideRef.current = null;
      messageApi.success(`已复制 ${selectedCustomElements.length} 个组件`);
      return;
    }
    if (viewMode === 'design' && selectedElementKeys.length) {
      const copiedElements = selectedElementKeys
        .map(customElementFromSlideElement)
        .filter((element): element is SlideDesignCustomElement => !!element);
      if (copiedElements.length) {
        copiedCustomElementsRef.current = copiedElements;
        copiedSlideRef.current = null;
        messageApi.success(`已复制 ${copiedElements.length} 个对象`);
        return;
      }
    }
    copiedSlideRef.current = cloneValue(selectedSlide);
    copiedCustomElementsRef.current = [];
    messageApi.success(`已复制当前页：${selectedSlide.title}`);
  };

  const pasteCopiedCustomElements = () => {
    if (!copiedCustomElementsRef.current.length || !selectedSlide) return false;
    const timestamp = Date.now();
    const baseZ = Math.max(90, ...customElements.map((element) => Number(element.zIndex || 0)));
    const pasted = copiedCustomElementsRef.current.map((element, index) => normalizeCustomElement({
      ...element,
      id: `custom-${element.type}-${timestamp}-${index}`,
      name: `${customElementDisplayName(element)} 副本`,
      x: clampValue(Number(element.x || 0) + 3, -10, 106),
      y: clampValue(Number(element.y || 0) + 3, -10, 106),
      zIndex: baseZ + (index + 1) * 5,
      locked: false,
    }));
    updateCustomElements((items) => [...items, ...pasted], `粘贴 ${pasted.length} 个组件`);
    const ids = pasted.map((element) => element.id);
    setSelectedCustomElementIds(ids);
    setSelectedCustomElementId(ids[ids.length - 1] || ids[0] || null);
    setSelectedElementKeys([]);
    setInspectTab('object');
    setViewMode('design');
    messageApi.success(`已粘贴 ${pasted.length} 个组件`);
    return true;
  };

  const pasteCopiedSlide = () => {
    if (!copiedSlideRef.current || !plan) {
      messageApi.info('没有可粘贴的页面');
      return;
    }
    const duplicated = cloneSlide(copiedSlideRef.current, `slide-${Date.now()}`);
    updatePlan((prev) => {
      const selectedIndex = selectedSlide ? prev.slides.findIndex((slide) => slide.id === selectedSlide.id) : -1;
      const insertIndex = selectedIndex >= 0 ? selectedIndex + 1 : prev.slides.length;
      return {
        ...prev,
        slides: renumberSlides([
          ...prev.slides.slice(0, insertIndex),
          duplicated,
          ...prev.slides.slice(insertIndex),
        ]),
      };
    }, { historyLabel: '粘贴页面' });
    setSelectedSlideId(duplicated.id);
    messageApi.success(`已粘贴页面：${duplicated.title}`);
  };

  const openFullscreen = async () => {
    const target = previewRef.current || frameRef.current;
    if (!target?.requestFullscreen) {
      messageApi.warning('当前浏览器不支持全屏演示');
      return;
    }
    try {
      await target.requestFullscreen();
    } catch {
      messageApi.info('请先与页面交互后再进入全屏演示');
    }
  };

  const snapDragPositions = (
    movingKeys: SlideDesignElementKey[],
    proposed: Partial<Record<SlideDesignElementKey, { x: number; y: number }>>,
    initialStyles: Partial<Record<SlideDesignElementKey, SlideDesignElementStyle>>,
  ) => {
    const threshold = 1.15;
    const movingBoxes = movingKeys
      .map((key) => {
        const base = normalizeDesignElementStyle(key, initialStyles[key] || selectedDesign.elements?.[key]);
        const position = proposed[key] || { x: Number(base.x || 0), y: Number(base.y || 0) };
        return styleBox({ ...base, x: position.x, y: position.y });
      });
    if (!movingBoxes.length) return { proposed, guides: [] as DesignerGuide[] };
    const groupBox = unionBoxes(movingBoxes);
    const stationaryBoxes = DESIGNER_ELEMENT_KEYS
      .filter((key) => !movingKeys.includes(key))
      .map((key) => effectiveDesignElementStyle(key))
      .filter((item) => item.visible !== false)
      .map(styleBox);
    const verticalRefs = [
      { value: 0, label: '页边' },
      { value: 8, label: '安全边' },
      { value: 50, label: '画布中心' },
      { value: 92, label: '安全边' },
      { value: 100, label: '页边' },
      ...stationaryBoxes.flatMap((box) => [
        { value: box.left, label: '对象边界' },
        { value: box.centerX, label: '对象中心' },
        { value: box.right, label: '对象边界' },
      ]),
    ];
    const horizontalRefs = [
      { value: 0, label: '页边' },
      { value: 8, label: '安全边' },
      { value: 50, label: '画布中心' },
      { value: 92, label: '安全边' },
      { value: 100, label: '页边' },
      ...stationaryBoxes.flatMap((box) => [
        { value: box.top, label: '对象边界' },
        { value: box.centerY, label: '对象中心' },
        { value: box.bottom, label: '对象边界' },
      ]),
    ];
    type SnapMatch = { delta: number; value: number; label: string };
    const findSnap = (edges: Array<{ value: number; role: string }>, refs: Array<{ value: number; label: string }>): SnapMatch | null => {
      let best: SnapMatch | null = null;
      for (const edge of edges) {
        for (const ref of refs) {
          const delta = ref.value - edge.value;
          if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) {
            best = { delta, value: ref.value, label: ref.label || edge.role };
          }
        }
      }
      return best;
    };
    const xSnap = findSnap([
      { value: groupBox.left, role: '左' },
      { value: groupBox.centerX, role: '中' },
      { value: groupBox.right, role: '右' },
    ], verticalRefs);
    const ySnap = findSnap([
      { value: groupBox.top, role: '上' },
      { value: groupBox.centerY, role: '中' },
      { value: groupBox.bottom, role: '下' },
    ], horizontalRefs);
    const next = { ...proposed };
    movingKeys.forEach((key) => {
      const current = proposed[key];
      if (!current) return;
      next[key] = {
        x: clampValue(current.x + (xSnap?.delta || 0), -20, 120),
        y: clampValue(current.y + (ySnap?.delta || 0), -20, 120),
      };
    });
    const guides: DesignerGuide[] = [];
    if (xSnap) guides.push({ orientation: 'vertical', position: xSnap.value, label: xSnap.label });
    if (ySnap) guides.push({ orientation: 'horizontal', position: ySnap.value, label: ySnap.label });

    const snappedGroup = unionBoxes(movingKeys.map((key) => {
      const base = normalizeDesignElementStyle(key, initialStyles[key] || selectedDesign.elements?.[key]);
      const position = next[key] || { x: Number(base.x || 0), y: Number(base.y || 0) };
      return styleBox({ ...base, x: position.x, y: position.y });
    }));
    const leftNeighbor = stationaryBoxes
      .filter((box) => box.right <= snappedGroup.left)
      .sort((a, b) => b.right - a.right)[0];
    const rightNeighbor = stationaryBoxes
      .filter((box) => box.left >= snappedGroup.right)
      .sort((a, b) => a.left - b.left)[0];
    if (leftNeighbor && rightNeighbor) {
      const leftGap = snappedGroup.left - leftNeighbor.right;
      const rightGap = rightNeighbor.left - snappedGroup.right;
      if (Math.abs(leftGap - rightGap) <= threshold * 1.5) {
        guides.push({ orientation: 'vertical', position: snappedGroup.centerX, label: '水平等距' });
      }
    }
    const topNeighbor = stationaryBoxes
      .filter((box) => box.bottom <= snappedGroup.top)
      .sort((a, b) => b.bottom - a.bottom)[0];
    const bottomNeighbor = stationaryBoxes
      .filter((box) => box.top >= snappedGroup.bottom)
      .sort((a, b) => a.top - b.top)[0];
    if (topNeighbor && bottomNeighbor) {
      const topGap = snappedGroup.top - topNeighbor.bottom;
      const bottomGap = bottomNeighbor.top - snappedGroup.bottom;
      if (Math.abs(topGap - bottomGap) <= threshold * 1.5) {
        guides.push({ orientation: 'horizontal', position: snappedGroup.centerY, label: '垂直等距' });
      }
    }
    return { proposed: next, guides };
  };

  const startElementDrag = (key: SlideDesignElementKey, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      return;
    }
    const rect = artboardRef.current?.getBoundingClientRect();
    if (!rect) return;
    const style = effectiveDesignElementStyle(key);
    if (style.locked) {
      selectDesignElement(key, false, 'object');
      messageApi.info(`${DESIGNER_ELEMENT_LABEL[key]}已锁定，解锁后才能移动`);
      return;
    }
    const selection = selectedElementKeys.includes(key) ? selectedElementKeys : [key];
    const movableKeys = editableSelectionKeys(selection);
    if (!movableKeys.length) {
      messageApi.info('选中对象已锁定，解锁后才能移动');
      return;
    }
    pushHistory(movableKeys.length > 1 ? `移动 ${movableKeys.length} 个对象` : `移动${designerLayerName(key, style)}`);
    setElementSelection(selection, key);
    setInspectTab(inspectorTabForElement(key));
    setContextMenu(null);
    setSnapGuides([]);
    const initialStyles = movableKeys.reduce((acc, itemKey) => {
      acc[itemKey] = effectiveDesignElementStyle(itemKey);
      return acc;
    }, {} as Partial<Record<SlideDesignElementKey, SlideDesignElementStyle>>);
    setElementDrag({
      keys: movableKeys,
      startX: event.clientX,
      startY: event.clientY,
      origins: movableKeys.reduce((acc, itemKey) => {
        const itemStyle = effectiveDesignElementStyle(itemKey);
        acc[itemKey] = { x: Number(itemStyle.x || 0), y: Number(itemStyle.y || 0) };
        return acc;
      }, {} as Partial<Record<SlideDesignElementKey, { x: number; y: number }>>),
      initialStyles,
      rect,
    });
    setInteractionFeedback(geometryFeedback(
      'drag',
      unionBoxes(movableKeys.map((itemKey) => styleBox(effectiveDesignElementStyle(itemKey)))),
      movableKeys.length > 1 ? `移动 ${movableKeys.length} 个对象` : `移动${designerLayerName(key, style)}`,
    ));
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  const startCustomElementDrag = (element: SlideDesignCustomElement, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      return;
    }
    const rect = artboardRef.current?.getBoundingClientRect();
    if (!rect) return;
    const normalized = normalizeCustomElement(element);
    if (normalized.locked) {
      selectCustomElement(normalized.id);
      messageApi.info(`${customElementDisplayName(normalized)}已锁定，解锁后才能移动`);
      return;
    }
    const selection = selectedCustomElementIds.includes(normalized.id) ? selectedCustomElementIds : [normalized.id];
    const movableElements = customElements
      .map(normalizeCustomElement)
      .filter((item) => selection.includes(item.id) && item.visible !== false && item.locked !== true);
    if (!movableElements.length) {
      messageApi.info('选中组件已锁定，解锁后才能移动');
      return;
    }
    pushHistory(movableElements.length > 1 ? `移动 ${movableElements.length} 个组件` : `移动${customElementDisplayName(normalized)}`);
    if (!selectedCustomElementIds.includes(normalized.id)) selectCustomElement(normalized.id);
    else {
      setSelectedElementKeys([]);
      setSelectedCustomElementId(normalized.id);
      setInspectTab('object');
    }
    setContextMenu(null);
    setSnapGuides([]);
    setCustomElementDrag({
      ids: movableElements.map((item) => item.id),
      startX: event.clientX,
      startY: event.clientY,
      origins: movableElements.reduce((acc, item) => {
        acc[item.id] = { x: Number(item.x || 0), y: Number(item.y || 0) };
        return acc;
      }, {} as Record<string, { x: number; y: number }>),
      initialStyles: movableElements.reduce((acc, item) => {
        acc[item.id] = item;
        return acc;
      }, {} as Record<string, SlideDesignCustomElement>),
      rect,
    });
    setInteractionFeedback(geometryFeedback(
      'drag',
      unionBoxes(movableElements.map((item) => styleBox(item))),
      movableElements.length > 1 ? `移动 ${movableElements.length} 个组件` : `移动${customElementDisplayName(normalized)}`,
    ));
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  const startElementResize = (
    key: SlideDesignElementKey,
    handle: ResizeHandleKey,
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = artboardRef.current?.getBoundingClientRect();
    if (!rect) return;
    const styleValue = effectiveDesignElementStyle(key);
    if (styleValue.locked) {
      selectDesignElement(key, false, 'object');
      messageApi.info(`${DESIGNER_ELEMENT_LABEL[key]}已锁定，解锁后才能调整大小`);
      return;
    }
    pushHistory(`调整${designerLayerName(key, styleValue)}尺寸`);
    setElementSelection([key], key);
    setInspectTab('object');
    setElementDrag(null);
    setCustomElementDrag(null);
    setInlineEditTarget(null);
    setContextMenu(null);
    setSnapGuides([]);
    setResizeState({
      kind: 'slide',
      key,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      rect,
      original: resizeBoxFromStyle(styleValue),
    });
    setInteractionFeedback(geometryFeedback('resize', resizeBoxFromStyle(styleValue), `调整${designerLayerName(key, styleValue)}尺寸`));
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const startCustomElementResize = (
    element: SlideDesignCustomElement,
    handle: ResizeHandleKey,
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = artboardRef.current?.getBoundingClientRect();
    if (!rect) return;
    const normalized = normalizeCustomElement(element);
    if (normalized.locked) {
      selectCustomElement(normalized.id);
      messageApi.info(`${customElementDisplayName(normalized)}已锁定，解锁后才能调整大小`);
      return;
    }
    pushHistory(`调整${customElementDisplayName(normalized)}尺寸`);
    selectCustomElement(normalized.id);
    setElementDrag(null);
    setCustomElementDrag(null);
    setInlineEditTarget(null);
    setContextMenu(null);
    setSnapGuides([]);
    setResizeState({
      kind: 'custom',
      id: normalized.id,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      rect,
      original: resizeBoxFromStyle(normalized),
    });
    setInteractionFeedback(geometryFeedback('resize', resizeBoxFromStyle(normalized), `调整${customElementDisplayName(normalized)}尺寸`));
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const artboardPointFromEvent = (event: PointerEvent | ReactPointerEvent<HTMLElement>, rect: DOMRect) => ({
    x: clampValue(((event.clientX - rect.left) / rect.width) * 100, 0, 100),
    y: clampValue(((event.clientY - rect.top) / rect.height) * 100, 0, 100),
  });

  const artboardPointFromDragEvent = (event: ReactDragEvent<HTMLElement>, rect: DOMRect) => ({
    x: clampValue(((event.clientX - rect.left) / rect.width) * 100, 0, 100),
    y: clampValue(((event.clientY - rect.top) / rect.height) * 100, 0, 100),
  });

  const marqueeBox = (state: DesignerMarqueeState) => {
    const left = Math.min(state.startX, state.currentX);
    const top = Math.min(state.startY, state.currentY);
    const right = Math.max(state.startX, state.currentX);
    const bottom = Math.max(state.startY, state.currentY);
    return {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
      left,
      top,
      right,
      bottom,
      centerX: left + (right - left) / 2,
      centerY: top + (bottom - top) / 2,
    };
  };

  const startArtboardMarquee = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('.presentation-design-element')) return;
    const rect = artboardRef.current?.getBoundingClientRect();
    if (!rect) return;
    const point = artboardPointFromEvent(event, rect);
    setContextMenu(null);
    setSnapGuides([]);
    setMarquee({
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y,
      rect,
    });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  useEffect(() => {
    if (!marquee) return undefined;
    const handleMove = (event: PointerEvent) => {
      const point = artboardPointFromEvent(event, marquee.rect);
      setMarquee((prev) => prev ? { ...prev, currentX: point.x, currentY: point.y } : prev);
    };
    const handleUp = () => {
      const box = marqueeBox(marquee);
      if (box.width < 0.8 && box.height < 0.8) {
        setElementSelection([selectedElementKey], selectedElementKey);
        setMarquee(null);
        return;
      }
      const matches = designLayers
        .filter((layer) => layer.style.visible !== false && boxesIntersect(styleBox(layer.style), box))
        .map((layer) => layer.key);
      const customMatches = customLayers
        .filter((layer) => layer.visible !== false && boxesIntersect(styleBox(layer), box))
        .map((layer) => layer.id);
      if (customMatches.length) {
        setSelectedCustomElementIds(customMatches);
        setSelectedCustomElementId(customMatches[customMatches.length - 1] || customMatches[0] || null);
        setSelectedElementKeys([]);
        setInspectTab('object');
        messageApi.success(`已选中 ${customMatches.length} 个组件`);
      } else if (matches.length) {
        setElementSelection(matches, matches[0]);
        setInspectTab('object');
        messageApi.success(`已选中 ${matches.length} 个对象`);
      } else {
        setElementSelection([selectedElementKey], selectedElementKey);
      }
      setMarquee(null);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [marquee, designLayers, customLayers, selectedElementKey, messageApi]);

  const contextKeys = () => {
    if (contextMenu?.key && !selectedElementKeys.includes(contextMenu.key)) return [contextMenu.key];
    return selectedElementKeys.length ? selectedElementKeys : [selectedElementKey];
  };

  const openElementContextMenu = (key: SlideDesignElementKey, event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!selectedElementKeys.includes(key)) selectDesignElement(key, false, 'object');
    setContextMenu({ x: event.clientX, y: event.clientY, key });
  };

  const updateContextLayers = (
    producer: (elements: Partial<Record<SlideDesignElementKey, SlideDesignElementStyle>>, keys: SlideDesignElementKey[]) => void,
    historyLabel: string,
  ) => {
    const keys = contextKeys();
    updateSelectedSlideElements((elements) => {
      producer(elements, keys);
      return elements;
    }, historyLabel);
    setContextMenu(null);
  };

  const moveContextLayersToEdge = (edge: 'front' | 'back') => {
    updateContextLayers((elements, keys) => {
      const all = DESIGNER_ELEMENT_KEYS.map((key) => normalizeDesignElementStyle(key, elements[key]));
      const orderedKeys = [...keys].sort((a, b) => Number(normalizeDesignElementStyle(a, elements[a]).zIndex || 0) - Number(normalizeDesignElementStyle(b, elements[b]).zIndex || 0));
      const base = edge === 'front'
        ? Math.max(...all.map((item) => Number(item.zIndex || 0)), 0) + 10
        : Math.min(...all.map((item) => Number(item.zIndex || 0)), 0) - orderedKeys.length * 10;
      orderedKeys.forEach((key, index) => {
        elements[key] = {
          ...normalizeDesignElementStyle(key, elements[key]),
          zIndex: edge === 'front' ? base + index * 10 : base + index * 10,
        };
      });
    }, edge === 'front' ? '图层置顶' : '图层置底');
  };

  const toggleContextLayersLocked = () => {
    const keys = contextKeys();
    const nextLocked = !keys.every((key) => effectiveDesignElementStyle(key).locked === true);
    updateContextLayers((elements, layerKeys) => {
      layerKeys.forEach((key) => {
        elements[key] = { ...normalizeDesignElementStyle(key, elements[key]), locked: nextLocked };
      });
    }, nextLocked ? '锁定对象' : '解锁对象');
  };

  const toggleContextLayersVisible = () => {
    const keys = contextKeys();
    const nextVisible = !keys.every((key) => effectiveDesignElementStyle(key).visible !== false);
    updateContextLayers((elements, layerKeys) => {
      layerKeys.forEach((key) => {
        elements[key] = { ...normalizeDesignElementStyle(key, elements[key]), visible: nextVisible };
      });
    }, nextVisible ? '显示对象' : '隐藏对象');
  };

  const startContextRename = () => {
    const key = contextMenu?.key || selectedElementKey;
    selectDesignElement(key, false, 'object');
    setRenamingLayerKey(key);
    setContextMenu(null);
  };

  useEffect(() => {
    if (!contextMenu) return undefined;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!elementDrag) return undefined;
    const handleMove = (event: PointerEvent) => {
      const dx = ((event.clientX - elementDrag.startX) / elementDrag.rect.width) * 100;
      const dy = ((event.clientY - elementDrag.startY) / elementDrag.rect.height) * 100;
      const proposed = elementDrag.keys.reduce((acc, key) => {
        const origin = elementDrag.origins[key];
        if (origin) {
          acc[key] = {
            x: clampValue(origin.x + dx, -20, 120),
            y: clampValue(origin.y + dy, -20, 120),
          };
        }
        return acc;
      }, {} as Partial<Record<SlideDesignElementKey, { x: number; y: number }>>);
      const snapped = snapDragPositions(elementDrag.keys, proposed, elementDrag.initialStyles);
      setSnapGuides(snapped.guides);
      const feedbackBoxes = elementDrag.keys.map((key) => {
        const base = normalizeDesignElementStyle(key, elementDrag.initialStyles[key] || selectedDesign.elements?.[key]);
        const position = snapped.proposed[key] || { x: Number(base.x || 0), y: Number(base.y || 0) };
        return styleBox({ ...base, x: position.x, y: position.y });
      });
      if (feedbackBoxes.length) {
        setInteractionFeedback(geometryFeedback(
          'drag',
          unionBoxes(feedbackBoxes),
          elementDrag.keys.length > 1 ? `移动 ${elementDrag.keys.length} 个对象` : '移动对象',
        ));
      }
      updateSelectedSlideElements((elements) => {
        elementDrag.keys.forEach((key) => {
          const position = snapped.proposed[key];
          if (!position) return;
          elements[key] = {
            ...normalizeDesignElementStyle(key, elements[key]),
            x: position.x,
            y: position.y,
          };
        });
        return elements;
      }, '移动对象', { recordHistory: false });
    };
    const handleUp = () => {
      setElementDrag(null);
      window.setTimeout(() => setSnapGuides([]), 180);
      window.setTimeout(() => setInteractionFeedback(null), 180);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [elementDrag, selectedSlide, selectedDesign.elements, selectedElementKeys]);

  useEffect(() => {
    if (!customElementDrag) return undefined;
    const handleMove = (event: PointerEvent) => {
      const dx = ((event.clientX - customElementDrag.startX) / customElementDrag.rect.width) * 100;
      const dy = ((event.clientY - customElementDrag.startY) / customElementDrag.rect.height) * 100;
      const idSet = new Set(customElementDrag.ids);
      const feedbackBoxes = customElementDrag.ids
        .map((id) => {
          const base = customElementDrag.initialStyles[id];
          const origin = customElementDrag.origins[id];
          if (!base || !origin) return null;
          return styleBox({
            ...base,
            x: clampValue(origin.x + dx, -20, 120),
            y: clampValue(origin.y + dy, -20, 120),
          });
        })
        .filter((box): box is ReturnType<typeof styleBox> => !!box);
      if (feedbackBoxes.length) {
        setInteractionFeedback(geometryFeedback(
          'drag',
          unionBoxes(feedbackBoxes),
          customElementDrag.ids.length > 1 ? `移动 ${customElementDrag.ids.length} 个组件` : '移动组件',
        ));
      }
      updateCustomElements((items) => items.map((item) => {
        if (!idSet.has(item.id)) return item;
        const origin = customElementDrag.origins[item.id];
        if (!origin) return item;
        return normalizeCustomElement({
          ...item,
          x: clampValue(origin.x + dx, -20, 120),
          y: clampValue(origin.y + dy, -20, 120),
        });
      }), '移动组件', { recordHistory: false });
    };
    const handleUp = () => {
      setCustomElementDrag(null);
      window.setTimeout(() => setSnapGuides([]), 120);
      window.setTimeout(() => setInteractionFeedback(null), 120);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [customElementDrag, selectedSlide, customElements]);

  useEffect(() => {
    if (!resizeState) return undefined;
    const handleMove = (event: PointerEvent) => {
      const dx = ((event.clientX - resizeState.startX) / resizeState.rect.width) * 100;
      const dy = ((event.clientY - resizeState.startY) / resizeState.rect.height) * 100;
      const box = resizeBoxForHandle(resizeState.original, resizeState.handle, dx, dy, event.shiftKey);
      setInteractionFeedback(geometryFeedback('resize', box, resizeState.kind === 'slide' ? '调整对象尺寸' : '调整组件尺寸'));
      if (resizeState.kind === 'slide') {
        updateSelectedSlideElements((elements) => {
          elements[resizeState.key] = {
            ...normalizeDesignElementStyle(resizeState.key, elements[resizeState.key]),
            ...box,
          };
          return elements;
        }, '调整对象尺寸', { recordHistory: false });
        return;
      }
      updateCustomElements((items) => items.map((item) => (
        item.id === resizeState.id ? normalizeCustomElement({ ...item, ...box }) : item
      )), '调整组件尺寸', { recordHistory: false });
    };
    const handleUp = () => {
      setResizeState(null);
      window.setTimeout(() => setSnapGuides([]), 120);
      window.setTimeout(() => setInteractionFeedback(null), 120);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [resizeState, selectedSlide]);

  const artboardElementStyle = (key: SlideDesignElementKey): CSSProperties => {
    const rawValue = selectedDesign.elements?.[key];
    const value = effectiveDesignElementStyle(key);
    const themeColor = key === 'eyebrow'
      ? style?.tokens.primary
      : key === 'headline'
        ? style?.tokens.muted
        : style?.tokens.text;
    return {
      left: `${value.x}%`,
      top: `${value.y}%`,
      width: `${value.width}%`,
      height: `${value.height}%`,
      fontSize: value.fontSize,
      color: rawValue?.color || themeColor || value.color,
      fontWeight: value.fontWeight,
      textAlign: value.align,
      background: value.background || undefined,
      borderRadius: key === 'visual' ? value.radius : value.radius || undefined,
      display: value.visible === false ? 'none' : undefined,
      zIndex: value.zIndex,
    };
  };

  const artboardElementContent = (key: SlideDesignElementKey) => {
    if (!selectedSlide) return null;
    if (key === 'eyebrow') return `${artboardSectionTitle} · ${style?.name || 'AIPPT'}`;
    if (key === 'title') return selectedSlide.title;
    if (key === 'headline') return selectedSlide.headline;
    if (key === 'bullets') {
      return (
        <ul>
          {selectedSlide.bullets.slice(0, 6).map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
        </ul>
      );
    }
    if (selectedMedia?.url) {
      return <img src={selectedMedia.url} alt={selectedMedia.alt || selectedSlide.visual || selectedSlide.title} />;
    }
    return (
      <span>
        <b>图片/视觉区</b>
        <strong>{selectedSlide.visual || selectedVisualSpec?.title || '插入图片或配置图表'}</strong>
        <em>{selectedVisualSpec?.type || selectedSlide.layout}</em>
      </span>
    );
  };

  const customElementStyle = (element: SlideDesignCustomElement): CSSProperties => {
    const value = normalizeCustomElement(element);
    return {
      left: `${value.x}%`,
      top: `${value.y}%`,
      width: `${value.width}%`,
      height: `${value.height}%`,
      fontSize: value.fontSize,
      color: value.color,
      fontWeight: value.fontWeight,
      textAlign: value.align,
      background: value.background || undefined,
      borderRadius: value.shape === 'circle' ? '50%' : value.shape === 'pill' ? 999 : value.radius,
      display: value.visible === false ? 'none' : undefined,
      zIndex: value.zIndex,
    };
  };

  const customElementContent = (element: SlideDesignCustomElement) => {
    const value = normalizeCustomElement(element);
    if (value.type === 'image') {
      return value.url ? (
        <img src={value.url} alt={value.alt || value.label || value.name || '图片素材'} style={{ objectFit: value.fit === 'contain' ? 'contain' : 'cover' }} />
      ) : (
        <span>
          <b>图片/素材</b>
          <strong>{value.alt || value.label || '拖入图片或粘贴素材'}</strong>
        </span>
      );
    }
    if (value.type === 'shape') return null;
    if (value.type === 'metric') {
      return (
        <span>
          <strong>{String(value.value ?? '128%')}{value.unit || ''}</strong>
          <em>{value.label || '核心指标'}</em>
        </span>
      );
    }
    return value.content || '补充一条关键说明';
  };

  const artboardSectionTitle = selectedSlide && plan && config
    ? plan.sections.find((section) => section.id === selectedSlide.sectionId)?.title || USE_CASE_LABEL[config.useCase]
    : config ? USE_CASE_LABEL[config.useCase] : '演示';

  const slideInlineEditValue = (key: SlideDesignElementKey) => {
    if (!selectedSlide) return '';
    if (key === 'eyebrow') return artboardSectionTitle;
    if (key === 'title') return selectedSlide.title;
    if (key === 'headline') return selectedSlide.headline;
    if (key === 'bullets') return selectedSlide.bullets.join('\n');
    return selectedSlide.visual || selectedVisualSpec?.title || '';
  };

  const inlineTargetMatchesSlide = (key: SlideDesignElementKey) => (
    inlineEditTarget?.kind === 'slide' && inlineEditTarget.key === key
  );

  const inlineTargetMatchesCustom = (id: string) => (
    inlineEditTarget?.kind === 'custom' && inlineEditTarget.id === id
  );

  const isInlineTargetMultiline = (target: InlineEditTarget | null) => (
    target?.kind === 'slide'
      ? target.key === 'bullets' || target.key === 'visual'
      : target?.field === 'content'
  );

  const beginInlineSlideEdit = (
    key: SlideDesignElementKey,
    event?: ReactMouseEvent<HTMLElement> | ReactKeyboardEvent<HTMLElement>,
  ) => {
    event?.preventDefault();
    event?.stopPropagation();
    if (!selectedSlide) return;
    const styleValue = effectiveDesignElementStyle(key);
    if (styleValue.locked) {
      messageApi.info(`${DESIGNER_ELEMENT_LABEL[key]}已锁定，解锁后才能编辑`);
      return;
    }
    selectDesignElement(key);
    if (key === 'visual') {
      setInspectTab('visual');
      setInlineEditTarget(null);
      messageApi.info('已打开图表/视觉编辑，可调整图片、图表、矩阵或流程结构');
      return;
    }
    setInspectTab('content');
    skipNextInlineCommitRef.current = false;
    setInlineEditTarget({ kind: 'slide', key });
    setInlineEditValue(slideInlineEditValue(key));
  };

  const beginInlineCustomEdit = (
    element: SlideDesignCustomElement,
    event?: ReactMouseEvent<HTMLElement> | ReactKeyboardEvent<HTMLElement>,
  ) => {
    event?.preventDefault();
    event?.stopPropagation();
    const normalized = normalizeCustomElement(element);
    if (normalized.locked) {
      messageApi.info(`${customElementDisplayName(normalized)}已锁定，解锁后才能编辑`);
      return;
    }
    selectCustomElement(normalized.id);
    setInspectTab('object');
    if (normalized.type === 'shape') {
      setInlineEditTarget(null);
      messageApi.info('已打开形状编辑，可调整颜色、圆角、尺寸和层级');
      return;
    }
    if (normalized.type === 'image') {
      setInlineEditTarget(null);
      messageApi.info('已打开图片编辑，可上传、粘贴素材或切换裁切方式');
      return;
    }
    const field: 'content' | 'value' = normalized.type === 'metric'
      ? 'value'
      : 'content';
    const currentValue = field === 'value'
      ? String(normalized.value ?? '')
      : String(normalized.content || '');
    skipNextInlineCommitRef.current = false;
    setInlineEditTarget({ kind: 'custom', id: normalized.id, field });
    setInlineEditValue(currentValue);
  };

  const cancelInlineEdit = () => {
    skipNextInlineCommitRef.current = true;
    inlineEditorRef.current?.blur();
    setInlineEditTarget(null);
    setInlineEditValue('');
  };

  const commitInlineEdit = (valueOverride?: string) => {
    if (isCommittingInlineRef.current) return;
    if (skipNextInlineCommitRef.current) {
      skipNextInlineCommitRef.current = false;
      return;
    }
    if (!inlineEditTarget || !selectedSlide) return;
    isCommittingInlineRef.current = true;
    inlineEditorRef.current?.blur();
    const rawValue = (valueOverride ?? inlineEditValue).trimEnd();
    if (inlineEditTarget.kind === 'slide') {
      const { key } = inlineEditTarget;
      if (key === 'eyebrow') {
        const title = rawValue.trim();
        if (title && plan) {
          updatePlan((prev) => ({
            ...prev,
            sections: prev.sections.map((section) => (
              section.id === selectedSlide.sectionId ? { ...section, title } : section
            )),
          }), { historyLabel: '画布编辑章节标签' });
        }
      } else if (key === 'title') {
        updateSlide(selectedSlide.id, { title: rawValue || selectedSlide.title }, { historyLabel: '画布编辑标题' });
      } else if (key === 'headline') {
        updateSlide(selectedSlide.id, { headline: rawValue }, { historyLabel: '画布编辑核心观点' });
      } else if (key === 'bullets') {
        const bullets = rawValue.split(/\n+/).map((item) => item.trim()).filter(Boolean);
        updateSlide(selectedSlide.id, { bullets: bullets.length ? bullets : selectedSlide.bullets }, { historyLabel: '画布编辑内容要点' });
      } else if (key === 'visual') {
        updateSlide(selectedSlide.id, { visual: rawValue }, { historyLabel: '画布编辑视觉说明' });
      }
    } else {
      const patch = { [inlineEditTarget.field]: rawValue } as Partial<SlideDesignCustomElement>;
      patchCustomElement(inlineEditTarget.id, patch, { historyLabel: '画布编辑组件内容' });
    }
    setInlineEditTarget(null);
    setInlineEditValue('');
    window.setTimeout(() => {
      isCommittingInlineRef.current = false;
    }, 0);
  };

  const appendInlineSegment = () => {
    const prefix = inlineEditValue.trimEnd();
    setInlineEditValue(`${prefix}${prefix ? '\n' : ''}补充一条内容`);
    window.setTimeout(() => inlineEditorRef.current?.focus(), 0);
  };

  const normalizeInlineSegments = () => {
    const segments = inlineEditValue
      .split(/[\n；;。]/u)
      .map((item) => item.trim())
      .filter(Boolean);
    if (!segments.length) return;
    setInlineEditValue(segments.join('\n'));
    window.setTimeout(() => inlineEditorRef.current?.focus(), 0);
  };

  const renderInlineEditor = (label: string, multiline = false) => (
    <div
      className={`presentation-inline-editor-wrap${multiline ? ' is-multiline' : ''}`}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {multiline && (
        <div className="presentation-inline-editor-toolbar" aria-label={`${label}分段工具`}>
          <button type="button" onPointerDown={(event) => event.preventDefault()} onClick={appendInlineSegment}>+ 分段</button>
          <button type="button" onPointerDown={(event) => event.preventDefault()} onClick={normalizeInlineSegments}>整理分段</button>
          <span>Shift+Enter 换行，Cmd/Ctrl+Enter 完成</span>
        </div>
      )}
      <textarea
        ref={inlineEditorRef}
        className="presentation-inline-editor"
        aria-label={`编辑${label}`}
        rows={multiline ? 4 : 1}
        value={inlineEditValue}
        onChange={(event) => {
          const nextValue = event.target.value;
          if (!multiline && /\n/.test(nextValue)) {
            const normalized = nextValue.replace(/\s*\n+\s*/g, ' ').trimEnd();
            setInlineEditValue(normalized);
            window.setTimeout(() => commitInlineEdit(normalized), 0);
            return;
          }
          setInlineEditValue(nextValue);
        }}
        onBlur={() => commitInlineEdit()}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            cancelInlineEdit();
            return;
          }
          if (event.key === 'Enter' && !multiline && !event.shiftKey) {
            event.preventDefault();
            commitInlineEdit();
            return;
          }
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            commitInlineEdit();
          }
        }}
      />
    </div>
  );

  const canShowSlideResizeHandles = (
    key: SlideDesignElementKey,
    styleValue: SlideDesignElementStyle,
    isInlineEditing: boolean,
  ) => (
    viewMode === 'design'
    && !isInlineEditing
    && styleValue.visible !== false
    && styleValue.locked !== true
    && selectedElementKeys.length === 1
    && selectedElementKey === key
    && selectedElementKeys.includes(key)
    && selectedCustomElementIds.length === 0
  );

  const canShowCustomResizeHandles = (
    element: SlideDesignCustomElement,
    isInlineEditing: boolean,
  ) => (
    viewMode === 'design'
    && !isInlineEditing
    && element.visible !== false
    && element.locked !== true
    && selectedCustomElementIds.length === 1
    && selectedCustomElementId === element.id
  );

  const renderSlideResizeHandles = (
    key: SlideDesignElementKey,
    styleValue: SlideDesignElementStyle,
    isInlineEditing: boolean,
  ) => {
    if (!canShowSlideResizeHandles(key, styleValue, isInlineEditing)) return null;
    return (
      <>
        {RESIZE_HANDLES.map((handle) => (
          <span
            key={handle}
            role="button"
            tabIndex={-1}
            aria-label={`${DESIGNER_ELEMENT_LABEL[key]}${RESIZE_HANDLE_LABEL[handle]}`}
            title={RESIZE_HANDLE_LABEL[handle]}
            data-testid={`aippt-resize-slide-${key}-${handle}`}
            className={`presentation-resize-handle presentation-resize-handle--${handle}`}
            onPointerDown={(event) => startElementResize(key, handle, event)}
          />
        ))}
      </>
    );
  };

  const renderCustomResizeHandles = (
    element: SlideDesignCustomElement,
    isInlineEditing: boolean,
  ) => {
    if (!canShowCustomResizeHandles(element, isInlineEditing)) return null;
    return (
      <>
        {RESIZE_HANDLES.map((handle) => (
          <span
            key={handle}
            role="button"
            tabIndex={-1}
            aria-label={`${customElementDisplayName(element)}${RESIZE_HANDLE_LABEL[handle]}`}
            title={RESIZE_HANDLE_LABEL[handle]}
            data-testid={`aippt-resize-custom-${handle}`}
            data-aippt-custom-id={element.id}
            className={`presentation-resize-handle presentation-resize-handle--${handle}`}
            onPointerDown={(event) => startCustomElementResize(element, handle, event)}
          />
        ))}
      </>
    );
  };

  const renderSlideImageQuickActions = (
    key: SlideDesignElementKey,
    styleValue: SlideDesignElementStyle,
    isInlineEditing: boolean,
  ) => {
    if (key !== 'visual' || !canShowSlideResizeHandles(key, styleValue, isInlineEditing)) return null;
    const nextFit = selectedMedia?.fit === 'contain' ? 'cover' : 'contain';
    return (
      <div className="presentation-image-quick-actions" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
        <button type="button" onClick={() => imageInputRef.current?.click()}>替换图片</button>
        <button type="button" onClick={() => { selectDesignElement('visual'); setInspectTab('visual'); }}>
          {DATA_VISUAL_TYPES.has((selectedVisualSpec?.type || 'generic') as VisualSpecType) ? '数据' : '编辑'}
        </button>
        <button type="button" onClick={() => updateSelectedMedia({ fit: nextFit }, { historyLabel: '切换视觉区裁切方式' })}>
          {nextFit === 'contain' ? '完整显示' : '裁切铺满'}
        </button>
      </div>
    );
  };

  const renderCustomImageQuickActions = (
    element: SlideDesignCustomElement,
    isInlineEditing: boolean,
  ) => {
    if (element.type !== 'image' || !canShowCustomResizeHandles(element, isInlineEditing)) return null;
    const nextFit = element.fit === 'contain' ? 'cover' : 'contain';
    return (
      <div className="presentation-image-quick-actions" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
        <button type="button" onClick={() => imageInputRef.current?.click()}>替换图片</button>
        <button type="button" onClick={() => { selectCustomElement(element.id); setInspectTab('object'); }}>素材</button>
        <button type="button" onClick={() => patchCustomElement(element.id, { fit: nextFit }, { historyLabel: '切换图片裁切方式' })}>
          {nextFit === 'contain' ? '完整显示' : '裁切铺满'}
        </button>
      </div>
    );
  };

  const setElementSelection = (keys: SlideDesignElementKey[], primaryKey?: SlideDesignElementKey) => {
    const unique = keys.filter((key, index) => DESIGNER_ELEMENT_KEYS.includes(key) && keys.indexOf(key) === index);
    setSelectedCustomElementId(null);
    setSelectedCustomElementIds([]);
    setSelectedElementKeys(unique);
    if (primaryKey) setSelectedElementKey(primaryKey);
    else if (unique[0]) setSelectedElementKey(unique[unique.length - 1]);
  };

  const selectDesignElement = (key: SlideDesignElementKey, additive = false, targetTab: DesignerInspectTab = inspectorTabForElement(key)) => {
    if (additive) {
      const exists = selectedElementKeys.includes(key);
      const next = exists ? selectedElementKeys.filter((item) => item !== key) : [...selectedElementKeys, key];
      setElementSelection(next.length ? next : [key], key);
    } else {
      setElementSelection([key], key);
    }
    setSelectedElementKey(key);
    setInspectTab(additive ? 'object' : targetTab);
  };

  const handleToolboxDragStart = (itemId: string, event: ReactDragEvent<HTMLButtonElement>) => {
    event.dataTransfer.setData('application/x-aippt-tool', itemId);
    event.dataTransfer.effectAllowed = 'copy';
  };

  const handleArtboardToolDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    const itemId = event.dataTransfer.getData('application/x-aippt-tool');
    const item = DESIGNER_TOOLBOX_ITEMS.find((toolboxItem) => toolboxItem.id === itemId);
    if (!item) return;
    event.preventDefault();
    const rect = artboardRef.current?.getBoundingClientRect();
    const point = rect ? artboardPointFromDragEvent(event, rect) : undefined;
    addToolboxItem(item, point);
  };

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const data = event.clipboardData;
      if (!data) return;
      pasteHandledAtRef.current = Date.now();
      const fileItems = Array.from(data.items || [])
        .filter((item) => item.kind === 'file')
        .map((item) => item.getAsFile())
        .filter((file): file is File => !!file && isSupportedImageFile(file));
      const files = [...Array.from(data.files || []).filter(isSupportedImageFile), ...fileItems];
      if (files.length) {
        event.preventDefault();
        void importFirstImageFile(files, '粘贴图片素材');
        return;
      }

      const plainText = data.getData('text/plain').trim();
      const htmlText = data.getData('text/html').trim();
      if (isEditableEventTarget(event.target) && !plainText.match(/^\s*<svg[\s>]/iu) && !isImageLikeUrl(plainText)) return;
      const svgText = plainText.match(/^\s*<svg[\s>]/iu) ? plainText : htmlText.match(/<svg[\s\S]*<\/svg>/iu)?.[0] || '';
      if (svgText) {
        event.preventDefault();
        importImageDataUrl(svgTextToDataUrl(svgText), selectedSlide?.title || 'SVG 素材', '粘贴 SVG 素材');
        return;
      }

      if (isImageLikeUrl(plainText)) {
        event.preventDefault();
        importImageDataUrl(plainText, selectedSlide?.title || '图片素材', '粘贴图片 URL');
        return;
      }

      if (copiedCustomElementsRef.current.length) {
        event.preventDefault();
        pasteCopiedCustomElements();
        return;
      }

      if (copiedSlideRef.current) {
        event.preventDefault();
        pasteCopiedSlide();
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [plan, selectedSlide, selectedMedia, selectedCustomElement, selectedCustomElements]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (viewMode === 'design' && !isEditableEventTarget(event.target)) {
        const nudgeStep = event.shiftKey ? 5 : event.altKey ? 0.2 : 1;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault();
          if (event.key === 'ArrowLeft') nudgeSelectedObjects(-nudgeStep, 0);
          if (event.key === 'ArrowRight') nudgeSelectedObjects(nudgeStep, 0);
          if (event.key === 'ArrowUp') nudgeSelectedObjects(0, -nudgeStep);
          if (event.key === 'ArrowDown') nudgeSelectedObjects(0, nudgeStep);
          return;
        }
        if (event.key === 'Delete' || event.key === 'Backspace') {
          event.preventDefault();
          deleteSelectedObjects();
          return;
        }
        if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.altKey) {
          event.preventDefault();
          beginSelectedObjectEdit();
          return;
        }
      }
      const primary = event.metaKey || event.ctrlKey;
      if (!primary || event.altKey) return;
      const key = event.key.toLowerCase();

      if (key === 's') {
        event.preventDefault();
        void saveVersion('快捷键保存');
        return;
      }

      if (key === 'c') {
        const selection = window.getSelection()?.toString() || '';
        if (isEditableEventTarget(event.target) && selection) return;
        event.preventDefault();
        copySelectedSlide();
        return;
      }

      if (key === 'v') {
        if (isEditableEventTarget(event.target)) return;
        const pressedAt = Date.now();
        window.setTimeout(() => {
          if (pasteHandledAtRef.current >= pressedAt) return;
          if (copiedCustomElementsRef.current.length) pasteCopiedCustomElements();
          else if (copiedSlideRef.current) pasteCopiedSlide();
        }, 120);
        return;
      }

      if (key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redoDesignerEdit();
        else undoDesignerEdit();
        return;
      }

      if (key === 'y') {
        event.preventDefault();
        redoDesignerEdit();
      }
    };
    const frameWindow = frameRef.current?.contentWindow || null;
    const frameDocument = frameRef.current?.contentDocument || null;
    window.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('keydown', handleKeyDown, true);
    frameWindow?.addEventListener('keydown', handleKeyDown, true);
    frameDocument?.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('keydown', handleKeyDown, true);
      frameWindow?.removeEventListener('keydown', handleKeyDown, true);
      frameDocument?.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [plan, config, selectedSlide, selectedSlideId, htmlDeck, selectedCustomElements, selectedElementKeys, selectedDesign.elements, selectedMedia, selectedVisualSpec, selectedCustomElementStyle, selectedElementKey, viewMode]);

  useEffect(() => {
    if (!inlineEditTarget) return undefined;
    const editor = inlineEditorRef.current;
    const multiline = isInlineTargetMultiline(inlineEditTarget);
    const timer = window.setTimeout(() => {
      inlineEditorRef.current?.focus();
      inlineEditorRef.current?.select();
    }, 0);
    const handleNativeKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelInlineEdit();
        return;
      }
      if (event.key === 'Enter' && !multiline && !event.shiftKey) {
        event.preventDefault();
        commitInlineEdit((event.currentTarget as HTMLTextAreaElement).value);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        commitInlineEdit((event.currentTarget as HTMLTextAreaElement).value);
      }
    };
    editor?.addEventListener('keydown', handleNativeKeyDown);
    return () => {
      window.clearTimeout(timer);
      editor?.removeEventListener('keydown', handleNativeKeyDown);
    };
  }, [inlineEditTarget]);

  useEffect(() => {
    setInlineEditTarget(null);
    setInlineEditValue('');
  }, [selectedSlideId, viewMode]);

  if (loading) {
    return (
      <div className="presentation-designer-page presentation-designer-page--loading">
        {contextHolder}
        <Spin size="large" />
      </div>
    );
  }

  if (!plan || !config || !style) {
    return (
      <div className="presentation-designer-page presentation-designer-page--loading">
        {contextHolder}
        <Empty description="没有可编辑的 AIPPT Schema" />
        <Button onClick={() => navigate('/presentation-canvas')}>返回 AIPPT</Button>
      </div>
    );
  }

  return (
    <div
      className="presentation-designer-page"
      style={{
        '--designer-bg': style.tokens.background,
        '--designer-surface': style.tokens.surface,
        '--designer-primary': style.tokens.primary,
        '--designer-accent': style.tokens.accent,
        '--designer-muted': style.tokens.muted,
        '--designer-text': style.tokens.text,
      } as CSSProperties}
    >
      {contextHolder}
      {modalContextHolder}
      <input
        ref={imageInputRef}
        type="file"
        data-testid="aippt-replace-image-input"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg"
        hidden
        onChange={(event) => void handleImageInputChange(event)}
      />
      {contextMenu && (
        <div
          className="presentation-designer-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" onClick={() => moveContextLayersToEdge('front')}>置于顶层</button>
          <button type="button" onClick={() => moveContextLayersToEdge('back')}>置于底层</button>
          <button type="button" onClick={() => { alignSelectedElements('center'); setContextMenu(null); }}>水平居中</button>
          <button type="button" onClick={() => { alignSelectedElements('middle'); setContextMenu(null); }}>垂直居中</button>
          <button type="button" onClick={toggleContextLayersLocked}>
            {contextKeys().every((key) => effectiveDesignElementStyle(key).locked === true) ? '解锁对象' : '锁定对象'}
          </button>
          <button type="button" onClick={toggleContextLayersVisible}>
            {contextKeys().every((key) => effectiveDesignElementStyle(key).visible !== false) ? '隐藏对象' : '显示对象'}
          </button>
          {contextMenu.key && <button type="button" onClick={startContextRename}>重命名图层</button>}
        </div>
      )}
      <header className="presentation-designer-page__header">
        <div className="presentation-designer-page__title">
          <Button icon={<ArrowLeftOutlined />} onClick={leaveDesigner} />
          <span><FilePptOutlined /></span>
          <div>
            <strong>{plan.title}</strong>
            <em>Schema 驱动 PPT Designer · {USE_CASE_LABEL[config.useCase]} · {config.aspectRatio} · {style.name}</em>
          </div>
          {dirty && <Tag color="orange">未保存</Tag>}
        </div>
        <div className="presentation-designer-page__actions">
          <Tooltip title="撤销编辑 · Mac: ⌘Z / Windows: Ctrl+Z">
            <Button icon={<UndoOutlined />} disabled={!canUndo} onClick={undoDesignerEdit}>
              撤销
            </Button>
          </Tooltip>
          <Tooltip title="重做编辑 · Mac: ⇧⌘Z / Windows: Ctrl+Y">
            <Button icon={<RedoOutlined />} disabled={!canRedo} onClick={redoDesignerEdit}>
              重做
            </Button>
          </Tooltip>
          <Tooltip title="保存当前 Deck Schema 为一个可回退版本">
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void saveVersion()}>
              保存版本
            </Button>
          </Tooltip>
          <Button icon={<EditOutlined />} type={viewMode === 'design' ? 'primary' : 'default'} onClick={enterDesignMode}>
            低代码编辑
          </Button>
          <Button
            icon={<FundProjectionScreenOutlined />}
            type={viewMode === 'html' ? 'primary' : 'default'}
            onClick={() => {
              setViewMode('html');
              window.setTimeout(() => frameRef.current?.contentWindow?.focus(), 0);
            }}
          >
            HTML 预览
          </Button>
          <Button icon={<FullscreenOutlined />} onClick={() => void openFullscreen()}>
            全屏
          </Button>
          <Button icon={<DownloadOutlined />} onClick={downloadHtml}>
            下载 HTML
          </Button>
          <Button icon={<FundProjectionScreenOutlined />} loading={validatingPptx} onClick={() => void validatePptxCompatibility()}>
            兼容性检查
          </Button>
          <Button icon={<DownloadOutlined />} loading={exportingPptx} onClick={() => void downloadPptx()}>
            导出 PPTX
          </Button>
        </div>
      </header>

      <div className="presentation-designer-page__body">
        <aside className="presentation-designer-page__pages">
          <div className="presentation-designer-page__section-head">
            <strong>Pages</strong>
            <div>
              <Button size="small" icon={<PlusOutlined />} onClick={addSlide}>新增</Button>
              <Button size="small" icon={<CopyOutlined />} onClick={duplicateSlide} disabled={!selectedSlide}>复制</Button>
              <Button size="small" danger icon={<DeleteOutlined />} onClick={deleteSlide} disabled={!selectedSlide}>删除</Button>
            </div>
          </div>
          <div className="presentation-designer-page__slide-list">
            {plan.slides.map((slide) => (
              <button
                key={slide.id}
                type="button"
                draggable
                className={slide.id === selectedSlide?.id ? 'is-active' : draggingSlideId === slide.id ? 'is-dragging' : ''}
                onClick={() => selectSlideFromList(slide)}
                onDragStart={() => setDraggingSlideId(slide.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  if (draggingSlideId) moveSlide(draggingSlideId, slide.id);
                  setDraggingSlideId(null);
                }}
                onDragEnd={() => setDraggingSlideId(null)}
              >
                <b>{String(slide.index).padStart(2, '0')}</b>
                <span>{slide.title}</span>
                <em>{DECK_LAYOUT_OPTIONS.find((item) => item.value === slide.layout)?.label || slide.layout}</em>
              </button>
            ))}
          </div>
          <section className="presentation-designer-toolbox" aria-label="低代码组件库">
            <div className="presentation-designer-page__section-head">
              <strong><AppstoreAddOutlined /> 组件库</strong>
              <Tag color="blue">{DESIGNER_TOOLBOX_ITEMS.length} 模板</Tag>
            </div>
            <Segmented
              block
              size="small"
              className="presentation-designer-toolbox__tabs"
              value={toolboxGroup}
              onChange={(value) => setToolboxGroup(value as DesignerToolboxGroup)}
              options={DESIGNER_TOOLBOX_GROUPS}
            />
            <div className="presentation-designer-toolbox__hint">
              <span>点击插入到当前页，或拖到画布指定位置。</span>
              <Tag>{DESIGNER_TOOLBOX_GROUPS.find((item) => item.value === toolboxGroup)?.label}</Tag>
            </div>
            <div className="presentation-designer-toolbox__grid">
              {filteredToolboxItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  draggable
                  onDragStart={(event) => handleToolboxDragStart(item.id, event)}
                  onClick={() => addToolboxItem(item)}
                >
                  <span>{item.icon}</span>
                  <strong>{item.label}</strong>
                  <em>{item.detail}</em>
                  <i>{item.kind === 'template' ? '快捷模板' : '基础组件'}</i>
                </button>
              ))}
            </div>
          </section>
        </aside>

        <main className="presentation-designer-page__preview">
          <div className="presentation-designer-page__preview-head">
            <div>
              <strong>{viewMode === 'design' ? '低代码编辑层 · 对齐最终 HTML' : '最终 HTML-PPT 预览'}</strong>
              <span>{viewMode === 'design' ? '下层仍是最终 HTML 渲染，当前只叠加可选中、拖拽和缩放的对象控制层。' : '默认查看最终交付效果；需要移动对象或插入组件时切到低代码编辑。'}</span>
            </div>
            <div>
              <Segmented
                size="small"
                value={viewMode}
                onChange={(value) => setViewMode(value as DesignerViewMode)}
                options={[
                  { value: 'html', label: '最终 HTML' },
                  { value: 'design', label: '低代码编辑' },
                ]}
              />
              <Tag color="blue">{previewStyle?.name || style.name}</Tag>
              <Tag color="green">{previewConfig?.aspectRatio || config.aspectRatio}</Tag>
              <Tag>{previewConfig?.density || config.density}</Tag>
            </div>
          </div>
          {activePendingPatch && (
            <div className="presentation-designer-preview-banner">
              <Tag color="purple">AI 预览中</Tag>
              <span>当前 iframe 临时展示「{actionLabel(activePendingPatch.action)}」后的效果，应用补丁前不会写入 Deck Schema。</span>
            </div>
          )}
          <div
            ref={previewRef}
            className={[
              'presentation-designer-page__frame',
              `presentation-designer-page__frame--${viewMode}`,
              viewMode === 'design' && htmlSlideBounds ? 'is-html-synced' : '',
            ].filter(Boolean).join(' ')}
            data-html-synced={viewMode === 'design' && htmlSlideBounds ? 'true' : 'false'}
            data-schema-revision={schemaRevision}
            data-selected-slide-id={selectedSlide?.id || ''}
            data-design-mode={selectedDesign.mode}
            data-custom-element-count={customElements.length}
            data-testid="aippt-designer-preview-frame"
          >
            {viewMode === 'design' && (
              <div className="presentation-designer-edit-status" data-testid="aippt-html-sync-status">
                <Tag color={selectedDesign.mode === 'freeform' ? 'green' : 'gold'}>{selectedDesign.mode === 'freeform' ? '自由编辑层' : '结构化页面'}</Tag>
                <span>{htmlSlideBounds ? '控制层已贴合最终 HTML slide 区域。' : '正在读取最终 HTML slide 尺寸。'}</span>
                <span className="presentation-designer-edit-status__selection" data-testid="aippt-selected-object-status">
                  {interactionFeedback?.label || selectedObjectStatusText}
                </span>
                <span data-testid="aippt-schema-sync-panel">
                  Deck Schema rev {schemaRevision} · {lastSchemaMutation?.label || '等待编辑'} · Renderer srcDoc 同源
                </span>
              </div>
            )}
            <iframe ref={frameRef} title="AIPPT Designer Preview" srcDoc={htmlDeck} allow="fullscreen" allowFullScreen onLoad={handleFrameLoad} />
            {viewMode === 'design' && selectedSlide && (
              <div className="presentation-designer-artboard-shell">
                <div
                  ref={artboardRef}
                  tabIndex={-1}
                  className={[
                    'presentation-designer-artboard',
                    htmlSlideBounds ? 'presentation-designer-artboard--synced' : '',
                    elementDrag || customElementDrag ? 'is-dragging' : '',
                    resizeState ? 'is-resizing' : '',
                    `presentation-designer-artboard--${config.aspectRatio === '3:1' ? 'wide' : 'standard'}`,
                    `presentation-designer-artboard--${style.key}`,
                  ].filter(Boolean).join(' ')}
                  style={htmlSlideBounds ? {
                    left: htmlSlideBounds.left,
                    top: htmlSlideBounds.top,
                    width: htmlSlideBounds.width,
                    height: htmlSlideBounds.height,
                  } : undefined}
                  onPointerDown={startArtboardMarquee}
                  onDragOver={(event) => {
                    if (event.dataTransfer.types.includes('application/x-aippt-tool')) {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'copy';
                    }
                  }}
                  onDrop={handleArtboardToolDrop}
                  onContextMenu={(event) => {
                    if ((event.target as HTMLElement).closest('.presentation-design-element')) return;
                    event.preventDefault();
                    setContextMenu({ x: event.clientX, y: event.clientY, key: null });
                  }}
                >
                  <div
                    className="presentation-designer-object-toolbar"
                    data-testid="aippt-object-toolbar"
                    style={selectedObjectToolbarStyle}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <Tag color="blue" style={{ pointerEvents: 'none' }}>{selectedObjectName}</Tag>
                    <Tooltip title="双击对象或按 Enter 也可以直接编辑">
                      <Button size="small" style={{ pointerEvents: 'auto' }} icon={<EditOutlined />} disabled={!selectedObjectCanInlineEdit} onClick={beginSelectedObjectEdit}>
                        编辑文字
                      </Button>
                    </Tooltip>
                    <Tooltip title="替换当前视觉区或图片组件，支持 PNG/JPG/WebP/GIF/SVG">
                      <Button size="small" style={{ pointerEvents: 'auto' }} icon={<UploadOutlined />} disabled={!selectedObjectCanReplaceImage} onClick={replaceSelectedImageAsset}>
                        替换图片
                      </Button>
                    </Tooltip>
                    <Tooltip title="复制选中对象为可独立编辑的自由组件">
                      <Button size="small" style={{ pointerEvents: 'auto' }} icon={<CopyOutlined />} onClick={duplicateSelectedObjects}>
                        复制对象
                      </Button>
                    </Tooltip>
                    <Tooltip title="方向键微调，Shift+方向键快速移动，Delete 隐藏/删除">
                      <Tag style={{ pointerEvents: 'none' }}>方向键微调</Tag>
                    </Tooltip>
                    <Tooltip title={selectedCustomElementStyle ? '删除选中组件' : '隐藏结构对象'}>
                      <Button size="small" danger style={{ pointerEvents: 'auto' }} icon={<DeleteOutlined />} onClick={deleteSelectedObjects}>
                        {selectedCustomElementStyle ? '删除' : '隐藏'}
                      </Button>
                    </Tooltip>
                  </div>
                  {snapGuides.map((guide, index) => (
                    <div
                      key={`${guide.orientation}-${guide.position}-${index}`}
                      className={`presentation-designer-guide presentation-designer-guide--${guide.orientation}`}
                      style={guide.orientation === 'vertical' ? { left: `${guide.position}%` } : { top: `${guide.position}%` }}
                    >
                      {guide.label && <span>{guide.label}</span>}
                    </div>
                  ))}
                  {marquee && (
                    <div
                      className="presentation-designer-marquee"
                      style={{
                        left: `${marqueeBox(marquee).left}%`,
                        top: `${marqueeBox(marquee).top}%`,
                        width: `${marqueeBox(marquee).width}%`,
                        height: `${marqueeBox(marquee).height}%`,
                      }}
                    />
                  )}
                  {interactionFeedback && (
                    <div
                      className={`presentation-designer-interaction-feedback presentation-designer-interaction-feedback--${interactionFeedback.kind}`}
                      data-testid="aippt-interaction-feedback"
                      style={{
                        left: `${interactionFeedback.x}%`,
                        top: `${interactionFeedback.y}%`,
                        width: `${interactionFeedback.width}%`,
                        height: `${interactionFeedback.height}%`,
                      }}
                    >
                      <span>{interactionFeedback.label}</span>
                    </div>
                  )}
                  {artboardLayers.map((layer) => {
                    const isInlineEditing = inlineTargetMatchesSlide(layer.key);
                    const showResizeHandles = canShowSlideResizeHandles(layer.key, layer.style, isInlineEditing);
                    return (
                      <div
                        key={layer.key}
                        tabIndex={0}
                        data-testid={`aippt-design-element-${layer.key}`}
                        aria-label={`${DESIGNER_ELEMENT_LABEL[layer.key]}编辑框`}
                        className={[
                          'presentation-design-element',
                          `presentation-design-element--${layer.key}`,
                          selectedElementKeys.includes(layer.key) ? 'is-selected' : '',
                          selectedElementKey === layer.key ? 'is-primary' : '',
                          layer.style.locked ? 'is-locked' : '',
                          isInlineEditing ? 'is-editing' : '',
                          elementDrag?.keys.includes(layer.key) ? 'is-dragging' : '',
                          resizeState?.kind === 'slide' && resizeState.key === layer.key ? 'is-resizing' : '',
                          showResizeHandles ? 'has-resize-handles' : '',
                        ].filter(Boolean).join(' ')}
                        style={artboardElementStyle(layer.key)}
                        onClick={(event) => selectDesignElement(layer.key, event.shiftKey || event.metaKey || event.ctrlKey)}
                        onDoubleClick={(event) => beginInlineSlideEdit(layer.key, event)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') beginInlineSlideEdit(layer.key, event);
                        }}
                        onContextMenu={(event) => openElementContextMenu(layer.key, event)}
                        onPointerDown={(event) => startElementDrag(layer.key, event)}
                      >
                        <span className="presentation-design-element__badge">
                          {layer.key === 'visual' ? '图表/视觉 · 点击编辑' : `${DESIGNER_ELEMENT_LABEL[layer.key]} · 双击编辑`}
                        </span>
                        {isInlineEditing
                          ? renderInlineEditor(DESIGNER_ELEMENT_LABEL[layer.key], layer.key === 'bullets' || layer.key === 'visual')
                          : artboardElementContent(layer.key)}
                        {renderSlideImageQuickActions(layer.key, layer.style, isInlineEditing)}
                        {renderSlideResizeHandles(layer.key, layer.style, isInlineEditing)}
                      </div>
                    );
                  })}
                  {[...customElements].sort((a, b) => Number(a.zIndex || 0) - Number(b.zIndex || 0)).map((element) => {
                    const normalized = normalizeCustomElement(element);
                    const isInlineEditing = inlineTargetMatchesCustom(normalized.id);
                    const showResizeHandles = canShowCustomResizeHandles(normalized, isInlineEditing);
                    return (
                      <div
                        key={normalized.id}
                        tabIndex={0}
                        data-testid={`aippt-design-custom-${normalized.type}`}
                        aria-label={`${customElementDisplayName(normalized)}组件编辑框`}
                        className={[
                          'presentation-design-element',
                          'presentation-design-element--custom',
                          `presentation-design-element--custom-${normalized.type}`,
                          selectedCustomElementIds.includes(normalized.id) ? 'is-selected' : '',
                          selectedCustomElementId === normalized.id ? 'is-primary' : '',
                          normalized.locked ? 'is-locked' : '',
                          isInlineEditing ? 'is-editing' : '',
                          customElementDrag?.ids.includes(normalized.id) ? 'is-dragging' : '',
                          resizeState?.kind === 'custom' && resizeState.id === normalized.id ? 'is-resizing' : '',
                          showResizeHandles ? 'has-resize-handles' : '',
                        ].filter(Boolean).join(' ')}
                        style={customElementStyle(normalized)}
                        onClick={(event) => {
                          event.stopPropagation();
                          selectCustomElement(normalized.id, event.shiftKey || event.metaKey || event.ctrlKey);
                        }}
                        onDoubleClick={(event) => beginInlineCustomEdit(normalized, event)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') beginInlineCustomEdit(normalized, event);
                        }}
                        onPointerDown={(event) => startCustomElementDrag(normalized, event)}
                      >
                        <span className="presentation-design-element__badge">
                          {normalized.type === 'image' ? '素材 · 点击编辑' : `${customElementDisplayName(normalized)} · 双击编辑`}
                        </span>
                        {isInlineEditing
                          ? renderInlineEditor(customElementDisplayName(normalized), normalized.type === 'text')
                          : customElementContent(normalized)}
                        {renderCustomImageQuickActions(normalized, isInlineEditing)}
                        {renderCustomResizeHandles(normalized, isInlineEditing)}
                      </div>
                    );
                  })}
                  <div className="presentation-designer-artboard__page">{String(selectedSlide.index).padStart(2, '0')}</div>
                </div>
              </div>
            )}
          </div>
        </main>

        <aside className="presentation-designer-page__inspector">
          <section className="presentation-designer-card presentation-designer-card--delivery" data-testid="aippt-schema-quality">
            <div className="presentation-designer-page__section-head">
              <strong>交付状态</strong>
              <div>
                {dirty && <Tag color="orange">未保存</Tag>}
                <Tag color={schemaErrorCount > 0 ? 'gold' : 'green'}>{schemaErrorCount > 0 ? '可继续编辑' : '可导出'}</Tag>
              </div>
            </div>
            <Alert
              type={schemaErrorCount > 0 ? 'info' : 'success'}
              showIcon
              message={schemaErrorCount > 0 ? '当前内容可继续编辑，保存和导出入口保持可用。' : '当前版本可预览、保存并导出 HTML / PPTX。'}
            />
            <div className="presentation-designer-shortcuts" aria-label="Designer 快捷键提示">
              <span>Mac: ⌘S 保存 · ⌘Z 撤销 · ⇧⌘Z 重做 · ⌘C/⌘V 复制粘贴</span>
              <span>Windows: Ctrl+S 保存 · Ctrl+Z 撤销 · Ctrl+Y 重做 · Ctrl+C/Ctrl+V 复制粘贴</span>
            </div>
            {schemaWarningCount + schemaInfoCount > 0 && <em>导出时会自动走结构和兼容性检查，前端暂不展开细节。</em>}
          </section>
          <section className="presentation-designer-card">
            <div className="presentation-designer-page__section-head">
              <strong>Inspector</strong>
              {selectedSlide && <Tag color={STATUS_COLOR[selectedSlide.status]}>{STATUS_LABEL[selectedSlide.status]}</Tag>}
            </div>
            {selectedSlide ? (
              <div className="presentation-designer-form">
                <div className="presentation-designer-ai-actions">
                  <Button icon={<ReloadOutlined />} disabled={!!activePendingPatch} loading={actionLoading === 'rewrite'} onClick={() => void runSlideAction('rewrite')}>
                    重写本页
                  </Button>
                  <Button icon={<BarChartOutlined />} disabled={!!activePendingPatch} loading={actionLoading === 'enhance_chart'} onClick={() => void runSlideAction('enhance_chart')}>
                    增强图表
                  </Button>
                  <Button icon={<ThunderboltOutlined />} disabled={!!activePendingPatch} loading={actionLoading === 'roadshow_style'} onClick={() => void runSlideAction('roadshow_style')}>
                    改成路演风格
                  </Button>
                </div>
                {activePendingPatch && (
                  <div className="presentation-designer-ai-patch" data-testid="aippt-ai-patch-preview">
                    <div className="presentation-designer-ai-patch__head">
                      <strong>{actionLabel(activePendingPatch.action)} · 待应用</strong>
                      <div>
                        <Tag color={activePendingPatch.source === 'fallback' || activePendingPatch.quality?.fallback ? 'orange' : 'blue'}>
                          {activePendingPatch.source || 'hermes'}
                        </Tag>
                        {activePendingPatch.quality?.repaired && <Tag color="gold">JSON 修复</Tag>}
                      </div>
                    </div>
                    <p>{activePendingPatch.rationale}</p>
                    {activePendingPatch.quality && (
                      <div className="presentation-designer-ai-patch__meta">
                        <span>变更 {activePendingPatch.quality.changed_fields?.length || activePendingPatch.diffItems.length} 项</span>
                        <span>上下文 {activePendingPatch.quality.context_slide_count || 0} 页</span>
                        <span>知识 {activePendingPatch.quality.knowledge_count || 0} 条</span>
                        <span>提醒 {activePendingPatch.quality.warning_count || activePendingPatch.warnings.length} 条</span>
                      </div>
                    )}
                    <div className="presentation-designer-ai-patch__timeline">
                      {buildPatchTimeline(activePendingPatch).map((item) => (
                        <article className={`is-${item.status}`} key={item.label}>
                          <b>{item.label}</b>
                          <span>{item.detail}</span>
                        </article>
                      ))}
                    </div>
                    <div className="presentation-designer-ai-patch__diff">
                      {activePendingPatch.diffItems.length ? activePendingPatch.diffItems.map((item) => (
                        <article key={item.field}>
                          <b>{item.field}</b>
                          <span>{item.before}</span>
                          <em>{item.after}</em>
                        </article>
                      )) : (
                        <span>未检测到明显字段变化，可以放弃本次补丁后重新生成。</span>
                      )}
                    </div>
                    {activePendingPatch.warnings.length > 0 && (
                      <div className="presentation-designer-ai-patch__warnings">
                        {activePendingPatch.warnings.slice(0, 3).map((warning, index) => (
                          <Alert key={`${warning}-${index}`} type="warning" showIcon message={warning} />
                        ))}
                      </div>
                    )}
                    <div className="presentation-designer-ai-patch__actions">
                      <Button type="primary" data-testid="aippt-ai-apply-patch" onClick={applyPendingPatch}>应用补丁</Button>
                      <Button data-testid="aippt-ai-discard-patch" onClick={discardPendingPatch}>放弃</Button>
                    </div>
                  </div>
                )}
                {!activePendingPatch && activeAppliedPatch && (
                  <div className="presentation-designer-ai-undo" data-testid="aippt-ai-undo-card">
                    <div>
                      <strong>{actionLabel(activeAppliedPatch.action)}已应用</strong>
                      <span>{activeAppliedPatch.diffItems.length} 项字段已写入当前 Deck Schema，可在继续编辑前撤销。</span>
                    </div>
                    <Button onClick={undoAppliedPatch}>撤销 AI 应用</Button>
                  </div>
                )}
                <Segmented
                  block
                  className="presentation-designer-inspector-tabs"
                  value={inspectTab}
                  onChange={(value) => setInspectTab(value as DesignerInspectTab)}
                  options={[
                    { value: 'content', label: '内容' },
                    { value: 'object', label: '对象' },
                    { value: 'visual', label: '图表' },
                    { value: 'notes', label: '备注' },
                  ]}
                />
                <div className="presentation-designer-inspector-mode">
                  <strong>{INSPECT_TAB_META[inspectTab].title}</strong>
                  <span>{INSPECT_TAB_META[inspectTab].detail}</span>
                </div>
                <div className="presentation-designer-inspector-panel" hidden={inspectTab !== 'object'}>
                <div className="presentation-designer-layer-panel" data-testid="aippt-layer-panel">
                  <div className="presentation-designer-schema-block__head">
                    <strong>图层</strong>
                    <Tag color="blue">{designLayers.length + customLayers.length} 对象</Tag>
                  </div>
                  <div className="presentation-designer-layer-tools" aria-label="对象对齐和分布">
                    <Tooltip title="左对齐">
                      <Button size="small" icon={<AlignLeftOutlined />} disabled={!hasEditableSelection()} onClick={() => alignSelectedElements('left')} />
                    </Tooltip>
                    <Tooltip title="水平居中">
                      <Button size="small" icon={<AlignCenterOutlined />} disabled={!hasEditableSelection()} onClick={() => alignSelectedElements('center')} />
                    </Tooltip>
                    <Tooltip title="右对齐">
                      <Button size="small" icon={<AlignRightOutlined />} disabled={!hasEditableSelection()} onClick={() => alignSelectedElements('right')} />
                    </Tooltip>
                    <Tooltip title="顶端对齐">
                      <Button size="small" icon={<VerticalAlignTopOutlined />} disabled={!hasEditableSelection()} onClick={() => alignSelectedElements('top')} />
                    </Tooltip>
                    <Tooltip title="垂直居中">
                      <Button size="small" icon={<BorderHorizontalOutlined />} disabled={!hasEditableSelection()} onClick={() => alignSelectedElements('middle')} />
                    </Tooltip>
                    <Tooltip title="底端对齐">
                      <Button size="small" icon={<VerticalAlignBottomOutlined />} disabled={!hasEditableSelection()} onClick={() => alignSelectedElements('bottom')} />
                    </Tooltip>
                    <Tooltip title="水平分布全部未锁定对象">
                      <Button size="small" icon={<ColumnWidthOutlined />} onClick={() => distributeElements('horizontal')} />
                    </Tooltip>
                    <Tooltip title="垂直分布全部未锁定对象">
                      <Button size="small" icon={<ColumnHeightOutlined />} onClick={() => distributeElements('vertical')} />
                    </Tooltip>
                  </div>
                  <div className="presentation-designer-layer-list">
                    {designLayers.map((layer) => (
                      <article
                        key={layer.key}
                        className={[
                          selectedElementKeys.includes(layer.key) ? 'is-active' : '',
                          selectedElementKey === layer.key ? 'is-primary' : '',
                        ].filter(Boolean).join(' ')}
                      >
                        {renamingLayerKey === layer.key ? (
                          <div className="presentation-designer-layer-main is-renaming">
                            <MenuOutlined />
                            <span>
                              <Input
                                size="small"
                                autoFocus
                                defaultValue={layer.name}
                                onPressEnter={(event) => {
                                  renameLayer(layer.key, event.currentTarget.value);
                                  setRenamingLayerKey(null);
                                }}
                                onBlur={(event) => {
                                  renameLayer(layer.key, event.currentTarget.value);
                                  setRenamingLayerKey(null);
                                }}
                              />
                              <em>z {Math.round(Number(layer.style.zIndex || 0))} · {layer.style.visible === false ? '隐藏' : '显示'}</em>
                            </span>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="presentation-designer-layer-main"
                            onClick={(event) => selectDesignElement(layer.key, event.shiftKey || event.metaKey || event.ctrlKey, 'object')}
                          >
                            <MenuOutlined />
                            <span>
                              <strong>{layer.name}</strong>
                              <em>z {Math.round(Number(layer.style.zIndex || 0))} · {layer.style.visible === false ? '隐藏' : '显示'}</em>
                            </span>
                          </button>
                        )}
                        <Tooltip title="重命名图层">
                          <Button
                            size="small"
                            icon={<EditOutlined />}
                            aria-label={`重命名${layer.name}`}
                            onClick={() => {
                              selectDesignElement(layer.key, false, 'object');
                              setRenamingLayerKey(layer.key);
                            }}
                          />
                        </Tooltip>
                        <Tooltip title={layer.style.visible === false ? '显示图层' : '隐藏图层'}>
                          <Button
                            size="small"
                            icon={layer.style.visible === false ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                            aria-label={`${layer.style.visible === false ? '显示' : '隐藏'}${layer.name}`}
                            onClick={() => setLayerVisibility(layer.key, layer.style.visible === false)}
                          />
                        </Tooltip>
                        <Tooltip title={layer.style.locked ? '解锁图层' : '锁定图层'}>
                          <Button
                            size="small"
                            icon={layer.style.locked ? <LockOutlined /> : <UnlockOutlined />}
                            aria-label={`${layer.style.locked ? '解锁' : '锁定'}${layer.name}`}
                            onClick={() => setLayerLocked(layer.key, !layer.style.locked)}
                          />
                        </Tooltip>
                        <Tooltip title="上移一层">
                          <Button
                            size="small"
                            aria-label={`上移${layer.name}`}
                            onClick={() => moveLayer(layer.key, 1)}
                          >
                            上
                          </Button>
                        </Tooltip>
                        <Tooltip title="下移一层">
                          <Button
                            size="small"
                            aria-label={`下移${layer.name}`}
                            onClick={() => moveLayer(layer.key, -1)}
                          >
                            下
                          </Button>
                        </Tooltip>
                      </article>
                    ))}
                    {customLayers.map((layer) => (
                      <article
                        key={layer.id}
                        className={[
                          'is-custom',
                          selectedCustomElementIds.includes(layer.id) ? 'is-active' : '',
                          selectedCustomElementId === layer.id ? 'is-primary' : '',
                        ].filter(Boolean).join(' ')}
                      >
                        <button
                          type="button"
                          className="presentation-designer-layer-main"
                          onClick={(event) => selectCustomElement(layer.id, event.shiftKey || event.metaKey || event.ctrlKey)}
                        >
                          <AppstoreAddOutlined />
                          <span>
                            <strong>{customElementDisplayName(layer)}</strong>
                            <em>{layer.type} · z {Math.round(Number(layer.zIndex || 0))} · {layer.visible === false ? '隐藏' : '显示'}</em>
                          </span>
                        </button>
                        <Tooltip title={layer.visible === false ? '显示组件' : '隐藏组件'}>
                          <Button
                            size="small"
                            icon={layer.visible === false ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                            aria-label={`${layer.visible === false ? '显示' : '隐藏'}${customElementDisplayName(layer)}`}
                            onClick={() => patchCustomElement(layer.id, { visible: layer.visible === false })}
                          />
                        </Tooltip>
                        <Tooltip title={layer.locked ? '解锁组件' : '锁定组件'}>
                          <Button
                            size="small"
                            icon={layer.locked ? <LockOutlined /> : <UnlockOutlined />}
                            aria-label={`${layer.locked ? '解锁' : '锁定'}${customElementDisplayName(layer)}`}
                            onClick={() => patchCustomElement(layer.id, { locked: !layer.locked })}
                          />
                        </Tooltip>
                        <Tooltip title="删除组件">
                          <Button
                            size="small"
                            danger
                            icon={<DeleteOutlined />}
                            aria-label={`删除${customElementDisplayName(layer)}`}
                            onClick={() => deleteCustomElement(layer.id)}
                          />
                        </Tooltip>
                        <span />
                        <span />
                      </article>
                    ))}
                  </div>
                </div>
                {selectedCustomElementStyle ? (
                  <div className="presentation-designer-object-card presentation-designer-object-card--custom">
                    <div className="presentation-designer-schema-block__head">
                      <strong>组件编辑 · {customElementDisplayName(selectedCustomElementStyle)}</strong>
                      <div>
                        {selectedCustomElements.length > 1 && <Tag color="purple">多选 {selectedCustomElements.length}</Tag>}
                        {selectedCustomElementStyle.locked && <Tag color="red">已锁定</Tag>}
                        <Tag color="blue">{selectedCustomElementStyle.type}</Tag>
                      </div>
                    </div>
                    <label className="presentation-field">
                      <span>图层名称</span>
                      <Input
                        disabled={selectedCustomElementStyle.locked}
                        value={selectedCustomElementStyle.name || ''}
                        onChange={(event) => patchCustomElement(selectedCustomElementStyle.id, { name: event.target.value })}
                      />
                    </label>
                    {selectedCustomElementStyle.type === 'text' && (
                      <label className="presentation-field">
                        <span>文本内容</span>
                        <Input.TextArea
                          disabled={selectedCustomElementStyle.locked}
                          value={selectedCustomElementStyle.content || ''}
                          rows={3}
                          onChange={(event) => patchCustomElement(selectedCustomElementStyle.id, { content: event.target.value })}
                        />
                      </label>
                    )}
                    {selectedCustomElementStyle.type === 'metric' && (
                      <div className="presentation-designer-object-grid">
                        <label className="presentation-field">
                          <span>指标名</span>
                          <Input
                            disabled={selectedCustomElementStyle.locked}
                            value={selectedCustomElementStyle.label || ''}
                            onChange={(event) => patchCustomElement(selectedCustomElementStyle.id, { label: event.target.value })}
                          />
                        </label>
                        <label className="presentation-field">
                          <span>数值</span>
                          <Input
                            disabled={selectedCustomElementStyle.locked}
                            value={String(selectedCustomElementStyle.value ?? '')}
                            onChange={(event) => patchCustomElement(selectedCustomElementStyle.id, { value: event.target.value })}
                          />
                        </label>
                      </div>
                    )}
                    {selectedCustomElementStyle.type === 'image' && (
                      <div className="presentation-designer-image-editor">
                        <div className="presentation-designer-upload-strip">
                          <Button disabled={selectedCustomElementStyle.locked} icon={<UploadOutlined />} onClick={() => imageInputRef.current?.click()}>
                            替换图片/SVG
                          </Button>
                          <span>选中图片组件后，也可以直接粘贴截图、图片文件、SVG 或图片 URL</span>
                        </div>
                        <label className="presentation-field">
                          <span>图片 URL</span>
                          <Input
                            disabled={selectedCustomElementStyle.locked}
                            value={selectedCustomElementStyle.url || ''}
                            placeholder="https://.../image.png"
                            onChange={(event) => patchCustomElement(selectedCustomElementStyle.id, { url: event.target.value })}
                          />
                        </label>
                        <label className="presentation-field">
                          <span>图片说明</span>
                          <Input
                            disabled={selectedCustomElementStyle.locked}
                            value={selectedCustomElementStyle.alt || ''}
                            placeholder="图片替代文本 / 说明"
                            onChange={(event) => patchCustomElement(selectedCustomElementStyle.id, { alt: event.target.value })}
                          />
                        </label>
                        <label className="presentation-field">
                          <span>填充方式</span>
                          <Segmented
                            disabled={selectedCustomElementStyle.locked}
                            value={selectedCustomElementStyle.fit || 'cover'}
                            onChange={(value) => patchCustomElement(selectedCustomElementStyle.id, { fit: value as SlideDesignMediaFit })}
                            options={[
                              { value: 'cover', label: '裁切铺满' },
                              { value: 'contain', label: '完整显示' },
                            ]}
                          />
                        </label>
                      </div>
                    )}
                    {selectedCustomElementStyle.type === 'shape' && (
                      <label className="presentation-field">
                        <span>形状</span>
                        <Segmented
                          disabled={selectedCustomElementStyle.locked}
                          value={selectedCustomElementStyle.shape || 'rectangle'}
                          onChange={(value) => patchCustomElement(selectedCustomElementStyle.id, { shape: value as SlideDesignCustomElement['shape'], radius: value === 'pill' ? 999 : value === 'circle' ? 999 : 8 })}
                          options={[
                            { value: 'rectangle', label: '矩形' },
                            { value: 'pill', label: '胶囊' },
                            { value: 'circle', label: '圆形' },
                          ]}
                        />
                      </label>
                    )}
                    <div className="presentation-designer-object-grid">
                      <label className="presentation-field">
                        <span>X</span>
                        <InputNumber disabled={selectedCustomElementStyle.locked} value={selectedCustomElementStyle.x} min={-20} max={120} addonAfter="%" onChange={(value) => patchCustomElement(selectedCustomElementStyle.id, { x: Number(value ?? 0) })} />
                      </label>
                      <label className="presentation-field">
                        <span>Y</span>
                        <InputNumber disabled={selectedCustomElementStyle.locked} value={selectedCustomElementStyle.y} min={-20} max={120} addonAfter="%" onChange={(value) => patchCustomElement(selectedCustomElementStyle.id, { y: Number(value ?? 0) })} />
                      </label>
                      <label className="presentation-field">
                        <span>宽</span>
                        <InputNumber disabled={selectedCustomElementStyle.locked} value={selectedCustomElementStyle.width} min={4} max={120} addonAfter="%" onChange={(value) => patchCustomElement(selectedCustomElementStyle.id, { width: Number(value ?? 4) })} />
                      </label>
                      <label className="presentation-field">
                        <span>高</span>
                        <InputNumber disabled={selectedCustomElementStyle.locked} value={selectedCustomElementStyle.height} min={3} max={120} addonAfter="%" onChange={(value) => patchCustomElement(selectedCustomElementStyle.id, { height: Number(value ?? 3) })} />
                      </label>
                      <label className="presentation-field">
                        <span>层级</span>
                        <InputNumber disabled={selectedCustomElementStyle.locked} value={selectedCustomElementStyle.zIndex} min={-100} max={1000} onChange={(value) => patchCustomElement(selectedCustomElementStyle.id, { zIndex: Number(value ?? 0) })} />
                      </label>
                      <label className="presentation-field">
                        <span>字号</span>
                        <InputNumber disabled={selectedCustomElementStyle.locked || selectedCustomElementStyle.type === 'shape' || selectedCustomElementStyle.type === 'image'} value={selectedCustomElementStyle.fontSize} min={8} max={96} addonAfter="px" onChange={(value) => patchCustomElement(selectedCustomElementStyle.id, { fontSize: Number(value ?? 8) })} />
                      </label>
                    </div>
                    <div className="presentation-designer-object-grid presentation-designer-object-grid--style">
                      <label className="presentation-field">
                        <span>文字颜色</span>
                        <Input disabled={selectedCustomElementStyle.locked || selectedCustomElementStyle.type === 'shape'} type="color" value={selectedCustomElementStyle.color || '#101828'} onChange={(event) => patchCustomElement(selectedCustomElementStyle.id, { color: event.target.value })} />
                      </label>
                      <label className="presentation-field">
                        <span>背景色</span>
                        <Input disabled={selectedCustomElementStyle.locked} placeholder="透明 / #F8FAFC" value={selectedCustomElementStyle.background || ''} onChange={(event) => patchCustomElement(selectedCustomElementStyle.id, { background: event.target.value })} />
                      </label>
                      <label className="presentation-field">
                        <span>圆角</span>
                        <InputNumber disabled={selectedCustomElementStyle.locked} value={selectedCustomElementStyle.radius} min={0} max={999} addonAfter="px" onChange={(value) => patchCustomElement(selectedCustomElementStyle.id, { radius: Number(value ?? 0) })} />
                      </label>
                      <label className="presentation-field">
                        <span>对齐</span>
                        <Segmented
                          disabled={selectedCustomElementStyle.locked || selectedCustomElementStyle.type === 'shape'}
                          value={selectedCustomElementStyle.align}
                          onChange={(value) => patchCustomElement(selectedCustomElementStyle.id, { align: value as SlideDesignElementStyle['align'] })}
                          options={[
                            { value: 'left', label: '左' },
                            { value: 'center', label: '中' },
                            { value: 'right', label: '右' },
                          ]}
                        />
                      </label>
                    </div>
                    <label className="presentation-field presentation-field--switch">
                      <span>显示组件</span>
                      <Switch
                        disabled={selectedCustomElementStyle.locked}
                        checked={selectedCustomElementStyle.visible !== false}
                        checkedChildren="显示"
                        unCheckedChildren="隐藏"
                        onChange={(checked) => patchCustomElement(selectedCustomElementStyle.id, { visible: checked })}
                      />
                    </label>
                    <label className="presentation-field presentation-field--switch">
                      <span>锁定组件</span>
                      <Switch
                        checked={selectedCustomElementStyle.locked === true}
                        checkedChildren="锁定"
                        unCheckedChildren="可编辑"
                        onChange={(checked) => patchCustomElement(selectedCustomElementStyle.id, { locked: checked })}
                      />
                    </label>
                    <Button danger icon={<DeleteOutlined />} onClick={() => deleteCustomElement(selectedCustomElementStyle.id)}>
                      删除组件
                    </Button>
                  </div>
                ) : (
                  <div className="presentation-designer-object-card">
                  <div className="presentation-designer-schema-block__head">
                    <strong>{activeSelectionKeys.length > 1 ? `多选对象 · ${activeSelectionKeys.length}` : `对象编辑 · ${designerLayerName(selectedElementKey, selectedElementStyle)}`}</strong>
                    <div>
                      {activeSelectionKeys.length > 1 && <Tag color="blue">{selectedLayerNames.join(' / ')}</Tag>}
                      {selectedElementLocked && <Tag color="red">已锁定</Tag>}
                      <Tag color={selectedDesign.mode === 'freeform' ? 'green' : 'default'}>{selectedDesign.mode === 'freeform' ? '自由画布' : '自动版式'}</Tag>
                    </div>
                  </div>
                  <div className="presentation-designer-element-picker">
                    {(Object.keys(DESIGNER_ELEMENT_LABEL) as SlideDesignElementKey[]).map((key) => (
                      <Button
                        key={key}
                        size="small"
                        type={selectedElementKey === key ? 'primary' : 'default'}
                        onClick={() => selectDesignElement(key, false, 'object')}
                      >
                        {DESIGNER_ELEMENT_LABEL[key]}
                      </Button>
                    ))}
                  </div>
                  <div className="presentation-designer-object-grid">
                    <label className="presentation-field">
                      <span>X</span>
                      <InputNumber disabled={selectedElementLocked} value={selectedElementStyle.x} min={-20} max={120} addonAfter="%" onChange={(value) => updateSelectedElementStyle(selectedElementKey, { x: Number(value ?? 0) })} />
                    </label>
                    <label className="presentation-field">
                      <span>Y</span>
                      <InputNumber disabled={selectedElementLocked} value={selectedElementStyle.y} min={-20} max={120} addonAfter="%" onChange={(value) => updateSelectedElementStyle(selectedElementKey, { y: Number(value ?? 0) })} />
                    </label>
                    <label className="presentation-field">
                      <span>宽</span>
                      <InputNumber disabled={selectedElementLocked} value={selectedElementStyle.width} min={4} max={120} addonAfter="%" onChange={(value) => updateSelectedElementStyle(selectedElementKey, { width: Number(value ?? 4) })} />
                    </label>
                    <label className="presentation-field">
                      <span>高</span>
                      <InputNumber disabled={selectedElementLocked} value={selectedElementStyle.height} min={3} max={120} addonAfter="%" onChange={(value) => updateSelectedElementStyle(selectedElementKey, { height: Number(value ?? 3) })} />
                    </label>
                    <label className="presentation-field">
                      <span>层级</span>
                      <InputNumber disabled={selectedElementLocked} value={selectedElementStyle.zIndex} min={-100} max={1000} onChange={(value) => updateSelectedElementStyle(selectedElementKey, { zIndex: Number(value ?? 0) })} />
                    </label>
                    <label className="presentation-field">
                      <span>字号</span>
                      <InputNumber disabled={selectedElementLocked} value={selectedElementStyle.fontSize} min={8} max={96} addonAfter="px" onChange={(value) => updateSelectedElementStyle(selectedElementKey, { fontSize: Number(value ?? 8) })} />
                    </label>
                    <label className="presentation-field">
                      <span>字重</span>
                      <InputNumber disabled={selectedElementLocked} value={selectedElementStyle.fontWeight} min={300} max={1000} step={50} onChange={(value) => updateSelectedElementStyle(selectedElementKey, { fontWeight: Number(value ?? 700) })} />
                    </label>
                  </div>
                  <div className="presentation-designer-object-grid presentation-designer-object-grid--style">
                    <label className="presentation-field">
                      <span>文字颜色</span>
                      <Input disabled={selectedElementLocked} type="color" value={selectedElementStyle.color || '#101828'} onChange={(event) => updateSelectedElementStyle(selectedElementKey, { color: event.target.value })} />
                    </label>
                    <label className="presentation-field">
                      <span>背景色</span>
                      <Input disabled={selectedElementLocked} placeholder="透明 / #F8FAFC" value={selectedElementStyle.background || ''} onChange={(event) => updateSelectedElementStyle(selectedElementKey, { background: event.target.value })} />
                    </label>
                    <label className="presentation-field">
                      <span>圆角</span>
                      <InputNumber disabled={selectedElementLocked} value={selectedElementStyle.radius} min={0} max={40} addonAfter="px" onChange={(value) => updateSelectedElementStyle(selectedElementKey, { radius: Number(value ?? 0) })} />
                    </label>
                    <label className="presentation-field">
                      <span>对齐</span>
                      <Segmented
                        disabled={selectedElementLocked}
                        value={selectedElementStyle.align}
                        onChange={(value) => updateSelectedElementStyle(selectedElementKey, { align: value as SlideDesignElementStyle['align'] })}
                        options={[
                          { value: 'left', label: '左' },
                          { value: 'center', label: '中' },
                          { value: 'right', label: '右' },
                        ]}
                      />
                    </label>
                  </div>
                  <label className="presentation-field presentation-field--switch">
                    <span>显示对象</span>
                    <Switch
                      disabled={selectedElementLocked}
                      checked={selectedElementStyle.visible !== false}
                      checkedChildren="显示"
                      unCheckedChildren="隐藏"
                      onChange={(checked) => updateSelectedElementStyle(selectedElementKey, { visible: checked })}
                    />
                  </label>
                  <label className="presentation-field presentation-field--switch">
                    <span>锁定对象</span>
                    <Switch
                      checked={selectedElementLocked}
                      checkedChildren="锁定"
                      unCheckedChildren="可编辑"
                      onChange={(checked) => updateSelectedElementStyle(selectedElementKey, { locked: checked }, { historyLabel: `${checked ? '锁定' : '解锁'}${DESIGNER_ELEMENT_LABEL[selectedElementKey]}` })}
                    />
                  </label>
                  {selectedElementKey === 'visual' && (
                    <div className="presentation-designer-image-editor">
                      <div className="presentation-designer-upload-strip">
                        <Button disabled={selectedElementLocked} icon={<UploadOutlined />} onClick={() => imageInputRef.current?.click()}>
                          替换图片/SVG
                        </Button>
                        <span>也可以直接粘贴截图、图片文件、SVG 或图片 URL</span>
                      </div>
                      <label className="presentation-field">
                        <span>图片 URL</span>
                        <Input
                          disabled={selectedElementLocked}
                          value={selectedMedia?.url || ''}
                          placeholder="https://.../image.png"
                          onChange={(event) => updateSelectedMedia({ url: event.target.value })}
                        />
                      </label>
                      <label className="presentation-field">
                        <span>图片说明</span>
                        <Input
                          disabled={selectedElementLocked}
                          value={selectedMedia?.alt || selectedSlide.visual || ''}
                          placeholder="图片替代文本 / 说明"
                          onChange={(event) => updateSelectedMedia({ alt: event.target.value })}
                        />
                      </label>
                      <label className="presentation-field">
                        <span>填充方式</span>
                        <Segmented
                          disabled={selectedElementLocked}
                          value={selectedMedia?.fit || 'cover'}
                          onChange={(value) => updateSelectedMedia({ fit: value as SlideDesignMediaFit })}
                          options={[
                            { value: 'cover', label: '裁切铺满' },
                            { value: 'contain', label: '完整显示' },
                          ]}
                        />
                      </label>
                    </div>
                  )}
                  </div>
                )}
                </div>
                <div className="presentation-designer-inspector-panel" hidden={inspectTab !== 'content'}>
                <label className="presentation-field">
                  <span>页面标题</span>
                  <Input value={selectedSlide.title} onChange={(event) => updateSelectedSlide({ title: event.target.value })} />
                </label>
                <label className="presentation-field">
                  <span>核心观点</span>
                  <Input.TextArea value={selectedSlide.headline} rows={2} onChange={(event) => updateSelectedSlide({ headline: event.target.value })} />
                </label>
                <label className="presentation-field">
                  <span>内容要点</span>
                  <Input.TextArea
                    value={selectedSlide.bullets.join('\n')}
                    rows={5}
                    onChange={(event) => updateSelectedBullets(event.target.value.split('\n').map((item) => item.trim()).filter(Boolean))}
                  />
                </label>
                <label className="presentation-field">
                  <span>页面版式</span>
                  <Select
                    value={selectedSlide.layout}
                    onChange={(value) => updateSelectedSlide({ layout: value as DeckLayout })}
                    options={DECK_LAYOUT_OPTIONS}
                  />
                </label>
                </div>
                <div className="presentation-designer-inspector-panel" hidden={inspectTab !== 'visual'}>
                <label className="presentation-field">
                  <span>页面视觉模板 / 图表模板</span>
                  <Select
                    value={selectedVisualSpec?.type || 'generic'}
                    onChange={(value) => setSelectedVisualType(value as VisualSpecType)}
                    optionLabelProp="title"
                    options={VISUAL_TEMPLATE_OPTIONS.map((item) => ({
                      value: item.value,
                      title: item.label,
                      label: (
                        <div className="presentation-visual-template-option">
                          <strong>{item.label}</strong>
                          <span>{item.detail}</span>
                          <em>{item.group}</em>
                        </div>
                      ),
                    }))}
                  />
                </label>
                <div className="presentation-designer-template-help">
                  <Tag color="blue">{VISUAL_TEMPLATE_LABEL[(selectedVisualSpec?.type || 'generic') as VisualSpecType]}</Tag>
                  <span>选择一个页面表达方式即可，底层结构会自动写入 Deck Schema。</span>
                </div>
                <div className="presentation-designer-edit-entry" data-testid="aippt-visual-edit-entry">
                  <strong>
                    {DATA_VISUAL_TYPES.has((selectedVisualSpec?.type || 'generic') as VisualSpecType)
                      ? '图表数据入口'
                      : selectedVisualSpec?.type === 'matrix'
                        ? '矩阵结构入口'
                        : selectedVisualSpec?.type === 'architecture'
                          ? '架构层级入口'
                          : isFlowLayout(selectedSlide.layout)
                            ? '流程节点入口'
                            : '图片/素材入口'}
                  </strong>
                  <span>
                    {DATA_VISUAL_TYPES.has((selectedVisualSpec?.type || 'generic') as VisualSpecType)
                      ? '在下方直接修改横轴、数据序列、指标卡和数据来源，右侧 Schema 会同步。'
                      : selectedVisualSpec?.type === 'matrix'
                        ? '在下方添加对比列和能力点，最终 HTML 会按矩阵模板刷新。'
                        : selectedVisualSpec?.type === 'architecture'
                          ? '在下方添加层级、职责和组件说明，最终 HTML 会按架构图刷新。'
                          : isFlowLayout(selectedSlide.layout)
                            ? '在下方维护节点名称和动作说明，同时同步页面要点。'
                            : '上传、粘贴或填写图片 URL，即可替换当前视觉区素材。'}
                  </span>
                </div>
                <label className="presentation-field">
                  <span>视觉说明</span>
                  <Input value={selectedSlide.visual} onChange={(event) => updateSelectedSlide({ visual: event.target.value })} />
                </label>
                <div className="presentation-designer-image-editor">
                  <div className="presentation-designer-upload-strip">
                    <Button icon={<UploadOutlined />} onClick={() => imageInputRef.current?.click()}>
                      替换视觉图片/SVG
                    </Button>
                    <span>用于当前页 visual 区域；粘贴截图、SVG 或图片 URL 也会写入这里。</span>
                  </div>
                  <label className="presentation-field">
                    <span>图片 URL</span>
                    <Input
                      value={selectedMedia?.url || ''}
                      placeholder="https://.../image.png"
                      onChange={(event) => updateSelectedMedia({ url: event.target.value })}
                    />
                  </label>
                  <label className="presentation-field">
                    <span>图片说明 / Alt</span>
                    <Input
                      value={selectedMedia?.alt || selectedSlide.visual || ''}
                      placeholder="图片替代文本 / 说明"
                      onChange={(event) => updateSelectedMedia({ alt: event.target.value })}
                    />
                  </label>
                  <label className="presentation-field">
                    <span>填充方式</span>
                    <Segmented
                      value={selectedMedia?.fit || 'cover'}
                      onChange={(value) => updateSelectedMedia({ fit: value as SlideDesignMediaFit })}
                      options={[
                        { value: 'cover', label: '裁切铺满' },
                        { value: 'contain', label: '完整显示' },
                      ]}
                    />
                  </label>
                </div>

                {['scorecard', 'bar', 'line', 'combo_metrics'].includes(selectedVisualSpec?.type || '') && (
                  <div className="presentation-designer-schema-block">
                    <div className="presentation-designer-schema-block__head">
                      <strong>指标与图表数据</strong>
                      <Segmented
                        size="small"
                        value={chartKind}
                        onChange={(value) => updateChartKind(value as DataChartKind)}
                        options={[
                          { value: 'scorecard', label: '数字卡' },
                          { value: 'bar', label: '柱状' },
                          { value: 'line', label: '折线' },
                        ]}
                      />
                    </div>
                    <label className="presentation-field">
                      <span>横轴/阶段标签</span>
                      <Input
                        value={chartLabels.join('，')}
                        placeholder="Q1，Q2，Q3"
                        onChange={(event) => updateSelectedVisualSpec({
                          chart: {
                            ...selectedVisualSpec?.chart,
                            kind: chartKind,
                            labels: parseDelimitedLabels(event.target.value),
                          },
                        })}
                      />
                    </label>
                    <div className="presentation-designer-chart-provenance">
                      <label className="presentation-field">
                        <span>数据来源</span>
                        <Input
                          value={selectedVisualSpec?.chart?.source || ''}
                          placeholder="如：公司经营看板、IDC 公开报告"
                          onChange={(event) => updateChartMeta({ source: event.target.value })}
                        />
                      </label>
                      <label className="presentation-field">
                        <span>统计口径</span>
                        <Input.TextArea
                          value={selectedVisualSpec?.chart?.methodology || ''}
                          rows={2}
                          placeholder="说明样本范围、统计周期、计算方式或估算方法"
                          onChange={(event) => updateChartMeta({ methodology: event.target.value })}
                        />
                      </label>
                      <label className="presentation-field presentation-field--switch">
                        <span>估算数据</span>
                        <Switch
                          checked={selectedVisualSpec?.chart?.estimated === true}
                          checkedChildren="是"
                          unCheckedChildren="否"
                          onChange={(checked) => updateChartMeta({ estimated: checked })}
                        />
                      </label>
                    </div>
                    <div className="presentation-designer-series-editor">
                      <div className="presentation-designer-schema-block__head">
                        <strong>数据序列</strong>
                        <Button size="small" icon={<PlusOutlined />} onClick={addChartSeries}>添加序列</Button>
                      </div>
                      {chartSeries.map((series, index) => (
                        <div className="presentation-designer-series-row" key={`${series.name || 'series'}-${index}`}>
                          <Input
                            value={series.name || ''}
                            placeholder="序列名"
                            onChange={(event) => patchChartSeries(index, { name: event.target.value })}
                          />
                          <Input
                            value={(series.values || []).join('，')}
                            placeholder="20，45，80"
                            onChange={(event) => patchChartSeries(index, { values: parseDelimitedNumbers(event.target.value) })}
                          />
                          <Input
                            value={series.unit || ''}
                            placeholder="单位"
                            onChange={(event) => patchChartSeries(index, { unit: event.target.value })}
                          />
                          <Button
                            danger
                            icon={<DeleteOutlined />}
                            disabled={chartSeries.length <= 1}
                            onClick={() => removeChartSeries(index)}
                          />
                        </div>
                      ))}
                    </div>
                    <div className="presentation-designer-metric-editor">
                      <div className="presentation-designer-schema-block__head">
                        <strong>指标卡</strong>
                        <Button size="small" icon={<PlusOutlined />} onClick={() => updateSelectedVisualSpec({ metrics: [...selectedMetrics, { label: '新指标', value: '待补', detail: '补充指标口径' }] })}>添加</Button>
                      </div>
                      {selectedMetrics.map((metric, index) => (
                        <div className="presentation-designer-metric-row" key={`${metric.label || metric.title}-${index}`}>
                          <Input
                            value={metric.label || metric.title}
                            placeholder="指标名"
                            onChange={(event) => {
                              const metrics: VisualSpecItem[] = [...selectedMetrics];
                              metrics[index] = { ...metric, label: event.target.value };
                              updateSelectedVisualSpec({ metrics });
                            }}
                          />
                          <Input
                            value={String(metric.value ?? '')}
                            placeholder="数值"
                            onChange={(event) => {
                              const metrics: VisualSpecItem[] = [...selectedMetrics];
                              metrics[index] = { ...metric, value: event.target.value };
                              updateSelectedVisualSpec({ metrics });
                            }}
                          />
                          <Button danger icon={<DeleteOutlined />} disabled={selectedMetrics.length <= 1} onClick={() => updateSelectedVisualSpec({ metrics: selectedMetrics.filter((_, itemIndex) => itemIndex !== index) })} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedVisualSpec?.type === 'matrix' && (
                  <div className="presentation-designer-schema-block">
                    <div className="presentation-designer-schema-block__head">
                      <strong>矩阵编辑器</strong>
                      <Button size="small" icon={<PlusOutlined />} onClick={() => addVisualSpecItem('columns', matrixColumns)}>添加列</Button>
                    </div>
                    <label className="presentation-field">
                      <span>矩阵标题</span>
                      <Input value={selectedVisualSpec.title || ''} placeholder="例如：能力对比矩阵" onChange={(event) => updateSelectedVisualSpec({ title: event.target.value })} />
                    </label>
                    <div className="presentation-designer-structured-list">
                      {matrixColumns.map((column, index) => (
                        <div className="presentation-designer-structured-row" key={`${column.label || column.title || 'column'}-${index}`}>
                          <div className="presentation-designer-structured-row__top">
                            <Input
                              value={column.label || column.title || ''}
                              placeholder="对象 / 列名"
                              onChange={(event) => patchVisualSpecItem('columns', matrixColumns, index, { label: event.target.value })}
                            />
                            <Select
                              value={typeof column.score === 'string' ? column.score : 'medium'}
                              onChange={(value) => patchVisualSpecItem('columns', matrixColumns, index, { score: value as VisualSpecItem['score'] })}
                              options={[
                                { value: 'high', label: '强' },
                                { value: 'medium', label: '中' },
                                { value: 'low', label: '弱' },
                              ]}
                            />
                          </div>
                          <Input.TextArea
                            rows={3}
                            value={specItemDetailText(column)}
                            placeholder="每行一个能力点，例如：企业级记忆"
                            onChange={(event) => {
                              const items = textToSpecItems(event.target.value);
                              patchVisualSpecItem('columns', matrixColumns, index, { items, detail: items.join('、') });
                            }}
                          />
                          <Button
                            danger
                            icon={<DeleteOutlined />}
                            disabled={matrixColumns.length <= 2}
                            onClick={() => removeVisualSpecItem('columns', matrixColumns, index)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedVisualSpec?.type === 'architecture' && (
                  <div className="presentation-designer-schema-block">
                    <div className="presentation-designer-schema-block__head">
                      <strong>架构图编辑器</strong>
                      <Button size="small" icon={<PlusOutlined />} onClick={() => addVisualSpecItem('layers', architectureLayers)}>添加层级</Button>
                    </div>
                    <label className="presentation-field">
                      <span>架构标题</span>
                      <Input value={selectedVisualSpec.title || ''} placeholder="例如：Agent 产品架构" onChange={(event) => updateSelectedVisualSpec({ title: event.target.value })} />
                    </label>
                    <div className="presentation-designer-structured-list">
                      {architectureLayers.map((layer, index) => (
                        <div className="presentation-designer-structured-row presentation-designer-structured-row--wide" key={`${layer.label || layer.title || 'layer'}-${index}`}>
                          <Input
                            value={layer.label || layer.title || ''}
                            placeholder="层级名称"
                            onChange={(event) => patchVisualSpecItem('layers', architectureLayers, index, { label: event.target.value })}
                          />
                          <Input.TextArea
                            rows={3}
                            value={specItemDetailText(layer)}
                            placeholder="职责、组件、输入输出"
                            onChange={(event) => {
                              const items = textToSpecItems(event.target.value);
                              patchVisualSpecItem('layers', architectureLayers, index, { detail: event.target.value, items });
                            }}
                          />
                          <Button
                            danger
                            icon={<DeleteOutlined />}
                            disabled={architectureLayers.length <= 2}
                            onClick={() => removeVisualSpecItem('layers', architectureLayers, index)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {isFlowLayout(selectedSlide.layout) && (
                  <div className="presentation-designer-schema-block">
                    <div className="presentation-designer-schema-block__head">
                      <strong>{selectedSlide.layout === 'timeline' ? '时间线编辑器' : selectedSlide.layout === 'checklist' ? '行动清单编辑器' : '流程节点编辑器'}</strong>
                      <Button size="small" icon={<PlusOutlined />} onClick={() => addVisualSpecItem('rows', flowRows)}>添加节点</Button>
                    </div>
                    <div className="presentation-designer-structured-list">
                      {flowRows.map((row, index) => (
                        <div className="presentation-designer-structured-row presentation-designer-structured-row--wide" key={`${row.label || row.title || 'row'}-${index}`}>
                          <Input
                            value={row.label || row.title || ''}
                            placeholder={flowRowLabel(selectedSlide.layout, index)}
                            onChange={(event) => patchVisualSpecItem('rows', flowRows, index, { label: event.target.value })}
                          />
                          <Input.TextArea
                            rows={2}
                            value={row.detail || row.items?.join('、') || ''}
                            placeholder="节点动作、时间点、责任人或产出"
                            onChange={(event) => patchVisualSpecItem('rows', flowRows, index, { detail: event.target.value })}
                          />
                          <Button
                            danger
                            icon={<DeleteOutlined />}
                            disabled={flowRows.length <= 1}
                            onClick={() => removeVisualSpecItem('rows', flowRows, index)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                </div>
                <div className="presentation-designer-inspector-panel" hidden={inspectTab !== 'notes'}>
                <label className="presentation-field">
                  <span>演讲备注</span>
                  <Input.TextArea value={selectedSlide.speakerNotes} rows={3} onChange={(event) => updateSelectedSlide({ speakerNotes: event.target.value })} />
                </label>
                <label className="presentation-field">
                  <span>高级渲染约束</span>
                  <Input.TextArea
                    value={(selectedSlide.renderHints || []).join('\n')}
                    rows={3}
                    placeholder="例如：chart=line&#10;emphasis=增长趋势（高级字段，可不填）"
                    onChange={(event) => updateSelectedSlide({ renderHints: event.target.value.split('\n').map((item) => item.trim()).filter(Boolean) })}
                  />
                </label>
                <label className="presentation-field">
                  <span>高级结构摘要（JSON，只读）</span>
                  <Input.TextArea value={compactSpecJson(selectedVisualSpec)} rows={6} readOnly />
                </label>
                </div>
              </div>
            ) : (
              <Empty description="请选择一页" />
            )}
          </section>

          <section className="presentation-designer-card presentation-designer-card--versions">
            <div className="presentation-designer-page__section-head">
              <strong>版本历史</strong>
              <Button size="small" onClick={() => void loadVersions()}>刷新</Button>
            </div>
            <div className="presentation-designer-version-list">
              {versions.length ? versions.map((version) => (
                <article key={version.id}>
                  <div>
                    <b>v{version.version_no}</b>
                    <span>{version.change_summary || 'Designer schema 版本'}</span>
                    <em>{version.created_at ? new Date(version.created_at).toLocaleString() : ''}</em>
                  </div>
                  <Button size="small" onClick={() => void restoreVersion(version)}>回退</Button>
                </article>
              )) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无保存版本" />
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
