/**
 * coach-telemetry
 *
 * This module hosts two complementary telemetry surfaces:
 *
 * 1. Generic counter + cue-adoption rate helpers (main, used by coach-dispatch
 *    and the coach cue pipeline).
 * 2. Streaming / failover / TTFT counters (PR #465, used by `coach-streaming`,
 *    `coach-failover`, and the shaped-stream integration).
 *
 * Both surfaces are additive and share no state — they are colocated here so
 * call sites have a single import path. PR #431, when it lands, should
 * preserve BOTH public APIs non-destructively.
 *
 * API (cue adoption / generic counters):
 * - `recordCounter(name, value?)` — generic in-memory counter used by
 *   coach-dispatch for fallback telemetry.
 * - `getCounter(name)` — read counter (test helper).
 * - `recordCoachCueEmitted(cueId, sessionId)` — emit event for a cue.
 * - `recordCoachCueAdopted(cueId, sessionId)` — adopt event for a cue.
 * - `getAdoptionRate()` — adopted unique (cueId, sessionId) / emitted.
 * - `resetTelemetry()` — clears all counters + emit/adopt state.
 *
 * API (streaming + failover, PR #465):
 * - `recordCoachStreamStart/Chunk/Complete/Abort/BufferedPct`
 * - `recordCoachFailoverUsed(secondaryProvider)`
 * - `getCoachTelemetrySnapshot()` / `resetCoachTelemetry()`
 */

import { errorWithTs, logWithTs, warnWithTs } from '@/lib/logger';

// ---------------------------------------------------------------------------
// Generic counters + cue adoption (main)
// ---------------------------------------------------------------------------

const counters = new Map<string, number>();

// Unique cueId::sessionId pairs: a cue emitted multiple times for the same
// (cue, session) counts once when computing adoption rate.
const emittedKeys = new Set<string>();
const adoptedKeys = new Set<string>();

function cueKey(cueId: string, sessionId: string): string {
  return `${cueId}::${sessionId}`;
}

export function recordCounter(name: string, value: number = 1): void {
  const prev = counters.get(name) ?? 0;
  counters.set(name, prev + value);
}

export function getCounter(name: string): number {
  return counters.get(name) ?? 0;
}

export function recordCoachCueEmitted(cueId: string, sessionId: string): void {
  if (!cueId || !sessionId) return;
  emittedKeys.add(cueKey(cueId, sessionId));
  recordCounter('coach_cue_emitted');
}

export function recordCoachCueAdopted(cueId: string, sessionId: string): void {
  if (!cueId || !sessionId) return;
  // Record emission implicitly so callers that only observe adoption still
  // contribute a valid denominator.
  const key = cueKey(cueId, sessionId);
  emittedKeys.add(key);
  adoptedKeys.add(key);
  recordCounter('coach_cue_adopted');
}

/**
 * Adoption rate = unique adopted (cueId, sessionId) / unique emitted.
 * Returns 1 on empty data (neutral-best default for a fresh UI).
 */
export function getAdoptionRate(): number {
  const emitted = emittedKeys.size;
  if (emitted === 0) return 1;
  return adoptedKeys.size / emitted;
}

export function resetTelemetry(): void {
  counters.clear();
  emittedKeys.clear();
  adoptedKeys.clear();
  // Also reset the streaming/failover snapshot so a single reset clears the
  // entire module state (what most tests want).
  resetCoachTelemetry();
}

// ---------------------------------------------------------------------------
// Streaming + failover counters (PR #465)
// ---------------------------------------------------------------------------

export interface CoachTelemetrySnapshot {
  /** Total chunks observed across all streams (Item 4). */
  stream_chunks: number;
  /** Rolling average inter-chunk delay (ms) across all streams (Item 4). */
  stream_chunk_delay_ms_avg: number;
  /** Number of times the user/host aborted a stream mid-flight (Item 4). */
  stream_abort_count: number;
  /**
   * Last observed buffered-chars / total-chars ratio when the shaper held
   * back text (Item 4 + Item 5). Populated by the shaper integration; defaults
   * to 0 when no shaping happened.
   */
  stream_buffered_pct: number;
  /**
   * Number of times the failover service used the secondary provider after
   * the primary returned 429/5xx (Item 2). Encodes the secondary id so eval
   * harnesses can break it down per provider.
   */
  failover_used: number;
  /** Per-secondary-provider breakdown of failover_used (Item 2). */
  failover_used_by_provider: Record<string, number>;
  /** Last TTFT recorded (ms). */
  last_ttft_ms: number;
  /** Last total stream duration (ms). */
  last_duration_ms: number;
}

const initial = (): CoachTelemetrySnapshot => ({
  stream_chunks: 0,
  stream_chunk_delay_ms_avg: 0,
  stream_abort_count: 0,
  stream_buffered_pct: 0,
  failover_used: 0,
  failover_used_by_provider: {},
  last_ttft_ms: 0,
  last_duration_ms: 0,
});

let snapshot = initial();

export function resetCoachTelemetry(): void {
  snapshot = initial();
}

export function getCoachTelemetrySnapshot(): CoachTelemetrySnapshot {
  // Return a structural clone so callers can't mutate internal state.
  return { ...snapshot, failover_used_by_provider: { ...snapshot.failover_used_by_provider } };
}

export function recordCoachStreamStart(): void {
  // No counter to increment on start, but PR #431 may add `stream_open_count`.
}

export function recordCoachStreamChunk(_charCount: number): void {
  snapshot.stream_chunks += 1;
}

export function recordCoachStreamComplete(opts: {
  ttftMs: number;
  durationMs: number;
  chunkCount: number;
  avgChunkDelayMs: number;
}): void {
  snapshot.last_ttft_ms = opts.ttftMs;
  snapshot.last_duration_ms = opts.durationMs;
  // Update the rolling average inter-chunk delay across all streams using a
  // stream-count-weighted blend so a single fast stream can't zero it out.
  if (opts.avgChunkDelayMs > 0) {
    const prevWeight = Math.max(0, snapshot.stream_chunks - opts.chunkCount);
    const total = prevWeight + opts.chunkCount;
    if (total > 0) {
      snapshot.stream_chunk_delay_ms_avg =
        (snapshot.stream_chunk_delay_ms_avg * prevWeight +
          opts.avgChunkDelayMs * opts.chunkCount) /
        total;
    }
  }
}

export function recordCoachStreamAbort(): void {
  snapshot.stream_abort_count += 1;
}

export function recordCoachStreamBufferedPct(pct: number): void {
  // Clamp to [0, 1] so consumers can rely on the range.
  snapshot.stream_buffered_pct = Math.max(0, Math.min(1, pct));
}

export function recordCoachFailoverUsed(secondaryProvider: string): void {
  snapshot.failover_used += 1;
  snapshot.failover_used_by_provider[secondaryProvider] =
    (snapshot.failover_used_by_provider[secondaryProvider] ?? 0) + 1;
}

// ---------------------------------------------------------------------------
// On-device coach emit-style counters (PR #431 salvage)
//
// These map to the metrics promised in docs/gemma-integration.md. They are
// log-only (no in-memory snapshot) because coach-local / coach-safety /
// coach-context-enricher only need to emit structured events — the cloud
// aggregator is the source of truth. Additive on top of the counters/
// snapshots above.
// ---------------------------------------------------------------------------

export type CoachLocalTelemetryEvent =
  | 'coach.local.fallback_reason'
  | 'coach.local.safety_reject'
  | 'coach.local.context_tokens';

interface CoachLocalTelemetryPayload {
  event: CoachLocalTelemetryEvent;
  value?: number | string;
  ts: string;
  [meta: string]: unknown;
}

function emitLocalTelemetry(
  payload: CoachLocalTelemetryPayload,
  level: 'log' | 'warn' | 'error' = 'log'
): void {
  const writer = level === 'error' ? errorWithTs : level === 'warn' ? warnWithTs : logWithTs;
  writer('[coach-telemetry]', payload);
}

function localBase(
  event: CoachLocalTelemetryEvent,
  value?: number | string,
  meta?: Record<string, unknown>
): CoachLocalTelemetryPayload {
  return {
    event,
    value,
    ts: new Date().toISOString(),
    ...(meta || {}),
  };
}

/** Dispatcher fell back to cloud — reason must be categorical (#431). */
export function recordFallback(reason: string): void {
  emitLocalTelemetry(localBase('coach.local.fallback_reason', reason));
}

/** Safety filter rejected a candidate output (#431). */
export function recordSafetyReject(metric: string, reason?: string): void {
  emitLocalTelemetry(localBase('coach.local.safety_reject', metric, { reason }), 'warn');
}

/** Context tokens prepended by the enricher (#431). */
export function recordContextTokens(n: number): void {
  emitLocalTelemetry(localBase('coach.local.context_tokens', n));
}
