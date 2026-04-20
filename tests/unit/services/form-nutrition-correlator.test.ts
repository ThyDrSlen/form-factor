import {
  correlateNutritionWithForm,
  type FormSession,
} from '@/lib/services/form-nutrition-correlator';
import type { FoodEntry } from '@/contexts/FoodContext';

function ts(dayOffset: number, hour = 9): string {
  const d = new Date('2026-01-01T00:00:00.000Z');
  d.setUTCDate(d.getUTCDate() + dayOffset);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

function mkSession(day: number, avgFqi: number): FormSession {
  return { id: `s-${day}`, startAt: ts(day, 9), avgFqi };
}

function mkFood(
  day: number,
  hour: number,
  overrides: Partial<FoodEntry> = {},
): FoodEntry {
  return {
    id: `f-${day}-${hour}`,
    name: 'meal',
    calories: 400,
    protein: 20,
    carbs: 50,
    fat: 10,
    date: ts(day, hour),
    ...overrides,
  };
}

describe('correlateNutritionWithForm', () => {
  it('returns graceful zeros on empty input', () => {
    const result = correlateNutritionWithForm([], []);
    expect(result.sampleCount).toBe(0);
    expect(result.insights).toEqual([]);
    expect(result.proteinVsFqi.r).toBe(0);
    expect(result.proteinVsFqi.significance).toBe('low');
  });

  it('returns graceful zeros when sessions exist but no food', () => {
    const sessions = Array.from({ length: 5 }, (_, i) => mkSession(i, 80));
    const result = correlateNutritionWithForm(sessions, []);
    expect(result.sampleCount).toBe(0);
  });

  it('detects strong positive protein / FQI correlation from injected data', () => {
    const sessions: FormSession[] = [];
    const foods: FoodEntry[] = [];
    // 30 days: protein ramps 10..40g, FQI ramps linearly with protein
    for (let day = 0; day < 30; day++) {
      const protein = 10 + day; // 10 .. 39
      const fqi = 70 + day * 0.6; // 70 .. 87.4
      sessions.push(mkSession(day, fqi));
      foods.push(mkFood(day, 8, { protein, calories: 500, carbs: 50, fat: 10 }));
    }
    const result = correlateNutritionWithForm(sessions, foods, { windowHours: 3 });
    expect(result.sampleCount).toBe(30);
    expect(result.proteinVsFqi.r).toBeGreaterThan(0.9);
    expect(result.proteinVsFqi.r2).toBeGreaterThan(0.8);
    expect(result.proteinVsFqi.significance).toBe('high');
    const proteinInsight = result.insights.find((i) => i.id === 'protein_high');
    expect(proteinInsight).toBeDefined();
    expect(proteinInsight!.description).toMatch(/protein/);
  });

  it('returns a weak correlation for uncorrelated synthetic data', () => {
    const sessions: FormSession[] = [];
    const foods: FoodEntry[] = [];
    // Deterministic pseudo-random-ish but uncorrelated pattern.
    for (let day = 0; day < 30; day++) {
      const protein = 20 + ((day * 7) % 11); // 20..30 cycle
      const fqi = 80 + ((day * 13) % 5); // 80..84 cycle with different period
      sessions.push(mkSession(day, fqi));
      foods.push(mkFood(day, 8, { protein, calories: 500, carbs: 50, fat: 10 }));
    }
    const result = correlateNutritionWithForm(sessions, foods, { windowHours: 3 });
    expect(result.sampleCount).toBe(30);
    expect(Math.abs(result.proteinVsFqi.r)).toBeLessThan(0.3);
  });

  it('only counts meals inside the window for features', () => {
    // One session on day 0 at 09:00 — a meal at 08:00 is in window,
    // a meal at 22:00 is outside the 3h window.
    const sessions = [mkSession(0, 85)];
    const foods = [
      mkFood(0, 8, { protein: 40, calories: 500 }),
      mkFood(0, 22, { protein: 90, calories: 800 }),
    ];
    const result = correlateNutritionWithForm(sessions, foods, { windowHours: 3 });
    // Only the in-window meal should contribute — but sample count is 1,
    // so pearson can't compute and we fall back to 0 r / 0 slope.
    expect(result.sampleCount).toBe(1);
    expect(result.proteinVsFqi.r).toBe(0);
  });

  it('meal proximity feature reflects closeness', () => {
    const sessions: FormSession[] = [];
    const foods: FoodEntry[] = [];
    // 10 sessions. Half have a meal ~15min before session (tight proximity),
    // half have a meal ~2h50min before session (far proximity).
    for (let day = 0; day < 10; day++) {
      const isClose = day % 2 === 0;
      sessions.push(mkSession(day, isClose ? 88 : 75));
      foods.push(
        mkFood(day, isClose ? 8 : 6, {
          protein: 30,
          calories: 500,
        }),
      );
    }
    // Session is at 09:00; "close" meal @08:45 (15min), "far" meal @06:10 (170min)
    // Actually 06:00 -> 180min, within 3h window.
    const result = correlateNutritionWithForm(sessions, foods, { windowHours: 3 });
    const proximity = result.insights.find((i) => i.id === 'meal_proximity');
    expect(proximity).toBeDefined();
    // Closer meal correlates with higher FQI → slope should be negative.
    expect(result.mealProximityMinVsFqi.slope).toBeLessThan(0);
    expect(result.mealProximityMinVsFqi.r).toBeLessThan(0);
  });

  it('skips sessions with null avgFqi', () => {
    const sessions: FormSession[] = [
      mkSession(0, 80),
      { id: 'null-session', startAt: ts(1, 9), avgFqi: null },
      mkSession(2, 85),
    ];
    const foods = [mkFood(0, 8), mkFood(1, 8), mkFood(2, 8)];
    const result = correlateNutritionWithForm(sessions, foods, { windowHours: 3 });
    expect(result.sampleCount).toBe(2);
  });
});
