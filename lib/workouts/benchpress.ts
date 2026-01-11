/**
 * Bench Press Workout Definition
 *
 * Defines all the logic for tracking bench press form:
 * - Phases: setup → lockout → lowering → bottom → press → lockout
 * - Rep boundaries: starts at 'lowering', ends at 'lockout'
 * - Thresholds for elbow angles and shoulder position
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
  ScoringMetricDefinition,
} from '@/lib/types/workout-definitions';

// =============================================================================
// Phase Type
// =============================================================================

export type BenchPressPhase = 'setup' | 'lockout' | 'lowering' | 'bottom' | 'press';

// =============================================================================
// Metrics Type
// =============================================================================

export interface BenchPressMetrics extends WorkoutMetrics {
  avgElbow: number;
  avgShoulder: number;
  armsTracked: boolean;
  wristsTracked: boolean;
}

// =============================================================================
// Thresholds
// =============================================================================

export const BENCHPRESS_THRESHOLDS = {
  /** Arms nearly locked out at the top */
  readyElbow: 155,
  /** Begin counting a descent */
  loweringStart: 140,
  /** Bottom position (bar near chest) */
  bottom: 90,
  /** On the way up, transitioning to press */
  press: 120,
  /** Completed press (back to lockout) */
  finish: 155,
  /** Shoulder angle above this is treated as elbow flare */
  elbowFlareShoulderMax: 120,
} as const;

// =============================================================================
// Angle Ranges
// =============================================================================

const angleRanges: Record<string, AngleRange> = {
  elbow: {
    min: 80,
    max: 170,
    optimal: 90,
    tolerance: 10,
  },
  shoulder: {
    min: 60,
    max: 180,
    optimal: 90,
    tolerance: 20,
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

const phases: PhaseDefinition<BenchPressPhase>[] = [
  {
    id: 'setup',
    displayName: 'Setup',
    enterCondition: () => true,
    staticCue: 'Set feet, brace, and keep wrists stacked over elbows.',
  },
  {
    id: 'lockout',
    displayName: 'Lockout',
    enterCondition: (angles: JointAngles) => {
      const avgElbow = (angles.leftElbow + angles.rightElbow) / 2;
      return avgElbow >= BENCHPRESS_THRESHOLDS.readyElbow;
    },
    staticCue: 'Control the descent; keep elbows tucked slightly.',
  },
  {
    id: 'lowering',
    displayName: 'Lowering',
    enterCondition: (angles: JointAngles, prevPhase: BenchPressPhase) => {
      const avgElbow = (angles.leftElbow + angles.rightElbow) / 2;
      return prevPhase === 'lockout' && avgElbow <= BENCHPRESS_THRESHOLDS.loweringStart;
    },
    staticCue: 'Lower under control and stay tight through your upper back.',
  },
  {
    id: 'bottom',
    displayName: 'Bottom Position',
    enterCondition: (angles: JointAngles, prevPhase: BenchPressPhase) => {
      const avgElbow = (angles.leftElbow + angles.rightElbow) / 2;
      return prevPhase === 'lowering' && avgElbow <= BENCHPRESS_THRESHOLDS.bottom;
    },
    staticCue: 'Brief pause; keep wrists neutral and elbows under the bar.',
  },
  {
    id: 'press',
    displayName: 'Pressing',
    enterCondition: (angles: JointAngles, prevPhase: BenchPressPhase) => {
      const avgElbow = (angles.leftElbow + angles.rightElbow) / 2;
      return prevPhase === 'bottom' && avgElbow >= BENCHPRESS_THRESHOLDS.press;
    },
    staticCue: 'Press up smoothly and finish with a strong lockout.',
  },
];

// =============================================================================
// Rep Boundary
// =============================================================================

const repBoundary: RepBoundary<BenchPressPhase> = {
  startPhase: 'lowering',
  endPhase: 'lockout',
  minDurationMs: 400,
};

// =============================================================================
// Fault Definitions
// =============================================================================

const faults: FaultDefinition[] = [
  {
    id: 'incomplete_lockout',
    displayName: 'Incomplete Lockout',
    condition: (ctx: RepContext) => {
      const endElbow = (ctx.endAngles.leftElbow + ctx.endAngles.rightElbow) / 2;
      return endElbow < BENCHPRESS_THRESHOLDS.readyElbow - 10;
    },
    severity: 1,
    dynamicCue: 'Finish each rep with a full lockout.',
    fqiPenalty: 10,
  },
  {
    id: 'shallow_depth',
    displayName: 'Shallow Depth',
    condition: (ctx: RepContext) => {
      const minElbow = (ctx.minAngles.leftElbow + ctx.minAngles.rightElbow) / 2;
      return minElbow > BENCHPRESS_THRESHOLDS.bottom + 15;
    },
    severity: 2,
    dynamicCue: 'Lower the bar closer to your chest for full range.',
    fqiPenalty: 12,
  },
  {
    id: 'asymmetric_press',
    displayName: 'Asymmetric Pressing',
    condition: (ctx: RepContext) => {
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
    condition: (ctx: RepContext) => ctx.durationMs < 600,
    severity: 1,
    dynamicCue: 'Slow the descent and press with control.',
    fqiPenalty: 5,
  },
  {
    id: 'elbow_flare',
    displayName: 'Elbow Flare',
    condition: (ctx: RepContext) => {
      const maxShoulder = Math.max(ctx.maxAngles.leftShoulder, ctx.maxAngles.rightShoulder);
      return maxShoulder > BENCHPRESS_THRESHOLDS.elbowFlareShoulderMax;
    },
    severity: 2,
    dynamicCue: 'Tuck elbows slightly to protect your shoulders.',
    fqiPenalty: 10,
  },
];

// =============================================================================
// FQI Weights
// =============================================================================

const fqiWeights: FQIWeights = {
  rom: 0.35,
  depth: 0.35,
  faults: 0.30,
};

// =============================================================================
// Metrics Calculator
// =============================================================================

function calculateMetrics(
  angles: JointAngles,
  joints?: Map<string, { x: number; y: number; isTracked: boolean }>
): BenchPressMetrics {
  const avgElbow = (angles.leftElbow + angles.rightElbow) / 2;
  const avgShoulder = (angles.leftShoulder + angles.rightShoulder) / 2;

  const armsTracked =
    angles.leftElbow > 0 && angles.leftElbow < 180 &&
    angles.rightElbow > 0 && angles.rightElbow < 180;

  const wristsTracked = joints
    ? (joints.get('left_hand')?.isTracked ?? false) &&
      (joints.get('right_hand')?.isTracked ?? false)
    : false;

  return {
    avgElbow,
    avgShoulder,
    armsTracked,
    wristsTracked,
  };
}

// =============================================================================
// Phase State Machine
// =============================================================================

function getNextPhase(
  currentPhase: BenchPressPhase,
  _angles: JointAngles,
  metrics: BenchPressMetrics
): BenchPressPhase {
  if (!metrics.armsTracked || !metrics.wristsTracked) {
    return 'setup';
  }

  const elbow = metrics.avgElbow;

  switch (currentPhase) {
    case 'setup':
      if (elbow >= BENCHPRESS_THRESHOLDS.readyElbow) {
        return 'lockout';
      }
      return 'setup';

    case 'lockout':
      if (elbow <= BENCHPRESS_THRESHOLDS.loweringStart) {
        return 'lowering';
      }
      return 'lockout';

    case 'lowering':
      if (elbow <= BENCHPRESS_THRESHOLDS.bottom) {
        return 'bottom';
      }
      return 'lowering';

    case 'bottom':
      if (elbow >= BENCHPRESS_THRESHOLDS.press) {
        return 'press';
      }
      return 'bottom';

    case 'press':
      if (elbow >= BENCHPRESS_THRESHOLDS.finish) {
        return 'lockout';
      }
      return 'press';

    default:
      return 'setup';
  }
}

// =============================================================================
// Export Workout Definition
// =============================================================================

export const benchpressDefinition: WorkoutDefinition<BenchPressPhase, BenchPressMetrics> = {
  id: 'benchpress',
  displayName: 'Bench Press',
  description: 'Upper body pressing movement targeting chest, shoulders, and triceps.',
  category: 'upper_body',
  difficulty: 'intermediate',

  phases,
  initialPhase: 'setup',
  repBoundary,
  thresholds: BENCHPRESS_THRESHOLDS,
  angleRanges,
  scoringMetrics,
  faults,
  fqiWeights,

  calculateMetrics,
  getNextPhase,
};

export default benchpressDefinition;

