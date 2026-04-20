/**
 * Lunge Workout Definition
 *
 * Defines all the logic for tracking lunge form:
 * - Phases: setup → descent → bottom → ascent → standing
 * - Rep boundaries: starts at 'descent', ends at 'standing'
 * - Thresholds for front-knee / rear-knee / front-hip angles
 * - Fault detection conditions (6 faults)
 * - FQI calculation weights
 *
 * The lunge tracker models a single working rep as:
 *   standing → descent → bottom → ascent → standing
 * where the "front" leg is approximated by the deeper-bending knee during
 * the rep (the tracker does not assume handedness/laterality up-front).
 *
 * Angle-range targets derive from `movementProfile.lunge` in
 * `lib/fusion/movements.ts` (frontKneeFlexionDeg: 80–110,
 * rearKneeFlexionDeg: 75–115). Additional thresholds used below that
 * are NOT present in `movements.ts` (knee-over-toe cue, hyperextension
 * lockout, asymmetric-depth max diff) are kept local here per the
 * project constraint that we do not modify `movements.ts` from this PR.
 */

import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import { getMovementProfile } from '@/lib/fusion/movements';
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

export type LungePhase = 'setup' | 'descent' | 'bottom' | 'ascent' | 'standing';

// =============================================================================
// Metrics Type
// =============================================================================

export interface LungeMetrics extends WorkoutMetrics {
  /** Deeper of the two knee angles this frame (the "front" knee proxy) */
  frontKnee: number;
  /** Shallower of the two knee angles this frame (the "rear" knee proxy) */
  rearKnee: number;
  /** Average hip angle (for trunk/forward-lean sanity checks) */
  avgHip: number;
  legsTracked: boolean;
}

// =============================================================================
// Thresholds
// =============================================================================

const lungeProfile = getMovementProfile('lunge');
const FRONT_KNEE_PROFILE = lungeProfile.thresholds.find((t) => t.metric === 'frontKneeFlexionDeg');
const REAR_KNEE_PROFILE = lungeProfile.thresholds.find((t) => t.metric === 'rearKneeFlexionDeg');

export const LUNGE_THRESHOLDS = {
  /** Upright standing (both legs near-extended) */
  standing: 160,
  /** Begin a descent — front knee starts to flex */
  descentStart: 145,
  /** Front-knee target bottom (derived from movement profile: 80–110°, midpoint-ish) */
  parallel: FRONT_KNEE_PROFILE?.min ?? 80,
  /** Deepest acceptable front-knee flexion (below this = excessive / "forward knee") */
  frontKneeForwardLimit: 70,
  /** Rear-knee target bottom (derived from movement profile: 75–115°) */
  rearParallel: REAR_KNEE_PROFILE?.min ?? 75,
  /** Front-knee threshold to leave the bottom (transitioning to ascent) */
  ascent: 115,
  /** Completed rep (near standing) */
  finish: 155,
  /** Max %-asymmetry between front/rear knee flexion (front deeper is fine;
   *  large symmetric-depth imbalance at bottom indicates poor split squat) */
  asymmetricDepthMaxPct: 40,
  /**
   * Max knee-cave angle diff between left/right at the bottom — fallback not
   * present in `movements.ts`; calibrated to match squat's valgus threshold.
   */
  kneeCaveMax: 25,
  /**
   * Hip-angle diff at bottom used as proxy for "heel off the ground" on the
   * rear side: a rear heel that lifts substantially drops the rear-hip angle
   * away from the front-hip angle. Fallback heuristic — no direct foot sensor.
   */
  heelOffHipDiffMax: 30,
  /** Max elbow/knee extension delta indicating hyperextension lockout */
  hyperExtensionMax: 182,
} as const;

// =============================================================================
// Angle Ranges
// =============================================================================

const angleRanges: Record<string, AngleRange> = {
  frontKnee: {
    min: FRONT_KNEE_PROFILE?.min ?? 80,
    max: FRONT_KNEE_PROFILE?.max ?? 110,
    optimal: 90,
    tolerance: 15,
  },
  rearKnee: {
    min: REAR_KNEE_PROFILE?.min ?? 75,
    max: REAR_KNEE_PROFILE?.max ?? 115,
    optimal: 95,
    tolerance: 20,
  },
  hip: {
    min: 70,
    max: 180,
    optimal: 110,
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

const phases: PhaseDefinition<LungePhase>[] = [
  {
    id: 'setup',
    displayName: 'Setup',
    enterCondition: () => true,
    staticCue: 'Split stance — front foot flat, rear heel lifted, chest tall.',
  },
  {
    id: 'standing',
    displayName: 'Standing',
    enterCondition: (angles: JointAngles) => {
      const minKnee = Math.min(angles.leftKnee, angles.rightKnee);
      return minKnee >= LUNGE_THRESHOLDS.standing;
    },
    staticCue: 'Breath in, brace, then step down with control.',
  },
  {
    id: 'descent',
    displayName: 'Descending',
    enterCondition: (angles: JointAngles, prevPhase: LungePhase) => {
      const minKnee = Math.min(angles.leftKnee, angles.rightKnee);
      return prevPhase === 'standing' && minKnee <= LUNGE_THRESHOLDS.descentStart;
    },
    staticCue: 'Drop straight down — rear knee tracks toward the floor.',
  },
  {
    id: 'bottom',
    displayName: 'Bottom Position',
    enterCondition: (angles: JointAngles, prevPhase: LungePhase) => {
      const minKnee = Math.min(angles.leftKnee, angles.rightKnee);
      return prevPhase === 'descent' && minKnee <= LUNGE_THRESHOLDS.parallel;
    },
    staticCue: 'Both knees around 90° — chest proud, drive back up.',
  },
  {
    id: 'ascent',
    displayName: 'Ascending',
    enterCondition: (angles: JointAngles, prevPhase: LungePhase) => {
      const minKnee = Math.min(angles.leftKnee, angles.rightKnee);
      return prevPhase === 'bottom' && minKnee >= LUNGE_THRESHOLDS.ascent;
    },
    staticCue: 'Push through the front heel — stand tall.',
  },
];

// =============================================================================
// Rep Boundary
// =============================================================================

const repBoundary: RepBoundary<LungePhase> = {
  startPhase: 'descent',
  endPhase: 'standing',
  minDurationMs: 700,
};

// =============================================================================
// Fault Definitions (6 faults per spec)
// =============================================================================

const faults: FaultDefinition[] = [
  {
    id: 'shallow_depth',
    displayName: 'Shallow Depth',
    condition: (ctx: RepContext) => {
      const minFront = Math.min(ctx.minAngles.leftKnee, ctx.minAngles.rightKnee);
      if (!Number.isFinite(minFront)) return false;
      return minFront > LUNGE_THRESHOLDS.parallel + 15;
    },
    severity: 2,
    dynamicCue: 'Drop deeper — aim for front thigh parallel to the floor.',
    fqiPenalty: 15,
  },
  {
    id: 'knee_cave',
    displayName: 'Knee Cave (Valgus)',
    condition: (ctx: RepContext) => {
      const left = ctx.minAngles.leftKnee;
      const right = ctx.minAngles.rightKnee;
      if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
      return Math.abs(left - right) > LUNGE_THRESHOLDS.kneeCaveMax;
    },
    severity: 2,
    dynamicCue: 'Push the front knee out — track it over the middle toes.',
    fqiPenalty: 12,
  },
  {
    id: 'heels_off_ground',
    displayName: 'Heels Off Ground',
    condition: (ctx: RepContext) => {
      // Rear-hip dropping far below front-hip at the bottom suggests the rear
      // heel lifted and the rear leg collapsed. We detect this as a large
      // asymmetric hip-angle spread at min depth.
      const leftHip = ctx.minAngles.leftHip;
      const rightHip = ctx.minAngles.rightHip;
      if (!Number.isFinite(leftHip) || !Number.isFinite(rightHip)) return false;
      return Math.abs(leftHip - rightHip) > LUNGE_THRESHOLDS.heelOffHipDiffMax;
    },
    severity: 1,
    dynamicCue: 'Keep the front heel planted — weight through the middle of the foot.',
    fqiPenalty: 8,
  },
  {
    id: 'asymmetric_depth',
    displayName: 'Asymmetric Depth',
    condition: (ctx: RepContext) => {
      // Compare the deepest-knee angle each rep vs the shallower knee to catch
      // sessions where one leg barely works. Uses the shared `asymmetryCheck`
      // helper so this fault's behavior stays in lockstep with other workouts
      // adopting asymmetry detection.
      return asymmetryCheck(
        ctx.minAngles.leftKnee,
        ctx.minAngles.rightKnee,
        LUNGE_THRESHOLDS.asymmetricDepthMaxPct
      );
    },
    severity: 2,
    dynamicCue: 'Even out both knees — don\'t lean on just one leg.',
    fqiPenalty: 10,
  },
  {
    id: 'forward_knee',
    displayName: 'Knee Over Toes',
    condition: (ctx: RepContext) => {
      // Front knee flexing past a very acute angle (below frontKneeForwardLimit)
      // indicates the knee has shot out over the toes instead of staying over
      // the midfoot / ankle.
      const minFront = Math.min(ctx.minAngles.leftKnee, ctx.minAngles.rightKnee);
      if (!Number.isFinite(minFront)) return false;
      return minFront < LUNGE_THRESHOLDS.frontKneeForwardLimit;
    },
    severity: 1,
    dynamicCue: 'Keep the front knee stacked over the ankle, not past the toes.',
    fqiPenalty: 8,
  },
  {
    id: 'hyper_extension',
    displayName: 'Hyperextension at Lockout',
    condition: (ctx: RepContext) => {
      // At the top of the rep, a fully-locked knee snapping past 180° signals
      // hyperextension. We compare the larger of the two end-rep knee angles.
      const maxEnd = Math.max(ctx.endAngles.leftKnee, ctx.endAngles.rightKnee);
      if (!Number.isFinite(maxEnd)) return false;
      return maxEnd > LUNGE_THRESHOLDS.hyperExtensionMax;
    },
    severity: 1,
    dynamicCue: 'Stand tall but don\'t snap into your knee — stop just shy of lockout.',
    fqiPenalty: 6,
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
): LungeMetrics {
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
    armsTracked: false, // lunge does not require upper-body tracking
    legsTracked,
  };
}

// =============================================================================
// Phase State Machine
// =============================================================================

function getNextPhase(
  currentPhase: LungePhase,
  _angles: JointAngles,
  metrics: LungeMetrics
): LungePhase {
  if (!metrics.legsTracked) {
    return 'setup';
  }

  const knee = metrics.frontKnee;

  switch (currentPhase) {
    case 'setup':
      if (knee >= LUNGE_THRESHOLDS.standing) {
        return 'standing';
      }
      return 'setup';

    case 'standing':
      if (knee <= LUNGE_THRESHOLDS.descentStart) {
        return 'descent';
      }
      return 'standing';

    case 'descent':
      if (knee <= LUNGE_THRESHOLDS.parallel) {
        return 'bottom';
      }
      return 'descent';

    case 'bottom':
      if (knee >= LUNGE_THRESHOLDS.ascent) {
        return 'ascent';
      }
      return 'bottom';

    case 'ascent':
      if (knee >= LUNGE_THRESHOLDS.finish) {
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

export const lungeDefinition: WorkoutDefinition<LungePhase, LungeMetrics> = {
  id: 'lunge',
  displayName: 'Lunge',
  description: 'Unilateral lower body movement targeting quads, glutes, and stability.',
  category: 'lower_body',
  difficulty: 'beginner',

  phases,
  initialPhase: 'setup',
  repBoundary,
  thresholds: LUNGE_THRESHOLDS,
  angleRanges,
  scoringMetrics,
  faults,
  fqiWeights,

  ui: {
    iconName: 'walk-outline',
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
        metrics.frontKnee > LUNGE_THRESHOLDS.parallel + 15
      ) {
        messages.push('Drop deeper — front thigh parallel to the floor.');
      }

      if (
        phaseId === 'bottom' &&
        typeof metrics.frontKnee === 'number' &&
        metrics.frontKnee < LUNGE_THRESHOLDS.frontKneeForwardLimit
      ) {
        messages.push('Ease off — keep the front knee stacked over the ankle.');
      }

      if (phaseId === 'standing') {
        messages.push('Reset your stance, breathe, then repeat.');
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

export default lungeDefinition;
