import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const API_BASE = (process.env.OPENATLAS_E2E_API_BASE || 'http://127.0.0.1:58003/api').replace(/\/$/, '');
const EMAIL = process.env.OPENATLAS_E2E_EMAIL || 'admin@demo.openatlas';
const PASSWORD = process.env.OPENATLAS_E2E_PASSWORD || 'openatlas';
const STRICT_MODEL = process.env.OPENATLAS_E2E_STRICT_MODEL === '1';

const DOCX_BASE64 =
  'UEsDBBQAAAAIAItbyFzJTxqw6wAAAK4BAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH1QvU7DMBDeeQrLK4odGBBCSTrwMwJDeYCTfUks7LPlc0v79jht6YAK4933q69b7YIXW8zsIvXyRrVSIJloHU29/Fi/NPdScAGy4CNhL/fIcjVcdet9QhZVTNzLuZT0oDWbGQOwigmpImPMAUo986QTmE+YUN+27Z02kQpSacriIYfuCUfY+CKed/V9LJLRsxSPR+KS1UtIyTsDpeJ6S/ZXSnNKUFV54PDsEl9XgtQXExbk74CT7q0uk51F8Q65vEKoLP0Vs9U2mk2oSvW/zYWecRydwbN+cUs5GmSukwevzkgARz/99WHu4RtQSwMEFAAAAAgAi1vIXLmBRHGwAAAAKgEAAAsAAABfcmVscy8ucmVsc43POw7CMAwG4J1TRN5pWgaEUJMuCKkrKgeIEjeNaB5KwqO3JwMDIAZG278/y233sDO5YUzGOwZNVQNBJ70yTjM4D8f1DkjKwikxe4cMFkzQ8VV7wlnkspMmExIpiEsMppzDntIkJ7QiVT6gK5PRRytyKaOmQciL0Eg3db2l8d0A/mGSXjGIvWqADEvAf2w/jkbiwcurRZd/nPhKFFlEjZnB3UdF1atdFRYob+nHi/wJUEsDBBQAAAAIAItbyFz8EH3t5wAAAAUBAAARAAAAd29yZC9kb2N1bWVudC54bWyzsa/IzVEoSy0qzszPs1Uy1DNQUkjNS85PycxLt1UKDXHTtVBSKC5JzEtJzMnPS7VVqkwtVrK347Ipt0rJTy7NTc0rUQCakFdsVW6rlFFSUmClr1+cnJGam1isl1+QmgeUS8svyk0sAXKL0vXL84tSCoryk1OLi4EW5OboGxkYmOnnJmbmKdkBjUzKT6kE0QUgoghElNj5B7j6OYb4OAbHu/g7R8S7GrnG+zoGebsGKTzZ0/hkx6xnXUufTux62tb6dN3Op9s3vVi0+ln/hKf90x43NNnogwwAkUVgsgBMQizRR3jADgBQSwECFAMUAAAACACLW8hcyU8asOsAAACuAQAAEwAAAAAAAAAAAAAAgAEAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLAQIUAxQAAAAIAItbyFy5gURxsAAAACoBAAALAAAAAAAAAAAAAACAARwBAABfcmVscy8ucmVsc1BLAQIUAxQAAAAIAItbyFz8EH3t5wAAAAUBAAARAAAAAAAAAAAAAACAAfUBAAB3b3JkL2RvY3VtZW50LnhtbFBLBQYAAAAAAwADALkAAAALAwAAAAA=';

async function api<T>(request: APIRequestContext, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, token?: string, data?: unknown): Promise<T> {
  const response = await request.fetch(`${API_BASE}${path}`, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    data,
    timeout: 60_000,
  });
  expect(response.ok(), `${method} ${path} -> ${response.status()} ${await response.text()}`).toBeTruthy();
  return response.status() === 204 ? (undefined as T) : await response.json();
}

async function loginApi(request: APIRequestContext) {
  const out = await api<any>(request, 'POST', '/auth/login', undefined, { email: EMAIL, password: PASSWORD });
  return out.access_token as string;
}

async function ensureEmployees(request: APIRequestContext, token: string) {
  const current = await api<{ items: any[] }>(request, 'GET', '/employees', token);
  if (current.items.length >= 2) return current.items.slice(0, 2);
  const created = [...current.items];
  while (created.length < 2) {
    const suffix = Date.now().toString().slice(-6) + created.length;
    created.push(await api<any>(request, 'POST', '/employees', token, {
      display_name: `E2E Employee ${suffix}`,
      avatar: created.length === 0 ? 'E' : 'R',
      description: 'Playwright E2E employee',
      system_prompt: 'You are a concise E2E employee.',
      toolsets: ['hermes-cli'],
    }));
  }
  return created.slice(0, 2);
}

async function loginUi(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('用户名').fill(EMAIL);
  await page.getByPlaceholder('密码').fill(PASSWORD);
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/overview/);
}

async function createTemplate(request: APIRequestContext, token: string, employee: any) {
  const session = await api<any>(request, 'POST', '/sessions', token, {
    employee_id: employee.id,
    title: `E2E Template Source ${Date.now()}`,
  });
  await api(request, 'PATCH', `/sessions/${session.id}/canvas-state`, token, {
    version: 1,
    nodes: [
      { id: 'user', type: 'agent', position: { x: 0, y: 0 }, data: { role: 'user', label: '用户' } },
      { id: `employee-${employee.id}`, type: 'agent', position: { x: 260, y: 0 }, data: { role: 'employee', label: employee.display_name, employeeId: employee.id, outputType: 'markdown' } },
    ],
    edges: [{ id: 'e-user-employee', source: 'user', target: `employee-${employee.id}`, mode: 'relay' }],
  });
  return api<any>(request, 'POST', `/sessions/${session.id}/save-template`, token, {
    name: `E2E Template ${Date.now()}`,
    description: 'Playwright template reuse fixture',
    category: 'e2e',
    visibility: 'private',
  });
}

test.describe('OpenAtlas main chain', () => {
  test('login, workbench message, DOCX upload, history restore, group relay, Skill binding, template reuse', async ({ page, request }) => {
    test.setTimeout(180_000);
    await page.addInitScript(() => {
      window.localStorage.setItem('atlas_show_test_fixtures', 'true');
    });
    const token = await loginApi(request);
    const [primary, relay] = await ensureEmployees(request, token);
    const template = await createTemplate(request, token, primary);

    await loginUi(page);

    await page.goto(`/overview?employee=${primary.id}`);
    const workbenchComposer = page.getByPlaceholder('跟 Atlas 说点什么…');
    await expect(workbenchComposer).toBeVisible();

    const docx = Buffer.from(DOCX_BASE64, 'base64');
    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'openatlas-e2e-report.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: docx,
    });
    await expect(page.getByText('openatlas-e2e-report.docx')).toBeVisible();

    const prompt = `OPENATLAS_E2E_WORKBENCH_${Date.now()}`;
    await workbenchComposer.fill(`请阅读附件并回复 ${prompt}`);
    await workbenchComposer.press('Enter');
    await expect(page.getByText(prompt)).toBeVisible();
    await expect(page.getByText(/已注入|extracted|uploaded|已上传/).first()).toBeVisible();
    if (STRICT_MODEL) {
      await expect(page.locator('.message-bubble').filter({ hasNotText: prompt }).last()).toBeVisible({ timeout: 60_000 });
    }
    const activeComposer = page.locator('textarea').last();
    await expect(activeComposer).toBeVisible({ timeout: 30_000 });
    await expect(activeComposer).toBeDisabled({ timeout: 10_000 }).catch(() => undefined);
    await expect(activeComposer).toBeEnabled({ timeout: 120_000 });

    const session = await api<any>(request, 'POST', '/sessions', token, {
      employee_id: primary.id,
      title: `E2E History ${Date.now()}`,
    });
    const historyStream = await request.post(`${API_BASE}/sessions/${session.id}/chat/stream`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { message: `E2E_HISTORY_${Date.now()}。请严格只输出 OK。` },
      timeout: 120_000,
    });
    expect(historyStream.ok()).toBeTruthy();
    await historyStream.text();
    await page.goto('/history?showTestFixtures=1');
    await expect(page.getByRole('heading', { name: '对话历史' })).toBeVisible();
    await page.getByText(session.title).first().click();
    await expect(page).toHaveURL(/\/overview/);

    const group = await api<any>(request, 'POST', '/sessions', token, {
      employee_id: primary.id,
      participant_ids: [relay.id],
      title: `E2E Group ${Date.now()}`,
    });
    const groupStream = await request.post(`${API_BASE}/sessions/${group.id}/chat/stream`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { message: `E2E_GROUP_RELAY_${Date.now()}。两位员工每人严格只输出 OK。`, relay_employee_ids: [relay.id] },
      timeout: 120_000,
    });
    expect(groupStream.ok()).toBeTruthy();
    const groupText = await groupStream.text();
    expect((groupText.match(/event: agent_join/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(groupText).toContain('speaker_employee_id');

    await page.goto(`/employee/${primary.id}`);
    await expect(page.getByText(primary.display_name).first()).toBeVisible();
    const beforeBindings = await api<{ items: any[] }>(request, 'GET', `/skill-bindings?target_type=employee&target_id=${primary.id}`, token);
    await page.getByRole('button', { name: '绑定 Skill' }).click();
    await page.getByRole('dialog', { name: '绑定市场 Skill' }).getByRole('button', { name: /绑\s*定/ }).click();
    await expect.poll(async () => {
      const after = await api<{ items: any[] }>(request, 'GET', `/skill-bindings?target_type=employee&target_id=${primary.id}`, token);
      return after.items.length;
    }).toBeGreaterThan(beforeBindings.items.length);

    await page.goto('/skill-market');
    await page.getByRole('button', { name: '浏览 Skills Hub' }).click();
    await expect(page.getByText('Hermes Skills Hub')).toBeVisible();

    const templatedSession = await api<any>(request, 'POST', `/collaboration-templates/${template.id}/sessions`, token, {
      title: `E2E Template Use ${Date.now()}`,
    });
    expect(templatedSession.reusable_template_id).toBe(template.id);
    await page.goto(`/overview?conversation=${templatedSession.id}`);
    await expect(page.locator('textarea')).toBeVisible();
  });
});
