/**
 * Overhead Press Workout Definition
 *
 * Defines all the logic for tracking overhead press form:
 * - Phases: setup → rack → press → lockout → lowering
 * - Rep boundaries: starts at 'press', ends at 'lockout'
 * - Thresholds for elbow-extension and shoulder-flexion angles
 * - Fault detection conditions (4 faults)
 * - FQI calculation weights
 *
 * Standing overhead pressing movement. At the "rack" position elbows are
 * flexed (~90°) and shoulders are near-horizontal. At "lockout" the arms
 * are fully extended overhead (elbow ~175°, shoulder ~170°).
 *
 * Proxies used (documented here because JointAngles is sparse):
 * - `excessive_lean` — no spine sensor; we compare hip-angle delta between
 *   rep start and peak press. A lifter leaning back to push-press will
 *   increase the hip angle past the "standing" envelope.
 * - `core_hyperextension` — a further extension of hip angle past the
 *   hyperextension threshold at lockout indicates lumbar over-arching to
 *   get the bar overhead without genuine shoulder mobility.
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

export type OverheadPressPhase = 'setup' | 'rack' | 'press' | 'lockout' | 'lowering';

// =============================================================================
// Metrics Type
// =============================================================================

export interface OverheadPressMetrics extends WorkoutMetrics {
  avgElbow: number;
  avgShoulder: number;
  avgHip: number;
  armsTracked: boolean;
}

// =============================================================================
// Thresholds
// =============================================================================

export const OVERHEAD_PRESS_THRESHOLDS = {
  /** Rack position — elbow flexed at ~90° */
  rackElbow: 100,
  /** Begin counting a press once elbow starts extending */
  pressStart: 120,
  /** Lockout elbow — arms near-straight */
  lockoutElbow: 165,
  /** Transition back to lowering */
  loweringStart: 140,
  /** Rep "incomplete" if top elbow doesn't hit this */
  incompleteLockoutMin: 155,
  /** Hip angle above this at lockout = core hyperextension / lumbar arch */
  coreHyperExtensionMax: 185,
  /** Hip-angle delta tolerance between rep start (standing) and peak — lean */
  excessiveLeanHipDeltaMax: 15,
  /** Asymmetric-press tolerance on elbow angle at lockout (%) */
  asymmetricPressMaxPct: 10,
} as const;

// =============================================================================
// Angle Ranges
// =============================================================================

const angleRanges: Record<string, AngleRange> = {
  elbow: {
    min: 85,
    max: 180,
    optimal: 175,
    tolerance: 10,
  },
  shoulder: {
    min: 80,
    max: 180,
    optimal: 170,
    tolerance: 15,
  },
  hip: {
    min: 160,
    max: 185,
    optimal: 175,
    tolerance: 10,
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

const phases: PhaseDefinition<OverheadPressPhase>[] = [
  {
    id: 'setup',
    displayName: 'Setup',
    enterCondition: () => true,
    staticCue: 'Clean the bar to the shoulders, elbows just below the bar.',
  },
  {
    id: 'rack',
    displayName: 'Rack',
    enterCondition: (angles: JointAngles) => {
      const avgElbow = (angles.leftElbow + angles.rightElbow) / 2;
      return avgElbow <= OVERHEAD_PRESS_THRESHOLDS.rackElbow;
    },
    staticCue: 'Brace, squeeze glutes — ribs stacked over hips.',
  },
  {
    id: 'press',
    displayName: 'Pressing',
    enterCondition: (angles: JointAngles, prevPhase: OverheadPressPhase) => {
      const avgElbow = (angles.leftElbow + angles.rightElbow) / 2;
      return prevPhase === 'rack' && avgElbow >= OVERHEAD_PRESS_THRESHOLDS.pressStart;
    },
    staticCue: 'Drive the bar straight up — tuck the chin as it passes.',
  },
  {
    id: 'lockout',
    displayName: 'Lockout',
    enterCondition: (angles: JointAngles, prevPhase: OverheadPressPhase) => {
      const avgElbow = (angles.leftElbow + angles.rightElbow) / 2;
      return prevPhase === 'press' && avgElbow >= OVERHEAD_PRESS_THRESHOLDS.lockoutElbow;
    },
    staticCue: 'Bar overhead — biceps by the ears, ribs down.',
  },
  {
    id: 'lowering',
    displayName: 'Lowering',
    enterCondition: (angles: JointAngles, prevPhase: OverheadPressPhase) => {
      const avgElbow = (angles.leftElbow + angles.rightElbow) / 2;
      return prevPhase === 'lockout' && avgElbow <= OVERHEAD_PRESS_THRESHOLDS.loweringStart;
    },
    staticCue: 'Lower under control — bar tracks back to the shoulders.',
  },
];

// =============================================================================
// Rep Boundary
// =============================================================================

const repBoundary: RepBoundary<OverheadPressPhase> = {
  startPhase: 'press',
  endPhase: 'lockout',
  minDurationMs: 500,
};

// =============================================================================
// Fault Definitions (4 faults per spec)
// =============================================================================

const faults: FaultDefinition[] = [
  {
    id: 'incomplete_lockout',
    displayName: 'Incomplete Lockout',
    condition: (ctx: RepContext) => {
      const maxElbow = Math.max(ctx.maxAngles.leftElbow, ctx.maxAngles.rightElbow);
      if (!Number.isFinite(maxElbow)) return false;
      return maxElbow < OVERHEAD_PRESS_THRESHOLDS.incompleteLockoutMin;
    },
    severity: 2,
    dynamicCue: 'Punch the bar to full lockout — arms straight overhead.',
    fqiPenalty: 12,
  },
  {
    id: 'excessive_lean',
    displayName: 'Excessive Lean',
    condition: (ctx: RepContext) => {
      // rep starts "standing" (hip ~175°). If the hip angle drops
      // substantially during the press, the lifter is leaning back to
      // turn the press into a push-press.
      const leftDelta = clampedDelta(ctx.startAngles.leftHip, ctx.minAngles.leftHip);
      const rightDelta = clampedDelta(ctx.startAngles.rightHip, ctx.minAngles.rightHip);
      const maxLeanDrop = Math.max(Math.abs(leftDelta), Math.abs(rightDelta));
      return maxLeanDrop > OVERHEAD_PRESS_THRESHOLDS.excessiveLeanHipDeltaMax;
    },
    severity: 2,
    dynamicCue: 'Stay vertical — brace the core, no hip drive.',
    fqiPenalty: 10,
  },
  {
    id: 'asymmetric_press',
    displayName: 'Asymmetric Press',
    condition: (ctx: RepContext) => {
      return asymmetryCheck(
        ctx.maxAngles.leftElbow,
        ctx.maxAngles.rightElbow,
        OVERHEAD_PRESS_THRESHOLDS.asymmetricPressMaxPct
      );
    },
    severity: 1,
    dynamicCue: 'Press evenly — both elbows lock out at the same time.',
    fqiPenalty: 8,
  },
  {
    id: 'core_hyperextension',
    displayName: 'Core Hyperextension',
    condition: (ctx: RepContext) => {
      const maxHip = Math.max(ctx.maxAngles.leftHip, ctx.maxAngles.rightHip);
      if (!Number.isFinite(maxHip)) return false;
      return maxHip > OVERHEAD_PRESS_THRESHOLDS.coreHyperExtensionMax;
    },
    severity: 2,
    dynamicCue: 'Ribs down — stop arching the lower back to finish the rep.',
    fqiPenalty: 12,
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
): OverheadPressMetrics {
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
  currentPhase: OverheadPressPhase,
  _angles: JointAngles,
  metrics: OverheadPressMetrics
): OverheadPressPhase {
  if (!metrics.armsTracked) {
    return 'setup';
  }

  const elbow = metrics.avgElbow;

  switch (currentPhase) {
    case 'setup':
      if (elbow <= OVERHEAD_PRESS_THRESHOLDS.rackElbow) {
        return 'rack';
      }
      return 'setup';

    case 'rack':
      if (elbow >= OVERHEAD_PRESS_THRESHOLDS.pressStart) {
        return 'press';
      }
      return 'rack';

    case 'press':
      if (elbow >= OVERHEAD_PRESS_THRESHOLDS.lockoutElbow) {
        return 'lockout';
      }
      return 'press';

    case 'lockout':
      if (elbow <= OVERHEAD_PRESS_THRESHOLDS.loweringStart) {
        return 'lowering';
      }
      return 'lockout';

    case 'lowering':
      if (elbow <= OVERHEAD_PRESS_THRESHOLDS.rackElbow) {
        return 'rack';
      }
      return 'lowering';

    default:
      return 'setup';
  }
}

// =============================================================================
// Export Workout Definition
// =============================================================================

export const overheadPressDefinition: WorkoutDefinition<OverheadPressPhase, OverheadPressMetrics> = {
  id: 'overhead_press',
  displayName: 'Overhead Press',
  description: 'Standing vertical press targeting shoulders, triceps, and core stability.',
  category: 'upper_body',
  difficulty: 'intermediate',

  phases,
  initialPhase: 'setup',
  repBoundary,
  thresholds: OVERHEAD_PRESS_THRESHOLDS,
  angleRanges,
  scoringMetrics,
  faults,
  fqiWeights,

  ui: {
    iconName: 'arrow-up-outline',
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
        phaseId === 'lockout' &&
        typeof metrics.avgHip === 'number' &&
        metrics.avgHip > OVERHEAD_PRESS_THRESHOLDS.coreHyperExtensionMax
      ) {
        messages.push('Ribs down — stop arching the lower back.');
      }

      if (
        phaseId === 'press' &&
        typeof metrics.avgElbow === 'number' &&
        metrics.avgElbow < OVERHEAD_PRESS_THRESHOLDS.incompleteLockoutMin
      ) {
        messages.push('Punch through — arms straight at the top.');
      }

      if (messages.length === 0) {
        messages.push('Brace hard — vertical bar path, stay stacked.');
      }

      return messages;
    },
  },

  calculateMetrics,
  getNextPhase,
};

export default overheadPressDefinition;
