/**
 * useBetweenSetsCoach Hook
 *
 * Subscribes to the active rest timer in the session-runner store and
 * returns a fresh BetweenSetsRecommendation for the just-completed set.
 * Tracks an in-memory history of previously-shown mobility and
 * reflection IDs so consecutive rest periods don't repeat content.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { useSessionRunner } from '@/lib/stores/session-runner';
import {
  BetweenSetsRecommendation,
  buildBetweenSetsRecommendation,
} from '@/lib/services/between-sets-coach';
import type { MobilityDrillId } from '@/lib/services/mobility-drills';

const MAX_HISTORY = 6;

export interface UseBetweenSetsCoachResult {
  recommendation: BetweenSetsRecommendation | null;
  refresh: () => void;
  setId: string | null;
}

export function useBetweenSetsCoach(): UseBetweenSetsCoachResult {
  const restTimer = useSessionRunner((s) => s.restTimer);
  const exercises = useSessionRunner((s) => s.exercises);
  const sets = useSessionRunner((s) => s.sets);

  const mobilityHistoryRef = useRef<MobilityDrillId[]>([]);
  const reflectionHistoryRef = useRef<string[]>([]);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const refresh = useCallback(() => {
    setRefreshNonce((n) => n + 1);
  }, []);

  const recommendation = useMemo<BetweenSetsRecommendation | null>(() => {
    if (!restTimer) return null;

    for (const exercise of exercises) {
      const exerciseSets = sets[exercise.id] ?? [];
      const setIdx = exerciseSets.findIndex((s) => s.id === restTimer.setId);
      if (setIdx < 0) continue;

      const target = exerciseSets[setIdx];
      const rec = buildBetweenSetsRecommendation({
        setType: target.set_type,
        setIndex: setIdx,
        totalSets: exerciseSets.length,
        restSeconds: restTimer.targetSeconds,
        muscleGroup: exercise.exercise?.muscle_group ?? null,
        plannedReps: target.planned_reps,
        actualReps: target.actual_reps,
        perceivedRpe: target.perceived_rpe,
        previouslyShownMobilityIds: mobilityHistoryRef.current,
        previouslyShownReflectionIds: reflectionHistoryRef.current,
      });

      mobilityHistoryRef.current = [
        rec.mobility.id,
        ...mobilityHistoryRef.current.filter((id) => id !== rec.mobility.id),
      ].slice(0, MAX_HISTORY);
      reflectionHistoryRef.current = [
        rec.reflection.id,
        ...reflectionHistoryRef.current.filter((id) => id !== rec.reflection.id),
      ].slice(0, MAX_HISTORY);

      return rec;
    }

    return null;
  }, [restTimer, exercises, sets, refreshNonce]);

  return {
    recommendation,
    refresh,
    setId: restTimer?.setId ?? null,
  };
}
