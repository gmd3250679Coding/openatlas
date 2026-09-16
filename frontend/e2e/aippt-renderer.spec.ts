import { expect, test } from '@playwright/test';
import { buildHtmlDeck, type DeckRenderStyle } from '../src/features/aippt/renderer';
import { normalizePlanLayouts, type DeckConfig, type DeckPlan } from '../src/features/aippt/schema';
import {
  GENERIC_OPERATIONS_DEMO_PROMPT,
  OPENATLAS_INVESTOR_DEMO_PROMPT,
  buildGenericOperationsDemo,
  buildOpenAtlasInvestorDemo,
} from '../src/features/aippt/fixtures';
import { selectedStyle } from '../src/features/aippt/styles';

const STYLE: DeckRenderStyle = {
  key: 'tech_launch',
  name: '科技路演黑',
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
};

const CONFIG: DeckConfig = {
  topic: 'OpenAtlas 融资汇报',
  useCase: 'roadshow',
  aspectRatio: '16:9',
  styleKey: 'tech_launch',
  audience: '投资人',
  durationMinutes: 18,
  pageCount: 8,
  density: 'standard',
  chartLevel: 'rich',
  speakerNotes: true,
};

const PLAN: DeckPlan = {
  title: 'OpenAtlas 融资汇报｜Renderer Smoke',
  generatedAt: '2026-06-29T00:00:00.000Z',
  sections: [
    { id: 's1', title: '产品与增长', purpose: '证明产品价值和增长质量' },
    { id: 's2', title: '差异化', purpose: '说明架构和竞争壁垒' },
  ],
  knowledge: [
    { id: 'k-growth', title: '经营数据', source: 'fixture', detail: 'MRR、Pipeline 和留存数据样例。', status: 'ready' },
    { id: 'k-arch', title: '产品架构', source: 'fixture', detail: 'AIPPT Agent 生成、编辑、渲染链路。', status: 'ready' },
  ],
  slides: [
    {
      id: 'cover',
      sectionId: 's1',
      index: 1,
      title: 'OpenAtlas 数智员工融资汇报',
      headline: '用 AIPPT 把 AI 生成内容变成可编辑交付物',
      bullets: ['Schema 驱动', 'HTML-PPT 实时预览', 'Designer 低代码编辑'],
      visual: '路演封面',
      layout: 'cover',
      knowledgeIds: ['k-growth'],
      status: 'confirmed',
      speakerNotes: '开场强调产品化能力。',
      renderHints: [],
    },
    {
      id: 'metrics',
      sectionId: 's1',
      index: 2,
      title: '核心指标趋势',
      headline: '用多序列趋势和指标卡说明增长质量',
      bullets: ['MRR 稳定增长', 'Pipeline 进入加速阶段', 'NDR 和留存率健康'],
      visual: '折线图 + 三张指标卡',
      layout: 'metrics',
      knowledgeIds: ['k-growth'],
      status: 'draft',
      speakerNotes: '说明样例数据口径。',
      renderHints: ['chart=line'],
      visualSpec: {
        type: 'combo_metrics',
        title: '增长质量趋势',
        chart: {
          kind: 'line',
          labels: ['1月', '2月', '3月', '4月'],
          series: [
            { name: 'MRR', values: [120, 148, 171, 205], unit: '万' },
            { name: 'Pipeline', values: [80, 96, 140, 188], unit: '万' },
          ],
          source: 'E2E renderer fixture',
          methodology: '月度经营样例',
          estimated: true,
        },
        metrics: [
          { label: 'NDR', value: '128%', detail: '净收入留存' },
          { label: '留存率', value: '94%', detail: '客户留存' },
          { label: 'MOM', value: '22%', detail: '月环比增长' },
        ],
      },
      evidenceRole: '需要引用真实经营数据或可披露样例。',
    },
    {
      id: 'matrix',
      sectionId: 's2',
      index: 3,
      title: '三类方案能力差异',
      headline: '企业级记忆、多 Agent 协同和可审计链路形成壁垒',
      bullets: ['OpenAtlas 企业级闭环', '通用 Agent 平台缺少业务记忆', 'RPA 工具停留在单任务自动化'],
      visual: '三列对比矩阵',
      layout: 'compare',
      knowledgeIds: ['k-arch'],
      status: 'draft',
      speakerNotes: '突出差异化能力。',
      renderHints: [],
      visualSpec: {
        type: 'matrix',
        title: '能力对比矩阵',
        description: '用色块深浅表达能力等级。',
        columns: [
          { label: 'OpenAtlas', score: 'high', items: ['企业级记忆', '多 Agent 协同', '可审计决策链'] },
          { label: '通用 Agent 平台', score: 'medium', items: ['记忆弱', '缺业务闭环', '审计较弱'] },
          { label: 'RPA工具', score: 'low', items: ['无记忆', '单任务', '日志级追踪'] },
        ],
      },
    },
    {
      id: 'architecture',
      sectionId: 's2',
      index: 4,
      title: 'AIPPT Agent 架构',
      headline: '感知、规划、编辑、渲染形成可审阅工作流',
      bullets: ['感知用户输入和资料', '规划章节和视觉表达', '编辑 Deck Schema', '渲染 HTML-PPT'],
      visual: '四层架构图',
      layout: 'diagram',
      knowledgeIds: ['k-arch'],
      status: 'draft',
      speakerNotes: '强调 Schema 是可审计中间层。',
      renderHints: [],
      visualSpec: {
        type: 'architecture',
        title: 'AIPPT Agent 架构',
        layers: [
          { label: '感知', detail: '用户目标、资料、受众和场景' },
          { label: '规划', detail: '章节结构、页面逻辑和 visualSpec' },
          { label: '编辑', detail: 'Designer 修改 Deck Schema' },
          { label: '渲染', detail: 'HTML-PPT 预览、全屏和下载' },
        ],
        callouts: ['Schema 驱动', '可回退版本'],
      },
    },
  ],
};

test.describe('AIPPT HTML renderer', () => {
  test('normalizes spec lock v2, visual templates and diversity before rendering', async () => {
    const repeatedPlan: DeckPlan = {
      ...PLAN,
      slides: [
        PLAN.slides[0],
        ...Array.from({ length: 5 }, (_, index) => ({
          ...PLAN.slides[1],
          id: `metric-repeat-${index + 1}`,
          index: index + 2,
          title: `重复指标页 ${index + 1}`,
          renderHints: ['chart=scorecard'],
          visualSpec: {
            type: 'scorecard' as const,
            metrics: [
              { label: '效率', value: `${20 + index}%`, detail: '样例口径' },
              { label: '成本', value: `${12 + index}%`, detail: '样例口径' },
              { label: '体验', value: `${80 + index}%`, detail: '样例口径' },
              { label: '覆盖', value: `${60 + index}%`, detail: '样例口径' },
            ],
          },
        })),
      ],
    };
    const normalized = normalizePlanLayouts(repeatedPlan, CONFIG);
    expect(normalized.specLock?.version).toBe('aippt-spec-lock-v2');
    expect(normalized.specLock?.layoutPlan?.pages).toHaveLength(normalized.slides.length);
    expect(Object.keys(normalized.specLock?.pageTemplates || {})).toHaveLength(normalized.slides.length);
    expect(normalized.specLock?.exportPolicy?.nativeChartTemplates).toContain('line_chart');
    expect(normalized.slides.slice(1).every((slide) => Boolean(slide.visualSpec?.templateId))).toBe(true);

    const layouts = normalized.slides.map((slide) => slide.layout);
    const templates = normalized.slides.map((slide) => normalized.specLock?.pageTemplates?.[slide.id] || '');
    for (let index = 0; index < normalized.slides.length - 2; index += 1) {
      expect(layouts[index] === layouts[index + 1] && layouts[index] === layouts[index + 2]).toBe(false);
      expect(templates[index] === templates[index + 1] && templates[index] === templates[index + 2]).toBe(false);
    }

    const html = buildHtmlDeck(normalized, CONFIG, STYLE);
    expect(html).toContain('重复指标页 1');
    expect(html).toContain('chart-');
    expect(html).toContain('metric-board');
  });

  test('buildHtmlDeck normalizes incoming plans and emits structured element contracts', async ({ page }) => {
    const repeatedPlan: DeckPlan = {
      ...PLAN,
      slides: [
        { ...PLAN.slides[0], id: 'contract-cover', index: 1 },
        ...Array.from({ length: 5 }, (_, index) => ({
          ...PLAN.slides[1],
          id: `contract-metric-${index + 1}`,
          index: index + 2,
          title: `入口归一化指标页 ${index + 1}`,
          renderHints: ['chart=scorecard'],
          visualSpec: {
            type: 'scorecard' as const,
            metrics: [
              { label: '效率', value: `${20 + index}%`, detail: '样例口径' },
              { label: '成本', value: `${12 + index}%`, detail: '样例口径' },
              { label: '体验', value: `${80 + index}%`, detail: '样例口径' },
            ],
          },
        })),
      ],
    };
    const repeatedHtml = buildHtmlDeck(repeatedPlan, CONFIG, STYLE);
    const expectedLayouts = normalizePlanLayouts(repeatedPlan, CONFIG).slides.map((slide) => slide.layout);

    await page.setContent(repeatedHtml, { waitUntil: 'load' });
    const renderedLayouts = await page.locator('.slide').evaluateAll((nodes) => nodes.map((node) => {
      const layoutClass = Array.from(node.classList).find((className) => className.startsWith('slide-') && className !== 'slide');
      return layoutClass?.replace('slide-', '') || '';
    }));
    expect(renderedLayouts).toEqual(expectedLayouts);

    const contractPlan: DeckPlan = {
      ...PLAN,
      title: 'AIPPT Renderer Contract Smoke',
      slides: [
        { ...PLAN.slides[0], id: 'contract-cover-rich', index: 1 },
        {
          ...PLAN.slides[0],
          id: 'contract-section',
          index: 2,
          layout: 'section',
          title: '实施章节',
          headline: '从规划到交付形成稳定节奏',
          bullets: ['规划', '执行', '复盘'],
          visual: '章节转场',
        },
        {
          ...PLAN.slides[1],
          id: 'contract-metrics-styled',
          index: 3,
          design: {
            elements: {
              title: { visible: false, locked: true },
              headline: { fontSize: 31, color: '#22D3EE', fontWeight: 880, align: 'center', zIndex: 9, locked: true },
              visual: { fontSize: 18, color: '#F472B6', fontWeight: 780, align: 'right', zIndex: 12, locked: true },
            },
          },
        },
        { ...PLAN.slides[2], id: 'contract-compare', index: 4 },
        { ...PLAN.slides[3], id: 'contract-diagram', index: 5 },
        {
          ...PLAN.slides[1],
          id: 'contract-process',
          index: 6,
          layout: 'process',
          title: '交付流程',
          headline: '三步把需求推进为可验收交付',
          bullets: ['需求澄清', '方案编排', '质量验收'],
          visual: '流程节点',
          visualSpec: {
            type: 'process',
            rows: [
              { label: '需求', detail: '确认目标与素材' },
              { label: '编排', detail: '生成页面和结构' },
              { label: '验收', detail: '检查契约与溢出' },
            ],
          },
        },
        {
          ...PLAN.slides[1],
          id: 'contract-timeline',
          index: 7,
          layout: 'timeline',
          title: '实施路线',
          headline: '按阶段推进从试点到上线',
          bullets: ['第 1 周：试点', '第 2 周：扩展', '第 3 周：上线'],
          visual: '三阶段路线图',
          visualSpec: {
            type: 'timeline',
            rows: [
              { label: '第 1 周', detail: '试点' },
              { label: '第 2 周', detail: '扩展' },
              { label: '第 3 周', detail: '上线' },
            ],
          },
        },
        {
          ...PLAN.slides[1],
          id: 'contract-checklist',
          index: 8,
          layout: 'checklist',
          title: '上线检查清单',
          headline: '关键事项在发布前完成确认',
          bullets: ['数据来源确认', '契约节点确认', '导出质量确认'],
          visual: '行动清单',
          renderHints: ['chartTemplate=agenda_list'],
          visualSpec: {
            type: 'generic',
            title: '上线检查清单',
            rows: [
              { label: '数据', detail: '来源确认' },
              { label: '契约', detail: '节点确认' },
              { label: '导出', detail: '质量确认' },
            ],
          },
        },
        {
          ...PLAN.slides[0],
          id: 'contract-quote',
          index: 9,
          layout: 'quote',
          title: '最终判断',
          headline: '稳定元素契约让 Designer 和 Renderer 看见同一份 HTML',
          bullets: ['同源渲染', '可测试契约'],
          visual: '收束金句',
        },
      ],
    };
    const html = buildHtmlDeck(contractPlan, CONFIG, STYLE);
    expect(html).toContain('data-aippt-element="visual"');
    expect(html).toContain('data-aippt-locked="true"');
    expect(html).toContain('font-size:31px');
    expect(html).toContain('z-index:12');

    await page.setContent(html, { waitUntil: 'load' });
    await expect(page.locator('.slide-cover [data-aippt-element="title"]')).toHaveCount(1);
    await expect(page.locator('.slide-section [data-aippt-element="bullets"]')).toHaveCount(1);
    const styledMetricsSlide = page.locator('.slide-metrics').filter({ hasText: '用多序列趋势和指标卡说明增长质量' });
    await expect(styledMetricsSlide.locator('[data-aippt-element="title"]')).toHaveCount(0);
    await expect(styledMetricsSlide.locator('[data-aippt-element="headline"]')).toHaveCount(1);
    await expect(styledMetricsSlide.locator('[data-aippt-element="visual"]')).toHaveCount(1);
    await expect(page.locator('.slide-compare [data-aippt-element="visual"]')).toHaveCount(1);
    await expect(page.locator('.slide-diagram [data-aippt-element="visual"]')).toHaveCount(1);
    await expect(page.locator('.slide-process [data-aippt-element="bullets"]')).toHaveCount(1);
    await expect(page.locator('.slide-timeline [data-aippt-element="visual"]')).toHaveCount(1);
    await expect(page.locator('.slide-checklist [data-aippt-element="bullets"]')).toHaveCount(1);
    await expect(page.locator('.slide-quote [data-aippt-element="title"]')).toHaveCount(1);

    const metricsHeadline = styledMetricsSlide.locator('[data-aippt-element="headline"]');
    await expect(metricsHeadline).toHaveAttribute('data-aippt-locked', 'true');
    await expect(metricsHeadline).toHaveCSS('font-size', '31px');
    await expect(metricsHeadline).toHaveCSS('color', 'rgb(34, 211, 238)');
    await expect(metricsHeadline).toHaveCSS('font-weight', '880');
    await expect(metricsHeadline).toHaveCSS('text-align', 'center');
    await expect(metricsHeadline).toHaveCSS('z-index', '9');

    const metricsVisual = styledMetricsSlide.locator('[data-aippt-element="visual"]');
    await expect(metricsVisual).toHaveAttribute('data-aippt-locked', 'true');
    await expect(metricsVisual).toHaveCSS('color', 'rgb(244, 114, 182)');
    await expect(metricsVisual).toHaveCSS('font-size', '18px');
    await expect(metricsVisual).toHaveCSS('text-align', 'right');
    await expect(metricsVisual).toHaveCSS('z-index', '12');
  });

  test('builds schema-driven HTML with chart provenance and visual structures', async ({ page }) => {
    const html = buildHtmlDeck(PLAN, CONFIG, STYLE);
    expect(html).toContain('theme-tech_launch');
    expect(html).toContain('--deck-title-scale: 1.08');
    expect(html).toContain('Source: E2E renderer fixture');
    expect(html).toContain('口径: 月度经营样例');
    expect(html).toContain('估算数据');
    expect(html).toContain('能力对比矩阵');
    expect(html).toContain('AIPPT Agent 架构');

    await page.setViewportSize({ width: 1680, height: 945 });
    await page.setContent(html, { waitUntil: 'load' });
    await expect(page.locator('.deck')).toBeVisible();
    await expect(page.locator('.slide')).toHaveCount(4);
    await expect(page.locator('.slide-metrics')).toHaveCount(1);
    await expect(page.locator('.slide-compare')).toHaveCount(1);
    await expect(page.locator('.slide-diagram')).toHaveCount(1);

    const deckSnapshot = await page.locator('.deck').evaluate((deck) => {
      const style = getComputedStyle(deck);
      const slides = deck.querySelector('.slides')?.getBoundingClientRect();
      return {
        className: deck.className,
        bg: style.getPropertyValue('--deck-bg').trim(),
        primary: style.getPropertyValue('--deck-primary').trim(),
        titleScale: style.getPropertyValue('--deck-title-scale').trim(),
        chartStroke: style.getPropertyValue('--deck-chart-stroke').trim(),
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        width: window.innerWidth,
        height: window.innerHeight,
        slideRatio: slides ? slides.width / slides.height : 0,
      };
    });
    expect(deckSnapshot.className).toContain('theme-tech_launch');
    expect(deckSnapshot.bg).toBe('#070A12');
    expect(deckSnapshot.primary).toBe('#818CF8');
    expect(deckSnapshot.titleScale).toBe('1.08');
    expect(deckSnapshot.chartStroke).toBe('7');
    expect(deckSnapshot.scrollWidth).toBeLessThanOrEqual(deckSnapshot.width + 2);
    expect(deckSnapshot.scrollHeight).toBeLessThanOrEqual(deckSnapshot.height + 2);
    expect(Math.abs(deckSnapshot.slideRatio - (16 / 9))).toBeLessThan(0.08);

    const metrics = page.locator('.slide-metrics');
    await expect(metrics).toContainText('多序列趋势');
    await expect(metrics).toContainText('Pipeline：188万');
    await expect(metrics).toContainText('Source: E2E renderer fixture');
    await expect(metrics).toContainText('口径: 月度经营样例');
    await expect(metrics).toContainText('估算数据');

    const matrix = page.locator('.slide-compare');
    await expect(matrix.locator('.matrix-board article')).toHaveCount(3);
    await expect(matrix).toContainText('OpenAtlas');
    await expect(matrix).toContainText('通用 Agent 平台');
    await expect(matrix).toContainText('RPA工具');

    const architecture = page.locator('.slide-diagram');
    await expect(architecture.locator('.architecture-stack article')).toHaveCount(4);
    await expect(architecture).toContainText('感知');
    await expect(architecture).toContainText('规划');
    await expect(architecture).toContainText('渲染');
  });

  test('renders designer freeform element positions and image assets', async ({ page }) => {
    const plan: DeckPlan = JSON.parse(JSON.stringify(PLAN));
    plan.slides = [plan.slides[0]];
    plan.slides[0] = {
      ...plan.slides[0],
      design: {
        mode: 'freeform',
        elements: {
          title: { x: 12, y: 16, width: 58, height: 16, fontSize: 46, color: '#22D3EE', fontWeight: 950, align: 'left' },
          headline: { x: 12, y: 35, width: 60, height: 10, fontSize: 24, color: '#F8FAFC', fontWeight: 720, align: 'left' },
          bullets: { x: 12, y: 52, width: 42, height: 30, fontSize: 20, color: '#E2E8F0', fontWeight: 680, align: 'left' },
          visual: { x: 61, y: 44, width: 29, height: 34, radius: 18, visible: true },
        },
        media: [{
          id: 'media-cover',
          type: 'image',
          url: 'https://example.com/aippt-freeform-cover.png',
          alt: 'AIPPT freeform cover',
          fit: 'contain',
        }],
      },
    };

    const html = buildHtmlDeck(plan, CONFIG, STYLE);
    expect(html).toContain('freeform-stage');
    expect(html).toContain('https://example.com/aippt-freeform-cover.png');
    expect(html).toContain('left:12%');
    expect(html).toContain('font-size:46px');

    await page.setViewportSize({ width: 1680, height: 945 });
    await page.setContent(html, { waitUntil: 'load' });
    await expect(page.locator('.freeform-title')).toHaveCSS('color', 'rgb(34, 211, 238)');
    await expect(page.locator('.freeform-visual img')).toHaveAttribute('src', 'https://example.com/aippt-freeform-cover.png');
    const box = await page.locator('.freeform-title').boundingBox();
    const slideBox = await page.locator('.slides').boundingBox();
    expect(box && slideBox ? box.x - slideBox.x : 0).toBeGreaterThan(90);
  });

  test('renders the built-in investor demo fixture through shared styles', async ({ page }) => {
    const { config, plan } = buildOpenAtlasInvestorDemo();
    const normalizedPlan = normalizePlanLayouts(plan, config);
    const layoutCounts = normalizedPlan.slides.reduce<Record<string, number>>((acc, slide) => {
      acc[slide.layout] = (acc[slide.layout] || 0) + 1;
      return acc;
    }, {});
    expect(OPENATLAS_INVESTOR_DEMO_PROMPT).toContain('OpenAtlas 数智员工融资汇报');
    expect(config.styleKey).toBe('tech_launch');
    expect(plan.slides).toHaveLength(12);
    expect(plan.slides.filter((slide) => slide.layout === 'metrics').length).toBeGreaterThanOrEqual(5);

    const html = buildHtmlDeck(plan, config, selectedStyle(config));
    expect(html).toContain('theme-tech_launch');
    expect(html).toContain('OpenAtlas 数智员工融资汇报｜富图表样例');
    expect(html).toContain('增长模型');
    expect(html).toContain('能力差异矩阵');

    await page.setViewportSize({ width: 1680, height: 945 });
    await page.setContent(html, { waitUntil: 'load' });
    await expect(page.locator('.slide')).toHaveCount(12);
    await expect(page.locator('.slide-cover')).toHaveCount(layoutCounts.cover || 0);
    await expect(page.locator('.slide-metrics')).toHaveCount(layoutCounts.metrics || 0);
    await expect(page.locator('.slide-compare')).toHaveCount(layoutCounts.compare || 0);
    await expect(page.locator('.slide-diagram')).toHaveCount(layoutCounts.diagram || 0);
    await expect(page.locator('.slide-timeline')).toHaveCount(layoutCounts.timeline || 0);
    await expect(page.locator('body')).toContainText('OpenAtlas 数智员工融资汇报｜富图表样例');
    await expect(page.locator('body')).toContainText('试点转生产');
    await expect(page.locator('body')).toContainText('融资用途');

    const snapshot = await page.locator('.deck').evaluate((deck) => {
      const style = getComputedStyle(deck);
      return {
        bg: style.getPropertyValue('--deck-bg').trim(),
        primary: style.getPropertyValue('--deck-primary').trim(),
        radius: style.getPropertyValue('--deck-radius').trim(),
      };
    });
    expect(snapshot).toEqual({
      bg: '#070A12',
      primary: '#818CF8',
      radius: '14px',
    });
  });

  test('renders the neutral operations demo without OpenAtlas-specific content', async ({ page }) => {
    const { config, plan } = buildGenericOperationsDemo();
    const normalizedPlan = normalizePlanLayouts(plan, config);
    const layoutCounts = normalizedPlan.slides.reduce<Record<string, number>>((acc, slide) => {
      acc[slide.layout] = (acc[slide.layout] || 0) + 1;
      return acc;
    }, {});
    expect(GENERIC_OPERATIONS_DEMO_PROMPT).toContain('企业知识库运营升级汇报');
    expect(config.styleKey).toBe('executive_blue');
    expect(plan.slides).toHaveLength(8);
    expect(plan.title).not.toContain('OpenAtlas');

    const html = buildHtmlDeck(plan, config, selectedStyle(config));
    expect(html).toContain('theme-executive_blue');
    expect(html).toContain('企业知识库运营升级汇报｜中性样例');
    expect(html).toContain('Source: 中性演示口径，基于访谈样例估算。');
    expect(html).not.toContain('OpenAtlas 数智员工融资汇报');

    await page.setViewportSize({ width: 1680, height: 945 });
    await page.setContent(html, { waitUntil: 'load' });
    await expect(page.locator('.slide')).toHaveCount(8);
    await expect(page.locator('.slide-cover')).toHaveCount(layoutCounts.cover || 0);
    await expect(page.locator('.slide-metrics')).toHaveCount(layoutCounts.metrics || 0);
    await expect(page.locator('.slide-compare')).toHaveCount(layoutCounts.compare || 0);
    await expect(page.locator('.slide-diagram')).toHaveCount(layoutCounts.diagram || 0);
    await expect(page.locator('.slide-timeline')).toHaveCount(layoutCounts.timeline || 0);
    await expect(page.locator('.slide-checklist')).toHaveCount(layoutCounts.checklist || 0);
    await expect(page.locator('body')).toContainText('知识运营四层架构');
    await expect(page.locator('body')).toContainText('方案能力矩阵');
    await expect(page.locator('body')).toContainText('12 周实施路线');

    const snapshot = await page.locator('.deck').evaluate((deck) => {
      const style = getComputedStyle(deck);
      return {
        bg: style.getPropertyValue('--deck-bg').trim(),
        primary: style.getPropertyValue('--deck-primary').trim(),
        radius: style.getPropertyValue('--deck-radius').trim(),
      };
    });
    expect(snapshot).toEqual({
      bg: '#F6F8FC',
      primary: '#1D4ED8',
      radius: '8px',
    });
  });
});
