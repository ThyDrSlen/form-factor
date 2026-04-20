import {
  getFewShotsForFault,
  listKnownFaultIds,
} from '@/lib/services/coach-few-shots';

describe('coach-few-shots', () => {
  describe('getFewShotsForFault', () => {
    test('returns examples for known fault', () => {
      const examples = getFewShotsForFault('squat-knee-cave');
      expect(examples.length).toBeGreaterThan(0);
      expect(examples[0]).toHaveProperty('userQuestion');
      expect(examples[0]).toHaveProperty('coachAnswer');
    });

    test('trims whitespace and lowercases the fault id', () => {
      const a = getFewShotsForFault('  SQUAT-KNEE-CAVE  ');
      const b = getFewShotsForFault('squat-knee-cave');
      expect(a).toEqual(b);
    });

    test('returns empty array for unknown fault (no throw)', () => {
      expect(getFewShotsForFault('not-a-real-fault')).toEqual([]);
      expect(getFewShotsForFault('')).toEqual([]);
    });

    test('returns empty array for non-string input', () => {
      expect(getFewShotsForFault(undefined as unknown as string)).toEqual([]);
      expect(getFewShotsForFault(123 as unknown as string)).toEqual([]);
    });

    test('respects the count parameter', () => {
      const all = getFewShotsForFault('squat-knee-cave', 10);
      const one = getFewShotsForFault('squat-knee-cave', 1);
      expect(one.length).toBe(1);
      expect(one[0]).toEqual(all[0]);
    });

    test('count of 0 returns empty array', () => {
      expect(getFewShotsForFault('squat-knee-cave', 0)).toEqual([]);
    });

    test('negative count is clamped to 0', () => {
      expect(getFewShotsForFault('squat-knee-cave', -5)).toEqual([]);
    });

    test('count greater than library size returns all available', () => {
      const allSquat = getFewShotsForFault('squat-knee-cave', 100);
      expect(allSquat.length).toBeGreaterThan(0);
      expect(allSquat.length).toBeLessThanOrEqual(5);
    });
  });

  describe('library coverage', () => {
    test('listKnownFaultIds returns a sorted list of ids', () => {
      const ids = listKnownFaultIds();
      expect(ids.length).toBeGreaterThanOrEqual(10);
      const sorted = [...ids].sort();
      expect(ids).toEqual(sorted);
    });

    test('covers the five core lifts (pullup, squat, deadlift, bench, pushup)', () => {
      const ids = listKnownFaultIds();
      expect(ids.some((id) => id.startsWith('pullup-'))).toBe(true);
      expect(ids.some((id) => id.startsWith('squat-'))).toBe(true);
      expect(ids.some((id) => id.startsWith('deadlift-'))).toBe(true);
      expect(ids.some((id) => id.startsWith('bench-'))).toBe(true);
      expect(ids.some((id) => id.startsWith('pushup-'))).toBe(true);
    });

    test('every example answer stays under 80 words', () => {
      const ids = listKnownFaultIds();
      for (const id of ids) {
        const examples = getFewShotsForFault(id, 10);
        for (const ex of examples) {
          const words = ex.coachAnswer.trim().split(/\s+/).length;
          expect(words).toBeLessThanOrEqual(80);
        }
      }
    });

    test('every example has both a question and an answer', () => {
      const ids = listKnownFaultIds();
      for (const id of ids) {
        const examples = getFewShotsForFault(id, 10);
        for (const ex of examples) {
          expect(ex.userQuestion.length).toBeGreaterThan(0);
          expect(ex.coachAnswer.length).toBeGreaterThan(0);
        }
      }
    });
  });
});
