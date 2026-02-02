const { applyBuildSettings } = require('../../../plugins/withBuildSettings');

describe('withBuildSettings', () => {
  it('sets release architectures for iOS and watchOS targets', () => {
    const releaseIos = {
      buildSettings: { SDKROOT: 'iphoneos' } as Record<string, string>,
      name: 'Release',
    };
    const releaseWatch = {
      buildSettings: { SDKROOT: 'watchos' } as Record<string, string>,
      name: 'Release',
    };
    const debugIos = {
      buildSettings: { SDKROOT: 'iphoneos' } as Record<string, string>,
      name: 'Debug',
    };

    const xcodeProject = {
      pbxXCBuildConfigurationSection: () => ({
        1: releaseIos,
        2: releaseWatch,
        3: debugIos,
        '3_comment': 'comment',
      }),
    };

    applyBuildSettings(xcodeProject, {});

    expect(releaseIos.buildSettings.VALID_ARCHS).toBe('"arm64"');
    expect(releaseWatch.buildSettings.VALID_ARCHS).toBe('"arm64_32 arm64"');
  });
});
