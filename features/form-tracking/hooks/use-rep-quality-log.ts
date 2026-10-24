import { useMemo, useSyncExternalStore } from 'react';
import {
  defaultRepQualityLog,
  type RepQualityEntry,
  type RepQualityLog,
} from '@/lib/services/rep-quality-log';

export interface UseRepQualityLogResult {
  entries: RepQualityEntry[];
  latest: RepQualityEntry | null;
  size: number;
}

export interface UseRepQualityLogOptions {
  /**
   * Specific log instance. Defaults to the shared `defaultRepQualityLog`
   * so tests can inject isolated logs without polluting each other.
   */
  log?: RepQualityLog;
  /** Only include entries for this session. */
  sessionId?: string;
}

/**
 * Subscribe a component to a rep-quality log. Returns a stable snapshot for
 * the current session view plus the latest entry. The returned object is
 * referentially stable between renders when the log hasn't changed so that
 * downstream `useMemo` consumers don't re-compute on every render.
 */
export function useRepQualityLog(options: UseRepQualityLogOptions = {}): UseRepQualityLogResult {
  const log = options.log ?? defaultRepQualityLog;
  const sessionId = options.sessionId;

  const subscribe = (listener: () => void) => log.subscribe(listener);
  const getSnapshot = () => log.size();

  // `useSyncExternalStore` triggers a re-render when the total log size
  // changes — which covers append, clear, and session-scoped clear.
  const totalSize = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return useMemo(() => {
    const entries = log.entries(sessionId);
    return {
      entries,
      latest: log.latest(sessionId),
      size: entries.length,
    };
  }, [log, sessionId, totalSize]);
}
