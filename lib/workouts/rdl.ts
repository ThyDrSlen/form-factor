/**
 * Romanian Deadlift (RDL) Workout Definition
 *
 * Defines all the logic for tracking RDL form:
 * - Phases: setup → standing → hinge → bottom → rise → standing
 * - Rep boundaries: starts at 'hinge', ends at 'standing'
 * - Thresholds for hip angle with relatively straight knees
 * - Fault detection conditions
 * - FQI calculation weights
 *
 * Key difference from conventional deadlift: knees stay relatively fixed,
 * movement is primarily a hip hinge with emphasis on hamstring stretch.
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

export type RDLPhase = 'setup' | 'standing' | 'hinge' | 'bottom' | 'rise';

// =============================================================================
// Metrics Type
// =============================================================================

export interface RDLMetrics extends WorkoutMetrics {
  avgHip: number;
  avgKnee: number;
  legsTracked: boolean;
}

// =============================================================================
// Thresholds
// =============================================================================

export const RDL_THRESHOLDS = {
  /** Fully standing (lockout position) */
  standing: 165,
  /** Starting the hip hinge */
  hingeStart: 145,
  /** Bottom position (hamstring stretch) */
  bottom: 90,
  /** Rising back up */
  riseStart: 110,
  /** Knee should stay relatively straight (soft bend only) */
  kneeSoftBend: 155,
  /** Minimum knee angle (too much bend = not an RDL) */
  kneeMinBend: 130,
} as const;

// =============================================================================
// Angle Ranges
// =============================================================================

const angleRanges: Record<string, AngleRange> = {
  hip: {
    min: 80,      // Deep hip hinge
    max: 180,     // Full lockout
    optimal: 90,  // Good hamstring stretch
    tolerance: 15,
  },
  knee: {
    min: 130,     // Soft bend (not a squat)
    max: 180,     // Straight
    optimal: 160, // Slight bend
    tolerance: 15,
  },
};

const scoringMetrics: ScoringMetricDefinition[] = [
  {
    id: 'hip',
    extract: (rep, side) => {
      if (side === 'left') {
        return {
          start: rep.start.leftHip,
          end: rep.end.leftHip,
          min: rep.min.leftHip,
          max: rep.max.leftHip,
        };
      }
      return {
        start: rep.start.rightHip,
        end: rep.end.rightHip,
        min: rep.min.rightHip,
        max: rep.max.rightHip,
      };
    },
  },
  {
    id: 'knee',
    extract: (rep, side) => {
      if (side === 'left') {
        return {
          start: rep.start.leftKnee,
          end: rep.end.leftKnee,
          min: rep.min.leftKnee,
          max: rep.max.leftKnee,
        };
      }
      return {
        start: rep.start.rightKnee,
        end: rep.end.rightKnee,
        min: rep.min.rightKnee,
        max: rep.max.rightKnee,
      };
    },
  },
];

// =============================================================================
// Phase Definitions
// =============================================================================

const phases: PhaseDefinition<RDLPhase>[] = [
  {
    id: 'setup',
    displayName: 'Setup',
    enterCondition: () => true,
    staticCue: 'Feet hip-width, soft knee bend, shoulders back.',
  },
  {
    id: 'standing',
    displayName: 'Standing',
    enterCondition: (angles: JointAngles) => {
      const avgHip = (angles.leftHip + angles.rightHip) / 2;
      return avgHip >= RDL_THRESHOLDS.standing;
    },
    staticCue: 'Squeeze glutes at the top, then hinge at the hips.',
  },
  {
    id: 'hinge',
    displayName: 'Hinging',
    enterCondition: (angles: JointAngles, prevPhase: RDLPhase) => {
      const avgHip = (angles.leftHip + angles.rightHip) / 2;
      return prevPhase === 'standing' && avgHip <= RDL_THRESHOLDS.hingeStart;
    },
    staticCue: 'Push hips back, keep the bar close to your legs.',
  },
  {
    id: 'bottom',
    displayName: 'Bottom Stretch',
    enterCondition: (angles: JointAngles, prevPhase: RDLPhase) => {
      const avgHip = (angles.leftHip + angles.rightHip) / 2;
      return prevPhase === 'hinge' && avgHip <= RDL_THRESHOLDS.bottom;
    },
    staticCue: 'Feel the hamstring stretch, then drive hips forward.',
  },
  {
    id: 'rise',
    displayName: 'Rising',
    enterCondition: (angles: JointAngles, prevPhase: RDLPhase) => {
      const avgHip = (angles.leftHip + angles.rightHip) / 2;
      return prevPhase === 'bottom' && avgHip >= RDL_THRESHOLDS.riseStart;
    },
    staticCue: 'Drive hips forward, squeeze glutes to stand.',
  },
];

// =============================================================================
// Rep Boundary
// =============================================================================

const repBoundary: RepBoundary<RDLPhase> = {
  startPhase: 'hinge',
  endPhase: 'standing',
  minDurationMs: 800,
};

// =============================================================================
// Fault Definitions
// =============================================================================

const faults: FaultDefinition[] = [
  {
    id: 'knee_bend_excessive',
    displayName: 'Excessive Knee Bend',
    condition: (ctx: RepContext) => {
      const minKnee = (ctx.minAngles.leftKnee + ctx.minAngles.rightKnee) / 2;
      return minKnee < RDL_THRESHOLDS.kneeMinBend;
    },
    severity: 2,
    dynamicCue: 'Keep knees soft but fixed — this isn\'t a squat.',
    fqiPenalty: 15,
  },
  {
    id: 'shallow_hinge',
    displayName: 'Shallow Hip Hinge',
    condition: (ctx: RepContext) => {
      const minHip = (ctx.minAngles.leftHip + ctx.minAngles.rightHip) / 2;
      return minHip > RDL_THRESHOLDS.bottom + 20;
    },
    severity: 2,
    dynamicCue: 'Hinge deeper — feel the hamstring stretch.',
    fqiPenalty: 12,
  },
  {
    id: 'incomplete_lockout',
    displayName: 'Incomplete Lockout',
    condition: (ctx: RepContext) => {
      const maxHip = (ctx.maxAngles.leftHip + ctx.maxAngles.rightHip) / 2;
      return maxHip < RDL_THRESHOLDS.standing - 10;
    },
    severity: 1,
    dynamicCue: 'Stand all the way up and squeeze at the top.',
    fqiPenalty: 8,
  },
  {
    id: 'rounded_back',
    displayName: 'Rounded Back',
    condition: (ctx: RepContext) => {
      // Check shoulder angle as proxy for back position
      const maxShoulder = Math.max(ctx.maxAngles.leftShoulder, ctx.maxAngles.rightShoulder);
      return maxShoulder > 130;
    },
    severity: 3,
    dynamicCue: 'Keep your back flat — chest proud.',
    fqiPenalty: 18,
  },
  {
    id: 'asymmetric_hinge',
    displayName: 'Asymmetric Hinge',
    condition: (ctx: RepContext) => {
      const hipDiff = Math.abs(ctx.minAngles.leftHip - ctx.minAngles.rightHip);
      return hipDiff > 20;
    },
    severity: 1,
    dynamicCue: 'Keep your hips level — don\'t favor one side.',
    fqiPenalty: 8,
  },
  {
    id: 'fast_rep',
    displayName: 'Rushed Repetition',
    condition: (ctx: RepContext) => ctx.durationMs < 1500,
    severity: 1,
    dynamicCue: 'Slow down — control the eccentric.',
    fqiPenalty: 5,
  },
];

// =============================================================================
// FQI Weights
// =============================================================================

const fqiWeights: FQIWeights = {
  rom: 0.30,    // Range of motion contributes 30%
  depth: 0.30,  // Depth/hamstring stretch contributes 30%
  faults: 0.40, // Faults important for RDL form - 40%
};

// =============================================================================
// Metrics Calculator
// =============================================================================

function calculateMetrics(
  angles: JointAngles,
  _joints?: Map<string, { x: number; y: number; isTracked: boolean }>
): RDLMetrics {
  const avgHip = (angles.leftHip + angles.rightHip) / 2;
  const avgKnee = (angles.leftKnee + angles.rightKnee) / 2;

  const legsTracked =
    angles.leftHip > 0 && angles.leftHip < 180 &&
    angles.rightHip > 0 && angles.rightHip < 180 &&
    angles.leftKnee > 0 && angles.leftKnee < 180 &&
    angles.rightKnee > 0 && angles.rightKnee < 180;

  return {
    avgHip,
    avgKnee,
    legsTracked,
  };
}

// =============================================================================
// Phase State Machine
// =============================================================================

function getNextPhase(
  currentPhase: RDLPhase,
  _angles: JointAngles,
  metrics: RDLMetrics
): RDLPhase {
  if (!metrics.legsTracked) {
    return 'setup';
  }

  const hip = metrics.avgHip;

  switch (currentPhase) {
    case 'setup':
      if (hip >= RDL_THRESHOLDS.standing) {
        return 'standing';
      }
      return 'setup';

    case 'standing':
      if (hip <= RDL_THRESHOLDS.hingeStart) {
        return 'hinge';
      }
      return 'standing';

    case 'hinge':
      if (hip <= RDL_THRESHOLDS.bottom) {
        return 'bottom';
      }
      if (hip >= RDL_THRESHOLDS.standing) {
        return 'standing';
      }
      return 'hinge';

    case 'bottom':
      if (hip >= RDL_THRESHOLDS.riseStart) {
        return 'rise';
      }
      return 'bottom';

    case 'rise':
      if (hip >= RDL_THRESHOLDS.standing) {
        return 'standing';
      }
      if (hip <= RDL_THRESHOLDS.bottom) {
        return 'bottom';
      }
      return 'rise';

    default:
      return 'setup';
  }
}

// =============================================================================
// Export Workout Definition
// =============================================================================

export const rdlDefinition: WorkoutDefinition<RDLPhase, RDLMetrics> = {
  id: 'rdl',
  displayName: 'Romanian Deadlift',
  description: 'Hip hinge movement targeting hamstrings, glutes, and lower back.',
  category: 'lower_body',
  difficulty: 'intermediate',

  phases,
  initialPhase: 'setup',
  repBoundary,
  thresholds: RDL_THRESHOLDS,
  angleRanges,
  scoringMetrics,
  faults,
  fqiWeights,

  ui: {
    iconName: 'trending-down-outline',
    primaryMetric: { key: 'avgHipDeg', label: 'Avg Hip', format: 'deg' },
    secondaryMetric: { key: 'avgKneeDeg', label: 'Avg Knee', format: 'deg' },
    buildUploadMetrics: (metrics) => ({
      avgHipDeg: metrics?.avgHip ?? null,
      avgKneeDeg: metrics?.avgKnee ?? null,
    }),
    buildWatchMetrics: (metrics) => ({
      avgHipDeg: metrics?.avgHip ?? null,
      avgKneeDeg: metrics?.avgKnee ?? null,
    }),
    getRealtimeCues: ({ phaseId, metrics }) => {
      const messages: string[] = [];
      const bottomThreshold = RDL_THRESHOLDS.bottom;
      const kneeMinBend = RDL_THRESHOLDS.kneeMinBend;

      const avgHip = metrics.avgHip;
      const avgKnee = metrics.avgKnee;

      if (typeof avgKnee === 'number' && avgKnee < kneeMinBend) {
        messages.push('Keep knees soft but fixed — this isn\'t a squat.');
      }

      if (phaseId === 'bottom' && typeof avgHip === 'number' && avgHip > bottomThreshold + 15) {
        messages.push('Hinge deeper — feel the hamstring stretch.');
      }

      if (messages.length === 0) {
        messages.push('Smooth hinge — push hips back, chest proud.');
      }

      return messages;
    },
  },

  calculateMetrics,
  getNextPhase,
};

export default rdlDefinition;
