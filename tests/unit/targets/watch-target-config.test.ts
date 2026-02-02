const fs = require('fs');
const path = require('path');

const config = require('../../../targets/watch-app/expo-target.config.js');

const IOS_BUNDLE_IDENTIFIER = 'com.slenthekid.form-factor-eas';
const WATCH_BUNDLE_IDENTIFIER = `${IOS_BUNDLE_IDENTIFIER}.watchkitapp`;
const INFO_PLIST_PATH = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'targets',
  'watch-app',
  'Info.plist',
);

describe('watch target config', () => {
  it('uses the Xcode watch target name', () => {
    expect(config.name).toBe('Form Factor Watch Watch App');
  });

  it('uses a watch bundle identifier that extends the iOS bundle identifier', () => {
    expect(config.bundleIdentifier).toBe(WATCH_BUNDLE_IDENTIFIER);
  });

  it('sets the watch companion bundle identifier to the iOS bundle identifier', () => {
    const infoPlist = fs.readFileSync(INFO_PLIST_PATH, 'utf8');

    expect(infoPlist).toContain(`<string>${IOS_BUNDLE_IDENTIFIER}</string>`);
  });

  it('includes HealthKit usage strings in the watch Info.plist', () => {
    const infoPlist = fs.readFileSync(INFO_PLIST_PATH, 'utf8');

    expect(infoPlist).toContain('<key>NSHealthShareUsageDescription</key>');
    expect(infoPlist).toContain('<key>NSHealthUpdateUsageDescription</key>');
  });

  it('sets an explicit watchOS deployment target', () => {
    expect(config.deploymentTarget).toBe('10.0');
  });
});
