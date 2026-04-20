/**
 * Unit tests for lib/utils/safe-haptic.ts
 *
 * Verifies that the safeHaptic wrapper:
 * - dispatches to the correct expo-haptics API on iOS / Android
 * - no-ops on web
 * - swallows promise rejections (never throws to the caller)
 * - only logs one warning per session
 */

jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(),
  impactAsync: jest.fn(),
  selectionAsync: jest.fn(),
  NotificationFeedbackType: {
    Success: 'success',
    Warning: 'warning',
    Error: 'error',
  },
  ImpactFeedbackStyle: {
    Light: 'light',
    Medium: 'medium',
    Heavy: 'heavy',
    Rigid: 'rigid',
    Soft: 'soft',
  },
}));

jest.mock('@/lib/logger', () => ({
  warnWithTs: jest.fn(),
}));

// Platform mock — mutable per-test
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';
import { safeHaptic, __resetSafeHapticState } from '@/lib/utils/safe-haptic';
import { warnWithTs } from '@/lib/logger';

const mockNotificationAsync = Haptics.notificationAsync as jest.Mock;
const mockImpactAsync = Haptics.impactAsync as jest.Mock;
const mockSelectionAsync = Haptics.selectionAsync as jest.Mock;
const mockWarn = warnWithTs as jest.Mock;

describe('safeHaptic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetSafeHapticState();
    (Platform as unknown as { OS: string }).OS = 'ios';
    mockNotificationAsync.mockResolvedValue(undefined);
    mockImpactAsync.mockResolvedValue(undefined);
    mockSelectionAsync.mockResolvedValue(undefined);
  });

  describe('notification()', () => {
    it('dispatches success → NotificationFeedbackType.Success', () => {
      safeHaptic.notification('success');
      expect(mockNotificationAsync).toHaveBeenCalledWith('success');
    });

    it('dispatches warning → NotificationFeedbackType.Warning', () => {
      safeHaptic.notification('warning');
      expect(mockNotificationAsync).toHaveBeenCalledWith('warning');
    });

    it('dispatches error → NotificationFeedbackType.Error', () => {
      safeHaptic.notification('error');
      expect(mockNotificationAsync).toHaveBeenCalledWith('error');
    });

    it('no-ops on web', () => {
      (Platform as unknown as { OS: string }).OS = 'web';
      safeHaptic.notification('success');
      expect(mockNotificationAsync).not.toHaveBeenCalled();
    });

    it('swallows rejection without throwing', async () => {
      mockNotificationAsync.mockRejectedValueOnce(new Error('haptics off'));
      expect(() => safeHaptic.notification('success')).not.toThrow();
      // Let microtask flush so .catch runs
      await Promise.resolve();
      await Promise.resolve();
      expect(mockWarn).toHaveBeenCalledTimes(1);
    });

    it('only logs the first failure per session', async () => {
      mockNotificationAsync.mockRejectedValue(new Error('always fails'));
      safeHaptic.notification('success');
      safeHaptic.notification('warning');
      safeHaptic.notification('error');
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(mockWarn).toHaveBeenCalledTimes(1);
    });
  });

  describe('impact()', () => {
    it('dispatches light / medium / heavy', () => {
      safeHaptic.impact('light');
      safeHaptic.impact('medium');
      safeHaptic.impact('heavy');
      expect(mockImpactAsync).toHaveBeenNthCalledWith(1, 'light');
      expect(mockImpactAsync).toHaveBeenNthCalledWith(2, 'medium');
      expect(mockImpactAsync).toHaveBeenNthCalledWith(3, 'heavy');
    });

    it('swallows rejection', async () => {
      mockImpactAsync.mockRejectedValueOnce(new Error('nope'));
      expect(() => safeHaptic.impact('medium')).not.toThrow();
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  describe('selection()', () => {
    it('dispatches selection haptic', () => {
      safeHaptic.selection();
      expect(mockSelectionAsync).toHaveBeenCalled();
    });

    it('no-ops on web', () => {
      (Platform as unknown as { OS: string }).OS = 'web';
      safeHaptic.selection();
      expect(mockSelectionAsync).not.toHaveBeenCalled();
    });
  });
});
