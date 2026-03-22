import { test, expect } from '@playwright/test';
import { waitForAppLoad } from './utils/test-helpers';

test.describe('Sign Up Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/sign-up');
    await waitForAppLoad(page);
  });

  test('should display sign up form', async ({ page }) => {
    await expect(page.getByText('Create your account')).toBeVisible();
    await expect(page.getByText('Start tracking your form with Form Factor')).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  });

  test('should have link back to sign in', async ({ page }) => {
    const signInLink = page.getByRole('link', { name: 'Sign in' });
    await expect(signInLink).toBeVisible();
    await signInLink.click();
    await waitForAppLoad(page);

    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  });

  test('should require email and password fields', async ({ page }) => {
    await expect(page.getByLabel('Email')).toHaveAttribute('required', '');
    await expect(page.getByLabel('Password')).toHaveAttribute('required', '');
  });

  test('should enforce the minimum password length', async ({ page }) => {
    await expect(page.getByLabel('Password')).toHaveAttribute('minlength', '6');
  });
});
