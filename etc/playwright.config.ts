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
    command: 'npx expo start --web',
    url: 'http://localhost:8081',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
