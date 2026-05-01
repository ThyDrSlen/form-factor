import type {
  ExerciseHistoryEntry,
  ExercisePersonalRecords,
} from '@/lib/services/database/local-db';
import type { Exercise } from '@/lib/types/workout-session';
import { buildProgressiveOverloadHelperText } from '@/lib/services/workout-insights-helpers';

type ExerciseLike = Pick<Exercise, 'id' | 'name' | 'is_timed'>;

export interface DetectPRInput {
  exercise?: ExerciseLike | null;
  personalRecords?: ExercisePersonalRecords | null;
  currentWeight?: number | null;
  currentReps?: number | null;
  currentSeconds?: number | null;
}

export interface SuggestedWeightInput {
  exercise?: ExerciseLike | null;
  history: ExerciseHistoryEntry[];
  unit?: string | null;
}

export type ProgressiveOverloadPrType = 'weight' | 'volume' | 'reps';

export interface DetectPRResult {
  isPR: boolean;
  prType: ProgressiveOverloadPrType | null;
  previousBest: number | null;
}

export interface SuggestedWeightResult {
  weight: number;
  reps: number;
  unit: string;
  source: 'previous_session' | 'no_history';
}

export interface ProgressiveOverloadSuggestion {
  exerciseId: string;
  lastSessionWeight: number | null;
  suggestedWeight: number | null;
  suggestedReps: number | null;
  suggestedUnit: string | null;
  suggestionSource: SuggestedWeightResult['source'] | null;
  helperText: string;
  isTimed: boolean;
  isBodyweightLike: boolean;
}

export interface BuildProgressiveOverloadSuggestionInput {
  exercise?: ExerciseLike | null;
  history: ExerciseHistoryEntry[];
  personalRecords?: ExercisePersonalRecords | null;
  unit?: string | null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function latestSessionRows(history: ExerciseHistoryEntry[]): ExerciseHistoryEntry[] {
  const latestSessionId = history[0]?.session_id;
  if (!latestSessionId) return [];
  return history.filter((row) => row.session_id === latestSessionId);
}

function getLastSessionReps(history: ExerciseHistoryEntry[]): number | null {
  const latestRows = latestSessionRows(history);
  for (const row of latestRows) {
    if (isFiniteNumber(row.actual_reps)) {
      return row.actual_reps;
    }
  }

  return null;
}

export function getLastSessionWeight(history: ExerciseHistoryEntry[]): number | null {
  const latestRows = latestSessionRows(history);
  for (const row of latestRows) {
    if (isFiniteNumber(row.actual_weight)) {
      return row.actual_weight;
    }
  }

  for (const row of latestRows) {
    if (isFiniteNumber(row.planned_weight)) {
      return row.planned_weight;
    }
  }

  return null;
}

export function detectPR({
  exercise,
  personalRecords,
  currentWeight,
  currentReps,
  currentSeconds,
}: DetectPRInput): DetectPRResult {
  if (!personalRecords) {
    return {
      isPR: false,
      prType: null,
      previousBest: null,
    };
  }

  if (exercise?.is_timed) {
    const previousBest = isFiniteNumber(personalRecords.maxDurationSeconds)
      ? personalRecords.maxDurationSeconds
      : null;

    return {
      isPR: isFiniteNumber(currentSeconds)
        && isFiniteNumber(personalRecords.maxDurationSeconds)
        && currentSeconds > personalRecords.maxDurationSeconds,
      prType: null,
      previousBest,
    };
  }

  if (isFiniteNumber(currentWeight)) {
    if (isFiniteNumber(personalRecords.maxWeight) && currentWeight > personalRecords.maxWeight) {
      return {
        isPR: true,
        prType: 'weight',
        previousBest: personalRecords.maxWeight,
      };
    }

    if (
      isFiniteNumber(currentReps)
      && isFiniteNumber(personalRecords.maxVolume)
    ) {
      const currentVolume = currentWeight * currentReps;
      const previousBest = personalRecords.maxVolume;
      if (currentVolume > previousBest) {
        return {
          isPR: true,
          prType: 'volume',
          previousBest,
        };
      }
    }
  }

  if (isFiniteNumber(currentReps) && isFiniteNumber(personalRecords.maxReps)) {
    return {
      isPR: currentReps > personalRecords.maxReps,
      prType: currentReps > personalRecords.maxReps ? 'reps' : null,
      previousBest: personalRecords.maxReps,
    };
  }

  return {
    isPR: false,
    prType: null,
    previousBest: null,
  };
}

export function getSuggestedWeight({
  exercise,
  history,
  unit,
}: SuggestedWeightInput): SuggestedWeightResult | null {
  const resolvedUnit = typeof unit === 'string' && unit.trim().length > 0 ? unit : 'lb';

  if (exercise?.is_timed) {
    return null;
  }

  const lastSessionWeight = getLastSessionWeight(history);
  const lastSessionReps = getLastSessionReps(history);

  if (isFiniteNumber(lastSessionWeight) || isFiniteNumber(lastSessionReps)) {
    return {
      weight: isFiniteNumber(lastSessionWeight) ? lastSessionWeight : 0,
      reps: isFiniteNumber(lastSessionReps) ? lastSessionReps : 0,
      unit: resolvedUnit,
      source: 'previous_session',
    };
  }

  return {
    weight: 0,
    reps: 0,
    unit: resolvedUnit,
    source: 'no_history',
  };
}

export function buildProgressiveOverloadSuggestion({
  exercise,
  history,
  personalRecords,
  unit,
}: BuildProgressiveOverloadSuggestionInput): ProgressiveOverloadSuggestion {
  const lastSessionWeight = getLastSessionWeight(history);
  const suggestedWeight = getSuggestedWeight({ exercise, history, unit });
  const isSuggestedLoad = suggestedWeight?.source === 'previous_session' && suggestedWeight.weight > 0;
  const isTimed = Boolean(exercise?.is_timed);
  const isBodyweightLike = !isTimed && !isFiniteNumber(lastSessionWeight);
  const helperText = buildProgressiveOverloadHelperText({
    lastSessionWeight,
    suggestedWeight: isSuggestedLoad ? suggestedWeight.weight : null,
    unit,
    isTimed,
    isBodyweight: isBodyweightLike,
    didHitPr: false,
    hasHistory: history.length > 0 || Boolean(personalRecords),
  });

  return {
    exerciseId: exercise?.id ?? history[0]?.exercise_id ?? '',
    lastSessionWeight,
    suggestedWeight: isSuggestedLoad ? suggestedWeight.weight : null,
    suggestedReps: suggestedWeight?.reps ?? null,
    suggestedUnit: suggestedWeight?.unit ?? unit ?? null,
    suggestionSource: suggestedWeight?.source ?? null,
    helperText,
    isTimed,
    isBodyweightLike,
  };
}
