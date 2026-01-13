/**
 * Deadlift Workout Definition
 *
 * Defines all the logic for tracking conventional deadlift form:
 * - Phases: setup → address → pull → lockout → descent → address
 * - Rep boundaries: starts at 'pull', ends at 'lockout'
 * - Thresholds for hip and knee angles
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

export type DeadliftPhase = 'setup' | 'address' | 'pull' | 'lockout' | 'descent';

// =============================================================================
// Metrics Type
// =============================================================================

export interface DeadliftMetrics extends WorkoutMetrics {
  avgHip: number;
  avgKnee: number;
  avgShoulder: number;
  legsTracked: boolean;
}

// =============================================================================
// Thresholds
// =============================================================================

export const DEADLIFT_THRESHOLDS = {
  /** Fully standing (lockout position) */
  lockout: 165,
  /** Start position at the bar (address) */
  address: 120,
  /** Bottom position (bar at shins) */
  bottom: 85,
  /** Hip angle indicating full extension */
  hipExtended: 170,
  /** Starting to lower the bar */
  descentStart: 155,
  /** Shoulder angle for back position */
  shoulderNeutral: 90,
} as const;

// =============================================================================
// Angle Ranges
// =============================================================================

const angleRanges: Record<string, AngleRange> = {
  hip: {
    min: 70,      // Bottom position
    max: 180,     // Full lockout
    optimal: 80,  // Good starting position
    tolerance: 15,
  },
  knee: {
    min: 100,     // Slight bend at start
    max: 180,     // Locked out
    optimal: 120, // Address position
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

const phases: PhaseDefinition<DeadliftPhase>[] = [
  {
    id: 'setup',
    displayName: 'Setup',
    enterCondition: () => true,
    staticCue: 'Bar over mid-foot, shoulder blades over the bar, brace your core.',
  },
  {
    id: 'address',
    displayName: 'Address',
    enterCondition: (angles: JointAngles) => {
      const avgHip = (angles.leftHip + angles.rightHip) / 2;
      return avgHip <= DEADLIFT_THRESHOLDS.address && avgHip >= DEADLIFT_THRESHOLDS.bottom - 10;
    },
    staticCue: 'Wedge into the bar, take the slack out, and drive through the floor.',
  },
  {
    id: 'pull',
    displayName: 'Pulling',
    enterCondition: (angles: JointAngles, prevPhase: DeadliftPhase) => {
      const avgHip = (angles.leftHip + angles.rightHip) / 2;
      return prevPhase === 'address' && avgHip > DEADLIFT_THRESHOLDS.address;
    },
    staticCue: 'Push the floor away, keep your chest up.',
  },
  {
    id: 'lockout',
    displayName: 'Lockout',
    enterCondition: (angles: JointAngles, prevPhase: DeadliftPhase) => {
      const avgHip = (angles.leftHip + angles.rightHip) / 2;
      return (prevPhase === 'pull' || prevPhase === 'descent') && avgHip >= DEADLIFT_THRESHOLDS.lockout;
    },
    staticCue: 'Squeeze your glutes at the top, stand tall.',
  },
  {
    id: 'descent',
    displayName: 'Descending',
    enterCondition: (angles: JointAngles, prevPhase: DeadliftPhase) => {
      const avgHip = (angles.leftHip + angles.rightHip) / 2;
      return prevPhase === 'lockout' && avgHip <= DEADLIFT_THRESHOLDS.descentStart;
    },
    staticCue: 'Hinge at the hips, control the bar down.',
  },
];

// =============================================================================
// Rep Boundary
// =============================================================================

const repBoundary: RepBoundary<DeadliftPhase> = {
  startPhase: 'pull',
  endPhase: 'lockout',
  minDurationMs: 800,
};

// =============================================================================
// Fault Definitions
// =============================================================================

const faults: FaultDefinition[] = [
  {
    id: 'incomplete_lockout',
    displayName: 'Incomplete Lockout',
    condition: (ctx: RepContext) => {
      const maxHip = (ctx.maxAngles.leftHip + ctx.maxAngles.rightHip) / 2;
      return maxHip < DEADLIFT_THRESHOLDS.lockout - 10;
    },
    severity: 2,
    dynamicCue: 'Finish each rep with full hip extension.',
    fqiPenalty: 12,
  },
  {
    id: 'rounded_back',
    displayName: 'Rounded Back',
    condition: (ctx: RepContext) => {
      // If shoulders are significantly behind hips during pull, indicates rounding
      const maxShoulder = Math.max(ctx.maxAngles.leftShoulder, ctx.maxAngles.rightShoulder);
      return maxShoulder > 120;
    },
    severity: 3,
    dynamicCue: 'Keep your back flat — don\'t round your spine.',
    fqiPenalty: 20,
  },
  {
    id: 'hips_rise_first',
    displayName: 'Hips Rise First',
    condition: (ctx: RepContext) => {
      // If hip angle increases significantly before knee angle
      // This is a simplified check - ideally would track velocity
      const hipChange = ctx.maxAngles.leftHip - ctx.startAngles.leftHip;
      const kneeChange = ctx.maxAngles.leftKnee - ctx.startAngles.leftKnee;
      return hipChange > kneeChange + 30;
    },
    severity: 2,
    dynamicCue: 'Drive with your legs — don\'t let your hips shoot up first.',
    fqiPenalty: 10,
  },
  {
    id: 'asymmetric_pull',
    displayName: 'Asymmetric Pull',
    condition: (ctx: RepContext) => {
      const hipDiff = Math.abs(ctx.maxAngles.leftHip - ctx.maxAngles.rightHip);
      return hipDiff > 20;
    },
    severity: 1,
    dynamicCue: 'Keep the bar level — pull evenly on both sides.',
    fqiPenalty: 8,
  },
  {
    id: 'fast_descent',
    displayName: 'Uncontrolled Descent',
    condition: (ctx: RepContext) => ctx.durationMs < 1200,
    severity: 1,
    dynamicCue: 'Control the descent — don\'t drop the weight.',
    fqiPenalty: 5,
  },
];

// =============================================================================
// FQI Weights
// =============================================================================

const fqiWeights: FQIWeights = {
  rom: 0.25,    // Range of motion contributes 25%
  depth: 0.30,  // Starting position depth contributes 30%
  faults: 0.45, // Faults are critical for deadlift safety - 45%
};

// =============================================================================
// Metrics Calculator
// =============================================================================

function calculateMetrics(
  angles: JointAngles,
  _joints?: Map<string, { x: number; y: number; isTracked: boolean }>
): DeadliftMetrics {
  const avgHip = (angles.leftHip + angles.rightHip) / 2;
  const avgKnee = (angles.leftKnee + angles.rightKnee) / 2;
  const avgShoulder = (angles.leftShoulder + angles.rightShoulder) / 2;

  const legsTracked =
    angles.leftHip > 0 && angles.leftHip < 180 &&
    angles.rightHip > 0 && angles.rightHip < 180 &&
    angles.leftKnee > 0 && angles.leftKnee < 180 &&
    angles.rightKnee > 0 && angles.rightKnee < 180;

  return {
    avgHip,
    avgKnee,
    avgShoulder,
    legsTracked,
  };
}

// =============================================================================
// Phase State Machine
// =============================================================================

function getNextPhase(
  currentPhase: DeadliftPhase,
  _angles: JointAngles,
  metrics: DeadliftMetrics
): DeadliftPhase {
  if (!metrics.legsTracked) {
    return 'setup';
  }

  const hip = metrics.avgHip;

  switch (currentPhase) {
    case 'setup':
      if (hip <= DEADLIFT_THRESHOLDS.address) {
        return 'address';
      }
      if (hip >= DEADLIFT_THRESHOLDS.lockout) {
        return 'lockout';
      }
      return 'setup';

    case 'address':
      if (hip > DEADLIFT_THRESHOLDS.address) {
        return 'pull';
      }
      return 'address';

    case 'pull':
      if (hip >= DEADLIFT_THRESHOLDS.lockout) {
        return 'lockout';
      }
      if (hip <= DEADLIFT_THRESHOLDS.bottom) {
        return 'address';
      }
      return 'pull';

    case 'lockout':
      if (hip <= DEADLIFT_THRESHOLDS.descentStart) {
        return 'descent';
      }
      return 'lockout';

    case 'descent':
      if (hip <= DEADLIFT_THRESHOLDS.address) {
        return 'address';
      }
      if (hip >= DEADLIFT_THRESHOLDS.lockout) {
        return 'lockout';
      }
      return 'descent';

    default:
      return 'setup';
  }
}

// =============================================================================
// Export Workout Definition
// =============================================================================

export const deadliftDefinition: WorkoutDefinition<DeadliftPhase, DeadliftMetrics> = {
  id: 'deadlift',
  displayName: 'Deadlift',
  description: 'Posterior chain compound lift targeting hamstrings, glutes, back, and grip.',
  category: 'lower_body',
  difficulty: 'intermediate',

  phases,
  initialPhase: 'setup',
  repBoundary,
  thresholds: DEADLIFT_THRESHOLDS,
  angleRanges,
  scoringMetrics,
  faults,
  fqiWeights,

  ui: {
    iconName: 'barbell-outline',
    primaryMetric: { key: 'avgHipDeg', label: 'Avg Hip', format: 'deg' },
    secondaryMetric: { key: 'avgKneeDeg', label: 'Avg Knee', format: 'deg' },
    buildUploadMetrics: (metrics) => ({
      avgHipDeg: metrics?.avgHip ?? null,
      avgKneeDeg: metrics?.avgKnee ?? null,
      avgShoulderDeg: metrics?.avgShoulder ?? null,
    }),
    buildWatchMetrics: (metrics) => ({
      avgHipDeg: metrics?.avgHip ?? null,
      avgKneeDeg: metrics?.avgKnee ?? null,
    }),
    getRealtimeCues: ({ phaseId, metrics }) => {
      const messages: string[] = [];
      const lockoutThreshold = DEADLIFT_THRESHOLDS.lockout;

      const avgHip = metrics.avgHip;

      if (phaseId === 'lockout' && typeof avgHip === 'number' && avgHip < lockoutThreshold - 10) {
        messages.push('Finish each rep with full hip extension.');
      }

      if (phaseId === 'pull' && typeof avgHip === 'number') {
        messages.push('Push the floor away, keep your chest up.');
      }

      if (messages.length === 0) {
        messages.push('Controlled power — brace and drive.');
      }

      return messages;
    },
  },

  calculateMetrics,
  getNextPhase,
};

export default deadliftDefinition;
