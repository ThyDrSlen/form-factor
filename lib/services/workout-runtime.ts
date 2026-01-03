import type { RepBoundary } from '@/lib/types/workout-definitions';

export function shouldStartRep<T extends string>(boundary: RepBoundary<T>, prev: T, next: T): boolean {
  return prev !== boundary.startPhase && next === boundary.startPhase;
}

export function shouldEndRep<T extends string>(
  boundary: RepBoundary<T>,
  prev: T,
  next: T,
  repActive: boolean,
  nowMs: number,
  repStartMs: number
): boolean {
  if (!repActive) return false;
  if (prev === boundary.endPhase || next !== boundary.endPhase) return false;
  return nowMs - repStartMs >= boundary.minDurationMs;
}
