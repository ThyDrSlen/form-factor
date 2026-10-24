import { useEffect, useRef } from 'react';
import { useSessionRunner } from '@/lib/stores/session-runner';
import {
  detectCompletedSets,
  flushCompletedSets,
  type BinderSnapshot,
  type SetLogger,
} from '@/lib/services/session-telemetry-binder';

export interface UseSessionTelemetryBinderOptions {
  logger?: SetLogger;
  defaultLoadUnit?: 'kg' | 'lbs';
  /** Disable in tests / when the product flag is off. */
  enabled?: boolean;
}

/**
 * Subscribes to `useSessionRunner` and forwards completed-set diffs to
 * `rep-logger`'s `logSet()`. Call from a single always-mounted component.
 */
export function useSessionTelemetryBinder(
  options: UseSessionTelemetryBinderOptions = {},
): void {
  const { logger, defaultLoadUnit, enabled = true } = options;
  const prevSnapshotRef = useRef<BinderSnapshot | null>(null);

  useEffect(() => {
    if (!enabled) return;

    prevSnapshotRef.current = toSnapshot(useSessionRunner.getState());

    const unsubscribe = useSessionRunner.subscribe((state) => {
      const next = toSnapshot(state);
      const prev = prevSnapshotRef.current;
      prevSnapshotRef.current = next;

      const payloads = detectCompletedSets(prev, next, { defaultLoadUnit });
      if (payloads.length === 0) return;

      void flushCompletedSets(payloads, logger);
    });

    return () => {
      unsubscribe();
      prevSnapshotRef.current = null;
    };
  }, [enabled, logger, defaultLoadUnit]);
}

function toSnapshot(state: ReturnType<typeof useSessionRunner.getState>): BinderSnapshot {
  return {
    activeSession: state.activeSession,
    exercises: state.exercises,
    sets: state.sets,
  };
}
