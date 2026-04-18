/**
 * Between-Sets Coach Service
 *
 * Pure content-composition layer that combines a breathing pattern,
 * a mobility drill, and a reflection prompt into a single
 * `BetweenSetsRecommendation` tailored to the just-completed set.
 * No network, no storage, no React — deterministic and fully testable.
 */

import type { SetType } from '@/lib/types/workout-session';
import {
  BreathingPattern,
  pickBreathingPattern,
} from './breathing-patterns';
import {
  MobilityDrill,
  MobilityDrillId,
  pickMobilityDrill,
} from './mobility-drills';

export type ReflectionCategory = 'form' | 'breathing' | 'mindset' | 'progress';

export interface ReflectionPrompt {
  id: string;
  text: string;
  category: ReflectionCategory;
}

export const REFLECTION_PROMPTS: readonly ReflectionPrompt[] = [
  { id: 'form-bracing', text: 'How tight was your brace before the first rep?', category: 'form' },
  { id: 'form-bar-path', text: 'Did the bar stay over mid-foot across every rep?', category: 'form' },
  { id: 'form-tempo', text: 'Were your reps the same speed from first to last?', category: 'form' },
  {
    id: 'form-rom',
    text: 'Did you hit the same depth or range on every rep?',
    category: 'form',
  },
  { id: 'breath-reset', text: 'Let the next breath in be slower than the last.', category: 'breathing' },
  {
    id: 'breath-exhale',
    text: 'Lengthen your exhale — heart rate comes down faster.',
    category: 'breathing',
  },
  { id: 'mindset-focus', text: 'Pick one cue to execute on the next set.', category: 'mindset' },
  {
    id: 'mindset-reset',
    text: 'Name one thing that felt strong — anchor to it next set.',
    category: 'mindset',
  },
  {
    id: 'mindset-composure',
    text: 'Feel your feet. Ground through the floor before standing up.',
    category: 'mindset',
  },
  { id: 'progress-prev', text: 'How did this set compare to last week?', category: 'progress' },
  {
    id: 'progress-final',
    text: 'What made this session move forward from the last?',
    category: 'progress',
  },
] as const;

export interface BetweenSetsRecommendation {
  breathing: BreathingPattern;
  mobility: MobilityDrill;
  reflection: ReflectionPrompt;
  fatigueScore: number;
  context: {
    setType: SetType;
    setIndex: number;
    totalSets: number;
    restSeconds: number;
    muscleGroup: string | null;
  };
}

export interface FatigueScoreInput {
  setType: SetType;
  setIndex: number;
  totalSets: number;
  plannedReps: number | null;
  actualReps: number | null;
  perceivedRpe?: number | null;
}

export function computeFatigueScore(input: FatigueScoreInput): number {
  const { setType, setIndex, totalSets, plannedReps, actualReps, perceivedRpe } = input;

  let score = 0;

  if (totalSets > 0) {
    score += Math.min(0.4, (setIndex / totalSets) * 0.4);
  }

  if (setType === 'failure') {
    score += 0.4;
  } else if (setType === 'dropset' || setType === 'amrap') {
    score += 0.2;
  }

  if (plannedReps != null && actualReps != null && plannedReps > 0 && actualReps < plannedReps) {
    const shortfall = (plannedReps - actualReps) / plannedReps;
    score += Math.min(0.3, shortfall * 0.5);
  }

  if (perceivedRpe != null) {
    const rpe = Math.max(1, Math.min(10, perceivedRpe));
    const rpeComponent = ((rpe - 5) / 5) * 0.3;
    score += Math.max(0, rpeComponent);
  }

  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(1, score));
}

export interface PickReflectionInput {
  setType: SetType;
  setIndex: number;
  totalSets: number;
  fatigueScore: number;
  previouslyShownIds?: readonly string[];
}

function promptsByCategory(category: ReflectionCategory): readonly ReflectionPrompt[] {
  return REFLECTION_PROMPTS.filter((p) => p.category === category);
}

function firstAvailable(
  prompts: readonly ReflectionPrompt[],
  exclude: Set<string>,
): ReflectionPrompt | undefined {
  return prompts.find((p) => !exclude.has(p.id));
}

export function pickReflectionPrompt(input: PickReflectionInput): ReflectionPrompt {
  const exclude = new Set(input.previouslyShownIds ?? []);

  const isWarmup = input.setType === 'warmup';
  const isFailure = input.setType === 'failure' || input.fatigueScore >= 0.75;
  const isLastSet = input.totalSets > 0 && input.setIndex >= input.totalSets - 1;
  const isMidSession = !isWarmup && !isFailure && !isLastSet;

  const order: ReflectionCategory[] = isFailure
    ? ['mindset', 'breathing', 'form', 'progress']
    : isWarmup
      ? ['form', 'breathing', 'mindset', 'progress']
      : isLastSet
        ? ['progress', 'mindset', 'form', 'breathing']
        : ['form', 'mindset', 'breathing', 'progress'];

  for (const category of order) {
    const prompt = firstAvailable(promptsByCategory(category), exclude);
    if (prompt) return prompt;
  }

  if (isMidSession) {
    return REFLECTION_PROMPTS[0];
  }
  return REFLECTION_PROMPTS[0];
}

export interface BuildRecommendationInput {
  setType: SetType;
  setIndex: number;
  totalSets: number;
  restSeconds: number;
  muscleGroup: string | null;
  plannedReps: number | null;
  actualReps: number | null;
  perceivedRpe?: number | null;
  previouslyShownMobilityIds?: readonly MobilityDrillId[];
  previouslyShownReflectionIds?: readonly string[];
}

export function buildBetweenSetsRecommendation(
  input: BuildRecommendationInput,
): BetweenSetsRecommendation {
  const fatigueScore = computeFatigueScore({
    setType: input.setType,
    setIndex: input.setIndex,
    totalSets: input.totalSets,
    plannedReps: input.plannedReps,
    actualReps: input.actualReps,
    perceivedRpe: input.perceivedRpe,
  });

  const breathing = pickBreathingPattern({
    setType: input.setType,
    setIndex: input.setIndex,
    totalSets: input.totalSets,
    restSeconds: input.restSeconds,
    fatigueScore,
  });

  const mobility = pickMobilityDrill({
    muscleGroup: input.muscleGroup,
    restSeconds: input.restSeconds,
    previouslyShownIds: input.previouslyShownMobilityIds,
  });

  const reflection = pickReflectionPrompt({
    setType: input.setType,
    setIndex: input.setIndex,
    totalSets: input.totalSets,
    fatigueScore,
    previouslyShownIds: input.previouslyShownReflectionIds,
  });

  return {
    breathing,
    mobility,
    reflection,
    fatigueScore,
    context: {
      setType: input.setType,
      setIndex: input.setIndex,
      totalSets: input.totalSets,
      restSeconds: input.restSeconds,
      muscleGroup: input.muscleGroup,
    },
  };
}
