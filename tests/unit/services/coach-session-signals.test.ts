import {
  buildCoachSessionSignals,
  formatSignalsForPrompt,
} from '@/lib/services/coach-session-signals';
import type { RepQualityEntry } from '@/lib/services/rep-quality-log';

function mkEntry(partial: Partial<RepQualityEntry> = {}): RepQualityEntry {
  return {
    sessionId: 's1',
    repIndex: partial.repIndex ?? 1,
    exercise: partial.exercise ?? 'squat',
    ts: partial.ts ?? `2026-04-17T09:00:0${partial.repIndex ?? 1}.000Z`,
    fqi: 80,
    faults: [],
    ...partial,
  };
}

describe('buildCoachSessionSignals', () => {
  it('returns an empty-session shape when the input is empty', () => {
    const signals = buildCoachSessionSignals([]);
    expect(signals).toEqual({
      sessionId: null,
      exercise: null,
      totalReps: 0,
      avgFqi: null,
      latestFqi: null,
      fqiTrend: 'insufficient-data',
      recentFaults: [],
      faultFrequency: {},
      occludedRepCount: 0,
      lowConfidenceRepCount: 0,
      lastEntryTs: null,
    });
  });

  it('filters by sessionId when provided', () => {
    const signals = buildCoachSessionSignals(
      [
        mkEntry({ sessionId: 'a', repIndex: 1 }),
        mkEntry({ sessionId: 'b', repIndex: 1 }),
        mkEntry({ sessionId: 'a', repIndex: 2 }),
      ],
      { sessionId: 'a' }
    );
    expect(signals.totalReps).toBe(2);
    expect(signals.sessionId).toBe('a');
  });

  it('derives exercise from the latest entry', () => {
    const signals = buildCoachSessionSignals([
      mkEntry({ repIndex: 1, exercise: 'squat' }),
      mkEntry({ repIndex: 2, exercise: 'squat' }),
      mkEntry({ repIndex: 3, exercise: 'squat' }),
    ]);
    expect(signals.exercise).toBe('squat');
  });

  it('computes avg and latest FQI', () => {
    const signals = buildCoachSessionSignals([
      mkEntry({ repIndex: 1, fqi: 60 }),
      mkEntry({ repIndex: 2, fqi: 70 }),
      mkEntry({ repIndex: 3, fqi: 80 }),
    ]);
    expect(signals.avgFqi).toBe(70);
    expect(signals.latestFqi).toBe(80);
  });

  it('ignores null FQI in avg calculation', () => {
    const signals = buildCoachSessionSignals([
      mkEntry({ repIndex: 1, fqi: null }),
      mkEntry({ repIndex: 2, fqi: 80 }),
    ]);
    expect(signals.avgFqi).toBe(80);
    expect(signals.latestFqi).toBe(80);
  });

  it('returns insufficient-data trend with fewer than 4 reps', () => {
    const signals = buildCoachSessionSignals([
      mkEntry({ repIndex: 1, fqi: 60 }),
      mkEntry({ repIndex: 2, fqi: 70 }),
      mkEntry({ repIndex: 3, fqi: 80 }),
    ]);
    expect(signals.fqiTrend).toBe('insufficient-data');
  });

  it('detects an improving trend when the recent half is higher', () => {
    const signals = buildCoachSessionSignals([
      mkEntry({ repIndex: 1, fqi: 50 }),
      mkEntry({ repIndex: 2, fqi: 55 }),
      mkEntry({ repIndex: 3, fqi: 75 }),
      mkEntry({ repIndex: 4, fqi: 85 }),
    ]);
    expect(signals.fqiTrend).toBe('improving');
  });

  it('detects a declining trend when the recent half is lower', () => {
    const signals = buildCoachSessionSignals([
      mkEntry({ repIndex: 1, fqi: 90 }),
      mkEntry({ repIndex: 2, fqi: 85 }),
      mkEntry({ repIndex: 3, fqi: 60 }),
      mkEntry({ repIndex: 4, fqi: 55 }),
    ]);
    expect(signals.fqiTrend).toBe('declining');
  });

  it('calls the trend "stable" when the delta is within threshold', () => {
    const signals = buildCoachSessionSignals([
      mkEntry({ repIndex: 1, fqi: 70 }),
      mkEntry({ repIndex: 2, fqi: 72 }),
      mkEntry({ repIndex: 3, fqi: 71 }),
      mkEntry({ repIndex: 4, fqi: 73 }),
    ]);
    expect(signals.fqiTrend).toBe('stable');
  });

  it('respects a custom trend threshold', () => {
    const entries = [
      mkEntry({ repIndex: 1, fqi: 70 }),
      mkEntry({ repIndex: 2, fqi: 71 }),
      mkEntry({ repIndex: 3, fqi: 72 }),
      mkEntry({ repIndex: 4, fqi: 74 }),
    ];
    expect(buildCoachSessionSignals(entries).fqiTrend).toBe('stable');
    expect(buildCoachSessionSignals(entries, { trendThreshold: 2 }).fqiTrend).toBe('improving');
  });

  it('ranks recent faults by frequency in the trailing window', () => {
    const signals = buildCoachSessionSignals(
      [
        mkEntry({ repIndex: 1, faults: ['forward_knee'] }),
        mkEntry({ repIndex: 2, faults: ['forward_knee', 'shallow'] }),
        mkEntry({ repIndex: 3, faults: ['shallow'] }),
        mkEntry({ repIndex: 4, faults: ['forward_knee'] }),
        mkEntry({ repIndex: 5, faults: ['forward_knee'] }),
      ],
      { windowSize: 3 }
    );
    expect(signals.recentFaults[0]).toBe('forward_knee');
    expect(signals.recentFaults).toContain('shallow');
  });

  it('limits recentFaults to topFaultCount', () => {
    const signals = buildCoachSessionSignals(
      [
        mkEntry({ repIndex: 1, faults: ['a', 'b', 'c', 'd'] }),
      ],
      { topFaultCount: 2 }
    );
    expect(signals.recentFaults).toHaveLength(2);
  });

  it('counts the full fault histogram across every rep, not just the window', () => {
    const signals = buildCoachSessionSignals(
      [
        mkEntry({ repIndex: 1, faults: ['early'] }),
        mkEntry({ repIndex: 2, faults: [] }),
        mkEntry({ repIndex: 3, faults: [] }),
        mkEntry({ repIndex: 4, faults: [] }),
        mkEntry({ repIndex: 5, faults: [] }),
        mkEntry({ repIndex: 6, faults: ['late'] }),
      ],
      { windowSize: 3 }
    );
    expect(signals.faultFrequency).toEqual({ early: 1, late: 1 });
    expect(signals.recentFaults).toEqual(['late']);
  });

  it('counts occluded and low-confidence reps', () => {
    const signals = buildCoachSessionSignals([
      mkEntry({ repIndex: 1, occluded: true }),
      mkEntry({ repIndex: 2, minJointConfidence: 0.2 }),
      mkEntry({ repIndex: 3, minJointConfidence: 0.9 }),
    ]);
    expect(signals.occludedRepCount).toBe(1);
    expect(signals.lowConfidenceRepCount).toBe(1);
  });

  it('returns the latest entry timestamp', () => {
    const signals = buildCoachSessionSignals([
      mkEntry({ repIndex: 1, ts: '2026-04-17T09:00:01.000Z' }),
      mkEntry({ repIndex: 2, ts: '2026-04-17T09:00:10.000Z' }),
    ]);
    expect(signals.lastEntryTs).toBe('2026-04-17T09:00:10.000Z');
  });
});

describe('formatSignalsForPrompt', () => {
  it('returns an empty string when there are no reps', () => {
    const empty = buildCoachSessionSignals([]);
    expect(formatSignalsForPrompt(empty)).toBe('');
  });

  it('includes every non-empty signal in the formatted block', () => {
    const signals = buildCoachSessionSignals([
      mkEntry({ repIndex: 1, fqi: 60, faults: ['forward_knee'] }),
      mkEntry({ repIndex: 2, fqi: 65, faults: ['forward_knee'] }),
      mkEntry({ repIndex: 3, fqi: 80, faults: [] }),
      mkEntry({ repIndex: 4, fqi: 85, faults: [], occluded: true, minJointConfidence: 0.2 }),
    ]);
    const formatted = formatSignalsForPrompt(signals);
    expect(formatted).toContain('Live squat session signals:');
    expect(formatted).toContain('Reps so far: 4');
    expect(formatted).toContain('Avg FQI');
    expect(formatted).toContain('Latest rep FQI: 85');
    expect(formatted).toContain('Trend:');
    expect(formatted).toContain('Recent faults: forward_knee');
    expect(formatted).toContain('Occluded reps: 1');
    expect(formatted).toContain('Low-confidence reps: 1');
  });

  it('omits lines with nothing to report', () => {
    const signals = buildCoachSessionSignals([
      mkEntry({ repIndex: 1, fqi: 80 }),
    ]);
    const formatted = formatSignalsForPrompt(signals);
    expect(formatted).not.toContain('Recent faults:');
    expect(formatted).not.toContain('Occluded reps:');
    expect(formatted).not.toContain('Low-confidence reps:');
    expect(formatted).not.toContain('Trend:');
  });
});
