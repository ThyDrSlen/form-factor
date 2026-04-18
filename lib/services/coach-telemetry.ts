/**
 * coach-telemetry
 *
 * TODO(#431): PR #431 introduces a richer telemetry module. When it lands,
 * the helpers here should be merged non-destructively into that module —
 * they are additive (generic counter + cue-adoption rate helpers) and do
 * not depend on any internal of the PR-431 implementation.
 *
 * API:
 * - `recordCounter(name, value?)` — generic in-memory counter used by
 *   coach-dispatch for fallback telemetry.
 * - `getCounter(name)` — read counter (test helper).
 * - `recordCoachCueEmitted(cueId, sessionId)` — emit event for a cue.
 * - `recordCoachCueAdopted(cueId, sessionId)` — adopt event for a cue.
 * - `getAdoptionRate()` — adopted unique (cueId, sessionId) / emitted.
 * - `resetTelemetry()` — clears all counters + emit/adopt state.
 */

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
}
