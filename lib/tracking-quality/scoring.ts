import type { CanonicalJoint2D, CanonicalJointMap } from '@/lib/pose/types';
import { CONFIDENCE_TIER_THRESHOLDS } from './config';
import {
  areRequiredJointsVisible,
  getVisibilityTier,
  type RequiredJointSpec,
  type VisibilityTier,
  PULLUP_CRITICAL_JOINTS,
} from './visibility';

export type VisibilityBadge = 'full' | 'partial';

export type PullupScoreComponents = {
  rom_score: number | null;
  symmetry_score: number | null;
  tempo_score: number | null;
  torso_stability_score: number | null;
};

export type PullupComponentKey = keyof PullupScoreComponents;

export type PullupComponentAvailability = {
  available: boolean;
  required_joints: RequiredJointSpec[];
  min_visibility_tier: Exclude<VisibilityTier, 'missing'>;
  visibility_tier: VisibilityTier;
  reason?: string;
};

export type PullupComponentAvailabilityMap = Record<PullupComponentKey, PullupComponentAvailability>;

export type PullupScoringInput = {
  repAngles: {
    start: { leftElbow: number; rightElbow: number; leftShoulder: number; rightShoulder: number };
    end: { leftElbow: number; rightElbow: number; leftShoulder: number; rightShoulder: number };
    min: { leftElbow: number; rightElbow: number; leftShoulder: number; rightShoulder: number };
    max: { leftElbow: number; rightElbow: number; leftShoulder: number; rightShoulder: number };
  };
  durationMs: number;
  joints?: CanonicalJointMap | Record<string, CanonicalJoint2D | null | undefined> | null;
};

export type PullupScoringResult = {
  overall_score: number | null;
  components: PullupScoreComponents;
  components_available: PullupComponentAvailabilityMap;
  missing_components: PullupComponentKey[];
  missing_reasons: string[];
  visibility_badge: VisibilityBadge;
  score_suppressed: boolean;
  suppression_reason: string | null;
};

type PullupComponentDefinition = {
  key: PullupComponentKey;
  weight: number;
  requiredJoints: RequiredJointSpec[];
  minVisibilityTier: Exclude<VisibilityTier, 'missing'>;
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function emptyComponents(): PullupScoreComponents {
  return {
    rom_score: null,
    symmetry_score: null,
    tempo_score: null,
    torso_stability_score: null,
  };
}

function getJointFrom(input: PullupScoringInput['joints'], key: string): CanonicalJoint2D | null | undefined {
  if (!input) return undefined;
  if (input instanceof Map) {
    return input.get(key);
  }
  return input[key];
}

function jointVisibilityScore(joint: CanonicalJoint2D | null | undefined): number {
  if (!joint || !joint.isTracked) return 0;
  if (typeof joint.confidence === 'number') return clamp01(joint.confidence);
  return 1;
}

function minConfidenceForTier(tier: Exclude<VisibilityTier, 'missing'>): number {
  return tier === 'trusted' ? CONFIDENCE_TIER_THRESHOLDS.medium : CONFIDENCE_TIER_THRESHOLDS.low;
}

function visibilityScoreForSpec(joints: PullupScoringInput['joints'], spec: RequiredJointSpec): number {
  if (typeof spec === 'string') {
    return jointVisibilityScore(getJointFrom(joints, spec));
  }
  let best = 0;
  for (const key of spec) {
    best = Math.max(best, jointVisibilityScore(getJointFrom(joints, key)));
  }
  return best;
}

function visibilityTierForRequiredJoints(
  joints: PullupScoringInput['joints'],
  required: RequiredJointSpec[],
): VisibilityTier {
  if (!joints) return 'missing';
  let worst = 1;
  for (const spec of required) {
    worst = Math.min(worst, visibilityScoreForSpec(joints, spec));
  }
  return getVisibilityTier(worst);
}

function missingReasonForRequiredJoints(input: {
  joints: PullupScoringInput['joints'];
  required: RequiredJointSpec[];
  minVisibilityTier: Exclude<VisibilityTier, 'missing'>;
}): string {
  if (!input.joints) {
    return 'No joints provided';
  }

  const minConfidence = minConfidenceForTier(input.minVisibilityTier);
  const missing: string[] = [];

  for (const spec of input.required) {
    if (typeof spec === 'string') {
      const joint = getJointFrom(input.joints, spec);
      if (jointVisibilityScore(joint) < minConfidence) {
        missing.push(spec);
      }
      continue;
    }

    const best = visibilityScoreForSpec(input.joints, spec);
    if (best < minConfidence) {
      missing.push(`[${spec.join('|')}]`);
    }
  }

  if (missing.length === 0) {
    return `Required joints below min tier: ${input.minVisibilityTier}`;
  }

  return `Missing required joints at tier ${input.minVisibilityTier}: ${missing.join(', ')}`;
}

const PULLUP_COMPONENT_DEFS: PullupComponentDefinition[] = [
  {
    key: 'rom_score',
    weight: 0.4,
    requiredJoints: [PULLUP_CRITICAL_JOINTS[2], PULLUP_CRITICAL_JOINTS[3]],
    minVisibilityTier: 'weak',
  },
  {
    key: 'symmetry_score',
    weight: 0.15,
    requiredJoints: PULLUP_CRITICAL_JOINTS,
    minVisibilityTier: 'weak',
  },
  {
    key: 'tempo_score',
    weight: 0.3,
    requiredJoints: PULLUP_CRITICAL_JOINTS,
    minVisibilityTier: 'trusted',
  },
  {
    key: 'torso_stability_score',
    weight: 0.15,
    requiredJoints: [PULLUP_CRITICAL_JOINTS[0], PULLUP_CRITICAL_JOINTS[1]],
    minVisibilityTier: 'weak',
  },
];

const PULLUP_ELBOW_ROM_TARGET_DEG = 100;
const PULLUP_TEMPO_FAST_MS = 800;
const PULLUP_TEMPO_SOLID_MS = 1200;
const PULLUP_SHOULDER_ELEVATION_THRESHOLD_DEG = 120;
const SINGLE_COMPONENT_WEAK_MULTIPLIER = 0.35;
const SINGLE_COMPONENT_TRUSTED_MULTIPLIER = 0.65;

function calculateRomComponentScore(input: PullupScoringInput): number {
  const avgMinElbow = (input.repAngles.min.leftElbow + input.repAngles.min.rightElbow) / 2;
  const avgMaxElbow = (input.repAngles.max.leftElbow + input.repAngles.max.rightElbow) / 2;
  const actualRom = Math.abs(avgMaxElbow - avgMinElbow);
  return clamp((actualRom / PULLUP_ELBOW_ROM_TARGET_DEG) * 100, 0, 100);
}

function calculateTempoComponentScore(input: PullupScoringInput): number {
  const score =
    ((input.durationMs - PULLUP_TEMPO_FAST_MS) / (PULLUP_TEMPO_SOLID_MS - PULLUP_TEMPO_FAST_MS)) * 100;
  return clamp(score, 0, 100);
}

function calculateSymmetryComponentScore(input: PullupScoringInput): number {
  const diff = Math.abs(input.repAngles.min.leftElbow - input.repAngles.min.rightElbow);
  return clamp(100 - diff * 4, 0, 100);
}

function calculateTorsoStabilityComponentScore(input: PullupScoringInput): number {
  const maxShoulder = Math.max(input.repAngles.max.leftShoulder, input.repAngles.max.rightShoulder);
  const excess = Math.max(0, maxShoulder - PULLUP_SHOULDER_ELEVATION_THRESHOLD_DEG);
  return clamp(100 - excess * 2, 0, 100);
}

function calculateComponentScore(key: PullupComponentKey, input: PullupScoringInput): number {
  switch (key) {
    case 'rom_score':
      return calculateRomComponentScore(input);
    case 'symmetry_score':
      return calculateSymmetryComponentScore(input);
    case 'tempo_score':
      return calculateTempoComponentScore(input);
    case 'torso_stability_score':
      return calculateTorsoStabilityComponentScore(input);
    default: {
      const _exhaustive: never = key;
      return _exhaustive;
    }
  }
}

export function calculateComponentScores(input: PullupScoringInput): {
  components: PullupScoreComponents;
  availability: PullupComponentAvailabilityMap;
  missing_components: PullupComponentKey[];
  missing_reasons: string[];
  visibility_badge: VisibilityBadge;
} {
  const components: PullupScoreComponents = emptyComponents();
  const availability = {} as PullupComponentAvailabilityMap;
  const missing_components: PullupComponentKey[] = [];
  const missing_reasons: string[] = [];

  for (const def of PULLUP_COMPONENT_DEFS) {
    const minConfidence = minConfidenceForTier(def.minVisibilityTier);
    const isAvailable = areRequiredJointsVisible(input.joints ?? null, def.requiredJoints, minConfidence);
    const visibilityTier = visibilityTierForRequiredJoints(input.joints ?? null, def.requiredJoints);

    if (!isAvailable) {
      const reason = missingReasonForRequiredJoints({
        joints: input.joints ?? null,
        required: def.requiredJoints,
        minVisibilityTier: def.minVisibilityTier,
      });
      availability[def.key] = {
        available: false,
        required_joints: def.requiredJoints,
        min_visibility_tier: def.minVisibilityTier,
        visibility_tier: visibilityTier,
        reason,
      };
      missing_components.push(def.key);
      missing_reasons.push(`${def.key}: ${reason}`);
      continue;
    }

    const score = calculateComponentScore(def.key, input);
    components[def.key] = Math.round(clamp(score, 0, 100));
    availability[def.key] = {
      available: true,
      required_joints: def.requiredJoints,
      min_visibility_tier: def.minVisibilityTier,
      visibility_tier: visibilityTier,
    };
  }

  return {
    components,
    availability,
    missing_components,
    missing_reasons,
    visibility_badge: missing_components.length === 0 ? 'full' : 'partial',
  };
}

export function calculateOverallScore(input: {
  components: PullupScoreComponents;
  availability: PullupComponentAvailabilityMap;
}): { overall_score: number | null; score_suppressed: boolean; suppression_reason: string | null } {
  let weightedSum = 0;
  let weightTotal = 0;
  const availableKeys: PullupComponentKey[] = [];

  for (const def of PULLUP_COMPONENT_DEFS) {
    const value = input.components[def.key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      continue;
    }

    weightedSum += value * def.weight;
    weightTotal += def.weight;
    availableKeys.push(def.key);
  }

  if (weightTotal <= 0) {
    return { overall_score: null, score_suppressed: true, suppression_reason: 'No components available' };
  }

  const raw = clamp(weightedSum / weightTotal, 0, 100);

  if (availableKeys.length === 1) {
    const only = availableKeys[0];
    const tier = input.availability[only]?.visibility_tier ?? 'missing';
    if (tier !== 'trusted') {
      return {
        overall_score: Math.round(raw * SINGLE_COMPONENT_WEAK_MULTIPLIER),
        score_suppressed: true,
        suppression_reason: `Only one weak component available: ${only}`,
      };
    }

    return {
      overall_score: Math.round(raw * SINGLE_COMPONENT_TRUSTED_MULTIPLIER),
      score_suppressed: true,
      suppression_reason: `Only one component available: ${only}`,
    };
  }

  return { overall_score: Math.round(raw), score_suppressed: false, suppression_reason: null };
}

export function scorePullupWithComponentAvailability(input: PullupScoringInput): PullupScoringResult {
  const { components, availability, missing_components, missing_reasons, visibility_badge } =
    calculateComponentScores(input);
  const overall = calculateOverallScore({ components, availability });

  return {
    overall_score: overall.overall_score,
    components,
    components_available: availability,
    missing_components,
    missing_reasons,
    visibility_badge,
    score_suppressed: overall.score_suppressed,
    suppression_reason: overall.suppression_reason,
  };
}
