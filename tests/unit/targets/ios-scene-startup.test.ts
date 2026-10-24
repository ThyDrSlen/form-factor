import { readFileSync } from 'fs';
import { join } from 'path';

// These are native configuration/source contracts, not a substitute for an
// actual launch on iOS 27. The physical launch is the behavioral acceptance gate.
const root = join(__dirname, '../../..');
const nativeDelegate = readFileSync(join(root, 'ios/formfactoreas/AppDelegate.swift'), 'utf8');
const plist = readFileSync(join(root, 'ios/formfactoreas/Info.plist'), 'utf8');

describe('iOS scene startup compatibility', () => {
  it('registers a single scene whose delegate mounts React Native in the scene window', () => {
    expect(plist).toMatch(/<key>UIApplicationSceneManifest<\/key>/);
    expect(plist).toMatch(/<key>UIApplicationSupportsMultipleScenes<\/key>\s*<false\s*\/>/);
    expect(plist).toContain('$(PRODUCT_MODULE_NAME).SceneDelegate');
    expect(nativeDelegate).toContain('class SceneDelegate: UIResponder, UIWindowSceneDelegate');
    expect(nativeDelegate).toContain('UIWindow(windowScene: windowScene)');
    expect(nativeDelegate).not.toContain('UIWindow(frame: UIScreen.main.bounds)');
    expect(nativeDelegate.match(/factory\.startReactNative\(/g)).toHaveLength(1);
    expect(nativeDelegate).toContain('appDelegate.window = window');
  });

  it('preserves scene links and lifecycle through the existing Expo app delegate', () => {
    const sceneDelegate = nativeDelegate.split('class SceneDelegate:')[1]?.split('class ReactNativeDelegate:')[0] ?? '';
    expect(sceneDelegate).toContain('connectionOptions.urlContexts');
    expect(sceneDelegate).toContain('launchOptions[.url] = context.url');
    expect(sceneDelegate).toContain('launchOptions[.userActivityDictionary]');
    expect(sceneDelegate).toContain('launchOptions: launchOptions');
    expect(sceneDelegate).toContain('openURLContexts');
    expect(sceneDelegate).toContain('continue userActivity: NSUserActivity');
    expect(sceneDelegate).toContain('delegate.application(UIApplication.shared, open: context.url, options: options)');
    expect(sceneDelegate).toContain('delegate.application(UIApplication.shared, continue: userActivity');
    expect(sceneDelegate).not.toContain('RCTLinkingManager.application');
    for (const callback of [
      'applicationDidBecomeActive', 'applicationWillResignActive',
      'applicationDidEnterBackground', 'applicationWillEnterForeground',
    ]) {
      expect(sceneDelegate).toContain(`${callback}(UIApplication.shared)`);
    }
  });
});
