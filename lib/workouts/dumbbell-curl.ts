/**
 * Dumbbell Curl Workout Definition
 *
 * Defines all the logic for tracking dumbbell curl form:
 * - Phases: setup → bottom → curling → top → lowering
 * - Rep boundaries: starts at 'curling', ends at 'bottom'
 * - Thresholds for elbow-flexion angle
 * - Fault detection conditions (3 faults)
 * - FQI calculation weights
 *
 * Elbow-flexion movement targeting biceps. At the bottom the arms are
 * fully extended (elbow ~170°, shoulder ~90°). At the top the elbow is
 * flexed to ~50° with the shoulder only incidentally moving.
 *
 * Proxies used (documented here because JointAngles is sparse):
 * - `swinging` — no wrist/torso rotation sensor; we use a hip-flex delta
 *   between rep start (standing, hip ~175°) and min hip during the rep.
 *   A large hip-flex delta indicates the lifter is using a hip-driven
 *   body swing (kipping) to cheat the weight up. This matches #441's
 *   use of elbow-proxy for grip_shift in dead-hang: pick the nearest
 *   joint when the ideal sensor doesn't exist.
 * - Forearm supination is NOT trackable (no wrist-rotation in JointAngles);
 *   we intentionally do not attempt a supination fault.
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

export type DumbbellCurlPhase = 'setup' | 'bottom' | 'curling' | 'top' | 'lowering';

// =============================================================================
// Metrics Type
// =============================================================================

export interface DumbbellCurlMetrics extends WorkoutMetrics {
  avgElbow: number;
  avgShoulder: number;
  avgHip: number;
  armsTracked: boolean;
}

// =============================================================================
// Thresholds
// =============================================================================

export const DUMBBELL_CURL_THRESHOLDS = {
  /** Bottom — arms extended */
  bottomElbow: 160,
  /** Begin counting a curl once elbow starts flexing */
  curlingStart: 140,
  /** Top — elbow fully flexed */
  topElbow: 60,
  /** Transition to lowering */
  loweringStart: 100,
  /** Rep "incomplete" if top elbow doesn't reach this flexion */
  incompleteLockoutMin: 80,
  /** Hip-flex delta at peak curl above which = swinging cheat */
  swingingHipDeltaMax: 15,
  /** Asymmetric-curl tolerance on elbow at top (%) */
  asymmetricCurlMaxPct: 15,
} as const;

// =============================================================================
// Angle Ranges
// =============================================================================

const angleRanges: Record<string, AngleRange> = {
  elbow: {
    min: 50,
    max: 175,
    optimal: 60,
    tolerance: 15,
  },
  shoulder: {
    min: 80,
    max: 120,
    optimal: 90,
    tolerance: 15,
  },
  hip: {
    min: 165,
    max: 185,
    optimal: 175,
    tolerance: 8,
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
];

// =============================================================================
// Phase Definitions
// =============================================================================

const phases: PhaseDefinition<DumbbellCurlPhase>[] = [
  {
    id: 'setup',
    displayName: 'Setup',
    enterCondition: () => true,
    staticCue: 'Stand tall, elbows pinned to the sides, palms forward.',
  },
  {
    id: 'bottom',
    displayName: 'Bottom',
    enterCondition: (angles: JointAngles) => {
      const avgElbow = (angles.leftElbow + angles.rightElbow) / 2;
      return avgElbow >= DUMBBELL_CURL_THRESHOLDS.bottomElbow;
    },
    staticCue: 'Brace — elbows still, no swinging.',
  },
  {
    id: 'curling',
    displayName: 'Curling',
    enterCondition: (angles: JointAngles, prevPhase: DumbbellCurlPhase) => {
      const avgElbow = (angles.leftElbow + angles.rightElbow) / 2;
      return prevPhase === 'bottom' && avgElbow <= DUMBBELL_CURL_THRESHOLDS.curlingStart;
    },
    staticCue: 'Curl the bells — squeeze the biceps, elbows fixed.',
  },
  {
    id: 'top',
    displayName: 'Top',
    enterCondition: (angles: JointAngles, prevPhase: DumbbellCurlPhase) => {
      const avgElbow = (angles.leftElbow + angles.rightElbow) / 2;
      return prevPhase === 'curling' && avgElbow <= DUMBBELL_CURL_THRESHOLDS.topElbow + 10;
    },
    staticCue: 'Squeeze hard — hold the top briefly.',
  },
  {
    id: 'lowering',
    displayName: 'Lowering',
    enterCondition: (angles: JointAngles, prevPhase: DumbbellCurlPhase) => {
      const avgElbow = (angles.leftElbow + angles.rightElbow) / 2;
      return prevPhase === 'top' && avgElbow >= DUMBBELL_CURL_THRESHOLDS.loweringStart;
    },
    staticCue: 'Lower slow — full stretch at the bottom.',
  },
];

// =============================================================================
// Rep Boundary
// =============================================================================

const repBoundary: RepBoundary<DumbbellCurlPhase> = {
  startPhase: 'curling',
  endPhase: 'bottom',
  minDurationMs: 600,
};

// =============================================================================
// Fault Definitions (3 faults per spec)
// =============================================================================

const faults: FaultDefinition[] = [
  {
    id: 'swinging',
    displayName: 'Body Swing',
    condition: (ctx: RepContext) => {
      // rep starts standing (hip ~175°). Any large hip-flex delta during
      // the rep indicates hip-driven swinging / kipping to cheat the weight.
      const leftDelta = clampedDelta(ctx.startAngles.leftHip, ctx.minAngles.leftHip);
      const rightDelta = clampedDelta(ctx.startAngles.rightHip, ctx.minAngles.rightHip);
      const maxSwing = Math.max(Math.abs(leftDelta), Math.abs(rightDelta));
      return maxSwing > DUMBBELL_CURL_THRESHOLDS.swingingHipDeltaMax;
    },
    severity: 2,
    dynamicCue: 'Stop swinging — lock the hips, let the biceps do the work.',
    fqiPenalty: 12,
  },
  {
    id: 'incomplete_lockout',
    displayName: 'Incomplete Curl',
    condition: (ctx: RepContext) => {
      const minElbow = Math.min(ctx.minAngles.leftElbow, ctx.minAngles.rightElbow);
      if (!Number.isFinite(minElbow)) return false;
      return minElbow > DUMBBELL_CURL_THRESHOLDS.incompleteLockoutMin;
    },
    severity: 1,
    dynamicCue: 'Curl higher — bring the dumbbells to the shoulders.',
    fqiPenalty: 8,
  },
  {
    id: 'asymmetric_curl',
    displayName: 'Asymmetric Curl',
    condition: (ctx: RepContext) => {
      return asymmetryCheck(
        ctx.minAngles.leftElbow,
        ctx.minAngles.rightElbow,
        DUMBBELL_CURL_THRESHOLDS.asymmetricCurlMaxPct
      );
    },
    severity: 1,
    dynamicCue: 'Curl both arms together — match the tempo side to side.',
    fqiPenalty: 6,
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
): DumbbellCurlMetrics {
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
  currentPhase: DumbbellCurlPhase,
  _angles: JointAngles,
  metrics: DumbbellCurlMetrics
): DumbbellCurlPhase {
  if (!metrics.armsTracked) {
    return 'setup';
  }

  const elbow = metrics.avgElbow;

  switch (currentPhase) {
    case 'setup':
      if (elbow >= DUMBBELL_CURL_THRESHOLDS.bottomElbow) {
        return 'bottom';
      }
      return 'setup';

    case 'bottom':
      if (elbow <= DUMBBELL_CURL_THRESHOLDS.curlingStart) {
        return 'curling';
      }
      return 'bottom';

    case 'curling':
      if (elbow <= DUMBBELL_CURL_THRESHOLDS.topElbow + 10) {
        return 'top';
      }
      return 'curling';

    case 'top':
      if (elbow >= DUMBBELL_CURL_THRESHOLDS.loweringStart) {
        return 'lowering';
      }
      return 'top';

    case 'lowering':
      if (elbow >= DUMBBELL_CURL_THRESHOLDS.bottomElbow) {
        return 'bottom';
      }
      return 'lowering';

    default:
      return 'setup';
  }
}

// =============================================================================
// Export Workout Definition
// =============================================================================

export const dumbbellCurlDefinition: WorkoutDefinition<DumbbellCurlPhase, DumbbellCurlMetrics> = {
  id: 'dumbbell_curl',
  displayName: 'Dumbbell Curl',
  description: 'Isolation movement targeting the biceps via elbow flexion.',
  category: 'upper_body',
  difficulty: 'beginner',

  phases,
  initialPhase: 'setup',
  repBoundary,
  thresholds: DUMBBELL_CURL_THRESHOLDS,
  angleRanges,
  scoringMetrics,
  faults,
  fqiWeights,

  ui: {
    iconName: 'fitness-outline',
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
        phaseId === 'curling' &&
        typeof metrics.avgHip === 'number' &&
        metrics.avgHip < 165
      ) {
        messages.push('Stop swinging — hips stay locked.');
      }

      if (
        phaseId === 'top' &&
        typeof metrics.avgElbow === 'number' &&
        metrics.avgElbow > DUMBBELL_CURL_THRESHOLDS.incompleteLockoutMin
      ) {
        messages.push('Squeeze all the way up — full biceps contraction.');
      }

      if (messages.length === 0) {
        messages.push('Slow tempo — elbows pinned, control the descent.');
      }

      return messages;
    },
  },

  calculateMetrics,
  getNextPhase,
};

export default dumbbellCurlDefinition;
