/**
 * Lat Pulldown Workout Definition
 *
 * Defines all the logic for tracking lat pulldown form:
 * - Phases: setup → top → pulling → bottom → releasing
 * - Rep boundaries: starts at 'pulling', ends at 'top'
 * - Thresholds for elbow-flexion and shoulder-lean angles
 * - Fault detection conditions (4 faults)
 * - FQI calculation weights
 *
 * Seated vertical pulling movement. At the "top" the arms are fully
 * extended overhead (elbow ~170°, shoulder ~160°+). At "bottom" the bar
 * is at the upper chest with elbows flexed (~80°) and shoulders at ~90°.
 *
 * Proxies used (documented here because JointAngles is sparse):
 * - `excessive_lean` — no spine sensor; we use the shoulder-angle delta
 *   between start and peak pull. A lifter leaning back aggressively will
 *   drop the shoulder angle below the expected "seated" envelope.
 * - `elbows_flare` — a high shoulder-abduction angle at the top of the pull
 *   indicates the elbows flared wide (bar pulled behind the neck / flared).
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
import { asymmetryCheck, clampedDelta } from './helpers';

// =============================================================================
// Phase Type
// =============================================================================

export type LatPulldownPhase = 'setup' | 'top' | 'pulling' | 'bottom' | 'releasing';

// =============================================================================
// Metrics Type
// =============================================================================

export interface LatPulldownMetrics extends WorkoutMetrics {
  avgElbow: number;
  avgShoulder: number;
  armsTracked: boolean;
}

// =============================================================================
// Thresholds
// =============================================================================

export const LAT_PULLDOWN_THRESHOLDS = {
  /** Arms extended overhead — elbow near-straight */
  topElbow: 160,
  /** Begin counting a pull once elbow starts flexing */
  pullingStart: 145,
  /** Bottom of pull — elbow flexed ~80° */
  bottomElbow: 90,
  /** Transition to releasing when elbow begins to extend again */
  releasingStart: 110,
  /** Rep "incomplete" if bottom elbow is still above this */
  incompleteLockoutMin: 105,
  /** Shoulder angle at top above which = elbow flare */
  elbowsFlareShoulderMax: 125,
  /** Asymmetric-pull tolerance on elbow angle at bottom (%) */
  asymmetricPullMaxPct: 15,
  /**
   * Excessive-lean shoulder delta — if shoulder angle drops by more than
   * this between rep start (arms overhead) and peak pull (arms down), the
   * lifter is leaning back / cheating.
   */
  excessiveLeanShoulderDeltaMax: 60,
} as const;

// =============================================================================
// Angle Ranges
// =============================================================================

const angleRanges: Record<string, AngleRange> = {
  elbow: {
    min: 75,
    max: 170,
    optimal: 85,
    tolerance: 15,
  },
  shoulder: {
    min: 70,
    max: 170,
    optimal: 150,
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

const phases: PhaseDefinition<LatPulldownPhase>[] = [
  {
    id: 'setup',
    displayName: 'Setup',
    enterCondition: () => true,
    staticCue: 'Knees under pad, thumbs around the bar, chest up.',
  },
  {
    id: 'top',
    displayName: 'Top',
    enterCondition: (angles: JointAngles) => {
      const avgElbow = (angles.leftElbow + angles.rightElbow) / 2;
      return avgElbow >= LAT_PULLDOWN_THRESHOLDS.topElbow;
    },
    staticCue: 'Arms extended — feel the lats stretch.',
  },
  {
    id: 'pulling',
    displayName: 'Pulling',
    enterCondition: (angles: JointAngles, prevPhase: LatPulldownPhase) => {
      const avgElbow = (angles.leftElbow + angles.rightElbow) / 2;
      return prevPhase === 'top' && avgElbow <= LAT_PULLDOWN_THRESHOLDS.pullingStart;
    },
    staticCue: 'Drive elbows down — lead with the lats, not the biceps.',
  },
  {
    id: 'bottom',
    displayName: 'Bottom',
    enterCondition: (angles: JointAngles, prevPhase: LatPulldownPhase) => {
      const avgElbow = (angles.leftElbow + angles.rightElbow) / 2;
      return prevPhase === 'pulling' && avgElbow <= LAT_PULLDOWN_THRESHOLDS.bottomElbow + 10;
    },
    staticCue: 'Bar to the upper chest — pause, squeeze the blades.',
  },
  {
    id: 'releasing',
    displayName: 'Releasing',
    enterCondition: (angles: JointAngles, prevPhase: LatPulldownPhase) => {
      const avgElbow = (angles.leftElbow + angles.rightElbow) / 2;
      return prevPhase === 'bottom' && avgElbow >= LAT_PULLDOWN_THRESHOLDS.releasingStart;
    },
    staticCue: 'Control the eccentric — let the bar rise, stay braced.',
  },
];

// =============================================================================
// Rep Boundary
// =============================================================================

const repBoundary: RepBoundary<LatPulldownPhase> = {
  startPhase: 'pulling',
  endPhase: 'top',
  minDurationMs: 700,
};

// =============================================================================
// Fault Definitions (4 faults per spec)
// =============================================================================

const faults: FaultDefinition[] = [
  {
    id: 'incomplete_lockout',
    displayName: 'Incomplete Range',
    condition: (ctx: RepContext) => {
      const minElbow = Math.min(ctx.minAngles.leftElbow, ctx.minAngles.rightElbow);
      if (!Number.isFinite(minElbow)) return false;
      return minElbow > LAT_PULLDOWN_THRESHOLDS.incompleteLockoutMin;
    },
    severity: 2,
    dynamicCue: 'Pull deeper — bar to the upper chest on every rep.',
    fqiPenalty: 12,
  },
  {
    id: 'excessive_lean',
    displayName: 'Excessive Lean',
    condition: (ctx: RepContext) => {
      const leftLean = clampedDelta(ctx.startAngles.leftShoulder, ctx.minAngles.leftShoulder);
      const rightLean = clampedDelta(ctx.startAngles.rightShoulder, ctx.minAngles.rightShoulder);
      // negative delta = shoulder angle dropped from start to min; magnitude
      // above the threshold indicates a big lean-back cheat.
      const maxLean = Math.max(Math.abs(leftLean), Math.abs(rightLean));
      return maxLean > LAT_PULLDOWN_THRESHOLDS.excessiveLeanShoulderDeltaMax;
    },
    severity: 2,
    dynamicCue: 'Stay tall — let the lats do the work, not your momentum.',
    fqiPenalty: 10,
  },
  {
    id: 'asymmetric_pull',
    displayName: 'Asymmetric Pull',
    condition: (ctx: RepContext) => {
      return asymmetryCheck(
        ctx.minAngles.leftElbow,
        ctx.minAngles.rightElbow,
        LAT_PULLDOWN_THRESHOLDS.asymmetricPullMaxPct
      );
    },
    severity: 1,
    dynamicCue: 'Pull evenly — keep both elbows tracking the same path.',
    fqiPenalty: 8,
  },
  {
    id: 'elbows_flare',
    displayName: 'Elbows Flared',
    condition: (ctx: RepContext) => {
      // Evaluate the shoulder angle at the BOTTOM of the pull (minAngles)
      // — arms overhead at the "top" naturally have high shoulder abduction
      // so checking maxAngles would always fire. At the bottom the shoulder
      // should be tucked below elbowsFlareShoulderMax; above it = flared.
      const bottomShoulder = Math.max(ctx.minAngles.leftShoulder, ctx.minAngles.rightShoulder);
      if (!Number.isFinite(bottomShoulder)) return false;
      return bottomShoulder > LAT_PULLDOWN_THRESHOLDS.elbowsFlareShoulderMax;
    },
    severity: 2,
    dynamicCue: 'Keep elbows in line with the wrists — no chicken-winging.',
    fqiPenalty: 10,
  },
];

// =============================================================================
// FQI Weights
// =============================================================================

const fqiWeights: FQIWeights = {
  rom: 0.4,
  depth: 0.25,
  faults: 0.35,
};

// =============================================================================
// Metrics Calculator
// =============================================================================

function calculateMetrics(
  angles: JointAngles,
  _joints?: Map<string, { x: number; y: number; isTracked: boolean }>
): LatPulldownMetrics {
  const avgElbow = (angles.leftElbow + angles.rightElbow) / 2;
  const avgShoulder = (angles.leftShoulder + angles.rightShoulder) / 2;

  const armsTracked =
    angles.leftElbow > 0 && angles.leftElbow < 180 &&
    angles.rightElbow > 0 && angles.rightElbow < 180;

  return {
    avgElbow,
    avgShoulder,
    armsTracked,
  };
}

// =============================================================================
// Phase State Machine
// =============================================================================

function getNextPhase(
  currentPhase: LatPulldownPhase,
  _angles: JointAngles,
  metrics: LatPulldownMetrics
): LatPulldownPhase {
  if (!metrics.armsTracked) {
    return 'setup';
  }

  const elbow = metrics.avgElbow;

  switch (currentPhase) {
    case 'setup':
      if (elbow >= LAT_PULLDOWN_THRESHOLDS.topElbow) {
        return 'top';
      }
      return 'setup';

    case 'top':
      if (elbow <= LAT_PULLDOWN_THRESHOLDS.pullingStart) {
        return 'pulling';
      }
      return 'top';

    case 'pulling':
      if (elbow <= LAT_PULLDOWN_THRESHOLDS.bottomElbow + 10) {
        return 'bottom';
      }
      return 'pulling';

    case 'bottom':
      if (elbow >= LAT_PULLDOWN_THRESHOLDS.releasingStart) {
        return 'releasing';
      }
      return 'bottom';

    case 'releasing':
      if (elbow >= LAT_PULLDOWN_THRESHOLDS.topElbow) {
        return 'top';
      }
      return 'releasing';

    default:
      return 'setup';
  }
}

// =============================================================================
// Export Workout Definition
// =============================================================================

export const latPulldownDefinition: WorkoutDefinition<LatPulldownPhase, LatPulldownMetrics> = {
  id: 'lat_pulldown',
  displayName: 'Lat Pulldown',
  description: 'Seated vertical pulling movement targeting the lats and mid-back.',
  category: 'upper_body',
  difficulty: 'beginner',

  phases,
  initialPhase: 'setup',
  repBoundary,
  thresholds: LAT_PULLDOWN_THRESHOLDS,
  angleRanges,
  scoringMetrics,
  faults,
  fqiWeights,

  ui: {
    iconName: 'arrow-down-outline',
    primaryMetric: { key: 'avgElbowDeg', label: 'Avg Elbow', format: 'deg' },
    secondaryMetric: { key: 'avgShoulderDeg', label: 'Avg Shoulder', format: 'deg' },
    buildUploadMetrics: (metrics) => ({
      avgElbowDeg: metrics?.avgElbow ?? null,
      avgShoulderDeg: metrics?.avgShoulder ?? null,
    }),
    buildWatchMetrics: (metrics) => ({
      avgElbowDeg: metrics?.avgElbow ?? null,
    }),
    getRealtimeCues: ({ phaseId, metrics }) => {
      const messages: string[] = [];

      if (
        phaseId === 'bottom' &&
        typeof metrics.avgShoulder === 'number' &&
        metrics.avgShoulder > LAT_PULLDOWN_THRESHOLDS.elbowsFlareShoulderMax
      ) {
        messages.push('Elbows in — drive them down, not out.');
      }

      if (
        phaseId === 'top' &&
        typeof metrics.avgElbow === 'number' &&
        metrics.avgElbow < LAT_PULLDOWN_THRESHOLDS.topElbow
      ) {
        messages.push('Let the arms extend fully — feel the stretch.');
      }

      if (messages.length === 0) {
        messages.push('Smooth pull — lats lead, no swinging.');
      }

      return messages;
    },
  },

  calculateMetrics,
  getNextPhase,
};

export default latPulldownDefinition;
