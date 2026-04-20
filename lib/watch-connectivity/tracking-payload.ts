export type WatchTrackingMode = string;

/**
 * Schema version for WatchTrackingPayload.
 * Bump this when breaking changes are introduced.
 *
 * v1: initial tracking payload shape (no heartRate, no quality)
 * v2: added optional `heartRate` and `quality` fields
 */
export const WATCH_PAYLOAD_SCHEMA_VERSION = 2 as const;

export type WatchHeartRateStatus = 'live' | 'stale' | 'unavailable';

export type WatchHeartRate = {
  bpm: number;
  timestamp: number;
  status: WatchHeartRateStatus;
};

export type WatchTrackingQuality = {
  trackingConfidence: number;
  isDegraded: boolean;
  degradationReason?: string;
};

// NOTE: `v` intentionally stays at `1` to preserve backward compatibility for
// existing watch clients that pin to v1. The new optional `heartRate` and
// `quality` fields are additive and do not break existing consumers. When we
// need to make a breaking change, bump `v` to match WATCH_PAYLOAD_SCHEMA_VERSION.
export type WatchTrackingPayload = {
  v: 1;
  type: 'tracking';
  ts: number;
  isTracking: boolean;
  reps: number;
  tracking: {
    isTracking: boolean;
    mode: WatchTrackingMode;
    phase: string;
    reps: number;
    primaryCue: string | null;
    metrics: Record<string, number | null>;
    fusion?: {
      confidence: number;
      degradedMode: boolean;
    };
  };
  heartRate?: WatchHeartRate;
  quality?: WatchTrackingQuality;
};

const VALID_HR_STATUSES: readonly WatchHeartRateStatus[] = ['live', 'stale', 'unavailable'];

export function isValidWatchHeartRate(value: unknown): value is WatchHeartRate {
  if (!value || typeof value !== 'object') return false;
  const hr = value as Record<string, unknown>;
  return (
    typeof hr.bpm === 'number' &&
    Number.isFinite(hr.bpm) &&
    typeof hr.timestamp === 'number' &&
    Number.isFinite(hr.timestamp) &&
    typeof hr.status === 'string' &&
    (VALID_HR_STATUSES as readonly string[]).includes(hr.status)
  );
}

export function isValidWatchTrackingQuality(value: unknown): value is WatchTrackingQuality {
  if (!value || typeof value !== 'object') return false;
  const q = value as Record<string, unknown>;
  if (typeof q.trackingConfidence !== 'number' || !Number.isFinite(q.trackingConfidence)) return false;
  if (typeof q.isDegraded !== 'boolean') return false;
  if (q.degradationReason !== undefined && typeof q.degradationReason !== 'string') return false;
  return true;
}

export function buildWatchTrackingPayload(args: {
  now: number;
  isTracking: boolean;
  mode: WatchTrackingMode;
  phase: string;
  reps: number;
  primaryCue: string | null;
  metrics: Record<string, number | null>;
  fusion?: {
    confidence: number;
    degradedMode: boolean;
  };
  heartRate?: WatchHeartRate;
  quality?: WatchTrackingQuality;
}): WatchTrackingPayload {
  const payload: WatchTrackingPayload = {
    v: 1,
    type: 'tracking',
    ts: args.now,
    isTracking: args.isTracking,
    reps: args.reps,
    tracking: {
      isTracking: args.isTracking,
      mode: args.mode,
      phase: args.phase,
      reps: args.reps,
      primaryCue: args.primaryCue,
      metrics: args.metrics,
      fusion: args.fusion,
    },
  };

  if (args.heartRate && isValidWatchHeartRate(args.heartRate)) {
    payload.heartRate = args.heartRate;
  }

  if (args.quality && isValidWatchTrackingQuality(args.quality)) {
    payload.quality = args.quality;
  }

  return payload;
}
