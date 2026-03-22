import { test, expect } from '@playwright/test';
import { waitForAppLoad } from './utils/test-helpers';

test.describe('Critical User Flows', () => {
  test('web visitors land on the Next.js homepage from root', async ({ page }) => {
    await page.goto('/');
    await waitForAppLoad(page);

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: 'Real-time form coaching from your phone camera.' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Get started free' }).first()).toBeVisible();
  });

  test('user can navigate from sign in to forgot password', async ({ page }) => {
    await page.goto('/sign-in');
    await waitForAppLoad(page);

    const forgotPasswordLink = page.getByText('Forgot your password?');
    await expect(forgotPasswordLink).toBeVisible();
    await forgotPasswordLink.click();

    await expect(page).toHaveURL(/.*forgot-password/);
    await expect(page.getByText('Reset your password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send reset link' })).toBeVisible();
  });

  test('forgot password form uses email input and reset CTA', async ({ page }) => {
    await page.goto('/forgot-password');
    await waitForAppLoad(page);

    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Email')).toHaveAttribute('required', '');
    await expect(page.getByRole('button', { name: 'Send reset link' })).toBeVisible();
  });

  test('sign in form exposes the expected fields and submit action', async ({ page }) => {
    await page.goto('/sign-in');
    await waitForAppLoad(page);

    await expect(page.getByLabel('Email')).toHaveAttribute('required', '');
    await expect(page.getByLabel('Password')).toHaveAttribute('required', '');
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });

  test('forgot password keeps the submit action enabled for native form validation', async ({ page }) => {
    await page.goto('/forgot-password');
    await waitForAppLoad(page);

    await expect(page.getByRole('button', { name: 'Send reset link' })).toBeEnabled();
  });

  test('reset password route redirects unauthenticated web users to sign in', async ({ page }) => {
    await page.goto('/reset-password');
    await waitForAppLoad(page);

    await expect(page).toHaveURL(/.*sign-in/);
    await expect(page.getByText('Welcome back')).toBeVisible();
  });

  test('reset password route lands on the standard sign in copy', async ({ page }) => {
    await page.goto('/reset-password');
    await waitForAppLoad(page);

    await expect(page.getByText('Sign in to your Form Factor account')).toBeVisible();
  });

  test('reset password route keeps sign in actions available after redirect', async ({ page }) => {
    await page.goto('/reset-password');
    await waitForAppLoad(page);

    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });

  test('full auth navigation round-trip', async ({ page }) => {
    // Sign in → Sign up → Sign in → Forgot password → Back to sign in
    await page.goto('/sign-in');
    await waitForAppLoad(page);

    // Go to sign up
    await page.getByText('Sign up', { exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();

    // Back to sign in
    await page.getByText('Sign in', { exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();

    // Go to forgot password
    await page.getByText('Forgot your password?').click();
    await expect(page).toHaveURL(/.*forgot-password/);
    await expect(page.getByText('Reset your password')).toBeVisible();

    // Back to sign in
    await page.getByText('Sign in', { exact: true }).last().click();
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  });

  test('browser back from forgot-password returns to sign-in', async ({ page }) => {
    await page.goto('/sign-in');
    await waitForAppLoad(page);

    await page.getByText('Forgot your password?').click();
    await expect(page).toHaveURL(/.*forgot-password/);

    await page.goBack();
    await expect(page).toHaveURL(/.*sign-in/);

    await expect(page.getByText('Welcome back')).toBeVisible();
  });
});
