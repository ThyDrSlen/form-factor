import { CueHysteresisController } from './cue-hysteresis';

describe('CueHysteresisController', () => {
  describe('constructor assertions', () => {
    it('throws when showFrames is zero', () => {
      expect(() => new CueHysteresisController({ showFrames: 0, hideFrames: 2 })).toThrow(
        /showFrames must be a positive integer/,
      );
    });

    it('throws when hideFrames is zero', () => {
      expect(() => new CueHysteresisController({ showFrames: 2, hideFrames: 0 })).toThrow(
        /hideFrames must be a positive integer/,
      );
    });

    it('throws when showFrames is negative', () => {
      expect(() => new CueHysteresisController({ showFrames: -1, hideFrames: 2 })).toThrow(
        /showFrames must be a positive integer/,
      );
    });

    it('throws when showFrames is a non-integer', () => {
      expect(() => new CueHysteresisController({ showFrames: 1.5, hideFrames: 2 })).toThrow(
        /showFrames must be a positive integer/,
      );
    });

    it('throws when hideFrames is a non-integer', () => {
      expect(() => new CueHysteresisController({ showFrames: 2, hideFrames: 2.7 })).toThrow(
        /hideFrames must be a positive integer/,
      );
    });

    it('throws when showFrames is NaN', () => {
      expect(() => new CueHysteresisController({ showFrames: NaN, hideFrames: 2 })).toThrow(
        /showFrames must be a positive integer/,
      );
    });
  });

  describe('stepActive empty input', () => {
    it('handles empty array without crashing', () => {
      const ctrl = new CueHysteresisController<'a' | 'b'>({ showFrames: 2, hideFrames: 2 });
      expect(() => ctrl.stepActive([])).not.toThrow();
      expect(ctrl.isActive('a')).toBe(false);
    });

    it('handles empty Set without crashing', () => {
      const ctrl = new CueHysteresisController<'a' | 'b'>({ showFrames: 2, hideFrames: 2 });
      expect(() => ctrl.stepActive(new Set<'a' | 'b'>())).not.toThrow();
    });

    it('preserves existing runtime state when empty input is passed', () => {
      const ctrl = new CueHysteresisController<'a'>({ showFrames: 2, hideFrames: 3 });
      ctrl.stepActive(['a']);
      ctrl.stepActive(['a']); // activate
      expect(ctrl.isActive('a')).toBe(true);

      // Empty input: nothing is active, but state for 'a' should still exist
      // and be transitioning off (hideCount increments)
      ctrl.stepActive([]);
      const state = ctrl.getRuntimeState('a');
      expect(state).not.toBeNull();
      // Cue was active; one empty frame bumps hideCount to 1 (< hideFrames=3), still active
      expect(state?.active).toBe(true);
    });
  });

  describe('Set vs Array input equivalence', () => {
    it('produces identical results for Set and Array with same cues', () => {
      const ctrlA = new CueHysteresisController<'x' | 'y'>({ showFrames: 2, hideFrames: 2 });
      const ctrlB = new CueHysteresisController<'x' | 'y'>({ showFrames: 2, hideFrames: 2 });

      const frames: ('x' | 'y')[][] = [
        ['x'],
        ['x', 'y'],
        ['y'],
        [],
        ['x'],
      ];

      for (const frame of frames) {
        ctrlA.stepActive(frame);
        ctrlB.stepActive(new Set(frame));
      }

      expect(ctrlA.isActive('x')).toBe(ctrlB.isActive('x'));
      expect(ctrlA.isActive('y')).toBe(ctrlB.isActive('y'));
      expect(ctrlA.getRuntimeState('x')).toEqual(ctrlB.getRuntimeState('x'));
      expect(ctrlA.getRuntimeState('y')).toEqual(ctrlB.getRuntimeState('y'));
    });
  });

  describe('nextStableCueFromOrderedActive multi-cue precedence', () => {
    it('returns the first cue in declared order when multiple cross threshold same frame', () => {
      const ctrl = new CueHysteresisController<'first' | 'second' | 'third'>({
        showFrames: 2,
        hideFrames: 2,
      });
      // Activate all three simultaneously across two frames.
      ctrl.stepActive(['first', 'second', 'third']);
      const result = ctrl.nextStableCueFromOrderedActive({
        orderedActiveCues: ['first', 'second', 'third'],
        previousStableCue: null,
      });
      expect(result).toBe('first');
    });

    it('respects given order even when cues arrive in different registration order', () => {
      const ctrl = new CueHysteresisController<'a' | 'b' | 'c'>({ showFrames: 1, hideFrames: 2 });
      // Register in 'c','a','b' order
      ctrl.stepActive(['c', 'a', 'b']);
      // Now query with priority order
      const result = ctrl.nextStableCueFromOrderedActive({
        orderedActiveCues: ['b', 'a', 'c'],
        previousStableCue: null,
      });
      expect(result).toBe('b');
    });
  });

  describe('previous stable cue persistence', () => {
    it('keeps previousStableCue when still active (nextStableSelectedCue)', () => {
      const ctrl = new CueHysteresisController<'a' | 'b'>({ showFrames: 1, hideFrames: 3 });
      // Activate 'a'
      ctrl.stepSelected('a');
      expect(ctrl.isActive('a')).toBe(true);

      // Raw now says 'b', but 'a' is still within hide window
      const result = ctrl.nextStableSelectedCue({ rawCue: 'b', previousStableCue: 'a' });
      expect(result).toBe('a');
    });

    it('keeps previousStableCue when still active (nextStableCueFromOrderedActive)', () => {
      const ctrl = new CueHysteresisController<'a' | 'b'>({ showFrames: 1, hideFrames: 3 });
      ctrl.stepActive(['a']);
      expect(ctrl.isActive('a')).toBe(true);

      // 'b' alone cannot become stable in one frame, but 'a' persists from prior
      const result = ctrl.nextStableCueFromOrderedActive({
        orderedActiveCues: ['b'],
        previousStableCue: 'a',
      });
      expect(result).toBe('a');
    });

    it('returns null when neither previous nor raw cue is stable', () => {
      const ctrl = new CueHysteresisController<'a' | 'b'>({ showFrames: 5, hideFrames: 2 });
      const result = ctrl.nextStableSelectedCue({ rawCue: 'a', previousStableCue: null });
      expect(result).toBe(null);
    });
  });

  describe('state reset on boundary crossing (flicker)', () => {
    it('resets hideCount when cue re-appears before hide threshold', () => {
      const ctrl = new CueHysteresisController<'a'>({ showFrames: 1, hideFrames: 4 });
      // Activate 'a'
      ctrl.stepActive(['a']);
      expect(ctrl.isActive('a')).toBe(true);

      // Miss 2 frames
      ctrl.stepActive([]);
      ctrl.stepActive([]);
      let state = ctrl.getRuntimeState('a');
      expect(state?.hideCount).toBe(2);
      expect(state?.active).toBe(true);

      // Re-appear: hideCount should reset to 0
      ctrl.stepActive(['a']);
      state = ctrl.getRuntimeState('a');
      expect(state?.hideCount).toBe(0);
      expect(state?.showCount).toBe(0);
      expect(state?.active).toBe(true);

      // Miss again: counter restarts from 0
      ctrl.stepActive([]);
      state = ctrl.getRuntimeState('a');
      expect(state?.hideCount).toBe(1);
    });

    it('resets showCount when cue disappears before show threshold', () => {
      const ctrl = new CueHysteresisController<'a'>({ showFrames: 3, hideFrames: 2 });
      // Partial show progress
      ctrl.stepActive(['a']);
      ctrl.stepActive(['a']);
      let state = ctrl.getRuntimeState('a');
      expect(state?.showCount).toBe(2);
      expect(state?.active).toBe(false);

      // Flicker off: showCount must reset to 0
      ctrl.stepActive([]);
      state = ctrl.getRuntimeState('a');
      expect(state?.showCount).toBe(0);
      expect(state?.active).toBe(false);

      // Need 3 more consecutive frames to activate, not 1
      ctrl.stepActive(['a']);
      ctrl.stepActive(['a']);
      expect(ctrl.isActive('a')).toBe(false);
      ctrl.stepActive(['a']);
      expect(ctrl.isActive('a')).toBe(true);
    });
  });

  describe('resetCue and resetAll', () => {
    it('resetCue clears per-cue state', () => {
      const ctrl = new CueHysteresisController<'a' | 'b'>({ showFrames: 1, hideFrames: 2 });
      ctrl.stepActive(['a', 'b']);
      expect(ctrl.isActive('a')).toBe(true);
      ctrl.resetCue('a');
      expect(ctrl.getRuntimeState('a')).toBeNull();
      expect(ctrl.isActive('b')).toBe(true);
    });

    it('resetAll clears all runtime state', () => {
      const ctrl = new CueHysteresisController<'a' | 'b'>({ showFrames: 1, hideFrames: 2 });
      ctrl.stepActive(['a', 'b']);
      ctrl.resetAll();
      expect(ctrl.getRuntimeState('a')).toBeNull();
      expect(ctrl.getRuntimeState('b')).toBeNull();
    });
  });
});
