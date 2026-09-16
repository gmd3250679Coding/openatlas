import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const API_BASE = (process.env.OPENATLAS_E2E_API_BASE || 'http://127.0.0.1:58003/api').replace(/\/$/, '');
const EMAIL = process.env.OPENATLAS_E2E_EMAIL || 'admin@demo.openatlas';
const PASSWORD = process.env.OPENATLAS_E2E_PASSWORD || 'openatlas';
const REPORT_PATH = path.resolve(process.cwd(), 'output/playwright/canvas-main-chain-report.md');

async function api<T>(
  request: APIRequestContext,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
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

async function ensureEmployees(request: APIRequestContext, token: string) {
  const current = await api<{ items: any[] }>(request, 'GET', '/employees', token);
  if (current.items.length >= 2) return current.items.slice(0, 2);
  const created = [...current.items];
  while (created.length < 2) {
    const suffix = Date.now().toString().slice(-6) + created.length;
    created.push(await api<any>(request, 'POST', '/employees', token, {
      display_name: `Canvas E2E Employee ${suffix}`,
      avatar: created.length === 0 ? 'C' : 'R',
      description: 'Playwright canvas main-chain employee',
      system_prompt: 'You are a concise collaboration canvas test employee.',
      toolsets: ['hermes-cli'],
    }));
  }
  return created.slice(0, 2);
}

function writeReport(lines: string[]) {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${lines.join('\n')}\n`, 'utf8');
}

test.describe('Collaboration canvas main chain', () => {
  test('home workbench exposes conversation rail and collaboration plan entry points', async ({ page, request }) => {
    test.setTimeout(120_000);
    const token = await loginApi(request);
    const cleanupSessions: string[] = [];
    const cleanupTemplates: string[] = [];

    try {
      const [primary, relay] = await ensureEmployees(request, token);
      const source = await api<any>(request, 'POST', '/sessions', token, {
        employee_id: primary.id,
        participant_ids: [relay.id],
        title: `E2E Home Plan Source ${Date.now()}`,
      });
      cleanupSessions.push(source.id);
      await api(request, 'PATCH', `/sessions/${source.id}/canvas-state`, token, {
        version: 1,
        nodes: [
          { id: 'user', type: 'agent', position: { x: 0, y: 0 }, data: { role: 'user', label: '用户' } },
          { id: `employee-${primary.id}`, type: 'agent', position: { x: 240, y: 0 }, data: { role: 'employee', label: primary.display_name, employeeId: primary.id, outputType: 'markdown' } },
          { id: `employee-${relay.id}`, type: 'agent', position: { x: 480, y: 0 }, data: { role: 'employee', label: relay.display_name, employeeId: relay.id, outputType: 'markdown' } },
        ],
        edges: [
          { id: 'e-user-primary', source: 'user', target: `employee-${primary.id}`, mode: 'relay' },
          { id: 'e-primary-relay', source: `employee-${primary.id}`, target: `employee-${relay.id}`, mode: 'relay' },
        ],
      });

      const planName = `E2E 首页协作方案 ${Date.now()}`;
      const template = await api<any>(request, 'POST', `/sessions/${source.id}/save-template`, token, {
        name: planName,
        description: 'E2E verifies homepage plan entry points.',
        category: 'e2e',
        visibility: 'private',
      });
      cleanupTemplates.push(template.id);

      await loginUi(page);
      await page.goto('/overview');
      await expect(page.getByRole('button', { name: '展开会话列表' })).toBeVisible();
      await page.getByRole('button', { name: '展开会话栏' }).click();
      await expect(page.getByRole('complementary').filter({ hasText: '会话' }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: '新建' })).toBeVisible();
      await expect(page.getByRole('button', { name: '群聊' })).toBeVisible();
      await page.getByRole('button', { name: '收起会话栏' }).click();

      await page.getByRole('button', { name: /创建会话/ }).click();
      await expect(page.getByRole('button', { name: /新建单聊/ })).toBeVisible();
      await expect(page.getByRole('button', { name: /新建群聊 \/ 作战室/ })).toBeVisible();
      await expect(page.getByRole('button', { name: /新建协作方案/ })).toBeVisible();
      await expect(page.getByRole('button', { name: /从方案库创建/ })).toBeVisible();

      await page.getByRole('button', { name: /从方案库创建/ }).click();
      const templateDialog = page.getByRole('dialog', { name: '协作方案库' });
      await expect(templateDialog).toBeVisible();
      const card = page.locator('[data-collab-template-card]').filter({ hasText: planName });
      await expect(card).toBeVisible();
      const useResponse = page.waitForResponse((response) => (
        response.url().includes(`/api/collaboration-templates/${template.id}/sessions`)
        && response.request().method() === 'POST'
      ));
      await card.getByRole('button', { name: '使用方案创建作战室' }).click();
      const createdFromTemplate = await (await useResponse).json();
      cleanupSessions.push(createdFromTemplate.id);
      await expect(page.getByText(`已载入协作方案「${planName}」`)).toBeVisible();
      await expect(page.getByText('协作画布').first()).toBeVisible();
      await expect(page.getByRole('button', { name: '保存为协作方案' })).toBeVisible();

      await page.reload();
      await expect(page).toHaveURL(/\/overview/);
      await page.getByRole('button', { name: /创建会话/ }).click();
      const draftResponse = page.waitForResponse((response) => (
        response.url().endsWith('/api/sessions') && response.request().method() === 'POST'
      ));
      await page.getByRole('button', { name: /新建协作方案/ }).click();
      const draft = await (await draftResponse).json();
      cleanupSessions.push(draft.id);
      await expect(page.getByText('已创建自定义编排草稿')).toBeVisible();
      await expect(page.getByText('协作画布').first()).toBeVisible();
      await expect(page.getByRole('button', { name: '保存为协作方案' })).toBeVisible();
    } finally {
      for (const tid of cleanupTemplates.reverse()) {
        await api(request, 'DELETE', `/collaboration-templates/${tid}`, token).catch(() => undefined);
      }
      for (const sid of cleanupSessions.reverse()) {
        await api(request, 'DELETE', `/sessions/${sid}`, token).catch(() => undefined);
      }
    }
  });

  test('open hub, configure node, save reusable collaboration plan, and verify persistence', async ({ page, request }) => {
    test.setTimeout(120_000);
    const report: string[] = [
      '# Canvas Main Chain Report',
      '',
      `- Time: ${new Date().toISOString()}`,
    ];

    await page.addInitScript(() => {
      window.localStorage.setItem('atlas_show_test_fixtures', 'true');
      window.localStorage.removeItem('atlas-canvas-hub-position');
    });

    const token = await loginApi(request);
    const [primary, relay] = await ensureEmployees(request, token);
    const session = await api<any>(request, 'POST', '/sessions', token, {
      employee_id: primary.id,
      participant_ids: [relay.id],
      title: `E2E Canvas Main ${Date.now()}`,
    });
    report.push(`- Created session: ${session.id}`);

    await loginUi(page);
    await page.goto(`/overview?conversation=${session.id}&showTestFixtures=1`);
    await expect(page.locator('textarea').last()).toBeVisible();

    const hubButton = page.locator('[data-m44-canvas-trigger]');
    await expect(hubButton).toBeVisible();
    await hubButton.click();
    await expect(page.locator('.atlas-canvas-hub.is-open')).toBeVisible();
    await expect(page.getByText('方案库')).toBeVisible();
    await expect(page.getByText('回放')).toBeVisible();
    report.push('- Hub opens with readable plan/replay actions.');

    await hubButton.click();
    await expect(page.getByText('协作画布').first()).toBeVisible();
    await expect(page.getByText('编排员工接力或并行协作，配置节点能力并保存复用')).toBeVisible();

    await page.getByRole('button', { name: '添加员工节点' }).click();
    await expect(page.locator('[data-m44-1-palette="true"]')).toBeVisible();
    await page.locator('[data-m44-1-palette-item]').first().click();

    const nodes = page.locator('.react-flow__node');
    await expect.poll(async () => await nodes.count()).toBeGreaterThanOrEqual(3);
    const panel = page.locator('[data-canvas-node-panel]');
    await expect(panel).toBeVisible();
    await panel.getByPlaceholder('document-extraction, financial-modeling').fill('document-extraction, financial-modeling');
    await panel.getByPlaceholder(/只对当前节点生效/).fill('读取用户 Query 与附件，输出 HTML 报告草稿，并标注需要人工确认的风险。');
    await panel.locator('select').nth(2).selectOption('html');
    await expect(page.locator('[data-m45-1-save-status="saved"]')).toBeVisible({ timeout: 15_000 });
    report.push('- Node panel supports skill, output type, prompt editing and autosaves.');

    const planName = `E2E 协作方案 ${Date.now()}`;
    await page.getByRole('button', { name: '保存为协作方案' }).click();
    const dialog = page.getByRole('dialog', { name: '保存/另存为可复用协作方案' });
    await expect(dialog).toBeVisible();
    await dialog.getByPlaceholder('例如：标书评审三员工接力').fill(planName);
    await dialog.getByPlaceholder('说明这个编排适合复用在哪些场景').fill('E2E 验证协作画布保存为可复用方案。');
    await dialog.getByRole('button', { name: '保存为方案' }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    await expect.poll(async () => {
      const rows = await api<{ items: any[] }>(request, 'GET', '/collaboration-templates', token);
      return rows.items.some((tpl) => tpl.name === planName);
    }, { timeout: 15_000 }).toBeTruthy();

    const templates = await api<{ items: any[] }>(request, 'GET', '/collaboration-templates', token);
    const tpl = templates.items.find((item) => item.name === planName);
    expect(tpl).toBeTruthy();
    expect(tpl.canvas_state?.nodes?.length || 0).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(tpl.canvas_state)).toContain('document-extraction');
    expect(JSON.stringify(tpl.canvas_state)).toContain('"outputType":"html"');
    report.push(`- Saved collaboration plan: ${tpl.id}`);

    await page.getByRole('button', { name: '关闭协作画布' }).click();
    await expect(page.getByRole('button', { name: '添加员工节点' })).toBeHidden();
    await hubButton.click();
    await page.getByLabel('打开协作方案库').click();
    await expect(page.getByRole('dialog', { name: '协作方案库' })).toBeVisible();
    await expect(page.getByText(planName)).toBeVisible();
    report.push('- Plan library shows the newly saved plan from the hub.');

    const createdFromPlan = await api<any>(request, 'POST', `/collaboration-templates/${tpl.id}/sessions`, token, {
      title: `E2E Canvas Plan Use ${Date.now()}`,
    });
    expect(createdFromPlan.reusable_template_id).toBe(tpl.id);
    const state = await api<any>(request, 'GET', `/sessions/${createdFromPlan.id}/canvas-state`, token);
    expect(state.nodes?.length || 0).toBeGreaterThanOrEqual(3);
    report.push(`- Reused plan created session: ${createdFromPlan.id}`);
    report.push('');
    report.push('Result: PASS');
    writeReport(report);

    await api(request, 'DELETE', `/collaboration-templates/${tpl.id}`, token).catch(() => undefined);
    await api(request, 'DELETE', `/sessions/${createdFromPlan.id}`, token).catch(() => undefined);
    await api(request, 'DELETE', `/sessions/${session.id}`, token).catch(() => undefined);
  });
});
