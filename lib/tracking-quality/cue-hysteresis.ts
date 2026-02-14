export type CueHysteresisControllerOptions = {
  showFrames: number;
  hideFrames: number;
};

type CueRuntimeState = {
  active: boolean;
  showCount: number;
  hideCount: number;
};

function assertPositiveInt(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer (got ${String(value)})`);
  }
}

export class CueHysteresisController<K extends string = string> {
  private readonly showFrames: number;
  private readonly hideFrames: number;
  private readonly runtime = new Map<K, CueRuntimeState>();

  constructor(options: CueHysteresisControllerOptions) {
    assertPositiveInt('showFrames', options.showFrames);
    assertPositiveInt('hideFrames', options.hideFrames);
    this.showFrames = options.showFrames;
    this.hideFrames = options.hideFrames;
  }

  resetAll(): void {
    this.runtime.clear();
  }

  resetCue(key: K): void {
    this.runtime.delete(key);
  }

  isActive(key: K): boolean {
    return this.runtime.get(key)?.active ?? false;
  }

  getRuntimeState(key: K): CueRuntimeState | null {
    const state = this.runtime.get(key);
    return state ? { ...state } : null;
  }

  stepSelected(rawCue: K | null): void {
    if (rawCue !== null && !this.runtime.has(rawCue)) {
      this.runtime.set(rawCue, { active: false, showCount: 0, hideCount: 0 });
    }

    for (const [key, state] of this.runtime) {
      const isTrue = rawCue !== null && key === rawCue;
      this.apply(key, state, isTrue);
    }
  }

  nextStableSelectedCue(input: { rawCue: K | null; previousStableCue: K | null }): K | null {
    this.stepSelected(input.rawCue);

    if (input.rawCue !== null && this.isActive(input.rawCue)) {
      return input.rawCue;
    }
    if (input.previousStableCue !== null && this.isActive(input.previousStableCue)) {
      return input.previousStableCue;
    }
    return null;
  }

  private apply(key: K, state: CueRuntimeState, isTrue: boolean): void {
    if (state.active) {
      if (isTrue) {
        state.hideCount = 0;
        state.showCount = 0;
        return;
      }

      state.hideCount += 1;
      state.showCount = 0;
      if (state.hideCount >= this.hideFrames) {
        state.active = false;
        state.hideCount = 0;
        state.showCount = 0;
      }
      return;
    }

    if (!isTrue) {
      state.showCount = 0;
      state.hideCount = 0;
      return;
    }

    state.showCount += 1;
    state.hideCount = 0;
    if (state.showCount >= this.showFrames) {
      state.active = true;
      state.showCount = 0;
      state.hideCount = 0;
    }
  }
}
