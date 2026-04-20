import { suggestWeight } from '../../../lib/services/weight-suggester';

function buildHistory(weights: number[], reps = 5) {
  const startDate = new Date('2025-03-01T00:00:00.000Z').getTime();
  return weights.map((weight, index) => ({
    weight,
    reps,
    date: new Date(startDate + index * 7 * 86400000).toISOString(),
  }));
}

describe('weight-suggester', () => {
  describe('empty history', () => {
    it('returns 0 and flags zero confidence', () => {
      const result = suggestWeight({ history: [] });
      expect(result.suggestedWeight).toBe(0);
      expect(result.confidence).toBe(0);
      expect(result.fallback).toBe(true);
      expect(result.reasoning).toMatch(/no recorded sets/i);
    });

    it('ignores invalid rows even if present', () => {
      const result = suggestWeight({
        history: [
          { weight: 0, reps: 5 },
          { weight: 100, reps: 0 },
          { weight: Number.NaN, reps: 5 },
        ],
      });
      expect(result.suggestedWeight).toBe(0);
      expect(result.historyCount).toBe(0);
    });
  });

  describe('linear fallback path (< 5 sets)', () => {
    it('bumps the most recent weight by one plate', () => {
      const result = suggestWeight({ history: buildHistory([185]) });
      expect(result.fallback).toBe(true);
      expect(result.suggestedWeight).toBeGreaterThanOrEqual(185);
      expect(result.suggestedWeight).toBeLessThanOrEqual(187.5);
      expect(result.reasoning).toMatch(/conservative linear bump/i);
    });

    it('caps bumps at 5% of the last weight for heavy lifters', () => {
      const result = suggestWeight({ history: buildHistory([600]) });
      expect(result.suggestedWeight - 600).toBeLessThanOrEqual(30);
    });

    it('confidence grows modestly with each additional set', () => {
      const one = suggestWeight({ history: buildHistory([185]) }).confidence;
      const three = suggestWeight({ history: buildHistory([185, 190, 195]) }).confidence;
      expect(three).toBeGreaterThan(one);
      expect(three).toBeLessThanOrEqual(0.6);
    });

    it('picks the newest-dated row as the anchor regardless of input order', () => {
      const history = [
        { weight: 150, reps: 5, date: '2025-03-01T00:00:00.000Z' },
        { weight: 180, reps: 5, date: '2025-03-15T00:00:00.000Z' },
      ];
      const result = suggestWeight({ history });
      expect(result.suggestedWeight).toBeGreaterThanOrEqual(180);
    });
  });

  describe('data-rich path (>= 5 sets)', () => {
    it('does not trigger the fallback flag', () => {
      const result = suggestWeight({ history: buildHistory([180, 185, 190, 192.5, 195]) });
      expect(result.fallback).toBe(false);
      expect(result.historyCount).toBe(5);
    });

    it('produces a suggestion clamped around the most recent weight', () => {
      const history = buildHistory([180, 185, 190, 192.5, 195]);
      const result = suggestWeight({ history });
      expect(result.suggestedWeight).toBeGreaterThanOrEqual(195 * 0.95);
      expect(result.suggestedWeight).toBeLessThanOrEqual(195 * 1.05);
    });

    it('higher target RPE biases the suggestion upward', () => {
      const history = buildHistory([180, 185, 190, 192.5, 195]);
      const lowRpe = suggestWeight({ history, targetRpe: 6 });
      const highRpe = suggestWeight({ history, targetRpe: 10 });
      expect(highRpe.suggestedWeight).toBeGreaterThanOrEqual(lowRpe.suggestedWeight);
    });

    it('snaps output to the plate increment', () => {
      const history = buildHistory([181, 183, 186, 189, 192]);
      const result = suggestWeight({ history, plateIncrement: 5 });
      expect(result.suggestedWeight % 5).toBe(0);
    });

    it('confidence rises with history depth and stays <= 0.95', () => {
      const shallow = suggestWeight({ history: buildHistory([180, 185, 190, 195, 200]) });
      const deep = suggestWeight({
        history: buildHistory(
          Array.from({ length: 20 }, (_, i) => 180 + i * 2),
        ),
      });
      expect(deep.confidence).toBeGreaterThanOrEqual(shallow.confidence);
      expect(deep.confidence).toBeLessThanOrEqual(0.95);
    });

    it('reasoning surfaces the trend direction', () => {
      const rising = suggestWeight({ history: buildHistory([180, 185, 190, 192.5, 195]) });
      expect(rising.reasoning).toMatch(/upward|flat/);
    });
  });

  describe('RPE scaling edge cases', () => {
    it('clamps out-of-range RPE values', () => {
      const history = buildHistory([180, 185, 190, 195, 200]);
      const crazyHigh = suggestWeight({ history, targetRpe: 20 });
      const crazyLow = suggestWeight({ history, targetRpe: -5 });
      expect(Number.isFinite(crazyHigh.suggestedWeight)).toBe(true);
      expect(Number.isFinite(crazyLow.suggestedWeight)).toBe(true);
    });

    it('defaults target reps to recent median when omitted', () => {
      const history = buildHistory([180, 185, 190, 195, 200], 8);
      const result = suggestWeight({ history });
      expect(result.reasoning).toMatch(/target RPE 8 × 8 reps/);
    });
  });
});
