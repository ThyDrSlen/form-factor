import { getFqiBand } from '@/lib/services/workout-insights-fqi-bands';

describe('workout-insights-fqi-bands', () => {
  describe('getFqiBand', () => {
    it('returns "unknown" for null/undefined/NaN', () => {
      expect(getFqiBand(null).band).toBe('unknown');
      expect(getFqiBand(undefined).band).toBe('unknown');
      expect(getFqiBand(Number.NaN).band).toBe('unknown');
      expect(getFqiBand(null).label).toBe('Not available');
    });

    it('returns "excellent" for scores >= 85', () => {
      expect(getFqiBand(100).band).toBe('excellent');
      expect(getFqiBand(85).band).toBe('excellent');
      expect(getFqiBand(85).label).toBe('Excellent');
    });

    it('returns "good" for scores in [70, 85)', () => {
      expect(getFqiBand(84.9).band).toBe('good');
      expect(getFqiBand(70).band).toBe('good');
      expect(getFqiBand(75).label).toBe('Good');
    });

    it('returns "fair" for scores in [50, 70)', () => {
      expect(getFqiBand(69.9).band).toBe('fair');
      expect(getFqiBand(50).band).toBe('fair');
      expect(getFqiBand(60).label).toBe('Fair');
    });

    it('returns "poor" for scores < 50', () => {
      expect(getFqiBand(49.9).band).toBe('poor');
      expect(getFqiBand(0).band).toBe('poor');
      expect(getFqiBand(25).label).toBe('Poor');
    });

    it('includes a color for each band', () => {
      expect(getFqiBand(90).color).toMatch(/^#/);
      expect(getFqiBand(75).color).toMatch(/^#/);
      expect(getFqiBand(60).color).toMatch(/^#/);
      expect(getFqiBand(25).color).toMatch(/^#/);
      expect(getFqiBand(null).color).toMatch(/^#/);
    });

    it('handles edge cases at band boundaries', () => {
      // Exactly 85 → excellent
      expect(getFqiBand(85).band).toBe('excellent');
      // Exactly 70 → good
      expect(getFqiBand(70).band).toBe('good');
      // Exactly 50 → fair
      expect(getFqiBand(50).band).toBe('fair');
      // 49.9 → poor
      expect(getFqiBand(49.9).band).toBe('poor');
    });
  });
});
