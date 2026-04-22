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
import { errorWithTs, logWithTs, warnWithTs } from '@/lib/logger';
import { hapticBus } from '@/lib/haptics/haptic-bus';
import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import type { WorkoutDefinition, WorkoutMetrics } from '@/lib/types/workout-definitions';
import { getWorkoutById, type DetectionMode } from '@/lib/workouts';
import { calculateFqi, extractRepFeatures, type RepAngles } from '@/lib/services/fqi-calculator';
import { logRep } from '@/lib/services/rep-logger';
import type { RepEvent } from '@/lib/types/telemetry';
import { computeAdaptivePhaseHoldMs, computeAdaptiveRepDurationMs } from '@/lib/services/workout-runtime';
import { selectShadowProvider } from '@/lib/pose/shadow-provider';
import {
  scorePullupWithComponentAvailability,
  type PullupScoringInput,
  type PullupScoringResult,
} from '@/lib/tracking-quality/scoring';

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
  /**
   * Called when \`logRep()\` fails after all in-session retries. The rep is
   * still queued in-memory and will be retried on the next successful
   * logRep call, but the UI can surface a retry banner or toast in response
   * to this callback. \`queueDepth\` is the number of reps currently pending.
   */
  onRepLogFailure?: (error: unknown, queueDepth: number) => void;
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
   * When true the controller will not advance phase / count reps.
   *
   * Wired by `hooks/use-device-thermal-battery` via `shouldPauseLowPower`.
   *
   * TODO(#464): if PR #427 / #434 land a richer pause API on this hook
   * before this PR merges, swap this flag for the canonical structure.
   * For now it is intentionally additive so the merge stays trivial.
   */
  pauseTracking?: boolean;
}

export interface ResetWorkoutOptions {
  preserveRepCount?: boolean;
}

/**
 * Sentinel error the controller passes to `onRepLogFailure` when the caller
 * stops tracking with unsent reps still queued. UI layers can duck-type on
 * `.code === 'PENDING_REPS_AT_STOP'` to show a "N reps pending sync" toast.
 */
export interface PendingRepsAtStopSignal {
  code: 'PENDING_REPS_AT_STOP';
  count: number;
}

export function isPendingRepsAtStopSignal(
  err: unknown,
): err is PendingRepsAtStopSignal {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === 'PENDING_REPS_AT_STOP'
  );
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
  /**
   * Number of rep-log writes currently queued for retry (writes that failed
   * their initial `logRep()` and are waiting for the next successful write
   * to drain the queue).
   */
  getPendingRepCount: () => number;
  /**
   * Called from the host's stopTracking() *before* the controller resets.
   * When the pending-writes queue is non-empty this invokes
   * `callbacks.onRepLogFailure` with a `PendingRepsAtStopSignal` sentinel
   * error + the queue depth so the UI can surface a "N reps pending sync"
   * toast before state is wiped. Returns the count that was reported (0
   * when queue was empty and no callback fired).
   */
  flushPendingRepsOnStop: () => number;
}

// =============================================================================
// Hook Implementation
// =============================================================================

export function useWorkoutController<TPhase extends string = string>(
  initialWorkoutId: DetectionMode,
  options: UseWorkoutControllerOptions
): UseWorkoutControllerReturn<TPhase> {
  const { sessionId, callbacks, enableHaptics = true, pauseTracking = false } = options;
  // Mirror the prop into a ref so the per-frame closure can read the latest
  // value without re-binding `processFrame` on every change.
  const pauseRef = useRef<boolean>(pauseTracking);
  useEffect(() => {
    pauseRef.current = pauseTracking;
  }, [pauseTracking]);

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
  // Failed-rep-write queue
  //
  // \`logRep()\` writes directly to Supabase and can fail for transient
  // reasons (offline, auth refresh, RLS throttling). Previously rejections
  // were only logged in __DEV__, meaning production sessions silently lost
  // reps. The queue below retains the event payload so subsequent successful
  // writes will drain it in order; we also notify the UI via
  // \`callbacks.onRepLogFailure\` so a retry affordance can be surfaced.
  // =============================================================================

  const pendingRepWritesRef = useRef<RepEvent[]>([]);
  const MAX_PENDING_REPS = 64; // bounded so a disconnected session can't grow forever

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

      // Build the rep event now so retries can re-use the exact payload.
      const repEvent: RepEvent = {
        sessionId,
        repIndex: repNumber,
        exercise,
        startTs: new Date(tracking.startTs).toISOString(),
        endTs: new Date(endTs).toISOString(),
        features,
        fqi: fqiResult.score,
        faultsDetected: fqiResult.detectedFaults,
        cuesEmitted: tracking.cues,
      };

      // Drain any previously queued rep writes on best-effort; if one still
      // fails we re-queue it and stop so ordering is preserved.
      const queue = pendingRepWritesRef.current;
      while (queue.length > 0) {
        const pending = queue[0];
        try {
          await logRep(pending);
          queue.shift();
        } catch (drainError) {
          if (__DEV__) {
            warnWithTs('[WorkoutController] Queue drain failed, will retry later', drainError);
          }
          break;
        }
      }

      // Log the new rep.
      try {
        await logRep(repEvent);

        if (__DEV__) {
          logWithTs(
            `[WorkoutController] Rep ${repNumber} logged: FQI=${fqiResult.score}, faults=${fqiResult.detectedFaults.join(',')}`
          );
        }
      } catch (error) {
        // Rejection path — production previously lost this rep silently.
        // Now: enqueue for retry, notify the UI, log (once per rep regardless
        // of __DEV__ since production observability matters for data loss).
        if (queue.length < MAX_PENDING_REPS) {
          queue.push(repEvent);
        } else if (__DEV__) {
          warnWithTs('[WorkoutController] Pending-rep queue full, dropping oldest entry');
          queue.shift();
          queue.push(repEvent);
        }
        errorWithTs('[WorkoutController] Failed to log rep (queued for retry)', {
          repNumber,
          queueDepth: queue.length,
          error,
        });
        try {
          callbacks?.onRepLogFailure?.(error, queue.length);
        } catch (cbError) {
          if (__DEV__) {
            warnWithTs('[WorkoutController] onRepLogFailure callback threw', cbError);
          }
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
      // Auto-pause from the battery+thermal hook — bail before any phase
      // logic so we keep the last-known phase / repCount stable.
      if (pauseRef.current) return;

      const workoutDef = workoutDefRef.current;
      if (!workoutDef) return;

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

            // Cross-platform haptic feedback via the shared bus so Android
            // and iOS both get a rep-complete cue (issue #428).
            if (enableHaptics) {
              hapticBus.emit('rep.complete');
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
    },
    [callbacks, enableHaptics, startRepTracking, updateRepAngles, completeRepTracking, emitFramePullupScoring]
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

  const getPendingRepCount = useCallback((): number => {
    return pendingRepWritesRef.current.length;
  }, []);

  const flushPendingRepsOnStop = useCallback((): number => {
    const count = pendingRepWritesRef.current.length;
    if (count === 0) return 0;
    // Reuse the existing onRepLogFailure channel so the UI has a single
    // surface for rep-log failure toasts — at-stop and in-session alike.
    // The signal carries an explicit code so callers can tailor the copy
    // ("N reps pending sync" vs. per-rep retry banner).
    const signal: PendingRepsAtStopSignal = { code: 'PENDING_REPS_AT_STOP', count };
    try {
      callbacks?.onRepLogFailure?.(signal, count);
    } catch (cbError) {
      if (__DEV__) {
        warnWithTs('[WorkoutController] onRepLogFailure (stop-signal) threw', cbError);
      }
    }
    return count;
  }, [callbacks]);

  return {
    state,
    processFrame,
    reset,
    setWorkout,
    getWorkoutDefinition,
    addRepCue,
    getPendingRepCount,
    flushPendingRepsOnStop,
  };
}

export default useWorkoutController;
