import { defineConfig, devices } from '@playwright/test';
import { join } from 'path';

const projectRoot = join(__dirname, '..');

export default defineConfig({
  testDir: join(projectRoot, 'tests/e2e'),
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:8081',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: process.env.CI
      ? 'NODE_OPTIONS=--max-old-space-size=8192 bunx expo start --web --port 8081'
      : 'bunx expo start --web --port 8081',
    url: 'http://127.0.0.1:8081',
    reuseExistingServer: !process.env.CI,
    timeout: process.env.CI ? 600_000 : 300_000,
  },
});
