/**
 * Rep Quality Log
 *
 * Pure in-memory append-only log of per-rep quality events for the current
 * session. Consumed by the timeline aggregator and the coach-signals helper
 * to surface post-session analytics and live coach context without a round
 * trip to Supabase.
 *
 * No persistence. The log resets on app restart. For durable storage, use
 * `rep-logger.ts` which writes to Supabase.
 */

export interface RepQualityEntry {
  sessionId: string;
  setId?: string | null;
  repIndex: number;
  exercise: string;
  /** ISO timestamp captured at rep end. */
  ts: string;
  /** FQI score 0-100 (null when the workout did not compute one). */
  fqi: number | null;
  /** Optional ROM sub-score 0-100. */
  romScore?: number;
  /** Optional depth sub-score 0-100. */
  depthScore?: number;
  /** List of fault IDs detected during the rep. */
  faults: string[];
  /** Optional per-fault FQI penalty. */
  faultSeverity?: Record<string, number>;
  /** Worst joint confidence observed during the rep (0-1). */
  minJointConfidence?: number;
  /** Name of the worst joint (e.g. "left_knee"). */
  minConfidenceJoint?: string;
  /** Whether the rep happened during a sustained occlusion window. */
  occluded?: boolean;
}

type Listener = () => void;

export interface RepQualityLog {
  append(entry: RepQualityEntry): void;
  entries(sessionId?: string): RepQualityEntry[];
  latest(sessionId?: string): RepQualityEntry | null;
  clear(sessionId?: string): void;
  size(): number;
  subscribe(listener: Listener): () => void;
}

export interface RepQualityLogOptions {
  /** Maximum entries retained — oldest are dropped first. Default: 500. */
  maxEntries?: number;
}

const DEFAULT_MAX_ENTRIES = 500;

export function createRepQualityLog(options: RepQualityLogOptions = {}): RepQualityLog {
  const max = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES);
  const buffer: RepQualityEntry[] = [];
  const listeners = new Set<Listener>();

  function notify(): void {
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // Never let a listener failure bring the log down.
      }
    }
  }

  function normalize(entry: RepQualityEntry): RepQualityEntry {
    return {
      ...entry,
      faults: [...entry.faults],
      faultSeverity: entry.faultSeverity ? { ...entry.faultSeverity } : undefined,
    };
  }

  return {
    append(entry) {
      buffer.push(normalize(entry));
      while (buffer.length > max) {
        buffer.shift();
      }
      notify();
    },
    entries(sessionId) {
      if (!sessionId) {
        return buffer.map(normalize);
      }
      return buffer.filter((e) => e.sessionId === sessionId).map(normalize);
    },
    latest(sessionId) {
      for (let i = buffer.length - 1; i >= 0; i--) {
        const entry = buffer[i];
        if (!sessionId || entry.sessionId === sessionId) {
          return normalize(entry);
        }
      }
      return null;
    },
    clear(sessionId) {
      if (!sessionId) {
        buffer.length = 0;
        notify();
        return;
      }
      for (let i = buffer.length - 1; i >= 0; i--) {
        if (buffer[i].sessionId === sessionId) {
          buffer.splice(i, 1);
        }
      }
      notify();
    },
    size() {
      return buffer.length;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * Default shared instance for the app. Tests should construct their own log
 * via `createRepQualityLog()` to avoid cross-test pollution.
 */
export const defaultRepQualityLog: RepQualityLog = createRepQualityLog();
