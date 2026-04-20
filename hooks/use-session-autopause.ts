/**
 * useSessionAutopause
 *
 * Binds React Native's AppState transitions to the pause extension
 * module so the session auto-pauses when the user backgrounds the
 * app and surfaces a resume prompt on return.
 *
 * Behavior:
 *   - On 'background'  → pauseActiveSession('background')
 *   - On 'active' (after a prior background) → mark that a resume is
 *     pending so UI can show a toast. The user presses Resume to
 *     call resumeActiveSession() (or just start the next rep).
 */
import { useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useSessionRunner } from '@/lib/stores/session-runner';
import {
  pauseActiveSession,
  resumeActiveSession,
  useSessionPauseState,
} from '@/lib/stores/session-runner.pause';

export interface SessionAutopauseResult {
  /** True when the overlay should surface the resume banner. */
  needsResume: boolean;
  /** Milliseconds the session was paused (only available after resume). */
  lastPausedDurationMs: number | null;
  /** User confirmation handler — call from the resume toast. */
  acknowledgeResume: () => Promise<number>;
  /** Pause-reason recorded by the autopauser (or null when not paused). */
  pauseReason: string | null;
}

export function useSessionAutopause(options?: {
  enabled?: boolean;
}): SessionAutopauseResult {
  const enabled = options?.enabled ?? true;
  const activeSession = useSessionRunner((s) => s.activeSession);
  const pauseState = useSessionPauseState();
  const [needsResume, setNeedsResume] = useState(false);
  const [lastPausedDurationMs, setLastPausedDurationMs] = useState<number | null>(null);
  const lastAppStateRef = useRef<AppStateStatus>('active');

  useEffect(() => {
    if (!enabled) return undefined;
    const sub = AppState.addEventListener('change', async (next: AppStateStatus) => {
      const prev = lastAppStateRef.current;
      lastAppStateRef.current = next;

      if (next === 'background' && prev === 'active') {
        if (useSessionRunner.getState().activeSession) {
          await pauseActiveSession('background').catch(() => {});
        }
      }
      if (next === 'active' && (prev === 'background' || prev === 'inactive')) {
        const { isPaused } = pauseState;
        if (isPaused || useSessionRunner.getState().activeSession) {
          setNeedsResume(true);
        }
      }
    });
    return () => {
      sub.remove();
    };
  }, [enabled, pauseState]);

  // If the session ends, auto-clear the banner state.
  useEffect(() => {
    if (!activeSession) {
      setNeedsResume(false);
      setLastPausedDurationMs(null);
    }
  }, [activeSession]);

  const acknowledgeResume = async (): Promise<number> => {
    const durationMs = await resumeActiveSession();
    setLastPausedDurationMs(durationMs);
    setNeedsResume(false);
    return durationMs;
  };

  return {
    needsResume,
    lastPausedDurationMs,
    acknowledgeResume,
    pauseReason: pauseState.reason,
  };
}
