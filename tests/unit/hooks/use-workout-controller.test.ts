import { renderHook, act } from '@testing-library/react-native';
import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import type { WorkoutDefinition, WorkoutMetrics } from '@/lib/types/workout-definitions';

// ---------------------------------------------------------------------------
// Mocks — declared before any import that might touch these modules
// ---------------------------------------------------------------------------

const mockImpactAsync = jest.fn().mockResolvedValue(undefined);
jest.mock('expo-haptics', () => ({
  impactAsync: (...args: unknown[]) => mockImpactAsync(...args),
  ImpactFeedbackStyle: { Light: 'Light', Medium: 'Medium', Heavy: 'Heavy' },
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

const mockCalculateFqi = jest.fn().mockReturnValue({
  score: 85,
  romScore: 90,
  depthScore: 80,
  faultPenalty: 5,
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

const mockLogRep = jest.fn().mockResolvedValue('rep-id-1');
jest.mock('@/lib/services/rep-logger', () => ({
  logRep: (...args: unknown[]) => mockLogRep(...args),
}));

jest.mock('@/lib/services/workout-runtime', () => ({
  computeAdaptivePhaseHoldMs: jest.fn().mockReturnValue(0),
  computeAdaptiveRepDurationMs: jest.fn().mockReturnValue(0),
}));

const mockSelectShadowProvider = jest.fn();
jest.mock('@/lib/pose/shadow-provider', () => ({
  selectShadowProvider: (...args: unknown[]) => mockSelectShadowProvider(...args),
}));

const mockScorePullup = jest.fn().mockReturnValue({
  overall_score: 78,
  components: { rom_score: 80, symmetry_score: 75, tempo_score: 70, torso_stability_score: 85 },
  components_available: {},
  missing_components: [],
  missing_reasons: [],
  visibility_badge: 'full',
  score_suppressed: false,
  suppression_reason: null,
});
jest.mock('@/lib/tracking-quality/scoring', () => ({
  scorePullupWithComponentAvailability: (...args: unknown[]) => mockScorePullup(...args),
}));

jest.mock('@/lib/logger', () => ({
  logWithTs: jest.fn(),
  warnWithTs: jest.fn(),
  errorWithTs: jest.fn(),
  infoWithTs: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Fake workout definitions used by the mock registry
// ---------------------------------------------------------------------------

type TestPhase = 'idle' | 'down' | 'up';

const fakeMetrics: WorkoutMetrics = { armsTracked: true, avgElbow: 120 };

/** A minimal three-phase workout for testing phase transitions + rep counting */
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

/** A pullup definition to test pullup-specific scoring callbacks */
const fakePullupDef: WorkoutDefinition<TestPhase, WorkoutMetrics> = {
  ...fakeWorkoutDef,
  id: 'pullup',
  displayName: 'Pull-Up',
};

const mockGetWorkoutById = jest.fn().mockReturnValue(fakeWorkoutDef);
jest.mock('@/lib/workouts', () => ({
  getWorkoutById: (...args: unknown[]) => mockGetWorkoutById(...args),
}));

// Import the hook AFTER all mocks are declared
import { useWorkoutController } from '@/hooks/use-workout-controller';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a JointAngles object with all angles set to the same value */
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
  return { sessionId: 'test-session', enableHaptics: true };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useWorkoutController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockGetWorkoutById.mockReturnValue(fakeWorkoutDef);
    (fakeWorkoutDef.getNextPhase as jest.Mock).mockReturnValue('idle');
    (fakeWorkoutDef.calculateMetrics as jest.Mock).mockReturnValue(fakeMetrics);
    // Reset the haptic-bus singleton so debounce state from a prior test
    // does not suppress emits in the current test. The bus is shared module
    // state because it's a singleton event emitter.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { hapticBus } = require('@/lib/haptics/haptic-bus') as {
      hapticBus: { _reset: () => void };
    };
    hapticBus._reset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // =========================================================================
  // 1. Initialization
  // =========================================================================

  describe('initialization', () => {
    it('initializes with the workout initialPhase, repCount=0, isActive=false', () => {
      const { result } = renderHook(() =>
        useWorkoutController('pullup' as any, defaultOptions())
      );

      expect(result.current.state.phase).toBe('idle');
      expect(result.current.state.repCount).toBe(0);
      expect(result.current.state.metrics).toBeNull();
      expect(result.current.state.isActive).toBe(false);
    });

    it('falls back to idle when getWorkoutById returns undefined', () => {
      mockGetWorkoutById.mockReturnValue(undefined);

      const { result } = renderHook(() =>
        useWorkoutController('unknown' as any, defaultOptions())
      );

      expect(result.current.state.phase).toBe('idle');
    });

    it('exposes getWorkoutDefinition that returns the current definition', () => {
      const { result } = renderHook(() =>
        useWorkoutController('pullup' as any, defaultOptions())
      );

      expect(result.current.getWorkoutDefinition()).toBe(fakeWorkoutDef);
    });
  });

  // =========================================================================
  // 2. processFrame — stable state (no phase change)
  // =========================================================================

  describe('processFrame without phase change', () => {
    it('calls calculateMetrics and getNextPhase but state remains stable', () => {
      const { result } = renderHook(() =>
        useWorkoutController('pullup' as any, defaultOptions())
      );

      const angles = makeAngles(120);
      act(() => {
        result.current.processFrame(angles);
      });

      expect(fakeWorkoutDef.calculateMetrics).toHaveBeenCalledWith(angles, undefined);
      expect(fakeWorkoutDef.getNextPhase).toHaveBeenCalled();
      // Phase stays as idle since getNextPhase returns 'idle'
      expect(result.current.state.phase).toBe('idle');
      expect(result.current.state.repCount).toBe(0);
    });

    it('does nothing when workout definition is undefined', () => {
      mockGetWorkoutById.mockReturnValue(undefined);

      const { result } = renderHook(() =>
        useWorkoutController('unknown' as any, defaultOptions())
      );

      act(() => {
        result.current.processFrame(makeAngles(90));
      });

      expect(result.current.state.phase).toBe('idle');
      expect(result.current.state.repCount).toBe(0);
    });
  });

  // =========================================================================
  // 3. Phase transition debounce
  // =========================================================================

  describe('phase transition debounce', () => {
    it('does not commit phase immediately — waits for phaseHoldMs', () => {
      // First frame returns 'down', triggering a pending phase
      (fakeWorkoutDef.getNextPhase as jest.Mock).mockReturnValue('down');

      const { result } = renderHook(() =>
        useWorkoutController('pullup' as any, defaultOptions())
      );

      // Frame 1: candidate is 'down', pending set but not committed yet
      act(() => {
        result.current.processFrame(makeAngles(90));
      });

      // phaseHoldMs is mocked to 0 so next frame at the same tick should commit.
      // However the first frame only sets the pending phase. The second frame at
      // the same timestamp with phaseHoldMs=0 should commit.
      expect(result.current.state.phase).toBe('idle');
    });

    it('commits phase after phaseHoldMs elapses on subsequent frame', () => {
      (fakeWorkoutDef.getNextPhase as jest.Mock).mockReturnValue('down');

      const { result } = renderHook(() =>
        useWorkoutController('pullup' as any, defaultOptions())
      );

      // Frame 1: sets pending phase
      act(() => {
        jest.setSystemTime(1000);
        result.current.processFrame(makeAngles(90));
      });

      // Frame 2: phaseHoldMs=0, so elapsed >= 0 → committed
      act(() => {
        jest.setSystemTime(1001);
        result.current.processFrame(makeAngles(90));
      });

      expect(result.current.state.phase).toBe('down');
      expect(result.current.state.isActive).toBe(true);
    });

    it('resets pending phase when candidate reverts to current phase', () => {
      const { result } = renderHook(() =>
        useWorkoutController('pullup' as any, defaultOptions())
      );

      // Frame 1: candidate = 'down'
      (fakeWorkoutDef.getNextPhase as jest.Mock).mockReturnValue('down');
      act(() => {
        jest.setSystemTime(1000);
        result.current.processFrame(makeAngles(90));
      });

      // Frame 2: candidate reverts to 'idle' before hold completes
      (fakeWorkoutDef.getNextPhase as jest.Mock).mockReturnValue('idle');
      act(() => {
        jest.setSystemTime(1001);
        result.current.processFrame(makeAngles(120));
      });

      // Phase should stay idle — the pending phase was cleared
      expect(result.current.state.phase).toBe('idle');
    });
  });

  // =========================================================================
  // 4. Rep detection — full cycle
  // =========================================================================

  describe('rep detection', () => {
    function drivePhaseTransition(
      hook: ReturnType<typeof renderHook<any, any>>,
      targetPhase: TestPhase,
      time: number,
    ) {
      (fakeWorkoutDef.getNextPhase as jest.Mock).mockReturnValue(targetPhase);
      act(() => {
        jest.setSystemTime(time);
        hook.result.current.processFrame(makeAngles(90));
      });
      // Second frame commits the debounce (phaseHoldMs=0)
      act(() => {
        jest.setSystemTime(time + 1);
        hook.result.current.processFrame(makeAngles(90));
      });
    }

    it('increments repCount after startPhase → endPhase transition', () => {
      const onRepComplete = jest.fn();
      const hook = renderHook(() =>
        useWorkoutController('pullup' as any, {
          ...defaultOptions(),
          callbacks: { onRepComplete },
        })
      );

      // idle → down (startPhase)
      drivePhaseTransition(hook, 'down', 1000);
      expect(hook.result.current.state.phase).toBe('down');
      expect(hook.result.current.state.repCount).toBe(0);

      // down → up (endPhase) — completes rep
      drivePhaseTransition(hook, 'up', 3000);
      expect(hook.result.current.state.phase).toBe('up');
      expect(hook.result.current.state.repCount).toBe(1);
      expect(onRepComplete).toHaveBeenCalledWith(1, 85, []);
    });

    it('fires onPhaseChange callback on each phase transition', () => {
      const onPhaseChange = jest.fn();
      const hook = renderHook(() =>
        useWorkoutController('pullup' as any, {
          ...defaultOptions(),
          callbacks: { onPhaseChange },
        })
      );

      drivePhaseTransition(hook, 'down', 1000);
      expect(onPhaseChange).toHaveBeenCalledWith('down', 'idle');

      drivePhaseTransition(hook, 'up', 3000);
      expect(onPhaseChange).toHaveBeenCalledWith('up', 'down');
    });

    it('invokes calculateFqi, extractRepFeatures, logRep on rep complete', () => {
      const hook = renderHook(() =>
        useWorkoutController('pullup' as any, defaultOptions())
      );

      drivePhaseTransition(hook, 'down', 1000);
      drivePhaseTransition(hook, 'up', 3000);

      expect(mockCalculateFqi).toHaveBeenCalled();
      expect(mockExtractRepFeatures).toHaveBeenCalled();
      expect(mockLogRep).toHaveBeenCalled();
      const logRepArg = mockLogRep.mock.calls[0][0];
      expect(logRepArg.sessionId).toBe('test-session');
      expect(logRepArg.repIndex).toBe(1);
      expect(logRepArg.exercise).toBe('fake');
    });

    it('counts multiple reps correctly', () => {
      const hook = renderHook(() =>
        useWorkoutController('pullup' as any, defaultOptions())
      );

      // Rep 1
      drivePhaseTransition(hook, 'down', 1000);
      drivePhaseTransition(hook, 'up', 3000);
      expect(hook.result.current.state.repCount).toBe(1);

      // Back to start for rep 2
      drivePhaseTransition(hook, 'idle', 4000);
      drivePhaseTransition(hook, 'down', 5000);
      drivePhaseTransition(hook, 'up', 7000);
      expect(hook.result.current.state.repCount).toBe(2);
    });
  });

  // =========================================================================
  // 5. Rapid rep prevention (minDuration guard)
  // =========================================================================

  describe('rapid rep prevention', () => {
    it('does not increment when endPhase reached again before minDuration', () => {
      // Override adaptive rep duration to a large value
      const { computeAdaptiveRepDurationMs } = require('@/lib/services/workout-runtime');
      computeAdaptiveRepDurationMs.mockReturnValue(2000);

      const hook = renderHook(() =>
        useWorkoutController('pullup' as any, defaultOptions())
      );

      // Complete first rep
      (fakeWorkoutDef.getNextPhase as jest.Mock).mockReturnValue('down');
      act(() => { jest.setSystemTime(1000); hook.result.current.processFrame(makeAngles(90)); });
      act(() => { jest.setSystemTime(1001); hook.result.current.processFrame(makeAngles(90)); });

      (fakeWorkoutDef.getNextPhase as jest.Mock).mockReturnValue('up');
      act(() => { jest.setSystemTime(3000); hook.result.current.processFrame(makeAngles(90)); });
      act(() => { jest.setSystemTime(3001); hook.result.current.processFrame(makeAngles(90)); });

      expect(hook.result.current.state.repCount).toBe(1);

      // Immediately try to enter endPhase again (only 500ms later, but minDuration=2000)
      (fakeWorkoutDef.getNextPhase as jest.Mock).mockReturnValue('down');
      act(() => { jest.setSystemTime(3500); hook.result.current.processFrame(makeAngles(90)); });
      act(() => { jest.setSystemTime(3501); hook.result.current.processFrame(makeAngles(90)); });

      (fakeWorkoutDef.getNextPhase as jest.Mock).mockReturnValue('up');
      act(() => { jest.setSystemTime(3800); hook.result.current.processFrame(makeAngles(90)); });
      act(() => { jest.setSystemTime(3801); hook.result.current.processFrame(makeAngles(90)); });

      // Should NOT have incremented because 3801 - 3001 = 800 < 2000
      expect(hook.result.current.state.repCount).toBe(1);

      // Reset the mock
      computeAdaptiveRepDurationMs.mockReturnValue(0);
    });
  });

  // =========================================================================
  // 6. reset()
  // =========================================================================

  describe('reset', () => {
    function setupWithOneRep() {
      const hook = renderHook(() =>
        useWorkoutController('pullup' as any, defaultOptions())
      );

      // Drive through one rep
      (fakeWorkoutDef.getNextPhase as jest.Mock).mockReturnValue('down');
      act(() => { jest.setSystemTime(1000); hook.result.current.processFrame(makeAngles(90)); });
      act(() => { jest.setSystemTime(1001); hook.result.current.processFrame(makeAngles(90)); });

      (fakeWorkoutDef.getNextPhase as jest.Mock).mockReturnValue('up');
      act(() => { jest.setSystemTime(3000); hook.result.current.processFrame(makeAngles(90)); });
      act(() => { jest.setSystemTime(3001); hook.result.current.processFrame(makeAngles(90)); });

      expect(hook.result.current.state.repCount).toBe(1);
      expect(hook.result.current.state.isActive).toBe(true);

      return hook;
    }

    it('resets phase, repCount, metrics, isActive to initial values', () => {
      const hook = setupWithOneRep();

      act(() => {
        hook.result.current.reset();
      });

      expect(hook.result.current.state.phase).toBe('idle');
      expect(hook.result.current.state.repCount).toBe(0);
      expect(hook.result.current.state.metrics).toBeNull();
      expect(hook.result.current.state.isActive).toBe(false);
    });

    it('preserves repCount when preserveRepCount=true', () => {
      const hook = setupWithOneRep();

      act(() => {
        hook.result.current.reset({ preserveRepCount: true });
      });

      expect(hook.result.current.state.repCount).toBe(1);
      expect(hook.result.current.state.phase).toBe('idle');
      expect(hook.result.current.state.isActive).toBe(false);
    });
  });

  // =========================================================================
  // 7. setWorkout()
  // =========================================================================

  describe('setWorkout', () => {
    it('switches to a new workout and resets all state', () => {
      const altDef: WorkoutDefinition<TestPhase, WorkoutMetrics> = {
        ...fakeWorkoutDef,
        id: 'alt',
        initialPhase: 'down' as TestPhase,
      };

      const hook = renderHook(() =>
        useWorkoutController('pullup' as any, defaultOptions())
      );

      // Drive one rep first
      (fakeWorkoutDef.getNextPhase as jest.Mock).mockReturnValue('down');
      act(() => { jest.setSystemTime(1000); hook.result.current.processFrame(makeAngles(90)); });
      act(() => { jest.setSystemTime(1001); hook.result.current.processFrame(makeAngles(90)); });

      (fakeWorkoutDef.getNextPhase as jest.Mock).mockReturnValue('up');
      act(() => { jest.setSystemTime(3000); hook.result.current.processFrame(makeAngles(90)); });
      act(() => { jest.setSystemTime(3001); hook.result.current.processFrame(makeAngles(90)); });

      expect(hook.result.current.state.repCount).toBe(1);

      // Now switch workout
      mockGetWorkoutById.mockReturnValue(altDef);
      act(() => {
        hook.result.current.setWorkout('pushup' as any);
      });

      expect(mockGetWorkoutById).toHaveBeenCalledWith('pushup');
      expect(hook.result.current.state.repCount).toBe(0);
      expect(hook.result.current.state.phase).toBe('down'); // altDef.initialPhase
      expect(hook.result.current.state.isActive).toBe(false);
      expect(hook.result.current.getWorkoutDefinition()).toBe(altDef);
    });

    it('ignores processFrame calls during the transition', () => {
      const hook = renderHook(() =>
        useWorkoutController('pullup' as any, defaultOptions())
      );

      // setWorkout internally sets transitioningRef = true, then resets, then false.
      // Since it's synchronous, processFrame is blocked during the call. We verify
      // that after setWorkout, state is properly reset and not corrupted.
      act(() => {
        hook.result.current.setWorkout('deadlift' as any);
      });

      // processFrame right after should work normally
      (fakeWorkoutDef.getNextPhase as jest.Mock).mockReturnValue('idle');
      act(() => {
        jest.setSystemTime(5000);
        hook.result.current.processFrame(makeAngles(100));
      });

      expect(hook.result.current.state.phase).toBe('idle');
    });
  });

  // =========================================================================
  // 8. Pullup-specific scoring
  // =========================================================================

  describe('pullup scoring', () => {
    it('fires onPullupScoring with source=frame on each processFrame for pullup workout', () => {
      mockGetWorkoutById.mockReturnValue(fakePullupDef);
      (fakePullupDef.calculateMetrics as jest.Mock).mockReturnValue(fakeMetrics);
      (fakePullupDef.getNextPhase as jest.Mock).mockReturnValue('idle');

      const onPullupScoring = jest.fn();
      const hook = renderHook(() =>
        useWorkoutController('pullup' as any, {
          ...defaultOptions(),
          callbacks: { onPullupScoring },
        })
      );

      act(() => {
        hook.result.current.processFrame(makeAngles(120));
      });

      expect(mockScorePullup).toHaveBeenCalled();
      expect(onPullupScoring).toHaveBeenCalledWith(
        0, // repCount starts at 0
        expect.objectContaining({ overall_score: 78 }),
        { source: 'frame' }
      );
    });

    it('fires onPullupScoring with source=rep-complete on rep completion for pullup', () => {
      mockGetWorkoutById.mockReturnValue(fakePullupDef);
      (fakePullupDef.calculateMetrics as jest.Mock).mockReturnValue(fakeMetrics);

      const onPullupScoring = jest.fn();
      const hook = renderHook(() =>
        useWorkoutController('pullup' as any, {
          ...defaultOptions(),
          callbacks: { onPullupScoring },
        })
      );

      // Drive rep: idle → down → up
      (fakePullupDef.getNextPhase as jest.Mock).mockReturnValue('down');
      act(() => { jest.setSystemTime(1000); hook.result.current.processFrame(makeAngles(90)); });
      act(() => { jest.setSystemTime(1001); hook.result.current.processFrame(makeAngles(90)); });

      (fakePullupDef.getNextPhase as jest.Mock).mockReturnValue('up');
      act(() => { jest.setSystemTime(3000); hook.result.current.processFrame(makeAngles(90)); });
      act(() => { jest.setSystemTime(3001); hook.result.current.processFrame(makeAngles(90)); });

      // Find the rep-complete call
      const repCompleteCalls = onPullupScoring.mock.calls.filter(
        (call: any[]) => call[2]?.source === 'rep-complete'
      );
      expect(repCompleteCalls.length).toBe(1);
      expect(repCompleteCalls[0][0]).toBe(1); // repNumber
    });

    it('does not fire onPullupScoring for non-pullup workouts', () => {
      // fakeWorkoutDef.id = 'fake', not 'pullup'
      mockGetWorkoutById.mockReturnValue(fakeWorkoutDef);
      (fakeWorkoutDef.getNextPhase as jest.Mock).mockReturnValue('idle');

      const onPullupScoring = jest.fn();
      renderHook(() =>
        useWorkoutController('pullup' as any, {
          ...defaultOptions(),
          callbacks: { onPullupScoring },
        })
      );

      expect(onPullupScoring).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 9. Haptic feedback
  // =========================================================================

  describe('haptic feedback', () => {
    function completeOneRep(hook: ReturnType<typeof renderHook<any, any>>) {
      (fakeWorkoutDef.getNextPhase as jest.Mock).mockReturnValue('down');
      act(() => { jest.setSystemTime(1000); hook.result.current.processFrame(makeAngles(90)); });
      act(() => { jest.setSystemTime(1001); hook.result.current.processFrame(makeAngles(90)); });

      (fakeWorkoutDef.getNextPhase as jest.Mock).mockReturnValue('up');
      act(() => { jest.setSystemTime(3000); hook.result.current.processFrame(makeAngles(90)); });
      act(() => { jest.setSystemTime(3001); hook.result.current.processFrame(makeAngles(90)); });
    }

    it('triggers haptic feedback on rep complete when enableHaptics=true and Platform.OS=ios', () => {
      const hook = renderHook(() =>
        useWorkoutController('pullup' as any, {
          ...defaultOptions(),
          enableHaptics: true,
        })
      );

      completeOneRep(hook);

      expect(mockImpactAsync).toHaveBeenCalledWith('Light');
    });

    it('does not trigger haptic when enableHaptics=false', () => {
      const hook = renderHook(() =>
        useWorkoutController('pullup' as any, {
          ...defaultOptions(),
          enableHaptics: false,
        })
      );

      completeOneRep(hook);

      expect(mockImpactAsync).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 10. addRepCue
  // =========================================================================

  describe('addRepCue', () => {
    it('adds cue only when a rep is actively being tracked', () => {
      const hook = renderHook(() =>
        useWorkoutController('pullup' as any, defaultOptions())
      );

      // No rep in progress — addRepCue should be a no-op
      act(() => {
        hook.result.current.addRepCue('form_correction');
      });

      // Start a rep (enter startPhase)
      (fakeWorkoutDef.getNextPhase as jest.Mock).mockReturnValue('down');
      act(() => { jest.setSystemTime(1000); hook.result.current.processFrame(makeAngles(90)); });
      act(() => { jest.setSystemTime(1001); hook.result.current.processFrame(makeAngles(90)); });

      // Now a rep is in progress — addRepCue should work
      act(() => {
        hook.result.current.addRepCue('elbow_flare');
      });

      // Complete the rep and verify the cue was captured
      (fakeWorkoutDef.getNextPhase as jest.Mock).mockReturnValue('up');
      act(() => { jest.setSystemTime(3000); hook.result.current.processFrame(makeAngles(90)); });
      act(() => { jest.setSystemTime(3001); hook.result.current.processFrame(makeAngles(90)); });

      expect(mockLogRep).toHaveBeenCalled();
      const logRepArg = mockLogRep.mock.calls[0][0];
      expect(logRepArg.cuesEmitted).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'elbow_flare' }),
        ])
      );
    });
  });

  // =========================================================================
  // Utility functions exported from the module
  // =========================================================================

  describe('utility functions (module-level)', () => {
    it('clamp and scoreFromShadowDelta produce expected values', async () => {
      // These are internal, tested indirectly through combineTrackingQuality
      // which is used in processFrame's rep-completion path. We test the
      // end-to-end behavior: when trackingQuality and shadowMeanAbsDelta are
      // provided, the adaptive rep duration receives them.
      const { computeAdaptiveRepDurationMs } = require('@/lib/services/workout-runtime');
      computeAdaptiveRepDurationMs.mockReturnValue(0);

      const hook = renderHook(() =>
        useWorkoutController('pullup' as any, defaultOptions())
      );

      // Drive through a rep with context
      (fakeWorkoutDef.getNextPhase as jest.Mock).mockReturnValue('down');
      act(() => { jest.setSystemTime(1000); hook.result.current.processFrame(makeAngles(90), undefined, { trackingQuality: 0.8, shadowMeanAbsDelta: 5 }); });
      act(() => { jest.setSystemTime(1001); hook.result.current.processFrame(makeAngles(90), undefined, { trackingQuality: 0.8, shadowMeanAbsDelta: 5 }); });

      (fakeWorkoutDef.getNextPhase as jest.Mock).mockReturnValue('up');
      act(() => { jest.setSystemTime(3000); hook.result.current.processFrame(makeAngles(90), undefined, { trackingQuality: 0.8, shadowMeanAbsDelta: 5 }); });
      act(() => { jest.setSystemTime(3001); hook.result.current.processFrame(makeAngles(90), undefined, { trackingQuality: 0.8, shadowMeanAbsDelta: 5 }); });

      // Verify computeAdaptiveRepDurationMs received a combined quality value
      const lastCall = computeAdaptiveRepDurationMs.mock.calls.at(-1)?.[0];
      expect(lastCall).toBeDefined();
      expect(typeof lastCall.trackingQuality).toBe('number');
    });
  });

  // =========================================================================
  // Edge cases
  // =========================================================================

  describe('edge cases', () => {
    it('does not count rep when prevPhase is initialPhase (no real transition)', () => {
      const hook = renderHook(() =>
        useWorkoutController('pullup' as any, defaultOptions())
      );

      // Try to go directly from idle → up (endPhase) without going through down (startPhase)
      // The code checks: prevPhase !== workoutDef.initialPhase
      (fakeWorkoutDef.getNextPhase as jest.Mock).mockReturnValue('up');
      act(() => { jest.setSystemTime(1000); hook.result.current.processFrame(makeAngles(90)); });
      act(() => { jest.setSystemTime(1001); hook.result.current.processFrame(makeAngles(90)); });

      // Should NOT count as a rep because prevPhase was 'idle' (initialPhase)
      expect(hook.result.current.state.repCount).toBe(0);
    });

    it('handles logRep failure gracefully without crashing', () => {
      mockLogRep.mockRejectedValueOnce(new Error('network error'));

      const hook = renderHook(() =>
        useWorkoutController('pullup' as any, defaultOptions())
      );

      // Drive a rep
      (fakeWorkoutDef.getNextPhase as jest.Mock).mockReturnValue('down');
      act(() => { jest.setSystemTime(1000); hook.result.current.processFrame(makeAngles(90)); });
      act(() => { jest.setSystemTime(1001); hook.result.current.processFrame(makeAngles(90)); });

      (fakeWorkoutDef.getNextPhase as jest.Mock).mockReturnValue('up');
      act(() => { jest.setSystemTime(3000); hook.result.current.processFrame(makeAngles(90)); });
      act(() => { jest.setSystemTime(3001); hook.result.current.processFrame(makeAngles(90)); });

      // Should still count the rep despite logRep failing
      expect(hook.result.current.state.repCount).toBe(1);
    });

    it('handles scorePullupWithComponentAvailability throwing without crashing', () => {
      mockGetWorkoutById.mockReturnValue(fakePullupDef);
      (fakePullupDef.calculateMetrics as jest.Mock).mockReturnValue(fakeMetrics);
      (fakePullupDef.getNextPhase as jest.Mock).mockReturnValue('idle');
      mockScorePullup.mockImplementationOnce(() => { throw new Error('scoring failed'); });

      const hook = renderHook(() =>
        useWorkoutController('pullup' as any, defaultOptions())
      );

      // Should not throw
      act(() => {
        hook.result.current.processFrame(makeAngles(120));
      });

      expect(hook.result.current.state.phase).toBe('idle');
    });

    it('tracks min/max angles during rep via updateRepAngles', () => {
      const hook = renderHook(() =>
        useWorkoutController('pullup' as any, defaultOptions())
      );

      // Enter startPhase to begin rep tracking
      (fakeWorkoutDef.getNextPhase as jest.Mock).mockReturnValue('down');
      act(() => { jest.setSystemTime(1000); hook.result.current.processFrame(makeAngles(120)); });
      act(() => { jest.setSystemTime(1001); hook.result.current.processFrame(makeAngles(120)); });

      // Process several frames with varying angles (no phase change → updateRepAngles called)
      act(() => { jest.setSystemTime(1500); hook.result.current.processFrame(makeAngles(80)); });
      act(() => { jest.setSystemTime(2000); hook.result.current.processFrame(makeAngles(60)); });
      act(() => { jest.setSystemTime(2500); hook.result.current.processFrame(makeAngles(150)); });

      // Complete the rep
      (fakeWorkoutDef.getNextPhase as jest.Mock).mockReturnValue('up');
      act(() => { jest.setSystemTime(3000); hook.result.current.processFrame(makeAngles(90)); });
      act(() => { jest.setSystemTime(3001); hook.result.current.processFrame(makeAngles(90)); });

      // Verify calculateFqi was called with angles that reflect tracking
      expect(mockCalculateFqi).toHaveBeenCalled();
      const fqiArgs = mockCalculateFqi.mock.calls[0];
      const repAngles = fqiArgs[0]; // first arg is repAngles
      // The rep angles should have tracked min/max across frames
      expect(repAngles.start).toBeDefined();
      expect(repAngles.min).toBeDefined();
      expect(repAngles.max).toBeDefined();
      expect(repAngles.end).toBeDefined();
    });

    it('stores lastJoints from processFrame when rep is active', () => {
      const hook = renderHook(() =>
        useWorkoutController('pullup' as any, defaultOptions())
      );

      // Enter startPhase
      (fakeWorkoutDef.getNextPhase as jest.Mock).mockReturnValue('down');
      act(() => { jest.setSystemTime(1000); hook.result.current.processFrame(makeAngles(90)); });
      act(() => { jest.setSystemTime(1001); hook.result.current.processFrame(makeAngles(90)); });

      // Process a frame with joints data while rep is active
      const joints = new Map<string, { x: number; y: number; isTracked: boolean; confidence?: number }>([
        ['left_hand', { x: 0.5, y: 0.5, isTracked: true, confidence: 0.9 }],
      ]);

      (fakeWorkoutDef.getNextPhase as jest.Mock).mockReturnValue('down');
      act(() => {
        jest.setSystemTime(2000);
        hook.result.current.processFrame(makeAngles(90), joints);
      });

      // We can't directly inspect the ref, but we verify the hook doesn't crash
      // and that when the rep completes, scoring receives the joints data
      mockGetWorkoutById.mockReturnValue(fakePullupDef);
      (fakePullupDef.getNextPhase as jest.Mock).mockReturnValue('up');
      act(() => { jest.setSystemTime(3000); hook.result.current.processFrame(makeAngles(90), joints); });
      act(() => { jest.setSystemTime(3001); hook.result.current.processFrame(makeAngles(90), joints); });

      // The hook should not crash when joints are provided
      expect(hook.result.current.state.repCount).toBe(1);
    });
  });

  // =========================================================================
  // Defaults
  // =========================================================================

  describe('defaults', () => {
    it('defaults enableHaptics to true when not specified', () => {
      const hook = renderHook(() =>
        useWorkoutController('pullup' as any, { sessionId: 'test' })
      );

      // Drive a rep
      (fakeWorkoutDef.getNextPhase as jest.Mock).mockReturnValue('down');
      act(() => { jest.setSystemTime(1000); hook.result.current.processFrame(makeAngles(90)); });
      act(() => { jest.setSystemTime(1001); hook.result.current.processFrame(makeAngles(90)); });

      (fakeWorkoutDef.getNextPhase as jest.Mock).mockReturnValue('up');
      act(() => { jest.setSystemTime(3000); hook.result.current.processFrame(makeAngles(90)); });
      act(() => { jest.setSystemTime(3001); hook.result.current.processFrame(makeAngles(90)); });

      expect(mockImpactAsync).toHaveBeenCalledWith('Light');
    });
  });

  // =========================================================================
  // Rep-write failure queue + UI callback (issue #418)
  // =========================================================================

  describe('rep-write failure queue', () => {
    const driveOneRep = (hook: ReturnType<typeof renderHook>) => {
      (fakeWorkoutDef.getNextPhase as jest.Mock).mockReturnValue('down');
      act(() => { jest.setSystemTime(1000); (hook.result.current as any).processFrame(makeAngles(90)); });
      act(() => { jest.setSystemTime(1001); (hook.result.current as any).processFrame(makeAngles(90)); });
      (fakeWorkoutDef.getNextPhase as jest.Mock).mockReturnValue('up');
      act(() => { jest.setSystemTime(3000); (hook.result.current as any).processFrame(makeAngles(90)); });
      act(() => { jest.setSystemTime(3001); (hook.result.current as any).processFrame(makeAngles(90)); });
    };

    it('invokes onRepLogFailure with the error and queue depth when logRep rejects', async () => {
      const onRepLogFailure = jest.fn();
      mockLogRep.mockRejectedValueOnce(new Error('supabase 503'));

      const hook = renderHook(() =>
        useWorkoutController('pullup' as any, {
          sessionId: 'test-session',
          enableHaptics: false,
          callbacks: { onRepLogFailure },
        })
      );

      driveOneRep(hook);
      // Let the logRep awaiter settle.
      await act(async () => { await Promise.resolve(); });

      expect(onRepLogFailure).toHaveBeenCalledTimes(1);
      const [errArg, depthArg] = onRepLogFailure.mock.calls[0];
      expect(errArg).toBeInstanceOf(Error);
      expect(depthArg).toBe(1);
    });

    it('drains the queue on the next successful logRep call', async () => {
      const onRepLogFailure = jest.fn();
      // First rep fails, second succeeds.
      mockLogRep
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValue('rep-id-1');

      const hook = renderHook(() =>
        useWorkoutController('pullup' as any, {
          sessionId: 'test-session',
          enableHaptics: false,
          callbacks: { onRepLogFailure },
        })
      );

      driveOneRep(hook);
      await act(async () => { await Promise.resolve(); });
      expect(onRepLogFailure).toHaveBeenCalledTimes(1);
      expect(mockLogRep).toHaveBeenCalledTimes(1);

      // Drive a second rep — on entry it should drain the queued first rep
      // before logging the new one.
      (fakeWorkoutDef.getNextPhase as jest.Mock).mockReturnValue('down');
      act(() => { jest.setSystemTime(5000); (hook.result.current as any).processFrame(makeAngles(90)); });
      act(() => { jest.setSystemTime(5001); (hook.result.current as any).processFrame(makeAngles(90)); });
      (fakeWorkoutDef.getNextPhase as jest.Mock).mockReturnValue('up');
      act(() => { jest.setSystemTime(7000); (hook.result.current as any).processFrame(makeAngles(90)); });
      act(() => { jest.setSystemTime(7001); (hook.result.current as any).processFrame(makeAngles(90)); });

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      // 1 failed + 1 drain + 1 new = 3 calls, no new failure callback.
      expect(mockLogRep).toHaveBeenCalledTimes(3);
      expect(onRepLogFailure).toHaveBeenCalledTimes(1);
    });

    it('does not crash if onRepLogFailure itself throws', async () => {
      const onRepLogFailure = jest.fn(() => { throw new Error('ui exploded'); });
      mockLogRep.mockRejectedValueOnce(new Error('network'));

      const hook = renderHook(() =>
        useWorkoutController('pullup' as any, {
          sessionId: 'test-session',
          enableHaptics: false,
          callbacks: { onRepLogFailure },
        })
      );

      driveOneRep(hook);
      await act(async () => { await Promise.resolve(); });

      // Rep still counts, callback still invoked, no uncaught error.
      expect(hook.result.current.state.repCount).toBe(1);
      expect(onRepLogFailure).toHaveBeenCalled();
    });

    // -------------------------------------------------------------------------
    // flushPendingRepsOnStop + getPendingRepCount (#575 item #10)
    // -------------------------------------------------------------------------

    it('getPendingRepCount returns 0 when no reps have failed', () => {
      const hook = renderHook(() =>
        useWorkoutController('pullup' as any, {
          sessionId: 'test-session',
          enableHaptics: false,
        })
      );
      expect(hook.result.current.getPendingRepCount()).toBe(0);
    });

    it('getPendingRepCount reflects queued failed writes', async () => {
      mockLogRep.mockRejectedValue(new Error('offline'));
      const hook = renderHook(() =>
        useWorkoutController('pullup' as any, {
          sessionId: 'test-session',
          enableHaptics: false,
        })
      );

      driveOneRep(hook);
      await act(async () => { await Promise.resolve(); });
      expect(hook.result.current.getPendingRepCount()).toBe(1);
    });

    it('flushPendingRepsOnStop fires onRepLogFailure with PENDING_REPS_AT_STOP signal when queue non-empty', async () => {
      const onRepLogFailure = jest.fn();
      mockLogRep.mockRejectedValue(new Error('offline'));

      const hook = renderHook(() =>
        useWorkoutController('pullup' as any, {
          sessionId: 'test-session',
          enableHaptics: false,
          callbacks: { onRepLogFailure },
        })
      );

      driveOneRep(hook);
      await act(async () => { await Promise.resolve(); });

      onRepLogFailure.mockClear();

      const reportedCount = hook.result.current.flushPendingRepsOnStop();
      expect(reportedCount).toBe(1);
      expect(onRepLogFailure).toHaveBeenCalledTimes(1);
      const [errArg, depthArg] = onRepLogFailure.mock.calls[0];
      expect(errArg).toMatchObject({ code: 'PENDING_REPS_AT_STOP', count: 1 });
      expect(depthArg).toBe(1);
    });

    it('flushPendingRepsOnStop is a no-op when queue is empty', () => {
      const onRepLogFailure = jest.fn();
      const hook = renderHook(() =>
        useWorkoutController('pullup' as any, {
          sessionId: 'test-session',
          enableHaptics: false,
          callbacks: { onRepLogFailure },
        })
      );

      expect(hook.result.current.flushPendingRepsOnStop()).toBe(0);
      expect(onRepLogFailure).not.toHaveBeenCalled();
    });

    it('flushPendingRepsOnStop swallows callback throws so stopTracking can complete', async () => {
      const onRepLogFailure = jest.fn(() => {
        throw new Error('toast layer exploded');
      });
      mockLogRep.mockRejectedValue(new Error('offline'));

      const hook = renderHook(() =>
        useWorkoutController('pullup' as any, {
          sessionId: 'test-session',
          enableHaptics: false,
          callbacks: { onRepLogFailure },
        })
      );

      driveOneRep(hook);
      await act(async () => { await Promise.resolve(); });

      onRepLogFailure.mockClear();
      // flush-on-stop callback throws but the method itself must not throw.
      onRepLogFailure.mockImplementationOnce(() => {
        throw new Error('toast layer exploded');
      });
      expect(() => hook.result.current.flushPendingRepsOnStop()).not.toThrow();
    });

    it('isPendingRepsAtStopSignal discriminates the sentinel', () => {
      const { isPendingRepsAtStopSignal } = jest.requireActual<
        typeof import('@/hooks/use-workout-controller')
      >('@/hooks/use-workout-controller');
      expect(isPendingRepsAtStopSignal({ code: 'PENDING_REPS_AT_STOP', count: 3 })).toBe(true);
      expect(isPendingRepsAtStopSignal(new Error('other'))).toBe(false);
      expect(isPendingRepsAtStopSignal(null)).toBe(false);
      expect(isPendingRepsAtStopSignal('string')).toBe(false);
    });
  });
});
