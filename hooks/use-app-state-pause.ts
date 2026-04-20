/**
 * useAppStatePause — AppState-aware pause/resume for the scan loop.
 *
 * When the app backgrounds or becomes inactive (incoming call, Control
 * Center pulled, screen locked) we immediately mark the session paused.
 * Crucially we do NOT auto-resume when AppState flips back to 'active';
 * instead we flip `needsResume` so the host can show a "Resume?" prompt
 * and give the user explicit control.
 *
 * The host owns the tracking engine, so this hook only manages state
 * flags. Consumers wire `isPaused` into their frame-pump / start/stop
 * calls.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

export type AppStatePauseOptions = {
  /** Fired when AppState transitions to 'background' or 'inactive'. */
  onPause?: () => void;
  /** Fired when AppState returns to 'active' after a background stint. */
  onForeground?: () => void;
  /** Disable listening entirely (useful during fixture playback). */
  enabled?: boolean;
};

export type AppStatePauseResult = {
  appState: AppStateStatus;
  /** True once the app has left active at least once since last resume(). */
  isPaused: boolean;
  /** True after foreground return until resume() is called. */
  needsResume: boolean;
  /** Clears needsResume + isPaused so the host can restart tracking. */
  resume: () => void;
  /** Manually mark paused (e.g. after permission revocation). */
  markPaused: () => void;
};

export function useAppStatePause(
  options?: AppStatePauseOptions,
): AppStatePauseResult {
  const enabled = options?.enabled ?? true;
  const [appState, setAppState] = useState<AppStateStatus>(
    AppState.currentState ?? 'active',
  );
  const [isPaused, setIsPaused] = useState(false);
  const [needsResume, setNeedsResume] = useState(false);
  const onPauseRef = useRef(options?.onPause);
  const onForegroundRef = useRef(options?.onForeground);

  useEffect(() => {
    onPauseRef.current = options?.onPause;
    onForegroundRef.current = options?.onForeground;
  }, [options?.onPause, options?.onForeground]);

  useEffect(() => {
    if (!enabled) return;
    const handleChange = (next: AppStateStatus) => {
      setAppState(next);
      if (next === 'background' || next === 'inactive') {
        setIsPaused(true);
        onPauseRef.current?.();
      } else if (next === 'active') {
        setIsPaused((prev) => {
          if (prev) {
            setNeedsResume(true);
            onForegroundRef.current?.();
          }
          return prev;
        });
      }
    };
    const sub = AppState.addEventListener('change', handleChange);
    return () => {
      sub.remove();
    };
  }, [enabled]);

  const resume = useCallback(() => {
    setIsPaused(false);
    setNeedsResume(false);
  }, []);

  const markPaused = useCallback(() => {
    setIsPaused(true);
  }, []);

  return { appState, isPaused, needsResume, resume, markPaused };
}
