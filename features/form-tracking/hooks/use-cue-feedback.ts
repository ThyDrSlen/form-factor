/**
 * React hook bridge for coach-cue-feedback.
 *
 * Exposes per-exercise cue preferences plus a recordVote() action so
 * thumbs-up/down UIs anywhere in the app can write feedback and every
 * subscribing consumer updates in-place — same in-process event bus
 * pattern used by useFormTrackingSettings.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  type CuePreference,
  type CueVote,
  clearAll as clearAllSvc,
  getExercisePreferences,
  recordFeedback as recordFeedbackSvc,
} from '@/lib/services/coach-cue-feedback';

type Listener = () => void;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // ignore individual consumer errors so the remainder still fire
    }
  }
}

export type RecordVoteInput = {
  cueKey: string;
  vote: CueVote;
  sessionId?: string;
  note?: string;
};

export type UseCueFeedbackResult = {
  preferences: CuePreference[];
  loading: boolean;
  recordVote: (input: RecordVoteInput) => Promise<void>;
  getScore: (cueKey: string) => number;
  refresh: () => Promise<void>;
  clearAll: () => Promise<void>;
};

export function useCueFeedback(exerciseId: string | undefined): UseCueFeedbackResult {
  const [preferences, setPreferences] = useState<CuePreference[]>([]);
  const [loading, setLoading] = useState(Boolean(exerciseId));
  const mountedRef = useRef(true);
  const exerciseRef = useRef(exerciseId);
  exerciseRef.current = exerciseId;

  const refresh = useCallback(async () => {
    const current = exerciseRef.current;
    if (!current) {
      if (mountedRef.current) {
        setPreferences([]);
        setLoading(false);
      }
      return;
    }
    try {
      const prefs = await getExercisePreferences(current);
      if (mountedRef.current && exerciseRef.current === current) {
        setPreferences(prefs);
        setLoading(false);
      }
    } catch {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    setLoading(Boolean(exerciseId));
    refresh();

    const listener: Listener = () => {
      refresh();
    };
    listeners.add(listener);

    return () => {
      mountedRef.current = false;
      listeners.delete(listener);
    };
  }, [exerciseId, refresh]);

  const recordVote = useCallback<UseCueFeedbackResult['recordVote']>(
    async (input) => {
      const current = exerciseRef.current;
      if (!current) return;
      await recordFeedbackSvc({
        exerciseId: current,
        cueKey: input.cueKey,
        vote: input.vote,
        sessionId: input.sessionId,
        note: input.note,
      });
      emit();
    },
    [],
  );

  const getScore = useCallback<UseCueFeedbackResult['getScore']>(
    (cueKey) => {
      const normalized = cueKey.trim().toLowerCase();
      const match = preferences.find((p) => p.cueKey === normalized);
      return match ? match.score : 0;
    },
    [preferences],
  );

  const clearAll = useCallback<UseCueFeedbackResult['clearAll']>(async () => {
    await clearAllSvc();
    emit();
  }, []);

  return { preferences, loading, recordVote, getScore, refresh, clearAll };
}

export function __clearListenersForTests(): void {
  listeners.clear();
}
