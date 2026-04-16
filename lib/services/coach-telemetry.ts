// Coach telemetry counters.
//
// TODO(#429): merge with PR #431 canonical telemetry module on land. PR #431
// owns the eval-YAML-driven counter registry, persistent flush, and Sentry
// bridge. Until that lands, we ship a minimal in-memory stub so the streaming
// (Item 4 of #465) and failover (Item 2 of #465) call sites compile and so
// jest tests can assert counter increments.
//
// The public surface (`recordCoachStream*`, `recordCoachFailoverUsed`,
// `getCoachTelemetrySnapshot`, `resetCoachTelemetry`) is the contract callers
// rely on; PR #431 must preserve these names when it lands.

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
