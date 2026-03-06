import { test, expect } from '@playwright/test';
import { waitForAppLoad } from './utils/test-helpers';

test.describe('Sign Up Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/sign-up');
    await waitForAppLoad(page);
  });

  test('should display sign up form', async ({ page }) => {
    await expect(page.getByText('Create Account')).toBeVisible();
    await expect(page.getByText('Sign up to get started')).toBeVisible();
    await expect(page.getByTestId('sign-up-full-name-input')).toBeVisible();
    await expect(page.getByTestId('sign-up-email-input')).toBeVisible();
    await expect(page.getByTestId('sign-up-password-input')).toBeVisible();
    await expect(page.getByTestId('sign-up-submit-button')).toBeVisible();
  });

  test('should have link back to sign in', async ({ page }) => {
    const signInLink = page.getByTestId('sign-up-sign-in-link');
    await expect(signInLink).toBeVisible();
    await signInLink.click();
    await waitForAppLoad(page);

    await expect(page.getByText('Welcome to Form Factor')).toBeVisible();
  });

  test('should show validation error on empty submit', async ({ page }) => {
    await page.getByTestId('sign-up-submit-button').click();
    await expect(page.getByTestId('sign-up-error-message')).toHaveText('Please fill in all fields');
  });

  test('should show validation error when name is missing', async ({ page }) => {
    await page.getByTestId('sign-up-email-input').fill('test@example.com');
    await page.getByTestId('sign-up-password-input').fill('password123');
    await page.getByTestId('sign-up-submit-button').click();
    await expect(page.getByTestId('sign-up-error-message')).toHaveText('Please enter your full name');
  });
});
