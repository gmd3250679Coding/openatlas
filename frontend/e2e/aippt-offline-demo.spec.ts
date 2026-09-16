import { expect, test } from '@playwright/test';

const BASE_URL = (process.env.OPENATLAS_E2E_BASE_URL || 'http://127.0.0.1:3381').replace(/\/$/, '');

test.describe('AIPPT offline demo shell', () => {
  test('runs without backend API calls and completes the local demo loop', async ({ page }) => {
    const apiRequests: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (url.includes('/api/')) apiRequests.push(url);
    });

    await page.goto(`${BASE_URL}/aippt-offline-demo`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Schema 驱动 AI PPT 离线演示' })).toBeVisible();
    await expect(page.locator('body')).toContainText('当前未连接后端');
    await expect(page.frameLocator('iframe[title="AIPPT offline HTML preview"]').locator('.slide')).toHaveCount(8);

    await page.getByRole('button', { name: 'Mock 生成' }).click();
    await expect(page.locator('body')).toContainText('Mock Agent 已生成 8 页 AIPPT Schema');

    await page.getByRole('button', { name: '保存版本' }).click();
    await expect(page.locator('.aippt-offline-version-list article')).toHaveCount(1);
    await expect(page.locator('body')).toContainText('Local Storage 已保存 v1');

    await page.getByRole('button', { name: '增强图表' }).click();
    await expect(page.locator('body')).toContainText('Mock Agent 已生成可审阅图表补丁');
    await expect(page.frameLocator('iframe[title="AIPPT offline HTML preview"]').locator('.slide-metrics').first()).toContainText('MockAipptAgentAdapter 示例数据');

    await page.getByRole('button', { name: '补资料' }).click();
    await expect(page.locator('body')).toContainText('Mock Research 已补充 1 条资料来源');

    await page.getByRole('button', { name: '保存版本' }).click();
    await expect(page.locator('.aippt-offline-version-list article')).toHaveCount(2);
    expect(apiRequests).toEqual([]);
  });
});
