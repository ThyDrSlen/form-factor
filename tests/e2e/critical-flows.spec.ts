import { test, expect } from '@playwright/test';
import { waitForAppLoad } from './utils/test-helpers';

test.describe('Critical User Flows', () => {
  test('web visitors are redirected to landing from root', async ({ page }) => {
    await page.goto('/');
    await waitForAppLoad(page);

    await expect(page).toHaveURL(/.*landing/);
    await expect(page.getByText('Real-time form coaching', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Get the app')).toBeVisible();
  });

  test('user can navigate from sign in to forgot password', async ({ page }) => {
    await page.goto('/sign-in');
    await waitForAppLoad(page);

    const forgotPasswordLink = page.getByText('Forgot password?');
    await expect(forgotPasswordLink).toBeVisible();
    await forgotPasswordLink.click();

    await expect(page).toHaveURL(/.*forgot-password/);
    await expect(page.getByText('Reset Password')).toBeVisible();
    await expect(page.getByText('Send Reset Link')).toBeVisible();
  });

  test('form validation shows errors for empty fields', async ({ page }) => {
    await page.goto('/forgot-password');
    await waitForAppLoad(page);

    await page.getByRole('textbox').first().fill('invalid-email');
    await page.getByText('Send Reset Link').click();

    await expect(page.getByText('Please enter a valid email address.')).toBeVisible();
  });
});
