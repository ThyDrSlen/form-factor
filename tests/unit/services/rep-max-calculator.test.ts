import {
  bestOneRepMaxFromHistory,
  brzyckiOneRepMax,
  epleyOneRepMax,
  estimateOneRepMax,
  estimateOneRepMaxAveraged,
  lombardiOneRepMax,
  repsToConfidence,
} from '../../../lib/services/rep-max-calculator';

describe('rep-max-calculator', () => {
  describe('epleyOneRepMax', () => {
    it('returns the weight itself at 1 rep', () => {
      expect(epleyOneRepMax(200, 1)).toBe(200);
    });

    it('matches the published Epley formula at 5 reps @ 225lb', () => {
      // 225 * (1 + 5/30) = 262.5
      expect(epleyOneRepMax(225, 5)).toBeCloseTo(262.5, 1);
    });

    it('scales linearly with weight', () => {
      const low = epleyOneRepMax(100, 10);
      const high = epleyOneRepMax(200, 10);
      expect(high).toBeCloseTo(low * 2, 1);
    });
  });

  describe('brzyckiOneRepMax', () => {
    it('returns the weight itself at 1 rep', () => {
      expect(brzyckiOneRepMax(200, 1)).toBe(200);
    });

    it('matches published Brzycki formula at 5 reps @ 225lb', () => {
      // 225 * 36 / (37 - 5) = 225 * 36 / 32 = 253.125
      expect(brzyckiOneRepMax(225, 5)).toBeCloseTo(253.13, 1);
    });

    it('clamps reps >= 37 to prevent divide-by-zero', () => {
      expect(Number.isFinite(brzyckiOneRepMax(100, 40))).toBe(true);
    });
  });

  describe('lombardiOneRepMax', () => {
    it('returns the weight itself at 1 rep', () => {
      expect(lombardiOneRepMax(200, 1)).toBe(200);
    });

    it('matches published Lombardi formula at 5 reps @ 225lb', () => {
      // 225 * 5^0.1 ≈ 225 * 1.1746 ≈ 264.3
      expect(lombardiOneRepMax(225, 5)).toBeCloseTo(264.29, 1);
    });

    it('grows monotonically in reps', () => {
      expect(lombardiOneRepMax(100, 10)).toBeGreaterThan(lombardiOneRepMax(100, 5));
    });
  });

  describe('repsToConfidence', () => {
    it('returns 1.0 for a 1-rep set (ground truth)', () => {
      expect(repsToConfidence(1)).toBe(1);
    });

    it('decreases monotonically as reps grow', () => {
      const bands = [1, 3, 6, 10, 15, 20, 25].map(repsToConfidence);
      for (let i = 1; i < bands.length; i++) {
        expect(bands[i]).toBeLessThanOrEqual(bands[i - 1]);
      }
    });

    it('returns 0 for invalid reps', () => {
      expect(repsToConfidence(0)).toBe(0);
      expect(repsToConfidence(-3)).toBe(0);
      expect(repsToConfidence(3.5)).toBe(0);
    });
  });

  describe('estimateOneRepMax', () => {
    it('uses Epley by default', () => {
      const epley = estimateOneRepMax({ weight: 225, reps: 5 });
      expect(epley.formula).toBe('epley');
      expect(epley.oneRepMax).toBeCloseTo(262.5, 1);
    });

    it('switches to Brzycki when requested', () => {
      const brzycki = estimateOneRepMax({ weight: 225, reps: 5 }, 'brzycki');
      expect(brzycki.formula).toBe('brzycki');
      expect(brzycki.oneRepMax).toBeCloseTo(253.13, 1);
    });

    it('switches to Lombardi when requested', () => {
      const lombardi = estimateOneRepMax({ weight: 225, reps: 5 }, 'lombardi');
      expect(lombardi.formula).toBe('lombardi');
      expect(lombardi.oneRepMax).toBeCloseTo(264.29, 1);
    });

    it('returns 0 for invalid input', () => {
      expect(estimateOneRepMax({ weight: 0, reps: 5 }).oneRepMax).toBe(0);
      expect(estimateOneRepMax({ weight: 100, reps: 0 }).oneRepMax).toBe(0);
      expect(estimateOneRepMax({ weight: 100, reps: 1.5 }).oneRepMax).toBe(0);
      expect(estimateOneRepMax({ weight: Number.NaN, reps: 5 }).oneRepMax).toBe(0);
    });

    it('includes a confidence band', () => {
      const low = estimateOneRepMax({ weight: 100, reps: 20 });
      const mid = estimateOneRepMax({ weight: 100, reps: 5 });
      expect(mid.confidence).toBeGreaterThan(low.confidence);
    });
  });

  describe('estimateOneRepMaxAveraged', () => {
    it('returns the arithmetic mean of the three estimators', () => {
      const averaged = estimateOneRepMaxAveraged({ weight: 225, reps: 5 });
      const expected =
        (epleyOneRepMax(225, 5) +
          brzyckiOneRepMax(225, 5) +
          lombardiOneRepMax(225, 5)) /
        3;
      expect(averaged.oneRepMax).toBeCloseTo(expected, 1);
      expect(averaged.perFormula.epley).toBeCloseTo(262.5, 1);
      expect(averaged.perFormula.brzycki).toBeCloseTo(253.13, 1);
      expect(averaged.perFormula.lombardi).toBeCloseTo(264.29, 1);
    });

    it('returns zeros for invalid input', () => {
      const empty = estimateOneRepMaxAveraged({ weight: 0, reps: 0 });
      expect(empty.oneRepMax).toBe(0);
      expect(empty.confidence).toBe(0);
      expect(empty.perFormula.epley).toBe(0);
    });
  });

  describe('bestOneRepMaxFromHistory', () => {
    it('returns null on an empty history', () => {
      expect(bestOneRepMaxFromHistory([])).toBeNull();
    });

    it('picks the highest 1RM across multiple sets', () => {
      const history = [
        { weight: 185, reps: 5 }, // epley ~215.83
        { weight: 225, reps: 3 }, // epley ~247.5
        { weight: 205, reps: 8 }, // epley ~259.67
      ];
      const best = bestOneRepMaxFromHistory(history);
      expect(best).not.toBeNull();
      expect(best?.oneRepMax).toBeCloseTo(259.67, 1);
    });

    it('ignores invalid entries', () => {
      const best = bestOneRepMaxFromHistory([
        { weight: 0, reps: 0 },
        { weight: 100, reps: 10 },
      ]);
      expect(best?.oneRepMax).toBeCloseTo(133.33, 1);
    });
  });
});
