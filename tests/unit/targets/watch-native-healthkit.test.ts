import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '../../..');
const project = readFileSync(join(root, 'ios/formfactoreas.xcodeproj/project.pbxproj'), 'utf8');
const configurations = [
  ['Debug', 'E34BD3422EFE33C400DAB2CF'],
  ['Release', 'E34BD3432EFE33C400DAB2CF'],
];

function watchSettings(id: string): string {
  const start = project.indexOf(`\t\t${id} /*`);
  expect(start).toBeGreaterThanOrEqual(0);
  return project.slice(start, project.indexOf('\n\t\t};', start));
}

test.each(configurations)('native Watch %s signs with the minimal HealthKit entitlement', (_name, id) => {
  const settings = watchSettings(id);
  const path = settings.match(/CODE_SIGN_ENTITLEMENTS = "([^"]+)";/)?.[1];
  expect(path).toBeDefined();
  const entitlements = readFileSync(join(root, 'ios', path!), 'utf8');
  expect(entitlements).toMatch(/<key>com\.apple\.developer\.healthkit<\/key>\s*<true\s*\/>/);
  expect(entitlements).not.toContain('health-records');
});

test.each(configurations)('native Watch %s includes HealthKit privacy descriptions from the Expo target', (_name, id) => {
  const settings = watchSettings(id);
  const info = readFileSync(join(root, 'targets/watch-app/Info.plist'), 'utf8');
  for (const key of ['NSHealthShareUsageDescription', 'NSHealthUpdateUsageDescription']) {
    const description = info.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`))?.[1];
    expect(description).toBeDefined();
    expect(settings).toContain(`INFOPLIST_KEY_${key} = "${description}";`);
  }
});
