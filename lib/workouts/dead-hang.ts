/**
 * Dead Hang Workout Definition
 *
 * Defines all the logic for tracking a dead hang:
 * - Phases: idle → hang → release
 * - Rep boundaries: starts at 'hang', ends at 'release'
 * - Metrics: elbow/shoulder angles + (optional) head-to-hand height signal
 * - Fault detection: bent arms, shrugged shoulders, short hold
 *
 * Note: Dead hang is primarily a static hold. We model a “rep” as one hold
 * from establishing a hang to releasing it so we can reuse the existing
 * rep/FQI logging pipeline.
 */

import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import type {
  WorkoutDefinition,
  PhaseDefinition,
  RepBoundary,
  FaultDefinition,
  FQIWeights,
  AngleRange,
  WorkoutMetrics,
  RepContext,
  ScoringMetricDefinition,
} from '@/lib/types/workout-definitions';

// =============================================================================
// Phase Type
// =============================================================================

export type DeadHangPhase = 'idle' | 'hang' | 'release';

// =============================================================================
// Metrics Type
// =============================================================================

export interface DeadHangMetrics extends WorkoutMetrics {
  avgElbow: number;
  avgShoulder: number;
  headToHand?: number;
  armsTracked: boolean;
  wristsTracked: boolean;
}

// =============================================================================
// Thresholds
// =============================================================================

export const DEAD_HANG_THRESHOLDS = {
  /** Full arm extension (dead hang) */
  elbowExtended: 150,
  /** Hands sufficiently above head (normalized Y distance) */
  handsAboveHead: 0.08,
  /** Hands no longer above head (normalized Y distance) */
  handsReleased: 0.03,
  /** Shoulder elevation warning threshold */
  shoulderElevation: 115,
  /** Minimum hold duration to count as a rep */
  minHoldMs: 1500,
  /** Shoulder angle below which we flag scapular retraction (arms not packed) */
  scapularRetractionMin: 80,
  /** Min oscillation between start / max hip (or shoulder) to flag kipping */
  kippingOscillationMin: 15,
  /** Max allowed left/right wrist angle delta before flagging grip-shift */
  gripShiftMaxDiff: 20,
} as const;

// =============================================================================
// Angle Ranges
// =============================================================================

const angleRanges: Record<string, AngleRange> = {
  elbow: {
    min: 140,
    max: 180,
    optimal: 170,
    tolerance: 10,
  },
  shoulder: {
    min: 60,
    max: 180,
    optimal: 90,
    tolerance: 25,
  },
};

const scoringMetrics: ScoringMetricDefinition[] = [
  {
    id: 'elbow',
    extract: (rep, side) => {
      if (side === 'left') {
        return {
          start: rep.start.leftElbow,
          end: rep.end.leftElbow,
          min: rep.min.leftElbow,
          max: rep.max.leftElbow,
        };
      }
      return {
        start: rep.start.rightElbow,
        end: rep.end.rightElbow,
        min: rep.min.rightElbow,
        max: rep.max.rightElbow,
      };
    },
  },
  {
    id: 'shoulder',
    extract: (rep, side) => {
      if (side === 'left') {
        return {
          start: rep.start.leftShoulder,
          end: rep.end.leftShoulder,
          min: rep.min.leftShoulder,
          max: rep.max.leftShoulder,
        };
      }
      return {
        start: rep.start.rightShoulder,
        end: rep.end.rightShoulder,
        min: rep.min.rightShoulder,
        max: rep.max.rightShoulder,
      };
    },
  },
];

// =============================================================================
// Phase Definitions
// =============================================================================

const phases: PhaseDefinition<DeadHangPhase>[] = [
  {
    id: 'idle',
    displayName: 'Ready',
    enterCondition: () => true,
    staticCue: 'Grip the bar and hang with straight arms.',
  },
  {
    id: 'hang',
    displayName: 'Hang',
    enterCondition: (angles: JointAngles) => {
      const avgElbow = (angles.leftElbow + angles.rightElbow) / 2;
      return avgElbow >= DEAD_HANG_THRESHOLDS.elbowExtended;
    },
    staticCue: 'Pack shoulders down, ribs tucked, keep arms straight.',
  },
  {
    id: 'release',
    displayName: 'Release',
    enterCondition: (_angles: JointAngles, prevPhase: DeadHangPhase) => prevPhase === 'hang',
    staticCue: 'Step down safely and reset your grip.',
  },
];

// =============================================================================
// Rep Boundary
// =============================================================================

const repBoundary: RepBoundary<DeadHangPhase> = {
  startPhase: 'hang',
  endPhase: 'release',
  minDurationMs: 800, // debounce between holds
};

// =============================================================================
// Fault Definitions
// =============================================================================

const faults: FaultDefinition[] = [
  {
    id: 'bent_arms',
    displayName: 'Bent Arms',
    condition: (ctx: RepContext) => {
      const minElbow = (ctx.minAngles.leftElbow + ctx.minAngles.rightElbow) / 2;
      return minElbow < DEAD_HANG_THRESHOLDS.elbowExtended - 10;
    },
    severity: 2,
    dynamicCue: 'Straighten your arms — keep a true dead hang.',
    fqiPenalty: 12,
  },
  {
    id: 'shrugged_shoulders',
    displayName: 'Shrugged Shoulders',
    condition: (ctx: RepContext) => {
      const maxShoulder = Math.max(ctx.maxAngles.leftShoulder, ctx.maxAngles.rightShoulder);
      return maxShoulder > DEAD_HANG_THRESHOLDS.shoulderElevation;
    },
    severity: 1,
    dynamicCue: 'Pack your shoulders down away from your ears.',
    fqiPenalty: 8,
  },
  {
    id: 'short_hold',
    displayName: 'Short Hold',
    condition: (ctx: RepContext) => ctx.durationMs < DEAD_HANG_THRESHOLDS.minHoldMs,
    severity: 1,
    dynamicCue: 'Hold a little longer to build grip and control.',
    fqiPenalty: 5,
  },
  // ---------------------------------------------------------------------------
  // Additional faults (issue #438): scapular_retraction, kipping_swing, grip_shift
  // ---------------------------------------------------------------------------
  {
    id: 'scapular_retraction',
    displayName: 'No Scapular Engagement',
    condition: (ctx: RepContext) => {
      // A packed dead hang expects the shoulder-to-torso angle to stay at/below
      // the scapularRetractionMin threshold (shoulders "pulled down"). A reading
      // well above this indicates the hanger never engaged the scaps and simply
      // dangled from the bar.
      const left = ctx.maxAngles.leftShoulder;
      const right = ctx.maxAngles.rightShoulder;
      if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
      const minShoulder = Math.min(left, right);
      return minShoulder < DEAD_HANG_THRESHOLDS.scapularRetractionMin;
    },
    severity: 2,
    dynamicCue: 'Pack your shoulders — pull them down and back into the sockets.',
    fqiPenalty: 10,
  },
  {
    id: 'kipping_swing',
    displayName: 'Kipping Swing',
    condition: (ctx: RepContext) => {
      // Hip-oscillation proxy: if the difference between start-hip and max-hip
      // (or start-shoulder vs max-shoulder) exceeds kippingOscillationMin on
      // either side, the athlete swung their body weight through the hold
      // instead of holding statically.
      const leftHipDelta = Math.abs(ctx.maxAngles.leftHip - ctx.startAngles.leftHip);
      const rightHipDelta = Math.abs(ctx.maxAngles.rightHip - ctx.startAngles.rightHip);
      const leftShoulderDelta = Math.abs(ctx.maxAngles.leftShoulder - ctx.startAngles.leftShoulder);
      const rightShoulderDelta = Math.abs(ctx.maxAngles.rightShoulder - ctx.startAngles.rightShoulder);
      const deltas = [leftHipDelta, rightHipDelta, leftShoulderDelta, rightShoulderDelta];
      if (deltas.some((d) => !Number.isFinite(d))) return false;
      return deltas.some((d) => d > DEAD_HANG_THRESHOLDS.kippingOscillationMin);
    },
    severity: 2,
    dynamicCue: 'Stay still — resist the urge to swing or kip.',
    fqiPenalty: 10,
  },
  {
    id: 'grip_shift',
    displayName: 'Grip Shift',
    condition: (ctx: RepContext) => {
      // JointAngles does not expose wrist angles directly; at a dead hang the
      // left/right ELBOW angle at maximum extension is the closest upstream
      // proxy for grip stability (a wrist re-grip twists the forearm and
      // perturbs elbow extension). Threshold tuned to gripShiftMaxDiff.
      const left = ctx.maxAngles.leftElbow;
      const right = ctx.maxAngles.rightElbow;
      if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
      return Math.abs(left - right) > DEAD_HANG_THRESHOLDS.gripShiftMaxDiff;
    },
    severity: 1,
    dynamicCue: 'Hold your grip steady — avoid re-gripping mid-hang.',
    fqiPenalty: 6,
  },
];

// =============================================================================
// FQI Weights
// =============================================================================

const fqiWeights: FQIWeights = {
  rom: 0.0, // dead hang is static; ROM score is not meaningful
  depth: 0.7,
  faults: 0.3,
};

// =============================================================================
// Metrics Calculator
// =============================================================================

function calculateMetrics(
  angles: JointAngles,
  joints?: Map<string, { x: number; y: number; isTracked: boolean }>
): DeadHangMetrics {
  const avgElbow = (angles.leftElbow + angles.rightElbow) / 2;
  const avgShoulder = (angles.leftShoulder + angles.rightShoulder) / 2;

  const armsTracked =
    angles.leftElbow > 0 &&
    angles.leftElbow < 180 &&
    angles.rightElbow > 0 &&
    angles.rightElbow < 180;

  let wristsTracked = false;
  let headToHand: number | undefined;

  if (joints) {
    const head = joints.get('head') ?? joints.get('neck');
    const leftWrist = joints.get('left_hand');
    const rightWrist = joints.get('right_hand');

    if (head?.isTracked && leftWrist?.isTracked && rightWrist?.isTracked) {
      wristsTracked = true;
      headToHand = head.y - (leftWrist.y + rightWrist.y) / 2;
    }
  }

  return {
    avgElbow,
    avgShoulder,
    headToHand,
    armsTracked,
    wristsTracked,
  };
}

// =============================================================================
// Phase State Machine
// =============================================================================

function getNextPhase(currentPhase: DeadHangPhase, _angles: JointAngles, metrics: DeadHangMetrics): DeadHangPhase {
  // If arms aren't tracked, treat as a release when coming from a hang so the rep can finalize.
  if (!metrics.armsTracked) {
    return currentPhase === 'hang' ? 'release' : 'idle';
  }

  const avgElbow = metrics.avgElbow;
  const avgShoulder = metrics.avgShoulder;
  const headToHand = metrics.headToHand;

  const handsAboveHead =
    typeof headToHand === 'number' && headToHand >= DEAD_HANG_THRESHOLDS.handsAboveHead;

  const handsReleased =
    typeof headToHand === 'number' && headToHand <= DEAD_HANG_THRESHOLDS.handsReleased;

  const elbowsExtended = typeof avgElbow === 'number' && avgElbow >= DEAD_HANG_THRESHOLDS.elbowExtended;

  // Establishing a hang requires hands-above-head signal if available.
  const isHanging = handsAboveHead && elbowsExtended;

  switch (currentPhase) {
    case 'idle':
      if (isHanging) return 'hang';
      return 'idle';

    case 'hang':
      // Release on hands dropping OR obvious arm disengagement.
      if (handsReleased || avgElbow < DEAD_HANG_THRESHOLDS.elbowExtended - 15) {
        return 'release';
      }
      // If we lose the hands signal entirely while hanging, avoid getting stuck forever.
      if (!metrics.wristsTracked && avgShoulder > DEAD_HANG_THRESHOLDS.shoulderElevation + 15) {
        return 'release';
      }
      return 'hang';

    case 'release':
      // Allow quick re-grip without forcing mode switch.
      if (isHanging) return 'hang';
      return 'idle';

    default:
      return 'idle';
  }
}

// =============================================================================
// Export Workout Definition
// =============================================================================

export const deadHangDefinition: WorkoutDefinition<DeadHangPhase, DeadHangMetrics> = {
  id: 'dead_hang',
  displayName: 'Dead Hang',
  description: 'Static hang to build grip strength and shoulder control.',
  category: 'upper_body',
  difficulty: 'beginner',

  phases,
  initialPhase: 'idle',
  repBoundary,
  thresholds: DEAD_HANG_THRESHOLDS,
  angleRanges,
  scoringMetrics,
  faults,
  fqiWeights,

  ui: {
    iconName: 'hand-left-outline',
    primaryMetric: { key: 'avgElbowDeg', label: 'Elbow', format: 'deg' },
    secondaryMetric: { key: 'avgShoulderDeg', label: 'Shoulder', format: 'deg' },
    buildUploadMetrics: (metrics) => ({
      avgElbowDeg: metrics?.avgElbow ?? null,
      avgShoulderDeg: metrics?.avgShoulder ?? null,
      headToHand: metrics?.headToHand ?? null,
    }),
    buildWatchMetrics: (metrics) => ({
      avgElbowDeg: metrics?.avgElbow ?? null,
      avgShoulderDeg: metrics?.avgShoulder ?? null,
      headToHand: metrics?.headToHand ?? null,
    }),
    getRealtimeCues: ({ phaseId, metrics }) => {
      const messages: string[] = [];
      const elbowExtended = DEAD_HANG_THRESHOLDS.elbowExtended;
      const shoulderElevation = DEAD_HANG_THRESHOLDS.shoulderElevation;

      if (phaseId === 'hang' && metrics.avgElbow < elbowExtended - 8) {
        messages.push('Straighten your arms for a true dead hang.');
      }

      if (metrics.avgShoulder > shoulderElevation) {
        messages.push('Pack shoulders down away from your ears.');
      }

      if (messages.length === 0) {
        messages.push('Stay tall — breathe and hold steady.');
      }

      return messages;
    },
  },

  calculateMetrics,
  getNextPhase,
};

export default deadHangDefinition;

