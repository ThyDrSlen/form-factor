import { buildWatchTrackingPayload, type WatchTrackingPayload } from '@/lib/watch-connectivity/tracking-payload';

export function buildFusionWatchPayload(input: {
  now: number;
  isTracking: boolean;
  mode: string;
  phase: string;
  reps: number;
  primaryCue: string | null;
  metrics: Record<string, number | null>;
  fusion: {
    confidence: number;
    degradedMode: boolean;
  };
}): WatchTrackingPayload {
  return buildWatchTrackingPayload({
    now: input.now,
    isTracking: input.isTracking,
    mode: input.mode,
    phase: input.phase,
    reps: input.reps,
    primaryCue: input.primaryCue,
    metrics: input.metrics,
    fusion: input.fusion,
  });
}
