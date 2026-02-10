import { test, expect } from '@playwright/test';
import { waitForAppLoad } from './utils/test-helpers';

test.describe('Smoke Tests', () => {
  test('homepage loads without errors', async ({ page }) => {
    await page.goto('/');
    await waitForAppLoad(page);

    await expect(page).toHaveURL(/.*landing/);
    await expect(page.getByText('Real-time form coaching', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Get the iOS app').first()).toBeVisible();
  });

  test('page has required meta tags', async ({ page }) => {
    await page.goto('/landing');

    const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(viewport).toBeTruthy();
    
    const charset = await page.locator('meta[charset]').getAttribute('charset');
    expect(charset?.toLowerCase()).toBe('utf-8');
  });

  test('app responds to mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });

    await page.goto('/landing');
    await waitForAppLoad(page);

    const body = page.locator('body');
    await expect(body).toBeVisible();

    await expect(page.getByText('Get the iOS app').first()).toBeVisible();

    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + 1);
  });
});
