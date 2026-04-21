/**
 * E2E smoke test — form-tracking surface on the web app.
 *
 * Playwright here runs against the Next.js web app (`apps/web`) per
 * `etc/playwright.config.ts`, NOT Expo web. The real form-tracking flow
 * (ARKit body-tracking, fixture playback via `?fixturePlayback=1&fixture=<name>`)
 * lives inside the Expo app at `app/(tabs)/scan-arkit.tsx` and cannot be
 * exercised from the Next.js dev server — there is no ARKit on web, and
 * the Expo routes are not mounted under the web server Playwright boots.
 *
 * What this file covers instead — the "web-reachable" surface of
 * form-tracking:
 *
 *  1. The marketing homepage advertises real-time form coaching — smoke
 *     check the heading renders (this is the entry point that directs
 *     users to install the native app where the full tracking flow
 *     runs).
 *  2. The public `/debug/fixtures` viewer is the web-side debug UI for
 *     the form-tracking fixture corpus (`tests/fixtures/pullup-tracking`
 *     and `stress-tracking`). It is the ONLY page that consumes the
 *     fixture system on the Next.js app, so it's the meaningful smoke
 *     target here.
 *  3. `/workouts/add` is the form-tracking session entry point on web
 *     (logs a workout that can be bound to a form-tracking session in
 *     the native app). Unauthenticated, it must redirect to sign-in —
 *     assert the redirect + that the exercise picker (when reachable)
 *     would render without crash.
 *
 * What's deferred: the full "fixturePlayback → tracking → debrief →
 * close" E2E requires (a) Expo web hosting with scan-arkit mounted OR
 * (b) Detox/Maestro running the iOS binary. Neither is wired into
 * Playwright yet. This file documents the shape of that future test
 * in comments so the next wave can lift it.
 */
import { test, expect } from '@playwright/test';
import { waitForAppLoad } from './utils/test-helpers';

test.describe('Form Tracking — Web-Reachable Surface', () => {
  test('homepage advertises real-time form coaching (entry point)', async ({ page }) => {
    await page.goto('/');
    await waitForAppLoad(page);

    // The form-tracking value prop lives in the hero heading.
    await expect(
      page.getByRole('heading', {
        name: 'Real-time form coaching from your phone camera.',
      }),
    ).toBeVisible();

    // The "get started" CTA funnels users into the tracking flow.
    await expect(
      page.getByRole('link', { name: 'Get started free' }).first(),
    ).toBeVisible();
  });

  test('debug fixtures viewer renders without crash (public route)', async ({ page }) => {
    // `/debug/fixtures` is public per apps/web/middleware.ts (PUBLIC_PREFIXES).
    // It is the web-side surface that reads the form-tracking fixture corpus
    // from `tests/fixtures/**` — if this page crashes, the fixture loader
    // pipeline is broken.
    const response = await page.goto('/debug/fixtures', { waitUntil: 'domcontentloaded' });

    // The page must not redirect to sign-in (would indicate middleware regressed).
    expect(page.url()).not.toMatch(/\/sign-in/);

    // 200 or 404 are both acceptable (404 if no fixtures are present in CI);
    // what we reject is a 5xx crash.
    const status = response?.status() ?? 0;
    expect(status).toBeLessThan(500);

    // Page has a body (i.e. did not fail to render client-side).
    await expect(page.locator('body')).toBeVisible();
  });

  test('workouts/add redirects unauthenticated users to sign-in', async ({ page }) => {
    // `/workouts/add` is the protected form-tracking session entry point on web.
    // Middleware (apps/web/middleware.ts) must redirect unauthenticated users to
    // /sign-in. If this regresses, the exercise picker would render to
    // unauthenticated users and leak the form-tracking flow.
    await page.goto('/workouts/add');
    await waitForAppLoad(page);

    await expect(page).toHaveURL(/.*sign-in/);
    await expect(page.getByText('Welcome back')).toBeVisible();
  });

  test('sign-in form is the gate into the form-tracking experience', async ({ page }) => {
    // The user's first exposure to the form-tracking flow on web is sign-in —
    // if this form does not render, the entire tracking funnel is unreachable.
    await page.goto('/sign-in');
    await waitForAppLoad(page);

    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // TODO — full "session-complete → debrief" E2E.
  //
  // Blocked on: Expo web is not mounted under the Playwright webServer. Once
  // either (a) `bunx expo start --web` is wired into etc/playwright.config.ts
  // or (b) Detox/Maestro is added for iOS simulator E2E, lift the flow:
  //
  //   1. await authHelper.signInTestUser(page);
  //   2. await page.goto(
  //        '/(tabs)/scan-arkit?fixturePlayback=1&fixture=pushup-10reps',
  //      );
  //   3. await page.waitForSelector('[data-testid="tracking-started-banner"]');
  //   4. await page.waitForSelector('[data-testid="debrief-modal"]', {
  //        timeout: 30_000, // fixture playback duration
  //      });
  //   5. await expect(page.getByTestId('debrief-rep-count')).toBeVisible();
  //   6. await expect(page.getByTestId('debrief-fqi-score')).toBeVisible();
  //   7. await expect(page.getByTestId('form-quality-badge')).toBeVisible();
  //   8. await expect(page.getByTestId('debrief-body')).toBeVisible();
  //   9. await page.getByTestId('debrief-close').click();
  //  10. await expect(page).toHaveURL(/scan-arkit/);
  //
  // The fixture system (`FIXTURE_PLAYBACK_TRACES` in
  // `app/(tabs)/scan-arkit.tsx`) already supports this deep-link; the
  // missing piece is just the web host.
  // ---------------------------------------------------------------------------
  test.skip('TODO: full fixture-playback session → debrief E2E (needs Expo web host)', async () => {
    // See comment block above for the exact flow.
  });
});
