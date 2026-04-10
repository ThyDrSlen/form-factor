import type { RepBoundary } from '@/lib/types/workout-definitions';

/**
 * Returns `true` when all supplied angle values are finite and non-null.
 * This is the canonical check the runtime should use before forwarding
 * angles to the phase FSM / rep detector.
 */
export function isValidAngle(value: number | null | undefined): boolean {
  return value != null && Number.isFinite(value);
}

/**
 * Returns `true` when *every* angle in the record is valid (finite, non-null).
 * A single NaN / null / undefined means tracking is lost for this frame.
 */
export function areAnglesValid(angles: Record<string, number | null | undefined>): boolean {
  const values = Object.values(angles);
  if (values.length === 0) return false;
  return values.every(isValidAngle);
}

/** Phase stuck timeout constant — matches FSM_PHASE_TIMEOUT_MS in phase-fsm.ts */
export const PHASE_TIMEOUT_MS = 5000;

interface PhaseTimeoutTracker {
  /** Call each frame. Returns true if the phase timed out and was reset. */
  check(currentPhase: string, nowMs: number): boolean;
  reset(): void;
}

/**
 * If a phase has not changed for longer than PHASE_TIMEOUT_MS, the FSM is
 * considered stuck. Returns true on the frame where timeout fires.
 */
export function createPhaseTimeoutTracker(initialPhase: string): PhaseTimeoutTracker {
  let lastPhase = initialPhase;
  let phaseEnteredAt = Date.now();

  return {
    check(currentPhase: string, nowMs: number): boolean {
      if (currentPhase !== lastPhase) {
        lastPhase = currentPhase;
        phaseEnteredAt = nowMs;
        return false;
      }
      if (currentPhase === 'idle' || currentPhase === 'setup') return false;
      const elapsed = nowMs - phaseEnteredAt;
      if (elapsed > PHASE_TIMEOUT_MS) {
        phaseEnteredAt = nowMs;
        return true;
      }
      return false;
    },
    reset() {
      lastPhase = 'idle';
      phaseEnteredAt = Date.now();
    },
  };
}

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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function computeAdaptiveRepDurationMs(input: {
  baseMinDurationMs: number;
  recentRepDurationsMs: number[];
  trackingQuality?: number;
}): number {
  const base = Math.max(120, input.baseMinDurationMs);
  const durations = input.recentRepDurationsMs.filter((value) => Number.isFinite(value) && value > 0);
  const trackingQuality = clamp(input.trackingQuality ?? 1, 0, 1);

  let adaptive = base;
  if (durations.length > 0) {
    const avgDuration = durations.reduce((sum, value) => sum + value, 0) / durations.length;
    const cadenceCandidate = avgDuration * 0.45;
    adaptive = clamp(cadenceCandidate, base * 0.65, base * 1.6);
  }

  const qualityPenaltyScale = 1 + (1 - trackingQuality) * 0.35;
  return Math.round(clamp(adaptive * qualityPenaltyScale, 120, base * 2));
}

export function computeAdaptivePhaseHoldMs(input: {
  trackingQuality?: number;
  shadowMeanAbsDelta?: number | null;
}): number {
  const trackingQuality = clamp(input.trackingQuality ?? 1, 0, 1);
  const shadowDelta = typeof input.shadowMeanAbsDelta === 'number' && Number.isFinite(input.shadowMeanAbsDelta)
    ? clamp(input.shadowMeanAbsDelta, 0, 60)
    : 0;

  const qualityTerm = (1 - trackingQuality) * 120;
  const shadowTerm = shadowDelta * 2;
  return Math.round(clamp(40 + qualityTerm + shadowTerm, 40, 220));
}
