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

/**
 * Hard timeout for a single generateAutoDebrief attempt. The coach pipeline
 * has its own per-leg timeouts, but a transport-level hang (e.g. kept-alive
 * connection stalled behind a captive portal) can still cascade into the UI
 * showing a forever-spinner. 8s gives the happy path plenty of room and
 * trips fast enough to let the user retry.
 */
export const AUTO_DEBRIEF_TIMEOUT_MS = 8000;
export const AUTO_DEBRIEF_TIMEOUT_MESSAGE = 'Debrief is taking longer than expected';

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
  /**
   * Optional input to generate once on mount (e.g. recap screens that
   * already have the rep/fqi data on route params and want to fire a
   * debrief without waiting for a separate session_finished event).
   * When provided AND the auto-debrief feature flag is on, the hook
   * invokes `generateAutoDebrief(initialInput)` a single time per mount.
   * Subsequent value changes are ignored (the cache/preload path handles
   * re-runs). Null/undefined disables the on-mount leg.
   */
  initialInput?: GenerateAutoDebriefInput | null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAutoDebrief(opts: UseAutoDebriefOptions): UseAutoDebriefState {
  const { buildInput, sessionId, initialInput } = opts;

  const [data, setData] = useState<AutoDebriefResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stash the last input we generated from so retry() can replay it without
  // waiting for another session_finished event.
  const lastInputRef = useRef<GenerateAutoDebriefInput | null>(null);
  // Guards the on-mount `initialInput` leg — fires exactly once per mount,
  // regardless of subsequent prop identity changes, so we don't re-run on
  // every render just because the caller didn't memoize their input shape.
  const initialInputFiredRef = useRef(false);

  // Keep a stable reference to buildInput so the session-finished subscribe
  // effect doesn't re-subscribe on every parent re-render when the caller
  // passes a fresh closure (common: inline `() => ...`). Without this ref,
  // the effect unsubscribes + resubscribes every render, which can drop a
  // session-finished event fired mid-transition.
  const buildInputRef = useRef(buildInput);
  useEffect(() => {
    buildInputRef.current = buildInput;
  });

  const runWith = useCallback(async (input: GenerateAutoDebriefInput) => {
    lastInputRef.current = input;
    setLoading(true);
    setError(null);
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(AUTO_DEBRIEF_TIMEOUT_MESSAGE));
        }, AUTO_DEBRIEF_TIMEOUT_MS);
      });
      const result = (await Promise.race([
        generateAutoDebrief(input),
        timeoutPromise,
      ])) as AutoDebriefResult;
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
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
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

  // On-mount leg: fire a debrief once when the caller provides an
  // `initialInput` (e.g. the recap modal constructs a GenerateAutoDebriefInput
  // from route params). Skipped when the feature flag is off, when the input
  // is null/undefined, or when the same mount has already fired. The cache-
  // preload effect above already handles re-opening the screen, so we avoid
  // double-invocation by short-circuiting when cached data is already present.
  useEffect(() => {
    if (initialInputFiredRef.current) return;
    if (!initialInput) return;
    if (!isAutoDebriefEnabled()) return;
    initialInputFiredRef.current = true;
    // Non-awaited fire-and-forget — the hook state machine drives UI via
    // loading/error/data, not the promise return.
    void runWith(initialInput);
  }, [initialInput, runWith]);

  // Subscribe to session-finished events. Reads buildInput from a ref so
  // the subscription is stable across parent re-renders that pass a fresh
  // inline closure.
  useEffect(() => {
    if (!isAutoDebriefEnabled()) return;
    const unsubscribe = onSessionFinished(async (event) => {
      try {
        const input = await buildInputRef.current(event);
        if (!input) return;
        await runWith(input);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to prepare debrief';
        warnWithTs('[use-auto-debrief] buildInput threw', err);
        setError(message);
      }
    });
    return unsubscribe;
  }, [runWith]);

  return { data, loading, error, retry };
}
