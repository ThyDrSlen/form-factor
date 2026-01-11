export type WatchTrackingMode = string;

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
  };
};

export function buildWatchTrackingPayload(args: {
  now: number;
  isTracking: boolean;
  mode: WatchTrackingMode;
  phase: string;
  reps: number;
  primaryCue: string | null;
  metrics: Record<string, number | null>;
}): WatchTrackingPayload {
  return {
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
    },
  };
}
