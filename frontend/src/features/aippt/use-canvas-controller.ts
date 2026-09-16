import { useMemo, useState } from 'react';
import type { AipptDeckDocument } from './adapters';
import { buildHtmlDeck } from './renderer';
import {
  designerMetricsFromSlide,
  metricDataFromVisualSpec,
  visualSpecOfSlide,
  type DeckConfig,
  type DeckPlan,
  type DeckSlide,
} from './schema';
import { selectedStyle } from './styles';

export type AipptDeckStage = 'config' | 'outline_streaming' | 'outline_review' | 'deck_generating' | 'deck_ready' | 'failed';

export interface AipptGenerationMeta {
  source: 'hermes' | 'hermes-stream' | 'hermes-stream-partial' | 'hermes-segmented' | 'hermes-segmented-partial' | 'hermes-error' | string;
  model: string;
  warnings: string[];
}

export interface UseAipptCanvasControllerOptions {
  initialPrompt: string;
  initialConfig: DeckConfig;
  initialSelectedNodeId?: string | null;
}

export function isStreamingPlaceholderSlide(slide: DeckSlide) {
  return slide.id.startsWith('stream-placeholder-');
}

export function realSlidesOfPlan(nextPlan: DeckPlan | null) {
  return nextPlan?.slides.filter((slide) => !isStreamingPlaceholderSlide(slide)) || [];
}

export function aipptStageLabel(stage: AipptDeckStage, outlineConfirmed: boolean) {
  if (stage === 'outline_streaming') return '大纲生成中';
  if (stage === 'outline_review') return outlineConfirmed ? '大纲已确认' : '大纲待确认';
  if (stage === 'deck_generating') return 'PPT 生成中';
  if (stage === 'deck_ready') return 'PPT 已生成';
  if (stage === 'failed') return '生成失败';
  return '配置确认';
}

export function aipptOutlineProgressPercent(options: {
  generatedSlides: number;
  targetSlides: number;
  generating: boolean;
  placeholderSlides: number;
}) {
  const target = Math.max(1, options.targetSlides);
  if (options.generatedSlides > 0) {
    return Math.min(options.generating ? 95 : 100, Math.round((options.generatedSlides / target) * 100));
  }
  if (options.generating && options.placeholderSlides > 0) {
    return Math.min(28, 8 + options.placeholderSlides * 5);
  }
  return 0;
}

export function aipptOutlineProgressText(options: {
  generationStage: string;
  generatedSlides: number;
  targetSlides: number;
  placeholderSlides: number;
}) {
  if (options.generationStage === 'slide_batch_expanding') {
    return '正在批量扩写页面内容，画布会按批次刷新。';
  }
  if (options.generationStage === 'slide_batch_repair' || options.generationStage === 'slide_repair') {
    return '批量结果不完整，正在对页面做单页补救。';
  }
  if (options.generationStage === 'json_recovery') {
    return '正在修复模型结构化输出，优先保留真实结果。';
  }
  if (options.generationStage === 'outline_planning') {
    if (options.placeholderSlides > 0) {
      return `已显示 ${options.placeholderSlides} 个画布生成占位节点，真实大纲返回后会自动替换。`;
    }
    return '正在用分段 Agent 生成轻量大纲。';
  }
  if (options.generatedSlides > 0) {
    return `已解析 ${options.generatedSlides}/${options.targetSlides} 页结构，继续等待章节和知识依赖。`;
  }
  return '正在等待 Hermes 返回第一个结构化节点。';
}

export function useAipptCanvasController(options: UseAipptCanvasControllerOptions) {
  const [prompt, setPrompt] = useState(options.initialPrompt);
  const [config, setConfig] = useState<DeckConfig>(options.initialConfig);
  const [plan, setPlan] = useState<DeckPlan | null>(null);
  const [activeDeckId, setActiveDeckId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(options.initialSelectedNodeId ?? 'config-pending');
  const [selectedSlideId, setSelectedSlideId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [deckStage, setDeckStage] = useState<AipptDeckStage>('config');
  const [streamMessage, setStreamMessage] = useState('');
  const [generationStage, setGenerationStage] = useState('');
  const [outlineConfirmed, setOutlineConfirmed] = useState(false);
  const [deckBuildProgress, setDeckBuildProgress] = useState(0);
  const [deckBuildMessage, setDeckBuildMessage] = useState('');
  const [recentDecks, setRecentDecks] = useState<AipptDeckDocument[]>([]);
  const [loadingDeckId, setLoadingDeckId] = useState<string | null>(null);
  const [researchingKnowledgeId, setResearchingKnowledgeId] = useState<string | null>(null);
  const [generationMeta, setGenerationMeta] = useState<AipptGenerationMeta | null>(null);

  const style = useMemo(() => selectedStyle(config), [config]);
  const htmlDeck = useMemo(() => buildHtmlDeck(plan, config, style), [config, plan, style]);
  const selectedSlide = useMemo(() => plan?.slides.find((slide) => slide.id === selectedSlideId) || null, [plan, selectedSlideId]);
  const selectedVisualSpec = useMemo(() => (selectedSlide ? visualSpecOfSlide(selectedSlide) : null), [selectedSlide]);
  const selectedDesignerMetrics = useMemo(() => (selectedSlide ? designerMetricsFromSlide(selectedSlide) : []), [selectedSlide]);
  const selectedDesignerChartRows = useMemo(() => (
    selectedVisualSpec ? metricDataFromVisualSpec(selectedVisualSpec) : []
  ), [selectedVisualSpec]);
  const selectedDesignerSection = useMemo(() => (
    selectedSlide ? plan?.sections.find((section) => section.id === selectedSlide.sectionId) || null : null
  ), [plan?.sections, selectedSlide]);
  const selectedSlideKnowledge = useMemo(() => (
    selectedSlide
      ? (plan?.knowledge || []).filter((item) => selectedSlide.knowledgeIds.includes(item.id))
      : []
  ), [plan?.knowledge, selectedSlide]);

  const deckBuilding = deckStage === 'deck_generating';
  const realSlides = realSlidesOfPlan(plan);
  const placeholderSlides = (plan?.slides.length || 0) - realSlides.length;
  const canConfirmOutline = Boolean(plan && realSlides.length > 0 && deckStage === 'outline_review' && !outlineConfirmed && !generating && !deckBuilding);
  const canGenerateDeck = Boolean(plan && realSlides.length > 0 && outlineConfirmed && deckStage === 'outline_review' && !generating && !deckBuilding);
  const canPreviewDeck = Boolean(plan && outlineConfirmed && deckStage === 'deck_ready' && !generating && !deckBuilding);
  const stageLabel = aipptStageLabel(deckStage, outlineConfirmed);
  const outlineTargetSlides = Math.max(8, Math.min(40, Number(config.pageCount) || 8));
  const outlineGeneratedSlides = realSlides.length;
  const outlineProgressPercent = aipptOutlineProgressPercent({
    generatedSlides: outlineGeneratedSlides,
    targetSlides: outlineTargetSlides,
    generating,
    placeholderSlides,
  });
  const outlineProgressText = aipptOutlineProgressText({
    generationStage,
    generatedSlides: outlineGeneratedSlides,
    targetSlides: outlineTargetSlides,
    placeholderSlides,
  });

  return {
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
    generationStage,
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
    placeholderSlides,
    canConfirmOutline,
    canGenerateDeck,
    canPreviewDeck,
    stageLabel,
    outlineTargetSlides,
    outlineGeneratedSlides,
    outlineProgressPercent,
    outlineProgressText,
  };
}
