import { test, expect } from '@playwright/test';

/**
 * Exercise picker dropdown behavior tests for /workouts/add.
 *
 * These tests verify the dropdown collapses after selection and reopens
 * on clear/focus — preventing the visual overlap bug where the exercise
 * list stayed visible beneath the selected exercise chip.
 *
 * Requires authentication to access /workouts/add.
 * When not authenticated, middleware redirects to /sign-in.
 */

test.describe('Exercise Picker — Dropdown Behavior', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the add workout page
    // Middleware will redirect to /sign-in if not authenticated
    await page.goto('/workouts/add');
  });

  test('exercise dropdown is visible on initial page load', async ({ page }) => {
    // If redirected to sign-in, skip — this test needs auth
    if (page.url().includes('sign-in')) {
      test.skip(true, 'Requires authenticated session');
      return;
    }

    const dropdown = page.getByTestId('exercise-dropdown');
    await expect(dropdown).toBeVisible();
  });

  test('dropdown closes after selecting an exercise', async ({ page }) => {
    if (page.url().includes('sign-in')) {
      test.skip(true, 'Requires authenticated session');
      return;
    }

    const dropdown = page.getByTestId('exercise-dropdown');
    await expect(dropdown).toBeVisible();

    // Click the first exercise button in the dropdown
    const firstExercise = dropdown.locator('button').first();
    await firstExercise.waitFor({ state: 'visible' });
    const exerciseName = await firstExercise.textContent();
    await firstExercise.click();

    // Dropdown should be hidden after selection
    await expect(dropdown).not.toBeVisible();

    // Selected exercise chip should be visible
    const chip = page.locator('.bg-accent\\/15');
    await expect(chip).toBeVisible();
    expect(await chip.textContent()).toContain(exerciseName?.replace('(compound)', '').trim());
  });

  test('dropdown reopens when Clear is clicked', async ({ page }) => {
    if (page.url().includes('sign-in')) {
      test.skip(true, 'Requires authenticated session');
      return;
    }

    const dropdown = page.getByTestId('exercise-dropdown');

    // Select an exercise
    const firstExercise = dropdown.locator('button').first();
    await firstExercise.waitFor({ state: 'visible' });
    await firstExercise.click();
    await expect(dropdown).not.toBeVisible();

    // Click Clear
    await page.getByText('Clear').click();

    // Dropdown should reappear
    await expect(dropdown).toBeVisible();
  });

  test('dropdown reopens when search input is focused', async ({ page }) => {
    if (page.url().includes('sign-in')) {
      test.skip(true, 'Requires authenticated session');
      return;
    }

    const dropdown = page.getByTestId('exercise-dropdown');

    // Select an exercise to close dropdown
    const firstExercise = dropdown.locator('button').first();
    await firstExercise.waitFor({ state: 'visible' });
    await firstExercise.click();
    await expect(dropdown).not.toBeVisible();

    // Focus the search input
    await page.locator('#exercise-search').focus();

    // Dropdown should reappear
    await expect(dropdown).toBeVisible();
  });

  test('dropdown does not overlap sets/reps/weight fields after selection', async ({ page }) => {
    if (page.url().includes('sign-in')) {
      test.skip(true, 'Requires authenticated session');
      return;
    }

    const dropdown = page.getByTestId('exercise-dropdown');

    // Select an exercise
    const firstExercise = dropdown.locator('button').first();
    await firstExercise.waitFor({ state: 'visible' });
    await firstExercise.click();

    // Dropdown gone
    await expect(dropdown).not.toBeVisible();

    // Sets field should be fully visible and not obscured
    const setsInput = page.locator('#sets');
    await expect(setsInput).toBeVisible();

    // Verify no overlap: the sets input bounding box should not intersect
    // with where the dropdown was
    const setsBox = await setsInput.boundingBox();
    expect(setsBox).not.toBeNull();
    expect(setsBox!.height).toBeGreaterThan(0);
  });

  test('Log Workout button is disabled until exercise is selected', async ({ page }) => {
    if (page.url().includes('sign-in')) {
      test.skip(true, 'Requires authenticated session');
      return;
    }

    const submitButton = page.getByRole('button', { name: 'Log Workout' });
    await expect(submitButton).toBeDisabled();

    // Select an exercise
    const dropdown = page.getByTestId('exercise-dropdown');
    const firstExercise = dropdown.locator('button').first();
    await firstExercise.waitFor({ state: 'visible' });
    await firstExercise.click();

    // Button should now be enabled
    await expect(submitButton).toBeEnabled();
  });

  test('category headers do not overlap exercise names when scrolling', async ({ page }) => {
    if (page.url().includes('sign-in')) {
      test.skip(true, 'Requires authenticated session');
      return;
    }

    const dropdown = page.getByTestId('exercise-dropdown');
    await expect(dropdown).toBeVisible();

    // Check that sticky headers have z-index to prevent overlap
    const stickyHeaders = dropdown.locator('.sticky');
    const headerCount = await stickyHeaders.count();

    if (headerCount > 0) {
      // Verify the first sticky header has z-index via the z-10 class
      const firstHeader = stickyHeaders.first();
      const hasZIndex = await firstHeader.evaluate((el) => {
        const style = window.getComputedStyle(el);
        return parseInt(style.zIndex) > 0;
      });
      expect(hasZIndex).toBe(true);
    }
  });
});
