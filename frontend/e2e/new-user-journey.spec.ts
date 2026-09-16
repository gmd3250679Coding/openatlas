import { expect, test, type Page, type APIRequestContext } from '@playwright/test';

const API_BASE = (process.env.OPENATLAS_E2E_API_BASE || 'http://127.0.0.1:58003/api').replace(/\/$/, '');
const PASSWORD = process.env.OPENATLAS_E2E_PASSWORD || 'openatlas';

async function tokenFromPage(page: Page): Promise<string> {
  return page.evaluate(() => localStorage.getItem('openatlas_access_token') || '');
}

async function api(request: APIRequestContext, method: string, path: string, token?: string, body?: unknown) {
  const response = await request.fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    data: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { response, json };
}

test.describe('new ordinary user journey', () => {
  test('register, browse allowed surfaces, and verify non-admin guardrails', async ({ page, request }) => {
    const suffix = Date.now().toString(36);
    const email = `playwright-${suffix}@demo.openatlas`;

    await page.goto('/login');
    await expect(page.locator('.atlas-auth-parade')).toBeVisible();
    await expect(page.locator('.atlas-auth-tenant-select')).toBeVisible();
    await page.getByRole('button', { name: '开放注册' }).click();
    await page.locator('#atlas-auth_username').fill(email);
    await page.locator('#atlas-auth_password').fill(PASSWORD);
    await page.getByRole('button', { name: /注册并进入 Atlas/ }).click();
    await expect(page).toHaveURL(/\/overview/, { timeout: 20_000 });
    await expect(page.getByText(`你好，${email.split('@')[0]}`, { exact: false })).toBeVisible({ timeout: 20_000 });

    const token = await tokenFromPage(page);
    expect(token).toBeTruthy();

    await expect(page.getByRole('link', { name: /Dashboard/ })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /审计日志/ })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /组织权限/ })).toHaveCount(0);

    const dockCards = page.locator('.atlas-agent-card');
    await expect(dockCards.first()).toBeVisible({ timeout: 20_000 });
    const dockCount = await dockCards.count();
    expect(dockCount).toBeGreaterThan(0);
    expect(dockCount).toBeLessThanOrEqual(6);
    await expect(page.locator('.atlas-canvas-hub:not(.is-open) .atlas-canvas-hub-action')).toHaveCount(0);

    await page.goto('/workforce');
    await expect(page).toHaveURL(/\/workforce/);
    await expect(page.locator('.id-badge').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.id-badge-dismiss')).toHaveCount(0);
    await expect(page.getByText('只读配置').first()).toBeVisible();

    const employees = await api(request, 'GET', '/employees', token);
    expect(employees.response.ok()).toBeTruthy();
    const firstEmployee = employees.json.items?.[0];
    expect(firstEmployee?.id).toBeTruthy();

    const dismiss = await api(request, 'DELETE', `/employees/${firstEmployee.id}`, token);
    expect(dismiss.response.status()).toBe(403);

    const created = await api(request, 'POST', '/employees', token, {
      display_name: `UI Journey ${suffix}`,
      description: 'Created by Playwright ordinary-user journey.',
      avatar: 'J',
      toolsets: ['file'],
      system_prompt: 'You are a concise UI journey employee.',
    });
    expect(created.response.ok()).toBeTruthy();
    expect(created.json.display_name).toContain('UI Journey');

    const dismissOwn = await api(request, 'DELETE', `/employees/${created.json.id}`, token);
    expect(dismissOwn.response.status()).toBe(403);
  });
});
