/**
 * Bulgarian Split Squat Workout Definition
 *
 * Defines all the logic for tracking Bulgarian split squat form:
 * - Phases: setup → standing → descent → bottom → ascent
 * - Rep boundaries: starts at 'descent', ends at 'standing'
 * - Thresholds for front-knee / front-hip angles
 * - Fault detection conditions (4 faults)
 * - FQI calculation weights
 *
 * Unilateral — rear foot elevated on bench. The "front" leg is
 * approximated by the deeper-bending knee during the rep, matching
 * the convention established by the lunge form model in #441.
 *
 * Proxies used (documented here because JointAngles is sparse):
 * - `heel_collapse` — no foot/ankle sensor; we use an extreme front-knee
 *   angle (past the frontKneeForwardLimit) as proxy. A collapsing arch
 *   lets the knee shoot past the toes, producing a very acute knee angle.
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
import { asymmetryCheck } from './helpers';

// =============================================================================
// Phase Type
// =============================================================================

export type BulgarianSplitSquatPhase = 'setup' | 'standing' | 'descent' | 'bottom' | 'ascent';

// =============================================================================
// Metrics Type
// =============================================================================

export interface BulgarianSplitSquatMetrics extends WorkoutMetrics {
  /** Deeper of the two knee angles this frame — the "front" (working) leg */
  frontKnee: number;
  /** Shallower of the two knee angles — the "rear" (elevated) leg */
  rearKnee: number;
  /** Average hip angle for trunk/lean sanity checks */
  avgHip: number;
  legsTracked: boolean;
}

// =============================================================================
// Thresholds
// =============================================================================

export const BULGARIAN_SPLIT_SQUAT_THRESHOLDS = {
  /** Upright standing — both knees near extended */
  standing: 160,
  /** Begin a descent — front knee starts to flex */
  descentStart: 145,
  /** Front-knee target bottom (90° ± tolerance) */
  parallel: 95,
  /** Depth floor — above this at bottom is "shallow" */
  depthFloor: 115,
  /** Deepest acceptable front-knee flexion (below this = forward knee / shin over toes) */
  frontKneeForwardLimit: 65,
  /** Front-knee threshold to leave the bottom (transitioning to ascent) */
  ascent: 110,
  /** Completed rep (near standing again) */
  finish: 155,
  /** Max drive-symmetry percentage — compares frontKnee depth rep-over-rep via left/right */
  asymmetricDriveMaxPct: 15,
} as const;

// =============================================================================
// Angle Ranges
// =============================================================================

const angleRanges: Record<string, AngleRange> = {
  frontKnee: {
    min: 80,
    max: 110,
    optimal: 95,
    tolerance: 15,
  },
  rearKnee: {
    min: 90,
    max: 140,
    optimal: 120,
    tolerance: 20,
  },
  hip: {
    min: 80,
    max: 180,
    optimal: 120,
    tolerance: 20,
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

const phases: PhaseDefinition<BulgarianSplitSquatPhase>[] = [
  {
    id: 'setup',
    displayName: 'Setup',
    enterCondition: () => true,
    staticCue: 'Rear foot on the bench, front foot far enough forward for 90° at the bottom.',
  },
  {
    id: 'standing',
    displayName: 'Standing',
    enterCondition: (angles: JointAngles) => {
      const minKnee = Math.min(angles.leftKnee, angles.rightKnee);
      return minKnee >= BULGARIAN_SPLIT_SQUAT_THRESHOLDS.standing;
    },
    staticCue: 'Tall chest — brace, then lower with control.',
  },
  {
    id: 'descent',
    displayName: 'Descending',
    enterCondition: (angles: JointAngles, prevPhase: BulgarianSplitSquatPhase) => {
      const minKnee = Math.min(angles.leftKnee, angles.rightKnee);
      return prevPhase === 'standing' && minKnee <= BULGARIAN_SPLIT_SQUAT_THRESHOLDS.descentStart;
    },
    staticCue: 'Drop straight down — front shin stays nearly vertical.',
  },
  {
    id: 'bottom',
    displayName: 'Bottom',
    enterCondition: (angles: JointAngles, prevPhase: BulgarianSplitSquatPhase) => {
      const minKnee = Math.min(angles.leftKnee, angles.rightKnee);
      return prevPhase === 'descent' && minKnee <= BULGARIAN_SPLIT_SQUAT_THRESHOLDS.parallel;
    },
    staticCue: 'Front thigh parallel — drive back up through the heel.',
  },
  {
    id: 'ascent',
    displayName: 'Ascending',
    enterCondition: (angles: JointAngles, prevPhase: BulgarianSplitSquatPhase) => {
      const minKnee = Math.min(angles.leftKnee, angles.rightKnee);
      return prevPhase === 'bottom' && minKnee >= BULGARIAN_SPLIT_SQUAT_THRESHOLDS.ascent;
    },
    staticCue: 'Push through the front heel — stand tall.',
  },
];

// =============================================================================
// Rep Boundary
// =============================================================================

const repBoundary: RepBoundary<BulgarianSplitSquatPhase> = {
  startPhase: 'descent',
  endPhase: 'standing',
  minDurationMs: 800,
};

// =============================================================================
// Fault Definitions (4 faults per spec)
// =============================================================================

const faults: FaultDefinition[] = [
  {
    id: 'shallow_depth',
    displayName: 'Shallow Depth',
    condition: (ctx: RepContext) => {
      const minFront = Math.min(ctx.minAngles.leftKnee, ctx.minAngles.rightKnee);
      if (!Number.isFinite(minFront)) return false;
      return minFront > BULGARIAN_SPLIT_SQUAT_THRESHOLDS.depthFloor;
    },
    severity: 2,
    dynamicCue: 'Drop deeper — aim for front thigh parallel to the floor.',
    fqiPenalty: 15,
  },
  {
    id: 'forward_knee',
    displayName: 'Knee Over Toes',
    condition: (ctx: RepContext) => {
      const minFront = Math.min(ctx.minAngles.leftKnee, ctx.minAngles.rightKnee);
      if (!Number.isFinite(minFront)) return false;
      return minFront < BULGARIAN_SPLIT_SQUAT_THRESHOLDS.frontKneeForwardLimit;
    },
    severity: 1,
    dynamicCue: 'Shift weight back — keep the front shin closer to vertical.',
    fqiPenalty: 8,
  },
  {
    id: 'asymmetric_drive',
    displayName: 'Asymmetric Drive',
    condition: (ctx: RepContext) => {
      // Compare the hip angle drop on the working side vs rear side. A
      // large asymmetric drop suggests the lifter is shifting into the
      // rear (elevated) leg instead of loading the front.
      return asymmetryCheck(
        ctx.minAngles.leftHip,
        ctx.minAngles.rightHip,
        BULGARIAN_SPLIT_SQUAT_THRESHOLDS.asymmetricDriveMaxPct
      );
    },
    severity: 2,
    dynamicCue: 'Sit into the front leg — avoid shifting back onto the rear foot.',
    fqiPenalty: 10,
  },
  {
    id: 'heel_collapse',
    displayName: 'Heel Collapse',
    condition: (ctx: RepContext) => {
      // Proxy: an extremely acute front-knee angle indicates the knee has
      // tracked far past the toes, typically with the arch / heel collapsing.
      const minFront = Math.min(ctx.minAngles.leftKnee, ctx.minAngles.rightKnee);
      if (!Number.isFinite(minFront)) return false;
      return minFront < BULGARIAN_SPLIT_SQUAT_THRESHOLDS.frontKneeForwardLimit - 10;
    },
    severity: 2,
    dynamicCue: 'Keep the heel planted and weight through the mid-foot.',
    fqiPenalty: 10,
  },
];

// =============================================================================
// FQI Weights
// =============================================================================

const fqiWeights: FQIWeights = {
  rom: 0.25,
  depth: 0.45,
  faults: 0.30,
};

// =============================================================================
// Metrics Calculator
// =============================================================================

function calculateMetrics(
  angles: JointAngles,
  _joints?: Map<string, { x: number; y: number; isTracked: boolean }>
): BulgarianSplitSquatMetrics {
  const frontKnee = Math.min(angles.leftKnee, angles.rightKnee);
  const rearKnee = Math.max(angles.leftKnee, angles.rightKnee);
  const avgHip = (angles.leftHip + angles.rightHip) / 2;

  const legsTracked =
    angles.leftKnee > 0 && angles.leftKnee < 180 &&
    angles.rightKnee > 0 && angles.rightKnee < 180 &&
    angles.leftHip > 0 && angles.leftHip < 180 &&
    angles.rightHip > 0 && angles.rightHip < 180;

  return {
    frontKnee,
    rearKnee,
    avgHip,
    armsTracked: false,
    legsTracked,
  };
}

// =============================================================================
// Phase State Machine
// =============================================================================

function getNextPhase(
  currentPhase: BulgarianSplitSquatPhase,
  _angles: JointAngles,
  metrics: BulgarianSplitSquatMetrics
): BulgarianSplitSquatPhase {
  if (!metrics.legsTracked) {
    return 'setup';
  }

  const knee = metrics.frontKnee;

  switch (currentPhase) {
    case 'setup':
      if (knee >= BULGARIAN_SPLIT_SQUAT_THRESHOLDS.standing) {
        return 'standing';
      }
      return 'setup';

    case 'standing':
      if (knee <= BULGARIAN_SPLIT_SQUAT_THRESHOLDS.descentStart) {
        return 'descent';
      }
      return 'standing';

    case 'descent':
      if (knee <= BULGARIAN_SPLIT_SQUAT_THRESHOLDS.parallel) {
        return 'bottom';
      }
      return 'descent';

    case 'bottom':
      if (knee >= BULGARIAN_SPLIT_SQUAT_THRESHOLDS.ascent) {
        return 'ascent';
      }
      return 'bottom';

    case 'ascent':
      if (knee >= BULGARIAN_SPLIT_SQUAT_THRESHOLDS.finish) {
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

export const bulgarianSplitSquatDefinition: WorkoutDefinition<
  BulgarianSplitSquatPhase,
  BulgarianSplitSquatMetrics
> = {
  id: 'bulgarian_split_squat',
  displayName: 'Bulgarian Split Squat',
  description: 'Unilateral lower body movement with rear foot elevated; targets quads and glutes.',
  category: 'lower_body',
  difficulty: 'intermediate',

  phases,
  initialPhase: 'setup',
  repBoundary,
  thresholds: BULGARIAN_SPLIT_SQUAT_THRESHOLDS,
  angleRanges,
  scoringMetrics,
  faults,
  fqiWeights,

  ui: {
    iconName: 'footsteps-outline',
    primaryMetric: { key: 'frontKneeDeg', label: 'Front Knee', format: 'deg' },
    secondaryMetric: { key: 'rearKneeDeg', label: 'Rear Knee', format: 'deg' },
    buildUploadMetrics: (metrics) => ({
      frontKneeDeg: metrics?.frontKnee ?? null,
      rearKneeDeg: metrics?.rearKnee ?? null,
      avgHipDeg: metrics?.avgHip ?? null,
    }),
    buildWatchMetrics: (metrics) => ({
      frontKneeDeg: metrics?.frontKnee ?? null,
      rearKneeDeg: metrics?.rearKnee ?? null,
    }),
    getRealtimeCues: ({ phaseId, metrics }) => {
      const messages: string[] = [];

      if (
        phaseId === 'bottom' &&
        typeof metrics.frontKnee === 'number' &&
        metrics.frontKnee > BULGARIAN_SPLIT_SQUAT_THRESHOLDS.depthFloor
      ) {
        messages.push('Drop deeper — front thigh parallel to the floor.');
      }

      if (
        phaseId === 'bottom' &&
        typeof metrics.frontKnee === 'number' &&
        metrics.frontKnee < BULGARIAN_SPLIT_SQUAT_THRESHOLDS.frontKneeForwardLimit
      ) {
        messages.push('Shift weight back — keep the front shin vertical.');
      }

      if (phaseId === 'standing') {
        messages.push('Reset your stance, breathe, then repeat.');
      }

      if (messages.length === 0) {
        messages.push('Sit into the front leg — stay tall through the hips.');
      }

      return messages;
    },
  },

  calculateMetrics,
  getNextPhase,
};

export default bulgarianSplitSquatDefinition;
