/**
 * Tests for lib/services/healthkit/health-permissions.ts
 *
 * getAvailabilityAsync, getPermissionStatusAsync, requestPermissionsAsync:
 * - Non-iOS returns false / unavailable status
 * - Native module missing degrades gracefully
 * - Authorization success / failure paths
 * - Error handling returns safe defaults
 */

jest.mock('@/lib/logger', () => ({
  logWithTs: jest.fn(),
  warnWithTs: jest.fn(),
  errorWithTs: jest.fn(),
}));

// Controllable fake native HealthKit module
const mockNativeModule: Record<string, jest.Mock> = {
  isAvailable: jest.fn(),
  getAuthorizationStatus: jest.fn(),
  requestAuthorization: jest.fn(),
};

let mockShouldLoadNative = true;
jest.mock('expo-modules-core', () => ({
  requireNativeModule: jest.fn((name: string) => {
    if (name === 'FFHealthKit' && mockShouldLoadNative) return mockNativeModule;
    throw new Error(`Cannot find native module '${name}'`);
  }),
}));

import { Platform } from 'react-native';
import {
  getAvailabilityAsync,
  getPermissionStatusAsync,
  requestPermissionsAsync,
} from '@/lib/services/healthkit/health-permissions';
import type { HealthKitPermissions } from '@/lib/services/healthkit/health-types';

const originalPlatformOS = Platform.OS;

const testPermissions: HealthKitPermissions = {
  read: ['heartRate', 'stepCount'],
  write: ['bodyMass'],
};

function setPlatformOS(os: string) {
  Object.defineProperty(Platform, 'OS', { value: os, writable: true, configurable: true });
}

describe('health-permissions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setPlatformOS('ios');
    mockShouldLoadNative = true;
    mockNativeModule.isAvailable.mockReturnValue(true);
    mockNativeModule.getAuthorizationStatus.mockReturnValue({
      hasReadPermission: false,
      hasSharePermission: false,
    });
    mockNativeModule.requestAuthorization.mockResolvedValue({
      hasReadPermission: false,
      hasSharePermission: false,
    });
  });

  afterAll(() => {
    setPlatformOS(originalPlatformOS);
  });

  // ---------- getAvailabilityAsync ----------

  describe('getAvailabilityAsync', () => {
    it('returns false on android', async () => {
      setPlatformOS('android');
      expect(await getAvailabilityAsync()).toBe(false);
    });

    it('returns false on web', async () => {
      setPlatformOS('web');
      expect(await getAvailabilityAsync()).toBe(false);
    });

    it('returns true when isAvailable returns true on iOS', async () => {
      mockNativeModule.isAvailable.mockReturnValue(true);
      expect(await getAvailabilityAsync()).toBe(true);
    });

    it('returns false when isAvailable returns false', async () => {
      mockNativeModule.isAvailable.mockReturnValue(false);
      expect(await getAvailabilityAsync()).toBe(false);
    });

    it('returns false when isAvailable throws', async () => {
      mockNativeModule.isAvailable.mockImplementation(() => { throw new Error('crash'); });
      expect(await getAvailabilityAsync()).toBe(false);
    });
  });

  // ---------- getPermissionStatusAsync ----------

  describe('getPermissionStatusAsync', () => {
    it('returns unavailable on non-iOS', async () => {
      setPlatformOS('android');
      const status = await getPermissionStatusAsync(testPermissions);
      expect(status.isAvailable).toBe(false);
      expect(status.isAuthorized).toBe(false);
      expect(status.hasReadPermission).toBe(false);
      expect(status.hasSharePermission).toBe(false);
      expect(status.lastCheckedAt).toEqual(expect.any(Number));
    });

    it('returns unavailable when HealthKit is not available', async () => {
      mockNativeModule.isAvailable.mockReturnValue(false);
      const status = await getPermissionStatusAsync(testPermissions);
      expect(status.isAvailable).toBe(false);
      expect(status.isAuthorized).toBe(false);
    });

    it('returns authorized when read permission granted', async () => {
      mockNativeModule.getAuthorizationStatus.mockReturnValue({
        hasReadPermission: true,
        hasSharePermission: false,
      });

      const status = await getPermissionStatusAsync(testPermissions);
      expect(status.isAvailable).toBe(true);
      expect(status.isAuthorized).toBe(true);
      expect(status.hasReadPermission).toBe(true);
      expect(status.hasSharePermission).toBe(false);
    });

    it('returns authorized when share permission granted', async () => {
      mockNativeModule.getAuthorizationStatus.mockReturnValue({
        hasReadPermission: false,
        hasSharePermission: true,
      });

      const status = await getPermissionStatusAsync(testPermissions);
      expect(status.isAuthorized).toBe(true);
      expect(status.hasSharePermission).toBe(true);
    });

    it('returns unauthorized when both permissions denied', async () => {
      mockNativeModule.getAuthorizationStatus.mockReturnValue({
        hasReadPermission: false,
        hasSharePermission: false,
      });

      const status = await getPermissionStatusAsync(testPermissions);
      expect(status.isAvailable).toBe(true);
      expect(status.isAuthorized).toBe(false);
    });

    it('handles getAuthorizationStatus throwing', async () => {
      mockNativeModule.getAuthorizationStatus.mockImplementation(() => {
        throw new Error('auth error');
      });

      const status = await getPermissionStatusAsync(testPermissions);
      expect(status.isAvailable).toBe(true);
      expect(status.isAuthorized).toBe(false);
    });

    it('passes correct permission arrays to native', async () => {
      mockNativeModule.getAuthorizationStatus.mockReturnValue({
        hasReadPermission: true,
        hasSharePermission: true,
      });

      await getPermissionStatusAsync(testPermissions);
      expect(mockNativeModule.getAuthorizationStatus).toHaveBeenCalledWith(
        testPermissions.read,
        testPermissions.write
      );
    });

    it('sets lastCheckedAt to a recent timestamp', async () => {
      const before = Date.now();
      const status = await getPermissionStatusAsync(testPermissions);
      const after = Date.now();
      expect(status.lastCheckedAt).toBeGreaterThanOrEqual(before);
      expect(status.lastCheckedAt).toBeLessThanOrEqual(after);
    });
  });

  // ---------- requestPermissionsAsync ----------

  describe('requestPermissionsAsync', () => {
    it('returns unavailable on non-iOS', async () => {
      setPlatformOS('web');
      const status = await requestPermissionsAsync(testPermissions);
      expect(status.isAvailable).toBe(false);
      expect(status.isAuthorized).toBe(false);
    });

    it('returns unavailable when HealthKit is not available', async () => {
      mockNativeModule.isAvailable.mockReturnValue(false);
      const status = await requestPermissionsAsync(testPermissions);
      expect(status.isAvailable).toBe(false);
    });

    it('returns authorized after user grants permissions', async () => {
      mockNativeModule.requestAuthorization.mockResolvedValue({
        hasReadPermission: true,
        hasSharePermission: true,
      });

      const status = await requestPermissionsAsync(testPermissions);
      expect(status.isAvailable).toBe(true);
      expect(status.isAuthorized).toBe(true);
      expect(status.hasReadPermission).toBe(true);
      expect(status.hasSharePermission).toBe(true);
      expect(status.lastCheckedAt).toEqual(expect.any(Number));
    });

    it('returns unauthorized when user denies all', async () => {
      mockNativeModule.requestAuthorization.mockResolvedValue({
        hasReadPermission: false,
        hasSharePermission: false,
      });

      const status = await requestPermissionsAsync(testPermissions);
      expect(status.isAuthorized).toBe(false);
    });

    it('handles requestAuthorization rejection gracefully', async () => {
      mockNativeModule.requestAuthorization.mockRejectedValue(new Error('user cancelled'));

      const status = await requestPermissionsAsync(testPermissions);
      expect(status.isAvailable).toBe(true);
      expect(status.isAuthorized).toBe(false);
      expect(status.hasReadPermission).toBe(false);
    });

    it('returns partial authorization (read only)', async () => {
      mockNativeModule.requestAuthorization.mockResolvedValue({
        hasReadPermission: true,
        hasSharePermission: false,
      });

      const status = await requestPermissionsAsync(testPermissions);
      expect(status.isAuthorized).toBe(true);
      expect(status.hasReadPermission).toBe(true);
      expect(status.hasSharePermission).toBe(false);
    });
  });
});
