/* eslint-disable @typescript-eslint/no-require-imports */

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

const mockVibrate = jest.fn();

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  Vibration: { vibrate: (pattern: number | number[]) => mockVibrate(pattern) },
}));

import { hapticBus, type HapticEvent } from '@/lib/haptics/haptic-bus';
import * as Haptics from 'expo-haptics';

function advance(now: number) {
  jest.spyOn(Date, 'now').mockReturnValue(now);
}

describe('hapticBus', () => {
  beforeEach(() => {
    hapticBus._reset();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('plays a Light impact for rep.complete on iOS', () => {
    advance(1000);
    hapticBus.emit('rep.complete');
    expect(Haptics.impactAsync).toHaveBeenCalledWith('light');
  });

  it('debounces rapid rep.complete emits', () => {
    advance(1000);
    hapticBus.emit('rep.complete');
    advance(1100); // 100ms later, within 300ms window
    hapticBus.emit('rep.complete');
    advance(1400); // 400ms later — allowed
    hapticBus.emit('rep.complete');
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(2);
  });

  it('respects critical-only mode', () => {
    hapticBus.setMode('critical-only');
    advance(2000);
    hapticBus.emit('rep.complete'); // non-critical — suppressed
    expect(Haptics.impactAsync).not.toHaveBeenCalled();

    hapticBus.emit('fault.critical'); // critical — allowed
    expect(Haptics.notificationAsync).toHaveBeenCalledWith('error');
  });

  it('off mode blocks all events', () => {
    hapticBus.setMode('off');
    advance(3000);
    hapticBus.emit('pr.hit');
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
  });

  it('setEnabled(false) blocks emits', () => {
    hapticBus.setEnabled(false);
    advance(4000);
    hapticBus.emit('rep.complete');
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });

  it('notifies onEvent listeners for every played event', () => {
    const listener = jest.fn();
    const unsub = hapticBus.onEvent(listener);
    advance(5000);
    hapticBus.emit('rest.done');
    expect(listener).toHaveBeenCalledWith('rest.done');
    unsub();
  });

  it('maps each HapticEvent to a known severity', () => {
    const events: HapticEvent[] = [
      'rep.complete',
      'fault.critical',
      'fault.warning',
      'tracking.lost',
      'tracking.recovered',
      'calibration.complete',
      'calibration.failed',
      'rest.tick10s',
      'rest.done',
      'pr.hit',
      'fqi.bucket-down',
      'fqi.bucket-up',
    ];
    events.forEach((event, i) => {
      // Space far enough apart to clear the debounce.
      advance(10_000 + i * 5_000);
      hapticBus.emit(event);
    });
    // 6 notification severities, 6 impact severities — they all map somewhere.
    const totalCalls =
      (Haptics.impactAsync as jest.Mock).mock.calls.length +
      (Haptics.notificationAsync as jest.Mock).mock.calls.length;
    expect(totalCalls).toBe(events.length);
  });
});

describe('hapticBus (android)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.doMock('react-native', () => ({
      Platform: { OS: 'android' },
      Vibration: { vibrate: (pattern: number | number[]) => mockVibrate(pattern) },
    }));
  });

  it('falls back to Vibration.vibrate patterns', () => {
    const { hapticBus: androidBus } = require('@/lib/haptics/haptic-bus') as typeof import('@/lib/haptics/haptic-bus');
    androidBus._reset();
    jest.spyOn(Date, 'now').mockReturnValue(1000);
    androidBus.emit('rep.complete');
    expect(mockVibrate).toHaveBeenCalledWith(15);
    jest.spyOn(Date, 'now').mockReturnValue(5000);
    androidBus.emit('pr.hit');
    expect(mockVibrate).toHaveBeenLastCalledWith([0, 25, 60, 25]);
  });
});
