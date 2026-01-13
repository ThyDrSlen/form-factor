/**
 * Farmers Walk Workout Definition
 *
 * Defines all the logic for tracking farmers walk form:
 * - Phases: setup → pickup → carry → set_down
 * - Rep boundaries: starts at 'pickup', ends at 'set_down'
 * - Focus on posture, shoulder position, and symmetry
 * - Fault detection for leaning, shoulder elevation, forward tilt
 * - FQI calculation weights
 *
 * Unlike other exercises, farmers walk is about maintaining proper
 * posture while moving, not about range of motion.
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

export type FarmersWalkPhase = 'setup' | 'pickup' | 'carry' | 'set_down';

// =============================================================================
// Metrics Type
// =============================================================================

export interface FarmersWalkMetrics extends WorkoutMetrics {
  avgShoulder: number;
  avgHip: number;
  shoulderSymmetry: number; // Difference between left and right shoulder
  hipSymmetry: number; // Difference between left and right hip
  armsTracked: boolean;
  legsTracked: boolean;
}

// =============================================================================
// Thresholds
// =============================================================================

export const FARMERS_WALK_THRESHOLDS = {
  /** Standing tall with weights (good posture) */
  standingHip: 165,
  /** Pickup/set down position (hip hinge) */
  hingeHip: 120,
  /** Shoulders should be back and down */
  shoulderNeutral: 95,
  /** Maximum acceptable shoulder asymmetry */
  shoulderAsymmetryMax: 15,
  /** Maximum acceptable hip asymmetry (lateral lean) */
  hipAsymmetryMax: 15,
  /** Shoulder elevation warning (shrugging) */
  shoulderElevated: 75,
} as const;

// =============================================================================
// Angle Ranges
// =============================================================================

const angleRanges: Record<string, AngleRange> = {
  shoulder: {
    min: 70,      // Slightly elevated
    max: 120,     // Shoulders back
    optimal: 90,  // Neutral position
    tolerance: 15,
  },
  hip: {
    min: 100,     // Pickup position
    max: 180,     // Standing tall
    optimal: 175, // Tall posture
    tolerance: 10,
  },
};

const scoringMetrics: ScoringMetricDefinition[] = [
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

const phases: PhaseDefinition<FarmersWalkPhase>[] = [
  {
    id: 'setup',
    displayName: 'Setup',
    enterCondition: () => true,
    staticCue: 'Stand between the weights, feet hip-width apart.',
  },
  {
    id: 'pickup',
    displayName: 'Pickup',
    enterCondition: (angles: JointAngles) => {
      const avgHip = (angles.leftHip + angles.rightHip) / 2;
      return avgHip <= FARMERS_WALK_THRESHOLDS.hingeHip;
    },
    staticCue: 'Hinge at hips, grip tight, brace your core.',
  },
  {
    id: 'carry',
    displayName: 'Carrying',
    enterCondition: (angles: JointAngles, prevPhase: FarmersWalkPhase) => {
      const avgHip = (angles.leftHip + angles.rightHip) / 2;
      return (prevPhase === 'pickup' || prevPhase === 'set_down') && 
             avgHip >= FARMERS_WALK_THRESHOLDS.standingHip;
    },
    staticCue: 'Stand tall, shoulders back, walk with purpose.',
  },
  {
    id: 'set_down',
    displayName: 'Setting Down',
    enterCondition: (angles: JointAngles, prevPhase: FarmersWalkPhase) => {
      const avgHip = (angles.leftHip + angles.rightHip) / 2;
      return prevPhase === 'carry' && avgHip <= FARMERS_WALK_THRESHOLDS.hingeHip;
    },
    staticCue: 'Hinge at hips to set down — don\'t round your back.',
  },
];

// =============================================================================
// Rep Boundary
// =============================================================================

const repBoundary: RepBoundary<FarmersWalkPhase> = {
  startPhase: 'pickup',
  endPhase: 'set_down',
  minDurationMs: 3000, // Farmers walks should be at least 3 seconds
};

// =============================================================================
// Fault Definitions
// =============================================================================

const faults: FaultDefinition[] = [
  {
    id: 'lateral_lean',
    displayName: 'Lateral Lean',
    condition: (ctx: RepContext) => {
      // Check for hip asymmetry during the carry
      const hipDiff = Math.abs(ctx.minAngles.leftHip - ctx.minAngles.rightHip);
      return hipDiff > FARMERS_WALK_THRESHOLDS.hipAsymmetryMax;
    },
    severity: 2,
    dynamicCue: 'Stay centered — don\'t lean to one side.',
    fqiPenalty: 12,
  },
  {
    id: 'shoulder_shrug',
    displayName: 'Shoulder Shrugging',
    condition: (ctx: RepContext) => {
      const minShoulder = Math.min(ctx.minAngles.leftShoulder, ctx.minAngles.rightShoulder);
      return minShoulder < FARMERS_WALK_THRESHOLDS.shoulderElevated;
    },
    severity: 2,
    dynamicCue: 'Drop your shoulders — pack them down.',
    fqiPenalty: 10,
  },
  {
    id: 'forward_lean',
    displayName: 'Forward Lean',
    condition: (ctx: RepContext) => {
      // If hips don't fully extend during carry, indicates forward lean
      const maxHip = (ctx.maxAngles.leftHip + ctx.maxAngles.rightHip) / 2;
      return maxHip < FARMERS_WALK_THRESHOLDS.standingHip - 15;
    },
    severity: 2,
    dynamicCue: 'Stand tall — don\'t hunch forward.',
    fqiPenalty: 12,
  },
  {
    id: 'asymmetric_shoulders',
    displayName: 'Uneven Shoulders',
    condition: (ctx: RepContext) => {
      const shoulderDiff = Math.abs(ctx.minAngles.leftShoulder - ctx.minAngles.rightShoulder);
      return shoulderDiff > FARMERS_WALK_THRESHOLDS.shoulderAsymmetryMax;
    },
    severity: 1,
    dynamicCue: 'Keep shoulders level — balance the load.',
    fqiPenalty: 8,
  },
  {
    id: 'short_carry',
    displayName: 'Short Carry Duration',
    condition: (ctx: RepContext) => ctx.durationMs < 5000,
    severity: 1,
    dynamicCue: 'Carry longer for better results.',
    fqiPenalty: 5,
  },
  {
    id: 'rushed_pickup',
    displayName: 'Rushed Pickup/Set Down',
    condition: (ctx: RepContext) => {
      // If rep is very short, likely rushed the transitions
      return ctx.durationMs < 3000;
    },
    severity: 1,
    dynamicCue: 'Control the pickup and set down.',
    fqiPenalty: 5,
  },
];

// =============================================================================
// FQI Weights
// =============================================================================

const fqiWeights: FQIWeights = {
  rom: 0.20,    // ROM less important for carries
  depth: 0.30,  // Posture quality during carry
  faults: 0.50, // Faults are critical for carry exercises - 50%
};

// =============================================================================
// Metrics Calculator
// =============================================================================

function calculateMetrics(
  angles: JointAngles,
  _joints?: Map<string, { x: number; y: number; isTracked: boolean }>
): FarmersWalkMetrics {
  const avgShoulder = (angles.leftShoulder + angles.rightShoulder) / 2;
  const avgHip = (angles.leftHip + angles.rightHip) / 2;
  const shoulderSymmetry = Math.abs(angles.leftShoulder - angles.rightShoulder);
  const hipSymmetry = Math.abs(angles.leftHip - angles.rightHip);

  const armsTracked =
    angles.leftShoulder > 0 && angles.leftShoulder < 180 &&
    angles.rightShoulder > 0 && angles.rightShoulder < 180;

  const legsTracked =
    angles.leftHip > 0 && angles.leftHip < 180 &&
    angles.rightHip > 0 && angles.rightHip < 180;

  return {
    avgShoulder,
    avgHip,
    shoulderSymmetry,
    hipSymmetry,
    armsTracked,
    legsTracked,
  };
}

// =============================================================================
// Phase State Machine
// =============================================================================

function getNextPhase(
  currentPhase: FarmersWalkPhase,
  _angles: JointAngles,
  metrics: FarmersWalkMetrics
): FarmersWalkPhase {
  if (!metrics.armsTracked || !metrics.legsTracked) {
    return 'setup';
  }

  const hip = metrics.avgHip;

  switch (currentPhase) {
    case 'setup':
      if (hip <= FARMERS_WALK_THRESHOLDS.hingeHip) {
        return 'pickup';
      }
      if (hip >= FARMERS_WALK_THRESHOLDS.standingHip) {
        return 'carry';
      }
      return 'setup';

    case 'pickup':
      if (hip >= FARMERS_WALK_THRESHOLDS.standingHip) {
        return 'carry';
      }
      return 'pickup';

    case 'carry':
      if (hip <= FARMERS_WALK_THRESHOLDS.hingeHip) {
        return 'set_down';
      }
      return 'carry';

    case 'set_down':
      if (hip >= FARMERS_WALK_THRESHOLDS.standingHip) {
        return 'carry';
      }
      // Stay in set_down until weights are picked up again or tracking lost
      return 'set_down';

    default:
      return 'setup';
  }
}

// =============================================================================
// Export Workout Definition
// =============================================================================

export const farmersWalkDefinition: WorkoutDefinition<FarmersWalkPhase, FarmersWalkMetrics> = {
  id: 'farmers_walk',
  displayName: 'Farmers Walk',
  description: 'Loaded carry exercise targeting grip, core stability, and total body conditioning.',
  category: 'full_body',
  difficulty: 'beginner',

  phases,
  initialPhase: 'setup',
  repBoundary,
  thresholds: FARMERS_WALK_THRESHOLDS,
  angleRanges,
  scoringMetrics,
  faults,
  fqiWeights,

  ui: {
    iconName: 'walk-outline',
    primaryMetric: { key: 'avgHipDeg', label: 'Posture', format: 'deg' },
    secondaryMetric: { key: 'shoulderSymmetryDeg', label: 'Balance', format: 'deg' },
    buildUploadMetrics: (metrics) => ({
      avgHipDeg: metrics?.avgHip ?? null,
      avgShoulderDeg: metrics?.avgShoulder ?? null,
      shoulderSymmetryDeg: metrics?.shoulderSymmetry ?? null,
      hipSymmetryDeg: metrics?.hipSymmetry ?? null,
    }),
    buildWatchMetrics: (metrics) => ({
      avgHipDeg: metrics?.avgHip ?? null,
      shoulderSymmetryDeg: metrics?.shoulderSymmetry ?? null,
    }),
    getRealtimeCues: ({ phaseId, metrics }) => {
      const messages: string[] = [];
      const shoulderAsymmetryMax = FARMERS_WALK_THRESHOLDS.shoulderAsymmetryMax;
      const hipAsymmetryMax = FARMERS_WALK_THRESHOLDS.hipAsymmetryMax;
      const standingHip = FARMERS_WALK_THRESHOLDS.standingHip;

      const shoulderSymmetry = metrics.shoulderSymmetry;
      const hipSymmetry = metrics.hipSymmetry;
      const avgHip = metrics.avgHip;

      if (phaseId === 'carry') {
        if (typeof shoulderSymmetry === 'number' && shoulderSymmetry > shoulderAsymmetryMax) {
          messages.push('Keep shoulders level — balance the load.');
        }

        if (typeof hipSymmetry === 'number' && hipSymmetry > hipAsymmetryMax) {
          messages.push('Stay centered — don\'t lean to one side.');
        }

        if (typeof avgHip === 'number' && avgHip < standingHip - 10) {
          messages.push('Stand tall — don\'t hunch forward.');
        }
      }

      if (messages.length === 0) {
        if (phaseId === 'carry') {
          messages.push('Strong posture — own every step.');
        } else {
          messages.push('Brace your core, grip tight.');
        }
      }

      return messages;
    },
  },

  calculateMetrics,
  getNextPhase,
};

export default farmersWalkDefinition;
