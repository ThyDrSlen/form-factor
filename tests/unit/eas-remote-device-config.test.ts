import fs from 'fs';
import path from 'path';

type Config = { [key: string]: any };

const root = path.resolve(__dirname, '../..');
const eas = JSON.parse(fs.readFileSync(path.join(root, 'eas.json'), 'utf8'));

// EAS extends merges nested platform/env settings, rather than replacing them.
function mergeConfig(parent: Config, child: Config): Config {
  const merged = { ...parent };
  for (const [key, value] of Object.entries(child)) {
    merged[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? mergeConfig(parent[key] ?? {}, value)
      : value;
  }
  return merged;
}

function resolveProfile(name: string, ancestors: string[] = []): Config {
  if (ancestors.includes(name)) throw new Error(`Circular build profile: ${name}`);
  const profile = eas.build[name];
  if (!profile) throw new Error(`Missing build profile: ${name}`);
  const { extends: parent, ...settings } = profile;
  return mergeConfig(parent ? resolveProfile(parent, [...ancestors, name]) : {}, settings);
}

describe('remote-device EAS profile', () => {
  it('resolves to a standalone internal Release compatible with the production iPhone/Watch pair', () => {
    // Fail explicitly on a missing profile before attempting inheritance resolution.
    expect(eas.build['remote-device']).toBeDefined();
    expect(eas.build['remote-device'].extends).toBe('production');

    const production = resolveProfile('production');
    const remote = resolveProfile('remote-device');
    // Platform-specific options take precedence over shared build settings in EAS.
    const ios = mergeConfig(remote, remote.ios ?? {});
    expect(ios.distribution).toBe('internal');
    expect(ios.developmentClient).toBe(false);
    expect(ios.environment).toBe('production');
    expect(ios.simulator).toBe(false);
    expect(ios.buildConfiguration).toBe('Release');
    expect(ios.credentialsSource).toBe('remote');
    expect(ios.autoIncrement).toBe(true);
    expect(eas.build['remote-device'].ios?.image).toBeUndefined();
    expect(ios.image).toBe(production.ios.image);
    expect(ios.env.APP_VARIANT).toBe('production');
    expect(ios.env.APP_VARIANT).toBe(production.env.APP_VARIANT);
    // Compare without printing environment contents if inheritance regresses.
    expect(Object.entries(production.env).every(([key, value]) => ios.env[key] === value)).toBe(true);

    const originalEnv = process.env;
    let phoneIdentifier: string | undefined;
    try {
      // Load the real Expo config directly, not the Expo CLI/dotenv loader.
      // Do not read backend values or credentials from the developer's environment.
      process.env = {
        NODE_ENV: 'test',
        APP_VARIANT: ios.env.APP_VARIANT,
        EXPO_USE_NEW_ARCH: ios.env.EXPO_USE_NEW_ARCH,
      };
      jest.isolateModules(() => {
        const configureApp = jest.requireActual('../../app.config');
        phoneIdentifier = configureApp({ config: {} }).ios.bundleIdentifier;
      });
    } finally {
      process.env = originalEnv;
    }
    expect(phoneIdentifier).toBe('com.slenthekid.form-factor-eas');

    const nativeProject = fs.readFileSync(
      path.join(root, 'ios/formfactoreas.xcodeproj/project.pbxproj'),
      'utf8',
    );
    // Match the companion and Watch identifier within the same Release settings block.
    const releaseSettings = Array.from(
      nativeProject.matchAll(/buildSettings = \{([\s\S]*?)\};\s*name = (\w+);/g),
    ).filter((match) => match[2] === 'Release').map((match) => match[1]);
    const watchSettings = releaseSettings.filter((settings) =>
      settings.includes('INFOPLIST_KEY_WKCompanionAppBundleIdentifier'),
    );
    expect(watchSettings).toHaveLength(1);
    const watch = watchSettings[0];
    const companionIdentifier = watch.match(
      /INFOPLIST_KEY_WKCompanionAppBundleIdentifier = "([^"]+)";/,
    )?.[1];
    const watchIdentifier = watch.match(/\bPRODUCT_BUNDLE_IDENTIFIER = "([^"]+)";/)?.[1];
    expect(companionIdentifier).toBe(phoneIdentifier);
    expect(watchIdentifier).toBe(`${phoneIdentifier}.watchkitapp`);
  });
});
