import { Page, expect } from '@playwright/test';

export async function waitForAppLoad(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
}

export async function expectElementToBeVisible(
  page: Page,
  selector: string,
  timeout = 5000
): Promise<void> {
  await expect(page.locator(selector)).toBeVisible({ timeout });
}

export async function takeScreenshot(page: Page, name: string): Promise<void> {
  await page.screenshot({
    path: `test-results/screenshots/${name}-${Date.now()}.png`,
    fullPage: true,
  });
}

export async function checkForConsoleErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];
  
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });
  
  return errors;
}
