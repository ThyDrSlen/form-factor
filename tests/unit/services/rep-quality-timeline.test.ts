import {
  buildRepQualityTimeline,
  summarizeTimeline,
} from '@/lib/services/rep-quality-timeline';
import type { RepQualityEntry } from '@/lib/services/rep-quality-log';

function mkEntry(partial: Partial<RepQualityEntry> = {}): RepQualityEntry {
  return {
    sessionId: 's1',
    repIndex: partial.repIndex ?? 1,
    exercise: 'pullup',
    ts: partial.ts ?? `2026-04-17T09:00:0${partial.repIndex ?? 1}.000Z`,
    fqi: 80,
    faults: [],
    ...partial,
  };
}

describe('buildRepQualityTimeline', () => {
  it('returns an empty timeline for an empty input', () => {
    const timeline = buildRepQualityTimeline([]);
    expect(timeline).toEqual({
      sessionId: null,
      startTs: null,
      endTs: null,
      segments: [],
      summary: {
        totalReps: 0,
        avgFqi: null,
        medianFqi: null,
        faultCounts: {},
        occludedReps: 0,
        lowConfidenceReps: 0,
        bestRepIndex: null,
        worstRepIndex: null,
        bestFqi: null,
        worstFqi: null,
      },
    });
  });

  it('emits one rep segment per entry and sorts chronologically', () => {
    const timeline = buildRepQualityTimeline([
      mkEntry({ repIndex: 2, ts: '2026-04-17T09:00:02.000Z' }),
      mkEntry({ repIndex: 1, ts: '2026-04-17T09:00:01.000Z' }),
    ]);
    const repOrder = timeline.segments.filter((s) => s.type === 'rep').map((s) => s.repIndex);
    expect(repOrder).toEqual([1, 2]);
  });

  it('emits a fault segment only when faults are present', () => {
    const timeline = buildRepQualityTimeline([
      mkEntry({ repIndex: 1, faults: [] }),
      mkEntry({ repIndex: 2, faults: ['forward_knee'] }),
    ]);
    const faults = timeline.segments.filter((s) => s.type === 'fault');
    expect(faults).toHaveLength(1);
    expect(faults[0].repIndex).toBe(2);
    expect(faults[0].message).toContain('forward_knee');
  });

  it('labels multi-fault reps with a count rather than a single fault name', () => {
    const timeline = buildRepQualityTimeline([
      mkEntry({ repIndex: 1, faults: ['a', 'b', 'c'] }),
    ]);
    const faults = timeline.segments.filter((s) => s.type === 'fault');
    expect(faults[0].message).toContain('3 faults');
  });

  it('emits a tracking-loss segment when a rep is flagged as occluded', () => {
    const timeline = buildRepQualityTimeline([
      mkEntry({ repIndex: 1, occluded: true }),
      mkEntry({ repIndex: 2 }),
    ]);
    const loss = timeline.segments.filter((s) => s.type === 'tracking-loss');
    expect(loss).toHaveLength(1);
    expect(loss[0].repIndex).toBe(1);
  });

  it('emits a low-confidence segment when min joint confidence drops below the threshold', () => {
    const timeline = buildRepQualityTimeline([
      mkEntry({ repIndex: 1, minJointConfidence: 0.9 }),
      mkEntry({ repIndex: 2, minJointConfidence: 0.3, minConfidenceJoint: 'left_knee' }),
    ]);
    const lc = timeline.segments.filter((s) => s.type === 'low-confidence');
    expect(lc).toHaveLength(1);
    expect(lc[0].repIndex).toBe(2);
    expect(lc[0].message).toContain('left_knee');
    expect(lc[0].message).toContain('30%');
  });

  it('respects a custom low-confidence threshold', () => {
    const timeline = buildRepQualityTimeline(
      [mkEntry({ repIndex: 1, minJointConfidence: 0.5 })],
      { lowConfidenceThreshold: 0.6 }
    );
    expect(timeline.segments.some((s) => s.type === 'low-confidence')).toBe(true);
  });

  it('emits a high-confidence segment for clean high-FQI reps', () => {
    const timeline = buildRepQualityTimeline([
      mkEntry({ repIndex: 1, fqi: 95, faults: [] }),
      mkEntry({ repIndex: 2, fqi: 95, faults: ['shallow'] }),
    ]);
    const hc = timeline.segments.filter((s) => s.type === 'high-confidence');
    expect(hc).toHaveLength(1);
    expect(hc[0].repIndex).toBe(1);
  });

  it('respects a custom high-confidence threshold', () => {
    const timeline = buildRepQualityTimeline(
      [mkEntry({ repIndex: 1, fqi: 75, faults: [] })],
      { highConfidenceFqi: 70 }
    );
    expect(timeline.segments.some((s) => s.type === 'high-confidence')).toBe(true);
  });

  it('filters entries by sessionId when the option is provided', () => {
    const timeline = buildRepQualityTimeline(
      [
        mkEntry({ sessionId: 'a', repIndex: 1 }),
        mkEntry({ sessionId: 'b', repIndex: 1 }),
        mkEntry({ sessionId: 'a', repIndex: 2 }),
      ],
      { sessionId: 'a' }
    );
    expect(timeline.sessionId).toBe('a');
    expect(timeline.summary.totalReps).toBe(2);
  });

  it('populates summary with fqi stats, best/worst reps, and fault counts', () => {
    const timeline = buildRepQualityTimeline([
      mkEntry({ repIndex: 1, fqi: 50, faults: ['forward_knee'] }),
      mkEntry({ repIndex: 2, fqi: 70, faults: ['forward_knee', 'shallow'] }),
      mkEntry({ repIndex: 3, fqi: 90, faults: [] }),
    ]);
    expect(timeline.summary.avgFqi).toBe(70);
    expect(timeline.summary.medianFqi).toBe(70);
    expect(timeline.summary.bestRepIndex).toBe(3);
    expect(timeline.summary.bestFqi).toBe(90);
    expect(timeline.summary.worstRepIndex).toBe(1);
    expect(timeline.summary.worstFqi).toBe(50);
    expect(timeline.summary.faultCounts).toEqual({ forward_knee: 2, shallow: 1 });
  });

  it('handles entries with null FQI gracefully', () => {
    const timeline = buildRepQualityTimeline([
      mkEntry({ repIndex: 1, fqi: null }),
      mkEntry({ repIndex: 2, fqi: 80 }),
    ]);
    expect(timeline.summary.avgFqi).toBe(80);
    expect(timeline.summary.bestFqi).toBe(80);
  });

  it('computes occluded and low-confidence rep counts in the summary', () => {
    const timeline = buildRepQualityTimeline([
      mkEntry({ repIndex: 1, occluded: true }),
      mkEntry({ repIndex: 2, minJointConfidence: 0.2 }),
      mkEntry({ repIndex: 3, minJointConfidence: 0.9 }),
    ]);
    expect(timeline.summary.occludedReps).toBe(1);
    expect(timeline.summary.lowConfidenceReps).toBe(1);
  });

  it('computes median FQI correctly for even and odd counts', () => {
    expect(
      buildRepQualityTimeline([
        mkEntry({ repIndex: 1, fqi: 10 }),
        mkEntry({ repIndex: 2, fqi: 50 }),
        mkEntry({ repIndex: 3, fqi: 90 }),
      ]).summary.medianFqi
    ).toBe(50);
    expect(
      buildRepQualityTimeline([
        mkEntry({ repIndex: 1, fqi: 10 }),
        mkEntry({ repIndex: 2, fqi: 50 }),
        mkEntry({ repIndex: 3, fqi: 70 }),
        mkEntry({ repIndex: 4, fqi: 90 }),
      ]).summary.medianFqi
    ).toBe(60);
  });
});

describe('summarizeTimeline', () => {
  it('returns "No reps recorded." when there are none', () => {
    const timeline = buildRepQualityTimeline([]);
    expect(summarizeTimeline(timeline)).toBe('No reps recorded.');
  });

  it('includes rep count, avg FQI, and top fault', () => {
    const timeline = buildRepQualityTimeline([
      mkEntry({ repIndex: 1, fqi: 80, faults: ['forward_knee'] }),
      mkEntry({ repIndex: 2, fqi: 70, faults: ['forward_knee'] }),
    ]);
    const summary = summarizeTimeline(timeline);
    expect(summary).toContain('2 reps');
    expect(summary).toContain('avg FQI');
    expect(summary).toContain('forward_knee');
  });

  it('surfaces occluded reps when present', () => {
    const timeline = buildRepQualityTimeline([mkEntry({ occluded: true })]);
    expect(summarizeTimeline(timeline)).toContain('occluded');
  });
});
