import { expect, test } from '@playwright/test';
import {
  aipptOutlineProgressPercent,
  aipptOutlineProgressText,
  aipptStageLabel,
  realSlidesOfPlan,
} from '../src/features/aippt/use-canvas-controller';
import type { DeckPlan } from '../src/features/aippt/schema';

test.describe('AIPPT canvas controller primitives', () => {
  test('derives stage labels and streaming progress consistently', () => {
    expect(aipptStageLabel('config', false)).toBe('配置确认');
    expect(aipptStageLabel('outline_review', false)).toBe('大纲待确认');
    expect(aipptStageLabel('outline_review', true)).toBe('大纲已确认');
    expect(aipptStageLabel('deck_ready', true)).toBe('HTML PPT 已生成');

    expect(aipptOutlineProgressPercent({
      generatedSlides: 4,
      targetSlides: 8,
      generating: true,
      placeholderSlides: 0,
    })).toBe(50);
    expect(aipptOutlineProgressPercent({
      generatedSlides: 8,
      targetSlides: 8,
      generating: true,
      placeholderSlides: 0,
    })).toBe(95);
    expect(aipptOutlineProgressPercent({
      generatedSlides: 0,
      targetSlides: 8,
      generating: true,
      placeholderSlides: 3,
    })).toBe(23);

    expect(aipptOutlineProgressText({
      generationStage: 'json_recovery',
      generatedSlides: 0,
      targetSlides: 8,
      placeholderSlides: 0,
    })).toContain('结构化输出');
    expect(aipptOutlineProgressText({
      generationStage: 'outline_planning',
      generatedSlides: 0,
      targetSlides: 8,
      placeholderSlides: 2,
    })).toContain('2 个画布生成占位节点');
  });

  test('filters streaming placeholders from real slides', () => {
    const plan: DeckPlan = {
      title: 'AIPPT streaming state',
      sections: [{ id: 's1', title: '章节', purpose: '测试' }],
      knowledge: [{ id: 'k1', title: '资料', source: '测试', detail: '测试', status: 'ready' }],
      slides: [
        {
          id: 'stream-placeholder-1',
          sectionId: 's1',
          index: 1,
          title: '生成中',
          headline: '等待真实页面',
          bullets: [],
          visual: '占位',
          layout: 'two_column',
          knowledgeIds: ['k1'],
          status: 'draft',
        },
        {
          id: 'slide-1',
          sectionId: 's1',
          index: 2,
          title: '真实页面',
          headline: '已经返回真实大纲',
          bullets: ['保留真实 slide'],
          visual: '指标卡',
          layout: 'metrics',
          knowledgeIds: ['k1'],
          status: 'draft',
        },
      ],
      generatedAt: new Date().toISOString(),
    };

    expect(realSlidesOfPlan(plan).map((slide) => slide.id)).toEqual(['slide-1']);
  });
});
