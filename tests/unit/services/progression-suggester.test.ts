import {
  suggestNextWeight,
  FQI_DELOAD_THRESHOLD,
  FQI_INCREMENT_THRESHOLD,
  type Suggestion,
} from '@/lib/services/progression-suggester';

describe('progression-suggester', () => {
  describe('increment path (FQI >= 90)', () => {
    it('adds 5 lb when unit is lb', () => {
      const s = suggestNextWeight('pullup', 95, 100, 'lb');
      expect(s.rationale).toBe('increment');
      expect(s.nextWeight).toBe(105);
      expect(s.reason).toMatch(/\+5 lb/);
      expect(s.reason).toMatch(/95% FQI/);
    });

    it('adds 2.5 kg when unit is kg', () => {
      const s = suggestNextWeight('squat', 92, 100, 'kg');
      expect(s.rationale).toBe('increment');
      expect(s.nextWeight).toBe(102.5);
      expect(s.reason).toMatch(/\+2\.5 kg/);
    });

    it('treats the 90 boundary as increment', () => {
      const s = suggestNextWeight('pullup', FQI_INCREMENT_THRESHOLD, 50);
      expect(s.rationale).toBe('increment');
      expect(s.nextWeight).toBe(55);
    });

    it('clamps FQI above 100 to 100 in the reason string', () => {
      const s = suggestNextWeight('pullup', 120, 50);
      expect(s.rationale).toBe('increment');
      expect(s.reason).toMatch(/100% FQI/);
    });
  });

  describe('maintain path (75 <= FQI < 90)', () => {
    it('keeps the same weight at FQI 80', () => {
      const s = suggestNextWeight('pullup', 80, 70, 'lb');
      expect(s.rationale).toBe('maintain');
      expect(s.nextWeight).toBe(70);
      expect(s.reason).toMatch(/maintain/i);
    });

    it('keeps the same weight at the lower boundary 75', () => {
      const s = suggestNextWeight('pullup', FQI_DELOAD_THRESHOLD, 70);
      expect(s.rationale).toBe('maintain');
      expect(s.nextWeight).toBe(70);
    });

    it('keeps the same weight just below the 90 boundary', () => {
      const s = suggestNextWeight('pullup', 89.9, 70);
      expect(s.rationale).toBe('maintain');
      expect(s.nextWeight).toBe(70);
    });
  });

  describe('deload path (FQI < 75)', () => {
    it('cuts 10 % and rounds to plate', () => {
      const s = suggestNextWeight('squat', 60, 100, 'lb');
      // 100 * 0.9 = 90, rounded to 2.5 lb plate = 90
      expect(s.rationale).toBe('deload');
      expect(s.nextWeight).toBe(90);
      expect(s.reason).toMatch(/deload/i);
    });

    it('rounds to 1.25 kg plate for kg unit', () => {
      // 45 * 0.9 = 40.5 → nearest 1.25 = 40
      const s = suggestNextWeight('squat', 50, 45, 'kg');
      expect(s.rationale).toBe('deload');
      expect(s.nextWeight).toBe(40);
    });

    it('never produces a negative weight', () => {
      const s = suggestNextWeight('squat', 10, 0, 'lb');
      expect(s.nextWeight).toBeGreaterThanOrEqual(0);
    });
  });

  describe('guards', () => {
    it('returns maintain with last weight when FQI is NaN', () => {
      const s = suggestNextWeight('pullup', Number.NaN, 50, 'lb');
      expect(s.rationale).toBe('maintain');
      expect(s.nextWeight).toBe(50);
      expect(s.reason).toMatch(/unavailable/i);
    });

    it('returns maintain with last weight when FQI is negative', () => {
      const s = suggestNextWeight('pullup', -10, 50);
      expect(s.rationale).toBe('maintain');
      expect(s.nextWeight).toBe(50);
    });

    it('returns zero + maintain when lastWeight is NaN', () => {
      const s = suggestNextWeight('pullup', 90, Number.NaN);
      expect(s.rationale).toBe('maintain');
      expect(s.nextWeight).toBe(0);
      expect(s.reason).toMatch(/enter your working weight/i);
    });

    it('returns zero + maintain when lastWeight is negative', () => {
      const s = suggestNextWeight('pullup', 95, -50);
      expect(s.rationale).toBe('maintain');
      expect(s.nextWeight).toBe(0);
    });

    it('returns maintain when exerciseId is empty', () => {
      const s = suggestNextWeight('', 95, 50);
      expect(s.rationale).toBe('maintain');
      expect(s.nextWeight).toBe(50);
      expect(s.reason).toMatch(/missing exercise/i);
    });

    it('defaults to lb when unit omitted', () => {
      const s = suggestNextWeight('pullup', 95, 100);
      expect(s.reason).toMatch(/lb/);
      expect(s.nextWeight).toBe(105);
    });

    it('normalises invalid unit to lb', () => {
      // @ts-expect-error — runtime guard
      const s = suggestNextWeight('pullup', 95, 100, 'stones');
      expect(s.nextWeight).toBe(105);
      expect(s.reason).toMatch(/lb/);
    });
  });

  describe('return shape', () => {
    it('satisfies the Suggestion type', () => {
      const s: Suggestion = suggestNextWeight('pullup', 95, 100);
      expect(typeof s.nextWeight).toBe('number');
      expect(['increment', 'maintain', 'deload']).toContain(s.rationale);
      expect(typeof s.reason).toBe('string');
    });
  });
});
