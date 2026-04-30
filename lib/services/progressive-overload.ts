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
}

export interface ProgressiveOverloadSuggestion {
  exerciseId: string;
  lastSessionWeight: number | null;
  suggestedWeight: number | null;
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
}: DetectPRInput): boolean {
  if (!personalRecords) {
    return false;
  }

  if (exercise?.is_timed) {
    return isFiniteNumber(currentSeconds)
      && isFiniteNumber(personalRecords.maxDurationSeconds)
      && currentSeconds > personalRecords.maxDurationSeconds;
  }

  if (isFiniteNumber(currentWeight)) {
    return isFiniteNumber(personalRecords.maxWeight)
      && currentWeight > personalRecords.maxWeight;
  }

  return isFiniteNumber(currentReps)
    && isFiniteNumber(personalRecords.maxReps)
    && currentReps > personalRecords.maxReps;
}

export function getSuggestedWeight({
  exercise,
  history,
}: SuggestedWeightInput): number | null {
  if (exercise?.is_timed) {
    return null;
  }

  const lastSessionWeight = getLastSessionWeight(history);
  return isFiniteNumber(lastSessionWeight) ? lastSessionWeight : null;
}

export function buildProgressiveOverloadSuggestion({
  exercise,
  history,
  personalRecords,
  unit,
}: BuildProgressiveOverloadSuggestionInput): ProgressiveOverloadSuggestion {
  const lastSessionWeight = getLastSessionWeight(history);
  const suggestedWeight = getSuggestedWeight({ exercise, history });
  const isTimed = Boolean(exercise?.is_timed);
  const isBodyweightLike = !isTimed && !isFiniteNumber(lastSessionWeight);
  const helperText = buildProgressiveOverloadHelperText({
    lastSessionWeight,
    suggestedWeight,
    unit,
    isTimed,
    isBodyweight: isBodyweightLike,
    didHitPr: false,
    hasHistory: history.length > 0 || Boolean(personalRecords),
  });

  return {
    exerciseId: exercise?.id ?? history[0]?.exercise_id ?? '',
    lastSessionWeight,
    suggestedWeight,
    helperText,
    isTimed,
    isBodyweightLike,
  };
}
