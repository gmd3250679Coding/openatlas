import type { DeckUseCase } from './schema';
import type { DeckRenderStyle } from './renderer';

export interface AipptStylePreset extends DeckRenderStyle {
  fit: DeckUseCase;
  promptHint: string;
}

export const STYLE_PRESETS: AipptStylePreset[] = [
  {
    key: 'executive_blue',
    name: '高管汇报蓝',
    fit: 'report',
    promptHint: '结论前置、数据可信、行动明确，适合正式经营汇报和管理层沟通。',
    tokens: {
      background: '#F6F8FC',
      surface: '#FFFFFF',
      surfaceAlt: '#EAF2FF',
      primary: '#1D4ED8',
      accent: '#10B981',
      accentSoft: '#DCFCE7',
      text: '#111827',
      muted: '#64748B',
      border: 'rgba(29, 78, 216, 0.18)',
      radius: 8,
      shadow: '0 18px 44px rgba(15, 23, 42, 0.12)',
      chartPalette: ['#1D4ED8', '#10B981', '#F59E0B', '#64748B'],
      canvasPattern: 'executive-grid',
      coverLayout: 'executive-summary',
      contentLayout: 'evidence-first',
    },
  },
  {
    key: 'tech_launch',
    name: '科技路演黑',
    fit: 'roadshow',
    promptHint: '强调机会、转折、产品亮点和行动号召，适合发布会、融资路演和客户推介。',
    tokens: {
      background: '#070A12',
      surface: '#111827',
      surfaceAlt: '#1E293B',
      primary: '#818CF8',
      accent: '#22D3EE',
      accentSoft: '#082F49',
      text: '#F8FAFC',
      muted: '#A7B0C4',
      border: 'rgba(129, 140, 248, 0.28)',
      radius: 14,
      shadow: '0 24px 70px rgba(34, 211, 238, 0.16)',
      chartPalette: ['#22D3EE', '#818CF8', '#34D399', '#F472B6'],
      canvasPattern: 'launch-grid',
      coverLayout: 'launch-hero',
      contentLayout: 'story-arc',
    },
  },
  {
    key: 'teaching_clear',
    name: '清晰教学绿',
    fit: 'training',
    promptHint: '循序渐进、知识拆解、示例练习并重，适合培训课件和课程材料。',
    tokens: {
      background: '#F8FAF8',
      surface: '#FFFFFF',
      surfaceAlt: '#ECFDF5',
      primary: '#047857',
      accent: '#F97316',
      accentSoft: '#FFF7ED',
      text: '#17221D',
      muted: '#6B7280',
      border: 'rgba(4, 120, 87, 0.20)',
      radius: 10,
      shadow: '0 18px 42px rgba(4, 120, 87, 0.12)',
      chartPalette: ['#047857', '#F97316', '#2563EB', '#A855F7'],
      canvasPattern: 'learning-lines',
      coverLayout: 'learning-path',
      contentLayout: 'step-by-step',
    },
  },
];

export function preferredStyle(useCase: DeckUseCase) {
  return STYLE_PRESETS.find((item) => item.fit === useCase)?.key || 'executive_blue';
}

export function selectedStyle<T extends { styleKey?: string }>(config: T) {
  return STYLE_PRESETS.find((item) => item.key === config.styleKey) || STYLE_PRESETS[0];
}

export function styleName(styleKey: string) {
  return STYLE_PRESETS.find((item) => item.key === styleKey)?.name || styleKey;
}
