import { test, expect } from '@playwright/test';
import { waitForAppLoad } from './utils/test-helpers';

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
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
    await page.getByText('Privacy', { exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByText('Support', { exact: true })).toBeVisible();
    await expect(page.getByText('Privacy', { exact: true })).toBeVisible();
    await expect(page.getByText('Terms', { exact: true })).toBeVisible();
  });

  test('hero actions are visible in mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await waitForAppLoad(page);

    await expect(page.getByText('Real-time form coaching', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Get started free' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign in' }).first()).toBeVisible();
  });

  test('landing page section headings are visible', async ({ page }) => {
    // "Built for lifters" section
    await page.getByText('Built for lifters').first().scrollIntoViewIfNeeded();
    await expect(page.getByText('Built for lifters').first()).toBeVisible();

    // "How it works" section
    await page.getByText('How it works', { exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByText('How it works', { exact: true })).toBeVisible();

    // "Feature deep dive" section
    await page.getByText('Feature deep dive').scrollIntoViewIfNeeded();
    await expect(page.getByText('Feature deep dive')).toBeVisible();

    // "Reliability and privacy" section
    await page.getByText('Reliability and privacy').scrollIntoViewIfNeeded();
    await expect(page.getByText('Reliability and privacy')).toBeVisible();

    // "Roadmap" section
    await page.getByText('Roadmap', { exact: true }).last().scrollIntoViewIfNeeded();
    await expect(page.getByText('What is coming next.')).toBeVisible();
  });

  test('feature cards are visible', async ({ page }) => {
    await page.getByText('Built for lifters').first().scrollIntoViewIfNeeded();

    await expect(page.getByText('Real-time cues')).toBeVisible();
    await expect(page.getByText('Auto logging')).toBeVisible();
    await expect(page.getByText('Health-aware coach')).toBeVisible();
  });

  test('how it works steps are visible', async ({ page }) => {
    await page.getByText('How it works', { exact: true }).scrollIntoViewIfNeeded();

    await expect(page.getByText('Point your camera')).toBeVisible();
    await expect(page.getByText('Get instant cues')).toBeVisible();
    await expect(page.getByText('Auto-log sets')).toBeVisible();
    await expect(page.getByText('Coach adjusts')).toBeVisible();
  });

  test('roadmap items are visible', async ({ page }) => {
    await page.getByText('What is coming next.').scrollIntoViewIfNeeded();

    await expect(page.getByText('Periodization planning')).toBeVisible();
    await expect(page.getByText('Progressive overload tracking')).toBeVisible();
    await expect(page.getByText('Goal-based templates')).toBeVisible();
    await expect(page.getByText('Android parity')).toBeVisible();
  });

  test('bottom CTA strip is visible', async ({ page }) => {
    await page.getByText('Ready for real-time form coaching?').scrollIntoViewIfNeeded();
    await expect(page.getByText('Ready for real-time form coaching?')).toBeVisible();
  });

  test('landing page hero trust badges are visible', async ({ page }) => {
    await expect(page.getByText('Offline-first logging', { exact: true })).toBeVisible();
    await expect(page.getByText('HealthKit-aware coach', { exact: true })).toBeVisible();
    await expect(page.getByText('ARKit rep detection', { exact: true })).toBeVisible();
  });
});
