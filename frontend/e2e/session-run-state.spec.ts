import http from 'node:http';
import https from 'node:https';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const API_BASE = (process.env.OPENATLAS_E2E_API_BASE || 'http://127.0.0.1:58003/api').replace(/\/$/, '');
const EMAIL = process.env.OPENATLAS_E2E_EMAIL || 'admin@demo.openatlas';
const PASSWORD = process.env.OPENATLAS_E2E_PASSWORD || 'openatlas';

async function api<T>(
  request: APIRequestContext,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  token?: string,
  data?: unknown,
): Promise<T> {
  void request;
  const url = new URL(`${API_BASE}${path}`);
  const body = data === undefined ? undefined : JSON.stringify(data);
  const transport = url.protocol === 'https:' ? https : http;
  const response = await new Promise<{ status: number; text: string }>((resolve, reject) => {
    const req = transport.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 OpenAtlas-E2E',
          ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        timeout: 60_000,
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          text += chunk;
        });
        res.on('end', () => {
          resolve({ status: res.statusCode || 0, text });
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error(`${method} ${path} timed out`));
    });
    if (body) req.write(body);
    req.end();
  });
  expect(response.status >= 200 && response.status < 300, `${method} ${path} -> ${response.status} ${response.text}`).toBeTruthy();
  return response.status === 204 ? (undefined as T) : JSON.parse(response.text);
}

async function loginApi(request: APIRequestContext) {
  const out = await api<any>(request, 'POST', '/auth/login', undefined, { email: EMAIL, password: PASSWORD });
  return out.access_token as string;
}

async function loginUi(page: Page, token?: string) {
  await page.goto('/login');
  const usernameInput = page.locator('#atlas-auth_username');
  if (!(await usernameInput.isVisible({ timeout: 1_500 }).catch(() => false))) {
    const wakeSurface = page.getByText(/点击任意处唤醒|编排、协作、交付/).first();
    if (await wakeSurface.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await wakeSurface.click({ force: true });
    } else {
      await page.locator('body').click({ position: { x: 640, y: 360 }, force: true });
    }
  }
  if (!(await usernameInput.isVisible({ timeout: 2_000 }).catch(() => false)) && token) {
    await page.goto('/');
    await page.evaluate((value) => {
      window.localStorage.setItem('openatlas_access_token', value);
    }, token);
    await page.goto('/overview');
    await expect(page).toHaveURL(/\/overview/);
    return;
  }
  await expect(usernameInput).toBeVisible({ timeout: 10_000 });
  await usernameInput.fill(EMAIL);
  await page.locator('#atlas-auth_password').fill(PASSWORD);
  await page.getByRole('button', { name: /进入 Atlas/ }).click();
  await expect(page).toHaveURL(/\/overview/);
}

async function seedAuth(page: Page, token: string) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate((value) => {
    window.localStorage.setItem('openatlas_access_token', value);
    window.localStorage.setItem('atlas_show_test_fixtures', 'true');
  }, token);
}

function composer(page: Page) {
  return page.locator('.composer-textarea, textarea[placeholder*="发任务"], textarea[placeholder*="输入需求"], textarea[placeholder*="说点什么"]').last();
}

async function firstEmployee(request: APIRequestContext, token: string) {
  const employees = await api<{ items: any[] }>(request, 'GET', '/employees', token);
  const employee = employees.items.find((item: any) => item.status !== 'archived') || employees.items[0];
  expect(employee, 'demo tenant should have at least one employee').toBeTruthy();
  return employee;
}

async function employeeByName(request: APIRequestContext, token: string, name: RegExp) {
  const employees = await api<{ items: any[] }>(request, 'GET', '/employees', token);
  const employee = employees.items.find((item: any) => name.test(String(item.display_name || item.name || '')));
  expect(employee, `employee ${name} should exist`).toBeTruthy();
  return employee;
}

test.describe('session scoped run state', () => {
  test('running session input shows explicit queue/context/rerun choices and does not lock completed sessions', async ({ page, request }) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => {
      window.localStorage.setItem('atlas_show_test_fixtures', 'true');
    });
    const token = await loginApi(request);
    const employee = await firstEmployee(request, token);
    const cleanupSessions: string[] = [];

    try {
      const running = await api<any>(request, 'POST', '/sessions', token, {
        employee_id: employee.id,
        title: `E2E RunState Running ${Date.now()}`,
      });
      cleanupSessions.push(running.id);
      await api(request, 'PATCH', `/sessions/${running.id}/task-status`, token, { task_status: 'running' });

      const completed = await api<any>(request, 'POST', '/sessions', token, {
        employee_id: employee.id,
        title: `E2E RunState Completed ${Date.now()}`,
      });
      cleanupSessions.push(completed.id);
      await api(request, 'PATCH', `/sessions/${completed.id}/task-status`, token, { task_status: 'completed' });

      await seedAuth(page, token);

      await page.goto(`/overview?conversation=${running.id}&showTestFixtures=1`, { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(new RegExp(running.id));
      const runningComposer = composer(page);
      await expect(runningComposer).toBeVisible({ timeout: 20_000 });
      await runningComposer.fill('这是运行中会话的第二条输入，用来测试排队语义');
      await expect(runningComposer).toHaveValue('这是运行中会话的第二条输入，用来测试排队语义');
      await page.locator('.composer-send-btn').last().click();
      await expect(page.getByRole('dialog', { name: '当前会话仍在执行' })).toBeVisible();
      await expect(page.getByRole('button', { name: '排队执行' })).toBeVisible();
      await expect(page.getByRole('button', { name: '完成后补充上下文' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: '停止当前并重跑' })).toBeVisible();
      await page.getByRole('button', { name: '排队执行' }).click();
      await expect(page.getByText('已加入当前会话队列')).toBeVisible();

      await expect(page.getByRole('dialog', { name: '当前会话仍在执行' })).toHaveCount(0);
      const completedListItem = page.locator(`[data-session-id="${completed.id}"]`);
      if (!(await completedListItem.isVisible({ timeout: 2_000 }).catch(() => false))) {
        await page.getByRole('button', { name: /展开会话列表|会话/ }).click().catch(() => undefined);
      }
      await completedListItem.click();
      await expect(page).toHaveURL(new RegExp(completed.id));
      const completedComposer = composer(page);
      await expect(completedComposer).toBeVisible({ timeout: 20_000 });
      await expect(completedComposer).toBeEnabled();
      await expect(page.getByText('已加入当前会话队列')).toHaveCount(0);
      await expect(completedComposer).toHaveValue('');
      await completedComposer.fill('完成态会话的新输入不应弹出运行冲突');
      await expect(page.getByRole('dialog', { name: '当前会话仍在执行' })).toHaveCount(0);
    } finally {
      for (const sid of cleanupSessions.reverse()) {
        await api(request, 'DELETE', `/sessions/${sid}`, token).catch(() => undefined);
      }
    }
  });

  test('switching sessions resets active employee before dispatching the next turn', async ({ page, request }) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => {
      window.localStorage.setItem('atlas_show_test_fixtures', 'true');
    });
    const token = await loginApi(request);
    const receptionist = await employeeByName(request, token, /行政小六/);
    const market = await employeeByName(request, token, /市场竞品研究员/);
    const cleanupSessions: string[] = [];
    let capturedBody: any = null;
    let capturedUrl = '';

    try {
      const marketSession = await api<any>(request, 'POST', '/sessions', token, {
        employee_id: market.id,
        title: `E2E Active Employee Market ${Date.now()}`,
      });
      cleanupSessions.push(marketSession.id);
      const receptionistSession = await api<any>(request, 'POST', '/sessions', token, {
        employee_id: receptionist.id,
        title: `E2E Active Employee Receptionist ${Date.now()}`,
      });
      cleanupSessions.push(receptionistSession.id);

      await page.route('**/api/sessions/*/chat/stream', async (route) => {
        capturedUrl = route.request().url();
        capturedBody = JSON.parse(route.request().postData() || '{}');
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: 'event: openatlas.done\ndata: {"done":true}\n\n',
        });
      });

      await seedAuth(page, token);
      await page.goto(`/overview?conversation=${marketSession.id}&showTestFixtures=1`, { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(new RegExp(marketSession.id));
      await expect.poll(
        async () => await page.locator('body').innerText().catch(() => ''),
        { timeout: 30_000 },
      ).toMatch(/工作台|Atlas/);
      await page.goto(`/overview?conversation=${receptionistSession.id}&showTestFixtures=1`, { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(new RegExp(receptionistSession.id));
      const receptionistComposer = composer(page);
      await expect(receptionistComposer).toBeVisible({ timeout: 20_000 });
      await receptionistComposer.fill('你好，介绍一下你自己');
      await page.locator('.composer-send-btn').last().click();
      await expect.poll(() => capturedUrl, { timeout: 20_000 }).toContain(receptionistSession.id);
      expect(capturedBody?.primary_employee_id).toBe(receptionist.id);
      expect(capturedBody?.primary_employee_id).not.toBe(market.id);
    } finally {
      for (const sid of cleanupSessions.reverse()) {
        await api(request, 'DELETE', `/sessions/${sid}`, token).catch(() => undefined);
      }
    }
  });

  test('group conversation delete accepts the real session UUID and does not 404', async ({ page, request }) => {
    test.setTimeout(120_000);
    void page;
    const token = await loginApi(request);
    const receptionist = await employeeByName(request, token, /行政小六/);
    const market = await employeeByName(request, token, /市场竞品研究员/);

    const group = await api<any>(request, 'POST', '/sessions', token, {
      employee_id: receptionist.id,
      title: `E2E Delete Group ${Date.now()}`,
      participant_ids: [market.id],
    });
    expect(group.id).toMatch(/[0-9a-f-]{36}/);
    const deleted = await api<any>(request, 'DELETE', `/sessions/${group.id}`, token);
    expect(deleted.ok).toBe(true);
    expect(deleted.id).toBe(group.id);
  });
});
