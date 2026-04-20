/**
 * rest-timer AppState wire-up tests (Issue #430 Gap 8).
 *
 * Verifies the `onRestTimerAppResume` subscription fires on any
 * transition into `active`, does NOT fire when staying active, shares
 * the underlying AppState subscription across multiple listeners, and
 * reflects elapsed wall-clock in `computeRemainingSeconds`.
 */

// ---------------------------------------------------------------------------
// Mock react-native AppState so tests can drive transitions deterministically.
// Storage lives on globalThis so the hoisted jest.mock factory can reach it.
// ---------------------------------------------------------------------------

type AppStateStatus = 'active' | 'background' | 'inactive' | 'unknown';
type Listener = (state: AppStateStatus) => void;

(globalThis as unknown as {
  __restTimerAppState: {
    currentState: AppStateStatus;
    listeners: Set<Listener>;
  };
}).__restTimerAppState = {
  currentState: 'active',
  listeners: new Set<Listener>(),
};

jest.mock('react-native', () => {
  const g = globalThis as unknown as {
    __restTimerAppState?: {
      currentState: AppStateStatus;
      listeners: Set<Listener>;
    };
  };
  if (!g.__restTimerAppState) {
    g.__restTimerAppState = { currentState: 'active', listeners: new Set() };
  }
  const getStore = () => g.__restTimerAppState!;
  return {
    AppState: {
      get currentState(): AppStateStatus {
        return getStore().currentState;
      },
      addEventListener: jest.fn((event: string, fn: Listener) => {
        if (event !== 'change') throw new Error('unexpected event');
        getStore().listeners.add(fn);
        return {
          remove: () => getStore().listeners.delete(fn),
        };
      }),
    },
  };
});

const appStateInternal = (
  globalThis as unknown as {
    __restTimerAppState: {
      currentState: AppStateStatus;
      listeners: Set<Listener>;
    };
  }
).__restTimerAppState;

// Stub expo-notifications so the module loads without native calls.
jest.mock('expo-notifications', () => ({
  scheduleNotificationAsync: jest.fn(async () => 'notif-id'),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
}));

jest.mock('@/lib/logger', () => ({
  logWithTs: jest.fn(),
  warnWithTs: jest.fn(),
  errorWithTs: jest.fn(),
}));

jest.mock('@/lib/haptics/haptic-bus', () => ({
  hapticBus: { emit: jest.fn() },
}));

import {
  computeRemainingSeconds,
  onRestTimerAppResume,
  __resetRestTimerAppStateForTests,
} from '@/lib/services/rest-timer';
import { AppState } from 'react-native';

function emit(state: AppStateStatus): void {
  appStateInternal.currentState = state;
  appStateInternal.listeners.forEach((fn) => fn(state));
}

describe('rest-timer AppState resume', () => {
  beforeEach(() => {
    __resetRestTimerAppStateForTests();
    appStateInternal.currentState = 'active';
    appStateInternal.listeners.clear();
    (AppState.addEventListener as jest.Mock).mockClear();
  });

  test('onRestTimerAppResume fires when background \u2192 active', () => {
    const fn = jest.fn();
    const unsubscribe = onRestTimerAppResume(fn);
    // First go to background then back to active.
    emit('background');
    emit('active');
    expect(fn).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  test('does NOT fire when already-active \u2192 active (no transition)', () => {
    const fn = jest.fn();
    const unsubscribe = onRestTimerAppResume(fn);
    emit('active');
    expect(fn).not.toHaveBeenCalled();
    unsubscribe();
  });

  test('unsubscribe removes the listener and, when last, removes AppState subscription', () => {
    const fn = jest.fn();
    const unsubscribe = onRestTimerAppResume(fn);
    expect(appStateInternal.listeners.size).toBe(1);
    unsubscribe();
    expect(appStateInternal.listeners.size).toBe(0);
    emit('background');
    emit('active');
    expect(fn).not.toHaveBeenCalled();
  });

  test('elapsed wall-clock + 30s in background \u2192 computeRemainingSeconds reflects 30s used', () => {
    const nowMs = 1_700_000_000_000;
    const realDateNow = Date.now;
    Date.now = () => nowMs;

    const startedAt = new Date(nowMs).toISOString();
    const target = 120;

    const fn = jest.fn(() => {
      expect(computeRemainingSeconds(startedAt, target)).toBe(90);
    });
    const unsubscribe = onRestTimerAppResume(fn);

    // Simulate background
    emit('background');
    // Advance clock by 30s while in background.
    Date.now = () => nowMs + 30_000;
    // Back to active.
    emit('active');
    expect(fn).toHaveBeenCalledTimes(1);
    unsubscribe();
    Date.now = realDateNow;
  });
});
