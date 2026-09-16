import {
  USE_CASE_LABEL,
  chartKindFromSlide,
  deckHintText,
  hintValueFromHints,
  inferArchitectureLayers,
  inferMatrixColumns,
  inferSlideLayout,
  metricDataFromBullets,
  metricDataFromVisualSpec,
  normalizePlanLayouts,
  scheduledLayoutForSlide,
  splitSpecItems,
  templateDefinitionForId,
  templateIdForSlide,
  visualSpecOfSlide,
  type DeckConfig,
  type DeckPlan,
  type DeckSlide,
  type DeckStyleKey,
  type MetricDatum,
  type SlideDesignCustomElement,
  type SlideDesignElementKey,
  type SlideDesignElementStyle,
  type SlideVisualSpec,
  type VisualSpecItem,
} from './schema';

export interface DeckRenderStyle {
  key: DeckStyleKey;
  name: string;
  tokens: {
    background: string;
    surface: string;
    surfaceAlt: string;
    primary: string;
    accent: string;
    accentSoft: string;
    text: string;
    muted: string;
    border: string;
    radius: number;
    shadow: string;
    chartPalette: string[];
    canvasPattern: string;
    coverLayout: string;
    contentLayout: string;
  };
}

export interface DeckRenderOptions {
  initialSlide?: number;
}

const STYLE_RENDER_TUNING: Record<DeckStyleKey, {
  titleScale: number;
  bodyScale: number;
  slidePadY: number;
  slidePadX: number;
  gap: number;
  chartStroke: number;
  cardWeight: number;
}> = {
  executive_blue: {
    titleScale: 0.95,
    bodyScale: 0.98,
    slidePadY: 60,
    slidePadX: 78,
    gap: 21,
    chartStroke: 5.5,
    cardWeight: 1,
  },
  tech_launch: {
    titleScale: 1.08,
    bodyScale: 1,
    slidePadY: 64,
    slidePadX: 76,
    gap: 24,
    chartStroke: 7,
    cardWeight: 1.16,
  },
  teaching_clear: {
    titleScale: 0.9,
    bodyScale: 1.06,
    slidePadY: 56,
    slidePadX: 70,
    gap: 24,
    chartStroke: 5,
    cardWeight: 0.92,
  },
};

interface ChartSeriesDatum {
  name: string;
  values: number[];
  unit: string;
}

interface ChartSeriesData {
  labels: string[];
  series: ChartSeriesDatum[];
  source?: string;
  methodology?: string;
  estimated?: boolean;
}

type SlideRhythm = 'anchor' | 'dense' | 'breathing';

function escapeHtml(value: string | number | null | undefined) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function clampPercent(value: number | undefined, fallback: number, min = 0, max = 100) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function classToken(value: string | null | undefined, fallback = 'none') {
  const safe = String(value || fallback).trim().replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '');
  return safe || fallback;
}

function rhythmFromSlide(slide: DeckSlide): SlideRhythm {
  const value = hintValueFromHints(slide, ['rhythm', '节奏']).toLowerCase();
  if (value.includes('anchor')) return 'anchor';
  if (value.includes('breathing')) return 'breathing';
  if (value.includes('dense')) return 'dense';
  if (slide.index <= 1 || ['cover', 'section', 'quote'].includes(slide.layout)) return 'anchor';
  if (['metrics', 'compare'].includes(slide.layout)) return 'dense';
  return 'breathing';
}

function chartTemplateFromSlide(slide: DeckSlide) {
  const templateId = templateIdForSlide(slide);
  const template = templateDefinitionForId(templateId);
  if (!template) return '';
  if (template.visualSlot === 'none' && !['cover', 'section', 'quote'].includes(template.id)) return '';
  return classToken(template.id, '');
}

function freeformElementStyle(style: SlideDesignElementStyle | undefined, fallback: Required<Pick<SlideDesignElementStyle, 'x' | 'y' | 'width' | 'height' | 'fontSize' | 'color' | 'fontWeight' | 'align'>>) {
  const x = clampPercent(style?.x, fallback.x, -20, 120);
  const y = clampPercent(style?.y, fallback.y, -20, 120);
  const width = clampPercent(style?.width, fallback.width, 4, 120);
  const height = clampPercent(style?.height, fallback.height, 3, 120);
  const fontSize = Math.max(8, Math.min(96, Number(style?.fontSize ?? fallback.fontSize)));
  const fontWeight = Math.max(300, Math.min(1000, Number(style?.fontWeight ?? fallback.fontWeight)));
  const color = style?.color || fallback.color;
  const align = style?.align || fallback.align;
  const background = style?.background ? `background:${escapeHtml(style.background)};` : '';
  const radius = Number.isFinite(Number(style?.radius)) ? `border-radius:${Math.max(0, Math.min(40, Number(style?.radius)))}px;` : '';
  return [
    `left:${x}%`,
    `top:${y}%`,
    `width:${width}%`,
    `height:${height}%`,
    `font-size:${fontSize}px`,
    `font-weight:${fontWeight}`,
    `color:${escapeHtml(color)}`,
    `text-align:${align}`,
    background,
    radius,
  ].filter(Boolean).join(';');
}

function safeCssColor(value: unknown) {
  const color = String(value || '').trim();
  if (!color) return '';
  if (/^#[0-9a-f]{3,8}$/i.test(color)) return color;
  if (/^var\(--[\w-]+\)$/i.test(color)) return color;
  if (/^(?:rgb|rgba|hsl|hsla)\([0-9\s.,%+-]+\)$/i.test(color)) return color;
  if (/^[a-zA-Z]+$/.test(color)) return color;
  return '';
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function structuredElementConfig(slide: DeckSlide, key: SlideDesignElementKey) {
  return slide.design?.elements?.[key];
}

function isStructuredElementVisible(slide: DeckSlide, key: SlideDesignElementKey) {
  return structuredElementConfig(slide, key)?.visible !== false;
}

function structuredElementStyle(slide: DeckSlide, key: SlideDesignElementKey) {
  const element = structuredElementConfig(slide, key);
  if (!element) return '';
  const declarations: string[] = [];
  if (Number.isFinite(Number(element.fontSize))) {
    declarations.push(`font-size:${clampNumber(element.fontSize, 16, 8, 96)}px`);
  }
  const color = safeCssColor(element.color);
  if (color) declarations.push(`color:${escapeHtml(color)}`);
  if (Number.isFinite(Number(element.fontWeight))) {
    declarations.push(`font-weight:${clampNumber(element.fontWeight, 650, 300, 1000)}`);
  }
  if (['left', 'center', 'right'].includes(String(element.align || ''))) {
    declarations.push(`text-align:${element.align}`);
  }
  if (Number.isFinite(Number(element.zIndex))) {
    declarations.push('position:relative');
    declarations.push(`z-index:${Math.round(clampNumber(element.zIndex, 1, -10, 200))}`);
  }
  return declarations.join(';');
}

function structuredElementAttrs(slide: DeckSlide, key: SlideDesignElementKey, baseStyle = '') {
  const element = structuredElementConfig(slide, key);
  const style = [baseStyle.replace(/;+$/g, ''), structuredElementStyle(slide, key)]
    .map((item) => item.trim())
    .filter(Boolean)
    .join(';');
  return [
    `data-aippt-element="${key}"`,
    `data-aippt-locked="${element?.locked === true ? 'true' : 'false'}"`,
    style ? `style="${style}"` : '',
  ].filter(Boolean).join(' ');
}

function renderFreeformCustomElement(element: SlideDesignCustomElement) {
  if (element.visible === false) return '';
  const fallback = {
    x: element.type === 'metric' ? 64 : 58,
    y: element.type === 'metric' ? 58 : 50,
    width: element.type === 'text' ? 28 : 24,
    height: element.type === 'text' ? 12 : 18,
    fontSize: element.type === 'metric' ? 28 : 18,
    color: 'var(--deck-text)',
    fontWeight: element.type === 'metric' ? 900 : 720,
    align: 'left' as const,
  };
  const style = `${freeformElementStyle(element, fallback)};z-index:${Number(element.zIndex ?? 80)}`;
  const label = escapeHtml(element.label || element.content || element.alt || '自定义组件');
  if (element.type === 'image') {
    return `
      <div class="freeform-element freeform-custom freeform-custom-image" style="${style}">
        ${element.url
          ? `<img src="${escapeHtml(element.url)}" alt="${escapeHtml(element.alt || label)}" style="object-fit:${element.fit === 'contain' ? 'contain' : 'cover'};" />`
          : `<span>Image</span><strong>${label}</strong>`}
      </div>
    `;
  }
  if (element.type === 'shape') {
    return `<div class="freeform-element freeform-custom freeform-custom-shape freeform-custom-shape-${escapeHtml(element.shape || 'rectangle')}" style="${style}"></div>`;
  }
  if (element.type === 'metric') {
    return `
      <div class="freeform-element freeform-custom freeform-custom-metric" style="${style}">
        <strong>${escapeHtml(String(element.value ?? '128%'))}${escapeHtml(element.unit || '')}</strong>
        <span>${escapeHtml(element.label || '核心指标')}</span>
      </div>
    `;
  }
  return `<div class="freeform-element freeform-custom freeform-custom-text" style="${style}">${escapeHtml(element.content || '双击在右侧编辑文本')}</div>`;
}

const FREEFORM_DEFAULTS: Record<SlideDesignElementKey, Required<Pick<SlideDesignElementStyle, 'x' | 'y' | 'width' | 'height' | 'fontSize' | 'color' | 'fontWeight' | 'align'>>> = {
  eyebrow: { x: 8, y: 8, width: 42, height: 6, fontSize: 15, color: 'var(--deck-primary)', fontWeight: 850, align: 'left' },
  title: { x: 8, y: 18, width: 62, height: 16, fontSize: 52, color: 'var(--deck-text)', fontWeight: 950, align: 'left' },
  headline: { x: 8, y: 38, width: 68, height: 10, fontSize: 26, color: 'var(--deck-muted)', fontWeight: 720, align: 'left' },
  bullets: { x: 8, y: 55, width: 46, height: 30, fontSize: 21, color: 'var(--deck-text)', fontWeight: 680, align: 'left' },
  visual: { x: 60, y: 48, width: 32, height: 34, fontSize: 20, color: 'var(--deck-text)', fontWeight: 780, align: 'left' },
};

function chartSeriesFromVisualSpec(spec: SlideVisualSpec): ChartSeriesData | null {
  const chart = spec.chart;
  const series = (chart?.series || [])
    .map((item, index) => ({
      name: item.name || `序列 ${index + 1}`,
      values: (item.values || []).filter((value) => Number.isFinite(value)).slice(0, 8),
      unit: item.unit || chart?.unit || '',
    }))
    .filter((item) => item.values.length);
  if (!series.length) return null;
  const maxPoints = Math.max(...series.map((item) => item.values.length));
  return {
    labels: Array.from({ length: maxPoints }, (_, index) => chart?.labels?.[index] || `阶段 ${index + 1}`),
    series,
    source: chart?.source,
    methodology: chart?.methodology,
    estimated: chart?.estimated,
  };
}

function chartSourceText(data?: Pick<ChartSeriesData, 'source' | 'methodology' | 'estimated'> | null) {
  if (!data) return '';
  return [
    data.source ? `Source: ${data.source}` : '',
    data.methodology ? `口径: ${data.methodology}` : '',
    data.estimated ? '估算数据' : '',
  ].filter(Boolean).join(' · ');
}

function renderChartLegend(series: ChartSeriesDatum[]) {
  if (series.length <= 1) return '';
  return `
    <div class="chart-legend">
      ${series.slice(0, 4).map((item, index) => `
        <span><i style="--legend-color: var(--deck-chart-${(index % 4) + 1});"></i>${escapeHtml(item.name)}</span>
      `).join('')}
    </div>
  `;
}

function renderMetricCards(rows: MetricDatum[], compact = false, variant = '', attrs = '') {
  return `
    <div class="metric-board ${compact ? 'metric-board--compact' : ''} ${escapeHtml(variant)}" ${attrs}>
      ${rows.slice(0, compact ? 3 : 5).map((row, index) => `
        <article style="--metric-color: var(--deck-chart-${(index % 4) + 1});">
          <b>${escapeHtml(row.display)}</b>
          <strong>${escapeHtml(row.label)}</strong>
          <span>${row.value === null ? '待补真实数据' : escapeHtml(row.detail)}</span>
        </article>
      `).join('')}
    </div>
  `;
}

function renderHorizontalBarChart(rows: MetricDatum[], provenance?: Pick<ChartSeriesData, 'source' | 'methodology' | 'estimated'> | null) {
  const numericRows = rows.filter((row) => row.value !== null).slice(0, 7) as Array<MetricDatum & { value: number }>;
  if (!numericRows.length) return renderBarChart(rows, provenance);
  const maxValue = Math.max(...numericRows.map((row) => Math.abs(row.value)), 1);
  return `
    <div class="chart-card chart-card--horizontal">
      <div class="chart-title"><span>Horizontal Bar</span><strong>排名与占比</strong></div>
      <div class="horizontal-bar-chart">
        ${numericRows.map((row, index) => {
          const width = Math.max(10, Math.round((Math.abs(row.value) / maxValue) * 100));
          return `
            <div class="horizontal-bar-item" style="--bar-width:${width}%; --bar-color: var(--deck-chart-${(index % 4) + 1});">
              <span>${escapeHtml(row.label)}</span>
              <i></i>
              <b>${escapeHtml(row.display)}</b>
            </div>
          `;
        }).join('')}
      </div>
      ${chartSourceText(provenance) ? `<p class="chart-source">${escapeHtml(chartSourceText(provenance))}</p>` : ''}
    </div>
  `;
}

function renderBarChart(rows: MetricDatum[], provenance?: Pick<ChartSeriesData, 'source' | 'methodology' | 'estimated'> | null) {
  const numericRows = rows.filter((row) => row.value !== null) as Array<MetricDatum & { value: number }>;
  if (!numericRows.length) {
    return `
      <div class="chart-card chart-card--pending">
        <span>Bar Chart</span>
        <strong>柱状图数据待补充</strong>
        <p>当前页面已有指标口径，但缺少可引用数值。可通过联网补充或人工录入后重新生成。</p>
      </div>
    `;
  }
  const maxValue = Math.max(...numericRows.map((row) => Math.abs(row.value)), 1);
  return `
    <div class="chart-card chart-card--bar">
      <div class="chart-title"><span>Bar Chart</span><strong>指标对比</strong></div>
      <div class="bar-chart">
        ${numericRows.slice(0, 5).map((row, index) => {
          const height = Math.max(12, Math.round((Math.abs(row.value) / maxValue) * 100));
          return `
            <div class="bar-item">
              <i style="--bar-height:${height}%; --bar-color: var(--deck-chart-${(index % 4) + 1});"></i>
              <b>${escapeHtml(row.display)}</b>
              <span>${escapeHtml(row.label)}</span>
            </div>
          `;
        }).join('')}
      </div>
      ${chartSourceText(provenance) ? `<p class="chart-source">${escapeHtml(chartSourceText(provenance))}</p>` : ''}
    </div>
  `;
}

function renderGroupedBarChart(data: ChartSeriesData) {
  const numericValues = data.series.flatMap((series) => series.values);
  if (!numericValues.length) return renderBarChart([]);
  const maxValue = Math.max(...numericValues.map((value) => Math.abs(value)), 1);
  const pointCount = Math.min(6, data.labels.length);
  return `
    <div class="chart-card chart-card--bar chart-card--multi">
      <div class="chart-title"><span>Grouped Bar</span><strong>多序列对比</strong></div>
      ${renderChartLegend(data.series)}
      <div class="grouped-bar-chart" style="--group-count:${pointCount}; --series-count:${Math.min(4, data.series.length)};">
        ${data.labels.slice(0, pointCount).map((label, labelIndex) => `
          <div class="bar-group">
            <div class="bar-group__bars">
              ${data.series.slice(0, 4).map((series, seriesIndex) => {
                const value = series.values[labelIndex] ?? 0;
                const height = Math.max(8, Math.round((Math.abs(value) / maxValue) * 100));
                return `<i title="${escapeHtml(series.name)} ${escapeHtml(value)}${escapeHtml(series.unit)}" style="--bar-height:${height}%; --bar-color: var(--deck-chart-${(seriesIndex % 4) + 1});"></i>`;
              }).join('')}
            </div>
            <b>${escapeHtml(label)}</b>
          </div>
        `).join('')}
      </div>
      ${chartSourceText(data) ? `<p class="chart-source">${escapeHtml(chartSourceText(data))}</p>` : ''}
    </div>
  `;
}

function renderLineChart(rows: MetricDatum[], provenance?: Pick<ChartSeriesData, 'source' | 'methodology' | 'estimated'> | null) {
  const numericRows = rows.filter((row) => row.value !== null).slice(0, 6) as Array<MetricDatum & { value: number }>;
  if (numericRows.length < 2) return renderLineChartPlaceholder('趋势数据待补充');
  const values = numericRows.map((row) => row.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = numericRows.map((row, index) => {
    const x = 32 + (index * (336 / Math.max(1, numericRows.length - 1)));
    const y = 178 - ((row.value - min) / range) * 122;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return `
    <div class="chart-card chart-card--line">
      <div class="chart-title"><span>Line Chart</span><strong>趋势变化</strong></div>
      <svg viewBox="0 0 400 220" role="img" aria-label="趋势折线图">
        <path d="M 32 178 L 368 178" class="axis" />
        <polyline points="${points.join(' ')}" class="line-path" />
        ${numericRows.map((row, index) => {
          const [x, y] = points[index].split(',');
          return `<g><circle cx="${x}" cy="${y}" r="6" /><text x="${x}" y="204">${escapeHtml(row.label)}</text></g>`;
        }).join('')}
      </svg>
      <div class="line-values">${numericRows.map((row) => `<span>${escapeHtml(row.display)}</span>`).join('')}</div>
      ${chartSourceText(provenance) ? `<p class="chart-source">${escapeHtml(chartSourceText(provenance))}</p>` : ''}
    </div>
  `;
}

function renderMultiLineChart(data: ChartSeriesData) {
  const series = data.series.filter((item) => item.values.length >= 2).slice(0, 4);
  if (!series.length) return renderLineChartPlaceholder('趋势数据待补充');
  if (series.length === 1) {
    return renderLineChart(series[0].values.map((value, index) => ({
      label: data.labels[index] || `阶段 ${index + 1}`,
      value,
      display: `${value}${series[0].unit}`,
      unit: series[0].unit,
      detail: series[0].name,
    })), data);
  }
  const allValues = series.flatMap((item) => item.values);
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const range = max - min || 1;
  const maxPoints = Math.min(8, Math.max(...series.map((item) => item.values.length)));
  const xFor = (index: number) => 32 + (index * (336 / Math.max(1, maxPoints - 1)));
  const yFor = (value: number) => 178 - ((value - min) / range) * 122;
  return `
    <div class="chart-card chart-card--line chart-card--multi">
      <div class="chart-title"><span>Multi Line</span><strong>多序列趋势</strong></div>
      ${renderChartLegend(series)}
      <svg viewBox="0 0 400 220" role="img" aria-label="多序列趋势折线图">
        <path d="M 32 178 L 368 178" class="axis" />
        ${series.map((item, seriesIndex) => {
          const points = item.values.slice(0, maxPoints).map((value, index) => `${xFor(index).toFixed(1)},${yFor(value).toFixed(1)}`).join(' ');
          return `
            <polyline class="line-path line-path--series" style="--line-color: var(--deck-chart-${(seriesIndex % 4) + 1});" points="${points}" />
            ${item.values.slice(0, maxPoints).map((value, index) => `<circle class="line-dot" style="--line-color: var(--deck-chart-${(seriesIndex % 4) + 1});" cx="${xFor(index).toFixed(1)}" cy="${yFor(value).toFixed(1)}" r="4" />`).join('')}
          `;
        }).join('')}
        ${data.labels.slice(0, maxPoints).map((label, index) => `<text x="${xFor(index).toFixed(1)}" y="204">${escapeHtml(label)}</text>`).join('')}
      </svg>
      <div class="line-values line-values--series">
        ${series.map((item) => `<span>${escapeHtml(item.name)}：${escapeHtml(item.values[item.values.length - 1])}${escapeHtml(item.unit)}</span>`).join('')}
      </div>
      ${chartSourceText(data) ? `<p class="chart-source">${escapeHtml(chartSourceText(data))}</p>` : ''}
    </div>
  `;
}

function renderLineChartPlaceholder(title = '趋势图待补充') {
  return `
    <div class="chart-card chart-card--pending chart-card--line-pending">
      <span>Line Chart</span>
      <strong>${escapeHtml(title)}</strong>
      <p>当前已识别为趋势页，但缺少连续时间点数据。补充时间序列后会渲染真实折线。</p>
    </div>
  `;
}

function renderDataVisual(slide: DeckSlide, rawItems: string[]) {
  if (!isStructuredElementVisible(slide, 'visual')) return '';
  const spec = visualSpecOfSlide(slide);
  const chartKind = chartKindFromSlide(slide);
  const chartTemplate = chartTemplateFromSlide(slide);
  const seriesData = chartSeriesFromVisualSpec(spec);
  const specRows = metricDataFromVisualSpec(spec);
  const rows = specRows.length ? specRows : metricDataFromBullets(rawItems);
  const visualAttrs = structuredElementAttrs(slide, 'visual');
  if (spec.type === 'combo_metrics') {
    const lineRows = spec.chart?.series?.[0]?.values?.length ? metricDataFromVisualSpec({ chart: spec.chart }) : [];
    return `
      <div class="combo-metrics" ${visualAttrs}>
        ${seriesData && seriesData.series.length > 1 ? renderMultiLineChart(seriesData) : lineRows.length >= 2 ? renderLineChart(lineRows, seriesData) : renderLineChartPlaceholder(spec.title || '趋势数据待补充')}
        ${renderMetricCards(rows, true)}
      </div>
    `;
  }
  if (chartTemplate === 'horizontal_bar_chart') {
    return `
      <div class="data-layout data-layout--horizontal" ${visualAttrs}>
        ${renderHorizontalBarChart(rows, seriesData)}
        ${renderMetricCards(rows, true)}
      </div>
    `;
  }
  if (chartTemplate === 'grouped_bar_chart' && seriesData && seriesData.series.length > 1) {
    return `
      <div class="data-layout data-layout--bar" ${visualAttrs}>
        ${renderGroupedBarChart(seriesData)}
        ${renderMetricCards(rows, true)}
      </div>
    `;
  }
  if (chartTemplate === 'line_chart' && (seriesData || rows.length >= 2)) {
    return `
      <div class="data-layout data-layout--line" ${visualAttrs}>
        ${seriesData && seriesData.series.length > 1 ? renderMultiLineChart(seriesData) : renderLineChart(rows, seriesData)}
        ${renderMetricCards(rows, true)}
      </div>
    `;
  }
  if (chartKind === 'bar') {
    return `
      <div class="data-layout data-layout--bar" ${visualAttrs}>
        ${seriesData && seriesData.series.length > 1 ? renderGroupedBarChart(seriesData) : renderBarChart(rows, seriesData)}
        ${renderMetricCards(rows, true)}
      </div>
    `;
  }
  if (chartKind === 'line') {
    return `
      <div class="data-layout data-layout--line" ${visualAttrs}>
        ${seriesData && seriesData.series.length > 1 ? renderMultiLineChart(seriesData) : renderLineChart(rows, seriesData)}
        ${renderMetricCards(rows, true)}
      </div>
    `;
  }
  return renderMetricCards(rows, false, chartTemplate === 'bullet_chart' ? 'metric-board--bullets' : 'metric-board--dashboard', visualAttrs);
}

function matrixScoreClass(item: string, score: VisualSpecItem['score']) {
  if (typeof score === 'number') {
    if (score >= 3) return 'is-high';
    if (score <= 1) return 'is-low';
    return 'is-medium';
  }
  if (score === 'high' || /全满|完整|强|高|企业级|可审计|协同|闭环|多Agent/u.test(item)) return 'is-high';
  if (score === 'low' || /无|弱|低|单任务|日志级|缺/u.test(item)) return 'is-low';
  return 'is-medium';
}

function slideEvidenceText(slide: DeckSlide, plan: DeckPlan) {
  const knowledgeIds = Array.isArray(slide.knowledgeIds) ? slide.knowledgeIds : [];
  const knowledge = Array.isArray(plan.knowledge) ? plan.knowledge : [];
  const linked = knowledgeIds
    .map((id) => knowledge.find((item) => item.id === id))
    .find(Boolean);
  return slide.evidenceRole || linked?.detail || linked?.title || '建议在确认大纲后补充可引用资料。';
}

function renderSlideHeader(slide: DeckSlide, plan: DeckPlan) {
  const sections = Array.isArray(plan.sections) ? plan.sections : [];
  const sectionTitle = escapeHtml(sections.find((s) => s.id === slide.sectionId)?.title || '');
  return `
    <header class="slide-header">
      <div>
        ${isStructuredElementVisible(slide, 'eyebrow') ? `<div class="slide-eyebrow" ${structuredElementAttrs(slide, 'eyebrow')}>${sectionTitle}</div>` : ''}
        ${isStructuredElementVisible(slide, 'title') ? `<h1 ${structuredElementAttrs(slide, 'title')}>${escapeHtml(slide.title)}</h1>` : ''}
        ${isStructuredElementVisible(slide, 'headline') ? `<h2 ${structuredElementAttrs(slide, 'headline')}>${escapeHtml(slide.headline)}</h2>` : ''}
      </div>
      <div class="slide-index">${String(slide.index).padStart(2, '0')}</div>
    </header>
  `;
}

function renderMatrixVisual(slide: DeckSlide, plan: DeckPlan) {
  const spec = visualSpecOfSlide(slide);
  const fallbackColumns: VisualSpecItem[] = slide.bullets.slice(0, 4).map((item, index) => {
    const [label, ...rest] = item.split(/[：:]/u);
    const detail = rest.join('：') || item;
    return {
      label: (label || `对象 ${index + 1}`).slice(0, 18),
      detail,
      items: splitSpecItems(detail).length ? splitSpecItems(detail) : [detail],
    };
  });
  const columns = (spec.columns?.length ? spec.columns : inferMatrixColumns(slide).length ? inferMatrixColumns(slide) : fallbackColumns).slice(0, 4);
  const title = spec.title || slide.visual || '对比矩阵';
  return `
    ${renderSlideHeader(slide, plan)}
    ${isStructuredElementVisible(slide, 'visual') ? `<div class="matrix-stage" ${structuredElementAttrs(slide, 'visual')}>
      <div class="matrix-title">
        <span>Matrix</span>
        <strong>${escapeHtml(title)}</strong>
        ${spec.description ? `<p>${escapeHtml(spec.description)}</p>` : ''}
      </div>
      <div class="matrix-board" style="--matrix-cols:${Math.max(2, columns.length)}">
        ${columns.map((column, index) => {
          const items = (column.items?.length ? column.items : splitSpecItems(column.detail || '')).slice(0, 5);
          return `
            <article>
              <b>${String(index + 1).padStart(2, '0')}</b>
              <strong>${escapeHtml(column.label || column.title || `对象 ${index + 1}`)}</strong>
              <div>
                ${(items.length ? items : [column.detail || '待补充']).map((item) => `
                  <span class="${matrixScoreClass(item, column.score)}">${escapeHtml(item)}</span>
                `).join('')}
              </div>
            </article>
          `;
        }).join('')}
      </div>
    </div>` : ''}
  `;
}

function renderArchitectureVisual(slide: DeckSlide, plan: DeckPlan) {
  const spec = visualSpecOfSlide(slide);
  const layers = (spec.layers?.length ? spec.layers : inferArchitectureLayers(slide)).slice(0, 6);
  return `
    ${renderSlideHeader(slide, plan)}
    ${isStructuredElementVisible(slide, 'visual') ? `<div class="architecture-stage" ${structuredElementAttrs(slide, 'visual')}>
      <div class="architecture-stack">
        ${layers.map((layer, index) => `
          <article>
            <b>${String(index + 1).padStart(2, '0')}</b>
            <div>
              <strong>${escapeHtml(layer.label || layer.title || `层级 ${index + 1}`)}</strong>
              <p>${escapeHtml(layer.detail || layer.items?.join(' / ') || '')}</p>
            </div>
          </article>
        `).join('')}
      </div>
      <aside class="architecture-note">
        <span>Architecture</span>
        <strong>${escapeHtml(spec.title || slide.visual || '分层架构')}</strong>
        <p>${escapeHtml(slide.designIntent || slideEvidenceText(slide, plan))}</p>
        ${(spec.callouts || []).map((item) => `<em>${escapeHtml(item)}</em>`).join('')}
      </aside>
    </div>` : ''}
  `;
}

function compareLabelsFromHints(slide: DeckSlide) {
  const text = deckHintText(slide);
  const left = hintValueFromHints(slide, ['leftLabel', '左列', '左侧'])
    || text.match(/左(?:列|侧)?(?:命名为|为|：|:)\s*([^；;，,。]+)/)?.[1]?.trim();
  const right = hintValueFromHints(slide, ['rightLabel', '右列', '右侧'])
    || text.match(/右(?:列|侧)?(?:命名为|为|：|:)\s*([^；;，,。]+)/)?.[1]?.trim();
  return {
    left: left || '现状 / 问题',
    right: right || '方案 / 增量',
  };
}

function splitBulletsForColumns(items: string[], fallback: string) {
  const midpoint = Math.max(1, Math.ceil(items.length / 2));
  const left = items.slice(0, midpoint);
  const right = items.slice(midpoint);
  return {
    left,
    right: right.length ? right : [fallback],
  };
}

function renderBulletList(items: string[], className = 'insight-list', slide?: DeckSlide) {
  if (slide && !isStructuredElementVisible(slide, 'bullets')) return '';
  const attrs = slide ? structuredElementAttrs(slide, 'bullets') : '';
  return `<ul class="${className}" ${attrs}>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function renderVisualPanel(slide: DeckSlide, plan: DeckPlan, label = '设计表达', includeContractAttrs = true) {
  if (!isStructuredElementVisible(slide, 'visual')) return '';
  return `
    <aside class="visual-panel" ${includeContractAttrs ? structuredElementAttrs(slide, 'visual') : ''}>
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(slide.visual || slide.title)}</strong>
      <p>${escapeHtml(slideEvidenceText(slide, plan))}</p>
    </aside>
  `;
}

function structuredRowsFromSlide(slide: DeckSlide) {
  if (slide.layout !== 'process' && slide.layout !== 'timeline' && slide.layout !== 'checklist') return [];
  const spec = visualSpecOfSlide(slide);
  return (spec.rows || [])
    .map((row, index) => {
      const label = row.label || row.title || (slide.layout === 'timeline' ? `阶段 ${index + 1}` : `节点 ${index + 1}`);
      const detail = row.detail || row.items?.join('、') || String(row.value ?? '');
      return detail ? `${label}：${detail}` : label;
    })
    .filter(Boolean)
    .slice(0, 8);
}

function renderFreeformSlideHtml(slide: DeckSlide, plan: DeckPlan, config: DeckConfig, style: DeckRenderStyle) {
  const sections = Array.isArray(plan.sections) ? plan.sections : [];
  const sectionTitle = sections.find((s) => s.id === slide.sectionId)?.title || USE_CASE_LABEL[config.useCase] || '演示';
  const design = slide.design || {};
  const elements = design.elements || {};
  const media = design.media?.[0];
  const customElements = Array.isArray(design.customElements)
    ? [...design.customElements].sort((a, b) => Number(a.zIndex || 0) - Number(b.zIndex || 0))
    : [];
  const isVisible = (key: SlideDesignElementKey) => elements[key]?.visible !== false;
  const elementStyle = (key: SlideDesignElementKey) => freeformElementStyle(elements[key], FREEFORM_DEFAULTS[key]);
  const visualContent = media?.url
    ? `<img src="${escapeHtml(media.url)}" alt="${escapeHtml(media.alt || slide.visual || slide.title)}" style="object-fit:${media.fit === 'contain' ? 'contain' : 'cover'};" />`
    : `
      <span>Visual</span>
      <strong>${escapeHtml(slide.visual || visualSpecOfSlide(slide).title || '插入图片或图表')}</strong>
      <p>${escapeHtml(slide.designIntent || slideEvidenceText(slide, plan))}</p>
    `;

  return `
    <div class="freeform-stage freeform-${escapeHtml(style.key)}">
      ${isVisible('eyebrow') ? `<div class="freeform-element freeform-eyebrow" data-aippt-element="eyebrow" style="${elementStyle('eyebrow')}">${escapeHtml(sectionTitle)} · ${escapeHtml(style.name)}</div>` : ''}
      ${isVisible('title') ? `<h1 class="freeform-element freeform-title" data-aippt-element="title" style="${elementStyle('title')}">${escapeHtml(slide.title)}</h1>` : ''}
      ${isVisible('headline') ? `<h2 class="freeform-element freeform-headline" data-aippt-element="headline" style="${elementStyle('headline')}">${escapeHtml(slide.headline)}</h2>` : ''}
      ${isVisible('bullets') ? `
        <ul class="freeform-element freeform-bullets" data-aippt-element="bullets" style="${elementStyle('bullets')}">
          ${(slide.bullets || []).slice(0, 6).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
        </ul>
      ` : ''}
      ${isVisible('visual') ? `<aside class="freeform-element freeform-visual" data-aippt-element="visual" style="${elementStyle('visual')}">${visualContent}</aside>` : ''}
      ${customElements.map(renderFreeformCustomElement).join('')}
      <div class="freeform-page-number">${String(slide.index).padStart(2, '0')}</div>
    </div>
  `;
}

function renderSlideHtml(slide: DeckSlide, plan: DeckPlan, config: DeckConfig, style: DeckRenderStyle) {
  if (slide.design?.mode === 'freeform') {
    return renderFreeformSlideHtml(slide, plan, config, style);
  }
  const structuredRows = structuredRowsFromSlide(slide);
  const rawBullets = structuredRows.length
    ? structuredRows
    : Array.isArray(slide.bullets) && slide.bullets.length
      ? slide.bullets
      : [slide.headline || slide.title || '补充页面要点'];
  const sections = Array.isArray(plan.sections) ? plan.sections : [];
  const header = renderSlideHeader(slide, plan);
  const visualText = slide.visual || slide.title;
  const speakerNotes = slide.speakerNotes || slide.designIntent || '';
  const useCase = USE_CASE_LABEL[config.useCase] || '演示';

  if (slide.layout === 'cover') {
    return `
      <div class="cover-stage">
        <div class="cover-copy">
          ${isStructuredElementVisible(slide, 'eyebrow') ? `<span class="deck-kicker" ${structuredElementAttrs(slide, 'eyebrow')}>${escapeHtml(useCase)} · ${escapeHtml(style.name)}</span>` : ''}
          ${isStructuredElementVisible(slide, 'title') ? `<h1 ${structuredElementAttrs(slide, 'title')}>${escapeHtml(plan.title || slide.title)}</h1>` : ''}
          ${isStructuredElementVisible(slide, 'headline') ? `<h2 ${structuredElementAttrs(slide, 'headline')}>${escapeHtml(slide.headline)}</h2>` : ''}
          ${isStructuredElementVisible(slide, 'bullets') ? `<div class="cover-points" ${structuredElementAttrs(slide, 'bullets')}>${rawBullets.map((item) => `<p>${escapeHtml(item)}</p>`).join('')}</div>` : ''}
        </div>
        ${isStructuredElementVisible(slide, 'visual') ? `<aside class="cover-brief" ${structuredElementAttrs(slide, 'visual')}>
          <span>Topic</span>
          <strong>${escapeHtml(config.topic || slide.title)}</strong>
          <p>${escapeHtml(config.audience)} · ${escapeHtml(config.durationMinutes)} 分钟 · ${escapeHtml(config.aspectRatio)}</p>
        </aside>` : ''}
      </div>
    `;
  }

  if (slide.layout === 'section') {
    const sectionVisualVisible = isStructuredElementVisible(slide, 'visual');
    return `
      <div class="section-stage">
        ${sectionVisualVisible ? `<span class="section-number" ${structuredElementAttrs(slide, 'visual')}>${String(slide.index).padStart(2, '0')}</span>` : ''}
        <div${sectionVisualVisible ? '' : ' style="grid-column:1 / -1;"'}>
          ${isStructuredElementVisible(slide, 'eyebrow') ? `<p ${structuredElementAttrs(slide, 'eyebrow')}>${escapeHtml(sections.find((s) => s.id === slide.sectionId)?.purpose || slide.designIntent || '')}</p>` : ''}
          ${isStructuredElementVisible(slide, 'title') ? `<h1 ${structuredElementAttrs(slide, 'title')}>${escapeHtml(slide.title)}</h1>` : ''}
          ${isStructuredElementVisible(slide, 'headline') ? `<h2 ${structuredElementAttrs(slide, 'headline')}>${escapeHtml(slide.headline)}</h2>` : ''}
        </div>
        ${isStructuredElementVisible(slide, 'bullets') ? `<div class="section-chips" ${structuredElementAttrs(slide, 'bullets')}>${rawBullets.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}</div>` : ''}
      </div>
    `;
  }

  if (slide.layout === 'compare') {
    const spec = visualSpecOfSlide(slide);
    const templateId = chartTemplateFromSlide(slide);
    if (spec.type === 'matrix' || templateId === 'feature_matrix_table' || (spec.columns?.length || 0) >= 3) return renderMatrixVisual(slide, plan);
    const labels = compareLabelsFromHints(slide);
    const groups = splitBulletsForColumns(rawBullets, visualText);
    return `
      ${header}
      ${isStructuredElementVisible(slide, 'visual') ? `<div class="compare-board" ${structuredElementAttrs(slide, 'visual')}>
        <article>
          <span>${escapeHtml(labels.left)}</span>
          ${isStructuredElementVisible(slide, 'bullets') ? groups.left.map((item) => `<p>${escapeHtml(item)}</p>`).join('') : ''}
        </article>
        <article>
          <span>${escapeHtml(labels.right)}</span>
          ${isStructuredElementVisible(slide, 'bullets') ? groups.right.map((item) => `<p>${escapeHtml(item)}</p>`).join('') : ''}
        </article>
      </div>` : ''}
    `;
  }

  if (slide.layout === 'metrics') {
    return `
      ${header}
      ${renderDataVisual(slide, rawBullets)}
      <footer class="evidence-strip">${escapeHtml(slideEvidenceText(slide, plan))}</footer>
    `;
  }

  if (slide.layout === 'process') {
    return `
      ${header}
      ${isStructuredElementVisible(slide, 'bullets') ? `<div class="process-lane" ${structuredElementAttrs(slide, 'bullets')}>
        ${rawBullets.map((item, index) => `<article><b>${String(index + 1).padStart(2, '0')}</b><p>${escapeHtml(item)}</p></article>`).join('')}
      </div>` : ''}
      <footer class="evidence-strip">${escapeHtml(speakerNotes)}</footer>
    `;
  }

  if (slide.layout === 'timeline') {
    return `
      ${header}
      ${isStructuredElementVisible(slide, 'visual') ? `<div class="timeline-lane" ${structuredElementAttrs(slide, 'visual')}>
        ${rawBullets.map((item, index) => `<article><b>阶段 ${index + 1}</b><p>${escapeHtml(item)}</p></article>`).join('')}
      </div>` : ''}
      ${renderVisualPanel(slide, plan, '路线图', false)}
    `;
  }

  if (slide.layout === 'diagram') {
    const spec = visualSpecOfSlide(slide);
    if (spec.type === 'architecture' || (spec.layers?.length || 0) >= 2) return renderArchitectureVisual(slide, plan);
    return `
      ${header}
      ${isStructuredElementVisible(slide, 'visual') ? `<div class="diagram-layout" ${structuredElementAttrs(slide, 'visual')}>
        <div class="diagram-map">
          <strong>${escapeHtml(visualText)}</strong>
          ${rawBullets.map((item, index) => `<span class="diagram-node node-${index + 1}">${escapeHtml(item)}</span>`).join('')}
        </div>
        <div class="diagram-notes">
          <span>结构说明</span>
          <p>${escapeHtml(slide.designIntent || slideEvidenceText(slide, plan))}</p>
        </div>
      </div>` : ''}
    `;
  }

  if (slide.layout === 'checklist') {
    return `
      ${header}
      ${isStructuredElementVisible(slide, 'bullets') ? `<div class="action-board" ${structuredElementAttrs(slide, 'bullets')}>
        ${rawBullets.map((item, index) => `<p><i>${index + 1}</i><span>${escapeHtml(item)}</span></p>`).join('')}
      </div>` : ''}
      <footer class="evidence-strip">${escapeHtml(speakerNotes)}</footer>
    `;
  }

  if (slide.layout === 'quote') {
    return `
      <figure class="quote-stage">
        ${isStructuredElementVisible(slide, 'eyebrow') ? `<span ${structuredElementAttrs(slide, 'eyebrow')}>${escapeHtml(sections.find((s) => s.id === slide.sectionId)?.title || '结论')}</span>` : ''}
        ${isStructuredElementVisible(slide, 'title') ? `<blockquote ${structuredElementAttrs(slide, 'title')}>${escapeHtml(slide.headline || slide.title)}</blockquote>` : ''}
        ${isStructuredElementVisible(slide, 'bullets') ? `<figcaption ${structuredElementAttrs(slide, 'bullets')}>${rawBullets.map((item) => `<em>${escapeHtml(item)}</em>`).join('')}</figcaption>` : ''}
      </figure>
    `;
  }

  const labels = compareLabelsFromHints(slide);
  const groups = splitBulletsForColumns(rawBullets, visualText);
  return `
    ${header}
    <div class="content-split">
      <section class="narrative-panel">
        <span>${escapeHtml(labels.left === '现状 / 问题' ? '关键内容' : labels.left)}</span>
        ${renderBulletList(groups.left, 'insight-list', slide)}
      </section>
      ${isStructuredElementVisible(slide, 'visual') ? `<section class="evidence-panel" ${structuredElementAttrs(slide, 'visual')}>
        <span>${escapeHtml(labels.right === '方案 / 增量' ? '支撑与表达' : labels.right)}</span>
        <strong>${escapeHtml(visualText)}</strong>
        ${isStructuredElementVisible(slide, 'bullets') ? renderBulletList(groups.right, 'compact-list') : ''}
        <p>${escapeHtml(slideEvidenceText(slide, plan))}</p>
      </section>` : ''}
    </div>
  `;
}

function rendererCss() {
  return `
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 100vw; height: 100vh; min-height: 100vh; overflow: hidden; overscroll-behavior: none; }
    body { background: var(--deck-bg); color: var(--deck-text); font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif; }
    .deck { position: fixed; inset: 0; display: grid; width: 100vw; height: 100vh; min-height: 100vh; grid-template-rows: minmax(0, 1fr) auto; gap: clamp(8px, 1.1vh, 14px); place-items: center; overflow: hidden; padding: clamp(10px, 2vh, 24px) clamp(12px, 2.2vw, 32px); background-color: var(--deck-bg); }
    .theme-executive_blue { background-image: linear-gradient(90deg, rgba(29,78,216,.055) 1px, transparent 1px), linear-gradient(180deg, rgba(29,78,216,.05) 1px, transparent 1px); background-size: 54px 54px; }
    .theme-tech_launch { background-color: #070A12; background-image: linear-gradient(90deg, rgba(129,140,248,.12) 1px, transparent 1px), linear-gradient(180deg, rgba(34,211,238,.10) 1px, transparent 1px), linear-gradient(135deg, rgba(34,211,238,.10) 0 18%, transparent 18% 100%); background-size: 44px 44px, 44px 44px, 100% 100%; }
    .theme-teaching_clear { background-image: linear-gradient(180deg, rgba(4,120,87,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(249,115,22,.06) 1px, transparent 1px); background-size: 100% 36px, 52px 100%; }
    .slides { width: min(96vw, calc((100vh - 72px) * var(--deck-ratio-scale))); max-height: calc(100vh - 72px); aspect-ratio: var(--deck-ratio); position: relative; align-self: center; justify-self: center; overflow: hidden; border: var(--deck-card-border) solid var(--deck-border); border-radius: var(--deck-radius); box-shadow: var(--deck-shadow); background: var(--deck-surface); }
    @supports (height: 100dvh) {
      html, body, .deck { height: 100dvh; min-height: 100dvh; }
      .slides { max-height: calc(100dvh - 72px); width: min(96vw, calc((100dvh - 72px) * var(--deck-ratio-scale))); }
    }
    .slide { position: absolute; inset: 0; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; gap: var(--deck-gap); padding: var(--deck-slide-pad-y) var(--deck-slide-pad-x); overflow: hidden; opacity: 0; transform: translateX(36px); transition: opacity .28s ease, transform .28s ease; background: var(--deck-surface); isolation: isolate; }
    .slide::before { content: ""; position: absolute; inset: 0; z-index: 0; pointer-events: none; opacity: .72; background-image: linear-gradient(135deg, color-mix(in srgb, var(--deck-primary) 7%, transparent) 0 32%, transparent 32% 100%); }
    .slide > * { position: relative; z-index: 1; }
    .slide::after { content: ""; position: absolute; z-index: 0; pointer-events: none; }
    .variant-1::before { background-image: linear-gradient(90deg, transparent 0 64%, color-mix(in srgb, var(--deck-accent) 11%, transparent) 64% 100%); }
    .variant-2::before { background-image: linear-gradient(180deg, color-mix(in srgb, var(--deck-primary) 6%, transparent) 0 18%, transparent 18% 100%), linear-gradient(90deg, color-mix(in srgb, var(--deck-accent) 8%, transparent) 1px, transparent 1px); background-size: 100% 100%, 42px 42px; }
    .theme-executive_blue .slide::after { left: 0; right: 0; top: 0; height: 10px; background: linear-gradient(90deg, var(--deck-primary), var(--deck-accent)); opacity: .86; }
    .theme-executive_blue .slide-header { padding-bottom: 18px; border-bottom: 1px solid var(--deck-border); }
    .theme-executive_blue .cover-stage { grid-template-columns: minmax(0, 1.08fr) 340px; }
    .theme-executive_blue .metric-board article, .theme-executive_blue .chart-card, .theme-executive_blue .matrix-board article { background: #fff; }
    .theme-executive_blue .evidence-strip { border-left: 5px solid var(--deck-accent); }
    .theme-tech_launch .slide { background: linear-gradient(135deg, #0B1120, #111827 62%, #111827); }
    .theme-tech_launch .slide::after { inset: auto 36px 28px 36px; height: 1px; background: linear-gradient(90deg, transparent, rgba(34,211,238,.62), transparent); }
    .theme-tech_launch .variant-1::before { background-image: linear-gradient(90deg, transparent 0 58%, rgba(34,211,238,.13) 58% 100%); }
    .theme-tech_launch h1, .theme-tech_launch blockquote { text-shadow: 0 18px 46px rgba(34, 211, 238, .14); }
    .theme-tech_launch .metric-board article, .theme-tech_launch .chart-card, .theme-tech_launch .matrix-board article, .theme-tech_launch .architecture-stack article { box-shadow: inset 0 1px 0 rgba(255,255,255,.07), 0 18px 44px rgba(0,0,0,.2); }
    .theme-tech_launch .chart-card { background: linear-gradient(135deg, rgba(34,211,238,.13), rgba(129,140,248,.08) 42%, rgba(15,23,42,.92)); }
    .theme-teaching_clear .slide { background: linear-gradient(180deg, #FFFFFF, #FBFFF9); }
    .theme-teaching_clear .slide::before { background-image: linear-gradient(180deg, transparent 0 72%, color-mix(in srgb, var(--deck-accent-soft) 54%, transparent) 72% 100%); }
    .theme-teaching_clear .slide::after { left: 30px; top: 30px; bottom: 30px; width: 6px; border-radius: 999px; background: linear-gradient(180deg, var(--deck-primary), var(--deck-accent)); opacity: .82; }
    .theme-teaching_clear .slide-header { padding-left: 18px; }
    .theme-teaching_clear .process-lane article, .theme-teaching_clear .timeline-lane article, .theme-teaching_clear .action-board p { background: #fff; border-style: dashed; }
    .theme-teaching_clear .metric-board article { border-top-width: 0; border-left: 8px solid var(--metric-color); background: color-mix(in srgb, var(--metric-color) 6%, #fff); }
	    .slide.active { opacity: 1; transform: translateX(0); }
	    .slide-cover, .slide-section, .slide-quote { grid-template-rows: 1fr; }
	    .slide.rhythm-anchor h1 { max-width: 980px; }
	    .slide.rhythm-dense { gap: calc(var(--deck-gap) * .76); }
	    .slide.rhythm-dense h1 { font-size: calc(45px * var(--deck-title-scale)); }
	    .slide.rhythm-dense h2 { margin-top: 7px; font-size: calc(21px * var(--deck-body-scale)); }
	    .slide.rhythm-breathing { gap: calc(var(--deck-gap) * 1.25); }
	    .slide.rhythm-breathing h1 { max-width: 820px; font-size: calc(58px * var(--deck-title-scale)); }
	    .slide.rhythm-breathing h2 { max-width: 760px; }
	    .slide.rhythm-breathing .content-split { grid-template-columns: minmax(0, 1fr); align-content: center; max-width: 920px; }
	    .slide.rhythm-breathing .evidence-panel { min-height: 190px; }
	    .freeform-stage { position: absolute; inset: 0; overflow: hidden; background: linear-gradient(135deg, color-mix(in srgb, var(--deck-primary) 5%, var(--deck-surface)), var(--deck-surface)); }
    .freeform-stage::before { content: ""; position: absolute; inset: 0; pointer-events: none; background-image: linear-gradient(90deg, color-mix(in srgb, var(--deck-primary) 6%, transparent) 1px, transparent 1px), linear-gradient(180deg, color-mix(in srgb, var(--deck-accent) 5%, transparent) 1px, transparent 1px); background-size: 52px 52px; opacity: .72; }
    .freeform-stage::after { content: ""; position: absolute; inset: auto 0 0; height: 10px; background: linear-gradient(90deg, var(--deck-primary), var(--deck-accent)); opacity: .7; }
    .freeform-element { position: absolute; z-index: 1; display: grid; min-width: 0; margin: 0; overflow: hidden; line-height: 1.14; letter-spacing: 0; }
    .freeform-title { align-content: start; }
    .freeform-headline { align-content: start; line-height: 1.35; }
    .freeform-eyebrow { align-content: center; text-transform: none; }
    .freeform-bullets { list-style: none; align-content: start; gap: 10px; padding: 0; line-height: 1.38; }
    .freeform-bullets li { position: relative; padding-left: 24px; }
    .freeform-bullets li::before { content: ""; position: absolute; left: 0; top: .62em; width: 9px; height: 9px; border-radius: 50%; background: var(--deck-accent); }
    .freeform-visual { align-content: stretch; gap: 12px; padding: 20px; border: 1px solid var(--deck-border); background: color-mix(in srgb, var(--deck-surface-alt) 58%, var(--deck-surface)); box-shadow: 0 18px 42px color-mix(in srgb, var(--deck-primary) 10%, transparent); }
    .freeform-visual img { width: 100%; height: 100%; min-height: 0; border-radius: inherit; object-position: center; }
    .freeform-visual span { color: var(--deck-primary); font-size: 13px; font-weight: 950; }
    .freeform-visual strong { font-size: 24px; line-height: 1.2; }
    .freeform-visual p { margin: 0; color: var(--deck-muted); font-size: 15px; line-height: 1.45; }
    .freeform-custom { border: 1px solid color-mix(in srgb, var(--deck-primary) 18%, transparent); box-shadow: 0 14px 34px color-mix(in srgb, var(--deck-primary) 9%, transparent); }
    .freeform-custom-text { align-content: start; padding: 14px 16px; background: color-mix(in srgb, var(--deck-surface) 86%, transparent); line-height: 1.36; }
    .freeform-custom-image { align-content: center; justify-items: center; padding: 12px; background: color-mix(in srgb, var(--deck-primary) 7%, var(--deck-surface)); }
    .freeform-custom-image img { width: 100%; height: 100%; min-height: 0; border-radius: inherit; object-position: center; }
    .freeform-custom-image span { color: var(--deck-primary); font-size: 13px; font-weight: 900; }
    .freeform-custom-image strong { font-size: 18px; }
    .freeform-custom-shape { background: color-mix(in srgb, var(--deck-accent) 18%, var(--deck-surface-alt)); }
    .freeform-custom-shape-pill { border-radius: 999px !important; }
    .freeform-custom-shape-circle { border-radius: 50% !important; }
    .freeform-custom-metric { align-content: center; gap: 8px; padding: 16px 18px; background: color-mix(in srgb, var(--deck-primary) 9%, var(--deck-surface)); border-left: 7px solid var(--deck-primary); }
    .freeform-custom-metric strong { color: var(--deck-primary); font-size: 1.35em; line-height: 1; }
    .freeform-custom-metric span { color: var(--deck-muted); font-size: .48em; font-weight: 850; }
    .freeform-page-number { position: absolute; z-index: 1; right: 44px; top: 38px; color: var(--deck-muted); font-size: 15px; font-weight: 900; border-bottom: 3px solid var(--deck-accent); padding-bottom: 6px; }
    .theme-tech_launch .freeform-stage { background: linear-gradient(135deg, #0B1120, #111827 70%, #121826); }
    .theme-teaching_clear .freeform-stage { background: linear-gradient(180deg, #fff, #fbfff9); }
    .slide-header { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 24px; align-items: start; }
    .slide-eyebrow, .deck-kicker { color: var(--deck-primary); font-size: 14px; font-weight: 850; }
    .slide-index { color: var(--deck-muted); font-size: 15px; font-weight: 900; border-bottom: 3px solid var(--deck-accent); padding-bottom: 6px; }
    h1 { margin: 0; max-width: 940px; font-size: calc(52px * var(--deck-title-scale)); line-height: 1.08; letter-spacing: 0; }
    h2 { margin: 10px 0 0; max-width: 1020px; color: var(--deck-muted); font-size: calc(24px * var(--deck-body-scale)); line-height: 1.44; font-weight: 650; letter-spacing: 0; }
    p, li, strong, span, em, b { letter-spacing: 0; }
    .cover-stage { min-height: 100%; display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 48px; align-items: center; }
    .cover-copy { display: grid; gap: 18px; align-content: center; }
    .cover-copy h1 { max-width: 980px; font-size: calc(70px * var(--deck-title-scale)); line-height: 1.02; }
    .cover-copy h2 { max-width: 860px; color: var(--deck-text); font-size: calc(30px * var(--deck-body-scale)); }
    .cover-points { display: grid; gap: 10px; max-width: 760px; margin-top: 8px; }
    .cover-points p { margin: 0; color: var(--deck-muted); font-size: 20px; line-height: 1.5; }
    .cover-brief, .visual-panel, .evidence-panel, .narrative-panel { border: 1px solid var(--deck-border); border-radius: var(--deck-radius); background: color-mix(in srgb, var(--deck-surface) 88%, var(--deck-surface-alt)); }
    .cover-brief { display: grid; align-content: end; gap: 14px; min-height: 360px; padding: 28px; border-left: 6px solid var(--deck-accent); }
    .cover-brief span, .visual-panel span, .evidence-panel span, .narrative-panel span, .diagram-notes span { color: var(--deck-primary); font-size: 13px; font-weight: 900; }
    .cover-brief strong { font-size: 28px; line-height: 1.24; }
    .cover-brief p { margin: 0; color: var(--deck-muted); font-size: 16px; line-height: 1.55; }
    .section-stage { min-height: 100%; display: grid; grid-template-columns: 170px minmax(0, 1fr); grid-template-rows: 1fr auto; gap: 24px 42px; align-items: center; }
    .section-number { color: var(--deck-accent); font-size: 86px; font-weight: 950; line-height: 1; }
    .section-stage p { margin: 0 0 18px; color: var(--deck-muted); font-size: 20px; line-height: 1.5; }
    .section-stage h1 { font-size: 60px; }
    .section-chips { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .section-chips span { padding: 14px 16px; border-top: 4px solid var(--deck-primary); background: color-mix(in srgb, var(--deck-primary) 7%, var(--deck-surface)); border-radius: var(--deck-radius); color: var(--deck-text); font-weight: 750; line-height: 1.45; }
    .content-split { display: grid; grid-template-columns: minmax(0, .96fr) minmax(300px, .74fr); gap: 28px; align-items: stretch; }
    .slide-two_column.variant-1 .content-split { grid-template-columns: minmax(300px, .72fr) minmax(0, 1fr); }
    .slide-two_column.variant-2 .content-split { grid-template-columns: 1fr; }
    .narrative-panel, .evidence-panel, .visual-panel { display: grid; align-content: start; gap: 16px; padding: 26px; }
    .insight-list, .compact-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 14px; }
    .insight-list li { padding: 16px 18px; border-left: 5px solid var(--deck-accent); border-radius: calc(var(--deck-radius) * .72); background: color-mix(in srgb, var(--deck-primary) 8%, transparent); font-size: 21px; line-height: 1.5; }
    .compact-list li { padding: 12px 0; border-bottom: 1px solid var(--deck-border); color: var(--deck-muted); font-size: 17px; line-height: 1.5; }
    .evidence-panel strong, .visual-panel strong { color: var(--deck-text); font-size: 28px; line-height: 1.22; }
    .evidence-panel p, .visual-panel p { margin: 0; color: var(--deck-muted); font-size: 16px; line-height: 1.55; }
    .compare-board { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 22px; align-items: stretch; }
    .compare-board article { display: grid; align-content: start; gap: 18px; padding: 28px; border-radius: var(--deck-radius); border: 1px solid var(--deck-border); background: color-mix(in srgb, var(--deck-primary) 8%, var(--deck-surface)); }
    .compare-board article:nth-child(2) { background: color-mix(in srgb, var(--deck-accent) 11%, var(--deck-surface)); border-color: color-mix(in srgb, var(--deck-accent) 36%, transparent); }
    .compare-board span { color: var(--deck-primary); font-size: 15px; font-weight: 950; }
    .compare-board p { margin: 0; font-size: 24px; line-height: 1.42; font-weight: 680; }
    .matrix-stage { display: grid; grid-template-rows: auto minmax(0, 1fr); gap: 18px; min-height: 0; }
    .matrix-title { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 10px 18px; align-items: end; }
    .matrix-title span { color: var(--deck-primary); font-size: 13px; font-weight: 950; }
    .matrix-title strong { font-size: 24px; line-height: 1.22; }
    .matrix-title p { grid-column: 2; margin: 0; color: var(--deck-muted); font-size: 15px; }
    .matrix-board { display: grid; grid-template-columns: repeat(var(--matrix-cols), minmax(0, 1fr)); gap: 16px; min-height: 0; align-items: stretch; }
    .matrix-board article { display: grid; grid-template-rows: auto auto 1fr; gap: 14px; min-width: 0; padding: 22px; border-radius: var(--deck-radius); border: 1px solid var(--deck-border); background: color-mix(in srgb, var(--deck-primary) 7%, var(--deck-surface)); }
    .matrix-board article:nth-child(2) { background: color-mix(in srgb, var(--deck-accent) 8%, var(--deck-surface)); }
    .matrix-board article:nth-child(3) { background: color-mix(in srgb, var(--deck-chart-3) 8%, var(--deck-surface)); }
    .matrix-board b { color: var(--deck-primary); font-size: 14px; font-weight: 950; }
    .matrix-board strong { min-height: 58px; font-size: 24px; line-height: 1.22; }
    .matrix-board article > div { display: grid; gap: 10px; align-content: start; }
    .matrix-board article span { display: block; padding: 12px 13px; border-radius: calc(var(--deck-radius) * .72); color: var(--deck-text); font-size: 17px; line-height: 1.35; font-weight: 780; }
    .matrix-board .is-high { background: color-mix(in srgb, var(--deck-accent) 24%, var(--deck-surface)); border-left: 5px solid var(--deck-accent); }
    .matrix-board .is-medium { background: color-mix(in srgb, var(--deck-primary) 13%, var(--deck-surface)); border-left: 5px solid var(--deck-primary); }
    .matrix-board .is-low { background: color-mix(in srgb, var(--deck-muted) 12%, var(--deck-surface)); border-left: 5px solid color-mix(in srgb, var(--deck-muted) 64%, transparent); color: var(--deck-muted); }
    .metric-board { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; align-content: center; }
    .metric-board article { display: grid; gap: 16px; min-height: 240px; padding: 26px; border-radius: var(--deck-radius); border: 1px solid var(--deck-border); border-top: 7px solid var(--metric-color); background: color-mix(in srgb, var(--metric-color) 9%, var(--deck-surface)); }
    .metric-board b { color: var(--metric-color); font-size: 46px; line-height: 1; word-break: keep-all; }
    .metric-board strong { font-size: 22px; line-height: 1.42; }
    .metric-board span { align-self: end; color: var(--deck-muted); font-size: 14px; font-weight: 850; }
    .metric-board--compact { grid-template-columns: 1fr; align-content: stretch; }
	    .metric-board--compact article { min-height: 0; gap: 8px; padding: 18px; border-top-width: 0; border-left: 6px solid var(--metric-color); }
	    .metric-board--compact b { font-size: 30px; }
	    .metric-board--compact strong { font-size: 18px; }
	    .metric-board--dashboard { grid-template-columns: 1.12fr repeat(2, minmax(0, .88fr)); grid-auto-rows: minmax(190px, auto); }
	    .metric-board--dashboard article:first-child { grid-row: span 2; align-content: end; min-height: 398px; background: linear-gradient(160deg, color-mix(in srgb, var(--metric-color) 16%, var(--deck-surface)), var(--deck-surface)); }
	    .metric-board--dashboard article:first-child b { font-size: 72px; }
	    .metric-board--bullets { grid-template-columns: repeat(2, minmax(0, 1fr)); }
	    .metric-board--bullets article { min-height: 178px; border-top-width: 0; border-left: 8px solid var(--metric-color); }
	    .data-layout { display: grid; gap: 22px; min-height: 0; align-items: stretch; }
	    .data-layout--bar, .data-layout--line, .data-layout--horizontal { grid-template-columns: minmax(0, 1fr) 300px; }
	    .combo-metrics { display: grid; grid-template-columns: minmax(0, 1fr) 310px; gap: 22px; min-height: 0; align-items: stretch; }
    .chart-card { display: grid; gap: 18px; min-height: 330px; padding: 28px; border: 1px solid var(--deck-border); border-radius: var(--deck-radius); background: linear-gradient(135deg, color-mix(in srgb, var(--deck-primary) 9%, var(--deck-surface)), var(--deck-surface)); overflow: hidden; }
    .chart-title { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
    .chart-title span, .chart-card > span { color: var(--deck-primary); font-size: 13px; font-weight: 950; }
    .chart-title strong, .chart-card > strong { font-size: 28px; line-height: 1.18; }
    .chart-card--pending { align-content: center; border-style: dashed; background: color-mix(in srgb, var(--deck-surface-alt) 64%, var(--deck-surface)); }
    .chart-card--pending p { max-width: 620px; margin: 0; color: var(--deck-muted); font-size: 19px; line-height: 1.55; }
    .chart-card--multi { gap: 13px; }
    .chart-legend { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; }
    .chart-legend span { display: inline-flex; align-items: center; gap: 7px; color: var(--deck-muted); font-size: 13px; font-weight: 850; }
    .chart-legend i { width: 10px; height: 10px; border-radius: 50%; background: var(--legend-color); box-shadow: 0 0 0 4px color-mix(in srgb, var(--legend-color) 12%, transparent); }
    .bar-chart { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 14px; align-items: end; min-height: 238px; padding-top: 12px; }
    .bar-item { display: grid; grid-template-rows: 1fr auto auto; gap: 8px; min-width: 0; height: 100%; align-items: end; text-align: center; }
    .bar-item i { display: block; width: 100%; min-height: 18px; height: var(--bar-height); border-radius: 12px 12px 5px 5px; background: linear-gradient(180deg, var(--bar-color), color-mix(in srgb, var(--bar-color) 52%, var(--deck-surface))); box-shadow: 0 12px 22px color-mix(in srgb, var(--bar-color) 18%, transparent); }
    .bar-item b { color: var(--deck-text); font-size: 20px; line-height: 1.1; }
    .bar-item span { min-height: 38px; color: var(--deck-muted); font-size: 13px; line-height: 1.35; font-weight: 780; }
    .grouped-bar-chart { display: grid; grid-template-columns: repeat(var(--group-count), minmax(0, 1fr)); gap: 13px; align-items: end; min-height: 212px; padding-top: 8px; }
    .bar-group { display: grid; grid-template-rows: 1fr auto; gap: 8px; min-width: 0; height: 100%; text-align: center; }
    .bar-group__bars { display: grid; grid-template-columns: repeat(var(--series-count), minmax(0, 1fr)); gap: 4px; align-items: end; min-height: 180px; }
	    .bar-group__bars i { display: block; min-width: 0; min-height: 8px; height: var(--bar-height); border-radius: 9px 9px 4px 4px; background: linear-gradient(180deg, var(--bar-color), color-mix(in srgb, var(--bar-color) 48%, var(--deck-surface))); box-shadow: 0 10px 18px color-mix(in srgb, var(--bar-color) 13%, transparent); }
	    .bar-group b { color: var(--deck-muted); font-size: 12px; line-height: 1.25; font-weight: 850; }
	    .chart-card--horizontal { align-content: stretch; }
	    .horizontal-bar-chart { display: grid; gap: 13px; align-content: center; }
	    .horizontal-bar-item { display: grid; grid-template-columns: minmax(118px, .56fr) minmax(0, 1fr) minmax(70px, auto); gap: 13px; align-items: center; }
	    .horizontal-bar-item span { color: var(--deck-muted); font-size: 14px; line-height: 1.3; font-weight: 850; }
	    .horizontal-bar-item i { position: relative; height: 18px; overflow: hidden; border-radius: 999px; background: color-mix(in srgb, var(--bar-color) 13%, var(--deck-surface-alt)); }
	    .horizontal-bar-item i::before { content: ""; position: absolute; inset: 0 auto 0 0; width: var(--bar-width); border-radius: inherit; background: linear-gradient(90deg, var(--bar-color), color-mix(in srgb, var(--bar-color) 52%, var(--deck-surface))); box-shadow: 0 10px 20px color-mix(in srgb, var(--bar-color) 14%, transparent); }
	    .horizontal-bar-item b { color: var(--deck-text); font-size: 18px; line-height: 1; text-align: right; }
	    .chart-card--line svg { width: 100%; min-height: 230px; overflow: visible; }
    .chart-card--line .axis { stroke: color-mix(in srgb, var(--deck-muted) 28%, transparent); stroke-width: 2; }
    .chart-card--line .line-path { fill: none; stroke: var(--deck-accent); stroke-width: var(--deck-chart-stroke); stroke-linecap: round; stroke-linejoin: round; filter: drop-shadow(0 10px 14px color-mix(in srgb, var(--deck-accent) 20%, transparent)); }
    .chart-card--line .line-path--series { stroke: var(--line-color); stroke-width: var(--deck-series-stroke); filter: drop-shadow(0 8px 12px color-mix(in srgb, var(--line-color) 16%, transparent)); }
    .chart-card--line circle { fill: var(--deck-surface); stroke: var(--deck-accent); stroke-width: 5; }
    .chart-card--line .line-dot { fill: var(--deck-surface); stroke: var(--line-color); stroke-width: 4; }
    .chart-card--line text { fill: var(--deck-muted); font-size: 12px; font-weight: 800; text-anchor: middle; }
    .line-values { display: flex; flex-wrap: wrap; gap: 8px; }
    .line-values span { padding: 8px 10px; border-radius: 999px; background: color-mix(in srgb, var(--deck-accent) 12%, transparent); color: var(--deck-text); font-size: 13px; font-weight: 850; }
    .line-values--series span { background: color-mix(in srgb, var(--deck-primary) 8%, transparent); }
    .chart-source { margin: 0; color: var(--deck-muted); font-size: 12px; font-weight: 760; }
    .process-lane, .timeline-lane { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; align-items: stretch; }
    .process-lane article, .timeline-lane article, .action-board p { border-radius: var(--deck-radius); border: 1px solid var(--deck-border); background: color-mix(in srgb, var(--deck-accent) 8%, var(--deck-surface)); }
	    .process-lane article { display: grid; grid-template-rows: auto 1fr; gap: 22px; min-height: 250px; padding: 24px; }
	    .chart-process_flow .process-lane article:not(:last-child)::after, .chart-pipeline_with_stages .process-lane article:not(:last-child)::after { content: ""; position: absolute; right: -18px; top: 50%; width: 22px; height: 2px; background: var(--deck-accent); transform: translateY(-50%); }
	    .chart-process_flow .process-lane article, .chart-pipeline_with_stages .process-lane article { position: relative; }
	    .chart-pipeline_with_stages .process-lane article { border-top: 6px solid var(--deck-primary); background: linear-gradient(180deg, color-mix(in srgb, var(--deck-primary) 8%, var(--deck-surface)), var(--deck-surface)); }
	    .chart-numbered_steps .process-lane, .chart-agenda_list .process-lane { grid-template-columns: repeat(4, minmax(0, 1fr)); }
	    .chart-numbered_steps .process-lane article, .chart-agenda_list .process-lane article { min-height: 190px; }
	    .process-lane b { width: 44px; height: 44px; display: grid; place-items: center; border-radius: 50%; background: var(--deck-accent); color: #fff; font-size: 14px; }
    .process-lane p, .timeline-lane p { margin: 0; font-size: 20px; line-height: 1.48; font-weight: 650; }
    .timeline-lane { position: relative; }
    .timeline-lane::before { content: ""; position: absolute; left: 4%; right: 4%; top: 38px; height: 3px; background: color-mix(in srgb, var(--deck-primary) 44%, transparent); }
    .timeline-lane article { position: relative; display: grid; gap: 18px; min-height: 230px; padding: 64px 22px 22px; }
	    .timeline-lane article::before { content: ""; position: absolute; top: 28px; left: 24px; width: 22px; height: 22px; border: 5px solid var(--deck-accent); border-radius: 50%; background: var(--deck-surface); }
	    .timeline-lane b { color: var(--deck-primary); font-size: 15px; font-weight: 950; }
	    .chart-roadmap_vertical .timeline-lane { grid-template-columns: 1fr; gap: 12px; padding-left: 44px; }
	    .chart-roadmap_vertical .timeline-lane::before { left: 12px; right: auto; top: 8px; bottom: 8px; width: 3px; height: auto; }
	    .chart-roadmap_vertical .timeline-lane article { min-height: 92px; padding: 16px 20px; }
	    .chart-roadmap_vertical .timeline-lane article::before { left: -42px; top: 20px; }
	    .chart-gantt_chart .timeline-lane { grid-template-columns: 1fr; gap: 10px; }
	    .chart-gantt_chart .timeline-lane::before { display: none; }
	    .chart-gantt_chart .timeline-lane article { min-height: 82px; padding: 18px 24px 18px 176px; }
	    .chart-gantt_chart .timeline-lane article::before { left: 26px; top: 28px; width: 122px; height: 18px; border: 0; border-radius: 999px; background: linear-gradient(90deg, var(--deck-primary), var(--deck-accent)); }
	    .diagram-layout { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 28px; align-items: stretch; }
    .diagram-map { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-content: center; padding: 28px; border-radius: var(--deck-radius); border: 1px solid var(--deck-border); background: linear-gradient(135deg, color-mix(in srgb, var(--deck-primary) 9%, var(--deck-surface)), var(--deck-surface)); }
    .diagram-map strong { grid-column: 1 / -1; padding: 18px; color: var(--deck-primary); border-bottom: 2px solid var(--deck-border); font-size: 28px; line-height: 1.26; }
    .diagram-node { min-height: 92px; padding: 18px; border-left: 5px solid var(--deck-chart-1); border-radius: calc(var(--deck-radius) * .8); background: var(--deck-surface); font-size: 18px; line-height: 1.45; font-weight: 700; }
    .node-2 { border-left-color: var(--deck-chart-2); }
    .node-3 { border-left-color: var(--deck-chart-3); }
    .node-4 { border-left-color: var(--deck-chart-4); }
    .diagram-notes { display: grid; align-content: end; gap: 12px; padding: 24px; border-radius: var(--deck-radius); background: color-mix(in srgb, var(--deck-accent) 9%, var(--deck-surface)); border: 1px solid color-mix(in srgb, var(--deck-accent) 30%, transparent); }
    .diagram-notes p { margin: 0; color: var(--deck-muted); font-size: 17px; line-height: 1.55; }
    .architecture-stage { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 26px; align-items: stretch; min-height: 0; }
    .architecture-stack { display: grid; gap: 12px; align-content: center; min-height: 0; }
	    .architecture-stack article { position: relative; display: grid; grid-template-columns: 54px minmax(0, 1fr); gap: 18px; align-items: center; min-height: 96px; padding: 18px 22px; border-radius: var(--deck-radius); border: 1px solid var(--deck-border); background: linear-gradient(90deg, color-mix(in srgb, var(--deck-primary) 9%, var(--deck-surface)), var(--deck-surface)); }
	    .chart-layered_architecture .architecture-stack article:nth-child(even) { margin-left: 46px; }
	    .chart-hub_spoke .diagram-map { border-radius: 42px; grid-template-columns: repeat(2, minmax(0, 1fr)); place-items: stretch; }
	    .architecture-stack article:not(:last-child)::after { content: "↓"; position: absolute; left: 31px; bottom: -20px; z-index: 2; width: 28px; height: 28px; display: grid; place-items: center; border-radius: 999px; background: var(--deck-accent); color: #fff; font-weight: 950; }
    .architecture-stack b { display: grid; width: 42px; height: 42px; place-items: center; border-radius: 12px; background: color-mix(in srgb, var(--deck-primary) 18%, var(--deck-surface)); color: var(--deck-primary); font-size: 14px; }
    .architecture-stack strong { font-size: 25px; line-height: 1.2; }
    .architecture-stack p { margin: 6px 0 0; color: var(--deck-muted); font-size: 16px; line-height: 1.45; }
    .architecture-note { display: grid; align-content: end; gap: 13px; padding: 24px; border-radius: var(--deck-radius); border: 1px solid color-mix(in srgb, var(--deck-accent) 32%, transparent); background: color-mix(in srgb, var(--deck-accent) 9%, var(--deck-surface)); }
    .architecture-note span { color: var(--deck-primary); font-size: 13px; font-weight: 950; }
    .architecture-note strong { font-size: 27px; line-height: 1.22; }
    .architecture-note p { margin: 0; color: var(--deck-muted); font-size: 16px; line-height: 1.55; }
    .architecture-note em { width: max-content; max-width: 100%; padding: 9px 12px; border-radius: 999px; background: color-mix(in srgb, var(--deck-accent) 18%, transparent); color: var(--deck-text); font-style: normal; font-size: 13px; font-weight: 850; }
    .action-board { display: grid; gap: 14px; align-content: center; }
    .action-board p { display: grid; grid-template-columns: 42px 1fr; gap: 16px; align-items: start; margin: 0; padding: 18px 20px; font-size: 22px; line-height: 1.45; }
    .action-board i { display: grid; width: 34px; height: 34px; place-items: center; border-radius: 9px; background: var(--deck-accent); color: #fff; font-style: normal; font-weight: 900; }
    .quote-stage { min-height: 100%; margin: 0; display: grid; gap: 28px; place-items: center; align-content: center; text-align: center; }
    .quote-stage span { color: var(--deck-primary); font-size: 15px; font-weight: 950; }
    blockquote { max-width: 1040px; margin: 0; color: var(--deck-primary); font-size: 64px; line-height: 1.16; font-weight: 950; }
    figcaption { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; }
    figcaption em { padding: 10px 14px; border-radius: 999px; background: color-mix(in srgb, var(--deck-primary) 9%, transparent); color: var(--deck-muted); font-style: normal; font-weight: 760; }
	    .evidence-strip { align-self: end; min-height: 46px; padding: 12px 16px; border-radius: calc(var(--deck-radius) * .8); border: 1px solid var(--deck-border); color: var(--deck-muted); background: color-mix(in srgb, var(--deck-surface-alt) 70%, var(--deck-surface)); font-size: 15px; line-height: 1.45; overflow: hidden; }
	    .chart-comparison_table .compare-board { grid-template-columns: 1fr; gap: 14px; }
	    .chart-comparison_table .compare-board article { grid-template-columns: 180px minmax(0, 1fr); align-items: center; min-height: 118px; }
	    .chart-comparison_table .compare-board span { align-self: stretch; display: grid; align-content: center; border-right: 1px solid var(--deck-border); }
	    .chart-comparison_columns .compare-board article { min-height: 350px; align-content: end; border-top: 7px solid var(--deck-primary); }
	    .chart-comparison_columns .compare-board article:nth-child(2) { border-top-color: var(--deck-accent); }
	    .chart-feature_matrix_table .matrix-board article { padding: 16px; gap: 10px; }
	    .chart-feature_matrix_table .matrix-board strong { min-height: 0; font-size: 20px; }
	    .chart-feature_matrix_table .matrix-board article span { padding: 9px 10px; font-size: 14px; }
	    .chart-quadrant_text_bullets .matrix-board { grid-template-columns: repeat(2, minmax(0, 1fr)); }
	    .ratio-wide .slide { padding: 34px 58px; gap: 14px; }
    .ratio-wide h1 { font-size: 38px; }
    .ratio-wide h2 { margin-top: 6px; font-size: 18px; line-height: 1.35; }
    .ratio-wide .cover-copy h1 { font-size: 46px; }
    .ratio-wide .cover-copy h2 { font-size: 20px; }
    .ratio-wide .cover-brief { min-height: 190px; }
    .ratio-wide .metric-board article, .ratio-wide .process-lane article, .ratio-wide .timeline-lane article { min-height: 150px; }
	    .ratio-wide .data-layout--bar, .ratio-wide .data-layout--line, .ratio-wide .data-layout--horizontal { grid-template-columns: minmax(0, 1fr) 270px; }
	    .ratio-wide .combo-metrics { grid-template-columns: minmax(0, 1fr) 270px; }
    .ratio-wide .chart-card { min-height: 170px; padding: 20px; gap: 10px; }
    .ratio-wide .bar-chart { min-height: 116px; }
    .ratio-wide .grouped-bar-chart { min-height: 104px; gap: 9px; }
    .ratio-wide .bar-group__bars { min-height: 82px; }
    .ratio-wide .chart-card--line svg { min-height: 124px; }
	    .ratio-wide .metric-board--compact article { min-height: 0; padding: 13px 14px; }
	    .ratio-wide .metric-board--compact b { font-size: 23px; }
	    .ratio-wide .metric-board--dashboard { grid-auto-rows: minmax(112px, auto); }
	    .ratio-wide .metric-board--dashboard article:first-child { min-height: 236px; }
	    .ratio-wide .metric-board--dashboard article:first-child b { font-size: 42px; }
	    .ratio-wide .horizontal-bar-chart { gap: 8px; }
	    .ratio-wide .horizontal-bar-item { grid-template-columns: minmax(86px, .52fr) minmax(0, 1fr) minmax(60px, auto); gap: 9px; }
	    .ratio-wide .chart-title strong, .ratio-wide .chart-card > strong { font-size: 21px; }
    .ratio-wide .matrix-board article { padding: 16px; gap: 10px; }
    .ratio-wide .matrix-board strong { min-height: 0; font-size: 19px; }
    .ratio-wide .matrix-board article span { padding: 9px 10px; font-size: 14px; }
    .ratio-wide .architecture-stage { grid-template-columns: minmax(0, 1fr) 280px; gap: 18px; }
    .ratio-wide .architecture-stack { gap: 8px; }
    .ratio-wide .architecture-stack article { min-height: 62px; padding: 10px 14px; grid-template-columns: 42px minmax(0, 1fr); }
    .ratio-wide .architecture-stack article:not(:last-child)::after { left: 22px; bottom: -17px; width: 22px; height: 22px; }
    .ratio-wide .architecture-stack b { width: 32px; height: 32px; }
    .ratio-wide .architecture-stack strong { font-size: 18px; }
    .ratio-wide .architecture-stack p { margin-top: 3px; font-size: 13px; }
    .ratio-wide .architecture-note { padding: 18px; }
    .ratio-wide .section-number { font-size: 58px; }
    .ratio-wide .section-stage h1, .ratio-wide blockquote { font-size: 42px; }
    .nav { display: flex; gap: 8px; align-items: center; justify-self: center; padding: 8px; border-radius: 999px; background: rgba(15,23,42,.72); color: #fff; backdrop-filter: blur(12px); }
    .nav button { height: 34px; border: 0; border-radius: 999px; padding: 0 14px; background: rgba(255,255,255,.14); color: #fff; cursor: pointer; font-weight: 750; }
    .nav span { min-width: 72px; text-align: center; font-size: 13px; }
    @media (max-width: 860px) {
      .deck { padding: 12px; }
      .slide { padding: 34px 24px; gap: 14px; }
      h1, .section-stage h1 { font-size: 32px; }
      h2 { font-size: 18px; }
	      .cover-stage, .section-stage, .content-split, .compare-board, .matrix-board, .metric-board, .data-layout--bar, .data-layout--line, .data-layout--horizontal, .combo-metrics, .process-lane, .timeline-lane, .diagram-layout, .architecture-stage { grid-template-columns: 1fr; }
      .cover-copy h1, blockquote { font-size: 38px; }
      .cover-brief, .visual-panel, .diagram-notes { display: none; }
      .section-chips { grid-template-columns: 1fr; }
      .timeline-lane::before { display: none; }
    }
  `;
}

export function buildHtmlDeck(plan: DeckPlan | null, config: DeckConfig, style: DeckRenderStyle, options: DeckRenderOptions = {}) {
  if (!plan) return '';
  const renderPlan = normalizePlanLayouts(plan, config);
  const ratio = config.aspectRatio === '3:1' ? '3 / 1' : '16 / 9';
  const ratioScale = config.aspectRatio === '3:1' ? 3 : 16 / 9;
  const ratioClass = config.aspectRatio === '3:1' ? 'ratio-wide' : 'ratio-standard';
  const chartPalette = style.tokens.chartPalette;
  const tuning = STYLE_RENDER_TUNING[style.key] || STYLE_RENDER_TUNING.executive_blue;
  const cssVars = `
    --deck-bg: ${style.tokens.background};
    --deck-surface: ${style.tokens.surface};
    --deck-surface-alt: ${style.tokens.surfaceAlt};
    --deck-primary: ${style.tokens.primary};
    --deck-accent: ${style.tokens.accent};
    --deck-accent-soft: ${style.tokens.accentSoft};
    --deck-text: ${style.tokens.text};
    --deck-muted: ${style.tokens.muted};
    --deck-border: ${style.tokens.border};
    --deck-radius: ${style.tokens.radius}px;
    --deck-shadow: ${style.tokens.shadow};
    --deck-chart-1: ${chartPalette[0] || style.tokens.primary};
    --deck-chart-2: ${chartPalette[1] || style.tokens.accent};
    --deck-chart-3: ${chartPalette[2] || style.tokens.primary};
    --deck-chart-4: ${chartPalette[3] || style.tokens.muted};
    --deck-ratio: ${ratio};
    --deck-ratio-scale: ${ratioScale};
    --deck-title-scale: ${tuning.titleScale};
    --deck-body-scale: ${tuning.bodyScale};
    --deck-slide-pad-y: ${tuning.slidePadY}px;
    --deck-slide-pad-x: ${tuning.slidePadX}px;
    --deck-gap: ${tuning.gap}px;
    --deck-chart-stroke: ${tuning.chartStroke};
    --deck-series-stroke: ${Math.max(3.5, tuning.chartStroke * 0.72)};
    --deck-card-weight: ${tuning.cardWeight};
    --deck-card-border: ${Math.max(1, tuning.cardWeight).toFixed(2)}px;
  `;
  const deckSlides = Array.isArray(renderPlan.slides) ? renderPlan.slides : [];
  const initialSlide = Math.max(0, Math.min(deckSlides.length - 1, Number(options.initialSlide ?? 0) || 0));
  const slides = deckSlides.map((rawSlide, offset) => {
    const slide = {
      ...rawSlide,
      index: Number.isFinite(Number(rawSlide.index)) ? Number(rawSlide.index) : offset + 1,
      layout: rawSlide.layout || inferSlideLayout(rawSlide.title, rawSlide.visual, offset + 1, config.useCase),
      bullets: Array.isArray(rawSlide.bullets) ? rawSlide.bullets : [],
      knowledgeIds: Array.isArray(rawSlide.knowledgeIds) ? rawSlide.knowledgeIds : [],
      renderHints: Array.isArray(rawSlide.renderHints) ? rawSlide.renderHints : [],
    };
    const scheduledSlide = {
      ...slide,
      layout: scheduledLayoutForSlide(slide as DeckSlide, config),
    } as DeckSlide;
    const rhythm = rhythmFromSlide(scheduledSlide);
    const chartTemplate = chartTemplateFromSlide(scheduledSlide);
    return `
      <section class="slide slide-${scheduledSlide.layout} rhythm-${rhythm} chart-${chartTemplate || 'none'} variant-${(scheduledSlide.index - 1) % 3}">
        ${renderSlideHtml(scheduledSlide, renderPlan, config, style)}
      </section>
    `;
  }).join('');
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(renderPlan.title)}</title>
  <style>
    ${rendererCss()}
  </style>
</head>
<body>
  <main class="deck theme-${style.key} pattern-${style.tokens.canvasPattern} cover-${style.tokens.coverLayout} layout-${style.tokens.contentLayout} ${ratioClass}" style="${cssVars}">
    <div class="slides">${slides}</div>
    <div class="nav"><button id="prev">上一页</button><span id="count"></span><button id="next">下一页</button></div>
  </main>
  <script>
    const slides = Array.from(document.querySelectorAll('.slide'));
    let current = 0;
    function show(index) {
      current = Math.max(0, Math.min(slides.length - 1, index));
      slides.forEach((slide, i) => slide.classList.toggle('active', i === current));
      const count = document.getElementById('count');
      if (count) count.textContent = (current + 1) + ' / ' + slides.length;
    }
    document.getElementById('prev').onclick = () => show(current - 1);
    document.getElementById('next').onclick = () => show(current + 1);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight' || event.key === ' ') show(current + 1);
      if (event.key === 'ArrowLeft') show(current - 1);
    });
    show(${initialSlide});
  </script>
</body>
</html>`;
}
