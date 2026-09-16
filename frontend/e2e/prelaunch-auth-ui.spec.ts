import { expect, test } from '@playwright/test';

const DEMO_EMAIL = process.env.OPENATLAS_E2E_DEMO_EMAIL || 'Demo@demo.openatlas';
const DEMO_PASSWORD = process.env.OPENATLAS_E2E_PASSWORD || 'openatlas';

test.describe('prelaunch auth and entry experience', () => {
  test('login page visual shell, auth errors, persistence, and route guard', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('.atlas-auth-parade')).toBeVisible();
    await expect(page.locator('.atlas-auth-card')).toBeVisible();
    await expect(page.locator('.atlas-auth-card-pet')).toHaveCount(2);
    await expect(page.locator('.atlas-auth-tenant-select')).toContainText('Demo Tenant');
    await expect(page.getByText('登录 Atlas One')).toBeVisible();

    await page.getByRole('button', { name: '进入 Atlas' }).click();
    await expect(page.getByText('请输入用户名')).toBeVisible();
    await expect(page.getByText('请输入密码')).toBeVisible();

    await page.locator('#atlas-auth_username').fill(DEMO_EMAIL);
    await page.locator('#atlas-auth_password').fill('wrong-password');
    await page.getByRole('button', { name: '进入 Atlas' }).click();
    await expect(page.locator('.atlas-auth-error')).toContainText(/登录失败|Invalid|incorrect|unauthorized/i);

    await page.locator('#atlas-auth_password').fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: '进入 Atlas' }).click();
    await expect(page).toHaveURL(/\/overview/, { timeout: 20_000 });
    await expect(page.locator('.atlas-home, .atlas-workbench, body')).toBeVisible();

    await page.reload();
    await expect(page).toHaveURL(/\/overview/, { timeout: 20_000 });

    await page.evaluate(() => {
      localStorage.removeItem('openatlas_access_token');
      localStorage.removeItem('openatlas_refresh_token');
    });
    await page.goto('/workforce');
    await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
  });
});
