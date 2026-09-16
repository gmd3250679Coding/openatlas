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
  const response = await request.fetch(`${API_BASE}${path}`, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    data,
    timeout: 90_000,
  });
  expect(response.ok(), `${method} ${path} -> ${response.status()} ${await response.text()}`).toBeTruthy();
  return response.status() === 204 ? (undefined as T) : await response.json();
}

async function loginApi(request: APIRequestContext) {
  const out = await api<any>(request, 'POST', '/auth/login', undefined, { email: EMAIL, password: PASSWORD });
  return out.access_token as string;
}

async function loginUi(page: Page) {
  await page.goto('/login');
  await page.locator('#atlas-auth_username').fill(EMAIL);
  await page.locator('#atlas-auth_password').fill(PASSWORD);
  await page.getByRole('button', { name: /进入 Atlas/ }).click();
  await expect(page).toHaveURL(/\/overview/);
}

async function ensureEmployee(request: APIRequestContext, token: string) {
  const current = await api<{ items: any[] }>(request, 'GET', '/employees', token);
  if (current.items.length > 0) return current.items[0];
  return api<any>(request, 'POST', '/employees', token, {
    display_name: `Admin Coverage ${Date.now()}`,
    avatar: '管',
    description: 'Admin coverage employee',
    system_prompt: 'You are a concise admin coverage employee.',
    toolsets: ['document-extraction'],
  });
}

test.describe('Hermes admin coverage UI', () => {
  test('Settings, Skill lifecycle, and History fork are reachable', async ({ page, request }) => {
    test.setTimeout(180_000);
    await page.addInitScript(() => {
      window.localStorage.setItem('atlas_show_test_fixtures', 'true');
    });
    const token = await loginApi(request);
    const employee = await ensureEmployee(request, token);

    await loginUi(page);

    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: '设置' })).toBeVisible();
    await page.getByRole('button', { name: '运维诊断' }).click();
    await expect(page.getByText('Hermes 运维诊断')).toBeVisible();
    await expect(page.getByText('doctor')).toBeVisible();
    await page.getByRole('button', { name: '工具治理' }).click();
    await expect(page.getByText('工具集治理')).toBeVisible();
    await expect(page.getByText('员工 Toolset 授权')).toBeVisible();

    await page.goto('/skill-market');
    await expect(page.getByRole('heading', { name: '技能市场 Skill Market' })).toBeVisible();
    await page.getByRole('button', { name: '生命周期' }).click();
    const lifecycleDialog = page.getByRole('dialog').filter({ hasText: 'Hermes Skill 生命周期' });
    await expect(lifecycleDialog).toBeVisible();
    await lifecycleDialog.getByRole('button', { name: 'Tap List' }).click();
    await expect(lifecycleDialog.locator('pre')).toContainText(/No custom taps|Using default sources|选择一个生命周期操作/, { timeout: 60_000 });

    const session = await api<any>(request, 'POST', '/sessions', token, {
      employee_id: employee.id,
      title: `E2E Fork UI ${Date.now()}`,
    });
    const stream = await request.post(`${API_BASE}/sessions/${session.id}/chat/stream`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { message: 'E2E_FORK_UI。请严格只输出 OK。' },
      timeout: 120_000,
    });
    expect(stream.ok()).toBeTruthy();
    await stream.text();

    await page.goto('/history?showTestFixtures=1');
    await expect(page.getByRole('heading', { name: '对话历史' })).toBeVisible();
    const row = page.locator('article').filter({ hasText: session.title });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: '分支' }).click();
    await expect(page).toHaveURL(/\/overview\?conversation=/, { timeout: 60_000 });
  });
});
