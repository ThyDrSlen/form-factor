import fs from 'node:fs';
import path from 'node:path';

const auditedFiles = [
  'app/(auth)/forgot-password.tsx',
  'app/(auth)/sign-in.tsx',
  'app/(auth)/sign-up.tsx',
  'app/(modals)/add-food.tsx',
  'app/(modals)/notifications.tsx',
  'components/dashboard-health/DashboardHealth.tsx',
] as const;

describe('platform-utils audit', () => {
  for (const relativePath of auditedFiles) {
    test(`${relativePath} does not use Platform.OS directly`, () => {
      const absolutePath = path.resolve(process.cwd(), relativePath);
      const contents = fs.readFileSync(absolutePath, 'utf8');
      expect(contents).not.toMatch(/\bPlatform\.OS\b/);
    });
  }
});

