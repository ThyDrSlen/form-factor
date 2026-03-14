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

    await page.getByTestId('forgot-password-email-input').fill('invalid-email');
    await page.getByTestId('forgot-password-submit-button').click();

    await expect(page.getByText('Please enter a valid email address.')).toBeVisible();
  });

  test('sign in shows error on empty submit', async ({ page }) => {
    await page.goto('/sign-in');
    await waitForAppLoad(page);

    await page.getByText('Log In', { exact: true }).click();

    await expect(page.getByText('Please fill in all fields')).toBeVisible();
  });

  test('forgot password keeps submit disabled when email is empty', async ({ page }) => {
    await page.goto('/forgot-password');
    await waitForAppLoad(page);

    await expect(page.getByTestId('forgot-password-submit-button')).toBeDisabled();
  });

  test('reset password shows error without recovery session', async ({ page }) => {
    await page.goto('/reset-password');
    await waitForAppLoad(page);

    await page.getByTestId('reset-password-input').fill('password123');
    await page.getByTestId('reset-password-confirm-input').fill('password123');
    await page.getByTestId('reset-password-submit-button').click();

    await expect(
      page.getByText('Recovery link is invalid or expired. Please request a new password reset email.')
    ).toBeVisible();
  });

  test('reset password validates password length', async ({ page }) => {
    await page.goto('/reset-password');
    await waitForAppLoad(page);

    await page.getByTestId('reset-password-input').fill('short');
    await page.getByTestId('reset-password-confirm-input').fill('short');
    await page.getByTestId('reset-password-submit-button').click();

    await expect(page.getByText('Please choose a stronger password (at least 8 characters).')).toBeVisible();
  });

  test('reset password validates password mismatch', async ({ page }) => {
    await page.goto('/reset-password');
    await waitForAppLoad(page);

    await page.getByTestId('reset-password-input').fill('password123');
    await page.getByTestId('reset-password-confirm-input').fill('different456');
    await page.getByTestId('reset-password-submit-button').click();

    await expect(page.getByText('Passwords do not match.')).toBeVisible();
  });

  test('full auth navigation round-trip', async ({ page }) => {
    // Sign in → Sign up → Sign in → Forgot password → Back to sign in
    await page.goto('/sign-in');
    await waitForAppLoad(page);

    // Go to sign up
    await page.getByText('Sign up', { exact: true }).click();
    await expect(page.getByText('Create Account')).toBeVisible();

    // Back to sign in
    await page.getByText('Sign in', { exact: true }).click();
    await expect(page.getByText('Welcome to Form Factor')).toBeVisible();

    // Go to forgot password
    await page.getByText('Forgot password?').click();
    await expect(page).toHaveURL(/.*forgot-password/);
    await expect(page.getByText('Reset Password')).toBeVisible();

    // Back to sign in
    await page.getByText('Back to Sign In').click();
    await expect(page.getByText('Welcome to Form Factor')).toBeVisible();
  });

  test('browser back from forgot-password returns to sign-in', async ({ page }) => {
    await page.goto('/sign-in');
    await waitForAppLoad(page);

    await page.getByText('Forgot password?').click();
    await expect(page).toHaveURL(/.*forgot-password/);

    await page.goBack();
    await expect(page).toHaveURL(/.*sign-in/);

    await expect(page.getByText('Welcome to Form Factor')).toBeVisible();
  });
});
