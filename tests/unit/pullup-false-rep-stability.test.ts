import { renderHook, act } from '@testing-library/react-native';
import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import { useWorkoutController } from '@/hooks/use-workout-controller';
import { PULLUP_THRESHOLDS } from '@/lib/workouts/pullup';

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'Light' },
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

jest.mock('@/lib/logger', () => ({
  errorWithTs: jest.fn(),
  logWithTs: jest.fn(),
  warnWithTs: jest.fn(),
}));

jest.mock('@/lib/services/rep-logger', () => ({
  logRep: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/services/fqi-calculator', () => ({
  calculateFqi: jest.fn(() => ({ score: 100, detectedFaults: [] })),
  extractRepFeatures: jest.fn(() => ({ romDeg: 0, depthMin: 0, durationMs: 0 })),
}));

const baseAngles: JointAngles = {
  leftKnee: 120,
  rightKnee: 121,
  leftElbow: 160,
  rightElbow: 160,
  leftHip: 140,
  rightHip: 141,
  leftShoulder: 90,
  rightShoulder: 91,
};

function withElbows(elbowDeg: number): JointAngles {
  return {
    ...baseAngles,
    leftElbow: elbowDeg,
    rightElbow: elbowDeg,
  };
}

function stableContext() {
  return { trackingQuality: 1, shadowMeanAbsDelta: 0 };
}

describe('pullup false-rep stability fixtures', () => {
  let nowSpy: jest.SpyInstance<number, []>;

  beforeEach(() => {
    jest.clearAllMocks();
    nowSpy = jest.spyOn(Date, 'now');
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  it('setup: brief pre-pull movement does not start a rep', () => {
    const { result } = renderHook(() =>
      useWorkoutController('pullup', { sessionId: 'test-session', enableHaptics: false })
    );

    const ctx = stableContext();
    const hang = PULLUP_THRESHOLDS.hang + 5;
    const engage = PULLUP_THRESHOLDS.engage - 5;
    const midSetup = PULLUP_THRESHOLDS.engage + 5;
    const holdMs = 45;

    const frame = (tMs: number, elbow: number) => {
      nowSpy.mockReturnValue(tMs);
      act(() => result.current.processFrame(withElbows(elbow), undefined, ctx));
    };

    const hold = (tMs: number, elbow: number) => {
      frame(tMs, elbow);
      frame(tMs + holdMs, elbow);
      return tMs + holdMs;
    };

    let t = 10_000;

    hold(t, midSetup);
    expect(result.current.state.phase).toBe('idle');
    expect(result.current.state.repCount).toBe(0);

    t += 100;
    hold(t, hang);
    expect(result.current.state.phase).toBe('hang');
    expect(result.current.state.repCount).toBe(0);

    frame(t + 50, engage);
    frame(t + 70, hang);
    expect(result.current.state.phase).toBe('hang');
    expect(result.current.state.repCount).toBe(0);
  });

  it('bounce: pull→top→pull→top within debounce window only counts 1 rep', () => {
    const { result } = renderHook(() =>
      useWorkoutController('pullup', { sessionId: 'test-session', enableHaptics: false })
    );

    const ctx = stableContext();
    const hang = PULLUP_THRESHOLDS.hang + 5;
    const pull = PULLUP_THRESHOLDS.engage - 5;
    const top = PULLUP_THRESHOLDS.top - 5;
    const releaseToHang = PULLUP_THRESHOLDS.release + 10;

    let t = 20_000;
    const holdMs = 45;

    const frame = (tMs: number, elbow: number) => {
      nowSpy.mockReturnValue(tMs);
      act(() => result.current.processFrame(withElbows(elbow), undefined, ctx));
    };

    const hold = (tMs: number, elbow: number) => {
      frame(tMs, elbow);
      frame(tMs + holdMs, elbow);
      return tMs + holdMs;
    };

    t = hold(t, hang);
    expect(result.current.state.phase).toBe('hang');

    t = hold(t, pull);
    expect(result.current.state.phase).toBe('pull');

    t = hold(t, top);
    expect(result.current.state.phase).toBe('top');
    expect(result.current.state.repCount).toBe(1);

    t = hold(t, releaseToHang);
    expect(result.current.state.phase).toBe('hang');
    expect(result.current.state.repCount).toBe(1);

    t = hold(t, pull);
    expect(result.current.state.phase).toBe('pull');

    hold(t, top);
    expect(result.current.state.phase).toBe('top');
    expect(result.current.state.repCount).toBe(1);
  });

  it('incomplete ROM: pull that never reaches top threshold does not complete a rep', () => {
    const { result } = renderHook(() =>
      useWorkoutController('pullup', { sessionId: 'test-session', enableHaptics: false })
    );

    const ctx = stableContext();
    const hang = PULLUP_THRESHOLDS.hang + 5;
    const pull = PULLUP_THRESHOLDS.engage - 5;
    const aboveTopThreshold = PULLUP_THRESHOLDS.top + 5;

    let t = 30_000;
    const holdMs = 45;

    const frame = (tMs: number, elbow: number) => {
      nowSpy.mockReturnValue(tMs);
      act(() => result.current.processFrame(withElbows(elbow), undefined, ctx));
    };

    const hold = (tMs: number, elbow: number) => {
      frame(tMs, elbow);
      frame(tMs + holdMs, elbow);
      return tMs + holdMs;
    };

    t = hold(t, hang);
    expect(result.current.state.phase).toBe('hang');

    t = hold(t, pull);
    expect(result.current.state.phase).toBe('pull');

    t = hold(t, aboveTopThreshold);
    expect(result.current.state.phase).toBe('pull');
    expect(result.current.state.repCount).toBe(0);

    hold(t, hang);
    expect(result.current.state.phase).toBe('hang');
    expect(result.current.state.repCount).toBe(0);
  });

  it('live partial status should emit pullup scoring before rep completion (RED)', () => {
    const onPullupScoring = jest.fn();
    const { result } = renderHook(() =>
      useWorkoutController('pullup', {
        sessionId: 'test-session',
        enableHaptics: false,
        callbacks: { onPullupScoring },
      })
    );

    const ctx = stableContext();
    const hang = PULLUP_THRESHOLDS.hang + 5;
    const pull = PULLUP_THRESHOLDS.engage - 5;
    const aboveTopThreshold = PULLUP_THRESHOLDS.top + 5;

    let t = 40_000;
    const holdMs = 45;

    const frame = (tMs: number, elbow: number) => {
      nowSpy.mockReturnValue(tMs);
      act(() => result.current.processFrame(withElbows(elbow), undefined, ctx));
    };

    const hold = (tMs: number, elbow: number) => {
      frame(tMs, elbow);
      frame(tMs + holdMs, elbow);
      return tMs + holdMs;
    };

    t = hold(t, hang);
    t = hold(t, pull);
    t = hold(t, aboveTopThreshold);

    expect(result.current.state.repCount).toBe(0);
    expect(onPullupScoring).toHaveBeenCalled();
  });
});
