import { test, expect } from '@playwright/test';

test.describe('Authentication Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/sign-in');
    await page.waitForSelector('text=Welcome back');
  });

  test('should display sign in form', async ({ page }) => {
    await expect(page.getByText('Welcome back')).toBeVisible();
    await expect(page.getByText('Sign in to your Form Factor account')).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByText('Continue with Google')).toBeVisible();
    await expect(page.getByText('Forgot your password?')).toBeVisible();
    await expect(page.getByText('Sign up', { exact: true })).toBeVisible();
  });

  test('should navigate to sign up page', async ({ page }) => {
    await page.getByText('Sign up', { exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
    await expect(page.getByText('Start tracking your form with Form Factor')).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByText('Sign in', { exact: true })).toBeVisible();
  });

  test('should navigate to forgot password page', async ({ page }) => {
    await page.getByText('Forgot your password?').click();
    await expect(page).toHaveURL(/.*forgot-password/);
    await expect(page.getByText('Reset your password')).toBeVisible();
    await expect(page.getByText("Enter your email and we'll send a reset link")).toBeVisible();
  });
});
