import { test, expect } from '@playwright/test';

test.describe('Authentication Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/sign-in');
    await page.waitForSelector('text=Welcome to Form Factor');
  });

  test('should display sign in form', async ({ page }) => {
    await expect(page.getByText('Welcome to Form Factor')).toBeVisible();
    await expect(page.getByPlaceholder('Email')).toBeVisible();
    await expect(page.getByPlaceholder('Password')).toBeVisible();
    await expect(page.getByText('Log In', { exact: true })).toBeVisible();
    await expect(page.getByText('Continue with Google')).toBeVisible();
    await expect(page.getByText('Forgot password?')).toBeVisible();
    await expect(page.getByText('Sign up', { exact: true })).toBeVisible();
  });

  test('should navigate to sign up page', async ({ page }) => {
    await page.getByText('Sign up', { exact: true }).click();
    await expect(page.getByText('Create Account')).toBeVisible();
    await expect(page.getByPlaceholder('Full Name')).toBeVisible();
    await expect(page.getByText('Sign in', { exact: true })).toBeVisible();
  });

  test('should navigate to forgot password page', async ({ page }) => {
    await page.getByText('Forgot password?').click();
    await expect(page).toHaveURL(/.*forgot-password/);
    await expect(page.getByText('Reset Password')).toBeVisible();
    await expect(page.getByText("Enter your email address and we'll send you a link to reset your password.")).toBeVisible();
  });
});
