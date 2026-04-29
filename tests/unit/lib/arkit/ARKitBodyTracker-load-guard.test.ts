/**
 * Regression tests for the ARKitBodyTracker native-module load guard
 * (wave-31 Pack A / A2 / #562). Ensures that when the iOS native module
 * fails to resolve — e.g. unsupported device, stale build, or a broken
 * pod install — the JS bundle:
 *
 *   1. does NOT throw during import (module load), and
 *   2. exposes `isARKitBodyTrackerAvailable()` → `false`, and
 *   3. the public BodyTracker surface no-ops instead of crashing, so
 *      consumers can render a friendly "device not supported" screen.
 *
 * We test two cases:
 *   - A) requireNativeModule throws → `moduleAvailable` is false
 *   - B) requireNativeModule succeeds → `moduleAvailable` is true
 */

// Mock the logger so we don't spam test output with "FAILED to load …"
jest.mock('@/lib/logger', () => ({
  logWithTs: jest.fn(),
  warnWithTs: jest.fn(),
  errorWithTs: jest.fn(),
}));

describe('ARKitBodyTracker iOS load guard', () => {
  const ORIGINAL_DEV = (global as any).__DEV__;

  beforeEach(() => {
    jest.resetModules();
    (global as any).__DEV__ = false; // keep log output minimal
  });

  afterAll(() => {
    (global as any).__DEV__ = ORIGINAL_DEV;
  });

  describe('when expo-modules-core throws on requireNativeModule', () => {
    it('does not throw on module load and reports moduleAvailable === false', () => {
      jest.doMock('expo-modules-core', () => ({
        requireNativeModule: jest.fn(() => {
          throw new Error('native ARKitBodyTracker not linked');
        }),
      }));

      expect(() => {
        // Importing should not throw even though the native require blew up
        require('../../../../lib/arkit/ARKitBodyTracker.ios');
      }).not.toThrow();

      const mod = require('../../../../lib/arkit/ARKitBodyTracker.ios');
      expect(typeof mod.isARKitBodyTrackerAvailable).toBe('function');
      expect(mod.isARKitBodyTrackerAvailable()).toBe(false);

      const loadError = mod.getARKitBodyTrackerLoadError();
      expect(loadError).toBeInstanceOf(Error);
      expect((loadError as Error).message).toMatch(/not linked/);
    });

    it('BodyTracker.isSupported() returns false without throwing', () => {
      jest.doMock('expo-modules-core', () => ({
        requireNativeModule: jest.fn(() => {
          throw new Error('native module missing');
        }),
      }));

      const { BodyTracker } = require('../../../../lib/arkit/ARKitBodyTracker.ios');
      expect(() => BodyTracker.isSupported()).not.toThrow();
      expect(BodyTracker.isSupported()).toBe(false);
    });

    it('BodyTracker stub methods no-op without throwing', () => {
      jest.doMock('expo-modules-core', () => ({
        requireNativeModule: jest.fn(() => {
          throw new Error('native module missing');
        }),
      }));

      const { BodyTracker } = require('../../../../lib/arkit/ARKitBodyTracker.ios');

      // Stubs should return sensible defaults
      expect(BodyTracker.getCurrentPose()).toBeNull();
      expect(BodyTracker.getCurrentPose2D()).toBeNull();
      expect(BodyTracker.getSupportDiagnostics()).toBeNull();

      // void stubs should not throw
      expect(() => BodyTracker.stopTracking()).not.toThrow();
      expect(() => BodyTracker.setSubjectLockEnabled(true)).not.toThrow();
      expect(() => BodyTracker.resetSubjectLock()).not.toThrow();
    });

    it('BodyTracker.startTracking rejects with an actionable error', async () => {
      jest.doMock('expo-modules-core', () => ({
        requireNativeModule: jest.fn(() => {
          throw new Error('native module missing');
        }),
      }));

      const { BodyTracker } = require('../../../../lib/arkit/ARKitBodyTracker.ios');
      await expect(BodyTracker.startTracking()).rejects.toThrow(
        /native module missing/i,
      );
    });
  });

  describe('when expo-modules-core returns a valid module', () => {
    it('reports moduleAvailable === true and preserves native calls', () => {
      const nativeIsSupported = jest.fn().mockReturnValue(true);
      jest.doMock('expo-modules-core', () => ({
        requireNativeModule: jest.fn(() => ({
          isSupported: nativeIsSupported,
          stopTracking: jest.fn(),
        })),
      }));

      const {
        isARKitBodyTrackerAvailable,
        getARKitBodyTrackerLoadError,
        BodyTracker,
      } = require('../../../../lib/arkit/ARKitBodyTracker.ios');

      expect(isARKitBodyTrackerAvailable()).toBe(true);
      expect(getARKitBodyTrackerLoadError()).toBeNull();
      expect(BodyTracker.isSupported()).toBe(true);
      expect(nativeIsSupported).toHaveBeenCalled();
    });
  });
});
