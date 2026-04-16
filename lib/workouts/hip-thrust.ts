/**
 * Hip Thrust Workout Definition
 *
 * Defines all the logic for tracking hip thrust form:
 * - Phases: setup → bottom → ascent → lockout → descent
 * - Rep boundaries: starts at 'ascent', ends at 'lockout'
 * - Thresholds for hip-extension angle
 * - Fault detection conditions (5 faults)
 * - FQI calculation weights
 *
 * Bilateral lower-posterior-chain movement. The "hip angle" from the
 * standard JointAngles interface is the anterior hip-flexion angle, so
 * at the top of a clean rep both hips are near-extended (~170-180°)
 * and at the bottom they're near 90° with the shoulders on the bench
 * and feet on the floor.
 *
 * Proxies used (documented here because JointAngles is sparse):
 * - `heel_liftoff` — no foot-position sensor; we compare left/right knee
 *   angles at peak hip extension. A clean hip thrust keeps both knees
 *   near 90°; if one knee drives to ~180° (leg extended / heel off) the
 *   knee-angle delta widens.
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

export type HipThrustPhase = 'setup' | 'bottom' | 'ascent' | 'lockout' | 'descent';

// =============================================================================
// Metrics Type
// =============================================================================

export interface HipThrustMetrics extends WorkoutMetrics {
  avgHip: number;
  avgKnee: number;
  legsTracked: boolean;
}

// =============================================================================
// Thresholds
// =============================================================================

export const HIP_THRUST_THRESHOLDS = {
  /** Bottom of the rep — hip flexed at ~90° (glute below bench) */
  bottomHip: 100,
  /** Begin counting ascent once we've cleared the bottom */
  ascentStart: 120,
  /** Lockout hip angle — full hip extension */
  lockoutHip: 165,
  /** Minimum hip angle at bottom below which depth is considered ROM */
  depthFloor: 115,
  /** Hip-angle asymmetry tolerance at peak (as % of the larger side) */
  asymmetricExtMaxPct: 12,
  /**
   * Knee asymmetry at peak extension. Proxy for heel liftoff — a lifted
   * heel lets that leg extend (knee angle creeps toward 180°) while
   * the other stays planted near 90°.
   */
  heelLiftoffKneeDiffMax: 30,
  /** Hip angle above this at peak = hyperextension / lumbar over-arching */
  hyperExtensionMax: 185,
  /** Minimum peak-hip angle below which we treat the rep as "incomplete lockout" */
  incompleteLockoutMin: 155,
} as const;

// =============================================================================
// Angle Ranges
// =============================================================================

const angleRanges: Record<string, AngleRange> = {
  hip: {
    min: 90,
    max: 180,
    optimal: 175,
    tolerance: 10,
  },
  knee: {
    min: 80,
    max: 110,
    optimal: 90,
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

const phases: PhaseDefinition<HipThrustPhase>[] = [
  {
    id: 'setup',
    displayName: 'Setup',
    enterCondition: () => true,
    staticCue: 'Upper back on the bench, feet flat, shins vertical at the top.',
  },
  {
    id: 'bottom',
    displayName: 'Bottom',
    enterCondition: (angles: JointAngles) => {
      const avgHip = (angles.leftHip + angles.rightHip) / 2;
      return avgHip <= HIP_THRUST_THRESHOLDS.bottomHip;
    },
    staticCue: 'Brace, tuck chin, drive through the heels.',
  },
  {
    id: 'ascent',
    displayName: 'Ascending',
    enterCondition: (angles: JointAngles, prevPhase: HipThrustPhase) => {
      const avgHip = (angles.leftHip + angles.rightHip) / 2;
      return prevPhase === 'bottom' && avgHip >= HIP_THRUST_THRESHOLDS.ascentStart;
    },
    staticCue: 'Hips up — squeeze the glutes as you drive.',
  },
  {
    id: 'lockout',
    displayName: 'Lockout',
    enterCondition: (angles: JointAngles, prevPhase: HipThrustPhase) => {
      const avgHip = (angles.leftHip + angles.rightHip) / 2;
      return prevPhase === 'ascent' && avgHip >= HIP_THRUST_THRESHOLDS.lockoutHip;
    },
    staticCue: 'Full hip extension — ribs down, do not over-arch.',
  },
  {
    id: 'descent',
    displayName: 'Descending',
    enterCondition: (angles: JointAngles, prevPhase: HipThrustPhase) => {
      const avgHip = (angles.leftHip + angles.rightHip) / 2;
      return prevPhase === 'lockout' && avgHip <= HIP_THRUST_THRESHOLDS.ascentStart;
    },
    staticCue: 'Lower under control — keep glutes engaged.',
  },
];

// =============================================================================
// Rep Boundary
// =============================================================================

const repBoundary: RepBoundary<HipThrustPhase> = {
  startPhase: 'ascent',
  endPhase: 'lockout',
  minDurationMs: 600,
};

// =============================================================================
// Fault Definitions (5 faults per spec)
// =============================================================================

const faults: FaultDefinition[] = [
  {
    id: 'shallow_depth',
    displayName: 'Shallow Depth',
    condition: (ctx: RepContext) => {
      const minHip = Math.min(ctx.minAngles.leftHip, ctx.minAngles.rightHip);
      if (!Number.isFinite(minHip)) return false;
      return minHip > HIP_THRUST_THRESHOLDS.depthFloor;
    },
    severity: 2,
    dynamicCue: 'Lower further — let the hips drop until they crease under the bench.',
    fqiPenalty: 12,
  },
  {
    id: 'heel_liftoff',
    displayName: 'Heel Liftoff',
    condition: (ctx: RepContext) => {
      const left = ctx.maxAngles.leftKnee;
      const right = ctx.maxAngles.rightKnee;
      if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
      return Math.abs(left - right) > HIP_THRUST_THRESHOLDS.heelLiftoffKneeDiffMax;
    },
    severity: 2,
    dynamicCue: 'Drive through the whole foot — keep both heels planted.',
    fqiPenalty: 10,
  },
  {
    id: 'incomplete_lockout',
    displayName: 'Incomplete Lockout',
    condition: (ctx: RepContext) => {
      const maxHip = Math.max(ctx.maxAngles.leftHip, ctx.maxAngles.rightHip);
      if (!Number.isFinite(maxHip)) return false;
      return maxHip < HIP_THRUST_THRESHOLDS.incompleteLockoutMin;
    },
    severity: 2,
    dynamicCue: 'Finish each rep — drive hips to full extension.',
    fqiPenalty: 12,
  },
  {
    id: 'asymmetric_extension',
    displayName: 'Asymmetric Extension',
    condition: (ctx: RepContext) => {
      return asymmetryCheck(
        ctx.maxAngles.leftHip,
        ctx.maxAngles.rightHip,
        HIP_THRUST_THRESHOLDS.asymmetricExtMaxPct
      );
    },
    severity: 1,
    dynamicCue: 'Drive evenly — keep both hips rising together.',
    fqiPenalty: 8,
  },
  {
    id: 'hyperextension',
    displayName: 'Lumbar Hyperextension',
    condition: (ctx: RepContext) => {
      const maxHip = Math.max(ctx.maxAngles.leftHip, ctx.maxAngles.rightHip);
      if (!Number.isFinite(maxHip)) return false;
      return maxHip > HIP_THRUST_THRESHOLDS.hyperExtensionMax;
    },
    severity: 1,
    dynamicCue: 'Ribs down — finish with the glutes, not the lower back.',
    fqiPenalty: 8,
  },
];

// =============================================================================
// FQI Weights
// =============================================================================

const fqiWeights: FQIWeights = {
  rom: 0.25,
  depth: 0.4,
  faults: 0.35,
};

// =============================================================================
// Metrics Calculator
// =============================================================================

function calculateMetrics(
  angles: JointAngles,
  _joints?: Map<string, { x: number; y: number; isTracked: boolean }>
): HipThrustMetrics {
  const avgHip = (angles.leftHip + angles.rightHip) / 2;
  const avgKnee = (angles.leftKnee + angles.rightKnee) / 2;

  const legsTracked =
    angles.leftKnee > 0 && angles.leftKnee < 180 &&
    angles.rightKnee > 0 && angles.rightKnee < 180 &&
    angles.leftHip > 0 && angles.leftHip < 180 &&
    angles.rightHip > 0 && angles.rightHip < 180;

  return {
    avgHip,
    avgKnee,
    armsTracked: false,
    legsTracked,
  };
}

// =============================================================================
// Phase State Machine
// =============================================================================

function getNextPhase(
  currentPhase: HipThrustPhase,
  _angles: JointAngles,
  metrics: HipThrustMetrics
): HipThrustPhase {
  if (!metrics.legsTracked) {
    return 'setup';
  }

  const hip = metrics.avgHip;

  switch (currentPhase) {
    case 'setup':
      if (hip <= HIP_THRUST_THRESHOLDS.bottomHip) {
        return 'bottom';
      }
      return 'setup';

    case 'bottom':
      if (hip >= HIP_THRUST_THRESHOLDS.ascentStart) {
        return 'ascent';
      }
      return 'bottom';

    case 'ascent':
      if (hip >= HIP_THRUST_THRESHOLDS.lockoutHip) {
        return 'lockout';
      }
      return 'ascent';

    case 'lockout':
      if (hip <= HIP_THRUST_THRESHOLDS.ascentStart) {
        return 'descent';
      }
      return 'lockout';

    case 'descent':
      if (hip <= HIP_THRUST_THRESHOLDS.bottomHip) {
        return 'bottom';
      }
      return 'descent';

    default:
      return 'setup';
  }
}

// =============================================================================
// Export Workout Definition
// =============================================================================

export const hipThrustDefinition: WorkoutDefinition<HipThrustPhase, HipThrustMetrics> = {
  id: 'hip_thrust',
  displayName: 'Hip Thrust',
  description: 'Hip-dominant posterior chain movement targeting glutes and hamstrings.',
  category: 'lower_body',
  difficulty: 'intermediate',

  phases,
  initialPhase: 'setup',
  repBoundary,
  thresholds: HIP_THRUST_THRESHOLDS,
  angleRanges,
  scoringMetrics,
  faults,
  fqiWeights,

  ui: {
    iconName: 'trending-up-outline',
    primaryMetric: { key: 'avgHipDeg', label: 'Avg Hip', format: 'deg' },
    secondaryMetric: { key: 'avgKneeDeg', label: 'Avg Knee', format: 'deg' },
    buildUploadMetrics: (metrics) => ({
      avgHipDeg: metrics?.avgHip ?? null,
      avgKneeDeg: metrics?.avgKnee ?? null,
    }),
    buildWatchMetrics: (metrics) => ({
      avgHipDeg: metrics?.avgHip ?? null,
    }),
    getRealtimeCues: ({ phaseId, metrics }) => {
      const messages: string[] = [];

      if (
        phaseId === 'lockout' &&
        typeof metrics.avgHip === 'number' &&
        metrics.avgHip > HIP_THRUST_THRESHOLDS.hyperExtensionMax
      ) {
        messages.push('Ribs down — finish with the glutes, not the lower back.');
      }

      if (
        phaseId === 'ascent' &&
        typeof metrics.avgHip === 'number' &&
        metrics.avgHip < HIP_THRUST_THRESHOLDS.incompleteLockoutMin
      ) {
        messages.push('Drive higher — aim for full hip extension.');
      }

      if (messages.length === 0) {
        messages.push('Controlled tempo — squeeze at the top.');
      }

      return messages;
    },
  },

  calculateMetrics,
  getNextPhase,
};

export default hipThrustDefinition;
