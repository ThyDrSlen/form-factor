jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

jest.mock('expo-notifications', () => ({
  scheduleNotificationAsync: jest.fn().mockResolvedValue('mock-id'),
  cancelScheduledNotificationAsync: jest.fn().mockResolvedValue(undefined),
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'time-interval' },
}));

import { hapticBus } from '@/lib/haptics/haptic-bus';
import {
  beginCalibration,
  createCalibrationState,
  finalizeCalibration,
  type CalibrationSample,
} from '@/lib/fusion/calibration';
import {
  startForegroundRestHapticCompanion,
  stopForegroundRestHapticCompanion,
} from '@/lib/services/rest-timer';
import { emitPrHitIfRecord } from '@/lib/services/rep-logger';

function snapshotEmissions() {
  const events: string[] = [];
  const unsub = hapticBus.onEvent((e) => events.push(e));
  return {
    events,
    stop: () => unsub(),
  };
}

const sampleVec = { x: 0, y: 1, z: 0 };
const sampleEntry: CalibrationSample = {
  cameraUp: sampleVec,
  watchForward: sampleVec,
  headForward: sampleVec,
  stability: 0.9,
};

describe('calibration haptic emissions', () => {
  beforeEach(() => {
    hapticBus._reset();
    jest.spyOn(Date, 'now').mockReturnValue(10_000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('emits calibration.complete when finalize succeeds', () => {
    const state = createCalibrationState();
    beginCalibration(state, 0);
    for (let i = 0; i < 5; i++) {
      state.samples.push(sampleEntry);
    }
    const { events, stop } = snapshotEmissions();
    finalizeCalibration(state, 1000);
    expect(events).toContain('calibration.complete');
    stop();
  });

  it('emits calibration.failed when finalize cannot complete', () => {
    const state = createCalibrationState();
    const { events, stop } = snapshotEmissions();
    finalizeCalibration(state, 1000);
    expect(events).toContain('calibration.failed');
    stop();
  });
});

describe('rest timer foreground companion', () => {
  beforeEach(() => {
    hapticBus._reset();
    jest.useFakeTimers();
    jest.spyOn(Date, 'now').mockReturnValue(10_000);
  });

  afterEach(() => {
    stopForegroundRestHapticCompanion();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('emits rest.done when the countdown hits zero', () => {
    const { events, stop } = snapshotEmissions();
    startForegroundRestHapticCompanion(new Date(10_000).toISOString(), 1); // 1s
    // Pretend 2s later
    (Date.now as jest.Mock).mockReturnValue(12_000);
    jest.advanceTimersByTime(1000);
    expect(events).toContain('rest.done');
    stop();
  });

  it('emits rest.tick10s inside the 30s window once per bucket', () => {
    const { events, stop } = snapshotEmissions();
    // Use a fresh bus (critical-mode resets so tick10s not blocked).
    startForegroundRestHapticCompanion(new Date(10_000).toISOString(), 25); // 25s
    jest.advanceTimersByTime(1000);
    expect(events.filter((e) => e === 'rest.tick10s').length).toBeGreaterThanOrEqual(1);
    stop();
  });
});

describe('emitPrHitIfRecord', () => {
  beforeEach(() => {
    hapticBus._reset();
    jest.spyOn(Date, 'now').mockReturnValue(20_000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('emits pr.hit when the new metric exceeds the baseline', () => {
    const { events, stop } = snapshotEmissions();
    const hit = emitPrHitIfRecord({ currentMetric: 120, baselineMetric: 100 });
    expect(hit).toBe(true);
    expect(events).toContain('pr.hit');
    stop();
  });

  it('does not emit when metric <= baseline', () => {
    const { events, stop } = snapshotEmissions();
    const hit = emitPrHitIfRecord({ currentMetric: 100, baselineMetric: 100 });
    expect(hit).toBe(false);
    expect(events).not.toContain('pr.hit');
    stop();
  });

  it('handles higherIsBetter=false (e.g. time-based PRs)', () => {
    const { events, stop } = snapshotEmissions();
    const hit = emitPrHitIfRecord({
      currentMetric: 45,
      baselineMetric: 60,
      higherIsBetter: false,
    });
    expect(hit).toBe(true);
    expect(events).toContain('pr.hit');
    stop();
  });

  it('returns false when baseline is nullish', () => {
    const hit = emitPrHitIfRecord({ currentMetric: 100, baselineMetric: null });
    expect(hit).toBe(false);
  });
});
