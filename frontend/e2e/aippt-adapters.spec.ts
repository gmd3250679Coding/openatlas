import { expect, test } from '@playwright/test';
import { buildHtmlDeck } from '../src/features/aippt/renderer';
import { selectedStyle } from '../src/features/aippt/styles';
import {
  createLocalAipptStorageAdapter,
  createMemoryKeyValueStorage,
  createMockAipptAgentAdapter,
  createMockAipptResearchAdapter,
} from '../src/features/aippt/local-adapters';

test.describe('AIPPT local and mock adapters', () => {
  test('runs the offline generate, save, restore, research, patch, and render loop', async ({ page }) => {
    const storage = createMemoryKeyValueStorage();
    const storageAdapter = createLocalAipptStorageAdapter({ storage });
    const agentAdapter = createMockAipptAgentAdapter();
    const researchAdapter = createMockAipptResearchAdapter();

    const generated = await agentAdapter.generateDeck?.({
      query: '生成一份企业知识库运营升级汇报，面向管理层',
      config: {
        topic: '企业知识库运营升级汇报',
        useCase: 'report',
        aspectRatio: '16:9',
        styleKey: 'executive_blue',
        audience: '管理层',
        durationMinutes: 15,
        pageCount: 8,
        density: 'standard',
        chartLevel: 'rich',
        speakerNotes: true,
      },
    });
    expect(generated?.source).toBe('mock-agent');
    expect(generated?.plan.slides).toHaveLength(8);

    const streamEvents = [];
    for await (const event of agentAdapter.streamDeckPlan({
      query: '企业知识库运营升级汇报',
      config: generated!.config,
    })) {
      streamEvents.push(event);
    }
    expect(streamEvents.map((event) => event.event_type)).toEqual(['progress', 'complete']);
    expect(streamEvents[1].plan?.slides).toHaveLength(8);

    const created = await storageAdapter.createSnapshot({
      query: '企业知识库运营升级汇报',
      config: generated!.config,
      plan: generated!.plan,
      status: 'outline_review',
      change_summary: '离线创建',
    });
    expect(created.id).toContain('deck-');
    expect(created.version?.version_no).toBe(1);
    await expect.poll(async () => (await storageAdapter.listDecks()).length).toBe(1);

    const saved = await storageAdapter.saveSnapshot(created.id, {
      query: created.query,
      config: created.config,
      plan: {
        ...created.plan!,
        title: '企业知识库运营升级汇报｜离线保存版本',
      },
      status: 'deck_ready',
      change_summary: '离线保存',
    });
    expect(saved.version?.version_no).toBe(2);
    expect(saved.title).toContain('离线保存版本');
    expect(await storageAdapter.listVersions(created.id)).toHaveLength(2);

    const versions = await storageAdapter.listVersions(created.id);
    const restored = await storageAdapter.restoreVersion(created.id, versions[1].id);
    expect(restored.version?.version_no).toBe(3);
    expect(restored.title).toBe(created.title);

    const targetKnowledge = restored.plan!.knowledge.find((item) => item.status !== 'ready') || restored.plan!.knowledge[0];
    const researched = await researchAdapter.researchKnowledge({
      query: '补充知识库运营资料',
      config: restored.config,
      knowledge: targetKnowledge,
      slide: restored.plan!.slides[1],
    });
    expect(researched.knowledge.status).toBe('ready');
    expect(researched.sources?.[0]?.url).toContain('example.com');

    const targetSlide = restored.plan!.slides[1];
    const patch = await agentAdapter.runSlideAction(restored.id, {
      action: 'enhance_chart',
      instruction: '增强图表',
      config: restored.config,
      plan: restored.plan!,
      slide: targetSlide,
    });
    expect(patch.source).toBe('mock-agent');
    expect(patch.slide_patch.visualSpec?.chart?.source).toContain('MockAipptAgentAdapter');
    expect(patch.quality?.changed_fields).toContain('visualSpec');

    const patchedPlan = {
      ...restored.plan!,
      slides: restored.plan!.slides.map((slide) => slide.id === targetSlide.id
        ? { ...slide, ...patch.slide_patch }
        : slide),
      knowledge: restored.plan!.knowledge.map((item) => item.id === researched.knowledge.id ? researched.knowledge : item),
    };
    const html = buildHtmlDeck(patchedPlan, restored.config, selectedStyle(restored.config));
    expect(html).toContain('MockAipptAgentAdapter 示例数据');
    expect(html).toContain('theme-executive_blue');

    await page.setViewportSize({ width: 1440, height: 810 });
    await page.setContent(html, { waitUntil: 'load' });
    await expect(page.locator('.slide')).toHaveCount(8);
    await expect(page.locator('.slide-metrics').first()).toContainText('MockAipptAgentAdapter 示例数据');
  });
});
