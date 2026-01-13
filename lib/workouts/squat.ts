/**
 * Squat Workout Definition
 *
 * Defines all the logic for tracking squat form:
 * - Phases: setup → standing → descent → bottom → ascent → standing
 * - Rep boundaries: starts at 'descent', ends at 'standing'
 * - Thresholds for knee and hip angles
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

export type SquatPhase = 'setup' | 'standing' | 'descent' | 'bottom' | 'ascent';

// =============================================================================
// Metrics Type
// =============================================================================

export interface SquatMetrics extends WorkoutMetrics {
  avgKnee: number;
  avgHip: number;
  legsTracked: boolean;
}

// =============================================================================
// Thresholds
// =============================================================================

export const SQUAT_THRESHOLDS = {
  /** Standing position (nearly straight legs) */
  standing: 160,
  /** Begin counting a descent */
  descentStart: 145,
  /** Parallel depth (hip crease at or below knee) */
  parallel: 95,
  /** Deep squat (below parallel) */
  deep: 80,
  /** On the way up, transitioning to ascent */
  ascent: 110,
  /** Completed rep (back to standing) */
  finish: 155,
  /** Maximum knee cave (valgus) angle difference */
  kneeValgusMax: 25,
} as const;

// =============================================================================
// Angle Ranges
// =============================================================================

const angleRanges: Record<string, AngleRange> = {
  knee: {
    min: 70,      // Deep squat
    max: 175,     // Standing
    optimal: 90,  // Parallel depth
    tolerance: 10,
  },
  hip: {
    min: 60,      // Deep hip flexion
    max: 180,     // Standing tall
    optimal: 85,  // Good depth
    tolerance: 15,
  },
};

const scoringMetrics: ScoringMetricDefinition[] = [
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
];

// =============================================================================
// Phase Definitions
// =============================================================================

const phases: PhaseDefinition<SquatPhase>[] = [
  {
    id: 'setup',
    displayName: 'Setup',
    enterCondition: () => true,
    staticCue: 'Feet shoulder-width apart, toes slightly out, brace your core.',
  },
  {
    id: 'standing',
    displayName: 'Standing',
    enterCondition: (angles: JointAngles) => {
      const avgKnee = (angles.leftKnee + angles.rightKnee) / 2;
      return avgKnee >= SQUAT_THRESHOLDS.standing;
    },
    staticCue: 'Take a breath and brace before descending.',
  },
  {
    id: 'descent',
    displayName: 'Descending',
    enterCondition: (angles: JointAngles, prevPhase: SquatPhase) => {
      const avgKnee = (angles.leftKnee + angles.rightKnee) / 2;
      return prevPhase === 'standing' && avgKnee <= SQUAT_THRESHOLDS.descentStart;
    },
    staticCue: 'Sit back and down, knees tracking over toes.',
  },
  {
    id: 'bottom',
    displayName: 'Bottom Position',
    enterCondition: (angles: JointAngles, prevPhase: SquatPhase) => {
      const avgKnee = (angles.leftKnee + angles.rightKnee) / 2;
      return prevPhase === 'descent' && avgKnee <= SQUAT_THRESHOLDS.parallel;
    },
    staticCue: 'Drive through your heels and stand tall.',
  },
  {
    id: 'ascent',
    displayName: 'Ascending',
    enterCondition: (angles: JointAngles, prevPhase: SquatPhase) => {
      const avgKnee = (angles.leftKnee + angles.rightKnee) / 2;
      return prevPhase === 'bottom' && avgKnee >= SQUAT_THRESHOLDS.ascent;
    },
    staticCue: 'Keep your chest up and finish strong.',
  },
];

// =============================================================================
// Rep Boundary
// =============================================================================

const repBoundary: RepBoundary<SquatPhase> = {
  startPhase: 'descent',
  endPhase: 'standing',
  minDurationMs: 600,
};

// =============================================================================
// Fault Definitions
// =============================================================================

const faults: FaultDefinition[] = [
  {
    id: 'shallow_depth',
    displayName: 'Shallow Depth',
    condition: (ctx: RepContext) => {
      const minKnee = (ctx.minAngles.leftKnee + ctx.minAngles.rightKnee) / 2;
      return minKnee > SQUAT_THRESHOLDS.parallel + 15;
    },
    severity: 2,
    dynamicCue: 'Squat deeper — aim for hip crease below knees.',
    fqiPenalty: 15,
  },
  {
    id: 'incomplete_lockout',
    displayName: 'Incomplete Lockout',
    condition: (ctx: RepContext) => {
      const endKnee = (ctx.endAngles.leftKnee + ctx.endAngles.rightKnee) / 2;
      return endKnee < SQUAT_THRESHOLDS.standing - 10;
    },
    severity: 1,
    dynamicCue: 'Stand all the way up between reps.',
    fqiPenalty: 8,
  },
  {
    id: 'knee_valgus',
    displayName: 'Knee Valgus (Cave-in)',
    condition: (ctx: RepContext) => {
      // Check if knees are significantly different (one caving in)
      const kneeDiff = Math.abs(ctx.minAngles.leftKnee - ctx.minAngles.rightKnee);
      return kneeDiff > SQUAT_THRESHOLDS.kneeValgusMax;
    },
    severity: 2,
    dynamicCue: 'Push your knees out over your toes.',
    fqiPenalty: 12,
  },
  {
    id: 'fast_rep',
    displayName: 'Rushed Repetition',
    condition: (ctx: RepContext) => ctx.durationMs < 1000,
    severity: 1,
    dynamicCue: 'Control the descent — don\'t dive bomb.',
    fqiPenalty: 5,
  },
  {
    id: 'hip_shift',
    displayName: 'Hip Shift',
    condition: (ctx: RepContext) => {
      // Check for asymmetric hip angles (one side dropping)
      const hipDiff = Math.abs(ctx.minAngles.leftHip - ctx.minAngles.rightHip);
      return hipDiff > 20;
    },
    severity: 2,
    dynamicCue: 'Keep your hips level — don\'t shift to one side.',
    fqiPenalty: 10,
  },
  {
    id: 'forward_lean',
    displayName: 'Excessive Forward Lean',
    condition: (ctx: RepContext) => {
      // If hips go much lower angle than knees, indicates forward lean
      const avgHip = (ctx.minAngles.leftHip + ctx.minAngles.rightHip) / 2;
      const avgKnee = (ctx.minAngles.leftKnee + ctx.minAngles.rightKnee) / 2;
      return avgHip < avgKnee - 25;
    },
    severity: 1,
    dynamicCue: 'Keep your chest up — don\'t fold forward.',
    fqiPenalty: 8,
  },
];

// =============================================================================
// FQI Weights
// =============================================================================

const fqiWeights: FQIWeights = {
  rom: 0.30,    // Range of motion contributes 30%
  depth: 0.40,  // Depth is critical for squats - 40%
  faults: 0.30, // Fault deductions contribute 30%
};

// =============================================================================
// Metrics Calculator
// =============================================================================

function calculateMetrics(
  angles: JointAngles,
  _joints?: Map<string, { x: number; y: number; isTracked: boolean }>
): SquatMetrics {
  const avgKnee = (angles.leftKnee + angles.rightKnee) / 2;
  const avgHip = (angles.leftHip + angles.rightHip) / 2;

  const legsTracked =
    angles.leftKnee > 0 && angles.leftKnee < 180 &&
    angles.rightKnee > 0 && angles.rightKnee < 180 &&
    angles.leftHip > 0 && angles.leftHip < 180 &&
    angles.rightHip > 0 && angles.rightHip < 180;

  return {
    avgKnee,
    avgHip,
    legsTracked,
  };
}

// =============================================================================
// Phase State Machine
// =============================================================================

function getNextPhase(
  currentPhase: SquatPhase,
  _angles: JointAngles,
  metrics: SquatMetrics
): SquatPhase {
  if (!metrics.legsTracked) {
    return 'setup';
  }

  const knee = metrics.avgKnee;

  switch (currentPhase) {
    case 'setup':
      if (knee >= SQUAT_THRESHOLDS.standing) {
        return 'standing';
      }
      return 'setup';

    case 'standing':
      if (knee <= SQUAT_THRESHOLDS.descentStart) {
        return 'descent';
      }
      return 'standing';

    case 'descent':
      if (knee <= SQUAT_THRESHOLDS.parallel) {
        return 'bottom';
      }
      return 'descent';

    case 'bottom':
      if (knee >= SQUAT_THRESHOLDS.ascent) {
        return 'ascent';
      }
      return 'bottom';

    case 'ascent':
      if (knee >= SQUAT_THRESHOLDS.finish) {
        return 'standing';
      }
      return 'ascent';

    default:
      return 'setup';
  }
}

// =============================================================================
// Export Workout Definition
// =============================================================================

export const squatDefinition: WorkoutDefinition<SquatPhase, SquatMetrics> = {
  id: 'squat',
  displayName: 'Squat',
  description: 'Lower body compound movement targeting quads, glutes, and core.',
  category: 'lower_body',
  difficulty: 'beginner',

  phases,
  initialPhase: 'setup',
  repBoundary,
  thresholds: SQUAT_THRESHOLDS,
  angleRanges,
  scoringMetrics,
  faults,
  fqiWeights,

  ui: {
    iconName: 'fitness-outline',
    primaryMetric: { key: 'avgKneeDeg', label: 'Avg Knee', format: 'deg' },
    secondaryMetric: { key: 'avgHipDeg', label: 'Avg Hip', format: 'deg' },
    buildUploadMetrics: (metrics) => ({
      avgKneeDeg: metrics?.avgKnee ?? null,
      avgHipDeg: metrics?.avgHip ?? null,
    }),
    buildWatchMetrics: (metrics) => ({
      avgKneeDeg: metrics?.avgKnee ?? null,
      avgHipDeg: metrics?.avgHip ?? null,
    }),
    getRealtimeCues: ({ phaseId, metrics }) => {
      const messages: string[] = [];
      const standingThreshold = SQUAT_THRESHOLDS.standing;
      const parallelThreshold = SQUAT_THRESHOLDS.parallel;

      const avgKnee = metrics.avgKnee;

      if (phaseId === 'standing' && typeof avgKnee === 'number' && avgKnee < standingThreshold - 10) {
        messages.push('Stand all the way up between reps.');
      }

      if (phaseId === 'bottom' && typeof avgKnee === 'number' && avgKnee > parallelThreshold + 15) {
        messages.push('Squat deeper — aim for hip crease below knees.');
      }

      if (messages.length === 0) {
        messages.push('Controlled tempo — own every inch of the movement.');
      }

      return messages;
    },
  },

  calculateMetrics,
  getNextPhase,
};

export default squatDefinition;
