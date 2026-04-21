/**
 * Enrichment tests for detectMilestone — covers the priorPbCount and
 * weekStreakDays context fields added in wave-27. Kept in a sibling file
 * so the existing detector suite stays untouched.
 */
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

describe('detectMilestone — PB ordinal context', () => {
  it('appends ordinal context when priorPbCount > 1', () => {
    const result = detectMilestone(
      base({
        currentAvgFqi: 92,
        priorSessions: [{ avgFqi: 85 }],
        priorPbCount: 3,
      }),
    );
    expect(result.kind).toBe('new_pb');
    expect(result.message).toContain('3rd PB this month');
    expect(result.message).toContain('on fire');
  });

  it('handles the 1st/2nd/3rd English suffix set', () => {
    const cases: { n: number; expect: string }[] = [
      { n: 2, expect: '2nd' },
      { n: 3, expect: '3rd' },
      { n: 4, expect: '4th' },
      { n: 11, expect: '11th' },
      { n: 12, expect: '12th' },
      { n: 13, expect: '13th' },
      { n: 21, expect: '21st' },
      { n: 22, expect: '22nd' },
      { n: 23, expect: '23rd' },
    ];
    for (const c of cases) {
      const result = detectMilestone(
        base({
          currentAvgFqi: 92,
          priorSessions: [{ avgFqi: 85 }],
          priorPbCount: c.n,
        }),
      );
      expect(result.message).toContain(`${c.expect} PB this month`);
    }
  });

  it('does NOT append ordinal context when priorPbCount is 1 (first PB of the month)', () => {
    const result = detectMilestone(
      base({
        currentAvgFqi: 92,
        priorSessions: [{ avgFqi: 85 }],
        priorPbCount: 1,
      }),
    );
    expect(result.kind).toBe('new_pb');
    expect(result.message).not.toContain('this month');
    expect(result.message).not.toContain('on fire');
  });

  it('does NOT append ordinal context when priorPbCount is 0 or omitted', () => {
    const r1 = detectMilestone(
      base({
        currentAvgFqi: 92,
        priorSessions: [{ avgFqi: 85 }],
        priorPbCount: 0,
      }),
    );
    const r2 = detectMilestone(
      base({ currentAvgFqi: 92, priorSessions: [{ avgFqi: 85 }] }),
    );
    expect(r1.message).not.toContain('this month');
    expect(r2.message).not.toContain('this month');
  });

  it('tolerates non-finite priorPbCount gracefully', () => {
    const result = detectMilestone(
      base({
        currentAvgFqi: 92,
        priorSessions: [{ avgFqi: 85 }],
        priorPbCount: Number.NaN,
      }),
    );
    expect(result.kind).toBe('new_pb');
    expect(result.message).not.toContain('this month');
  });
});

describe('detectMilestone — week streak context', () => {
  it('appends streak context when weekStreakDays >= 3', () => {
    const result = detectMilestone(
      base({
        currentAvgFqi: 82,
        priorSessions: [{ avgFqi: 80 }, { avgFqi: 83 }],
        weekStreakDays: 5,
      }),
    );
    expect(result.kind).toBe('week_consistency');
    expect(result.message).toContain('5-day streak');
    expect(result.message).toContain('keep it rolling');
  });

  it('does NOT append streak context when weekStreakDays < 3', () => {
    const result = detectMilestone(
      base({
        currentAvgFqi: 82,
        priorSessions: [{ avgFqi: 80 }, { avgFqi: 83 }],
        weekStreakDays: 2,
      }),
    );
    expect(result.kind).toBe('week_consistency');
    expect(result.message).not.toContain('streak');
  });

  it('does NOT append streak context when weekStreakDays is omitted', () => {
    const result = detectMilestone(
      base({
        currentAvgFqi: 82,
        priorSessions: [{ avgFqi: 80 }, { avgFqi: 83 }],
      }),
    );
    expect(result.kind).toBe('week_consistency');
    expect(result.message).not.toContain('streak');
  });

  it('truncates fractional streak counts to whole days', () => {
    const result = detectMilestone(
      base({
        currentAvgFqi: 82,
        priorSessions: [{ avgFqi: 80 }, { avgFqi: 83 }],
        weekStreakDays: 7.9,
      }),
    );
    expect(result.message).toContain('7-day streak');
  });

  it('streak context only applies to week_consistency, not to PBs', () => {
    const result = detectMilestone(
      base({
        currentAvgFqi: 92,
        priorSessions: [{ avgFqi: 85 }],
        weekStreakDays: 5,
      }),
    );
    expect(result.kind).toBe('new_pb');
    expect(result.message).not.toContain('streak');
  });
});
