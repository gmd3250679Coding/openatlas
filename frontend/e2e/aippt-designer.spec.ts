import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

const API_BASE = (process.env.OPENATLAS_E2E_API_BASE || 'http://127.0.0.1:58003/api').replace(/\/$/, '');
const EMAIL = process.env.OPENATLAS_E2E_EMAIL || 'admin@demo.openatlas';
const PASSWORD = process.env.OPENATLAS_E2E_PASSWORD || 'openatlas';
const VISUAL_OUTPUT_DIR = path.resolve(process.cwd(), 'output/playwright/aippt-visual');

async function api<T>(
  request: APIRequestContext,
  method: 'GET' | 'POST' | 'PUT',
  pathName: string,
  token?: string,
  data?: unknown,
): Promise<T> {
  const response = await request.fetch(`${API_BASE}${pathName}`, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    data,
    timeout: 60_000,
  });
  expect(response.ok(), `${method} ${pathName} -> ${response.status()} ${await response.text()}`).toBeTruthy();
  return await response.json();
}

async function loginApi(request: APIRequestContext) {
  const out = await api<any>(request, 'POST', '/auth/login', undefined, { email: EMAIL, password: PASSWORD });
  return out.access_token as string;
}

async function loginWithToken(page: Page, token: string) {
  await page.addInitScript((value) => {
    window.localStorage.setItem('openatlas_access_token', value);
  }, token);
}

async function imageStatsFromScreenshot(page: Page, buffer: Buffer) {
  return page.evaluate(async (base64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${base64}`;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('failed to load screenshot'));
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unavailable');
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const stepX = Math.max(1, Math.floor(canvas.width / 96));
    const stepY = Math.max(1, Math.floor(canvas.height / 72));
    let samples = 0;
    let nonWhite = 0;
    let sum = 0;
    let sumSq = 0;
    const buckets = new Set<string>();
    for (let y = 0; y < canvas.height; y += stepY) {
      for (let x = 0; x < canvas.width; x += stepX) {
        const offset = (y * canvas.width + x) * 4;
        const r = data[offset];
        const g = data[offset + 1];
        const b = data[offset + 2];
        const a = data[offset + 3];
        if (a < 24) continue;
        const brightness = (r + g + b) / 3;
        samples += 1;
        sum += brightness;
        sumSq += brightness * brightness;
        if (brightness < 245) nonWhite += 1;
        buckets.add(`${r >> 4}-${g >> 4}-${b >> 4}`);
      }
    }
    const mean = sum / Math.max(1, samples);
    const variance = (sumSq / Math.max(1, samples)) - (mean * mean);
    return {
      width: canvas.width,
      height: canvas.height,
      samples,
      nonWhiteRatio: nonWhite / Math.max(1, samples),
      uniqueBuckets: buckets.size,
      variance,
    };
  }, buffer.toString('base64'));
}

async function activateSlide(slide: Locator) {
  await slide.evaluate((target) => {
    const slides = Array.from(target.parentElement?.querySelectorAll('.slide') || []);
    slides.forEach((item) => item.classList.toggle('active', item === target));
  });
  await expect(slide).toHaveClass(/active/);
}

async function expectRenderedSlide(page: Page, slide: Locator, name: string, expectedRatio: number) {
  await activateSlide(slide);
  await expect(slide).toBeVisible();
  const box = await slide.boundingBox();
  expect(box, `${name} slide bounding box`).toBeTruthy();
  expect(box!.width).toBeGreaterThan(300);
  expect(box!.height).toBeGreaterThan(96);
  expect(Math.abs((box!.width / box!.height) - expectedRatio), `${name} aspect ratio`).toBeLessThan(expectedRatio * 0.22);
  fs.mkdirSync(VISUAL_OUTPUT_DIR, { recursive: true });
  const buffer = await slide.screenshot({
    animations: 'disabled',
    path: path.join(VISUAL_OUTPUT_DIR, `${name.replace(/[^a-z0-9_-]+/gi, '-')}.png`),
  });
  expect(buffer.byteLength, `${name} screenshot bytes`).toBeGreaterThan(12_000);
  const stats = await imageStatsFromScreenshot(page, buffer);
  expect(stats.width).toBeGreaterThan(300);
  expect(stats.height).toBeGreaterThan(96);
  expect(stats.samples).toBeGreaterThan(500);
  expect(stats.nonWhiteRatio, `${name} non-white pixel ratio`).toBeGreaterThan(0.08);
  expect(stats.uniqueBuckets, `${name} color buckets`).toBeGreaterThan(10);
  expect(stats.variance, `${name} brightness variance`).toBeGreaterThan(80);
}

async function expectBoxesAligned(source: Locator, overlay: Locator, name: string, tolerance = 2.5) {
  const [sourceBox, overlayBox] = await Promise.all([
    source.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const host = element.closest('.slide') || element.ownerDocument.querySelector('.slide.active');
      const hostRect = host?.getBoundingClientRect();
      if (!hostRect) return null;
      return {
        x: ((rect.left - hostRect.left) / hostRect.width) * 100,
        y: ((rect.top - hostRect.top) / hostRect.height) * 100,
        width: (rect.width / hostRect.width) * 100,
        height: (rect.height / hostRect.height) * 100,
      };
    }),
    overlay.evaluate((element) => {
      const target = element as HTMLElement;
      if (!target.style.left || !target.style.top || !target.style.width || !target.style.height) return null;
      return {
        x: Number.parseFloat(target.style.left),
        y: Number.parseFloat(target.style.top),
        width: Number.parseFloat(target.style.width),
        height: Number.parseFloat(target.style.height),
      };
    }),
  ]);
  expect(sourceBox, `${name} source box`).toBeTruthy();
  expect(overlayBox, `${name} overlay box`).toBeTruthy();
  expect(Math.abs(sourceBox!.x - overlayBox!.x), `${name} x%`).toBeLessThan(tolerance);
  expect(Math.abs(sourceBox!.y - overlayBox!.y), `${name} y%`).toBeLessThan(tolerance);
  expect(Math.abs(sourceBox!.width - overlayBox!.width), `${name} width%`).toBeLessThan(tolerance);
  expect(Math.abs(Math.min(sourceBox!.height, 120) - overlayBox!.height), `${name} height%`).toBeLessThan(tolerance);
}

async function expectStandaloneDeckViewport(page: Page, srcdoc: string, name: string, expectedRatio: number) {
  await page.setViewportSize({ width: 1680, height: expectedRatio > 2.5 ? 900 : 945 });
  await page.setContent(srcdoc, { waitUntil: 'load' });
  await expect(page.locator('.deck')).toBeVisible();
  const viewport = await page.locator('.deck').evaluate((deck) => {
    const deckBox = deck.getBoundingClientRect();
    const slides = deck.querySelector('.slides');
    const slidesBox = slides?.getBoundingClientRect();
    return {
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      deckWidth: deckBox.width,
      deckHeight: deckBox.height,
      slidesWidth: slidesBox?.width || 0,
      slidesHeight: slidesBox?.height || 0,
      slidesTop: slidesBox?.top || 0,
      slidesLeft: slidesBox?.left || 0,
    };
  });
  expect(viewport.deckWidth, `${name} deck width`).toBeGreaterThanOrEqual(viewport.windowWidth - 2);
  expect(viewport.deckHeight, `${name} deck height`).toBeGreaterThanOrEqual(viewport.windowHeight - 2);
  expect(viewport.scrollWidth, `${name} horizontal overflow`).toBeLessThanOrEqual(viewport.windowWidth + 2);
  expect(viewport.scrollHeight, `${name} vertical overflow`).toBeLessThanOrEqual(viewport.windowHeight + 2);
  expect(Math.abs((viewport.slidesWidth / viewport.slidesHeight) - expectedRatio), `${name} standalone slide ratio`).toBeLessThan(expectedRatio * 0.08);
  expect(viewport.slidesWidth / viewport.windowWidth, `${name} slide width fill`).toBeGreaterThan(expectedRatio > 2.5 ? 0.88 : 0.78);
  expect(viewport.slidesHeight / viewport.windowHeight, `${name} slide height fill`).toBeGreaterThan(expectedRatio > 2.5 ? 0.44 : 0.76);
  expect(viewport.slidesTop, `${name} slide top`).toBeGreaterThanOrEqual(0);
  expect(viewport.slidesLeft, `${name} slide left`).toBeGreaterThanOrEqual(0);
  await expectRenderedSlide(page, page.locator('.slide-metrics').first(), `${name}-standalone-metrics`, expectedRatio);
}

async function deckStyleSnapshot(deck: Locator) {
  return deck.evaluate((target) => {
    const style = getComputedStyle(target);
    const firstSlide = target.querySelector('.slide');
    const firstSlideStyle = firstSlide ? getComputedStyle(firstSlide) : null;
    return {
      className: target.className,
      deckBg: style.getPropertyValue('--deck-bg').trim(),
      primary: style.getPropertyValue('--deck-primary').trim(),
      accent: style.getPropertyValue('--deck-accent').trim(),
      radius: style.getPropertyValue('--deck-radius').trim(),
      titleScale: style.getPropertyValue('--deck-title-scale').trim(),
      chartStroke: style.getPropertyValue('--deck-chart-stroke').trim(),
      slidePadding: firstSlideStyle?.padding || '',
      slideBackground: firstSlideStyle?.backgroundImage || '',
    };
  });
}

async function designerElementGeometry(element: Locator) {
  return element.evaluate((target) => {
    const item = target as HTMLElement;
    const percent = (value: string) => Number.parseFloat(value || '0') || 0;
    return {
      x: percent(item.style.left),
      y: percent(item.style.top),
      width: percent(item.style.width),
      height: percent(item.style.height),
    };
  });
}

function stylePercentValue(styleText: string, property: string) {
  const match = new RegExp(`(?:^|;)\\s*${property}:\\s*([-\\d.]+)%`).exec(styleText);
  expect(match, `${property} percent in ${styleText}`).toBeTruthy();
  return Number(match![1]);
}

function makeDeckFixture(title: string) {
  const config = {
    topic: title,
    useCase: 'roadshow',
    audience: '投资人',
    aspectRatio: '16:9',
    styleKey: 'tech_launch',
    durationMinutes: 12,
    pageCount: 8,
    density: 'standard',
    chartLevel: 'rich',
    speakerNotes: true,
  };
  const plan = {
    title,
    subtitle: 'Schema Designer E2E',
    generatedAt: new Date().toISOString(),
    sections: [{ id: 'section-growth', title: '增长质量', purpose: '说明产品化和商业化进展' }],
    knowledge: [{ id: 'k-growth', title: '增长数据', source: 'E2E fixture', detail: 'MRR、留存率和 NDR 示例数据。', status: 'ready' }],
    slides: [
      {
        id: 'slide-cover',
        sectionId: 'section-growth',
        index: 1,
        title: 'OpenAtlas 融资汇报',
        headline: 'AI PPT 进入可编辑交付阶段',
        bullets: ['Schema 驱动编辑', '实时 HTML-PPT 预览', '版本保存和回退'],
        visual: '路演封面',
        layout: 'cover',
        knowledgeIds: ['k-growth'],
        status: 'confirmed',
        speakerNotes: '开场强调产品化进展。',
        renderHints: [],
      },
      {
        id: 'slide-metrics',
        sectionId: 'section-growth',
        index: 2,
        title: '关键指标趋势',
        headline: '增长质量通过指标和图表表达',
        bullets: ['MRR 增长稳定', '客户留存提升', 'NDR 达到健康水平'],
        visual: '折线图 + 三张指标卡',
        layout: 'metrics',
        knowledgeIds: ['k-growth'],
        status: 'draft',
        speakerNotes: '说明数据为 E2E 示例。',
        renderHints: ['chart=line'],
        visualSpec: {
          type: 'line',
          chart: {
            kind: 'line',
            labels: ['1月', '2月', '3月', '4月'],
            series: [
              { name: 'MRR', values: [120, 148, 171, 205], unit: '万' },
              { name: 'Pipeline', values: [80, 96, 140, 188], unit: '万' },
            ],
            source: 'E2E fixture',
            methodology: '样例月度经营数据',
            estimated: true,
          },
          metrics: [
            { label: 'NDR', value: '128%', detail: '净收入留存' },
            { label: '留存率', value: '94%', detail: '客户留存' },
            { label: 'MOM', value: '22%', detail: '月环比增长' },
          ],
        },
      },
      {
        id: 'slide-auto-architecture',
        sectionId: 'section-growth',
        index: 3,
        title: '自动架构调度',
        headline: 'visualSpec 应该优先驱动页面版式',
        bullets: ['当前 layout 故意保留 two_column', 'Renderer 应按 architecture 渲染'],
        visual: '四层架构图',
        layout: 'two_column',
        knowledgeIds: ['k-growth'],
        status: 'draft',
        speakerNotes: '用于验证 layout scheduler。',
        renderHints: [],
        visualSpec: {
          type: 'architecture',
          title: 'AIPPT Agent 架构',
          layers: [
            { label: '输入理解', detail: '解析主题、受众、时长和资料缺口' },
            { label: 'Schema 规划', detail: '生成章节、页面和 visualSpec' },
            { label: 'HTML 渲染', detail: '根据 schema 和 style token 渲染' },
          ],
        },
      },
      {
        id: 'slide-auto-matrix',
        sectionId: 'section-growth',
        index: 4,
        title: '自动矩阵调度',
        headline: '矩阵 visualSpec 应渲染为 compare 页面',
        bullets: ['当前 layout 故意保留 two_column', 'Renderer 应按 matrix 渲染'],
        visual: '三列能力对比矩阵',
        layout: 'two_column',
        knowledgeIds: ['k-growth'],
        status: 'draft',
        speakerNotes: '用于验证 matrix layout scheduler。',
        renderHints: [],
        visualSpec: {
          type: 'matrix',
          title: '能力对比矩阵',
          columns: [
            { label: 'AIPPT', items: ['Schema 驱动', 'AI Patch 审阅', 'HTML 渲染'], score: 'high' },
            { label: '传统模板', items: ['手动复制', '样式固定', '难以追溯'], score: 'medium' },
            { label: '普通文档', items: ['缺视觉结构', '缺演示态', '难复用'], score: 'low' },
          ],
        },
      },
    ],
  };
  return { config, plan };
}

test.describe('AIPPT Schema Designer', () => {
  test('create, edit, save, restore, and manage pages from schema', async ({ page, request }) => {
    test.setTimeout(120_000);
    const token = await loginApi(request);
    const title = `E2E AIPPT Designer ${Date.now()}`;
    const fixture = makeDeckFixture(title);

    const created = await api<{ id: string; query: string; version: { version_no: number } }>(request, 'POST', '/presentation-canvas/decks', token, {
      query: 'E2E 创建 Schema Designer deck',
      config: fixture.config,
      plan: fixture.plan,
      status: 'outline_review',
      change_summary: 'E2E 创建',
    });
    expect(created.version.version_no).toBe(1);

    const editedPlan = {
      ...fixture.plan,
      slides: fixture.plan.slides.map((slide) => (
        slide.id === 'slide-cover'
          ? { ...slide, headline: 'API 保存后的 Designer 可回退版本' }
          : slide
      )),
    };
    const saved = await api<any>(request, 'PUT', `/presentation-canvas/decks/${created.id}`, token, {
      query: created.query,
      config: fixture.config,
      plan: editedPlan,
      status: 'outline_review',
      change_summary: 'E2E 保存 v2',
    });
    expect(saved.version.version_no).toBe(2);

    const versions = await api<any>(request, 'GET', `/presentation-canvas/decks/${created.id}/versions`, token);
    expect(versions.items.length).toBeGreaterThanOrEqual(2);
    const v1 = versions.items.find((item: any) => item.version_no === 1);
    expect(v1).toBeTruthy();

    const restored = await api<any>(request, 'POST', `/presentation-canvas/decks/${created.id}/versions/${v1.id}/restore`, token);
    expect(restored.version.version_no).toBeGreaterThan(2);
    expect(restored.plan.slides[0].headline).toBe('AI PPT 进入可编辑交付阶段');

    await loginWithToken(page, token);
    await page.goto(`/presentation-canvas/designer/${created.id}`);
    await expect(page.getByText(title).first()).toBeVisible();
    await expect(page.getByTestId('aippt-designer-preview-frame')).toHaveClass(/presentation-designer-page__frame--html/);
    await expect(page.getByTestId('aippt-schema-quality')).toBeVisible();
    await expect(page.getByRole('button', { name: /保存版本/ })).toBeVisible();

    const headline = 'E2E 实时预览正在读取 Deck Schema';
    await page.getByRole('textbox', { name: '核心观点' }).fill(headline);
    const deckFrame = page.frameLocator('iframe[title="AIPPT Designer Preview"]');
    await expect(deckFrame.getByRole('heading', { name: headline })).toBeVisible();

    await page.route('**/api/presentation-canvas/decks/**/slide-action', async (route) => {
      const body = route.request().postDataJSON();
      if (body.action === 'enhance_chart') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: `patch-${Date.now()}`,
            action: 'enhance_chart',
            slide_id: 'slide-metrics',
            slide_patch: {
              title: '关键指标趋势',
              headline: '增长质量通过可信数据来源表达',
              bullets: ['MRR 与 Pipeline 持续抬升', '补充来源和口径后可审阅', '估算数据需要明确标记'],
              visual: '多序列折线图 + 可信度来源标记',
              layout: 'metrics',
              speakerNotes: '强调图表数据来源和估算口径。',
              renderHints: ['chart=line', 'emphasis=可信图表'],
              visualSpec: {
                type: 'line',
                chart: {
                  kind: 'line',
                  labels: ['1月', '2月', '3月', '4月'],
                  series: [
                    { name: 'MRR', values: [128, 156, 188, 228], unit: '万' },
                    { name: 'Pipeline', values: [92, 118, 162, 210], unit: '万' },
                  ],
                  source: 'E2E AI Patch Source',
                  methodology: 'AI patch 后的月度经营口径',
                  estimated: false,
                },
                metrics: [
                  { label: 'NDR', value: '132%', detail: '净收入留存' },
                  { label: '留存率', value: '95%', detail: '客户留存' },
                  { label: 'MOM', value: '24%', detail: '月环比增长' },
                ],
              },
              status: 'draft',
            },
            rationale: '已增强图表可信度字段和多序列数据。',
            warnings: [],
            source: 'hermes',
            diff_summary: ['visualSpec.chart.source：E2E fixture -> E2E AI Patch Source'],
            quality: {
              fallback: false,
              repaired: false,
              warning_count: 0,
              changed_fields: ['headline', 'bullets', 'visualSpec'],
              context_slide_count: 3,
              knowledge_count: 1,
            },
            generated_at: new Date().toISOString(),
          }),
        });
        return;
      }
      expect(body.action).toBe('rewrite');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: `patch-${Date.now()}`,
          action: 'rewrite',
          slide_id: 'slide-cover',
          slide_patch: {
            title: 'AI Patch 封面标题',
            headline: 'AI Patch 核心观点已进入审阅流',
            bullets: ['先预览差异', '确认后再应用', '保留版本回退'],
            visual: 'AI patch 预览卡 + 汇报封面',
            layout: 'cover',
            speakerNotes: '说明 AI patch 需要先审阅再应用。',
            renderHints: ['emphasis=审阅后应用'],
            visualSpec: {
              type: 'scorecard',
              metrics: [
                { label: '审阅流', value: '1', detail: 'AI patch 先预览再应用' },
              ],
            },
            status: 'draft',
          },
          rationale: '已生成可审阅的 schema 补丁。',
          warnings: ['E2E 模拟 warning'],
          source: 'hermes',
          diff_summary: ['核心观点：旧 -> 新'],
          quality: {
            fallback: false,
            repaired: false,
            warning_count: 1,
            changed_fields: ['title', 'headline', 'bullets', 'visualSpec'],
            context_slide_count: 2,
            knowledge_count: 1,
          },
          generated_at: new Date().toISOString(),
        }),
      });
    });
    await page.getByRole('button', { name: /重写本页/ }).click();
    await expect(page.getByTestId('aippt-ai-patch-preview')).toBeVisible();
    await expect(page.getByText('已生成可审阅的 schema 补丁。')).toBeVisible();
    await expect(page.getByText('Hermes 生成')).toBeVisible();
    await expect(page.getByText('等待确认')).toBeVisible();
    await expect(page.getByText('页面视觉模板', { exact: true })).toBeVisible();
    await expect(page.getByText('上下文 2 页')).toBeVisible();
    await expect(deckFrame.getByText('AI Patch 核心观点已进入审阅流')).toBeVisible();
    await expect(page.getByRole('textbox', { name: '核心观点' })).toHaveValue(headline);
    await page.getByTestId('aippt-ai-apply-patch').click();
    await expect(page.getByTestId('aippt-ai-patch-preview')).toHaveCount(0);
    await expect(page.getByTestId('aippt-ai-undo-card')).toBeVisible();
    await expect(page.getByRole('textbox', { name: '核心观点' })).toHaveValue('AI Patch 核心观点已进入审阅流');
    await page.getByRole('button', { name: /撤销 AI 应用/ }).click();
    await expect(page.getByTestId('aippt-ai-undo-card')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: '核心观点' })).toHaveValue(headline);

    await page.getByRole('button', { name: /自动架构调度/ }).click();
    await expect(deckFrame.getByText('Architecture')).toBeVisible();
    await expect(deckFrame.getByText('AIPPT Agent 架构')).toBeVisible();

    const saveResponse = page.waitForResponse((response) => (
      response.url().includes(`/api/presentation-canvas/decks/${created.id}`)
      && response.request().method() === 'PUT'
    ));
    await page.getByRole('button', { name: /保存版本/ }).click();
    expect((await saveResponse).ok()).toBeTruthy();
    await expect(page.getByText(/v\d+/).first()).toBeVisible();

    await page.getByRole('button', { name: /关键指标趋势/ }).click();
    await expect(page.getByText('数据序列', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /添加序列/ })).toBeVisible();
    await expect(page.getByRole('textbox', { name: '数据来源' })).toHaveValue('E2E fixture');
    await page.getByRole('textbox', { name: '数据来源' }).fill('E2E edited source');
    await page.getByRole('textbox', { name: '统计口径' }).fill('E2E 人工编辑后的经营口径');
    await expect(deckFrame.getByText(/Source: E2E edited source/)).toBeVisible();
    await expect(deckFrame.getByText(/口径: E2E 人工编辑后的经营口径/)).toBeVisible();
    await expect(deckFrame.getByText(/估算数据/)).toBeVisible();
    await page.getByRole('switch', { name: '估算数据' }).click();
    await expect(deckFrame.getByText(/估算数据/)).toHaveCount(0);
    await page.getByRole('switch', { name: '估算数据' }).click();
    await expect(deckFrame.getByText(/估算数据/)).toBeVisible();
    await expect(deckFrame.getByText('多序列趋势')).toBeVisible();
    await expect(deckFrame.getByText('Pipeline', { exact: true })).toBeVisible();
    await expect(deckFrame.getByText(/Pipeline：188万/)).toBeVisible();
    await page.getByRole('button', { name: /增强图表/ }).click();
    await expect(page.getByTestId('aippt-ai-patch-preview')).toBeVisible();
    const chartPatchPreview = page.getByTestId('aippt-ai-patch-preview');
    await expect(chartPatchPreview.getByText('数据来源', { exact: true })).toBeVisible();
    await expect(chartPatchPreview.getByText('统计口径', { exact: true })).toBeVisible();
    await expect(chartPatchPreview.getByText('是否估算', { exact: true })).toBeVisible();
    await expect(chartPatchPreview.getByText('数据序列 1.数值', { exact: true })).toBeVisible();
    await expect(page.getByText('数据序列 2.数值')).toBeVisible();
    await expect(deckFrame.getByText(/Source: E2E AI Patch Source/)).toBeVisible();
    await page.getByTestId('aippt-ai-discard-patch').click();
    await expect(page.getByTestId('aippt-ai-patch-preview')).toHaveCount(0);
    await page.getByRole('button', { name: /复制/ }).click();
    await expect(page.getByRole('button', { name: /关键指标趋势 副本/ })).toBeVisible();
    await page.getByRole('button', { name: /删除/ }).click();
    await expect(page.getByRole('dialog', { name: '删除当前页面？' })).toBeVisible();
    await page.getByRole('button', { name: /^删\s*除$/ }).click();
    await expect(page.getByRole('button', { name: /关键指标趋势 副本/ })).toHaveCount(0);
  });

  test('low-code designer inserts editable text and preserves final HTML preview', async ({ page }) => {
    test.setTimeout(90_000);
    const title = `E2E AIPPT Lowcode ${Date.now()}`;
    const fixture = makeDeckFixture(title);
    const deckId = 'mock-lowcode-deck';

    await loginWithToken(page, 'mock-token');
    await page.route('**/api/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'mock-user',
          username: 'mock',
          email: 'mock@demo.openatlas',
          role: 'tenant_admin',
          is_active: true,
          is_admin: true,
          capabilities: ['aippt:write'],
        }),
      });
    });
    await page.route(`**/api/presentation-canvas/decks/${deckId}/versions`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [] }),
      });
    });
    let savedPayload: any = null;
    await page.route(`**/api/presentation-canvas/decks/${deckId}`, async (route) => {
      if (route.request().method() === 'PUT') {
        savedPayload = route.request().postDataJSON();
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: deckId,
            query: savedPayload.query,
            config: savedPayload.config,
            plan: savedPayload.plan,
            status: savedPayload.status,
            version: {
              id: 'mock-lowcode-version-2',
              version_no: 2,
              change_summary: savedPayload.change_summary,
              created_at: new Date().toISOString(),
            },
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: deckId,
          query: 'E2E mock 低代码 Designer deck',
          config: fixture.config,
          plan: fixture.plan,
          status: 'outline_review',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      });
    });

    const response = await page.goto(`/presentation-canvas/designer/${deckId}`);
    expect(response?.ok()).toBeTruthy();
    await expect(page).toHaveURL(new RegExp(`/presentation-canvas/designer/${deckId}`));
    await expect(page.getByText(title).first()).toBeVisible();
    await expect(page.getByTestId('aippt-designer-preview-frame')).toHaveClass(/presentation-designer-page__frame--html/);

    const deckFrame = page.frameLocator('iframe[title="AIPPT Designer Preview"]');
    await expect(deckFrame.locator('.deck')).toBeVisible();

    await page.getByRole('button', { name: /低代码编辑/ }).click();
    await expect(page.getByTestId('aippt-designer-preview-frame')).toHaveClass(/presentation-designer-page__frame--design/);
    await expect(page.getByTestId('aippt-designer-preview-frame')).toHaveAttribute('data-html-synced', 'true');
    await expect(page.getByTestId('aippt-designer-preview-frame')).toHaveAttribute('data-design-mode', 'auto');
    const revisionBeforeEdit = Number(await page.getByTestId('aippt-designer-preview-frame').getAttribute('data-schema-revision'));
    await expect(page.getByTestId('aippt-html-sync-status')).toContainText('控制层已贴合最终 HTML');
    await expect(page.getByTestId('aippt-schema-sync-panel')).toContainText('Renderer srcDoc 同源');

    await page.getByRole('button', { name: /关键指标趋势/ }).click();
    await expect(deckFrame.getByText('多序列趋势')).toBeVisible();
    await expect(page.getByTestId('aippt-designer-preview-frame')).toHaveAttribute('data-html-synced', 'true');
    await page.getByTestId('aippt-design-element-title').click();
    await expect(page.locator('.presentation-designer-inspector-mode')).toContainText('内容编辑');
    await page.getByRole('textbox', { name: '页面标题' }).fill('E2E 结构化标题已编辑');
    await expect(deckFrame.getByRole('heading', { name: 'E2E 结构化标题已编辑' })).toBeVisible();
    await expect.poll(async () => Number(await page.getByTestId('aippt-designer-preview-frame').getAttribute('data-schema-revision'))).toBeGreaterThan(revisionBeforeEdit);
    await expect(page.getByTestId('aippt-schema-sync-panel')).toContainText('编辑');
    await page.getByTestId('aippt-design-element-title').dblclick();
    await page.getByRole('textbox', { name: /编辑标题/ }).fill('E2E 画布双击标题');
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(deckFrame.getByRole('heading', { name: 'E2E 画布双击标题' })).toBeVisible();
    await expectBoxesAligned(
      deckFrame.getByRole('heading', { name: 'E2E 画布双击标题' }),
      page.getByTestId('aippt-design-element-title'),
      'structured title control follows final html',
    );

    await page.getByTestId('aippt-design-element-visual').click();
    await expect(page.locator('.presentation-designer-inspector-mode')).toContainText('图表/结构编辑');
    await expect(page.getByTestId('aippt-visual-edit-entry')).toContainText('图表数据入口');
    await page.getByRole('textbox', { name: '数据来源' }).fill('E2E lowcode smoke source');
    await expect(deckFrame.getByText(/Source: E2E lowcode smoke source/)).toBeVisible();

    await page.getByRole('button', { name: /文本框/ }).click();
    const textElement = page.locator('.presentation-design-element--custom-text').last();
    await expect(textElement).toBeVisible();
    await expect(deckFrame.locator('.freeform-stage')).toBeVisible();
    await expect(page.getByTestId('aippt-designer-preview-frame')).toHaveAttribute('data-design-mode', 'freeform');
    await expect(page.getByTestId('aippt-designer-preview-frame')).toHaveAttribute('data-custom-element-count', '1');
    await expect(page.getByTestId('aippt-object-toolbar')).toBeVisible();
    await expect(page.getByTestId('aippt-object-toolbar')).toContainText('复制对象');
    await expectBoxesAligned(
      deckFrame.getByRole('heading', { name: 'E2E 画布双击标题' }),
      page.getByTestId('aippt-design-element-title'),
      'freeform title remains anchored to final html',
    );
    await textElement.click();
    const initialTextGeometry = await designerElementGeometry(textElement);
    const resizeHandle = textElement.getByTestId('aippt-resize-custom-se');
    await expect(resizeHandle).toBeVisible();
    const handleBox = await resizeHandle.boundingBox();
    expect(handleBox, 'custom text bottom-right resize handle').toBeTruthy();
    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox!.x + handleBox!.width / 2 + 180, handleBox!.y + handleBox!.height / 2 + 90, { steps: 8 });
    await expect(page.getByTestId('aippt-interaction-feedback')).toContainText(/W .*H /);
    await page.mouse.up();
    await expect.poll(async () => (await designerElementGeometry(textElement)).width).toBeGreaterThan(initialTextGeometry.width + 3);
    await expect.poll(async () => (await designerElementGeometry(textElement)).height).toBeGreaterThan(initialTextGeometry.height + 3);
    const resizedTextGeometry = await designerElementGeometry(textElement);
    await expect(page.getByTestId('aippt-selected-object-status')).toContainText(/W .*H /);
    await textElement.dblclick();
    await page.getByRole('textbox', { name: /编辑文本框/ }).fill('E2E 低代码 resize 后文本');
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(deckFrame.getByText('E2E 低代码 resize 后文本')).toBeVisible();
    const afterInlineGeometry = await designerElementGeometry(textElement);
    await textElement.click();
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await designerElementGeometry(textElement)).x).toBeGreaterThan(afterInlineGeometry.x + 0.5);

    await page.getByRole('button', { name: /HTML 预览/ }).click();
    await expect(page.getByTestId('aippt-designer-preview-frame')).toHaveClass(/presentation-designer-page__frame--html/);
    await expect(deckFrame.getByText('E2E 低代码 resize 后文本')).toBeVisible();
    const srcdoc = await page.locator('iframe[title="AIPPT Designer Preview"]').getAttribute('srcdoc');
    expect(srcdoc).toContain('E2E 画布双击标题');
    expect(srcdoc).toContain('E2E 低代码 resize 后文本');
    const customTextStyle = srcdoc?.match(/<div class="freeform-element freeform-custom freeform-custom-text" style="([^"]+)">E2E 低代码 resize 后文本<\/div>/)?.[1] || '';
    expect(customTextStyle, 'custom text style in final HTML').toBeTruthy();
    expect(stylePercentValue(customTextStyle, 'width')).toBeGreaterThan(initialTextGeometry.width + 3);
    expect(stylePercentValue(customTextStyle, 'height')).toBeGreaterThan(initialTextGeometry.height + 3);
    expect(stylePercentValue(customTextStyle, 'left')).toBeGreaterThan(resizedTextGeometry.x + 0.5);
    expect(stylePercentValue(customTextStyle, 'top')).toBeCloseTo(resizedTextGeometry.y, 1);

    const saveResponse = page.waitForResponse((response) => (
      response.url().includes(`/api/presentation-canvas/decks/${deckId}`)
      && response.request().method() === 'PUT'
    ));
    await page.getByRole('button', { name: /保存版本/ }).click();
    expect((await saveResponse).ok()).toBeTruthy();
    expect(savedPayload?.plan?.slides?.find((slide: any) => slide.id === 'slide-metrics')?.title).toBe('E2E 画布双击标题');
    const savedSlide = savedPayload.plan.slides.find((slide: any) => slide.id === 'slide-metrics');
    expect(savedSlide.design.mode).toBe('freeform');
    expect(savedSlide.design.customElements.some((element: any) => element.content === 'E2E 低代码 resize 后文本')).toBeTruthy();
    const savedCustom = savedSlide.design.customElements.find((element: any) => element.content === 'E2E 低代码 resize 后文本');
    expect(savedCustom.width).toBeGreaterThan(initialTextGeometry.width + 3);
    expect(savedCustom.x).toBeGreaterThan(resizedTextGeometry.x + 0.5);
    await expect(page).toHaveURL(new RegExp(`/presentation-canvas/designer/${deckId}`));
    await expect(page.getByText(title).first()).toBeVisible();
  });

  test('renderer visual surfaces are nonblank across core layouts and ratios', async ({ page, request }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1680, height: 1050 });
    const token = await loginApi(request);
    await loginWithToken(page, token);

    for (const aspectRatio of ['16:9', '3:1'] as const) {
      const title = `E2E AIPPT Visual ${aspectRatio} ${Date.now()}`;
      const fixture = makeDeckFixture(title);
      fixture.config.aspectRatio = aspectRatio;
      fixture.config.styleKey = aspectRatio === '3:1' ? 'executive_blue' : 'tech_launch';
      const created = await api<any>(request, 'POST', '/presentation-canvas/decks', token, {
        query: `E2E 创建 ${aspectRatio} 视觉回归 deck`,
        config: fixture.config,
        plan: fixture.plan,
        status: 'outline_review',
        change_summary: `E2E visual ${aspectRatio}`,
      });

      await page.goto(`/presentation-canvas/designer/${created.id}`);
      await expect(page.getByText(title).first()).toBeVisible();
      const deckFrame = page.frameLocator('iframe[title="AIPPT Designer Preview"]');
      const ratio = aspectRatio === '3:1' ? 3 : 16 / 9;

      await expect(deckFrame.locator('.slide-metrics').first().getByText('多序列趋势')).toBeVisible();
      await expect(deckFrame.locator('.slide-metrics').first().getByText(/Source: E2E fixture/)).toBeVisible();
      await expect(deckFrame.locator('.slide-metrics').first().getByText(/口径: 样例月度经营数据/)).toBeVisible();
      await expect(deckFrame.locator('.slide-metrics').first().getByText(/估算数据/)).toBeVisible();
      await expect(deckFrame.locator('.slide-diagram').first().getByText('AIPPT Agent 架构')).toBeVisible();
      await expect(deckFrame.locator('.slide-compare').first().getByText('能力对比矩阵')).toBeVisible();

      await expectRenderedSlide(page, deckFrame.locator('.slide-metrics').first(), `${aspectRatio}-metrics`, ratio);
      await expectRenderedSlide(page, deckFrame.locator('.slide-diagram').first(), `${aspectRatio}-architecture`, ratio);
      await expectRenderedSlide(page, deckFrame.locator('.slide-compare').first(), `${aspectRatio}-matrix`, ratio);

      const srcdoc = await page.locator('iframe[title="AIPPT Designer Preview"]').getAttribute('srcdoc');
      expect(srcdoc, `${aspectRatio} srcdoc`).toBeTruthy();
      await expectStandaloneDeckViewport(page, srcdoc!, `${aspectRatio}-fullscreen`, ratio);
    }
  });

  test('designer shortcuts, pasted assets, uploads, and editable pptx export', async ({ page, request }) => {
    test.setTimeout(120_000);
    const token = await loginApi(request);
    const title = `E2E AIPPT Shortcuts ${Date.now()}`;
    const fixture = makeDeckFixture(title);
    const created = await api<any>(request, 'POST', '/presentation-canvas/decks', token, {
      query: 'E2E 创建快捷键和素材测试 deck',
      config: fixture.config,
      plan: fixture.plan,
      status: 'outline_review',
      change_summary: 'E2E shortcuts',
    });

    await loginWithToken(page, token);
    await page.goto(`/presentation-canvas/designer/${created.id}`);
    await expect(page.getByText(title).first()).toBeVisible();
    await page.getByRole('button', { name: /低代码编辑/ }).click();
    await page.locator('.presentation-designer-inspector-tabs').getByText('对象').click();
    const layerPanel = page.getByTestId('aippt-layer-panel');
    await expect(layerPanel).toBeVisible();
    await layerPanel.locator('.presentation-designer-layer-main').filter({ hasText: '标题' }).click();
    await page.locator('.presentation-field--switch:has-text("锁定对象") .ant-switch').click();
    await expect(page.locator('.presentation-design-element--title')).toHaveClass(/is-locked/);
    await page.locator('.presentation-field--switch:has-text("锁定对象") .ant-switch').click();
    await expect(page.locator('.presentation-design-element--title')).not.toHaveClass(/is-locked/);
    await layerPanel.getByRole('button', { name: /重命名标题/ }).click();
    await layerPanel.getByRole('textbox').fill('主标题');
    await layerPanel.getByRole('textbox').press('Enter');
    await expect(layerPanel.locator('.presentation-designer-layer-main').filter({ hasText: '主标题' })).toBeVisible();
    await page.locator('.presentation-design-element--title').click();
    await page.locator('.presentation-design-element--headline').click({ modifiers: ['Shift'] });
    await expect(page.locator('.presentation-design-element.is-selected')).toHaveCount(2);
    await page.locator('.presentation-design-element--headline').click({ button: 'right' });
    await expect(page.locator('.presentation-designer-context-menu')).toBeVisible();
    await page.locator('.presentation-designer-context-menu').getByRole('button', { name: '锁定对象' }).click();
    await expect(page.locator('.presentation-design-element--headline')).toHaveClass(/is-locked/);
    await page.locator('.presentation-design-element--headline').click({ button: 'right' });
    await page.locator('.presentation-designer-context-menu').getByRole('button', { name: '解锁对象' }).click();
    await expect(page.locator('.presentation-design-element--headline')).not.toHaveClass(/is-locked/);
    await page.getByRole('button', { name: '图片/视觉区', exact: true }).click();
    await expect(page.getByRole('button', { name: /替换图片\/SVG/ })).toBeVisible();

    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#22D3EE"/><text x="32" y="96" font-size="42" fill="#0B1120">AIPPT</text></svg>';
    await page.locator('input[type="file"]').setInputFiles({
      name: 'aippt-upload.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(svg),
    });
    await expect(page.getByRole('textbox', { name: '图片 URL' })).toHaveValue(/data:image\/svg\+xml/);
    await expect(page.locator('.presentation-design-element--visual img')).toBeVisible();

    await page.evaluate((svgText) => {
      const data = new DataTransfer();
      data.setData('text/plain', svgText);
      window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data }));
    }, svg.replace('#22D3EE', '#818CF8'));
    await expect(page.getByRole('textbox', { name: '图片 URL' })).toHaveValue(/data:image\/svg\+xml/);

    await page.locator('.presentation-designer-inspector-tabs').getByText('内容').click();
    await page.getByRole('textbox', { name: '核心观点' }).fill('快捷键撤销前的文本');
    await expect(page.getByRole('textbox', { name: '核心观点' })).toHaveValue('快捷键撤销前的文本');
    await page.locator('.presentation-designer-artboard').click({ position: { x: 24, y: 24 } });
    await page.keyboard.press('ControlOrMeta+Z');
    await expect(page.getByRole('textbox', { name: '核心观点' })).not.toHaveValue('快捷键撤销前的文本');
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Y');
    await expect(page.getByRole('textbox', { name: '核心观点' })).toHaveValue('快捷键撤销前的文本');

    const customCountBeforePaste = await page.locator('.presentation-design-element--custom').count();
    await page.keyboard.press('ControlOrMeta+C');
    await page.evaluate(() => {
      const data = new DataTransfer();
      window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data }));
    });
    await expect(page.locator('.presentation-design-element--custom')).toHaveCount(customCountBeforePaste + 1);

    const saveResponse = page.waitForResponse((response) => (
      response.url().includes(`/api/presentation-canvas/decks/${created.id}`)
      && response.request().method() === 'PUT'
    ));
    await page.keyboard.press('ControlOrMeta+S');
    expect((await saveResponse).ok()).toBeTruthy();

    const validationResponse = page.waitForResponse((response) => (
      response.url().includes(`/api/presentation-canvas/decks/${created.id}/validate-pptx`)
      && response.request().method() === 'POST'
    ));
    await page.getByRole('button', { name: /兼容性检查/ }).click();
    const validation = await validationResponse;
    expect(validation.ok()).toBeTruthy();
    const validationJson = await validation.json();
    expect(validationJson.ok).toBeTruthy();
    expect(validationJson.checks.some((item: any) => item.key === 'native_charts')).toBeTruthy();
    expect(validationJson.checks.some((item: any) => item.key === 'svg_vector_media')).toBeTruthy();
    await expect(page.getByTestId('aippt-pptx-compat-report')).toBeVisible();
    await page.getByRole('button', { name: '知道了' }).click();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /导出 PPTX/ }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.pptx$/);
    const downloadedPath = await download.path();
    expect(downloadedPath).toBeTruthy();
    expect(fs.statSync(downloadedPath!).size).toBeGreaterThan(10_000);
    const pptxBuffer = fs.readFileSync(downloadedPath!);
    expect(pptxBuffer.includes(Buffer.from('ppt/charts/chart'))).toBeTruthy();
    expect(pptxBuffer.includes(Buffer.from('.svg'))).toBeTruthy();
  });

  test('style presets alter final HTML renderer tokens', async ({ page, request }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1680, height: 1050 });
    const token = await loginApi(request);
    await loginWithToken(page, token);

    const cases = [
      {
        styleKey: 'executive_blue',
        useCase: 'report',
        className: 'theme-executive_blue',
        bg: '#F6F8FC',
        primary: '#1D4ED8',
        radius: '8px',
        titleScale: '0.95',
        chartStroke: '5.5',
      },
      {
        styleKey: 'tech_launch',
        useCase: 'roadshow',
        className: 'theme-tech_launch',
        bg: '#070A12',
        primary: '#818CF8',
        radius: '14px',
        titleScale: '1.08',
        chartStroke: '7',
      },
      {
        styleKey: 'teaching_clear',
        useCase: 'training',
        className: 'theme-teaching_clear',
        bg: '#F8FAF8',
        primary: '#047857',
        radius: '10px',
        titleScale: '0.9',
        chartStroke: '5',
      },
    ] as const;

    const snapshots: Array<Awaited<ReturnType<typeof deckStyleSnapshot>>> = [];
    for (const item of cases) {
      const title = `E2E AIPPT Style ${item.styleKey} ${Date.now()}`;
      const fixture = makeDeckFixture(title);
      fixture.config.styleKey = item.styleKey;
      fixture.config.useCase = item.useCase;
      const created = await api<any>(request, 'POST', '/presentation-canvas/decks', token, {
        query: `E2E 创建 ${item.styleKey} 风格 deck`,
        config: fixture.config,
        plan: fixture.plan,
        status: 'outline_review',
        change_summary: `E2E style ${item.styleKey}`,
      });

      await page.goto(`/presentation-canvas/designer/${created.id}`);
      await expect(page.getByText(title).first()).toBeVisible();
      const deckFrame = page.frameLocator('iframe[title="AIPPT Designer Preview"]');
      const deck = deckFrame.locator('.deck');
      await expect(deck).toHaveClass(new RegExp(item.className));
      const snapshot = await deckStyleSnapshot(deck);
      expect(snapshot.deckBg, `${item.styleKey} bg`).toBe(item.bg);
      expect(snapshot.primary, `${item.styleKey} primary`).toBe(item.primary);
      expect(snapshot.radius, `${item.styleKey} radius`).toBe(item.radius);
      expect(snapshot.titleScale, `${item.styleKey} title scale`).toBe(item.titleScale);
      expect(snapshot.chartStroke, `${item.styleKey} chart stroke`).toBe(item.chartStroke);
      expect(snapshot.slidePadding, `${item.styleKey} slide padding`).not.toBe('');
      expect(snapshot.slideBackground, `${item.styleKey} slide background`).not.toBe('');
      snapshots.push(snapshot);
    }

    expect(new Set(snapshots.map((item) => item.deckBg)).size).toBe(3);
    expect(new Set(snapshots.map((item) => item.radius)).size).toBe(3);
    expect(new Set(snapshots.map((item) => item.titleScale)).size).toBe(3);
  });
});
