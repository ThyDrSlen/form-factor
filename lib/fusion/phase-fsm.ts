import type { Phase } from '@/lib/fusion/contracts';

const ALLOWED_TRANSITIONS: Record<Phase, Phase[]> = {
  setup: ['top', 'eccentric'],
  top: ['eccentric'],
  eccentric: ['bottom'],
  bottom: ['concentric'],
  concentric: ['top', 'eccentric'],
};

/** Default tracking-loss timeout: reset to setup after 1 000 ms of null angles. */
const DEFAULT_TRACKING_LOSS_TIMEOUT_MS = 1_000;

/** Phase stuck timeout: reset after 5 s in any non-setup phase without transition. */
export const FSM_PHASE_TIMEOUT_MS = 5000;

export interface PhaseFsm {
  current(): Phase;
  transition(next: Phase, nowMs?: number): boolean;
  repCount(): number;

  /** Check for phase timeout — if stuck in a phase for > FSM_PHASE_TIMEOUT_MS, reset to setup.
   *  @returns true if the FSM was reset. */
  tick(nowMs: number): boolean;

  /**
   * Notify the FSM that tracking data is absent for the current frame.
   * After `trackingLossTimeoutMs` of continuous loss the FSM resets to
   * `setup` so the next rep can begin cleanly.
   *
   * @returns `true` if the FSM was reset as a result of this call.
   */
  reportTrackingLost(nowMs: number): boolean;

  /**
   * Notify the FSM that valid tracking data has been received.
   * Clears the tracking-loss timer.
   */
  reportTrackingRestored(): void;
}

class DefaultPhaseFsm implements PhaseFsm {
  private phase: Phase;
  private reps: number;

  /** Timestamp when tracking was first lost, or null when tracking is active. */
  private trackingLostSince: number | null = null;

  /** Timestamp when the current phase started (for stuck-phase timeout). */
  private phaseEnteredAt: number = Date.now();

  private readonly trackingLossTimeoutMs: number;

  constructor(initialPhase: Phase, trackingLossTimeoutMs?: number) {
    this.phase = initialPhase;
    this.reps = 0;
    this.trackingLossTimeoutMs = trackingLossTimeoutMs ?? DEFAULT_TRACKING_LOSS_TIMEOUT_MS;
  }

  current(): Phase {
    return this.phase;
  }

  repCount(): number {
    return this.reps;
  }

  transition(next: Phase, nowMs?: number): boolean {
    if (next === this.phase) {
      return true;
    }

    const allowed = ALLOWED_TRANSITIONS[this.phase];
    if (!allowed.includes(next)) {
      return false;
    }

    if (this.phase === 'bottom' && next === 'concentric') {
      this.reps += 1;
    }

    this.phase = next;
    this.phaseEnteredAt = nowMs ?? Date.now();
    return true;
  }

  tick(nowMs: number): boolean {
    if (this.phase === 'setup') return false;
    const elapsed = nowMs - this.phaseEnteredAt;
    if (elapsed > FSM_PHASE_TIMEOUT_MS) {
      console.warn(
        `${new Date().toISOString()} [PhaseFSM] Phase timeout: stuck in ${this.phase} for ${elapsed}ms, resetting to setup`,
      );
      this.phase = 'setup';
      this.phaseEnteredAt = nowMs;
      return true;
    }
    return false;
  }

  reportTrackingLost(nowMs: number): boolean {
    if (this.trackingLostSince === null) {
      this.trackingLostSince = nowMs;
    }

    const elapsed = nowMs - this.trackingLostSince;
    if (elapsed >= this.trackingLossTimeoutMs && this.phase !== 'setup') {
      this.phase = 'setup';
      this.trackingLostSince = null;
      return true;
    }

    return false;
  }

  reportTrackingRestored(): void {
    this.trackingLostSince = null;
  }
}

export function createPhaseFsm(
  initialPhase: Phase = 'setup',
  trackingLossTimeoutMs?: number,
): PhaseFsm {
  return new DefaultPhaseFsm(initialPhase, trackingLossTimeoutMs);
}
