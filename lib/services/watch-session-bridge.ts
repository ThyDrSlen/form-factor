/**
 * Watch Session Bridge
 *
 * Subscribes to workout session-runner events and forwards compact payloads to
 * the paired Apple Watch via the watch-connectivity wrapper. Keeps the two
 * surfaces decoupled: session-runner knows nothing about the watch, the watch
 * transport knows nothing about session semantics.
 *
 * Dedup rule: identical (type + session_set_id + session_id) messages that
 * arrive within DEDUP_WINDOW_MS of one another are suppressed. This shields
 * the watch from transient double-emits (e.g. retry paths).
 *
 * Usage:
 *   const teardown = initWatchSessionBridge({ subscribeToEvents });
 *   // ... later
 *   teardown();
 *
 * Production mount site: contexts/WatchSessionBridgeContext.tsx, which is
 * nested inside WorkoutsProvider (see contexts/WorkoutsContext.tsx). The
 * provider owns the lifecycle so the bridge starts/stops with the app.
 */
import { sendMessage } from '@/lib/watch-connectivity';
import type {
  SessionEventType,
  WorkoutSessionEvent,
} from '@/lib/types/workout-session';
import { warnWithTs } from '@/lib/logger';

const DEDUP_WINDOW_MS = 500;

/**
 * Events forwarded to the watch. Other session event types (e.g. set_started)
 * are intentionally skipped to keep the watch channel quiet.
 *
 * Note: session-runner currently emits 'rest_skipped'; the brief's 'rest_ended'
 * is mapped to the same semantic (rest has finished). We forward both so this
 * bridge is forward-compatible when a dedicated 'rest_ended' event lands.
 */
const FORWARDED_EVENT_TYPES = new Set<SessionEventType>([
  'set_completed',
  'rest_started',
  'rest_completed',
  'rest_skipped',
  'session_completed',
  'pr_detected',
]);

export type WatchSessionMessage = {
  v: 1;
  type: 'session_event';
  ts: number;
  event: SessionEventType;
  sessionId: string;
  sessionExerciseId: string | null;
  sessionSetId: string | null;
  payload?: Record<string, unknown>;
};

export type SessionRunnerEventsApi = {
  subscribeToEvents: (listener: (event: WorkoutSessionEvent) => void) => () => void;
};

function buildWatchMessage(event: WorkoutSessionEvent): WatchSessionMessage {
  return {
    v: 1,
    type: 'session_event',
    ts: Date.now(),
    event: event.type,
    sessionId: event.session_id,
    sessionExerciseId: event.session_exercise_id ?? null,
    sessionSetId: event.session_set_id ?? null,
    payload: event.payload && Object.keys(event.payload).length > 0 ? event.payload : undefined,
  };
}

function isValidEvent(value: unknown): value is WorkoutSessionEvent {
  if (!value || typeof value !== 'object') return false;
  const ev = value as Record<string, unknown>;
  return (
    typeof ev.type === 'string' &&
    typeof ev.session_id === 'string' &&
    ev.session_id.length > 0
  );
}

/**
 * Initialize the watch bridge. Returns an unsubscribe function that must be
 * called during cleanup to avoid leaking a subscription.
 */
export function initWatchSessionBridge(api: SessionRunnerEventsApi): () => void {
  const lastSent = new Map<string, number>();

  const unsubscribe = api.subscribeToEvents((event) => {
    if (!isValidEvent(event)) {
      warnWithTs('[watch-session-bridge] skipped malformed event', event);
      return;
    }

    if (!FORWARDED_EVENT_TYPES.has(event.type)) return;

    const dedupKey = `${event.type}|${event.session_id}|${event.session_set_id ?? ''}`;
    const now = Date.now();
    const prev = lastSent.get(dedupKey);
    if (prev !== undefined && now - prev < DEDUP_WINDOW_MS) {
      return;
    }
    lastSent.set(dedupKey, now);

    try {
      sendMessage(buildWatchMessage(event));
    } catch (err) {
      warnWithTs('[watch-session-bridge] sendMessage threw', err);
    }
  });

  return () => {
    try {
      unsubscribe();
    } finally {
      lastSent.clear();
    }
  };
}
