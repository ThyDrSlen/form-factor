import { CueHysteresisController } from '@/lib/tracking-quality/cue-hysteresis';

function countFlips(sequence: Array<string | null>): number {
  let flips = 0;
  let last: string | null = null;
  for (const value of sequence) {
    if (value === null) {
      last = null;
      continue;
    }
    if (last !== null && last !== value) {
      flips += 1;
    }
    last = value;
  }
  return flips;
}

describe('cue hysteresis', () => {
  test('shows only after SHOW_N_FRAMES consecutive truth frames', () => {
    const controller = new CueHysteresisController({ showFrames: 2, hideFrames: 3 });

    controller.stepSelected('A');
    expect(controller.isActive('A')).toBe(false);

    controller.stepSelected('A');
    expect(controller.isActive('A')).toBe(true);
  });

  test('clears only after HIDE_N_FRAMES consecutive false frames', () => {
    const controller = new CueHysteresisController({ showFrames: 2, hideFrames: 3 });

    controller.stepSelected('A');
    controller.stepSelected('A');
    expect(controller.isActive('A')).toBe(true);

    controller.stepSelected(null);
    expect(controller.isActive('A')).toBe(true);
    controller.stepSelected(null);
    expect(controller.isActive('A')).toBe(true);
    controller.stepSelected(null);
    expect(controller.isActive('A')).toBe(false);
  });

  test('resets show count when raw cue changes (non-consecutive truth does not trigger show)', () => {
    const controller = new CueHysteresisController({ showFrames: 2, hideFrames: 3 });

    controller.stepSelected('A');
    expect(controller.isActive('A')).toBe(false);

    controller.stepSelected('B');
    controller.stepSelected('A');
    expect(controller.isActive('A')).toBe(false);
  });

  test('nextStableSelectedCue holds previous stable cue during new cue show window', () => {
    const controller = new CueHysteresisController({ showFrames: 2, hideFrames: 3 });

    let stable: string | null = null;

    stable = controller.nextStableSelectedCue({ rawCue: 'A', previousStableCue: stable });
    expect(stable).toBeNull();
    stable = controller.nextStableSelectedCue({ rawCue: 'A', previousStableCue: stable });
    expect(stable).toBe('A');

    stable = controller.nextStableSelectedCue({ rawCue: 'B', previousStableCue: stable });
    expect(stable).toBe('A');
    stable = controller.nextStableSelectedCue({ rawCue: 'B', previousStableCue: stable });
    expect(stable).toBe('A');
    stable = controller.nextStableSelectedCue({ rawCue: 'B', previousStableCue: stable });
    expect(stable).toBe('B');
  });

  test('alternating raw cue never stabilizes; flip rate drops to 0', () => {
    const controller = new CueHysteresisController({ showFrames: 2, hideFrames: 3 });

    const raw: Array<string | null> = [];
    const stable: Array<string | null> = [];

    let lastStable: string | null = null;
    for (let i = 0; i < 40; i++) {
      const rawCue = i % 2 === 0 ? 'A' : 'B';
      raw.push(rawCue);
      lastStable = controller.nextStableSelectedCue({ rawCue, previousStableCue: lastStable });
      stable.push(lastStable);
    }

    const rawFlips = countFlips(raw);
    const stableFlips = countFlips(stable);
    expect(rawFlips).toBeGreaterThan(0);
    expect(stableFlips).toBe(0);
  });

  test('nextStableCueFromOrderedActive resists priority reordering chatter', () => {
    const controller = new CueHysteresisController({ showFrames: 2, hideFrames: 3 });

    let stable: string | null = null;

    stable = controller.nextStableCueFromOrderedActive({ orderedActiveCues: ['A', 'B'], previousStableCue: stable });
    expect(stable).toBeNull();
    stable = controller.nextStableCueFromOrderedActive({ orderedActiveCues: ['A', 'B'], previousStableCue: stable });
    expect(stable).toBe('A');

    stable = controller.nextStableCueFromOrderedActive({ orderedActiveCues: ['B', 'A'], previousStableCue: stable });
    expect(stable).toBe('A');

    stable = controller.nextStableCueFromOrderedActive({ orderedActiveCues: ['B'], previousStableCue: stable });
    expect(stable).toBe('A');
    stable = controller.nextStableCueFromOrderedActive({ orderedActiveCues: ['B'], previousStableCue: stable });
    expect(stable).toBe('A');
    stable = controller.nextStableCueFromOrderedActive({ orderedActiveCues: ['B'], previousStableCue: stable });
    expect(stable).toBe('B');
  });

  test('throws on invalid configuration', () => {
    expect(() => new CueHysteresisController({ showFrames: 0, hideFrames: 3 })).toThrow('showFrames');
    expect(() => new CueHysteresisController({ showFrames: 2, hideFrames: 0 })).toThrow('hideFrames');
  });
});
