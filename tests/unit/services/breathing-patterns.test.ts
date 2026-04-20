import {
  BREATHING_PATTERNS,
  estimateCyclesInRest,
  getBreathingPattern,
  pickBreathingPattern,
} from '@/lib/services/breathing-patterns';

describe('breathing-patterns', () => {
  describe('BREATHING_PATTERNS catalog', () => {
    it('exposes five unique patterns', () => {
      const ids = BREATHING_PATTERNS.map((p) => p.id);
      expect(ids).toEqual(['box', 'four-seven-eight', 'coherent', 'bellows', 'diaphragmatic']);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('each pattern has positive cycleSeconds matching sum of phases', () => {
      for (const pattern of BREATHING_PATTERNS) {
        const actual = pattern.phases.reduce((acc, p) => acc + p.seconds, 0);
        expect(pattern.cycleSeconds).toBe(actual);
        expect(pattern.cycleSeconds).toBeGreaterThan(0);
      }
    });

    it('every phase has a cue string and positive duration', () => {
      for (const pattern of BREATHING_PATTERNS) {
        for (const phase of pattern.phases) {
          expect(phase.cue.length).toBeGreaterThan(0);
          expect(phase.seconds).toBeGreaterThan(0);
        }
      }
    });

    it('every pattern declares at least one context tag', () => {
      for (const pattern of BREATHING_PATTERNS) {
        expect(pattern.recommendedFor.length).toBeGreaterThan(0);
      }
    });
  });

  describe('getBreathingPattern', () => {
    it('returns the pattern with matching id', () => {
      expect(getBreathingPattern('box').id).toBe('box');
      expect(getBreathingPattern('coherent').id).toBe('coherent');
    });

    it('throws for unknown id', () => {
      expect(() => getBreathingPattern('unknown' as 'box')).toThrow(/Unknown breathing pattern/);
    });
  });

  describe('pickBreathingPattern', () => {
    const baseInput = {
      setType: 'normal' as const,
      setIndex: 1,
      totalSets: 4,
      restSeconds: 90,
      fatigueScore: 0.4,
    };

    it('picks 4-7-8 after a failure set', () => {
      const pick = pickBreathingPattern({ ...baseInput, setType: 'failure' });
      expect(pick.id).toBe('four-seven-eight');
    });

    it('picks 4-7-8 when fatigue is very high regardless of set type', () => {
      const pick = pickBreathingPattern({ ...baseInput, fatigueScore: 0.85 });
      expect(pick.id).toBe('four-seven-eight');
    });

    it('picks bellows for fresh warmup set', () => {
      const pick = pickBreathingPattern({
        ...baseInput,
        setType: 'warmup',
        setIndex: 0,
        fatigueScore: 0.1,
      });
      expect(pick.id).toBe('bellows');
    });

    it('picks bellows for first normal set while fresh', () => {
      const pick = pickBreathingPattern({
        ...baseInput,
        setIndex: 0,
        fatigueScore: 0.15,
      });
      expect(pick.id).toBe('bellows');
    });

    it('picks box for long rest windows', () => {
      const pick = pickBreathingPattern({ ...baseInput, restSeconds: 180 });
      expect(pick.id).toBe('box');
    });

    it('picks box for moderate fatigue even on shorter rest', () => {
      const pick = pickBreathingPattern({ ...baseInput, fatigueScore: 0.65 });
      expect(pick.id).toBe('box');
    });

    it('picks coherent for the final set', () => {
      const pick = pickBreathingPattern({ ...baseInput, setIndex: 3, totalSets: 4 });
      expect(pick.id).toBe('coherent');
    });

    it('picks coherent for medium rest windows', () => {
      const pick = pickBreathingPattern({ ...baseInput, restSeconds: 90 });
      expect(pick.id).toBe('coherent');
    });

    it('falls through to diaphragmatic for short rests in the middle of a session', () => {
      const pick = pickBreathingPattern({
        ...baseInput,
        setIndex: 2,
        totalSets: 5,
        restSeconds: 45,
        fatigueScore: 0.4,
      });
      expect(pick.id).toBe('diaphragmatic');
    });
  });

  describe('estimateCyclesInRest', () => {
    const box = getBreathingPattern('box');

    it('returns 0 when rest is zero', () => {
      expect(estimateCyclesInRest(box, 0)).toBe(0);
    });

    it('returns at least one cycle when rest > 0 but smaller than cycle', () => {
      expect(estimateCyclesInRest(box, 4)).toBe(1);
    });

    it('divides rest by cycle length for longer windows', () => {
      expect(estimateCyclesInRest(box, 64)).toBe(4);
    });

    it('returns 0 for a pattern with zero cycle seconds', () => {
      const zero = { ...box, cycleSeconds: 0, phases: [] };
      expect(estimateCyclesInRest(zero, 60)).toBe(0);
    });
  });
});
