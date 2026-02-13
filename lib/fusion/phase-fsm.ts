import type { Phase } from '@/lib/fusion/contracts';

const ALLOWED_TRANSITIONS: Record<Phase, Phase[]> = {
  setup: ['top', 'eccentric'],
  top: ['eccentric'],
  eccentric: ['bottom'],
  bottom: ['concentric'],
  concentric: ['top', 'eccentric'],
};

export interface PhaseFsm {
  current(): Phase;
  transition(next: Phase): boolean;
  repCount(): number;
}

class DefaultPhaseFsm implements PhaseFsm {
  private phase: Phase;
  private reps: number;

  constructor(initialPhase: Phase) {
    this.phase = initialPhase;
    this.reps = 0;
  }

  current(): Phase {
    return this.phase;
  }

  repCount(): number {
    return this.reps;
  }

  transition(next: Phase): boolean {
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
    return true;
  }
}

export function createPhaseFsm(initialPhase: Phase = 'setup'): PhaseFsm {
  return new DefaultPhaseFsm(initialPhase);
}
