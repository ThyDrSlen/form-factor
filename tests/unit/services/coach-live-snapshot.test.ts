import {
  buildLiveSessionSnapshot,
  summarizeForPrompt,
  type LiveSessionSnapshot,
} from '@/lib/services/coach-live-snapshot';

describe('coach-live-snapshot', () => {
  describe('buildLiveSessionSnapshot', () => {
    it('returns null when input is empty', () => {
      expect(buildLiveSessionSnapshot({})).toBeNull();
    });

    it('returns null when input has only whitespace strings', () => {
      expect(buildLiveSessionSnapshot({ exerciseId: '   ', exerciseName: '' })).toBeNull();
    });

    it('returns null when faults are all invalid', () => {
      expect(
        buildLiveSessionSnapshot({
          recentFaults: [
            { id: '', count: 3 },
            { id: 'fault', count: 0 },
          ],
        }),
      ).toBeNull();
    });

    it('returns shape with full input', () => {
      const snap = buildLiveSessionSnapshot({
        exerciseId: 'squat',
        exerciseName: 'Back Squat',
        currentFQI: { rom: 0.9, symmetry: 0.85, tempo: 0.75, stability: 0.8 },
        recentFaults: [
          { id: 'knee_valgus', count: 4, lastRepNumber: 7 },
          { id: 'depth_short', count: 2 },
        ],
      });
      expect(snap).toEqual({
        exerciseId: 'squat',
        exerciseName: 'Back Squat',
        currentFQI: { rom: 0.9, symmetry: 0.85, tempo: 0.75, stability: 0.8 },
        recentFaults: [
          { id: 'knee_valgus', count: 4, lastRepNumber: 7 },
          { id: 'depth_short', count: 2 },
        ],
      });
    });

    it('trims exercise id/name whitespace', () => {
      const snap = buildLiveSessionSnapshot({
        exerciseId: '  bench_press ',
        exerciseName: '  Bench Press  ',
      });
      expect(snap?.exerciseId).toBe('bench_press');
      expect(snap?.exerciseName).toBe('Bench Press');
    });

    it('returns snapshot with only FQI when no exercise is provided', () => {
      const snap = buildLiveSessionSnapshot({ currentFQI: { rom: 0.5 } });
      expect(snap).not.toBeNull();
      expect(snap?.exerciseId).toBeUndefined();
      expect(snap?.currentFQI).toEqual({ rom: 0.5 });
      expect(snap?.recentFaults).toEqual([]);
    });

    it('caps faults at 3, sorted by count desc', () => {
      const snap = buildLiveSessionSnapshot({
        exerciseName: 'Deadlift',
        recentFaults: [
          { id: 'fault_a', count: 1 },
          { id: 'fault_b', count: 5 },
          { id: 'fault_c', count: 3 },
          { id: 'fault_d', count: 7 },
          { id: 'fault_e', count: 2 },
        ],
      });
      expect(snap?.recentFaults).toHaveLength(3);
      expect(snap?.recentFaults.map((f) => f.id)).toEqual(['fault_d', 'fault_b', 'fault_c']);
    });

    it('filters out faults with zero or negative count and missing id', () => {
      const snap = buildLiveSessionSnapshot({
        exerciseName: 'Row',
        recentFaults: [
          { id: 'valid', count: 2 },
          { id: '', count: 5 },
          { id: 'neg', count: -1 },
          { id: 'zero', count: 0 },
        ],
      });
      expect(snap?.recentFaults).toEqual([{ id: 'valid', count: 2 }]);
    });

    it('ignores non-number FQI fields', () => {
      const snap = buildLiveSessionSnapshot({
        exerciseName: 'Squat',
        currentFQI: { rom: 0.9, symmetry: undefined, tempo: 0.7 },
      });
      expect(snap?.currentFQI).toEqual({ rom: 0.9, tempo: 0.7 });
    });

    it('omits currentFQI entirely when all fields missing', () => {
      const snap = buildLiveSessionSnapshot({
        exerciseName: 'Squat',
        currentFQI: {},
      });
      expect(snap?.currentFQI).toBeUndefined();
    });
  });

  describe('summarizeForPrompt', () => {
    it('returns empty string for null snapshot', () => {
      expect(summarizeForPrompt(null)).toBe('');
    });

    it('returns empty string for undefined snapshot', () => {
      expect(summarizeForPrompt(undefined)).toBe('');
    });

    it('produces expected string for full snapshot', () => {
      const snap: LiveSessionSnapshot = {
        exerciseId: 'squat',
        exerciseName: 'Back Squat',
        currentFQI: { rom: 0.9, symmetry: 0.85, tempo: 0.75, stability: 0.8 },
        recentFaults: [
          { id: 'knee_valgus', count: 4, lastRepNumber: 7 },
          { id: 'depth_short', count: 2 },
        ],
      };
      expect(summarizeForPrompt(snap)).toBe(
        'exercise=Back Squat; FQI(rom=0.90, symmetry=0.85, tempo=0.75, stability=0.80); recent faults: knee_valgus×4@rep7, depth_short×2',
      );
    });

    it('falls back to exerciseId when exerciseName missing', () => {
      const snap: LiveSessionSnapshot = {
        exerciseId: 'row',
        recentFaults: [],
      };
      expect(summarizeForPrompt(snap)).toBe('exercise=row');
    });

    it('omits FQI clause when no scores present', () => {
      const snap: LiveSessionSnapshot = {
        exerciseName: 'Deadlift',
        recentFaults: [{ id: 'back_round', count: 1 }],
      };
      expect(summarizeForPrompt(snap)).toBe('exercise=Deadlift; recent faults: back_round×1');
    });

    it('omits faults clause when empty', () => {
      const snap: LiveSessionSnapshot = {
        exerciseName: 'Plank',
        currentFQI: { stability: 0.65 },
        recentFaults: [],
      };
      expect(summarizeForPrompt(snap)).toBe('exercise=Plank; FQI(stability=0.65)');
    });
  });
});
