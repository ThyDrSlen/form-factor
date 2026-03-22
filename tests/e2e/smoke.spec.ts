import { test, expect } from '@playwright/test';
import { waitForAppLoad } from './utils/test-helpers';

test.describe('Smoke Tests', () => {
  test('homepage loads without errors', async ({ page }) => {
    await page.goto('/');
    await waitForAppLoad(page);

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: 'Real-time form coaching from your phone camera.' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Get started free' }).first()).toBeVisible();
  });

  test('page has required meta tags', async ({ page }) => {
    await page.goto('/');

    const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(viewport).toBeTruthy();
    
    const charset = await page.locator('meta[charset]').getAttribute('charset');
    expect(charset?.toLowerCase()).toBe('utf-8');
  });

  test('app responds to mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });

    await page.goto('/');
    await waitForAppLoad(page);

    const body = page.locator('body');
    await expect(body).toBeVisible();

    await expect(page.getByRole('link', { name: 'Get started free' }).first()).toBeVisible();

    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + 1);
  });

  test('app responds to tablet viewport', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });

    await page.goto('/');
    await waitForAppLoad(page);

    await expect(page.getByRole('heading', { name: 'Real-time form coaching from your phone camera.' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Get started free' }).first()).toBeVisible();

    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + 1);
  });

  test('app responds to large desktop viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });

    await page.goto('/');
    await waitForAppLoad(page);

    await expect(page.getByRole('heading', { name: 'Real-time form coaching from your phone camera.' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Get started free' }).first()).toBeVisible();

    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + 1);
  });
});
