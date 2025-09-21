import { test, expect } from '@playwright/test';

test.describe('Authentication Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for the app to load
    await page.waitForSelector('text=Sign In');
  });

  test('should display sign in form', async ({ page }) => {
    // Verify sign in form is visible
    await expect(page.getByText('Welcome back!')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in with apple/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in with google/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /forgot password/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /sign up/i })).toBeVisible();
  });

  test('should navigate to sign up page', async ({ page }) => {
    // Test navigation to sign up
    await page.getByRole('link', { name: /sign up/i }).click();
    await expect(page).toHaveURL(/.*sign-up/);
    await expect(page.getByText('Create an account')).toBeVisible();
  });

  test('should navigate to forgot password page', async ({ page }) => {
    // Test navigation to forgot password
    await page.getByRole('link', { name: /forgot password/i }).click();
    await expect(page).toHaveURL(/.*forgot-password/);
    await expect(page.getByText('Reset your password')).toBeVisible();
  });
});
