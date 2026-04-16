/**
 * coach-telemetry (stub)
 *
 * TODO(#431): PR #431 introduces a richer telemetry module. When it lands,
 * the helpers here should be merged non-destructively into that module —
 * they are additive (generic counter only) and do not depend on any
 * internal of the PR-431 implementation.
 *
 * Shape today (extended in a follow-up commit):
 * - `recordCounter(name, value?)` — generic in-memory counter used by
 *   coach-dispatch for fallback telemetry.
 * - `getCounter(name)` — read counter (test helper).
 * - `resetTelemetry()` — clears all counters.
 */

const counters = new Map<string, number>();

export function recordCounter(name: string, value: number = 1): void {
  const prev = counters.get(name) ?? 0;
  counters.set(name, prev + value);
}

export function getCounter(name: string): number {
  return counters.get(name) ?? 0;
}

export function resetTelemetry(): void {
  counters.clear();
}
