import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  applyNodeChanges,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Button,
  Drawer,
  Input,
  InputNumber,
  Modal,
  Radio,
  Progress,
  Segmented,
  Select,
  Slider,
  Tag,
  Tooltip,
  message,
} from 'antd';
import {
  ApartmentOutlined,
  BarChartOutlined,
  BookOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  FilePptOutlined,
  FullscreenOutlined,
  FundProjectionScreenOutlined,
  GlobalOutlined,
  HighlightOutlined,
  LockOutlined,
  NodeIndexOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ProfileOutlined,
  RobotOutlined,
  SaveOutlined,
  StopOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import {
  OPENATLAS_AIPPT_AGENT_ADAPTER,
  OPENATLAS_AIPPT_RESEARCH_ADAPTER,
  OPENATLAS_AIPPT_STORAGE_ADAPTER,
} from '../features/aippt/openatlas-adapters';
import type { AipptDeckDocument } from '../features/aippt/adapters';
import {
  DECK_LAYOUT_OPTIONS,
  STATUS_COLOR,
  STATUS_LABEL,
  USE_CASE_LABEL,
  VISUAL_SPEC_TYPE_OPTIONS,
  chartKindFromSlide,
  chartKindFromVisualType,
  compactSpecJson,
  designerMetricsFromSlide,
  inferArchitectureLayers,
  inferMatrixColumns,
  inferSlideLayout,
  normalizePlanLayouts,
  parseDelimitedLabels,
  parseDelimitedNumbers,
  parseSpecItemsFromEditorText,
  specItemsToEditorText,
  splitEditorDetail,
  visualSpecOfSlide,
  visualTypeToLayout,
  withChartHint,
  type DataChartKind,
  type DeckConfig,
  type DeckLayout,
  type DeckPlan,
  type DeckSection,
  type DeckSlide,
  type DeckUseCase,
  type KnowledgeCard,
  type SlideStatus,
  type SlideVisualSpec,
  type VisualSpecType,
} from '../features/aippt/schema';
import {
  STYLE_PRESETS,
  preferredStyle,
  styleName,
  type AipptStylePreset,
} from '../features/aippt/styles';
import {
  GENERIC_OPERATIONS_DEMO_PROMPT,
  OPENATLAS_INVESTOR_DEMO_PROMPT,
  buildGenericOperationsDemo,
  buildOpenAtlasInvestorDemo,
} from '../features/aippt/fixtures';
import { downloadText, safeFileTitle } from '../features/aippt/browser';
import {
  realSlidesOfPlan,
  useAipptCanvasController,
} from '../features/aippt/use-canvas-controller';
import '../styles/presentation-canvas.css';

export {
  DATA_CHART_LABEL,
  DECK_LAYOUT_OPTIONS,
  STATUS_COLOR,
  STATUS_LABEL,
  USE_CASE_LABEL,
  VISUAL_SPEC_TYPE_OPTIONS,
  chartKindFromSlide,
  chartKindFromVisualType,
  compactSpecJson,
  designerMetricsFromSlide,
  inferArchitectureLayers,
  inferMatrixColumns,
  layoutFromVisualSpec,
  metricDataFromBullets,
  metricDataFromVisualSpec,
  normalizePlanLayouts,
  normalizeVisualSpec,
  parseDelimitedLabels,
  parseDelimitedNumbers,
  parseSpecItemsFromEditorText,
  scheduledLayoutForSlide,
  specItemsToEditorText,
  splitEditorDetail,
  splitSpecItems,
  validateDeckSchema,
  visualSpecOfSlide,
  visualTypeToLayout,
  withChartHint,
} from '../features/aippt/schema';
export type {
  DataChartKind,
  DeckAspectRatio,
  DeckChartLevel,
  DeckConfig,
  DeckDensity,
  DeckLayout,
  DeckPlan,
  DeckSchemaIssue,
  DeckSchemaIssueLevel,
  DeckSection,
  DeckStyleKey,
  DeckUseCase,
  KnowledgeCard,
  MetricDatum,
  SlideStatus,
  SlideVisualSpec,
  VisualSpecChart,
  VisualSpecItem,
  VisualSpecType,
} from '../features/aippt/schema';
export { buildHtmlDeck } from '../features/aippt/renderer';
export type { DeckRenderStyle } from '../features/aippt/renderer';
export {
  STYLE_PRESETS,
  preferredStyle,
  selectedStyle,
  styleName,
} from '../features/aippt/styles';
export type { AipptStylePreset as DeckStylePreset } from '../features/aippt/styles';
export {
  OPENATLAS_INVESTOR_DEMO_PROMPT,
  buildOpenAtlasInvestorDemo,
} from '../features/aippt/fixtures';
export { downloadText, safeFileTitle } from '../features/aippt/browser';

type NodeKind = 'config' | 'section' | 'slide' | 'knowledge';

type DeckStylePreset = AipptStylePreset;

interface DeckNodeData extends Record<string, unknown> {
  kind: NodeKind;
  title: string;
  subtitle?: string;
  status?: SlideStatus | KnowledgeCard['status'];
  index?: number;
  slide?: DeckSlide;
  knowledge?: KnowledgeCard;
  accent?: string;
}

const STYLE_ICON: Record<AipptStylePreset['key'], React.ReactNode> = {
  executive_blue: <ProfileOutlined />,
  tech_launch: <ThunderboltOutlined />,
  teaching_clear: <BookOutlined />,
};

const EXAMPLES = [
  '帮我做一份 InsightLab 数智员工产品汇报，面向企业 CIO，20 分钟，突出落地价值和下一步计划',
  '做一份 AI2UI 平台路演稿，面向生态伙伴，强调市场机会、产品差异和商业化路径',
  '生成一套面向内部顾问的 A2UI 使用培训课件，包含案例、流程和练习',
  OPENATLAS_INVESTOR_DEMO_PROMPT,
  GENERIC_OPERATIONS_DEMO_PROMPT,
];

const DEFAULT_CONFIG: DeckConfig = {
  topic: 'InsightLab 数智员工产品汇报',
  useCase: 'report',
  aspectRatio: '16:9',
  styleKey: 'executive_blue',
  audience: '企业管理层',
  durationMinutes: 20,
  pageCount: 8,
  density: 'standard',
  chartLevel: 'balanced',
  speakerNotes: true,
};

function normalizeTopic(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_CONFIG.topic;
  const cleaned = trimmed
    .replace(/^(好的|好|请|麻烦|帮我|我想|需要)?\s*(做|制作|设计|生成|输出|来|准备)?\s*一?(份|套|个)?\s*/u, '')
    .replace(/(PPT|ppt|演示文稿|幻灯片|课件|汇报材料|路演稿)/gu, '')
    .replace(/[，。,.；;：:]+$/u, '')
    .trim();
  const topic = cleaned.split(/[，,；;。]\s*(面向|给|为|时长|用时|突出|强调|包含|包括|\d{1,3}\s*(分钟|min|mins|minute|minutes))/iu)[0]?.trim();
  return topic || cleaned || trimmed;
}

function inferUseCase(query: string): DeckUseCase {
  if (/培训|课程|课件|学员|学习|教学|练习|考试|认证/u.test(query)) return 'training';
  if (/路演|融资|投资|发布会|推介|招商|生态伙伴|商业化|增长|愿景/u.test(query)) return 'roadshow';
  return 'report';
}

function inferAudience(query: string, useCase: DeckUseCase) {
  const match = query.match(/面向([^，。,.；;]{2,24})/u) || query.match(/给([^，。,.；;]{2,24})(看|汇报|培训|介绍)/u);
  if (match?.[1]) return match[1].trim();
  if (useCase === 'roadshow') return '投资人 / 客户 / 生态伙伴';
  if (useCase === 'training') return '内部员工 / 客户学员';
  return '管理层 / 客户负责人';
}

function inferDuration(query: string) {
  const match = query.match(/(\d{1,3})\s*(分钟|min|mins|minute|minutes)/iu);
  if (!match) return DEFAULT_CONFIG.durationMinutes;
  return Math.max(8, Math.min(90, Number(match[1])));
}

function inferPageCount(query: string, useCase: DeckUseCase, durationMinutes: number) {
  const explicit = query.match(/(\d{1,2})\s*(页|p|P)/u);
  const base = useCase === 'training' ? 12 : useCase === 'roadshow' ? 10 : 8;
  if (explicit) {
    const explicitCount = Math.max(8, Math.min(40, Number(explicit[1])));
    const start = explicit.index || 0;
    const qualifier = query.slice(Math.max(0, start - 8), start + explicit[0].length);
    return /不少于|至少|不低于/u.test(qualifier) ? Math.max(base, explicitCount) : explicitCount;
  }
  return Math.max(8, Math.min(30, Math.max(base, Math.round(durationMinutes / 2))));
}

function inferConfigFromPrompt(prompt: string): DeckConfig {
  const useCase = inferUseCase(prompt);
  const durationMinutes = inferDuration(prompt);
  return {
    ...DEFAULT_CONFIG,
    topic: normalizeTopic(prompt),
    useCase,
    styleKey: preferredStyle(useCase),
    audience: inferAudience(prompt, useCase),
    durationMinutes,
    pageCount: inferPageCount(prompt, useCase, durationMinutes),
    aspectRatio: /3\s*[:：]\s*1|超宽|大屏|展厅/u.test(prompt) ? '3:1' : '16:9',
    density: /密集|详细|完整/u.test(prompt) ? 'dense' : /简洁|极简/u.test(prompt) ? 'clean' : 'standard',
    chartLevel: /图表多|多图表|数据丰富/u.test(prompt) ? 'rich' : /少图|少量图表/u.test(prompt) ? 'light' : 'balanced',
  };
}

function makeKnowledge(config: DeckConfig): KnowledgeCard[] {
  const shared: KnowledgeCard[] = [
    {
      id: 'k-topic',
      title: '主题背景',
      source: '用户需求',
      detail: config.topic,
      status: 'ready',
    },
    {
      id: 'k-audience',
      title: '受众画像',
      source: 'A2UI 配置卡',
      detail: config.audience,
      status: 'ready',
    },
    {
      id: 'k-data',
      title: '业务数据',
      source: '待接入知识库',
      detail: config.chartLevel === 'rich' ? '建议补充指标、客户案例和转化数据。' : '如有关键指标，可在右侧逐页补充。',
      status: config.chartLevel === 'rich' ? 'missing' : 'assumption',
    },
  ];
  if (config.useCase === 'training') {
    shared.push({
      id: 'k-exercise',
      title: '练习素材',
      source: '培训任务',
      detail: '建议补充真实案例、操作截图或课后练习。',
      status: 'assumption',
    });
  }
  if (config.useCase === 'roadshow') {
    shared.push({
      id: 'k-market',
      title: '市场与竞品',
      source: '外部资料',
      detail: '建议补充市场规模、竞品对比或客户证言。',
      status: 'missing',
    });
  }
  return shared;
}

function slideSeeds(config: DeckConfig) {
  if (config.useCase === 'roadshow') {
    return [
      ['开场', '封面：定义这次机会', '用一句话说明主题和价值主张', '品牌化主视觉，突出产品与机会'],
      ['开场', '为什么是现在', '说明市场、技术和客户需求共同进入窗口期', '趋势曲线或三因素交汇图'],
      ['问题', '客户正在承受什么成本', '把痛点转化为可感知的业务损耗', '痛点矩阵'],
      ['机会', '机会空间与切入点', '说明目标客群和可获得市场', '市场分层图'],
      ['方案', '我们的解决方案', '展示产品如何从理解需求到交付结果', '产品能力架构图'],
      ['方案', '核心差异化', '用三点说明为什么我们更适合这个场景', '差异化对比表'],
      ['证明', '典型使用路径', '讲清楚用户从输入到结果的完整体验', '旅程图'],
      ['证明', '案例与效果', '用可验证结果增强可信度', '案例卡 + 指标'],
      ['商业', '商业模式与增长路径', '说明收入来源、扩展方式和增长假设', '增长飞轮'],
      ['落地', '合作方式', '给出清晰试点、交付和共创路径', '合作流程'],
      ['落地', '下一步行动', '明确希望听众采取的动作', '行动清单'],
      ['收束', '结束页', '回到愿景和行动号召', '强记忆点结束页'],
    ];
  }
  if (config.useCase === 'training') {
    return [
      ['导入', '课程封面', '明确学习主题、对象和目标', '课程路径主视觉'],
      ['导入', '学习目标', '让学员知道学完能做什么', '目标清单'],
      ['认知', '概念框架', '解释核心概念及其边界', '概念地图'],
      ['认知', '为什么需要它', '连接业务痛点与学习动机', '问题场景图'],
      ['方法', '标准流程', '拆解从输入到输出的操作步骤', '流程图'],
      ['方法', '关键操作一', '展开第一个关键动作和判断标准', '步骤卡'],
      ['方法', '关键操作二', '展开第二个关键动作和常见误区', '对照表'],
      ['示例', '完整案例演示', '用真实场景串起整个方法', '案例分镜'],
      ['练习', '课堂练习', '让学员完成可检查的产出', '练习任务卡'],
      ['评估', '检查清单', '提供自检标准和质量门槛', '检查表'],
      ['总结', '知识回顾', '回收关键知识点', '三段式总结'],
      ['总结', '下一步实践', '给出课后行动和资料入口', '行动路径'],
    ];
  }
  return [
    ['摘要', '封面与汇报目标', '说明本次汇报要解决的问题和结论范围', '正式封面'],
    ['摘要', '核心结论', '用三条结论先给管理层答案', '结论卡片'],
    ['背景', '当前背景', '描述业务环境、目标和约束', '背景分层图'],
    ['现状', '关键现状与问题', '把现状归纳为可决策的问题', '问题矩阵'],
    ['分析', '原因分析', '拆解问题背后的结构性原因', '因果链路图'],
    ['方案', '建议方案', '提出可执行的方案框架', '方案架构图'],
    ['方案', '实施路径', '明确阶段、负责人和里程碑', '路线图'],
    ['数据', '预期收益', '说明效率、成本、体验或风险收益', '指标卡'],
    ['风险', '风险与应对', '提前说明风险和缓释措施', '风险矩阵'],
    ['行动', '下一步计划', '给出需要确认的决策和动作', '行动清单'],
  ];
}

function buildBullets(config: DeckConfig, title: string, index: number) {
  const density = config.density === 'dense' ? 4 : 3;
  const common = [
    `围绕「${config.topic}」收敛本页核心信息。`,
    `面向${config.audience}，保留可决策、可执行的表达。`,
    config.chartLevel === 'light' ? '以清晰观点为主，少量图形辅助。' : '建议搭配关键数据或示意图强化可信度。',
    `本页应服务于${USE_CASE_LABEL[config.useCase]}场景中的推进节奏。`,
  ];
  if (/结论|核心/u.test(title)) {
    common[0] = '先给出判断，再补充依据，避免听众等待答案。';
  }
  if (/练习|实践/u.test(title)) {
    common[0] = '给出明确任务、产出要求和评价标准。';
  }
  if (/机会|商业|增长/u.test(title)) {
    common[0] = '把机会、能力和收益放在同一条逻辑链上。';
  }
  return common.slice(0, density).map((item, offset) => `${index}.${offset + 1} ${item}`);
}

function buildDeckPlan(config: DeckConfig): DeckPlan {
  const seeds = slideSeeds(config);
  const target = Math.max(8, config.pageCount);
  const knowledge = makeKnowledge(config);
  const expanded = Array.from({ length: target }, (_, index) => (
    seeds[index] || [
      '扩展',
      `扩展专题 ${index - seeds.length + 1}`,
      `围绕${config.topic}补充一个必要专题。`,
      '专题分析图',
    ]
  ));
  const sections: DeckSection[] = [];
  const sectionIdMap = new Map<string, string>();
  expanded.forEach((seed, index) => {
    const sectionTitle = seed[0];
    if (!sectionIdMap.has(sectionTitle)) {
      const id = `section-${sectionIdMap.size + 1}`;
      sectionIdMap.set(sectionTitle, id);
      sections.push({
        id,
        title: sectionTitle,
        purpose: `承接第 ${index + 1} 页后的叙事推进。`,
      });
    }
  });
  const slides = expanded.map((seed, index): DeckSlide => {
    const title = seed[1];
    const sectionId = sectionIdMap.get(seed[0]) || sections[0]?.id || 'section-1';
    const layout = inferSlideLayout(title, seed[3], index + 1, config.useCase);
    return {
      id: `slide-${index + 1}`,
      sectionId,
      index: index + 1,
      title,
      headline: seed[2],
      bullets: buildBullets(config, title, index + 1),
      visual: seed[3],
      layout,
      knowledgeIds: [
        'k-topic',
        index % 3 === 0 ? 'k-audience' : index % 3 === 1 ? 'k-data' : knowledge[3]?.id || 'k-topic',
      ],
      status: index < 2 ? 'confirmed' : 'draft',
      speakerNotes: `讲述时先点明本页与「${config.topic}」的关系，再展开 ${seed[2]}。`,
    };
  });
  return {
    title: `${config.topic}｜${USE_CASE_LABEL[config.useCase]}演示`,
    sections,
    slides,
    knowledge,
    generatedAt: new Date().toISOString(),
  };
}

function buildStreamingSeedPlan(config: DeckConfig, placeholderCount = 1, statusMessage = 'Hermes 正在拆解章节、页面和知识依赖。'): DeckPlan {
  const target = Math.max(8, Math.min(40, Number(config.pageCount) || 8));
  const count = Math.max(1, Math.min(target, placeholderCount));
  const placeholderLayouts: DeckLayout[] = ['cover', 'two_column', 'diagram', 'compare', 'timeline', 'process'];
  return {
    title: `${config.topic} · 画布生成中`,
    sections: [
      {
        id: 'section-streaming',
        title: '规划中',
        purpose: statusMessage,
      },
    ],
    slides: Array.from({ length: count }, (_, index): DeckSlide => ({
      id: `stream-placeholder-${index + 1}`,
      sectionId: 'section-streaming',
      index: index + 1,
      title: index === 0 ? '需求理解中' : `规划第 ${index + 1} 页`,
      headline: index === 0
        ? 'Hermes 正在把需求拆成可编辑画布节点。'
        : '等待真实页面标题、观点和知识依赖回填。',
      bullets: [
        index === 0 ? `主题：${config.topic}` : '页面结构生成中',
        `受众：${config.audience}`,
        `风格：${styleName(config.styleKey)}`,
      ],
      visual: '流式占位节点，真实大纲返回后自动替换',
      layout: placeholderLayouts[index % placeholderLayouts.length],
      knowledgeIds: ['k-topic'],
      status: 'draft',
      speakerNotes: statusMessage,
      designIntent: '用于在真实大纲返回前显示 A2UI 画布生成进度。',
      renderHints: ['emphasis=生成中', 'callout=等待 Hermes 返回真实节点'],
      evidenceRole: '等待 Agent 识别资料依赖。',
    })),
    knowledge: makeKnowledge(config).slice(0, 1),
    generatedAt: new Date().toISOString(),
  };
}

function firstNodeIdOfPlan(nextPlan: DeckPlan | null) {
  if (!nextPlan) return 'config-pending';
  return nextPlan.slides[0]?.id || nextPlan.sections[0]?.id || nextPlan.knowledge[0]?.id || 'config-pending';
}

function planHasNode(nextPlan: DeckPlan | null, nodeId: string | null) {
  if (!nextPlan || !nodeId) return false;
  return nextPlan.slides.some((slide) => slide.id === nodeId)
    || nextPlan.sections.some((section) => section.id === nodeId)
    || nextPlan.knowledge.some((item) => item.id === nodeId);
}

function buildResearchContextPrompt(knowledge: KnowledgeCard, slide: DeckSlide | null, config: DeckConfig, userPrompt: string) {
  const useCase = USE_CASE_LABEL[config.useCase] || '演示';
  if (!slide) {
    return [
      `研究任务：为「${config.topic}」补充演示资料。`,
      `场景：${useCase}；受众：${config.audience}；风格：${styleName(config.styleKey)}。`,
      `资料卡：${knowledge.title}；当前说明：${knowledge.detail}`,
      `用户原始需求：${userPrompt}`,
    ].join('\n');
  }
  return [
    `研究任务：为「${config.topic}」第 ${slide.index} 页「${slide.title}」补充可信资料，并返回可用于画布的知识卡和页面修改建议。`,
    `场景：${useCase}；受众：${config.audience}；版式：${slide.layout}；视觉表达：${slide.visual}。`,
    `页面主张：${slide.headline}`,
    `当前要点：${slide.bullets.join('；')}`,
    slide.designIntent ? `设计意图：${slide.designIntent}` : '',
    slide.evidenceRole ? `证据需求：${slide.evidenceRole}` : '',
    slide.renderHints?.length ? `渲染提示：${slide.renderHints.join('；')}` : '',
    `资料卡：${knowledge.title}；当前说明：${knowledge.detail}`,
    '优先补充权威来源、官方材料、研究报告、案例、产品截图或可引用数据；没有稳定来源时不要编造数字。',
    `用户原始需求：${userPrompt}`,
  ].filter(Boolean).join('\n');
}

function buildKnowledgeTaskDetail(config: DeckConfig, slide: DeckSlide, mode: 'missing' | 'manual') {
  const useCase = USE_CASE_LABEL[config.useCase] || '演示';
  const base = mode === 'missing'
    ? '需要补充可引用的数据、案例、截图、研究报告或官方资料。'
    : '请补充该页需要引用的数据、案例、截图、研究报告或官方资料。';
  return [
    base,
    `研究目标：支撑「${slide.title}」中的「${slide.headline}」。`,
    `上下文：主题「${config.topic}」，场景「${useCase}」，受众「${config.audience}」，版式「${slide.layout}」，视觉表达「${slide.visual}」。`,
    slide.evidenceRole ? `优先证据：${slide.evidenceRole}。` : '优先证据：权威来源、真实案例、可引用数据或图表素材。',
    slide.designIntent ? `设计意图：${slide.designIntent}。` : '',
  ].filter(Boolean).join('\n');
}

function SectionNode({ data, selected }: NodeProps<Node<DeckNodeData>>) {
  return (
    <div className={`presentation-node presentation-node--section ${selected ? 'is-selected' : ''}`}>
      <Handle className="presentation-handle" type="source" position={Position.Right} />
      <span>{data.index}</span>
      <strong>{data.title}</strong>
      <em>{data.subtitle}</em>
    </div>
  );
}

function SlideNode({ data, selected }: NodeProps<Node<DeckNodeData>>) {
  const slide = data.slide;
  return (
    <div className={`presentation-node presentation-node--slide ${selected ? 'is-selected' : ''}`}>
      <Handle className="presentation-handle" type="target" position={Position.Left} />
      <Handle className="presentation-handle" type="source" position={Position.Right} />
      <div className="presentation-node__head">
        <span>Slide {slide?.index}</span>
        {slide?.status && <Tag color={STATUS_COLOR[slide.status]}>{STATUS_LABEL[slide.status]}</Tag>}
      </div>
      <strong>{data.title}</strong>
      <p>{data.subtitle}</p>
      <div className="presentation-node__meta">
        <em>{deckLayoutLabel(slide?.layout)}</em>
        <em>{slideVisualLabel(slide)}</em>
      </div>
    </div>
  );
}

function KnowledgeNode({ data, selected }: NodeProps<Node<DeckNodeData>>) {
  const status = data.status as KnowledgeCard['status'];
  return (
    <div className={`presentation-node presentation-node--knowledge ${selected ? 'is-selected' : ''}`}>
      <Handle className="presentation-handle" type="target" position={Position.Left} />
      <div className="presentation-node__head">
        <span>Knowledge</span>
        <Tag color={status === 'ready' ? 'success' : status === 'missing' ? 'warning' : 'default'}>
          {status === 'ready' ? '可用' : status === 'missing' ? '缺资料' : '假设'}
        </Tag>
      </div>
      <strong>{data.title}</strong>
      <p>{data.subtitle}</p>
    </div>
  );
}

function ConfigNode({ data, selected }: NodeProps<Node<DeckNodeData>>) {
  return (
    <div className={`presentation-node presentation-node--config ${selected ? 'is-selected' : ''}`}>
      <div className="presentation-node__head">
        <span>AI2UI Config</span>
        <Tag color="blue">待确认</Tag>
      </div>
      <strong>{data.title}</strong>
      <p>{data.subtitle}</p>
    </div>
  );
}

function deckLayoutLabel(layout?: DeckLayout) {
  return DECK_LAYOUT_OPTIONS.find((item) => item.value === layout)?.label || '自动版式';
}

function slideVisualLabel(slide?: DeckSlide) {
  if (!slide) return '视觉待定';
  const visualType = visualSpecOfSlide(slide).type || 'generic';
  const typeLabel = VISUAL_SPEC_TYPE_OPTIONS.find((item) => item.value === visualType)?.label || '常规';
  if (visualType !== 'generic') return typeLabel;
  return slide.visual || '常规视觉';
}

const nodeTypes = {
  section: SectionNode,
  slide: SlideNode,
  knowledge: KnowledgeNode,
  config: ConfigNode,
};

function buildFlow(plan: DeckPlan | null, config: DeckConfig, style: DeckStylePreset): { nodes: Node<DeckNodeData>[]; edges: Edge[] } {
  if (!plan) {
    return {
      nodes: [
        {
          id: 'config-pending',
          type: 'config',
          position: { x: 60, y: 80 },
          data: {
            kind: 'config',
            title: '配置确认卡',
            subtitle: `${USE_CASE_LABEL[config.useCase]} · ${config.aspectRatio} · ${style.name}`,
            accent: style.tokens.primary,
          },
        },
      ],
      edges: [],
    };
  }
  const nodes: Node<DeckNodeData>[] = [];
  const edges: Edge[] = [];
  const sectionGroups = plan.sections.map((section) => ({
    section,
    slides: plan.slides.filter((slide) => slide.sectionId === section.id),
  }));
  sectionGroups.forEach((group, sectionIndex) => {
    const y = sectionIndex * 260 + 50;
    nodes.push({
      id: group.section.id,
      type: 'section',
      position: { x: 40, y },
      data: {
        kind: 'section',
        title: group.section.title,
        subtitle: group.section.purpose,
        index: sectionIndex + 1,
        accent: style.tokens.primary,
      },
    });
    group.slides.forEach((slide, slideIndex) => {
      const x = 290 + slideIndex * 285;
      nodes.push({
        id: slide.id,
        type: 'slide',
        position: { x, y: y - 16 },
        data: {
          kind: 'slide',
          title: slide.title,
          subtitle: slide.headline,
          slide,
          status: slide.status,
          accent: style.tokens.accent,
        },
      });
      edges.push({
        id: `${group.section.id}-${slide.id}`,
        source: group.section.id,
        target: slide.id,
        animated: slide.status === 'draft',
        style: { stroke: style.tokens.primary },
      });
      const knowledgeId = slide.knowledgeIds[1] || slide.knowledgeIds[0];
      if (knowledgeId) {
        edges.push({
          id: `${slide.id}-${knowledgeId}`,
          source: slide.id,
          target: knowledgeId,
          style: { stroke: 'rgba(100, 116, 139, 0.45)', strokeDasharray: '5 5' },
        });
      }
    });
  });
  const maxSlides = Math.max(...sectionGroups.map((group) => group.slides.length), 1);
  plan.knowledge.forEach((item, index) => {
    nodes.push({
      id: item.id,
      type: 'knowledge',
      position: { x: 340 + maxSlides * 285, y: index * 155 + 58 },
      data: {
        kind: 'knowledge',
        title: item.title,
        subtitle: `${item.source} · ${item.detail}`,
        knowledge: item,
        status: item.status,
      },
    });
  });
  return { nodes, edges };
}

export default function PresentationCanvas() {
  const [messageApi, contextHolder] = message.useMessage();
  const [modalApi, modalContextHolder] = Modal.useModal();
  const navigate = useNavigate();
  const {
    prompt,
    setPrompt,
    config,
    setConfig,
    plan,
    setPlan,
    activeDeckId,
    setActiveDeckId,
    selectedNodeId,
    setSelectedNodeId,
    selectedSlideId,
    setSelectedSlideId,
    generating,
    setGenerating,
    deckStage,
    setDeckStage,
    streamMessage,
    setStreamMessage,
    setGenerationStage,
    outlineConfirmed,
    setOutlineConfirmed,
    deckBuildProgress,
    setDeckBuildProgress,
    deckBuildMessage,
    setDeckBuildMessage,
    recentDecks,
    setRecentDecks,
    loadingDeckId,
    setLoadingDeckId,
    researchingKnowledgeId,
    setResearchingKnowledgeId,
    generationMeta,
    setGenerationMeta,
    style,
    htmlDeck,
    selectedSlide,
    selectedVisualSpec,
    selectedDesignerMetrics,
    selectedDesignerChartRows,
    selectedDesignerSection,
    selectedSlideKnowledge,
    deckBuilding,
    realSlides,
    canConfirmOutline,
    canGenerateDeck,
    canPreviewDeck,
    stageLabel,
    outlineTargetSlides,
    outlineProgressPercent,
    outlineProgressText,
  } = useAipptCanvasController({
    initialPrompt: EXAMPLES[0],
    initialConfig: inferConfigFromPrompt(EXAMPLES[0]),
  });
  const [previewOpen, setPreviewOpen] = useState(false);
  const [designerOpen, setDesignerOpen] = useState(false);
  const [recentDrawerOpen, setRecentDrawerOpen] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const previewFrameRef = useRef<HTMLIFrameElement>(null);
  const generationAbortRef = useRef<AbortController | null>(null);
  const deckBuildTimersRef = useRef<number[]>([]);
  const generatedFlow = useMemo(() => buildFlow(plan, config, style), [config, plan, style]);
  const [flowNodes, setFlowNodes] = useState<Node<DeckNodeData>[]>(generatedFlow.nodes);
  const selectedNode = useMemo(() => flowNodes.find((node) => node.id === selectedNodeId) || null, [flowNodes, selectedNodeId]);
  const selectedKnowledge = useMemo(() => (
    selectedNode?.data.kind === 'knowledge'
      ? plan?.knowledge.find((item) => item.id === selectedNode.id) || null
      : null
  ), [plan?.knowledge, selectedNode]);

  const reloadRecentDecks = useCallback(async () => {
    try {
      const rows = await OPENATLAS_AIPPT_STORAGE_ADAPTER.listDecks();
      setRecentDecks(rows);
    } catch {
      // Recent decks are helpful, not required for generating AIPPT.
    }
  }, []);

  useEffect(() => {
    void reloadRecentDecks();
  }, [reloadRecentDecks]);

  useEffect(() => {
    setFlowNodes((previousNodes) => {
      const positionById = new Map(previousNodes.map((node) => [node.id, node.position]));
      return generatedFlow.nodes.map((node) => ({
        ...node,
        position: positionById.get(node.id) || node.position,
        selected: node.id === selectedNodeId,
      }));
    });
  }, [generatedFlow.nodes, selectedNodeId]);

  const onNodesChange = useCallback((changes: NodeChange<Node<DeckNodeData>>[]) => {
    setFlowNodes((nodes) => applyNodeChanges(changes, nodes));
  }, []);

  useEffect(() => () => {
    generationAbortRef.current?.abort();
    deckBuildTimersRef.current.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const analyzePrompt = () => {
    deckBuildTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    deckBuildTimersRef.current = [];
    const next = inferConfigFromPrompt(prompt);
    setConfig(next);
    setPlan(null);
    setActiveDeckId(null);
    setGenerationMeta(null);
    setDeckStage('config');
    setStreamMessage('');
    setOutlineConfirmed(false);
    setDeckBuildProgress(0);
    setDeckBuildMessage('');
    setSelectedNodeId('config-pending');
    setSelectedSlideId(null);
    setDesignerOpen(false);
    messageApi.success('已生成 A2UI 配置确认卡');
  };

  const loadOpenAtlasInvestorDemo = () => {
    generationAbortRef.current?.abort();
    deckBuildTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    deckBuildTimersRef.current = [];
    const demo = buildOpenAtlasInvestorDemo();
    const firstSlideId = demo.plan.slides[0]?.id || null;
    setPrompt(OPENATLAS_INVESTOR_DEMO_PROMPT);
    setConfig(demo.config);
    setPlan(demo.plan);
    setActiveDeckId(null);
    setGenerationMeta({
      source: 'rich-demo',
      model: 'visualSpec-reference',
      warnings: ['样例数字为演示口径，正式融资材料需替换为真实经营数据。'],
    });
    setDeckStage('deck_ready');
    setGenerating(false);
    setGenerationStage('rich_demo_ready');
    setStreamMessage('已载入 InsightLab 融资汇报富图表样例，可直接预览 PPT 初稿或继续编辑画布节点。');
    setOutlineConfirmed(true);
    setDeckBuildProgress(100);
    setDeckBuildMessage('富图表 PPT 初稿样例已生成：12 页，包含折线、柱状、指标卡、架构图和对比矩阵。');
    setSelectedSlideId(firstSlideId);
    setSelectedNodeId(firstNodeIdOfPlan(demo.plan));
    messageApi.success('已载入 InsightLab 融资汇报富图表样例');
  };

  const loadGenericOperationsDemo = () => {
    generationAbortRef.current?.abort();
    deckBuildTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    deckBuildTimersRef.current = [];
    const demo = buildGenericOperationsDemo();
    const firstSlideId = demo.plan.slides[0]?.id || null;
    setPrompt(GENERIC_OPERATIONS_DEMO_PROMPT);
    setConfig(demo.config);
    setPlan(demo.plan);
    setActiveDeckId(null);
    setGenerationMeta({
      source: 'neutral-demo',
      model: 'visualSpec-reference',
      warnings: ['样例数字为中性演示口径，正式汇报需替换为真实运营数据。'],
    });
    setDeckStage('deck_ready');
    setGenerating(false);
    setGenerationStage('neutral_demo_ready');
    setStreamMessage('已载入企业知识库运营升级中性样例，可直接预览 PPT 初稿或继续编辑画布节点。');
    setOutlineConfirmed(true);
    setDeckBuildProgress(100);
    setDeckBuildMessage('中性 PPT 初稿样例已生成：8 页，包含柱状图、指标卡、架构图、对比矩阵和实施时间线。');
    setSelectedSlideId(firstSlideId);
    setSelectedNodeId(firstNodeIdOfPlan(demo.plan));
    messageApi.success('已载入企业知识库运营升级中性样例');
  };

  const generatePlan = async () => {
    generationAbortRef.current?.abort();
    deckBuildTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    deckBuildTimersRef.current = [];
    const controller = new AbortController();
    generationAbortRef.current = controller;
    const seedPlan = buildStreamingSeedPlan(config, 1, 'Hermes 正在启动分段 Agent，先生成可编辑 AIPPT 大纲。');
    setGenerating(true);
    setDeckStage('outline_streaming');
    setOutlineConfirmed(false);
    setDeckBuildProgress(0);
    setDeckBuildMessage('');
    setGenerationStage('outline_planning');
    setStreamMessage('Hermes 正在启动分段 Agent，先生成可编辑 AIPPT 大纲。');
    setGenerationMeta({
      source: 'hermes-segmented',
      model: 'hermes-agent',
      warnings: [],
    });
    setPlan(seedPlan);
    setActiveDeckId(null);
    setSelectedSlideId(null);
    setSelectedNodeId(firstNodeIdOfPlan(seedPlan));
    let lastPlan: DeckPlan | null = seedPlan;
    try {
      let completed = false;
      for await (const event of OPENATLAS_AIPPT_AGENT_ADAPTER.streamDeckPlan({ query: prompt, config }, { signal: controller.signal })) {
        const eventType = event.event_type || event.event;
        const advanceStreamingSkeleton = (messageText?: string) => {
          if (!lastPlan || realSlidesOfPlan(lastPlan).length > 0) return;
          const elapsed = Number(String(messageText || '').match(/已等待\s*(\d+)/u)?.[1] || 0);
          const nextCount = Math.min(
            outlineTargetSlides,
            Math.max(lastPlan.slides.length, Math.floor(elapsed / 10) + 1),
          );
          if (nextCount <= lastPlan.slides.length) return;
          const nextSeedPlan = buildStreamingSeedPlan(config, nextCount, messageText || 'Hermes 正在规划 AIPPT 画布节点。');
          lastPlan = nextSeedPlan;
          setPlan(nextSeedPlan);
          setSelectedNodeId((prev) => (planHasNode(nextSeedPlan, prev) ? prev : firstNodeIdOfPlan(nextSeedPlan)));
        };
        if (eventType === 'aborted') {
          setStreamMessage('已停止生成，可继续编辑当前草案或重新生成。');
          setDeckStage(lastPlan?.slides.length ? 'outline_review' : 'config');
          return;
        }
        if (eventType === 'error') {
          throw new Error(event.message || 'Hermes / LLM 流式调用失败');
        }
        if (event.message) {
          setStreamMessage(event.message);
        }
        if (event.stage) {
          setGenerationStage(event.stage);
        }
        if (event.config) {
          setConfig((prev) => ({ ...prev, ...event.config }) as DeckConfig);
        }
        if (event.id) {
          setActiveDeckId(event.id);
        }
        if (event.source || event.model || event.warnings) {
          setGenerationMeta({
            source: event.source || 'hermes-stream',
            model: event.model || 'hermes-agent',
            warnings: event.warnings || [],
          });
        }
        if (event.plan) {
          const nextPlan = normalizePlanLayouts(event.plan as DeckPlan, config);
          lastPlan = nextPlan;
          setPlan(nextPlan);
          setSelectedSlideId((prev) => (
            prev && nextPlan.slides.some((slide) => slide.id === prev) ? prev : nextPlan.slides[0]?.id || null
          ));
          setSelectedNodeId((prev) => (planHasNode(nextPlan, prev) ? prev : firstNodeIdOfPlan(nextPlan)));
          const countMessage = `当前 ${nextPlan.sections.length} 个章节、${nextPlan.slides.length} 页、${nextPlan.knowledge.length} 条知识依赖。`;
          setStreamMessage(event.message ? `${event.message} ${countMessage}` : `已生成 ${countMessage}`);
        }
        if (eventType === 'presentation.status') {
          advanceStreamingSkeleton(event.message);
          setStreamMessage(event.message || 'Hermes 正在处理 AIPPT 结构。');
        }
        if (eventType === 'presentation.partial') {
          completed = true;
          setGenerationStage(event.stage || 'partial_ready');
          setDeckStage('outline_review');
          setOutlineConfirmed(false);
          setGenerationMeta({
            source: event.source || 'hermes-stream-partial',
            model: event.model || 'hermes-agent',
            warnings: event.warnings || [],
          });
          setStreamMessage(event.message || 'Hermes 只生成了部分页面，已保留真实草案，可继续编辑或重新生成。');
          messageApi.warning('Hermes 只生成了部分页面，已保留真实草案');
          void reloadRecentDecks();
        }
        if (eventType === 'presentation.failed') {
          completed = true;
          setGenerationStage(event.stage || 'failed');
          setDeckStage(lastPlan?.slides.length ? 'outline_review' : 'failed');
          setOutlineConfirmed(false);
          setGenerationMeta({
            source: event.source || 'hermes-error',
            model: event.model || 'hermes-agent',
            warnings: event.warnings || [event.message || 'Hermes 未返回可解析的 AIPPT 结构'],
          });
          setStreamMessage(event.message || 'Hermes 未返回可解析的 AIPPT 结构，请调整需求或重试。');
          messageApi.error('Hermes 未返回可解析的 AIPPT 结构，没有生成替代草案');
        }
        if (eventType === 'presentation.complete') {
          completed = true;
          setGenerationStage(event.stage || 'outline_review');
          setDeckStage('outline_review');
          setOutlineConfirmed(false);
          const source = event.source || generationMeta?.source || 'hermes-stream';
          if (String(source).startsWith('hermes')) {
            messageApi.success(`Hermes / LLM 已流式生成 ${event.plan?.slides.length || lastPlan?.slides.length || 0} 页 AIPPT，请确认大纲`);
            void reloadRecentDecks();
          } else {
            messageApi.warning('Hermes 暂未返回稳定流式结果');
          }
        }
      }
      if (!completed && lastPlan?.slides.length) {
        setDeckStage('outline_review');
        setStreamMessage('连接结束，已保留当前流式草案。');
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        setStreamMessage('已停止生成，可继续编辑当前草案或重新生成。');
        setDeckStage(plan?.slides.length ? 'outline_review' : 'config');
        return;
      }
      setGenerationMeta({
        source: 'hermes-error',
        model: 'hermes-agent',
        warnings: [err?.message || 'Hermes / LLM 调用失败'],
      });
      setDeckStage(lastPlan?.slides.length ? 'outline_review' : 'failed');
      setStreamMessage('Hermes / LLM 流式调用失败，没有生成替代草案。请调整需求或重试。');
      messageApi.error('Hermes / LLM 调用失败，没有生成替代草案');
    } finally {
      setGenerating(false);
      generationAbortRef.current = null;
    }
  };

  const stopGeneration = () => {
    generationAbortRef.current?.abort();
    setGenerating(false);
    setStreamMessage('已停止生成，可编辑当前草案或重新生成。');
    setDeckStage(plan?.slides.length ? 'outline_review' : 'config');
  };

  const confirmOutline = () => {
    if (!plan) {
      messageApi.warning('请先生成画布大纲');
      return;
    }
    if (realSlides.length === 0) {
      messageApi.warning('真实大纲还没有生成完成，请稍后再确认');
      return;
    }
    setOutlineConfirmed(true);
    setDeckStage('outline_review');
    setDeckBuildProgress(0);
    setDeckBuildMessage('');
    setStreamMessage(`已确认大纲：${plan.sections.length} 个章节、${realSlides.length} 页。本阶段只确认画布，不会自动生成 PPT；下一步可手动生成 PPT 初稿。`);
    messageApi.success('大纲已确认，下一步可手动生成 PPT 初稿');
  };

  const persistDeckSnapshot = async (status: 'outline_review' | 'deck_ready', changeSummary: string) => {
    if (!plan) return;
    try {
      const body = {
        query: prompt,
        config,
        plan,
        status,
        change_summary: changeSummary,
      };
      if (activeDeckId) {
        const saved = await OPENATLAS_AIPPT_STORAGE_ADAPTER.saveSnapshot(activeDeckId, body);
        setActiveDeckId(saved.id || activeDeckId);
      } else {
        const created = await OPENATLAS_AIPPT_STORAGE_ADAPTER.createSnapshot(body);
        setActiveDeckId(created.id);
      }
      void reloadRecentDecks();
    } catch (err: any) {
      messageApi.warning(err?.message ? `保存最近演示状态失败：${err.message}` : '保存最近演示状态失败');
    }
  };

  const buildDeckFromConfirmedOutline = () => {
    if (!plan || !outlineConfirmed) {
      messageApi.warning('请先确认大纲');
      return;
    }
    if (realSlides.length === 0) {
      messageApi.warning('真实页面还没有生成完成');
      return;
    }
    deckBuildTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    deckBuildTimersRef.current = [];
    setDeckStage('deck_generating');
    setDeckBuildProgress(12);
    setDeckBuildMessage('正在读取已确认画布节点和设计 Token。');
    setStreamMessage('正在基于已确认大纲生成 PPT 初稿。');
    const timer1 = window.setTimeout(() => {
      setDeckBuildProgress(42);
      setDeckBuildMessage('正在按每页版式生成 HTML-PPT 页面结构。');
    }, 260);
    const timer2 = window.setTimeout(() => {
      setDeckBuildProgress(76);
      setDeckBuildMessage('正在注入 16:9 / 3:1 比例、主题样式和演讲备注。');
    }, 620);
    const timer3 = window.setTimeout(() => {
      setDeckBuildProgress(100);
      setDeckBuildMessage(`PPT 初稿已生成：${realSlides.length} 页，可预览、全屏或下载。`);
      setDeckStage('deck_ready');
      setStreamMessage(`PPT 初稿已生成：${plan.sections.length} 个章节、${realSlides.length} 页，可预览或下载。`);
      messageApi.success('PPT 初稿已生成，可以预览或下载');
      void persistDeckSnapshot('deck_ready', 'AIPPT 主画布生成 PPT 初稿');
    }, 980);
    deckBuildTimersRef.current = [timer1, timer2, timer3];
  };

  const resetBuiltDeck = () => {
    if (deckStage === 'deck_ready' || deckStage === 'deck_generating') {
      deckBuildTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      deckBuildTimersRef.current = [];
      setDeckStage('outline_review');
      setDeckBuildProgress(0);
      setDeckBuildMessage('内容已修改，请重新确认大纲并生成 PPT 初稿。');
      setStreamMessage('内容或资料状态已修改，请重新确认并生成 PPT 初稿。');
      setOutlineConfirmed(false);
    }
  };

  const updateKnowledge = (id: string, patch: Partial<KnowledgeCard>) => {
    resetBuiltDeck();
    setPlan((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        knowledge: prev.knowledge.map((item) => item.id === id ? { ...item, ...patch } : item),
      };
    });
  };

  const researchKnowledge = async (knowledge: KnowledgeCard, slide: DeckSlide | null = selectedSlide) => {
    if (!plan) return;
    setResearchingKnowledgeId(knowledge.id);
    try {
      const result = await OPENATLAS_AIPPT_RESEARCH_ADAPTER.researchKnowledge({
        query: buildResearchContextPrompt(knowledge, slide, config, prompt),
        config,
        knowledge,
        slide,
      });
      setPlan((prev) => {
        if (!prev) return prev;
        const exists = prev.knowledge.some((item) => item.id === result.knowledge.id);
        const knowledgeRows = exists
          ? prev.knowledge.map((item) => item.id === result.knowledge.id ? result.knowledge : item)
          : [...prev.knowledge, result.knowledge];
        const slides = result.slide_patch && slide
          ? prev.slides.map((item) => item.id === slide.id ? { ...item, ...result.slide_patch } : item)
          : prev.slides;
        return { ...prev, knowledge: knowledgeRows, slides };
      });
      resetBuiltDeck();
      if (result.sources?.length) {
        setStreamMessage(`已联网补充 ${result.sources.length} 条资料来源，请确认大纲后重新生成 PPT 初稿。`);
        messageApi.success(`已联网补充 ${result.sources.length} 条资料来源`);
      } else {
        setStreamMessage('资料仍缺少稳定来源，可人工补充后重新生成 PPT 初稿。');
        messageApi.warning(result.warnings?.[0] || '暂未检索到稳定来源，可人工补充');
      }
    } catch (err: any) {
      messageApi.error(err?.message || '联网补充失败');
    } finally {
      setResearchingKnowledgeId(null);
    }
  };

  const markSlideNeedsSource = () => {
    if (!selectedSlide) return;
    const knowledgeId = `k-${Date.now()}`;
    setPlan((prev) => {
      if (!prev) return prev;
      const nextKnowledge: KnowledgeCard = {
        id: knowledgeId,
        title: `${selectedSlide.title} 资料来源`,
        source: '待补充',
        detail: buildKnowledgeTaskDetail(config, selectedSlide, 'missing'),
        status: 'missing',
      };
      return {
        ...prev,
        knowledge: [...prev.knowledge, nextKnowledge],
        slides: prev.slides.map((slide) => slide.id === selectedSlide.id
          ? { ...slide, status: 'needs_source', knowledgeIds: Array.from(new Set([...slide.knowledgeIds, knowledgeId])) }
          : slide),
      };
    });
    resetBuiltDeck();
    setSelectedNodeId(knowledgeId);
    setStreamMessage('已创建缺资料知识卡，可人工补充或联网检索后重新生成 PPT 初稿。');
    messageApi.info('已创建缺资料知识卡，可人工补充或联网检索');
  };

  const updateConfig = <K extends keyof DeckConfig>(key: K, value: DeckConfig[K]) => {
    resetBuiltDeck();
    setConfig((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'useCase') {
        next.styleKey = preferredStyle(value as DeckUseCase);
        next.pageCount = Math.max(8, value === 'training' ? 12 : value === 'roadshow' ? 10 : 8);
      }
      return next;
    });
  };

  const updateSlide = (id: string, patch: Partial<DeckSlide>, preserveBuiltDeck = false) => {
    if (!preserveBuiltDeck) {
      resetBuiltDeck();
    } else if (deckStage === 'deck_ready') {
      setDeckBuildMessage('Designer 已更新 schema，HTML 预览会使用最新内容实时渲染。');
      setStreamMessage('已在低代码 PPT Designer 中更新页面 schema，可继续预览或下载最新 HTML。');
    }
    setPlan((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        slides: prev.slides.map((slide) => slide.id === id ? { ...slide, ...patch } : slide),
      };
    });
  };

  const updateSelectedSlideChart = (chart: DataChartKind, preserveBuiltDeck = false) => {
    if (!selectedSlide) return;
    updateSlide(selectedSlide.id, {
      layout: 'metrics',
      renderHints: withChartHint(selectedSlide.renderHints, chart),
      visual: selectedSlide.visual || (chart === 'bar' ? '柱状图 + 指标卡' : chart === 'line' ? '趋势折线图 + 指标卡' : '数字指标卡'),
      visualSpec: {
        ...visualSpecOfSlide(selectedSlide),
        type: chart,
        chart: {
          ...visualSpecOfSlide(selectedSlide).chart,
          kind: chart,
        },
        metrics: designerMetricsFromSlide(selectedSlide),
      },
    }, preserveBuiltDeck);
  };

  const openDesigner = async () => {
    if (!plan) return;
    if (generating || deckBuilding || deckStage === 'outline_streaming' || deckStage === 'deck_generating') {
      modalApi.info({
        title: deckStage === 'deck_generating' ? 'PPT 初稿正在生成中' : '大纲正在生成中',
        content: deckStage === 'deck_generating'
          ? '当前正在把已确认大纲渲染为 PPT 初稿，请稍等完成后再进入在线编辑。'
          : '当前还在生成可编辑大纲节点。等大纲生成完成并确认后，再进入 Designer 会更稳定。',
        okText: '知道了',
      });
      return;
    }
    if (!selectedSlideId && plan.slides[0]) {
      selectSlide(plan.slides[0].id);
    }
    if (activeDeckId) {
      try {
        await OPENATLAS_AIPPT_STORAGE_ADAPTER.getDeck(activeDeckId);
        navigate(`/presentation-canvas/designer/${activeDeckId}`);
        return;
      } catch {
        setActiveDeckId(null);
      }
    }
    try {
      const created = await OPENATLAS_AIPPT_STORAGE_ADAPTER.createSnapshot({
        query: prompt,
        config,
        plan,
        status: deckStage === 'deck_ready' ? 'deck_ready' : 'outline_review',
        change_summary: '从 AIPPT 主页面进入 Designer',
      });
      setActiveDeckId(created.id);
      void reloadRecentDecks();
      navigate(`/presentation-canvas/designer/${created.id}`);
    } catch (err: any) {
      messageApi.error(err?.message || '创建 Designer 草稿失败，请稍后重试。当前不会回退到旧版弹窗编辑器，以保持 Designer 与 HTML 预览同源。');
    }
  };

  const updateSelectedSlideFromDesigner = (patch: Partial<DeckSlide>) => {
    if (!selectedSlide) return;
    updateSlide(selectedSlide.id, patch, true);
  };

  const updateSelectedVisualSpec = (patch: Partial<SlideVisualSpec>) => {
    if (!selectedSlide) return;
    const base = visualSpecOfSlide(selectedSlide);
    updateSlide(selectedSlide.id, { visualSpec: { ...base, ...patch } }, true);
  };

  const setSelectedVisualType = (type: VisualSpecType) => {
    if (!selectedSlide) return;
    const chartKind = chartKindFromVisualType(type);
    const base = visualSpecOfSlide(selectedSlide);
    const nextSpec: SlideVisualSpec = {
      ...base,
      type,
      chart: type === 'generic' || type === 'matrix' || type === 'architecture'
        ? base.chart
        : {
            ...base.chart,
            kind: chartKind,
            labels: base.chart?.labels?.length ? base.chart.labels : designerMetricsFromSlide(selectedSlide).map((item) => String(item.label || item.title || '指标')),
            series: base.chart?.series?.length
              ? base.chart.series
              : [{
                  name: '当前值',
                  values: designerMetricsFromSlide(selectedSlide)
                    .map((item) => Number(String(item.value ?? '').replace(/[^\d.+-]/g, '')))
                    .filter((item) => Number.isFinite(item)),
                  unit: '',
                }],
          },
      columns: type === 'matrix' ? (base.columns?.length ? base.columns : inferMatrixColumns(selectedSlide)) : base.columns,
      layers: type === 'architecture' ? (base.layers?.length ? base.layers : inferArchitectureLayers(selectedSlide)) : base.layers,
      metrics: ['scorecard', 'bar', 'line', 'combo_metrics'].includes(type)
        ? designerMetricsFromSlide(selectedSlide)
        : base.metrics,
    };
    updateSlide(selectedSlide.id, {
      layout: visualTypeToLayout(type),
      visual: selectedSlide.visual || VISUAL_SPEC_TYPE_OPTIONS.find((item) => item.value === type)?.label || '自定义可视化',
      renderHints: type === 'generic' || type === 'matrix' || type === 'architecture'
        ? selectedSlide.renderHints
        : withChartHint(selectedSlide.renderHints, chartKind),
      visualSpec: nextSpec,
    }, true);
  };

  const selectSlide = (id: string | null) => {
    setSelectedSlideId(id);
    setSelectedNodeId(id);
  };

  const addSlideAfterSelected = () => {
    if (!plan) return;
    const nextSlideId = `slide-${Date.now()}`;
    setPlan((prev) => {
      if (!prev) return prev;
      const afterIndex = selectedSlide ? selectedSlide.index : prev.slides.length;
      const sectionId = selectedSlide?.sectionId || prev.sections[0]?.id || 'section-1';
      const newSlide: DeckSlide = {
        id: nextSlideId,
        sectionId,
        index: afterIndex + 1,
        title: '新增页面',
        headline: '补充一个新的关键观点',
        bullets: ['说明本页要解决的问题。', '补充必要的数据、案例或决策点。', '明确这页和前后页面的关系。'],
        visual: '自定义版式',
        layout: 'two_column',
        knowledgeIds: ['k-topic'],
        status: 'draft',
        speakerNotes: '补充讲述备注。',
      };
      const slides = [
        ...prev.slides.slice(0, afterIndex),
        newSlide,
        ...prev.slides.slice(afterIndex),
      ].map((slide, index) => ({ ...slide, index: index + 1 }));
      return { ...prev, slides };
    });
    selectSlide(nextSlideId);
  };

  const duplicateSelectedSlide = () => {
    if (!selectedSlide) {
      messageApi.warning('请先选中一页再复制');
      return;
    }
    const nextSlideId = `slide-${Date.now()}`;
    setPlan((prev) => {
      if (!prev) return prev;
      const afterIndex = selectedSlide.index;
      const duplicated: DeckSlide = {
        ...selectedSlide,
        id: nextSlideId,
        index: afterIndex + 1,
        title: `${selectedSlide.title} 副本`,
        status: 'draft',
      };
      const slides = [
        ...prev.slides.slice(0, afterIndex),
        duplicated,
        ...prev.slides.slice(afterIndex),
      ].map((slide, index) => ({ ...slide, index: index + 1 }));
      return { ...prev, slides };
    });
    selectSlide(nextSlideId);
  };

  const addSectionWithSlide = () => {
    if (!plan) return;
    const sectionId = `section-${Date.now()}`;
    const slideId = `slide-${Date.now() + 1}`;
    setPlan((prev) => {
      if (!prev) return prev;
      const nextSection: DeckSection = {
        id: sectionId,
        title: '新增章节',
        purpose: '承接新的叙事段落。',
      };
      const nextSlide: DeckSlide = {
        id: slideId,
        sectionId,
        index: prev.slides.length + 1,
        title: '新增章节页',
        headline: '定义本章节要回答的核心问题',
        bullets: ['说明章节背景。', '补充关键论据。', '明确后续页面如何展开。'],
        visual: '章节引导页',
        layout: 'section',
        knowledgeIds: [prev.knowledge[0]?.id || 'k-topic'],
        status: 'draft',
        speakerNotes: '讲述本章节的目的和转场关系。',
      };
      return {
        ...prev,
        sections: [...prev.sections, nextSection],
        slides: [...prev.slides, nextSlide],
      };
    });
    selectSlide(slideId);
  };

  const addKnowledgeNode = () => {
    if (!plan) return;
    const knowledgeId = `k-${Date.now()}`;
    setPlan((prev) => {
      if (!prev) return prev;
      const nextKnowledge: KnowledgeCard = {
        id: knowledgeId,
        title: selectedSlide ? `${selectedSlide.title} 知识依赖` : '新增知识依赖',
        source: '人工补充',
        detail: selectedSlide
          ? buildKnowledgeTaskDetail(config, selectedSlide, 'manual')
          : '补充该演示需要引用的数据、案例、截图、研究报告或官方资料。',
        status: 'assumption',
      };
      const slides = selectedSlide
        ? prev.slides.map((slide) => slide.id === selectedSlide.id
          ? { ...slide, knowledgeIds: Array.from(new Set([...slide.knowledgeIds, knowledgeId])) }
          : slide)
        : prev.slides;
      return {
        ...prev,
        knowledge: [...prev.knowledge, nextKnowledge],
        slides,
      };
    });
    setSelectedNodeId(knowledgeId);
  };

  const deleteSelectedNode = () => {
    if (!plan || !selectedNode) {
      messageApi.warning('请先选中一个画布节点');
      return;
    }
    const kind = selectedNode.data.kind;
    if (kind === 'config') {
      messageApi.warning('配置卡不能删除，可以重新生成配置');
      return;
    }
    modalApi.confirm({
      title: '删除选中节点？',
      content: kind === 'section'
        ? '会同时删除这个章节下的页面。'
        : kind === 'knowledge'
          ? '会从相关页面里移除这条知识依赖。'
          : '会删除这页并重新编号。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => {
        if (kind === 'slide') {
          setPlan((prev) => {
            if (!prev || prev.slides.length <= 1) {
              messageApi.warning('至少需要保留一页');
              return prev;
            }
            const removedIndex = prev.slides.findIndex((slide) => slide.id === selectedNode.id);
            const slides = prev.slides
              .filter((slide) => slide.id !== selectedNode.id)
              .map((slide, index) => ({ ...slide, index: index + 1 }));
            const nextSlide = slides[Math.max(0, removedIndex - 1)] || slides[0] || null;
            window.setTimeout(() => selectSlide(nextSlide?.id || null), 0);
            return { ...prev, slides };
          });
          return;
        }

        if (kind === 'section') {
          setPlan((prev) => {
            if (!prev) return prev;
            const slides = prev.slides
              .filter((slide) => slide.sectionId !== selectedNode.id)
              .map((slide, index) => ({ ...slide, index: index + 1 }));
            if (slides.length === 0) {
              messageApi.warning('至少需要保留一个章节和一页');
              return prev;
            }
            const sections = prev.sections.filter((section) => section.id !== selectedNode.id);
            const nextSlide = slides[0] || null;
            window.setTimeout(() => selectSlide(nextSlide?.id || null), 0);
            return { ...prev, sections, slides };
          });
          return;
        }

        if (kind === 'knowledge') {
          setPlan((prev) => {
            if (!prev || prev.knowledge.length <= 1) {
              messageApi.warning('至少需要保留一条知识依赖');
              return prev;
            }
            const knowledge = prev.knowledge.filter((item) => item.id !== selectedNode.id);
            const fallbackKnowledgeId = knowledge[0]?.id;
            const slides = prev.slides.map((slide) => {
              const knowledgeIds = slide.knowledgeIds.filter((id) => id !== selectedNode.id);
              return {
                ...slide,
                knowledgeIds: knowledgeIds.length > 0 ? knowledgeIds : fallbackKnowledgeId ? [fallbackKnowledgeId] : [],
              };
            });
            const nextNodeId = selectedSlideId || prev.slides[0]?.id || knowledge[0]?.id || null;
            window.setTimeout(() => setSelectedNodeId(nextNodeId), 0);
            return { ...prev, knowledge, slides };
          });
        }
      },
    });
  };

  const requestPreviewFullscreen = async () => {
    const target = previewRef.current || previewFrameRef.current;
    if (!target?.requestFullscreen) {
      messageApi.warning('当前浏览器不支持全屏演示');
      return;
    }
    try {
      await target.requestFullscreen();
    } catch {
      messageApi.info('预览已打开，请点击预览弹窗底部的“全屏”按钮进入演示模式');
    }
  };

  const openFullscreen = async () => {
    if (!outlineConfirmed) {
      messageApi.warning('请先确认大纲并生成 PPT 初稿，再打开预览');
      return;
    }
    setPreviewOpen(true);
    if (previewRef.current || previewFrameRef.current) {
      await requestPreviewFullscreen();
    } else {
      messageApi.info('预览已打开，请点击预览弹窗底部的“全屏”按钮进入演示模式');
    }
  };

  const downloadHtml = () => {
    if (!plan) {
      messageApi.warning('请先生成 AIPPT');
      return;
    }
    if (!outlineConfirmed) {
      messageApi.warning('请先确认大纲并生成 PPT 初稿，再下载');
      return;
    }
    downloadText(htmlDeck, `${safeFileTitle(plan.title)}.html`);
  };

  const exportJson = () => {
    if (!plan) return;
    downloadText(JSON.stringify({ config, plan }, null, 2), `${safeFileTitle(plan.title)}.json`, 'application/json;charset=utf-8');
  };

  const openRecentDeck = async (deck: AipptDeckDocument) => {
    setLoadingDeckId(deck.id);
    try {
      const detail = await OPENATLAS_AIPPT_STORAGE_ADAPTER.getDeck(deck.id);
      const nextConfig = detail.config || config;
      const nextPlan = detail.plan ? normalizePlanLayouts(detail.plan as DeckPlan, nextConfig) : null;
      const isDeckReady = detail.status === 'deck_ready' && Boolean(nextPlan?.slides.length);
      setPrompt(detail.query || deck.query || prompt);
      setConfig(nextConfig as DeckConfig);
      setPlan(nextPlan);
      setActiveDeckId(detail.id || deck.id);
      setGenerationMeta({
        source: detail.source || 'hermes',
        model: detail.model || 'hermes-agent',
        warnings: detail.warnings || [],
      });
      setOutlineConfirmed(isDeckReady);
      setDeckBuildProgress(isDeckReady ? 100 : 0);
      setDeckBuildMessage(isDeckReady && nextPlan ? `PPT 初稿已生成：${nextPlan.slides.length} 页，可预览、全屏或下载。` : '');
      setDeckStage(isDeckReady ? 'deck_ready' : nextPlan?.slides.length ? 'outline_review' : 'failed');
      setSelectedSlideId(nextPlan?.slides[0]?.id || null);
      setSelectedNodeId(nextPlan ? firstNodeIdOfPlan(nextPlan) : 'config-pending');
      setStreamMessage(isDeckReady && nextPlan
        ? `已打开最近 AIPPT：${nextPlan.slides.length} 页，PPT 初稿已生成，可预览、下载或继续编辑。`
        : nextPlan?.slides.length
          ? `已打开最近 AIPPT：${nextPlan.slides.length} 页，可继续审阅、修改或生成 PPT 初稿。`
          : '该 AIPPT 没有可恢复的页面内容。');
      setRecentDrawerOpen(false);
    } catch (err: any) {
      messageApi.error(err?.message || '打开最近 AIPPT 失败');
    } finally {
      setLoadingDeckId(null);
    }
  };

  const openRecentDeckDesigner = (deck: AipptDeckDocument) => {
    setActiveDeckId(deck.id);
    navigate(`/presentation-canvas/designer/${deck.id}`);
  };

  const tokenPreview = (
    <div className="presentation-token-preview" style={{
      '--token-bg': style.tokens.background,
      '--token-surface': style.tokens.surface,
      '--token-primary': style.tokens.primary,
      '--token-accent': style.tokens.accent,
      '--token-text': style.tokens.text,
    } as React.CSSProperties}>
      <span />
      <span />
      <span />
      <strong>{style.name}</strong>
    </div>
  );

  const designerChartKind = selectedSlide ? chartKindFromSlide(selectedSlide) : 'scorecard';
  const designerChartLabels = selectedVisualSpec?.chart?.labels?.length
    ? selectedVisualSpec.chart.labels
    : selectedDesignerMetrics.map((item) => String(item.label || item.title || '指标'));
  const designerChartValues = selectedVisualSpec?.chart?.series?.[0]?.values?.length
    ? selectedVisualSpec.chart.series[0].values
    : selectedDesignerMetrics
        .map((item) => Number(String(item.value ?? '').replace(/[^\d.+-]/g, '')))
        .filter((item) => Number.isFinite(item));
  const designerChartMax = Math.max(...designerChartValues.map((item) => Math.abs(item)), 1);
  const designerChartMin = Math.min(...designerChartValues, 0);
  const designerChartRange = Math.max(Math.max(...designerChartValues, 1) - designerChartMin, 1);
  const designerColumns = selectedSlide
    ? (selectedVisualSpec?.columns?.length ? selectedVisualSpec.columns : inferMatrixColumns(selectedSlide))
    : [];
  const designerLayers = selectedSlide
    ? (selectedVisualSpec?.layers?.length ? selectedVisualSpec.layers : inferArchitectureLayers(selectedSlide))
    : [];

  return (
    <div className="presentation-page">
      {contextHolder}
      {modalContextHolder}
      <Drawer
        title={(
          <span className="presentation-recent-drawer__title">
            <ClockCircleOutlined />
            最近演示
            {recentDecks.length > 0 && <Tag>{recentDecks.length}</Tag>}
          </span>
        )}
        open={recentDrawerOpen}
        onClose={() => setRecentDrawerOpen(false)}
        width={390}
        className="presentation-recent-drawer"
        extra={<Button size="small" onClick={() => void reloadRecentDecks()}>刷新</Button>}
      >
        {recentDecks.length === 0 ? (
          <div className="presentation-recent-empty">还没有生成过 AIPPT。</div>
        ) : (
          <div className="presentation-recent-list">
            {recentDecks.slice(0, 20).map((deck) => (
              <button
                key={deck.id}
                type="button"
                disabled={loadingDeckId === deck.id}
                onClick={() => void openRecentDeck(deck)}
              >
                <span>{deck.slide_count || 0} 页 · {USE_CASE_LABEL[deck.useCase as DeckUseCase] || '演示'}</span>
                <strong>{deck.title || '未命名 AIPPT'}</strong>
                <em>{deck.source === 'hermes-stream-partial' ? '部分草案' : deck.source === 'hermes-error' ? '需重试' : '打开画布'} · {deck.updated_at ? new Date(deck.updated_at).toLocaleString() : ''}</em>
              </button>
            ))}
          </div>
        )}
      </Drawer>
      <aside className="presentation-left">
        <div className="presentation-brand">
          <span><FilePptOutlined /></span>
          <div>
            <strong>AIPPT</strong>
            <em>A2UI · Canvas · HTML Slides</em>
          </div>
        </div>

        <section className="presentation-panel">
          <div className="presentation-panel__title">
            <RobotOutlined />
            Agent 需求
          </div>
          <Input.TextArea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={5}
            placeholder="说出要做的演示文稿"
          />
          <div className="presentation-example-list">
            {EXAMPLES.map((item, index) => (
              <button
                key={item}
                type="button"
                onClick={() => {
                  if (item === OPENATLAS_INVESTOR_DEMO_PROMPT) {
                    loadOpenAtlasInvestorDemo();
                    return;
                  }
                  if (item === GENERIC_OPERATIONS_DEMO_PROMPT) {
                    loadGenericOperationsDemo();
                    return;
                  }
                  setPrompt(item);
                  setConfig(inferConfigFromPrompt(item));
                  setPlan(null);
                  setGenerationMeta(null);
                  setDeckStage('config');
                  setStreamMessage('');
                  setOutlineConfirmed(false);
                  setDeckBuildProgress(0);
                  setDeckBuildMessage('');
                  setSelectedNodeId('config-pending');
                  setSelectedSlideId(null);
                }}
              >
                {item === OPENATLAS_INVESTOR_DEMO_PROMPT
                  ? '融资图表样例'
                  : item === GENERIC_OPERATIONS_DEMO_PROMPT
                    ? '中性图表样例'
                    : `示例 ${index + 1}`}
              </button>
            ))}
          </div>
          <Button type="primary" icon={<NodeIndexOutlined />} onClick={analyzePrompt}>
            生成配置卡
          </Button>
        </section>

        <section className="presentation-panel presentation-panel--a2ui">
          <div className="presentation-panel__title">
            <CheckCircleOutlined />
            A2UI 配置确认
          </div>
          <label className="presentation-field">
            <span>主题</span>
            <Input value={config.topic} onChange={(event) => updateConfig('topic', event.target.value)} />
          </label>
          <label className="presentation-field">
            <span>类型</span>
            <Segmented
              block
              value={config.useCase}
              onChange={(value) => updateConfig('useCase', value as DeckUseCase)}
              options={[
                { label: '汇报', value: 'report', icon: <ProfileOutlined /> },
                { label: '路演', value: 'roadshow', icon: <FundProjectionScreenOutlined /> },
                { label: '培训', value: 'training', icon: <BookOutlined /> },
              ]}
            />
          </label>
          <div className="presentation-two-fields">
            <label className="presentation-field">
              <span>比例</span>
              <Select
                value={config.aspectRatio}
                onChange={(value) => updateConfig('aspectRatio', value)}
                options={[
                  { value: '16:9', label: '16:9' },
                  { value: '3:1', label: '3:1' },
                ]}
              />
            </label>
            <label className="presentation-field">
              <span>页数</span>
              <InputNumber
                min={8}
                max={40}
                value={config.pageCount}
                onChange={(value) => updateConfig('pageCount', Math.max(8, Number(value || 8)))}
              />
            </label>
          </div>
          <label className="presentation-field">
            <span>受众</span>
            <Input value={config.audience} onChange={(event) => updateConfig('audience', event.target.value)} />
          </label>
          <div className="presentation-two-fields">
            <label className="presentation-field">
              <span>时长</span>
              <div className="presentation-inline-number">
                <InputNumber
                  min={8}
                  max={90}
                  value={config.durationMinutes}
                  onChange={(value) => updateConfig('durationMinutes', Math.max(8, Number(value || 8)))}
                />
                <span>分钟</span>
              </div>
            </label>
            <label className="presentation-field">
              <span>图表</span>
              <Select
                value={config.chartLevel}
                onChange={(value) => updateConfig('chartLevel', value)}
                options={[
                  { value: 'light', label: '少量' },
                  { value: 'balanced', label: '适中' },
                  { value: 'rich', label: '偏多' },
                ]}
              />
            </label>
          </div>
          <label className="presentation-field">
            <span>视觉密度</span>
            <Slider
              min={0}
              max={2}
              marks={{ 0: '简洁', 1: '标准', 2: '密集' }}
              value={config.density === 'clean' ? 0 : config.density === 'standard' ? 1 : 2}
              onChange={(value) => updateConfig('density', value === 0 ? 'clean' : value === 1 ? 'standard' : 'dense')}
            />
          </label>
          <div className="presentation-generate-actions">
            <Button type="primary" icon={<PlayCircleOutlined />} loading={generating} disabled={deckBuilding} onClick={generatePlan}>
              {generating ? '大纲生成中' : plan && deckStage !== 'config' && deckStage !== 'failed' ? '重新生成大纲' : '生成大纲'}
            </Button>
            {generating && (
              <Button icon={<StopOutlined />} onClick={stopGeneration}>
                停止
              </Button>
            )}
          </div>
          <div className={`presentation-stream-status is-${deckStage}`}>
            <strong>{stageLabel}</strong>
            <span>{streamMessage || '先生成配置卡，再让 Hermes 拆出可编辑 AIPPT 大纲。'}</span>
            {(generating || deckStage === 'outline_streaming') && (
              <div className="presentation-build-progress">
                <Progress percent={outlineProgressPercent} size="small" status="active" />
                <em>{outlineProgressText}</em>
              </div>
            )}
            {(deckStage === 'deck_generating' || deckStage === 'deck_ready' || deckBuildProgress > 0) && (
              <div className="presentation-build-progress">
                <Progress percent={deckBuildProgress} size="small" status={deckStage === 'deck_ready' ? 'success' : 'active'} />
                <em>{deckBuildMessage || '等待生成 PPT 初稿。'}</em>
              </div>
            )}
          </div>
        </section>
      </aside>

      <main className="presentation-main">
        <div className="presentation-toolbar">
          <div>
            <h1>
              <span>{plan?.title || '待生成 AIPPT'}</span>
              {generationMeta && (
                <Tag color={String(generationMeta.source).includes('error') ? 'red' : String(generationMeta.source).includes('partial') ? 'gold' : 'blue'}>
                  {String(generationMeta.source).includes('error')
                    ? '需重试'
                    : String(generationMeta.source).includes('partial')
                      ? 'Hermes 部分草案'
                      : String(generationMeta.source).includes('segmented')
                        ? 'Hermes 分段 Agent'
                        : 'Hermes / LLM'}
                </Tag>
              )}
              <Tag color={deckStage === 'deck_ready' ? 'green' : deckStage === 'deck_generating' ? 'processing' : deckStage === 'outline_review' ? 'gold' : deckStage === 'outline_streaming' ? 'processing' : 'default'}>
                {stageLabel}
              </Tag>
            </h1>
            <p>
              {USE_CASE_LABEL[config.useCase]} · {config.aspectRatio} · {config.pageCount} 页 · {style.name}
              {generationMeta?.warnings?.[0] ? ` · ${generationMeta.warnings[0]}` : ''}
            </p>
          </div>
          <div className="presentation-toolbar__actions">
            <Tooltip title="打开当前账号最近生成或编辑过的 AIPPT">
              <Button icon={<ClockCircleOutlined />} onClick={() => setRecentDrawerOpen(true)}>
                最近演示{recentDecks.length > 0 ? ` ${recentDecks.length}` : ''}
              </Button>
            </Tooltip>
            <Tooltip title="新增章节">
              <Button icon={<ApartmentOutlined />} onClick={addSectionWithSlide} disabled={!plan} />
            </Tooltip>
            <Tooltip title="新增页面">
              <Button icon={<PlusOutlined />} onClick={addSlideAfterSelected} disabled={!plan} />
            </Tooltip>
            <Tooltip title="新增知识依赖">
              <Button icon={<BookOutlined />} onClick={addKnowledgeNode} disabled={!plan} />
            </Tooltip>
            <Tooltip title="复制当前页面">
              <Button icon={<CopyOutlined />} onClick={duplicateSelectedSlide} disabled={!selectedSlide || selectedNode?.data.kind !== 'slide'} />
            </Tooltip>
            <Tooltip title="删除选中节点">
              <Button danger icon={<DeleteOutlined />} onClick={deleteSelectedNode} disabled={!plan || !selectedNode || selectedNode.data.kind === 'config'} />
            </Tooltip>
            <Tooltip title="保存 JSON">
              <Button icon={<SaveOutlined />} onClick={exportJson} disabled={!plan} />
            </Tooltip>
            <Tooltip title={generating || deckBuilding ? '生成完成后再进入低代码 PPT Designer' : '进入 Schema 驱动的低代码 PPT Designer'}>
              <Button icon={<EditOutlined />} onClick={openDesigner} disabled={!plan}>
                在线编辑
              </Button>
            </Tooltip>
            <Tooltip title="第 1 段完成：确认当前画布大纲。确认后仍需手动点击生成 PPT 初稿">
              <Button icon={<CheckCircleOutlined />} onClick={confirmOutline} disabled={outlineConfirmed || !canConfirmOutline}>
                {outlineConfirmed ? '已确认' : '确认大纲'}
              </Button>
            </Tooltip>
            <Tooltip title={outlineConfirmed ? '第 2 段：基于已确认大纲生成当前选中风格的 PPT 初稿' : '请先确认大纲'}>
              <Button icon={<FundProjectionScreenOutlined />} onClick={buildDeckFromConfirmedOutline} loading={deckBuilding} disabled={deckStage === 'deck_ready' || (!canGenerateDeck && deckStage !== 'deck_generating')}>
                {deckStage === 'deck_ready' ? 'PPT 已生成' : deckBuilding ? '生成中' : '生成 PPT 初稿'}
              </Button>
            </Tooltip>
            <Tooltip title="HTML 预览">
              <Button icon={<FundProjectionScreenOutlined />} onClick={() => setPreviewOpen(true)} disabled={!canPreviewDeck}>
                预览
              </Button>
            </Tooltip>
            <Tooltip title="全屏预览">
              <Button icon={<FullscreenOutlined />} onClick={() => void openFullscreen()} disabled={!canPreviewDeck} />
            </Tooltip>
            <Tooltip title="下载 HTML">
              <Button type="primary" icon={<DownloadOutlined />} onClick={downloadHtml} disabled={!canPreviewDeck}>
                下载
              </Button>
            </Tooltip>
          </div>
        </div>

        <div className="presentation-canvas-shell">
          <ReactFlow
            nodes={flowNodes}
            edges={generatedFlow.edges}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.24, maxZoom: 0.95 }}
            minZoom={0.28}
            nodesDraggable
            nodesConnectable={false}
            selectNodesOnDrag={false}
            onNodesChange={onNodesChange}
            onNodeClick={(_, node) => {
              setSelectedNodeId(node.id);
              if (node.data.kind === 'slide') setSelectedSlideId(node.id);
            }}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1} />
            <Controls />
            <MiniMap pannable zoomable nodeStrokeWidth={3} />
          </ReactFlow>
        </div>
      </main>

      <aside className="presentation-right">
	        <section className="presentation-panel">
	          <div className="presentation-panel__title">
	            <HighlightOutlined />
	            HTML-UI Token（单选）
	          </div>
          {tokenPreview}
          <Radio.Group
            value={config.styleKey}
            onChange={(event) => updateConfig('styleKey', event.target.value)}
            className="presentation-style-list"
          >
            {STYLE_PRESETS.map((item) => (
              <Radio.Button key={item.key} value={item.key}>
                <span className="presentation-style-option">
                  {STYLE_ICON[item.key]}
                  {item.name}
                </span>
              </Radio.Button>
            ))}
          </Radio.Group>
	          <div className="presentation-token-note">
	            <strong>Prompt Hint</strong>
	            <span>{style.promptHint}</span>
	          </div>
	          <div className="presentation-token-note presentation-token-note--selected">
	            <strong>当前生成策略</strong>
	            <span>只生成当前选中的「{style.name}」一套 HTML PPT；其他风格只是可切换的预制 Token。</span>
	          </div>
          <div className="presentation-token-grid">
            <span>primary <em style={{ background: style.tokens.primary }} /></span>
            <span>accent <em style={{ background: style.tokens.accent }} /></span>
            <span>surface <em style={{ background: style.tokens.surface }} /></span>
            <span>radius <b>{style.tokens.radius}px</b></span>
          </div>
        </section>

        <section className="presentation-panel presentation-review">
          <div className="presentation-panel__title">
            <EditOutlined />
            初稿审阅区
          </div>
          {selectedKnowledge ? (
            <div className="presentation-slide-editor">
              <div className="presentation-slide-editor__head">
                <span>Knowledge</span>
                <Tag color={selectedKnowledge.status === 'ready' ? 'success' : selectedKnowledge.status === 'missing' ? 'warning' : 'default'}>
                  {selectedKnowledge.status === 'ready' ? '可用' : selectedKnowledge.status === 'missing' ? '缺资料' : '假设'}
                </Tag>
              </div>
              <label className="presentation-field">
                <span>资料标题</span>
                <Input value={selectedKnowledge.title} onChange={(event) => updateKnowledge(selectedKnowledge.id, { title: event.target.value })} />
              </label>
              <label className="presentation-field">
                <span>来源</span>
                <Input value={selectedKnowledge.source} onChange={(event) => updateKnowledge(selectedKnowledge.id, { source: event.target.value })} />
              </label>
              <label className="presentation-field">
                <span>资料摘要</span>
                <Input.TextArea value={selectedKnowledge.detail} rows={5} onChange={(event) => updateKnowledge(selectedKnowledge.id, { detail: event.target.value })} />
              </label>
              <label className="presentation-field">
                <span>状态</span>
                <Select
                  value={selectedKnowledge.status}
                  onChange={(value) => updateKnowledge(selectedKnowledge.id, { status: value as KnowledgeCard['status'] })}
                  options={[
                    { value: 'ready', label: '可用' },
                    { value: 'missing', label: '缺资料' },
                    { value: 'assumption', label: '假设' },
                  ]}
                />
              </label>
              <div className="presentation-editor-actions presentation-editor-actions--two">
                <Button icon={<CheckCircleOutlined />} onClick={() => updateKnowledge(selectedKnowledge.id, { status: 'ready' })}>标记可用</Button>
                <Button
                  icon={<GlobalOutlined />}
                  loading={researchingKnowledgeId === selectedKnowledge.id}
                  onClick={() => void researchKnowledge(selectedKnowledge)}
                >
                  联网补充
                </Button>
              </div>
            </div>
          ) : selectedSlide ? (
            <div className="presentation-slide-editor">
              <div className="presentation-slide-editor__head">
                <span>Slide {selectedSlide.index}</span>
                <Tag color={STATUS_COLOR[selectedSlide.status]}>{STATUS_LABEL[selectedSlide.status]}</Tag>
              </div>
              <label className="presentation-field">
                <span>标题</span>
                <Input value={selectedSlide.title} onChange={(event) => updateSlide(selectedSlide.id, { title: event.target.value })} />
              </label>
              <label className="presentation-field">
                <span>核心观点</span>
                <Input.TextArea value={selectedSlide.headline} rows={2} onChange={(event) => updateSlide(selectedSlide.id, { headline: event.target.value })} />
              </label>
              <label className="presentation-field">
                <span>内容要点</span>
                <Input.TextArea
                  value={selectedSlide.bullets.join('\n')}
                  rows={5}
                  onChange={(event) => updateSlide(selectedSlide.id, { bullets: event.target.value.split('\n').filter(Boolean) })}
                />
              </label>
              <label className="presentation-field">
                <span>视觉建议</span>
                <Input value={selectedSlide.visual} onChange={(event) => updateSlide(selectedSlide.id, { visual: event.target.value })} />
              </label>
              <label className="presentation-field">
                <span>页面版式</span>
                <Select
                  value={selectedSlide.layout}
                  onChange={(value) => updateSlide(selectedSlide.id, { layout: value as DeckLayout })}
                  options={DECK_LAYOUT_OPTIONS}
                />
              </label>
              {selectedSlide.layout === 'metrics' && (
                <label className="presentation-field">
                  <span>数据图表</span>
                  <Segmented
                    block
                    value={chartKindFromSlide(selectedSlide)}
                    onChange={(value) => updateSelectedSlideChart(value as DataChartKind)}
                    options={[
                      { value: 'scorecard', label: '数字卡片' },
                      { value: 'bar', label: '柱状图' },
                      { value: 'line', label: '折线图' },
                    ]}
                  />
                </label>
              )}
              <label className="presentation-field">
                <span>演讲备注</span>
                <Input.TextArea value={selectedSlide.speakerNotes} rows={3} onChange={(event) => updateSlide(selectedSlide.id, { speakerNotes: event.target.value })} />
              </label>
              <div className="presentation-slide-sources">
                {selectedSlideKnowledge.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`is-${item.status}`}
                    onClick={() => setSelectedNodeId(item.id)}
                  >
                    <span>{item.status === 'ready' ? '可用' : item.status === 'missing' ? '缺资料' : '假设'}</span>
                    {item.title}
                  </button>
                ))}
              </div>
              <div className="presentation-editor-actions">
                <Button icon={<CheckCircleOutlined />} onClick={() => updateSlide(selectedSlide.id, { status: 'confirmed' })}>确认</Button>
                <Button icon={<BarChartOutlined />} onClick={markSlideNeedsSource}>缺资料</Button>
                <Button icon={<LockOutlined />} onClick={() => updateSlide(selectedSlide.id, { status: 'locked' })}>锁定</Button>
              </div>
            </div>
          ) : (
            <div className="presentation-empty-review">
              <ClockCircleOutlined />
              <strong>{deckStage === 'outline_streaming' ? '正在流式生成' : deckStage === 'outline_review' ? '等待确认大纲' : '等待画布生成'}</strong>
              <span>{streamMessage || '确认配置后，这里会显示每页内容、知识依赖和审阅动作。'}</span>
            </div>
          )}
        </section>

        <section className="presentation-panel">
          <div className="presentation-panel__title">
            <ApartmentOutlined />
            知识依赖
          </div>
          <div className="presentation-knowledge-list">
            {(plan?.knowledge || makeKnowledge(config)).map((item) => (
              <div
                key={item.id}
                className={`presentation-knowledge-item is-${item.status} ${selectedNodeId === item.id ? 'is-selected' : ''}`}
                onClick={() => setSelectedNodeId(item.id)}
              >
                <span>{item.status === 'ready' ? '可用' : item.status === 'missing' ? '缺资料' : '假设'} · {item.source}</span>
                <strong>{item.title}</strong>
                <p>{item.detail}</p>
                {plan && item.status !== 'ready' && (
                  <em
                    role="button"
                    tabIndex={0}
                    onClick={(event) => {
                      event.stopPropagation();
                      void researchKnowledge(item, selectedSlide);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        event.stopPropagation();
                        void researchKnowledge(item, selectedSlide);
                      }
                    }}
                  >
                    {researchingKnowledgeId === item.id ? '检索中...' : '联网补充'}
                  </em>
                )}
              </div>
            ))}
          </div>
        </section>
      </aside>

      <Modal
        open={designerOpen}
        title={`${plan?.title || 'AIPPT'} · Schema 驱动 PPT Designer`}
        onCancel={() => setDesignerOpen(false)}
        width="96vw"
        className="presentation-designer-modal"
        footer={[
          <Button key="close" onClick={() => setDesignerOpen(false)}>
            关闭
          </Button>,
          <Button key="preview" icon={<FundProjectionScreenOutlined />} onClick={() => setPreviewOpen(true)} disabled={!plan}>
            预览 HTML
          </Button>,
          <Button key="download" type="primary" icon={<DownloadOutlined />} onClick={downloadHtml} disabled={!plan}>
            下载 HTML
          </Button>,
        ]}
      >
        <div className="presentation-designer">
          <aside className="presentation-designer__slides">
            <div className="presentation-designer__section-title">
              <span>Pages</span>
              <Button size="small" icon={<PlusOutlined />} onClick={addSlideAfterSelected} disabled={!plan}>
                新增
              </Button>
            </div>
            <div className="presentation-designer__slide-list">
              {(plan?.slides || []).map((slide) => (
                <button
                  key={slide.id}
                  type="button"
                  className={slide.id === selectedSlideId ? 'is-active' : ''}
                  onClick={() => selectSlide(slide.id)}
                >
                  <b>{String(slide.index).padStart(2, '0')}</b>
                  <span>{slide.title}</span>
                  <em>{DECK_LAYOUT_OPTIONS.find((item) => item.value === slide.layout)?.label || slide.layout}</em>
                </button>
              ))}
            </div>
          </aside>

          <main className="presentation-designer__stage">
            <div className="presentation-designer__topbar">
              <div>
                <strong>Low-code Schema Preview</strong>
                <span>编辑页面内容、视觉组件和图表数据，预览会从同一份 Deck Schema 重新渲染。</span>
              </div>
              <div>
                <Tag color="blue">{style.name}</Tag>
                <Tag color="green">{config.aspectRatio}</Tag>
                <Tag>{config.chartLevel}</Tag>
              </div>
            </div>

            {selectedSlide ? (
              <div
                className={`presentation-designer-slide presentation-designer-slide--theme-${style.key} presentation-designer-slide--${config.aspectRatio === '3:1' ? 'wide' : 'standard'} presentation-designer-slide--${selectedVisualSpec?.type || 'generic'}`}
                style={{
                  '--designer-bg': style.tokens.background,
                  '--designer-surface': style.tokens.surface,
                  '--designer-primary': style.tokens.primary,
                  '--designer-accent': style.tokens.accent,
                  '--designer-muted': style.tokens.muted,
                  '--designer-text': style.tokens.text,
                } as React.CSSProperties}
              >
                <div className="presentation-designer-slide__meta">
                  <span>{selectedDesignerSection?.title || USE_CASE_LABEL[config.useCase]}</span>
                  <b>SLIDE {selectedSlide.index}</b>
                </div>
                <h2>{selectedSlide.title}</h2>
                <p>{selectedSlide.headline}</p>

                {selectedVisualSpec?.type === 'matrix' ? (
                  <div className="presentation-designer-matrix">
                    {(designerColumns.length ? designerColumns : [{ label: '对象 A', detail: '能力点 1、能力点 2' }, { label: '对象 B', detail: '能力点 1、能力点 2' }]).slice(0, 4).map((column, index) => (
                      <article key={`${column.label || column.title}-${index}`}>
                        <span>{String(index + 1).padStart(2, '0')}</span>
                        <strong>{column.label || column.title || `对象 ${index + 1}`}</strong>
                        <div>
                          {(column.items?.length ? column.items : splitEditorDetail(column.detail || '')).slice(0, 5).map((item) => (
                            <em key={item}>{item}</em>
                          ))}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : selectedVisualSpec?.type === 'architecture' ? (
                  <div className="presentation-designer-architecture">
                    {(designerLayers.length ? designerLayers : [{ label: '输入层', detail: '多模态资料' }, { label: '生成层', detail: 'Agent 编排与渲染' }]).slice(0, 6).map((layer, index) => (
                      <article key={`${layer.label || layer.title}-${index}`}>
                        <b>{String(index + 1).padStart(2, '0')}</b>
                        <div>
                          <strong>{layer.label || layer.title || `层级 ${index + 1}`}</strong>
                          <span>{layer.detail || layer.items?.join(' / ') || '补充层级说明'}</span>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : ['scorecard', 'bar', 'line', 'combo_metrics'].includes(selectedVisualSpec?.type || '') ? (
                  <div className="presentation-designer-data">
                    {designerChartKind === 'bar' ? (
                      <div className="presentation-designer-bars">
                        {(designerChartValues.length ? designerChartValues : [68, 82, 94]).slice(0, 6).map((value, index) => (
                          <i
                            key={`${designerChartLabels[index] || index}-${value}`}
                            style={{ '--bar-height': `${Math.max(12, Math.round((Math.abs(value) / designerChartMax) * 100))}%` } as React.CSSProperties}
                          >
                            <span>{designerChartLabels[index] || `指标 ${index + 1}`}</span>
                            <b>{value}</b>
                          </i>
                        ))}
                      </div>
                    ) : designerChartKind === 'line' ? (
                      <div className="presentation-designer-line">
                        {(designerChartValues.length ? designerChartValues : [22, 38, 52, 76, 94]).slice(0, 7).map((value, index) => (
                          <i
                            key={`${designerChartLabels[index] || index}-${value}`}
                            style={{ '--point-y': `${Math.max(8, Math.min(86, 86 - ((value - designerChartMin) / designerChartRange) * 72))}%` } as React.CSSProperties}
                          >
                            <span>{designerChartLabels[index] || `P${index + 1}`}</span>
                          </i>
                        ))}
                      </div>
                    ) : null}
                    <div className="presentation-designer-metrics">
                      {selectedDesignerMetrics.slice(0, 4).map((metric, index) => (
                        <article key={`${metric.label || metric.title}-${index}`}>
                          <b>{String(metric.value ?? '待补')}{metric.unit || ''}</b>
                          <strong>{metric.label || metric.title || `指标 ${index + 1}`}</strong>
                          <span>{metric.detail || '补充指标口径'}</span>
                        </article>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="presentation-designer-bullets">
                    {selectedSlide.bullets.slice(0, 5).map((item, index) => (
                      <article key={`${item}-${index}`}>
                        <b>{String(index + 1).padStart(2, '0')}</b>
                        <span>{item}</span>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="presentation-empty-review">
                <ClockCircleOutlined />
                <strong>还没有选中页面</strong>
                <span>生成 AIPPT 大纲后，可以进入 Designer 调整页面 schema。</span>
              </div>
            )}
          </main>

          <aside className="presentation-designer__inspector">
            <div className="presentation-designer__section-title">
              <span>Inspector</span>
              {selectedSlide && <Tag color={STATUS_COLOR[selectedSlide.status]}>{STATUS_LABEL[selectedSlide.status]}</Tag>}
            </div>

            {selectedSlide ? (
              <div className="presentation-designer-form">
                <label className="presentation-field">
                  <span>页面标题</span>
                  <Input value={selectedSlide.title} onChange={(event) => updateSelectedSlideFromDesigner({ title: event.target.value })} />
                </label>
                <label className="presentation-field">
                  <span>核心观点</span>
                  <Input.TextArea value={selectedSlide.headline} rows={2} onChange={(event) => updateSelectedSlideFromDesigner({ headline: event.target.value })} />
                </label>
                <label className="presentation-field">
                  <span>页面版式</span>
                  <Select
                    value={selectedSlide.layout}
                    onChange={(value) => updateSelectedSlideFromDesigner({ layout: value as DeckLayout })}
                    options={DECK_LAYOUT_OPTIONS}
                  />
                </label>
                <label className="presentation-field">
                  <span>页面视觉组件</span>
                  <Select
                    value={selectedVisualSpec?.type || 'generic'}
                    onChange={(value) => setSelectedVisualType(value as VisualSpecType)}
                    options={VISUAL_SPEC_TYPE_OPTIONS}
                  />
                </label>
                <label className="presentation-field">
                  <span>视觉说明</span>
                  <Input value={selectedSlide.visual} onChange={(event) => updateSelectedSlideFromDesigner({ visual: event.target.value })} />
                </label>
                <label className="presentation-field">
                  <span>内容要点</span>
                  <Input.TextArea
                    value={selectedSlide.bullets.join('\n')}
                    rows={5}
                    onChange={(event) => updateSelectedSlideFromDesigner({ bullets: event.target.value.split('\n').map((item) => item.trim()).filter(Boolean) })}
                  />
                </label>

                {['scorecard', 'bar', 'line', 'combo_metrics'].includes(selectedVisualSpec?.type || '') && (
                  <div className="presentation-designer-schema-block">
                    <div className="presentation-designer-schema-block__head">
                      <strong>数据组件</strong>
                      <Segmented
                        size="small"
                        value={designerChartKind}
                        onChange={(value) => updateSelectedSlideChart(value as DataChartKind, true)}
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
                        value={designerChartLabels.join('，')}
                        placeholder="Q1，Q2，Q3"
                        onChange={(event) => updateSelectedVisualSpec({
                          chart: {
                            ...selectedVisualSpec?.chart,
                            kind: designerChartKind,
                            labels: parseDelimitedLabels(event.target.value),
                          },
                        })}
                      />
                    </label>
                    <label className="presentation-field">
                      <span>图表数值</span>
                      <Input
                        value={designerChartValues.join('，')}
                        placeholder="20，45，80"
                        onChange={(event) => {
                          const series = selectedVisualSpec?.chart?.series || [];
                          const firstSeries = series[0] || { name: '当前值', unit: selectedVisualSpec?.chart?.unit || '' };
                          updateSelectedVisualSpec({
                            chart: {
                              ...selectedVisualSpec?.chart,
                              kind: designerChartKind,
                              series: [{ ...firstSeries, values: parseDelimitedNumbers(event.target.value) }, ...series.slice(1)],
                            },
                          });
                        }}
                      />
                    </label>
                    <div className="presentation-designer-metric-editor">
                      <div className="presentation-designer-schema-block__head">
                        <strong>指标卡</strong>
                        <Button
                          size="small"
                          icon={<PlusOutlined />}
                          onClick={() => updateSelectedVisualSpec({
                            metrics: [...selectedDesignerMetrics, { label: '新指标', value: '待补', detail: '补充指标口径' }],
                          })}
                        >
                          添加
                        </Button>
                      </div>
                      {selectedDesignerMetrics.map((metric, index) => (
                        <div className="presentation-designer-metric-row" key={`${metric.label || metric.title}-${index}`}>
                          <Input
                            value={metric.label || metric.title}
                            placeholder="指标名"
                            onChange={(event) => {
                              const metrics = [...selectedDesignerMetrics];
                              metrics[index] = { ...metric, label: event.target.value };
                              updateSelectedVisualSpec({ metrics });
                            }}
                          />
                          <Input
                            value={String(metric.value ?? '')}
                            placeholder="数值"
                            onChange={(event) => {
                              const metrics = [...selectedDesignerMetrics];
                              metrics[index] = { ...metric, value: event.target.value };
                              updateSelectedVisualSpec({ metrics });
                            }}
                          />
                          <Button
                            danger
                            icon={<DeleteOutlined />}
                            disabled={selectedDesignerMetrics.length <= 1}
                            onClick={() => updateSelectedVisualSpec({ metrics: selectedDesignerMetrics.filter((_, itemIndex) => itemIndex !== index) })}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedVisualSpec?.type === 'matrix' && (
                  <label className="presentation-field">
                    <span>矩阵列（每行：对象：能力点）</span>
                    <Input.TextArea
                      value={specItemsToEditorText(designerColumns)}
                      rows={5}
                      onChange={(event) => updateSelectedVisualSpec({ columns: parseSpecItemsFromEditorText(event.target.value) })}
                    />
                  </label>
                )}

                {selectedVisualSpec?.type === 'architecture' && (
                  <label className="presentation-field">
                    <span>架构层（每行：层级：说明）</span>
                    <Input.TextArea
                      value={specItemsToEditorText(designerLayers)}
                      rows={5}
                      onChange={(event) => updateSelectedVisualSpec({ layers: parseSpecItemsFromEditorText(event.target.value) })}
                    />
                  </label>
                )}

                <label className="presentation-field">
                  <span>高级渲染约束</span>
                  <Input.TextArea
                    value={(selectedSlide.renderHints || []).join('\n')}
                    rows={3}
                    placeholder="例如：chart=line&#10;强调右侧指标卡（高级字段，可不填）"
                    onChange={(event) => updateSelectedSlideFromDesigner({
                      renderHints: event.target.value.split('\n').map((item) => item.trim()).filter(Boolean),
                    })}
                  />
                </label>
                <label className="presentation-field">
                  <span>结构摘要（只读）</span>
                  <Input.TextArea value={compactSpecJson(selectedVisualSpec)} rows={7} readOnly />
                </label>
              </div>
            ) : (
              <div className="presentation-empty-review">
                <EditOutlined />
                <strong>等待页面</strong>
                <span>请选择一页后编辑 schema。</span>
              </div>
            )}
          </aside>
        </div>
      </Modal>

      <Modal
        open={previewOpen}
        title={`${plan?.title || 'HTML 预览'} · ${config.aspectRatio}`}
        onCancel={() => setPreviewOpen(false)}
        width={1180}
        footer={[
          <Button key="full" icon={<FullscreenOutlined />} onClick={() => void requestPreviewFullscreen()}>
            全屏
          </Button>,
          <Button key="download" type="primary" icon={<DownloadOutlined />} onClick={downloadHtml}>
            下载 HTML
          </Button>,
        ]}
      >
        <div ref={previewRef} className="presentation-preview-modal">
          {htmlDeck ? (
            <iframe ref={previewFrameRef} title="HTML PPT Preview" srcDoc={htmlDeck} allow="fullscreen" allowFullScreen />
          ) : (
            <div className="presentation-empty-review">
              <ClockCircleOutlined />
              <strong>还没有可预览的 HTML</strong>
              <span>先确认配置并生成画布。</span>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
