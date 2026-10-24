import type { WatchTrackingPayload } from './tracking-payload';

export type WatchTrackingPublicationState = {
  lastSubmission: {
    at: number;
    signature: string;
    isTracking: boolean;
    mode: string;
  } | null;
  timestamp: number;
};

/**
 * Leading-only metric throttle with an immediate lifecycle flush. Start, Stop,
 * exercise changes, and an invalidated local scope never need another frame.
 * No timer or pending snapshot is retained, so cleanup cannot replay an old scan.
 *
 * snapshot.ts is wall-clock time; the outgoing timestamp is strictly increasing
 * for this state lifetime, independently of same-ms events or clock rollback.
 * Clear lastSubmission on local scope changes, but retain timestamp ordering.
 * This plans local submissions only; it cannot guarantee native/remote delivery.
 */
export function planWatchTrackingPublication(
  previous: WatchTrackingPublicationState,
  snapshot: WatchTrackingPayload,
): { state: WatchTrackingPublicationState; payload: WatchTrackingPayload | null } {
  const last = previous.lastSubmission;
  const lifecycleChanged = !last || last.isTracking !== snapshot.isTracking || last.mode !== snapshot.tracking.mode;
  // A wall-clock rollback starts a fresh throttle window; it must not freeze
  // changed metrics until the previous wall time catches up. Wire ordering
  // remains monotonic through previous.timestamp below.
  if (!lifecycleChanged && snapshot.ts >= last.at && snapshot.ts - last.at < 250) {
    return { state: previous, payload: null };
  }
  const signature = JSON.stringify(snapshot.tracking);
  if (signature === last?.signature) {
    return { state: previous, payload: null };
  }
  const payload = { ...snapshot, ts: Math.max(snapshot.ts, previous.timestamp + 1) };
  return {
    state: {
      timestamp: payload.ts,
      lastSubmission: {
        at: snapshot.ts,
        signature,
        isTracking: snapshot.isTracking,
        mode: snapshot.tracking.mode,
      },
    },
    payload,
  };
}
