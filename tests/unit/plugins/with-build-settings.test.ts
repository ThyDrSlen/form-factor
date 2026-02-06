const { applyBuildSettings } = require('../../../plugins/withBuildSettings');

describe('withBuildSettings', () => {
  it('sets release architectures for iOS and watchOS targets', () => {
    const releaseIos = {
      buildSettings: { SDKROOT: 'iphoneos', PRODUCT_NAME: 'formfactoreas' } as Record<string, string>,
      name: 'Release',
    };
    const releaseWatch = {
      buildSettings: {
        SDKROOT: 'watchos',
        PRODUCT_NAME: 'Form Factor Watch Watch App',
        WRAPPER_EXTENSION: 'app',
      } as Record<string, string>,
      name: 'Release',
    };
    const debugIos = {
      buildSettings: { SDKROOT: 'iphoneos', PRODUCT_NAME: 'formfactoreas' } as Record<string, string>,
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

    expect(releaseIos.buildSettings.VALID_ARCHS).toBeUndefined();
    expect(releaseIos.buildSettings.ONLY_ACTIVE_ARCH).toBe('NO');
    expect(debugIos.buildSettings.ONLY_ACTIVE_ARCH).toBe('YES');
    expect(releaseWatch.buildSettings.VALID_ARCHS).toBeUndefined();
    expect(releaseWatch.buildSettings['ARCHS[sdk=watchos*]']).toBe('"arm64 arm64_32"');
  });
});
