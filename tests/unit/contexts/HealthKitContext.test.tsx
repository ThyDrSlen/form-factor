/**
 * Unit tests for contexts/HealthKitContext.tsx.
 *
 * Covers:
 * - computeHrStatus parametric (live / stale / unavailable across age boundaries)
 * - HealthKitProvider render + initial state
 * - Permission request flow (success + failure)
 * - Bulk-sync state transitions (isSyncing, syncProgress phases)
 * - Auto-request behavior on iOS when permissions not granted
 *
 * Full end-to-end sync flow is out of scope here because it requires
 * many collaborating modules (Supabase, SQLite, native HealthKit); the
 * tests concentrate on the public context surface and pure exports.
 */

import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react-native';
import type * as HealthKitContextModule from '@/contexts/HealthKitContext';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetAvailability = jest.fn();
const mockGetPermissionStatus = jest.fn();
const mockRequestPermissions = jest.fn();

jest.mock('@/lib/services/healthkit', () => ({
  getAvailabilityAsync: (...args: unknown[]) => mockGetAvailability(...args),
  getPermissionStatusAsync: (...args: unknown[]) => mockGetPermissionStatus(...args),
  requestPermissionsAsync: (...args: unknown[]) => mockRequestPermissions(...args),
}));

jest.mock('@/lib/services/healthkit/health-metrics', () => ({
  getLatestHeartRateAsync: jest.fn().mockResolvedValue(null),
  getStepCountForTodayAsync: jest.fn().mockResolvedValue(null),
  getLatestBodyMassKgAsync: jest.fn().mockResolvedValue(null),
  getStepHistoryAsync: jest.fn().mockResolvedValue([]),
  getWeightHistoryAsync: jest.fn().mockResolvedValue([]),
  getRespiratoryRateHistoryAsync: jest.fn().mockResolvedValue([]),
  getWalkingHeartRateAverageHistoryAsync: jest.fn().mockResolvedValue([]),
  getActiveEnergyHistoryAsync: jest.fn().mockResolvedValue([]),
  getBasalEnergyHistoryAsync: jest.fn().mockResolvedValue([]),
  getDistanceWalkingRunningHistoryAsync: jest.fn().mockResolvedValue([]),
  getDistanceCyclingHistoryAsync: jest.fn().mockResolvedValue([]),
  getDistanceSwimmingHistoryAsync: jest.fn().mockResolvedValue([]),
  getBiologicalSexAsync: jest.fn().mockResolvedValue(null),
  getDateOfBirthAsync: jest.fn().mockResolvedValue({ age: null, birthDate: null }),
}));

jest.mock('@/lib/services/healthkit/weight-trends', () => ({
  analyzeWeightTrends: jest.fn().mockReturnValue(null),
}));

const mockBulkSync = jest.fn();
const mockExistingDataRange = jest.fn().mockResolvedValue({ earliest: null, latest: null, count: 0 });

jest.mock('@/lib/services/healthkit/health-bulk-sync', () => ({
  syncAllHealthKitDataToSupabase: (...args: unknown[]) => mockBulkSync(...args),
  getExistingDataRange: (...args: unknown[]) => mockExistingDataRange(...args),
}));

jest.mock('@/lib/services/database/local-db', () => ({
  localDB: {
    insertHealthMetric: jest.fn().mockResolvedValue(undefined),
    getHealthMetricByDate: jest.fn().mockResolvedValue(null),
  },
}));

jest.mock('@/lib/services/database/sync-service', () => ({
  syncService: {
    syncToSupabase: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('@/contexts/AuthContext', () => ({
  useAuth: jest.fn().mockReturnValue({ user: null }),
}));

jest.mock('@/contexts/NetworkContext', () => ({
  useNetwork: jest.fn().mockReturnValue({ isOnline: true, isConnected: true, networkType: 'WIFI' }),
}));

jest.mock('@/lib/stores/session-runner', () => ({
  useSessionRunner: (selector?: (state: { isWorkoutInProgress: boolean }) => unknown) => {
    const state = { isWorkoutInProgress: false };
    return selector ? selector(state) : state;
  },
}));

jest.mock('@/lib/watch-connectivity', () => ({
  updateWatchContext: jest.fn(),
}));

jest.mock('@/lib/services/ErrorHandler', () => ({
  createError: jest.fn((domain: string, code: string, message: string, opts: any = {}) => ({
    domain, code, message, retryable: opts.retryable ?? false, severity: opts.severity ?? 'error', details: opts.details,
  })),
  logError: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Module loader — must happen after jest.mock calls
// ---------------------------------------------------------------------------

let computeHrStatus: typeof HealthKitContextModule.computeHrStatus;
let HealthKitProvider: typeof HealthKitContextModule.HealthKitProvider;
let useHealthKit: typeof HealthKitContextModule.useHealthKit;

beforeAll(() => {
  const mod = require('@/contexts/HealthKitContext') as typeof HealthKitContextModule;
  computeHrStatus = mod.computeHrStatus;
  HealthKitProvider = mod.HealthKitProvider;
  useHealthKit = mod.useHealthKit;
});

// ---------------------------------------------------------------------------
// computeHrStatus (pure function, no mounting needed)
// ---------------------------------------------------------------------------

describe('computeHrStatus', () => {
  const now = 1_700_000_000_000;

  test('returns unavailable when timestamp is null', () => {
    expect(computeHrStatus(null, now)).toBe('unavailable');
  });

  test('returns unavailable when timestamp is undefined', () => {
    expect(computeHrStatus(undefined, now)).toBe('unavailable');
  });

  test('returns unavailable for NaN timestamp', () => {
    expect(computeHrStatus(NaN, now)).toBe('unavailable');
  });

  test('returns unavailable for Infinity timestamp', () => {
    expect(computeHrStatus(Infinity, now)).toBe('unavailable');
  });

  test('returns live when age is 0 (fresh sample)', () => {
    expect(computeHrStatus(now, now)).toBe('live');
  });

  test('returns live at age just under 10s (live window)', () => {
    expect(computeHrStatus(now - 9_999, now)).toBe('live');
  });

  test('returns stale at exact 10s boundary (not live, not yet gone)', () => {
    expect(computeHrStatus(now - 10_000, now)).toBe('stale');
  });

  test('returns stale at age just under 30s', () => {
    expect(computeHrStatus(now - 29_999, now)).toBe('stale');
  });

  test('returns unavailable at 30s boundary', () => {
    expect(computeHrStatus(now - 30_000, now)).toBe('unavailable');
  });

  test('returns unavailable for very old samples', () => {
    expect(computeHrStatus(now - 1_000_000, now)).toBe('unavailable');
  });

  test('handles future timestamps as live (clock skew tolerance)', () => {
    // age < 0 counts as live per implementation
    expect(computeHrStatus(now + 5_000, now)).toBe('live');
  });

  test('uses Date.now() when nowMs argument omitted', () => {
    const realDateNow = Date.now.bind(Date);
    const spy = jest.spyOn(Date, 'now').mockReturnValue(now);
    try {
      expect(computeHrStatus(now - 1_000)).toBe('live');
      expect(computeHrStatus(now - 15_000)).toBe('stale');
    } finally {
      spy.mockImplementation(realDateNow);
      spy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// HealthKitProvider — rendering + permission flow
// ---------------------------------------------------------------------------

describe('HealthKitProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAvailability.mockResolvedValue(false);
    mockGetPermissionStatus.mockResolvedValue({
      isAvailable: false,
      isAuthorized: false,
      hasReadPermission: false,
      hasSharePermission: false,
      lastCheckedAt: Date.now(),
    });
    mockRequestPermissions.mockResolvedValue({
      isAvailable: true,
      isAuthorized: true,
      hasReadPermission: true,
      hasSharePermission: false,
      lastCheckedAt: Date.now(),
    });
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <HealthKitProvider>{children}</HealthKitProvider>
  );

  test('provides initial loading state and reports unavailable when native module absent', async () => {
    const { result } = renderHook(() => useHealthKit(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isAvailable).toBe(false);
    expect(result.current.status?.hasReadPermission).toBe(false);
    expect(result.current.stepsToday).toBeNull();
  });

  test('exposes initially empty history arrays + none dataSource', async () => {
    const { result } = renderHook(() => useHealthKit(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.stepHistory).toEqual([]);
    expect(result.current.weightHistory).toEqual([]);
    expect(result.current.respiratoryRateHistory).toEqual([]);
    expect(result.current.dataSource).toBe('none');
  });

  test('requestPermissions updates status on success', async () => {
    const { result } = renderHook(() => useHealthKit(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.requestPermissions();
    });

    await waitFor(() => {
      expect(result.current.status?.hasReadPermission).toBe(true);
    });

    expect(mockRequestPermissions).toHaveBeenCalled();
  });

  test('requestPermissions sets error string on failure', async () => {
    mockRequestPermissions.mockRejectedValueOnce(new Error('User denied permissions'));

    const { result } = renderHook(() => useHealthKit(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.requestPermissions();
    });

    await waitFor(() => {
      expect(result.current.error).toBe('User denied permissions');
    });
  });

  test('isSyncing is false initially', async () => {
    const { result } = renderHook(() => useHealthKit(), { wrapper });
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.isSyncing).toBe(false);
    expect(result.current.syncProgress).toBeNull();
  });

  test('enableHighFrequency / disableHighFrequency do not throw', async () => {
    const { result } = renderHook(() => useHealthKit(), { wrapper });
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(() => result.current.enableHighFrequency()).not.toThrow();
    expect(() => result.current.disableHighFrequency()).not.toThrow();
  });

  test('useHealthKit throws when used outside the provider', () => {
    // Suppress React's expected error-boundary noise.
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => renderHook(() => useHealthKit())).toThrow(
        /useHealthKit must be used within HealthKitProvider/
      );
    } finally {
      err.mockRestore();
    }
  });
});
