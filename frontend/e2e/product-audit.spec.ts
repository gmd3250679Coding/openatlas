import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const API_BASE = (process.env.OPENATLAS_E2E_API_BASE || 'http://127.0.0.1:58003/api').replace(/\/$/, '');
const EMAIL = process.env.OPENATLAS_E2E_EMAIL || 'admin@demo.openatlas';
const PASSWORD = process.env.OPENATLAS_E2E_PASSWORD || 'openatlas';
const DEEP = process.env.OPENATLAS_AUDIT_DEEP === '1';
const OUT_DIR = path.resolve(process.cwd(), '../output/playwright');
const SHOT_DIR = path.join(OUT_DIR, 'screenshots');

type Severity = 'P0' | 'P1' | 'P2' | 'P3';
type Issue = {
  severity: Severity;
  area: string;
  title: string;
  detail: string;
  evidence?: string;
  url?: string;
};

type RouteCheck = {
  path: string;
  name: string;
  expectText: RegExp;
  minTextLength?: number;
};

const routes: RouteCheck[] = [
  { path: '/overview', name: '工作台', expectText: /Atlas|王六|工作台|跟 Atlas 说点什么/, minTextLength: 120 },
  { path: '/workforce', name: '数智员工', expectText: /数智员工|创建|搜索/, minTextLength: 120 },
  { path: '/jobs', name: '自动任务', expectText: /任务|新建任务|暂无任务/, minTextLength: 80 },
  { path: '/skills', name: '技能中心', expectText: /技能中心|Skills|scope/, minTextLength: 80 },
  { path: '/memory', name: '记忆中心', expectText: /Memory|记忆|新建/, minTextLength: 80 },
  { path: '/dashboard', name: 'Dashboard', expectText: /Dashboard|Token|会话|员工|失败率/, minTextLength: 120 },
  { path: '/identity', name: '组织权限', expectText: /组织|租户|用户|权限/, minTextLength: 120 },
  { path: '/skill-market', name: '技能市场', expectText: /技能市场|Skill Market|Skills Hub/, minTextLength: 120 },
  { path: '/audit', name: '审计日志', expectText: /审计|Audit|resource|action/, minTextLength: 100 },
  { path: '/history', name: '对话历史', expectText: /对话历史|搜索对话|历史/, minTextLength: 80 },
  { path: '/settings', name: '设置', expectText: /设置|Hermes|工具|运维/, minTextLength: 120 },
];

async function api<T>(
  request: APIRequestContext,
  method: 'GET' | 'POST',
  apiPath: string,
  token?: string,
  data?: unknown,
): Promise<{ ok: boolean; status: number; body: T | string }> {
  const response = await request.fetch(`${API_BASE}${apiPath}`, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    data,
    timeout: 30_000,
  });
  const text = await response.text();
  let body: T | string = text;
  try {
    body = text ? JSON.parse(text) : '';
  } catch {
    body = text;
  }
  return { ok: response.ok(), status: response.status(), body };
}

async function loginUi(page: Page, issues: Issue[]) {
  await page.goto('/login');
  const usernameInput = page.locator('#atlas-auth_username');
  const wakeLogin = page.getByRole('button', { name: '唤醒登录' });
  if (!(await usernameInput.isVisible({ timeout: 1_500 }).catch(() => false))) {
    await wakeLogin.click({ force: true, timeout: 15_000 });
  }
  await expect(usernameInput).toBeVisible({ timeout: 10_000 });
  await usernameInput.fill(EMAIL);
  await page.locator('#atlas-auth_password').fill(PASSWORD);
  await page.getByRole('button', { name: /进入 Atlas/ }).click();
  try {
    await expect(page).toHaveURL(/\/overview/, { timeout: 20_000 });
  } catch {
    issues.push({
      severity: 'P0',
      area: '登录',
      title: '登录后没有进入工作台',
      detail: `使用 ${EMAIL} 登录后 URL 仍为 ${page.url()}`,
      url: page.url(),
    });
  }
}

async function loginApi(request: APIRequestContext, issues: Issue[]) {
  const res = await api<any>(request, 'POST', '/auth/login', undefined, { email: EMAIL, password: PASSWORD });
  if (!res.ok || typeof res.body === 'string' || !res.body.access_token) {
    issues.push({
      severity: 'P0',
      area: 'API/Auth',
      title: 'API 登录失败',
      detail: `POST /auth/login -> ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`,
    });
    return '';
  }
  return String(res.body.access_token);
}

function pushUnique(issues: Issue[], next: Issue) {
  const key = `${next.severity}|${next.area}|${next.title}|${next.detail}`;
  if (!issues.some((i) => `${i.severity}|${i.area}|${i.title}|${i.detail}` === key)) {
    issues.push(next);
  }
}

async function collectPageHealth(page: Page, route: RouteCheck, issues: Issue[]) {
  const url = page.url();
  const shotName = `${route.path.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'root'}.png`;
  const shotPath = path.join(SHOT_DIR, shotName);
  await page.screenshot({ path: shotPath, fullPage: true });

  const text = (await page.locator('body').innerText().catch(() => '')).trim();
  if (!route.expectText.test(text)) {
    pushUnique(issues, {
      severity: 'P1',
      area: route.name,
      title: '页面核心文案缺失或未加载',
      detail: `未匹配 ${route.expectText}; body 文本前 160 字: ${text.slice(0, 160)}`,
      evidence: shotPath,
      url,
    });
  }
  if (text.length < (route.minTextLength || 80)) {
    pushUnique(issues, {
      severity: 'P1',
      area: route.name,
      title: '页面内容过少，疑似空状态/加载失败',
      detail: `body 文本长度 ${text.length}`,
      evidence: shotPath,
      url,
    });
  }

  const errorText = await page
    .locator('body')
    .getByText(/missing bearer token|Unauthorized|Network Error|Failed to fetch|加载失败|请求失败|异常|Traceback|Cannot read/i)
    .allTextContents()
    .catch(() => []);
  for (const item of errorText.slice(0, 5)) {
    pushUnique(issues, {
      severity: /missing bearer token|Unauthorized|Traceback|Cannot read/i.test(item) ? 'P0' : 'P1',
      area: route.name,
      title: '页面出现错误提示',
      detail: item.slice(0, 300),
      evidence: shotPath,
      url,
    });
  }

  const metrics = await page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const overflowX = Math.max(doc.scrollWidth, body.scrollWidth) - window.innerWidth;
    const isVisibleInteractive = (el: Element) => {
      const rect = (el as HTMLElement).getBoundingClientRect();
      const style = window.getComputedStyle(el as HTMLElement);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        !el.closest('[aria-hidden="true"]') &&
        !(el as HTMLButtonElement).disabled &&
        el.getAttribute('tabindex') !== '-1'
      );
    };
    const hasAccessibleName = (b: HTMLButtonElement) =>
      !!(
        b.textContent?.trim() ||
        b.getAttribute('aria-label') ||
        b.getAttribute('title') ||
        b.querySelector('[aria-label], [title]')
      );
    const buttons = Array.from(document.querySelectorAll('button')).filter(isVisibleInteractive);
    const iconButtonsWithoutName = buttons
      .filter((b) => !hasAccessibleName(b as HTMLButtonElement))
      .map((b) => (b.outerHTML || '').slice(0, 120));
    const tinyText = Array.from(document.querySelectorAll('button, [role="button"]'))
      .filter((el) => {
        if (!isVisibleInteractive(el)) return false;
        const rect = (el as HTMLElement).getBoundingClientRect();
        return rect.width < 24 || rect.height < 24;
      })
      .map((el) => (el.outerHTML || '').slice(0, 120));
    const stuckSpinners = Array.from(document.querySelectorAll('.ant-spin-spinning, .ant-skeleton, [aria-busy="true"]')).length;
    return { overflowX, iconButtonsWithoutName, tinyText, stuckSpinners };
  });
  if (metrics.overflowX > 8) {
    pushUnique(issues, {
      severity: 'P2',
      area: route.name,
      title: '页面存在横向溢出',
      detail: `scrollWidth 比视口宽 ${Math.round(metrics.overflowX)}px，可能导致小屏错位。`,
      evidence: shotPath,
      url,
    });
  }
  if (metrics.iconButtonsWithoutName.length) {
    pushUnique(issues, {
      severity: 'P2',
      area: route.name,
      title: '存在无可访问名称的图标按钮',
      detail: metrics.iconButtonsWithoutName.slice(0, 3).join('\n'),
      evidence: shotPath,
      url,
    });
  }
  if (metrics.tinyText.length) {
    pushUnique(issues, {
      severity: 'P3',
      area: route.name,
      title: '存在点击热区小于 24px 的控件',
      detail: metrics.tinyText.slice(0, 3).join('\n'),
      evidence: shotPath,
      url,
    });
  }
  if (metrics.stuckSpinners > 0) {
    pushUnique(issues, {
      severity: 'P2',
      area: route.name,
      title: '页面可能存在未结束的 loading/skeleton 状态',
      detail: `检测到 ${metrics.stuckSpinners} 个 loading/skeleton/busy 元素。`,
      evidence: shotPath,
      url,
    });
  }
}

async function smokeApis(request: APIRequestContext, token: string, issues: Issue[]) {
  const endpoints = [
    '/auth/me',
    '/employees',
    '/sessions',
    '/run-queue',
    '/dashboard/me',
    '/dashboard/tenant',
    '/runtime/status',
    '/capabilities',
    '/models',
    '/skill-market',
    '/memories',
    '/jobs',
    '/audit',
    '/admin/identity/overview',
  ];
  for (const endpoint of endpoints) {
    const res = await api<any>(request, 'GET', endpoint, token);
    if (!res.ok) {
      pushUnique(issues, {
        severity: res.status >= 500 ? 'P0' : 'P1',
        area: 'API Smoke',
        title: `${endpoint} 返回异常`,
        detail: `HTTP ${res.status}: ${JSON.stringify(res.body).slice(0, 400)}`,
      });
    }
  }
}

async function probeWorkbench(page: Page, issues: Issue[]) {
  await page.goto('/overview');
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  const composer = page.getByPlaceholder('跟 Atlas 说点什么…');
  if (!(await composer.isVisible().catch(() => false))) {
    pushUnique(issues, {
      severity: 'P0',
      area: '工作台',
      title: '首页输入框不可见',
      detail: '用户无法从首页直接发起任务。',
      url: page.url(),
    });
    return;
  }
  const dockButtons = await page.locator('.atlas-agent-card, .atlas-agent-action, button[title*="员工"], button[title*="群聊"], button[title*="编排"]').count();
  if (dockButtons < 3) {
    pushUnique(issues, {
      severity: 'P2',
      area: '工作台',
      title: '员工 Dock/快捷入口数量偏少或选择器不可识别',
      detail: `检测到 ${dockButtons} 个候选入口。`,
      url: page.url(),
    });
  }
  const historyLink = await page.getByText(/全部历史|对话历史/).count();
  if (historyLink === 0) {
    pushUnique(issues, {
      severity: 'P1',
      area: '工作台',
      title: '首页缺少明显的历史入口',
      detail: '业务用户无法快速回到历史会话。',
      url: page.url(),
    });
  }
  if (DEEP) {
    const prompt = `OPENATLAS_AUDIT_${Date.now()} 请只回复 OK`;
    await composer.fill(prompt);
    await composer.press('Enter');
    await page.waitForTimeout(8_000);
    const body = await page.locator('body').innerText();
    if (!body.includes(prompt)) {
      pushUnique(issues, {
        severity: 'P0',
        area: '工作台聊天',
        title: '发送后用户消息未展示',
        detail: '输入消息后页面没有出现用户发送内容。',
        url: page.url(),
      });
    }
    if (/本轮已停止等待|超过 60 秒没有新事件/.test(body)) {
      pushUnique(issues, {
        severity: 'P0',
        area: '工作台聊天',
        title: '仍出现旧的 60 秒硬超时文案',
        detail: '这说明当前页面/服务仍可能在跑旧链路，或 Run Events 空窗仍被写进模型正文。',
        url: page.url(),
      });
    }
  }
}

async function probeDialogs(page: Page, issues: Issue[]) {
  const maybeButtons = [
    { selector: 'button[title*="自定义 Dock"], button:has-text("自定义 Dock"), button:has-text("全部员工")', label: '自定义 Dock / 全部员工', area: '工作台 Dock' },
    { selector: 'button[title*="创建多员工群聊"], button:has-text("多员工群聊")', label: '多员工群聊', area: '群聊入口' },
    { selector: 'button[title*="编排数智员工"], button:has-text("自定义编排"), button:has-text("协作画布")', label: '编排数智员工 / 协作画布', area: '协作画布入口' },
    { selector: 'button[title*="编排模板库"], button:has-text("模板库")', label: '模板库 / 编排模板库', area: '模板库入口' },
  ];
  for (const item of maybeButtons) {
    await page.goto('/overview');
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
    const btn = page.locator(item.selector).first();
    if (!(await btn.isVisible().catch(() => false))) {
      pushUnique(issues, {
        severity: 'P2',
        area: item.area,
        title: '入口不可见或可访问名称不稳定',
        detail: `未找到入口 ${item.label}`,
        url: page.url(),
      });
      continue;
    }
    await btn.click().catch(() => undefined);
    await page.waitForTimeout(500);
    const hasDialog = (await page.locator('.ant-modal, .ant-drawer').count()) > 0;
    if (!hasDialog && !/协作|员工|模板|群聊/.test(await page.locator('body').innerText())) {
      pushUnique(issues, {
        severity: 'P2',
        area: item.area,
        title: '点击入口后没有明显反馈',
        detail: `入口 ${item.label} 点击后未检测到 modal/drawer 或页面反馈。`,
        url: page.url(),
      });
    }
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.waitForTimeout(1200);
  }
}

function writeReport(issues: Issue[]) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const sorted = [...issues].sort((a, b) => ['P0', 'P1', 'P2', 'P3'].indexOf(a.severity) - ['P0', 'P1', 'P2', 'P3'].indexOf(b.severity));
  const counts = sorted.reduce<Record<Severity, number>>((acc, item) => {
    acc[item.severity] += 1;
    return acc;
  }, { P0: 0, P1: 0, P2: 0, P3: 0 });
  const lines = [
    '# OpenAtlas Playwright 产品巡检报告',
    '',
    `生成时间: ${new Date().toISOString()}`,
    `目标前端: ${process.env.OPENATLAS_E2E_BASE_URL || 'http://127.0.0.1:3381'}`,
    `目标 API: ${API_BASE}`,
    `深度模式: ${DEEP ? '开启' : '关闭'}`,
    '',
    `问题统计: P0=${counts.P0}, P1=${counts.P1}, P2=${counts.P2}, P3=${counts.P3}`,
    '',
    '## 问题清单',
    '',
  ];
  if (!sorted.length) {
    lines.push('未发现自动化规则可识别的问题。');
  }
  sorted.forEach((issue, index) => {
    lines.push(`### ${index + 1}. [${issue.severity}] ${issue.area} - ${issue.title}`);
    lines.push('');
    lines.push(issue.detail);
    if (issue.url) lines.push(`URL: ${issue.url}`);
    if (issue.evidence) lines.push(`截图: ${path.relative(OUT_DIR, issue.evidence)}`);
    lines.push('');
  });
  lines.push('## 巡检覆盖');
  lines.push('');
  lines.push('- 登录 UI + API 登录');
  lines.push('- API smoke: auth、employees、sessions、runtime、dashboard、skills、memory、jobs、audit、identity');
  lines.push('- 页面巡检: 工作台、员工、任务、技能、记忆、Dashboard、组织权限、技能市场、审计、历史、设置');
  lines.push('- 工作台可用性: 输入框、历史入口、员工快捷入口、关键弹窗入口');
  lines.push('- 体验规则: 空页面、错误文案、横向溢出、无可访问名称图标按钮、小点击热区、卡住的 loading');
  lines.push('');
  fs.writeFileSync(path.join(OUT_DIR, 'product-audit-report.md'), lines.join('\n'), 'utf-8');
}

test.describe('OpenAtlas product audit', () => {
  test('collect functional, usability, and experience issues', async ({ page, request }) => {
    test.setTimeout(240_000);
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    const issues: Issue[] = [];
    const consoleMessages: Issue[] = [];

    page.on('console', (msg) => {
      if (['error', 'warning'].includes(msg.type())) {
        consoleMessages.push({
          severity: msg.type() === 'error' ? 'P1' : 'P3',
          area: '浏览器控制台',
          title: `${msg.type()} 日志`,
          detail: msg.text().slice(0, 500),
          url: page.url(),
        });
      }
    });
    page.on('pageerror', (err) => {
      pushUnique(issues, {
        severity: 'P0',
        area: '前端运行时',
        title: '页面抛出未捕获异常',
        detail: String(err).slice(0, 800),
        url: page.url(),
      });
    });
    page.on('requestfailed', (req) => {
      const failure = req.failure()?.errorText || 'unknown';
      if (failure === 'net::ERR_ABORTED') return;
      pushUnique(issues, {
        severity: 'P1',
        area: '网络请求',
        title: '请求失败',
        detail: `${req.method()} ${req.url()} -> ${failure}`,
        url: page.url(),
      });
    });
    page.on('response', (res) => {
      const status = res.status();
      const url = res.url();
      if (status >= 500 || (status >= 400 && url.includes('/api/'))) {
        pushUnique(issues, {
          severity: status >= 500 ? 'P0' : 'P1',
          area: '网络响应',
          title: `HTTP ${status}`,
          detail: url,
          url: page.url(),
        });
      }
    });

    const token = await loginApi(request, issues);
    if (token) await smokeApis(request, token, issues);

    await loginUi(page, issues);
    await probeWorkbench(page, issues);
    await probeDialogs(page, issues);

    for (const route of routes) {
      await page.goto(route.path);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(1200);
      await collectPageHealth(page, route, issues);
    }

    for (const issue of consoleMessages) {
      if (!/favicon|ResizeObserver loop|Download the React DevTools/i.test(issue.detail)) {
        pushUnique(issues, issue);
      }
    }

    writeReport(issues);
    expect(fs.existsSync(path.join(OUT_DIR, 'product-audit-report.md'))).toBeTruthy();
  });
});
