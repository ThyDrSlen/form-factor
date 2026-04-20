import {
  detectMilestone,
  type DetectMilestoneInput,
} from '@/lib/services/form-milestone-detector';

const base = (overrides: Partial<DetectMilestoneInput> = {}): DetectMilestoneInput => ({
  exerciseKey: 'pullup',
  currentAvgFqi: 80,
  priorSessions: [],
  ...overrides,
});

describe('form-milestone-detector', () => {
  describe('new_pb', () => {
    it('fires when the current score beats the prior best by the margin', () => {
      const result = detectMilestone(
        base({
          currentAvgFqi: 92,
          priorSessions: [{ avgFqi: 88 }, { avgFqi: 85 }, { avgFqi: 80 }],
        }),
      );
      expect(result.kind).toBe('new_pb');
      expect(result.score).toBe(92);
      expect(result.message).toContain('New record');
      expect(result.message).toContain('92/100');
      expect(result.message).toContain('pullup');
    });

    it('does NOT fire when the gap is smaller than the default margin', () => {
      const result = detectMilestone(
        base({ currentAvgFqi: 89, priorSessions: [{ avgFqi: 88 }] }),
      );
      expect(result.kind).toBeNull();
    });

    it('respects a custom margin', () => {
      const result = detectMilestone(
        base({
          currentAvgFqi: 91,
          priorSessions: [{ avgFqi: 88 }],
          pbMargin: 5,
        }),
      );
      expect(result.kind).toBeNull();
    });

    it('uses the highest prior (not most recent) as the baseline', () => {
      const result = detectMilestone(
        base({
          currentAvgFqi: 90,
          priorSessions: [{ avgFqi: 70 }, { avgFqi: 93 }],
          pbMargin: 2,
        }),
      );
      expect(result.kind).toBeNull();
    });

    it('does not fire on the very first session when pbMinScore is 0', () => {
      const result = detectMilestone(
        base({ currentAvgFqi: 95, priorSessions: [] }),
      );
      expect(result.kind).toBeNull();
    });

    it('fires on the first session when pbMinScore threshold is cleared', () => {
      const result = detectMilestone(
        base({ currentAvgFqi: 95, priorSessions: [], pbMinScore: 90 }),
      );
      expect(result.kind).toBe('new_pb');
    });

    it('humanises exercise keys with separators in the message', () => {
      const result = detectMilestone(
        base({
          exerciseKey: 'bulgarian_split_squat',
          currentAvgFqi: 92,
          priorSessions: [{ avgFqi: 88 }],
        }),
      );
      expect(result.message).toContain('bulgarian split squat');
    });
  });

  describe('week_consistency', () => {
    it('fires when the last N sessions are within the band and above the floor', () => {
      const result = detectMilestone(
        base({
          currentAvgFqi: 82,
          priorSessions: [{ avgFqi: 80 }, { avgFqi: 83 }],
        }),
      );
      expect(result.kind).toBe('week_consistency');
      expect(result.message).toContain('Dialed in');
      expect(result.message).toContain('82/100');
    });

    it('does NOT fire when the spread exceeds the band', () => {
      // Current 82, prior best 85 (no PB), spread across window is 82..70 = 12 (>5 band).
      const result = detectMilestone(
        base({
          currentAvgFqi: 82,
          priorSessions: [{ avgFqi: 85 }, { avgFqi: 70 }],
        }),
      );
      expect(result.kind).toBeNull();
    });

    it('does NOT fire when there are not enough sessions in the window', () => {
      const result = detectMilestone(
        base({ currentAvgFqi: 82, priorSessions: [{ avgFqi: 83 }] }),
      );
      expect(result.kind).toBeNull();
    });

    it('does NOT fire when the min score is under the floor', () => {
      const result = detectMilestone(
        base({
          currentAvgFqi: 69,
          priorSessions: [{ avgFqi: 70 }, { avgFqi: 71 }],
        }),
      );
      expect(result.kind).toBeNull();
    });

    it('respects a custom window + band', () => {
      const result = detectMilestone(
        base({
          currentAvgFqi: 75,
          priorSessions: [{ avgFqi: 76 }],
          consistencyWindow: 2,
          consistencyBand: 2,
        }),
      );
      expect(result.kind).toBe('week_consistency');
    });

    it('a PB beats a consistency signal (PB gets reported first)', () => {
      // 92 beats prior best by 6 AND (92, 88, 87) are all ≥ 70 and span 5 — qualifies for both.
      const result = detectMilestone(
        base({
          currentAvgFqi: 92,
          priorSessions: [{ avgFqi: 88 }, { avgFqi: 87 }],
        }),
      );
      expect(result.kind).toBe('new_pb');
    });
  });

  describe('edge cases', () => {
    it('returns kind=null when currentAvgFqi is null-ish', () => {
      const result = detectMilestone(
        base({ currentAvgFqi: Number.NaN, priorSessions: [{ avgFqi: 80 }] }),
      );
      expect(result.kind).toBeNull();
      expect(result.score).toBe(0);
    });

    it('filters out non-finite priors before comparison', () => {
      const result = detectMilestone(
        base({
          currentAvgFqi: 92,
          priorSessions: [
            { avgFqi: Number.NaN },
            { avgFqi: 88 },
            { avgFqi: Number.POSITIVE_INFINITY },
          ],
        }),
      );
      expect(result.kind).toBe('new_pb');
    });

    it('returns a safe result when priorSessions is undefined', () => {
      // Typed as required but callers may pass a missing value at runtime.
      const unsafe = { exerciseKey: 'pullup', currentAvgFqi: 80 } as unknown as DetectMilestoneInput;
      const result = detectMilestone(unsafe);
      expect(result.kind).toBeNull();
    });
  });
});
