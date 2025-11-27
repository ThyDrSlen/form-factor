/**
 * Push-Up Workout Definition
 *
 * Defines all the logic for tracking push-up form:
 * - Phases: setup → plank → lowering → bottom → press → plank
 * - Rep boundaries: starts at 'lowering', ends at 'plank' (after press)
 * - Thresholds for elbow angles and hip stability
 * - Fault detection conditions
 * - FQI calculation weights
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
} from '@/lib/types/workout-definitions';

// =============================================================================
// Phase Type
// =============================================================================

export type PushUpPhase = 'setup' | 'plank' | 'lowering' | 'bottom' | 'press';

// =============================================================================
// Metrics Type
// =============================================================================

export interface PushUpMetrics extends WorkoutMetrics {
  avgElbow: number;
  hipDrop: number | null;
  armsTracked: boolean;
  wristsTracked: boolean;
}

// =============================================================================
// Thresholds
// =============================================================================

export const PUSHUP_THRESHOLDS = {
  /** Arms nearly locked out (plank position) */
  readyElbow: 155,
  /** Begin counting a descent */
  loweringStart: 140,
  /** Bottom position (elbows at ~90°) */
  bottom: 90,
  /** On the way up, transitioning to press */
  press: 120,
  /** Completed press (back to lockout) */
  finish: 155,
  /** Maximum allowed hip drop ratio vs shoulders */
  hipSagMax: 0.18,
} as const;

// =============================================================================
// Angle Ranges
// =============================================================================

const angleRanges: Record<string, AngleRange> = {
  elbow: {
    min: 80,      // Bottom position
    max: 170,     // Full lockout
    optimal: 90,  // Ideal bottom position
    tolerance: 10,
  },
  hip: {
    min: 160,     // Slight bend acceptable
    max: 180,     // Perfectly straight
    optimal: 175, // Neutral spine
    tolerance: 10,
  },
};

// =============================================================================
// Phase Definitions
// =============================================================================

const phases: PhaseDefinition<PushUpPhase>[] = [
  {
    id: 'setup',
    displayName: 'Setup',
    enterCondition: () => true, // Default state when arms/wrists not tracked
    staticCue: 'Set a strong plank: hands under shoulders, glutes tight.',
  },
  {
    id: 'plank',
    displayName: 'High Plank',
    enterCondition: (angles: JointAngles) => {
      const avgElbow = (angles.leftElbow + angles.rightElbow) / 2;
      return avgElbow >= PUSHUP_THRESHOLDS.readyElbow;
    },
    staticCue: 'Lower under control; keep hips level.',
  },
  {
    id: 'lowering',
    displayName: 'Lowering',
    enterCondition: (angles: JointAngles, prevPhase: PushUpPhase) => {
      const avgElbow = (angles.leftElbow + angles.rightElbow) / 2;
      return prevPhase === 'plank' && avgElbow <= PUSHUP_THRESHOLDS.loweringStart;
    },
    staticCue: 'Elbows ~45°; keep core braced.',
  },
  {
    id: 'bottom',
    displayName: 'Bottom Position',
    enterCondition: (angles: JointAngles, prevPhase: PushUpPhase) => {
      const avgElbow = (angles.leftElbow + angles.rightElbow) / 2;
      return prevPhase === 'lowering' && avgElbow <= PUSHUP_THRESHOLDS.bottom;
    },
    staticCue: 'Pause briefly, chest just above the floor.',
  },
  {
    id: 'press',
    displayName: 'Pressing',
    enterCondition: (angles: JointAngles, prevPhase: PushUpPhase) => {
      const avgElbow = (angles.leftElbow + angles.rightElbow) / 2;
      return prevPhase === 'bottom' && avgElbow >= PUSHUP_THRESHOLDS.press;
    },
    staticCue: 'Drive the floor away and lock out.',
  },
];

// =============================================================================
// Rep Boundary
// =============================================================================

const repBoundary: RepBoundary<PushUpPhase> = {
  startPhase: 'lowering',
  endPhase: 'plank', // Rep completes when returning to plank after press
  minDurationMs: 400, // Debounce to prevent double-counting
};

// =============================================================================
// Fault Definitions
// =============================================================================

const faults: FaultDefinition[] = [
  {
    id: 'hip_sag',
    displayName: 'Hip Sag',
    condition: (ctx: RepContext) => {
      // This would require tracking hip position during the rep
      // For now, we'll check if hip angles indicate sag
      const avgHip = (ctx.minAngles.leftHip + ctx.minAngles.rightHip) / 2;
      return avgHip < 160; // Hips dropped below neutral
    },
    severity: 2,
    dynamicCue: 'Squeeze glutes to stop hip sag.',
    fqiPenalty: 15,
  },
  {
    id: 'incomplete_lockout',
    displayName: 'Incomplete Lockout',
    condition: (ctx: RepContext) => {
      // Arms weren't fully extended at end of rep
      const endElbow = (ctx.endAngles.leftElbow + ctx.endAngles.rightElbow) / 2;
      return endElbow < PUSHUP_THRESHOLDS.readyElbow - 10;
    },
    severity: 1,
    dynamicCue: 'Start from a full lockout to count clean reps.',
    fqiPenalty: 10,
  },
  {
    id: 'shallow_depth',
    displayName: 'Shallow Depth',
    condition: (ctx: RepContext) => {
      // Didn't lower deep enough
      const minElbow = (ctx.minAngles.leftElbow + ctx.minAngles.rightElbow) / 2;
      return minElbow > PUSHUP_THRESHOLDS.bottom + 15;
    },
    severity: 2,
    dynamicCue: 'Lower deeper until elbows hit ~90°.',
    fqiPenalty: 12,
  },
  {
    id: 'asymmetric_press',
    displayName: 'Asymmetric Pressing',
    condition: (ctx: RepContext) => {
      // Left and right sides significantly different
      const elbowDiff = Math.abs(ctx.minAngles.leftElbow - ctx.minAngles.rightElbow);
      return elbowDiff > 20;
    },
    severity: 1,
    dynamicCue: 'Press evenly with both arms.',
    fqiPenalty: 8,
  },
  {
    id: 'fast_rep',
    displayName: 'Rushed Repetition',
    condition: (ctx: RepContext) => {
      // Rep was too fast (no control)
      return ctx.durationMs < 600;
    },
    severity: 1,
    dynamicCue: 'Smooth tempo — steady down, strong press up.',
    fqiPenalty: 5,
  },
  {
    id: 'elbow_flare',
    displayName: 'Elbow Flare',
    condition: (ctx: RepContext) => {
      // Check shoulder angle for excessive flare
      // Higher shoulder angle during bottom typically indicates flared elbows
      const maxShoulder = Math.max(ctx.maxAngles.leftShoulder, ctx.maxAngles.rightShoulder);
      return maxShoulder > 120;
    },
    severity: 2,
    dynamicCue: 'Keep elbows at ~45° to protect your shoulders.',
    fqiPenalty: 10,
  },
];

// =============================================================================
// FQI Weights
// =============================================================================

const fqiWeights: FQIWeights = {
  rom: 0.35,    // Range of motion contributes 35%
  depth: 0.35,  // Depth/bottom position contributes 35%
  faults: 0.30, // Fault deductions contribute 30%
};

// =============================================================================
// Metrics Calculator
// =============================================================================

function calculateMetrics(
  angles: JointAngles,
  joints?: Map<string, { x: number; y: number; isTracked: boolean }>
): PushUpMetrics {
  const avgElbow = (angles.leftElbow + angles.rightElbow) / 2;

  // Calculate hip drop if joints are available
  let hipDrop: number | null = null;
  if (joints) {
    const leftShoulder = joints.get('left_shoulder');
    const rightShoulder = joints.get('right_shoulder');
    const leftHip = joints.get('left_upLeg') ?? joints.get('left_hip');
    const rightHip = joints.get('right_upLeg') ?? joints.get('right_hip');
    const leftAnkle = joints.get('left_foot') ?? joints.get('left_ankle');
    const rightAnkle = joints.get('right_foot') ?? joints.get('right_ankle');

    if (
      leftShoulder?.isTracked && rightShoulder?.isTracked &&
      leftHip?.isTracked && rightHip?.isTracked &&
      leftAnkle?.isTracked && rightAnkle?.isTracked
    ) {
      const shoulderY = (leftShoulder.y + rightShoulder.y) / 2;
      const hipY = (leftHip.y + rightHip.y) / 2;
      const ankleY = (leftAnkle.y + rightAnkle.y) / 2;
      const torsoLength = Math.max(0.001, Math.abs(shoulderY - ankleY));
      hipDrop = Math.abs(hipY - shoulderY) / torsoLength;
    }
  }

  // Check tracking status
  const armsTracked =
    angles.leftElbow > 0 && angles.leftElbow < 180 &&
    angles.rightElbow > 0 && angles.rightElbow < 180;

  const wristsTracked = joints
    ? (joints.get('left_hand')?.isTracked ?? false) &&
      (joints.get('right_hand')?.isTracked ?? false)
    : false;

  return {
    avgElbow,
    hipDrop,
    armsTracked,
    wristsTracked,
  };
}

// =============================================================================
// Phase State Machine
// =============================================================================

function getNextPhase(
  currentPhase: PushUpPhase,
  angles: JointAngles,
  metrics: PushUpMetrics
): PushUpPhase {
  // If arms or wrists aren't tracked, return to setup
  if (!metrics.armsTracked || !metrics.wristsTracked) {
    return 'setup';
  }

  const elbow = metrics.avgElbow;
  const hipStable = metrics.hipDrop === null ? true : metrics.hipDrop <= PUSHUP_THRESHOLDS.hipSagMax;

  switch (currentPhase) {
    case 'setup':
      if (elbow >= PUSHUP_THRESHOLDS.readyElbow && hipStable) {
        return 'plank';
      }
      return 'setup';

    case 'plank':
      if (elbow <= PUSHUP_THRESHOLDS.loweringStart) {
        return 'lowering';
      }
      return 'plank';

    case 'lowering':
      if (elbow <= PUSHUP_THRESHOLDS.bottom) {
        return 'bottom';
      }
      return 'lowering';

    case 'bottom':
      if (elbow >= PUSHUP_THRESHOLDS.press) {
        return 'press';
      }
      return 'bottom';

    case 'press':
      if (elbow >= PUSHUP_THRESHOLDS.finish && hipStable) {
        return 'plank'; // Rep completes, return to plank
      }
      return 'press';

    default:
      return 'setup';
  }
}

// =============================================================================
// Export Workout Definition
// =============================================================================

export const pushupDefinition: WorkoutDefinition<PushUpPhase, PushUpMetrics> = {
  id: 'pushup',
  displayName: 'Push-Up',
  description: 'Upper body pressing movement targeting chest, shoulders, and triceps.',
  category: 'upper_body',
  difficulty: 'beginner',

  phases,
  initialPhase: 'setup',
  repBoundary,
  thresholds: PUSHUP_THRESHOLDS,
  angleRanges,
  faults,
  fqiWeights,

  calculateMetrics,
  getNextPhase,
};

export default pushupDefinition;
