import {
  detectAllPrs,
  detectFiveRepMaxPr,
  detectOneRepMaxPr,
  detectThreeRepMaxPr,
  detectVolumePr,
  triggeredPrs,
} from '../../../lib/services/pr-detector-overload';

describe('pr-detector categories', () => {
  describe('1RM category', () => {
    it('flags a new 1RM when estimated max beats prior history', () => {
      const result = detectOneRepMaxPr(
        { weight: 250, reps: 3 },
        [{ weight: 225, reps: 5 }],
      );
      expect(result.category).toBe('one_rep_max');
      expect(result.isPr).toBe(true);
      expect(result.current).toBeGreaterThan(result.previous ?? 0);
    });

    it('does not flag when estimated max is lower', () => {
      const result = detectOneRepMaxPr(
        { weight: 135, reps: 5 },
        [{ weight: 225, reps: 5 }],
      );
      expect(result.isPr).toBe(false);
    });

    it('flags first-ever set as a PR (null previous)', () => {
      const result = detectOneRepMaxPr({ weight: 135, reps: 5 }, []);
      expect(result.previous).toBeNull();
      expect(result.isPr).toBe(true);
      expect(result.delta).toBeGreaterThan(0);
    });

    it('rejects invalid current sets', () => {
      const result = detectOneRepMaxPr({ weight: 0, reps: 0 }, []);
      expect(result.isPr).toBe(false);
    });
  });

  describe('3RM category', () => {
    it('flags new 3RM when weight at 3 reps exceeds history', () => {
      const result = detectThreeRepMaxPr(
        { weight: 255, reps: 3 },
        [
          { weight: 245, reps: 3 },
          { weight: 225, reps: 5 },
        ],
      );
      expect(result.category).toBe('three_rep_max');
      expect(result.isPr).toBe(true);
      expect(result.current).toBe(255);
      expect(result.previous).toBe(245);
    });

    it('skips when current set is not at exactly 3 reps', () => {
      const result = detectThreeRepMaxPr(
        { weight: 255, reps: 5 },
        [{ weight: 245, reps: 3 }],
      );
      expect(result.isPr).toBe(false);
      expect(result.label).toMatch(/requires a set at exactly 3 reps/);
    });

    it('ignores history sets at other rep counts', () => {
      const result = detectThreeRepMaxPr(
        { weight: 220, reps: 3 },
        [{ weight: 250, reps: 5 }],
      );
      expect(result.isPr).toBe(true);
      expect(result.previous).toBeNull();
    });
  });

  describe('5RM category', () => {
    it('flags new 5RM against prior 5s', () => {
      const result = detectFiveRepMaxPr(
        { weight: 210, reps: 5 },
        [
          { weight: 205, reps: 5 },
          { weight: 185, reps: 5 },
        ],
      );
      expect(result.category).toBe('five_rep_max');
      expect(result.isPr).toBe(true);
      expect(result.previous).toBe(205);
    });

    it('does not flag on ties', () => {
      const result = detectFiveRepMaxPr(
        { weight: 205, reps: 5 },
        [{ weight: 205, reps: 5 }],
      );
      expect(result.isPr).toBe(false);
    });

    it('first-ever 5-rep set is a PR', () => {
      const result = detectFiveRepMaxPr({ weight: 135, reps: 5 }, []);
      expect(result.previous).toBeNull();
      expect(result.isPr).toBe(true);
    });
  });

  describe('volume category', () => {
    it('flags new volume PR when (weight * reps) beats history', () => {
      const result = detectVolumePr(
        { weight: 200, reps: 8 }, // 1600
        [
          { weight: 185, reps: 8 }, // 1480
          { weight: 225, reps: 5 }, // 1125
        ],
      );
      expect(result.category).toBe('volume');
      expect(result.isPr).toBe(true);
      expect(result.current).toBe(1600);
      expect(result.previous).toBe(1480);
    });

    it('does not flag when volume is lower', () => {
      const result = detectVolumePr(
        { weight: 135, reps: 8 },
        [{ weight: 200, reps: 8 }],
      );
      expect(result.isPr).toBe(false);
    });

    it('includes volume in the label', () => {
      const result = detectVolumePr(
        { weight: 200, reps: 8 },
        [{ weight: 185, reps: 8 }],
      );
      expect(result.label).toMatch(/Volume 1600/);
    });
  });

  describe('detectAllPrs / triggeredPrs', () => {
    it('returns four category results regardless of triggers', () => {
      const all = detectAllPrs({ weight: 225, reps: 5 }, []);
      expect(all.map((r) => r.category)).toEqual([
        'one_rep_max',
        'three_rep_max',
        'five_rep_max',
        'volume',
      ]);
    });

    it('triggeredPrs filters out non-PR categories', () => {
      const history = [
        { weight: 225, reps: 5 }, // 5RM baseline
        { weight: 205, reps: 3 }, // 3RM baseline
      ];
      // New set: heavier 5 that beats 5RM, volume, and 1RM but isn't a 3-rep set.
      const results = triggeredPrs({ weight: 230, reps: 5 }, history);
      const categories = results.map((r) => r.category);
      expect(categories).toContain('five_rep_max');
      expect(categories).toContain('volume');
      expect(categories).toContain('one_rep_max');
      expect(categories).not.toContain('three_rep_max');
    });
  });
});
