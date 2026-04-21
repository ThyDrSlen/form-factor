/**
 * useAutoDebrief
 *
 * React hook that listens for session completion (via
 * `onSessionFinished`) and drives the auto-debrief flow: triggers
 * `generateAutoDebrief()`, exposes loading / error / data state, and
 * provides a manual `retry()` callback. Consumers mount this near the
 * top of their post-session screen; they also pass the analytics record
 * they've already computed from the session.
 *
 * Note: this hook does NOT auto-mount the debrief screen — #456 owns that.
 * We only expose the state. The dependent PR wires the screen.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { warnWithTs } from '@/lib/logger';
import {
  generateAutoDebrief,
  getCachedAutoDebrief,
  isAutoDebriefEnabled,
  type AutoDebriefResult,
  type GenerateAutoDebriefInput,
} from '@/lib/services/coach-auto-debrief';
import {
  onSessionFinished,
  type SessionFinishedEvent,
} from '@/lib/stores/session-runner';
import { cacheSessionBrief, type SessionBrief } from '@/lib/services/coach-memory';
import { isCoachPipelineV2Enabled } from '@/lib/services/coach-pipeline-v2-flag';

/**
 * Pipeline-v2: build a compact SessionBrief from the debrief input. Used to
 * prime `coach-memory` so the next coach turn has cross-session context.
 *
 * Returns null when input doesn't carry enough signal to persist (no
 * sessionId or no reps). The memory layer already handles stale/empty reads
 * gracefully, so we just skip.
 */
function buildSessionBriefFromInput(
  input: GenerateAutoDebriefInput,
): SessionBrief | null {
  if (!input.sessionId) return null;
  const { analytics } = input;
  if (!analytics || analytics.repCount <= 0) return null;
  const nowIso = new Date().toISOString();
  return {
    sessionId: input.sessionId,
    startedAt: nowIso,
    endedAt: nowIso,
    durationMinutes: null,
    goalProfile: null,
    topExerciseName: analytics.exerciseName ?? null,
    totalSets: 0,
    totalReps: analytics.repCount,
    avgRpe: null,
    avgFqi: analytics.avgFqi ?? null,
    notablePositive: null,
    notableNegative: analytics.topFault ?? null,
    cachedAt: nowIso,
  };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseAutoDebriefState {
  /** Most-recent result (cached or freshly generated). null until first run. */
  data: AutoDebriefResult | null;
  /** True while generateAutoDebrief is in flight. */
  loading: boolean;
  /** Error message for the last failed attempt; null on success or idle. */
  error: string | null;
  /** Manual retry — useful for the error-state CTA in AutoDebriefCard. */
  retry: () => Promise<void>;
}

export type AutoDebriefInputProvider = (
  event: SessionFinishedEvent,
) => Promise<GenerateAutoDebriefInput | null> | GenerateAutoDebriefInput | null;

export interface UseAutoDebriefOptions {
  /**
   * Called when a session finishes. Must return the analytics payload to
   * debrief (or null to skip). Separating this from the hook lets callers
   * gather rep data from their own source of truth (e.g. session-scoped
   * rep-logger).
   */
  buildInput: AutoDebriefInputProvider;
  /**
   * Optional: force a specific sessionId to debrief on mount (e.g. for
   * re-opening the debrief tab). When provided, the hook loads the
   * cached result and skips the session-finished listener until cleared.
   */
  sessionId?: string | null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAutoDebrief(opts: UseAutoDebriefOptions): UseAutoDebriefState {
  const { buildInput, sessionId } = opts;

  const [data, setData] = useState<AutoDebriefResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stash the last input we generated from so retry() can replay it without
  // waiting for another session_finished event.
  const lastInputRef = useRef<GenerateAutoDebriefInput | null>(null);

  const runWith = useCallback(async (input: GenerateAutoDebriefInput) => {
    lastInputRef.current = input;
    setLoading(true);
    setError(null);
    try {
      const result = await generateAutoDebrief(input);
      setData(result);
      // Pipeline v2: persist a compact SessionBrief so the next coach turn
      // can prepend cross-session memory (closes gap 1 of intersection-audit
      // and half of #458). Flag-gated; off by default. Runs only on success.
      if (isCoachPipelineV2Enabled()) {
        const brief = buildSessionBriefFromInput(input);
        if (brief) {
          try {
            await cacheSessionBrief(brief);
          } catch (err) {
            warnWithTs('[use-auto-debrief] cacheSessionBrief failed', err);
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate debrief';
      warnWithTs('[use-auto-debrief] generate failed', err);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const retry = useCallback(async () => {
    const last = lastInputRef.current;
    if (!last) return;
    await runWith(last);
  }, [runWith]);

  // Preload from cache when sessionId is explicit (e.g. reopening the screen).
  useEffect(() => {
    let cancelled = false;
    if (!sessionId) return;
    (async () => {
      try {
        const cached = await getCachedAutoDebrief(sessionId);
        if (!cancelled && cached) {
          setData(cached);
        }
      } catch (err) {
        if (!cancelled) warnWithTs('[use-auto-debrief] cache preload failed', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // Subscribe to session-finished events.
  useEffect(() => {
    if (!isAutoDebriefEnabled()) return;
    const unsubscribe = onSessionFinished(async (event) => {
      try {
        const input = await buildInput(event);
        if (!input) return;
        await runWith(input);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to prepare debrief';
        warnWithTs('[use-auto-debrief] buildInput threw', err);
        setError(message);
      }
    });
    return unsubscribe;
  }, [buildInput, runWith]);

  return { data, loading, error, retry };
}
