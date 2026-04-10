/**
 * Workout Controller Hook
 *
 * Unified controller for workout tracking that uses workout definitions
 * from lib/workouts/ to drive phase transitions, rep counting, and metrics.
 *
 * This replaces the hardcoded updatePullUpCycle/updatePushUpCycle functions
 * in scan-arkit.tsx with a factory pattern that works with any workout definition.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { errorWithTs, logWithTs, warnWithTs } from '@/lib/logger';
import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import type { WorkoutDefinition, WorkoutMetrics } from '@/lib/types/workout-definitions';
import { getWorkoutById, type DetectionMode } from '@/lib/workouts';
import { calculateFqi, extractRepFeatures, type RepAngles } from '@/lib/services/fqi-calculator';
import { logRep } from '@/lib/services/rep-logger';
import { computeAdaptivePhaseHoldMs, computeAdaptiveRepDurationMs } from '@/lib/services/workout-runtime';
import { selectShadowProvider } from '@/lib/pose/shadow-provider';
import {
  scorePullupWithComponentAvailability,
  type PullupScoringInput,
  type PullupScoringResult,
} from '@/lib/tracking-quality/scoring';
import type {
  HybridRepEvent,
  HybridRepSource,
  IHybridRepDetector,
  IVerticalDisplacementTracker,
  VerticalSignal,
} from '@/lib/tracking-quality/hybrid-types';

// ---------------------------------------------------------------------------
// Hybrid detection lazy loader — gracefully degrades if the modules
// built by Agent 2 are not yet merged.
// ---------------------------------------------------------------------------

let _HybridRepDetector: (new () => IHybridRepDetector) | null = null;
let _VerticalDisplacementTracker: (new () => IVerticalDisplacementTracker) | null = null;
let _hybridModulesResolved = false;

function resolveHybridModules(): boolean {
  if (_hybridModulesResolved) return _HybridRepDetector !== null;
  _hybridModulesResolved = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const hybridMod = require('@/lib/tracking-quality/hybrid-rep-detector');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const vertMod = require('@/lib/tracking-quality/vertical-displacement');
    _HybridRepDetector = hybridMod?.HybridRepDetector ?? null;
    _VerticalDisplacementTracker = vertMod?.VerticalDisplacementTracker ?? null;
  } catch {
    // Modules not available yet — fall back to angle-only detection
    _HybridRepDetector = null;
    _VerticalDisplacementTracker = null;
  }
  return _HybridRepDetector !== null;
}

/** State exposed from the hybrid detection system for UI consumers. */
export interface HybridDetectionState {
  /** Currently active detection source. */
  activeSource: HybridRepSource;
  /** Latest vertical displacement signal, if available. */
  verticalSignal: VerticalSignal | null;
  /** Whether hybrid detection is actually active (modules loaded). */
  isHybridActive: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function scoreFromShadowDelta(shadowMeanAbsDelta?: number | null): number | undefined {
  if (typeof shadowMeanAbsDelta !== 'number' || !Number.isFinite(shadowMeanAbsDelta)) {
    return undefined;
  }

  return clamp(1 - shadowMeanAbsDelta / 28, 0.2, 1);
}

function combineTrackingQuality(input?: number, shadowMeanAbsDelta?: number | null): number | undefined {
  const base = typeof input === 'number' && Number.isFinite(input) ? clamp(input, 0, 1) : undefined;
  const shadowScore = scoreFromShadowDelta(shadowMeanAbsDelta);

  if (base === undefined) return shadowScore;
  if (shadowScore === undefined) return base;
  return Math.min(base, shadowScore);
}

// =============================================================================
// Types
// =============================================================================

export interface WorkoutControllerState<TPhase extends string = string> {
  /** Current phase in the workout cycle */
  phase: TPhase;
  /** Current rep count */
  repCount: number;
  /** Current workout-specific metrics */
  metrics: WorkoutMetrics | null;
  /** Whether tracking is active */
  isActive: boolean;
}

export interface RepTrackingData {
  startTs: number;
  startAngles: JointAngles | null;
  minAngles: JointAngles | null;
  maxAngles: JointAngles | null;
  cues: Array<{ type: string; ts: string }>;
  lastJoints: Map<string, { x: number; y: number; isTracked: boolean; confidence?: number }> | null;
}

export interface WorkoutControllerCallbacks {
  /** Called when a rep is completed */
  onRepComplete?: (repNumber: number, fqi: number, faults: string[]) => void;
  onPullupScoring?: (
    repNumber: number,
    scoring: PullupScoringResult,
    meta?: { source: 'frame' | 'rep-complete' }
  ) => void;
  /** Called when phase changes */
  onPhaseChange?: (newPhase: string, prevPhase: string) => void;
  /** Called when a cue should be emitted */
  onCue?: (cue: string, type: 'static' | 'dynamic') => void;
}

function buildSingleFrameRepAngles(angles: JointAngles): PullupScoringInput['repAngles'] {
  return {
    start: {
      leftElbow: angles.leftElbow,
      rightElbow: angles.rightElbow,
      leftShoulder: angles.leftShoulder,
      rightShoulder: angles.rightShoulder,
    },
    end: {
      leftElbow: angles.leftElbow,
      rightElbow: angles.rightElbow,
      leftShoulder: angles.leftShoulder,
      rightShoulder: angles.rightShoulder,
    },
    min: {
      leftElbow: angles.leftElbow,
      rightElbow: angles.rightElbow,
      leftShoulder: angles.leftShoulder,
      rightShoulder: angles.rightShoulder,
    },
    max: {
      leftElbow: angles.leftElbow,
      rightElbow: angles.rightElbow,
      leftShoulder: angles.leftShoulder,
      rightShoulder: angles.rightShoulder,
    },
  };
}

export interface UseWorkoutControllerOptions {
  /** Session ID for logging */
  sessionId: string;
  /** Callbacks for workout events */
  callbacks?: WorkoutControllerCallbacks;
  /** Enable haptic feedback on rep completion */
  enableHaptics?: boolean;
  /**
   * When true (the default), the controller will attempt to use the
   * hybrid rep detection system (vertical displacement + angle fusion).
   * Falls back to angle-only detection if the hybrid modules are not
   * available.
   */
  useHybridDetection?: boolean;
}

export interface ResetWorkoutOptions {
  preserveRepCount?: boolean;
}

export interface UseWorkoutControllerReturn<TPhase extends string = string> {
  /** Current workout state */
  state: WorkoutControllerState<TPhase>;
  /** Process a new frame of joint angles */
  processFrame: (
    angles: JointAngles,
    joints?: Map<string, { x: number; y: number; isTracked: boolean; confidence?: number }>,
    context?: { trackingQuality?: number; shadowMeanAbsDelta?: number | null }
  ) => void;
  /** Reset the workout state */
  reset: (options?: ResetWorkoutOptions) => void;
  /** Change the active workout */
  setWorkout: (workoutId: DetectionMode) => void;
  /** Get the current workout definition */
  getWorkoutDefinition: () => WorkoutDefinition | undefined;
  /** Add a cue to the current rep's tracking data */
  addRepCue: (cueType: string) => void;
  /** Hybrid detection state for UI consumers (debug panel, overlay). */
  hybridDetectionState: HybridDetectionState;
}

// =============================================================================
// Hook Implementation
// =============================================================================

export function useWorkoutController<TPhase extends string = string>(
  initialWorkoutId: DetectionMode,
  options: UseWorkoutControllerOptions
): UseWorkoutControllerReturn<TPhase> {
  const { sessionId, callbacks, enableHaptics = true, useHybridDetection = true } = options;

  // Hybrid detection refs — initialised lazily on first frame
  const hybridDetectorRef = useRef<IHybridRepDetector | null>(null);
  const verticalTrackerRef = useRef<IVerticalDisplacementTracker | null>(null);
  const hybridInitialisedRef = useRef(false);
  const [hybridDetectionState, setHybridDetectionState] = useState<HybridDetectionState>({
    activeSource: 'angle',
    verticalSignal: null,
    isHybridActive: false,
  });

  // Current workout definition
  const workoutIdRef = useRef<DetectionMode>(initialWorkoutId);
  const workoutDefRef = useRef<WorkoutDefinition | undefined>(getWorkoutById(initialWorkoutId));

  // State
  const [state, setState] = useState<WorkoutControllerState<TPhase>>(() => {
    const def = workoutDefRef.current;
    return {
      phase: (def?.initialPhase ?? 'idle') as TPhase,
      repCount: 0,
      metrics: null,
      isActive: false,
    };
  });

  // Refs for tracking (avoid re-renders on every frame)
  const phaseRef = useRef<TPhase>(state.phase);
  const repCountRef = useRef<number>(0);

  // Keep refs synchronized with React state
  useEffect(() => { phaseRef.current = state.phase; }, [state.phase]);
  useEffect(() => { repCountRef.current = state.repCount; }, [state.repCount]);

  const lastRepTimestampRef = useRef<number>(0);
  const recentRepDurationsRef = useRef<number[]>([]);
  const pendingPhaseRef = useRef<TPhase | null>(null);
  const pendingPhaseSinceRef = useRef<number>(0);
  const isInActiveRepRef = useRef<boolean>(false);
  const transitioningRef = useRef<boolean>(false);

  // Rep tracking data
  const repTrackingRef = useRef<RepTrackingData>({
    startTs: 0,
    startAngles: null,
    minAngles: null,
    maxAngles: null,
    cues: [],
    lastJoints: null,
  });

  // =============================================================================
  // Rep Tracking Helpers
  // =============================================================================

  const startRepTracking = useCallback((angles: JointAngles) => {
    repTrackingRef.current = {
      startTs: Date.now(),
      startAngles: { ...angles },
      minAngles: { ...angles },
      maxAngles: { ...angles },
      cues: [],
      lastJoints: null,
    };
  }, []);

  const updateRepAngles = useCallback((angles: JointAngles) => {
    const tracking = repTrackingRef.current;
    if (tracking.startTs === 0) return;

    const min = tracking.minAngles;
    const max = tracking.maxAngles;

    if (min && max) {
      tracking.minAngles = {
        leftKnee: Math.min(min.leftKnee, angles.leftKnee),
        rightKnee: Math.min(min.rightKnee, angles.rightKnee),
        leftElbow: Math.min(min.leftElbow, angles.leftElbow),
        rightElbow: Math.min(min.rightElbow, angles.rightElbow),
        leftHip: Math.min(min.leftHip, angles.leftHip),
        rightHip: Math.min(min.rightHip, angles.rightHip),
        leftShoulder: Math.min(min.leftShoulder, angles.leftShoulder),
        rightShoulder: Math.min(min.rightShoulder, angles.rightShoulder),
      };
      tracking.maxAngles = {
        leftKnee: Math.max(max.leftKnee, angles.leftKnee),
        rightKnee: Math.max(max.rightKnee, angles.rightKnee),
        leftElbow: Math.max(max.leftElbow, angles.leftElbow),
        rightElbow: Math.max(max.rightElbow, angles.rightElbow),
        leftHip: Math.max(max.leftHip, angles.leftHip),
        rightHip: Math.max(max.rightHip, angles.rightHip),
        leftShoulder: Math.max(max.leftShoulder, angles.leftShoulder),
        rightShoulder: Math.max(max.rightShoulder, angles.rightShoulder),
      };
    }
  }, []);

  const completeRepTracking = useCallback(
    async (exercise: string, repNumber: number, endAngles: JointAngles) => {
      const tracking = repTrackingRef.current;
      if (
        tracking.startTs === 0 ||
        !tracking.startAngles ||
        !tracking.minAngles ||
        !tracking.maxAngles
      ) {
        return;
      }

      const workoutDef = getWorkoutById(exercise);
      if (!workoutDef) {
        if (__DEV__) warnWithTs(`[WorkoutController] No workout definition for ${exercise}`);
        return;
      }

      const endTs = Date.now();
      const durationMs = endTs - tracking.startTs;

      const repAngles: RepAngles = {
        start: tracking.startAngles,
        end: endAngles,
        min: tracking.minAngles,
        max: tracking.maxAngles,
      };

      // Calculate FQI and extract features
      const fqiResult = calculateFqi(repAngles, durationMs, repNumber, workoutDef);
      const features = extractRepFeatures(repAngles, durationMs);

      if (exercise === 'pullup') {
        try {
          const scoring = scorePullupWithComponentAvailability({
            repAngles: {
              start: {
                leftElbow: repAngles.start.leftElbow,
                rightElbow: repAngles.start.rightElbow,
                leftShoulder: repAngles.start.leftShoulder,
                rightShoulder: repAngles.start.rightShoulder,
              },
              end: {
                leftElbow: repAngles.end.leftElbow,
                rightElbow: repAngles.end.rightElbow,
                leftShoulder: repAngles.end.leftShoulder,
                rightShoulder: repAngles.end.rightShoulder,
              },
              min: {
                leftElbow: repAngles.min.leftElbow,
                rightElbow: repAngles.min.rightElbow,
                leftShoulder: repAngles.min.leftShoulder,
                rightShoulder: repAngles.min.rightShoulder,
              },
              max: {
                leftElbow: repAngles.max.leftElbow,
                rightElbow: repAngles.max.rightElbow,
                leftShoulder: repAngles.max.leftShoulder,
                rightShoulder: repAngles.max.rightShoulder,
              },
            },
            durationMs,
            joints: tracking.lastJoints ?? undefined,
          });
          callbacks?.onPullupScoring?.(repNumber, scoring, { source: 'rep-complete' });
        } catch (error) {
          if (__DEV__) {
            warnWithTs('[WorkoutController] Pullup component scoring failed', error);
          }
        }
      }

      callbacks?.onRepComplete?.(repNumber, fqiResult.score, fqiResult.detectedFaults);

      repTrackingRef.current = {
        startTs: 0,
        startAngles: null,
        minAngles: null,
        maxAngles: null,
        cues: [],
        lastJoints: null,
      };

      recentRepDurationsRef.current.push(durationMs);
      if (recentRepDurationsRef.current.length > 6) {
        recentRepDurationsRef.current.shift();
      }

      // Log the rep
      try {
        await logRep({
          sessionId,
          repIndex: repNumber,
          exercise,
          startTs: new Date(tracking.startTs).toISOString(),
          endTs: new Date(endTs).toISOString(),
          features,
          fqi: fqiResult.score,
          faultsDetected: fqiResult.detectedFaults,
          cuesEmitted: tracking.cues,
        });

        if (__DEV__) {
          logWithTs(
            `[WorkoutController] Rep ${repNumber} logged: FQI=${fqiResult.score}, faults=${fqiResult.detectedFaults.join(',')}`
          );
        }
      } catch (error) {
        if (__DEV__) {
          errorWithTs('[WorkoutController] Failed to log rep', error);
        }
      }
    },
    [sessionId, callbacks]
  );

  const emitFramePullupScoring = useCallback(
    (
      repNumber: number,
      angles: JointAngles,
      joints?: Map<string, { x: number; y: number; isTracked: boolean; confidence?: number }>,
    ) => {
      if (!callbacks?.onPullupScoring) {
        return;
      }

      try {
        const scoring = scorePullupWithComponentAvailability({
          repAngles: buildSingleFrameRepAngles(angles),
          durationMs: 0,
          joints: joints ?? undefined,
        });
        callbacks.onPullupScoring(repNumber, scoring, { source: 'frame' });
      } catch (error) {
        if (__DEV__) {
          warnWithTs('[WorkoutController] Frame pullup scoring failed', error);
        }
      }
    },
    [callbacks],
  );

  // =============================================================================
  // Phase Transition Logic
  // =============================================================================

  const processFrame = useCallback(
    (
      angles: JointAngles,
      joints?: Map<string, { x: number; y: number; isTracked: boolean; confidence?: number }>,
      context?: { trackingQuality?: number; shadowMeanAbsDelta?: number | null }
    ) => {
      if (transitioningRef.current) return;

      const workoutDef = workoutDefRef.current;
      if (!workoutDef) return;

      // ------------------------------------------------------------------
      // Lazy-init hybrid detection modules (once)
      // ------------------------------------------------------------------
      if (useHybridDetection && !hybridInitialisedRef.current) {
        hybridInitialisedRef.current = true;
        const available = resolveHybridModules();
        if (available && _HybridRepDetector && _VerticalDisplacementTracker) {
          hybridDetectorRef.current = new _HybridRepDetector();
          verticalTrackerRef.current = new _VerticalDisplacementTracker();
          setHybridDetectionState((prev) => ({ ...prev, isHybridActive: true }));
          if (__DEV__) {
            logWithTs('[WorkoutController] Hybrid detection modules loaded');
          }
        } else if (__DEV__) {
          logWithTs('[WorkoutController] Hybrid detection modules not available, using angle-only');
        }
      }

      // ------------------------------------------------------------------
      // Feed hybrid detector (runs in parallel with angle-based FSM)
      // ------------------------------------------------------------------
      const hybridDetector = hybridDetectorRef.current;
      const verticalTracker = verticalTrackerRef.current;
      let hybridRepEvent: HybridRepEvent | null = null;

      if (hybridDetector && joints) {
        // Update vertical tracker first so the hybrid detector can consume
        // its signal on the same frame.
        if (verticalTracker) {
          verticalTracker.update(joints, Date.now() / 1000);
        }

        hybridRepEvent = hybridDetector.step({
          timestampSec: Date.now() / 1000,
          angles,
          joints2D: joints,
          trackingQuality: context?.trackingQuality ?? 1.0,
        });

        // Publish snapshot for UI
        const snap = hybridDetector.getSnapshot();
        setHybridDetectionState({
          activeSource: snap.activeSource,
          verticalSignal: snap.verticalSignal,
          isHybridActive: true,
        });
      }

      // Calculate metrics using the workout's calculator
      const metrics = workoutDef.calculateMetrics(angles, joints);

      if (workoutDef.id === 'pullup') {
        emitFramePullupScoring(repCountRef.current, angles, joints);
      }

      if (repTrackingRef.current.startTs > 0) {
        repTrackingRef.current.lastJoints = joints ? new Map(joints) : repTrackingRef.current.lastJoints;
      }

      // Get next phase using the workout's state machine
      const currentPhase = phaseRef.current as string;
      const candidatePhase = workoutDef.getNextPhase(currentPhase, angles, metrics) as TPhase;
      const now = Date.now();

      const shadowSelection = (context as any)?.shadowProviderSelection;
      if (
        shadowSelection &&
        (shadowSelection.preferredProvider === 'mediapipe' || shadowSelection.preferredProvider === 'mediapipe_proxy') &&
        typeof shadowSelection.primaryTimestamp === 'number' &&
        Number.isFinite(shadowSelection.primaryTimestamp)
      ) {
        selectShadowProvider({
          preferredProvider: shadowSelection.preferredProvider,
          primaryTimestamp: shadowSelection.primaryTimestamp,
          mediaPipeTimestamp: shadowSelection.mediaPipeTimestamp,
          maxTimestampSkewSec: shadowSelection.maxTimestampSkewSec,
          isInActiveRep: isInActiveRepRef.current,
        });
      }

      const phaseHoldMs = computeAdaptivePhaseHoldMs({
        trackingQuality: context?.trackingQuality,
        shadowMeanAbsDelta: context?.shadowMeanAbsDelta,
      });

      let nextPhase = phaseRef.current;
      if (candidatePhase !== phaseRef.current) {
        if (pendingPhaseRef.current !== candidatePhase) {
          pendingPhaseRef.current = candidatePhase;
          pendingPhaseSinceRef.current = now;
        } else if (now - pendingPhaseSinceRef.current >= phaseHoldMs) {
          nextPhase = candidatePhase;
          pendingPhaseRef.current = null;
          pendingPhaseSinceRef.current = 0;
        }
      } else {
        pendingPhaseRef.current = null;
        pendingPhaseSinceRef.current = 0;
      }

      // Check for phase transition
      if (nextPhase !== currentPhase) {
        const prevPhase = currentPhase;
        phaseRef.current = nextPhase;

        // Notify callback
        callbacks?.onPhaseChange?.(nextPhase, prevPhase);

        // Check if this transition starts a rep
        if (nextPhase === workoutDef.repBoundary.startPhase) {
          isInActiveRepRef.current = true;
          startRepTracking(angles);
        }

        if (nextPhase === workoutDef.initialPhase && prevPhase !== workoutDef.initialPhase) {
          isInActiveRepRef.current = false;
        }

        // Check if this transition completes a rep
        if (nextPhase === workoutDef.repBoundary.endPhase && prevPhase !== workoutDef.initialPhase) {
          const now = Date.now();
          const minDuration = computeAdaptiveRepDurationMs({
            baseMinDurationMs: workoutDef.repBoundary.minDurationMs,
            recentRepDurationsMs: recentRepDurationsRef.current,
            trackingQuality: combineTrackingQuality(context?.trackingQuality, context?.shadowMeanAbsDelta),
          });

          if (now - lastRepTimestampRef.current > minDuration) {
            lastRepTimestampRef.current = now;
            repCountRef.current += 1;
            const newRepCount = repCountRef.current;

            isInActiveRepRef.current = false;

            // Haptic feedback
            if (enableHaptics && Platform.OS === 'ios') {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            }

            // Complete and log the rep
            completeRepTracking(workoutDef.id, newRepCount, angles);

            // Update state
            setState((prev) => ({
              ...prev,
              phase: nextPhase,
              repCount: newRepCount,
              metrics,
              isActive: true,
            }));
            return;
          }
        }

        // Update state for phase change
        setState((prev) => ({
          ...prev,
          phase: nextPhase,
          metrics,
          isActive: true,
        }));
      } else {
        // No phase change, just update metrics and track angles
        updateRepAngles(angles);

        // Throttle state updates for metrics (every ~80ms)
        // This is handled by the component using this hook
      }

      // ------------------------------------------------------------------
      // Hybrid rep event override — if the hybrid detector fired a rep
      // that the angle-only FSM did not catch, count it here.
      // ------------------------------------------------------------------
      if (hybridRepEvent && hybridRepEvent.repNumber > repCountRef.current) {
        const now = Date.now();
        const minDuration = computeAdaptiveRepDurationMs({
          baseMinDurationMs: workoutDef.repBoundary.minDurationMs,
          recentRepDurationsMs: recentRepDurationsRef.current,
          trackingQuality: combineTrackingQuality(context?.trackingQuality, context?.shadowMeanAbsDelta),
        });

        if (now - lastRepTimestampRef.current > minDuration) {
          lastRepTimestampRef.current = now;
          repCountRef.current = hybridRepEvent.repNumber;
          const newRepCount = repCountRef.current;

          isInActiveRepRef.current = false;

          if (enableHaptics && Platform.OS === 'ios') {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
          }

          completeRepTracking(workoutDef.id, newRepCount, angles);

          setState((prev) => ({
            ...prev,
            repCount: newRepCount,
            metrics,
            isActive: true,
          }));

          if (__DEV__) {
            logWithTs(
              `[WorkoutController] Hybrid rep detected: #${newRepCount} source=${hybridRepEvent.source} confidence=${hybridRepEvent.confidence.toFixed(2)}`
            );
          }
        }
      }
    },
    [callbacks, enableHaptics, startRepTracking, updateRepAngles, completeRepTracking, emitFramePullupScoring, useHybridDetection]
  );

  // =============================================================================
  // Control Methods
  // =============================================================================

  const reset = useCallback((options?: ResetWorkoutOptions) => {
    const def = workoutDefRef.current;
    const initialPhase = (def?.initialPhase ?? 'idle') as TPhase;
    const preserveRepCount = options?.preserveRepCount ?? false;
    const nextRepCount = preserveRepCount ? repCountRef.current : 0;

    phaseRef.current = initialPhase;
    repCountRef.current = nextRepCount;
    pendingPhaseRef.current = null;
    pendingPhaseSinceRef.current = 0;
    recentRepDurationsRef.current = [];
    isInActiveRepRef.current = false;
    if (!preserveRepCount) {
      lastRepTimestampRef.current = 0;
    }
    repTrackingRef.current = {
      startTs: 0,
      startAngles: null,
      minAngles: null,
      maxAngles: null,
      cues: [],
      lastJoints: null,
    };

    // Reset hybrid detectors
    hybridDetectorRef.current?.reset();
    verticalTrackerRef.current?.reset();
    setHybridDetectionState({
      activeSource: 'angle',
      verticalSignal: null,
      isHybridActive: hybridDetectorRef.current !== null,
    });

    setState({
      phase: initialPhase,
      repCount: nextRepCount,
      metrics: null,
      isActive: false,
    });
  }, []);

  const setWorkout = useCallback((workoutId: DetectionMode) => {
    transitioningRef.current = true;
    workoutIdRef.current = workoutId;
    workoutDefRef.current = getWorkoutById(workoutId);
    reset();
    transitioningRef.current = false;
  }, [reset]);

  const getWorkoutDefinition = useCallback(() => {
    return workoutDefRef.current;
  }, []);

  const addRepCue = useCallback((cueType: string) => {
    if (repTrackingRef.current.startTs > 0) {
      repTrackingRef.current.cues.push({
        type: cueType,
        ts: new Date().toISOString(),
      });
    }
  }, []);

  return {
    state,
    processFrame,
    reset,
    setWorkout,
    getWorkoutDefinition,
    addRepCue,
    hybridDetectionState,
  };
}

export default useWorkoutController;
