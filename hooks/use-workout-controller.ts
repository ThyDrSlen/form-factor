/**
 * Workout Controller Hook
 *
 * Unified controller for workout tracking that uses workout definitions
 * from lib/workouts/ to drive phase transitions, rep counting, and metrics.
 *
 * This replaces the hardcoded updatePullUpCycle/updatePushUpCycle functions
 * in scan-arkit.tsx with a factory pattern that works with any workout definition.
 */

import { useCallback, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { errorWithTs, logWithTs, warnWithTs } from '@/lib/logger';
import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import type { WorkoutDefinition, WorkoutMetrics } from '@/lib/types/workout-definitions';
import { getWorkoutById, type DetectionMode } from '@/lib/workouts';
import { calculateFqi, extractRepFeatures, type RepAngles } from '@/lib/services/fqi-calculator';
import { logRep } from '@/lib/services/rep-logger';

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
}

export interface WorkoutControllerCallbacks {
  /** Called when a rep is completed */
  onRepComplete?: (repNumber: number, fqi: number, faults: string[]) => void;
  /** Called when phase changes */
  onPhaseChange?: (newPhase: string, prevPhase: string) => void;
  /** Called when a cue should be emitted */
  onCue?: (cue: string, type: 'static' | 'dynamic') => void;
}

export interface UseWorkoutControllerOptions {
  /** Session ID for logging */
  sessionId: string;
  /** Callbacks for workout events */
  callbacks?: WorkoutControllerCallbacks;
  /** Enable haptic feedback on rep completion */
  enableHaptics?: boolean;
}

export interface ResetWorkoutOptions {
  preserveRepCount?: boolean;
}

export interface UseWorkoutControllerReturn<TPhase extends string = string> {
  /** Current workout state */
  state: WorkoutControllerState<TPhase>;
  /** Process a new frame of joint angles */
  processFrame: (angles: JointAngles, joints?: Map<string, { x: number; y: number; isTracked: boolean }>) => void;
  /** Reset the workout state */
  reset: (options?: ResetWorkoutOptions) => void;
  /** Change the active workout */
  setWorkout: (workoutId: DetectionMode) => void;
  /** Get the current workout definition */
  getWorkoutDefinition: () => WorkoutDefinition | undefined;
  /** Add a cue to the current rep's tracking data */
  addRepCue: (cueType: string) => void;
}

// =============================================================================
// Hook Implementation
// =============================================================================

export function useWorkoutController<TPhase extends string = string>(
  initialWorkoutId: DetectionMode,
  options: UseWorkoutControllerOptions
): UseWorkoutControllerReturn<TPhase> {
  const { sessionId, callbacks, enableHaptics = true } = options;

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
  const lastRepTimestampRef = useRef<number>(0);

  // Rep tracking data
  const repTrackingRef = useRef<RepTrackingData>({
    startTs: 0,
    startAngles: null,
    minAngles: null,
    maxAngles: null,
    cues: [],
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

        // Notify callback
        callbacks?.onRepComplete?.(repNumber, fqiResult.score, fqiResult.detectedFaults);
      } catch (error) {
        if (__DEV__) {
          errorWithTs('[WorkoutController] Failed to log rep', error);
        }
      }

      // Reset tracking state
      repTrackingRef.current = {
        startTs: 0,
        startAngles: null,
        minAngles: null,
        maxAngles: null,
        cues: [],
      };
    },
    [sessionId, callbacks]
  );

  // =============================================================================
  // Phase Transition Logic
  // =============================================================================

  const processFrame = useCallback(
    (angles: JointAngles, joints?: Map<string, { x: number; y: number; isTracked: boolean }>) => {
      const workoutDef = workoutDefRef.current;
      if (!workoutDef) return;

      // Calculate metrics using the workout's calculator
      const metrics = workoutDef.calculateMetrics(angles, joints);

      // Get next phase using the workout's state machine
      const currentPhase = phaseRef.current as string;
      const nextPhase = workoutDef.getNextPhase(currentPhase, angles, metrics) as TPhase;

      // Check for phase transition
      if (nextPhase !== currentPhase) {
        const prevPhase = currentPhase;
        phaseRef.current = nextPhase;

        // Notify callback
        callbacks?.onPhaseChange?.(nextPhase, prevPhase);

        // Check if this transition starts a rep
        if (nextPhase === workoutDef.repBoundary.startPhase) {
          startRepTracking(angles);
        }

        // Check if this transition completes a rep
        if (nextPhase === workoutDef.repBoundary.endPhase && prevPhase !== workoutDef.initialPhase) {
          const now = Date.now();
          const minDuration = workoutDef.repBoundary.minDurationMs;

          if (now - lastRepTimestampRef.current > minDuration) {
            lastRepTimestampRef.current = now;
            repCountRef.current += 1;
            const newRepCount = repCountRef.current;

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
    },
    [callbacks, enableHaptics, startRepTracking, updateRepAngles, completeRepTracking]
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
    if (!preserveRepCount) {
      lastRepTimestampRef.current = 0;
    }
    repTrackingRef.current = {
      startTs: 0,
      startAngles: null,
      minAngles: null,
      maxAngles: null,
      cues: [],
    };

    setState({
      phase: initialPhase,
      repCount: nextRepCount,
      metrics: null,
      isActive: false,
    });
  }, []);

  const setWorkout = useCallback((workoutId: DetectionMode) => {
    workoutIdRef.current = workoutId;
    workoutDefRef.current = getWorkoutById(workoutId);
    reset();
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
  };
}

export default useWorkoutController;
