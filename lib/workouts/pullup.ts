/**
 * Pull-Up Workout Definition
 *
 * Defines all the logic for tracking pull-up form:
 * - Phases: idle → hang → pull → top
 * - Rep boundaries: starts at 'pull', ends at 'top'
 * - Thresholds for elbow angles
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

export type PullUpPhase = 'idle' | 'hang' | 'pull' | 'top';

// =============================================================================
// Metrics Type
// =============================================================================

export interface PullUpMetrics extends WorkoutMetrics {
  avgElbow: number;
  avgShoulder: number;
  headToHand?: number;
  armsTracked: boolean;
}

// =============================================================================
// Thresholds
// =============================================================================

export const PULLUP_THRESHOLDS = {
  /** Full arm extension (dead hang) */
  hang: 150,
  /** Arms start engaging (beginning pull) */
  engage: 135,
  /** Top of movement (chin over bar) */
  top: 85,
  /** Arms releasing back to hang */
  release: 145,
  /** Shoulder elevation warning threshold */
  shoulderElevation: 115,
} as const;

// =============================================================================
// Angle Ranges
// =============================================================================

const angleRanges: Record<string, AngleRange> = {
  elbow: {
    min: 70,      // Tightest at top
    max: 170,     // Full extension
    optimal: 80,  // Ideal top position
    tolerance: 15,
  },
  shoulder: {
    min: 60,
    max: 180,
    optimal: 90,
    tolerance: 20,
  },
};

// =============================================================================
// Phase Definitions
// =============================================================================

const phases: PhaseDefinition<PullUpPhase>[] = [
  {
    id: 'idle',
    displayName: 'Ready',
    enterCondition: () => true, // Default state
    staticCue: 'Get set beneath the bar and brace your core.',
  },
  {
    id: 'hang',
    displayName: 'Dead Hang',
    enterCondition: (angles: JointAngles) => {
      const avgElbow = (angles.leftElbow + angles.rightElbow) / 2;
      return avgElbow >= PULLUP_THRESHOLDS.hang;
    },
    staticCue: 'Engage your shoulders before you start the pull.',
  },
  {
    id: 'pull',
    displayName: 'Pulling',
    enterCondition: (angles: JointAngles, prevPhase: PullUpPhase) => {
      const avgElbow = (angles.leftElbow + angles.rightElbow) / 2;
      // Can enter from hang (normal) or idle (mid-rep start)
      return (prevPhase === 'hang' || prevPhase === 'idle') && 
             avgElbow <= PULLUP_THRESHOLDS.engage;
    },
    staticCue: 'Drive elbows toward your ribs and stay tight.',
  },
  {
    id: 'top',
    displayName: 'Top Position',
    enterCondition: (angles: JointAngles, prevPhase: PullUpPhase) => {
      const avgElbow = (angles.leftElbow + angles.rightElbow) / 2;
      return prevPhase === 'pull' && avgElbow <= PULLUP_THRESHOLDS.top;
    },
    staticCue: 'Squeeze at the top, then lower with control.',
  },
];

// =============================================================================
// Rep Boundary
// =============================================================================

const repBoundary: RepBoundary<PullUpPhase> = {
  startPhase: 'pull',
  endPhase: 'top',
  minDurationMs: 400, // Debounce to prevent double-counting
};

// =============================================================================
// Fault Definitions
// =============================================================================

const faults: FaultDefinition[] = [
  {
    id: 'incomplete_rom',
    displayName: 'Incomplete Range of Motion',
    condition: (ctx: RepContext) => {
      // Check if user didn't pull high enough (elbow didn't get low enough)
      const minElbow = (ctx.minAngles.leftElbow + ctx.minAngles.rightElbow) / 2;
      return minElbow > PULLUP_THRESHOLDS.top + 15;
    },
    severity: 2,
    dynamicCue: 'Pull higher to bring your chin past the bar.',
    fqiPenalty: 15,
  },
  {
    id: 'incomplete_extension',
    displayName: 'Incomplete Arm Extension',
    condition: (ctx: RepContext) => {
      // Check if arms weren't fully extended at start
      const startElbow = (ctx.startAngles.leftElbow + ctx.startAngles.rightElbow) / 2;
      return startElbow < PULLUP_THRESHOLDS.hang - 10;
    },
    severity: 1,
    dynamicCue: 'Fully extend your arms before the next rep.',
    fqiPenalty: 10,
  },
  {
    id: 'shoulder_elevation',
    displayName: 'Elevated Shoulders',
    condition: (ctx: RepContext) => {
      // Check if shoulders were shrugged up during the rep
      const maxShoulder = Math.max(ctx.maxAngles.leftShoulder, ctx.maxAngles.rightShoulder);
      return maxShoulder > PULLUP_THRESHOLDS.shoulderElevation;
    },
    severity: 2,
    dynamicCue: 'Draw your shoulders down to keep your lats engaged.',
    fqiPenalty: 12,
  },
  {
    id: 'asymmetric_pull',
    displayName: 'Asymmetric Pulling',
    condition: (ctx: RepContext) => {
      // Check if left and right sides are significantly different
      const elbowDiff = Math.abs(ctx.minAngles.leftElbow - ctx.minAngles.rightElbow);
      return elbowDiff > 20;
    },
    severity: 1,
    dynamicCue: 'Pull evenly with both arms.',
    fqiPenalty: 8,
  },
  {
    id: 'fast_descent',
    displayName: 'Fast Uncontrolled Descent',
    condition: (ctx: RepContext) => {
      // If rep is very short, likely dropped too fast
      // This is a simplified check - ideally we'd track velocity
      return ctx.durationMs < 800;
    },
    severity: 1,
    dynamicCue: 'Control the descent — lower with intention.',
    fqiPenalty: 5,
  },
];

// =============================================================================
// FQI Weights
// =============================================================================

const fqiWeights: FQIWeights = {
  rom: 0.4,     // Range of motion contributes 40%
  depth: 0.3,   // Depth/top position contributes 30%
  faults: 0.3,  // Fault deductions contribute 30%
};

// =============================================================================
// Metrics Calculator
// =============================================================================

function calculateMetrics(
  angles: JointAngles,
  joints?: Map<string, { x: number; y: number; isTracked: boolean }>
): PullUpMetrics {
  const avgElbow = (angles.leftElbow + angles.rightElbow) / 2;
  const avgShoulder = (angles.leftShoulder + angles.rightShoulder) / 2;

  // Calculate head to hand distance if joints are available
  let headToHand: number | undefined;
  if (joints) {
    const head = joints.get('head') ?? joints.get('neck');
    const leftWrist = joints.get('left_hand');
    const rightWrist = joints.get('right_hand');

    if (head?.isTracked && leftWrist?.isTracked && rightWrist?.isTracked) {
      headToHand = head.y - (leftWrist.y + rightWrist.y) / 2;
    }
  }

  // Check if both elbows are being tracked (valid angle range)
  const armsTracked = 
    angles.leftElbow > 0 && angles.leftElbow < 180 &&
    angles.rightElbow > 0 && angles.rightElbow < 180;

  return {
    avgElbow,
    avgShoulder,
    headToHand,
    armsTracked,
  };
}

// =============================================================================
// Phase State Machine
// =============================================================================

function getNextPhase(
  currentPhase: PullUpPhase,
  angles: JointAngles,
  metrics: PullUpMetrics
): PullUpPhase {
  // If arms aren't tracked, return to idle
  if (!metrics.armsTracked) {
    return 'idle';
  }

  const avgElbow = metrics.avgElbow;

  switch (currentPhase) {
    case 'idle':
      if (avgElbow >= PULLUP_THRESHOLDS.hang) {
        return 'hang';
      }
      if (avgElbow <= PULLUP_THRESHOLDS.engage) {
        return 'pull';
      }
      return 'idle';

    case 'hang':
      if (avgElbow <= PULLUP_THRESHOLDS.engage) {
        return 'pull';
      }
      return 'hang';

    case 'pull':
      if (avgElbow <= PULLUP_THRESHOLDS.top) {
        return 'top';
      }
      if (avgElbow >= PULLUP_THRESHOLDS.hang) {
        return 'hang';
      }
      return 'pull';

    case 'top':
      if (avgElbow >= PULLUP_THRESHOLDS.release) {
        return 'hang';
      }
      return 'top';

    default:
      return 'idle';
  }
}

// =============================================================================
// Export Workout Definition
// =============================================================================

export const pullupDefinition: WorkoutDefinition<PullUpPhase, PullUpMetrics> = {
  id: 'pullup',
  displayName: 'Pull-Up',
  description: 'Upper body pulling movement targeting lats, biceps, and core.',
  category: 'upper_body',
  difficulty: 'intermediate',

  phases,
  initialPhase: 'idle',
  repBoundary,
  thresholds: PULLUP_THRESHOLDS,
  angleRanges,
  faults,
  fqiWeights,

  calculateMetrics,
  getNextPhase,
};

export default pullupDefinition;
