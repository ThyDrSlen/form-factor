import { test, expect } from '@playwright/test';
import { waitForAppLoad } from './utils/test-helpers';

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/landing');
    await waitForAppLoad(page);
  });

  test('main navigation labels are visible', async ({ page }) => {
    await expect(page.getByText('Form Factor', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Product', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Features', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Coach', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Roadmap', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Docs', { exact: true }).first()).toBeVisible();
  });

  test('footer content is visible on landing page', async ({ page }) => {
    await page.getByText('Built on Expo + Supabase').scrollIntoViewIfNeeded();
    await expect(page.getByText('Built on Expo + Supabase')).toBeVisible();
    await expect(page.getByText('Privacy', { exact: true })).toBeVisible();
    await expect(page.getByText('Terms', { exact: true })).toBeVisible();
  });

  test('hero actions are visible in mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/landing');
    await waitForAppLoad(page);

    await expect(page.getByText('Real-time form coaching', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Get the iOS app').first()).toBeVisible();
    await expect(page.getByText('See how it works')).toBeVisible();
  });
});
