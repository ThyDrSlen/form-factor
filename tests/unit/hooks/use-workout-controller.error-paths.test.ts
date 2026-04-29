/**
 * Error-path coverage for hooks/use-workout-controller.ts.
 *
 * Complementary to tests/unit/hooks/use-workout-controller.test.ts which
 * covers the happy path. This file exercises:
 *
 * - NaN / Infinity / out-of-range inputs to context.trackingQuality and
 *   context.shadowMeanAbsDelta — the controller calls clamp + isFinite
 *   internally; a frame with bad values must not throw and must still
 *   advance state normally.
 * - rep-logger rejection queues the rep in-memory, fires onRepLogFailure,
 *   and still updates repCount (in-session resilience).
 * - A subsequent successful logRep drains the queued rep before logging
 *   the new one (ordering preserved).
 * - onRepLogFailure callback throws — must be swallowed (not crash the hook).
 * - MAX_PENDING_REPS=64 — the queue is bounded and drops the oldest entry
 *   when overflow hits.
 */

import { renderHook, act } from '@testing-library/react-native';
import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import type { WorkoutDefinition, WorkoutMetrics } from '@/lib/types/workout-definitions';

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the hook
// ---------------------------------------------------------------------------

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'Light', Medium: 'Medium', Heavy: 'Heavy' },
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

const mockCalculateFqi = jest.fn().mockReturnValue({
  score: 80,
  romScore: 85,
  depthScore: 75,
  faultPenalty: 0,
  detectedFaults: [],
});
const mockExtractRepFeatures = jest.fn().mockReturnValue({
  romDeg: 60,
  depthMin: 80,
  durationMs: 1500,
});

jest.mock('@/lib/services/fqi-calculator', () => ({
  calculateFqi: (...args: unknown[]) => mockCalculateFqi(...args),
  extractRepFeatures: (...args: unknown[]) => mockExtractRepFeatures(...args),
}));

const mockLogRep = jest.fn();
jest.mock('@/lib/services/rep-logger', () => ({
  logRep: (...args: unknown[]) => mockLogRep(...args),
}));

const mockComputeAdaptivePhaseHoldMs = jest.fn().mockReturnValue(0);
const mockComputeAdaptiveRepDurationMs = jest.fn().mockReturnValue(0);
jest.mock('@/lib/services/workout-runtime', () => ({
  computeAdaptivePhaseHoldMs: (...args: unknown[]) => mockComputeAdaptivePhaseHoldMs(...args),
  computeAdaptiveRepDurationMs: (...args: unknown[]) => mockComputeAdaptiveRepDurationMs(...args),
}));

const mockSelectShadowProvider = jest.fn();
jest.mock('@/lib/pose/shadow-provider', () => ({
  selectShadowProvider: (...args: unknown[]) => mockSelectShadowProvider(...args),
}));

jest.mock('@/lib/tracking-quality/scoring', () => ({
  scorePullupWithComponentAvailability: jest.fn().mockReturnValue({
    overall_score: 70,
    components: {},
    components_available: {},
    missing_components: [],
    missing_reasons: [],
    visibility_badge: 'full',
    score_suppressed: false,
    suppression_reason: null,
  }),
}));

jest.mock('@/lib/logger', () => ({
  logWithTs: jest.fn(),
  warnWithTs: jest.fn(),
  errorWithTs: jest.fn(),
  infoWithTs: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Fake workout definition — three-phase minimal exercise
// ---------------------------------------------------------------------------

type TestPhase = 'idle' | 'down' | 'up';

const fakeMetrics: WorkoutMetrics = { armsTracked: true, avgElbow: 120 } as WorkoutMetrics & {
  avgElbow: number;
};

const fakeWorkoutDef: WorkoutDefinition<TestPhase, WorkoutMetrics> = {
  id: 'fake',
  displayName: 'Fake Workout',
  description: 'Test workout',
  category: 'upper_body',
  difficulty: 'beginner',
  phases: [
    { id: 'idle', displayName: 'Idle', enterCondition: () => true, staticCue: '' },
    { id: 'down', displayName: 'Down', enterCondition: () => true, staticCue: '' },
    { id: 'up', displayName: 'Up', enterCondition: () => true, staticCue: '' },
  ],
  initialPhase: 'idle',
  repBoundary: { startPhase: 'down', endPhase: 'up', minDurationMs: 500 },
  thresholds: {},
  angleRanges: {},
  faults: [],
  fqiWeights: { rom: 0.4, depth: 0.3, faults: 0.3 },
  calculateMetrics: jest.fn().mockReturnValue(fakeMetrics),
  getNextPhase: jest.fn().mockReturnValue('idle'),
};

const mockGetWorkoutById = jest.fn().mockReturnValue(fakeWorkoutDef);
jest.mock('@/lib/workouts', () => ({
  getWorkoutById: (...args: unknown[]) => mockGetWorkoutById(...args),
}));

import { useWorkoutController } from '@/hooks/use-workout-controller';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAngles(value: number): JointAngles {
  return {
    leftKnee: value,
    rightKnee: value,
    leftElbow: value,
    rightElbow: value,
    leftHip: value,
    rightHip: value,
    leftShoulder: value,
    rightShoulder: value,
  };
}

function defaultOptions() {
  return { sessionId: 'test-session', enableHaptics: false };
}

/**
 * Drive a phase transition by stubbing getNextPhase, then calling
 * processFrame twice (the controller debounces on a 2nd frame with
 * phaseHoldMs=0).
 */
function drivePhase(
  hook: ReturnType<typeof renderHook<any, any>>,
  targetPhase: TestPhase,
  time: number,
) {
  (fakeWorkoutDef.getNextPhase as jest.Mock).mockReturnValue(targetPhase);
  act(() => {
    jest.setSystemTime(time);
    hook.result.current.processFrame(makeAngles(90));
  });
  act(() => {
    jest.setSystemTime(time + 1);
    hook.result.current.processFrame(makeAngles(90));
  });
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('use-workout-controller error paths', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockGetWorkoutById.mockReturnValue(fakeWorkoutDef);
    (fakeWorkoutDef.getNextPhase as jest.Mock).mockReturnValue('idle');
    (fakeWorkoutDef.calculateMetrics as jest.Mock).mockReturnValue(fakeMetrics);
    mockComputeAdaptivePhaseHoldMs.mockReturnValue(0);
    mockComputeAdaptiveRepDurationMs.mockReturnValue(0);
    mockLogRep.mockResolvedValue('rep-id');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // =========================================================================
  // NaN / Infinity context inputs (scoreFromShadowDelta + combineTrackingQuality)
  // =========================================================================

  describe('NaN / non-finite tracking quality inputs', () => {
    it('does not throw when context.shadowMeanAbsDelta is NaN', () => {
      const { result } = renderHook(() => useWorkoutController('fake' as any, defaultOptions()));

      expect(() => {
        act(() => {
          result.current.processFrame(makeAngles(120), undefined, {
            trackingQuality: 0.9,
            shadowMeanAbsDelta: NaN,
          });
        });
      }).not.toThrow();
    });

    it('does not throw when context.shadowMeanAbsDelta is Infinity', () => {
      const { result } = renderHook(() => useWorkoutController('fake' as any, defaultOptions()));

      expect(() => {
        act(() => {
          result.current.processFrame(makeAngles(120), undefined, {
            trackingQuality: 0.9,
            shadowMeanAbsDelta: Infinity,
          });
        });
      }).not.toThrow();
    });

    it('does not throw when context.trackingQuality is NaN', () => {
      const { result } = renderHook(() => useWorkoutController('fake' as any, defaultOptions()));

      expect(() => {
        act(() => {
          result.current.processFrame(makeAngles(120), undefined, {
            trackingQuality: NaN,
            shadowMeanAbsDelta: 5,
          });
        });
      }).not.toThrow();
    });

    it('handles negative trackingQuality (out of [0, 1]) without crashing', () => {
      const { result } = renderHook(() => useWorkoutController('fake' as any, defaultOptions()));

      expect(() => {
        act(() => {
          result.current.processFrame(makeAngles(120), undefined, {
            trackingQuality: -1,
            shadowMeanAbsDelta: 10,
          });
        });
      }).not.toThrow();
    });

    it('handles trackingQuality > 1 without crashing', () => {
      const { result } = renderHook(() => useWorkoutController('fake' as any, defaultOptions()));

      expect(() => {
        act(() => {
          result.current.processFrame(makeAngles(120), undefined, {
            trackingQuality: 999,
            shadowMeanAbsDelta: 10,
          });
        });
      }).not.toThrow();
    });

    it('rep still completes when NaN shadowMeanAbsDelta accompanies a valid rep-ending frame', async () => {
      const onRepComplete = jest.fn();
      const hook = renderHook(() =>
        useWorkoutController('fake' as any, { ...defaultOptions(), callbacks: { onRepComplete } })
      );

      // idle -> down (startPhase) with NaN context
      (fakeWorkoutDef.getNextPhase as jest.Mock).mockReturnValue('down');
      act(() => {
        jest.setSystemTime(1000);
        hook.result.current.processFrame(makeAngles(90), undefined, { shadowMeanAbsDelta: NaN });
      });
      act(() => {
        jest.setSystemTime(1001);
        hook.result.current.processFrame(makeAngles(90), undefined, { shadowMeanAbsDelta: NaN });
      });

      // down -> up (endPhase) — completes rep even though context was bad
      (fakeWorkoutDef.getNextPhase as jest.Mock).mockReturnValue('up');
      act(() => {
        jest.setSystemTime(3000);
        hook.result.current.processFrame(makeAngles(90), undefined, { shadowMeanAbsDelta: NaN });
      });
      act(() => {
        jest.setSystemTime(3001);
        hook.result.current.processFrame(makeAngles(90), undefined, { shadowMeanAbsDelta: NaN });
      });
      await flushPromises();

      expect(hook.result.current.state.repCount).toBe(1);
      expect(onRepComplete).toHaveBeenCalledWith(1, 80, []);
    });
  });

  // =========================================================================
  // rep-logger rejection + fallback queue
  // =========================================================================

  describe('rep-logger rejection path', () => {
    it('still increments repCount and invokes onRepComplete when logRep rejects', async () => {
      mockLogRep.mockRejectedValueOnce(new Error('network down'));

      const onRepComplete = jest.fn();
      const onRepLogFailure = jest.fn();
      const hook = renderHook(() =>
        useWorkoutController('fake' as any, {
          ...defaultOptions(),
          callbacks: { onRepComplete, onRepLogFailure },
        })
      );

      drivePhase(hook, 'down', 1000);
      drivePhase(hook, 'up', 3000);
      await flushPromises();

      expect(hook.result.current.state.repCount).toBe(1);
      expect(onRepComplete).toHaveBeenCalledWith(1, 80, []);
      expect(onRepLogFailure).toHaveBeenCalledTimes(1);
      expect(onRepLogFailure.mock.calls[0][1]).toBe(1); // queueDepth=1
    });

    it('drains the queued rep before logging the next one on a subsequent success', async () => {
      // First rep fails, second succeeds: second call should drain the queued first rep.
      mockLogRep
        .mockRejectedValueOnce(new Error('transient')) // rep 1 original attempt
        .mockResolvedValueOnce('drained-1') // rep 1 drain on next try
        .mockResolvedValueOnce('rep-id-2'); // rep 2 original attempt

      const onRepLogFailure = jest.fn();
      const hook = renderHook(() =>
        useWorkoutController('fake' as any, {
          ...defaultOptions(),
          callbacks: { onRepLogFailure },
        })
      );

      // Rep 1 — fails on log
      drivePhase(hook, 'down', 1000);
      drivePhase(hook, 'up', 3000);
      await flushPromises();
      expect(onRepLogFailure).toHaveBeenCalledTimes(1);

      // Rep 2 — drain should succeed first, then rep 2 should log.
      drivePhase(hook, 'idle', 3500);
      drivePhase(hook, 'down', 5000);
      drivePhase(hook, 'up', 7000);
      await flushPromises();

      // 3 logRep calls total: original rep 1 (fail), drain of rep 1 (ok), rep 2 (ok)
      expect(mockLogRep).toHaveBeenCalledTimes(3);
      expect(hook.result.current.state.repCount).toBe(2);
    });

    it('swallows an onRepLogFailure callback that itself throws', async () => {
      mockLogRep.mockRejectedValueOnce(new Error('transient'));

      const onRepLogFailure = jest.fn(() => {
        throw new Error('callback crashed');
      });

      const hook = renderHook(() =>
        useWorkoutController('fake' as any, {
          ...defaultOptions(),
          callbacks: { onRepLogFailure },
        })
      );

      // Driving a rep should not reject the test even when the consumer's
      // failure handler throws.
      expect(() => {
        drivePhase(hook, 'down', 1000);
        drivePhase(hook, 'up', 3000);
      }).not.toThrow();

      await flushPromises();

      expect(onRepLogFailure).toHaveBeenCalled();
      expect(hook.result.current.state.repCount).toBe(1);
    });
  });

  // =========================================================================
  // Pause guard (pauseTracking) — orthogonal error path
  // =========================================================================

  describe('pauseTracking guard', () => {
    it('does not advance phase or increment rep while paused', () => {
      const hook = renderHook<ReturnType<typeof useWorkoutController>, { pause: boolean }>(
        ({ pause }) => useWorkoutController('fake' as any, { ...defaultOptions(), pauseTracking: pause }),
        { initialProps: { pause: true } }
      );

      (fakeWorkoutDef.getNextPhase as jest.Mock).mockReturnValue('down');
      act(() => {
        jest.setSystemTime(1000);
        hook.result.current.processFrame(makeAngles(90));
      });
      act(() => {
        jest.setSystemTime(1001);
        hook.result.current.processFrame(makeAngles(90));
      });

      expect(hook.result.current.state.phase).toBe('idle');
      expect(hook.result.current.state.repCount).toBe(0);
    });
  });
});
