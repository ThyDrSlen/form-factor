/**
 * Barbell Row Workout Definition
 *
 * Defines all the logic for tracking barbell row form:
 * - Phases: setup → hinged → pulling → top → lowering
 * - Rep boundaries: starts at 'pulling', ends at 'hinged'
 * - Thresholds for elbow-flexion and hip-hinge angles
 * - Fault detection conditions (4 faults)
 * - FQI calculation weights
 *
 * Horizontal pulling movement. At the bottom ("hinged") the torso is
 * nearly parallel to the floor (hip angle ~100°) and elbows are
 * extended (~170°). At the top ("top") the elbows are flexed to ~70°
 * with shoulders staying retracted.
 *
 * Proxies used (documented here because JointAngles is sparse):
 * - `rounded_back` — no spine sensor; we compare the shoulder-angle
 *   change vs hip-angle change. If the shoulders sag forward faster
 *   than the hips rise at peak pull, we treat it as spinal flexion.
 * - `elbows_high` — high shoulder-abduction angle at top = chicken-winging
 *   (bar pulled to the chest instead of the lower-ribs).
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
import { asymmetryCheck, sequenceCheck } from './helpers';

// =============================================================================
// Phase Type
// =============================================================================

export type BarbellRowPhase = 'setup' | 'hinged' | 'pulling' | 'top' | 'lowering';

// =============================================================================
// Metrics Type
// =============================================================================

export interface BarbellRowMetrics extends WorkoutMetrics {
  avgElbow: number;
  avgShoulder: number;
  avgHip: number;
  armsTracked: boolean;
}

// =============================================================================
// Thresholds
// =============================================================================

export const BARBELL_ROW_THRESHOLDS = {
  /** Hip-angle at hinge start — torso near parallel */
  hingedHipMax: 120,
  /** Elbow near-extended at bottom */
  bottomElbow: 155,
  /** Transition to pulling once elbow starts flexing */
  pullingStart: 140,
  /** Peak pull — elbow flexed ~70° */
  topElbow: 80,
  /** Transition back to lowering */
  loweringStart: 110,
  /** Rep considered "incomplete" if top elbow is still above this */
  incompleteLockoutMin: 100,
  /** Shoulder angle at top above which = elbows-high / chicken wing */
  elbowsHighShoulderMax: 115,
  /** Asymmetric-pull tolerance on elbow angle at top (%) */
  asymmetricPullMaxPct: 15,
  /**
   * Rounded-back check — primary is hip, secondary is shoulder. During a
   * clean row the hip should move more than the shoulder (lifter stays
   * hinged). If the shoulder-angle delta exceeds hip-angle delta we flag.
   * No absolute angle threshold — sequenceCheck is comparative.
   */
} as const;

// =============================================================================
// Angle Ranges
// =============================================================================

const angleRanges: Record<string, AngleRange> = {
  elbow: {
    min: 70,
    max: 170,
    optimal: 80,
    tolerance: 15,
  },
  shoulder: {
    min: 60,
    max: 120,
    optimal: 90,
    tolerance: 15,
  },
  hip: {
    min: 80,
    max: 130,
    optimal: 105,
    tolerance: 15,
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

const phases: PhaseDefinition<BarbellRowPhase>[] = [
  {
    id: 'setup',
    displayName: 'Setup',
    enterCondition: () => true,
    staticCue: 'Hinge to ~45°, brace, bar over mid-foot.',
  },
  {
    id: 'hinged',
    displayName: 'Hinged',
    enterCondition: (angles: JointAngles) => {
      const avgHip = (angles.leftHip + angles.rightHip) / 2;
      const avgElbow = (angles.leftElbow + angles.rightElbow) / 2;
      return avgHip <= BARBELL_ROW_THRESHOLDS.hingedHipMax && avgElbow >= BARBELL_ROW_THRESHOLDS.bottomElbow;
    },
    staticCue: 'Hold the hinge — keep the back flat, arms long.',
  },
  {
    id: 'pulling',
    displayName: 'Pulling',
    enterCondition: (angles: JointAngles, prevPhase: BarbellRowPhase) => {
      const avgElbow = (angles.leftElbow + angles.rightElbow) / 2;
      return prevPhase === 'hinged' && avgElbow <= BARBELL_ROW_THRESHOLDS.pullingStart;
    },
    staticCue: 'Drive the elbows back — bar to the lower ribs.',
  },
  {
    id: 'top',
    displayName: 'Top',
    enterCondition: (angles: JointAngles, prevPhase: BarbellRowPhase) => {
      const avgElbow = (angles.leftElbow + angles.rightElbow) / 2;
      return prevPhase === 'pulling' && avgElbow <= BARBELL_ROW_THRESHOLDS.topElbow + 10;
    },
    staticCue: 'Squeeze the blades — brief pause at the top.',
  },
  {
    id: 'lowering',
    displayName: 'Lowering',
    enterCondition: (angles: JointAngles, prevPhase: BarbellRowPhase) => {
      const avgElbow = (angles.leftElbow + angles.rightElbow) / 2;
      return prevPhase === 'top' && avgElbow >= BARBELL_ROW_THRESHOLDS.loweringStart;
    },
    staticCue: 'Lower under control — stay hinged.',
  },
];

// =============================================================================
// Rep Boundary
// =============================================================================

const repBoundary: RepBoundary<BarbellRowPhase> = {
  startPhase: 'pulling',
  endPhase: 'hinged',
  minDurationMs: 700,
};

// =============================================================================
// Fault Definitions (4 faults per spec)
// =============================================================================

const faults: FaultDefinition[] = [
  {
    id: 'incomplete_lockout',
    displayName: 'Incomplete Row',
    condition: (ctx: RepContext) => {
      const minElbow = Math.min(ctx.minAngles.leftElbow, ctx.minAngles.rightElbow);
      if (!Number.isFinite(minElbow)) return false;
      return minElbow > BARBELL_ROW_THRESHOLDS.incompleteLockoutMin;
    },
    severity: 2,
    dynamicCue: 'Pull higher — bar should touch the lower ribs.',
    fqiPenalty: 12,
  },
  {
    id: 'rounded_back',
    displayName: 'Rounded Back',
    condition: (ctx: RepContext) => {
      // Hip should move less than the shoulder during a proper row (torso
      // stays pinned to angle). If the shoulder-angle delta OUTPACES the
      // hip-angle delta, we flag as spinal flexion. sequenceCheck with
      // shouldPrimaryRiseFirst=true fires when primary (hip) < secondary (shoulder).
      const leftHipDelta = Math.abs(ctx.maxAngles.leftHip - ctx.minAngles.leftHip);
      const rightHipDelta = Math.abs(ctx.maxAngles.rightHip - ctx.minAngles.rightHip);
      const leftShoulderDelta = Math.abs(ctx.maxAngles.leftShoulder - ctx.minAngles.leftShoulder);
      const rightShoulderDelta = Math.abs(ctx.maxAngles.rightShoulder - ctx.minAngles.rightShoulder);
      const hipDelta = Math.max(leftHipDelta, rightHipDelta);
      const shoulderDelta = Math.max(leftShoulderDelta, rightShoulderDelta);
      return sequenceCheck(0, hipDelta, 0, shoulderDelta, true) && shoulderDelta > 15;
    },
    severity: 3,
    dynamicCue: 'Brace and keep the back flat — no rounding at the top.',
    fqiPenalty: 15,
  },
  {
    id: 'asymmetric_pull',
    displayName: 'Asymmetric Pull',
    condition: (ctx: RepContext) => {
      return asymmetryCheck(
        ctx.minAngles.leftElbow,
        ctx.minAngles.rightElbow,
        BARBELL_ROW_THRESHOLDS.asymmetricPullMaxPct
      );
    },
    severity: 1,
    dynamicCue: 'Pull evenly — both elbows arrive at the ribs together.',
    fqiPenalty: 8,
  },
  {
    id: 'elbows_high',
    displayName: 'Elbows Flared High',
    condition: (ctx: RepContext) => {
      const maxShoulder = Math.max(ctx.maxAngles.leftShoulder, ctx.maxAngles.rightShoulder);
      if (!Number.isFinite(maxShoulder)) return false;
      return maxShoulder > BARBELL_ROW_THRESHOLDS.elbowsHighShoulderMax;
    },
    severity: 2,
    dynamicCue: 'Keep elbows tucked — pull the bar low and tight to the body.',
    fqiPenalty: 10,
  },
];

// =============================================================================
// FQI Weights
// =============================================================================

const fqiWeights: FQIWeights = {
  rom: 0.35,
  depth: 0.3,
  faults: 0.35,
};

// =============================================================================
// Metrics Calculator
// =============================================================================

function calculateMetrics(
  angles: JointAngles,
  _joints?: Map<string, { x: number; y: number; isTracked: boolean }>
): BarbellRowMetrics {
  const avgElbow = (angles.leftElbow + angles.rightElbow) / 2;
  const avgShoulder = (angles.leftShoulder + angles.rightShoulder) / 2;
  const avgHip = (angles.leftHip + angles.rightHip) / 2;

  const armsTracked =
    angles.leftElbow > 0 && angles.leftElbow < 180 &&
    angles.rightElbow > 0 && angles.rightElbow < 180;

  return {
    avgElbow,
    avgShoulder,
    avgHip,
    armsTracked,
  };
}

// =============================================================================
// Phase State Machine
// =============================================================================

function getNextPhase(
  currentPhase: BarbellRowPhase,
  _angles: JointAngles,
  metrics: BarbellRowMetrics
): BarbellRowPhase {
  if (!metrics.armsTracked) {
    return 'setup';
  }

  const elbow = metrics.avgElbow;
  const hip = metrics.avgHip;

  switch (currentPhase) {
    case 'setup':
      if (hip <= BARBELL_ROW_THRESHOLDS.hingedHipMax && elbow >= BARBELL_ROW_THRESHOLDS.bottomElbow) {
        return 'hinged';
      }
      return 'setup';

    case 'hinged':
      if (elbow <= BARBELL_ROW_THRESHOLDS.pullingStart) {
        return 'pulling';
      }
      return 'hinged';

    case 'pulling':
      if (elbow <= BARBELL_ROW_THRESHOLDS.topElbow + 10) {
        return 'top';
      }
      return 'pulling';

    case 'top':
      if (elbow >= BARBELL_ROW_THRESHOLDS.loweringStart) {
        return 'lowering';
      }
      return 'top';

    case 'lowering':
      if (elbow >= BARBELL_ROW_THRESHOLDS.bottomElbow) {
        return 'hinged';
      }
      return 'lowering';

    default:
      return 'setup';
  }
}

// =============================================================================
// Export Workout Definition
// =============================================================================

export const barbellRowDefinition: WorkoutDefinition<BarbellRowPhase, BarbellRowMetrics> = {
  id: 'barbell_row',
  displayName: 'Barbell Row',
  description: 'Horizontal pulling movement targeting the mid-back, lats, and rear delts.',
  category: 'upper_body',
  difficulty: 'intermediate',

  phases,
  initialPhase: 'setup',
  repBoundary,
  thresholds: BARBELL_ROW_THRESHOLDS,
  angleRanges,
  scoringMetrics,
  faults,
  fqiWeights,

  ui: {
    iconName: 'barbell-outline',
    primaryMetric: { key: 'avgElbowDeg', label: 'Avg Elbow', format: 'deg' },
    secondaryMetric: { key: 'avgHipDeg', label: 'Avg Hip', format: 'deg' },
    buildUploadMetrics: (metrics) => ({
      avgElbowDeg: metrics?.avgElbow ?? null,
      avgShoulderDeg: metrics?.avgShoulder ?? null,
      avgHipDeg: metrics?.avgHip ?? null,
    }),
    buildWatchMetrics: (metrics) => ({
      avgElbowDeg: metrics?.avgElbow ?? null,
    }),
    getRealtimeCues: ({ phaseId, metrics }) => {
      const messages: string[] = [];

      if (
        phaseId === 'top' &&
        typeof metrics.avgShoulder === 'number' &&
        metrics.avgShoulder > BARBELL_ROW_THRESHOLDS.elbowsHighShoulderMax
      ) {
        messages.push('Tuck elbows down — pull to the lower ribs.');
      }

      if (
        phaseId === 'pulling' &&
        typeof metrics.avgHip === 'number' &&
        metrics.avgHip > BARBELL_ROW_THRESHOLDS.hingedHipMax + 20
      ) {
        messages.push('Stay hinged — resist the urge to stand up.');
      }

      if (messages.length === 0) {
        messages.push('Smooth pull — squeeze the shoulder blades at the top.');
      }

      return messages;
    },
  },

  calculateMetrics,
  getNextPhase,
};

export default barbellRowDefinition;
