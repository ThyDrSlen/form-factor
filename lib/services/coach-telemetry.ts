/**
 * Structured telemetry counters for the on-device coach.
 *
 * Thin wrapper around `lib/logger` — emits consistently-shaped payloads
 * so a future log aggregator (Sentry / DataDog / Supabase) can index on
 * `event` + `value`. No runtime dependencies; intended to be cheap and
 * always-on.
 *
 * All metric names map to what the PRD promises in docs/gemma-integration.md.
 */

import { errorWithTs, logWithTs, warnWithTs } from '@/lib/logger';

export type CoachTelemetryEvent =
  | 'coach.local.init.ms'
  | 'coach.local.ttft.ms'
  | 'coach.local.tok_per_s'
  | 'coach.local.oom'
  | 'coach.local.thermal_skip'
  | 'coach.local.cache_hit'
  | 'coach.local.fallback_reason'
  | 'coach.local.safety_reject'
  | 'coach.local.context_tokens'
  | 'coach.local.rollout_bucket';

export interface CoachTelemetryPayload {
  event: CoachTelemetryEvent;
  value?: number | string;
  ts: string;
  [meta: string]: unknown;
}

function emit(payload: CoachTelemetryPayload, level: 'log' | 'warn' | 'error' = 'log'): void {
  const writer = level === 'error' ? errorWithTs : level === 'warn' ? warnWithTs : logWithTs;
  writer('[coach-telemetry]', payload);
}

function base(
  event: CoachTelemetryEvent,
  value?: number | string,
  meta?: Record<string, unknown>
): CoachTelemetryPayload {
  return {
    event,
    value,
    ts: new Date().toISOString(),
    ...(meta || {}),
  };
}

/** How long the runtime took to boot. */
export function recordInit(ms: number): void {
  emit(base('coach.local.init.ms', ms));
}

/** Time-to-first-token for a generate call. */
export function recordTTFT(ms: number): void {
  emit(base('coach.local.ttft.ms', ms));
}

/** Steady-state tokens-per-second throughput. */
export function recordTokPerS(n: number): void {
  emit(base('coach.local.tok_per_s', n));
}

/** OOM — usually fatal, goes to error log. */
export function recordOOM(meta?: Record<string, unknown>): void {
  emit(base('coach.local.oom', 1, meta), 'error');
}

/** Thermal skip — we chose not to run local due to device heat. */
export function recordThermalSkip(meta?: Record<string, unknown>): void {
  emit(base('coach.local.thermal_skip', 1, meta), 'warn');
}

/** Response served from cache. */
export function recordCacheHit(): void {
  emit(base('coach.local.cache_hit', 1));
}

/** Dispatcher fell back to cloud — reason must be categorical. */
export function recordFallback(reason: string): void {
  emit(base('coach.local.fallback_reason', reason));
}

/** Safety filter rejected a candidate output. */
export function recordSafetyReject(metric: string, reason?: string): void {
  emit(base('coach.local.safety_reject', metric, { reason }), 'warn');
}

/** How many context tokens were prepended by the enricher. */
export function recordContextTokens(n: number): void {
  emit(base('coach.local.context_tokens', n));
}

/** Which cohort bucket [0-99] the user landed in. */
export function recordRolloutBucket(bucket: number): void {
  emit(base('coach.local.rollout_bucket', bucket));
}
