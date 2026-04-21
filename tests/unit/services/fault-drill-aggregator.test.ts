import {
  aggregatePersistentFaults,
  severityForFault,
  prettifyFaultCode,
  DEFAULT_TOP_N,
  DEFAULT_MIN_COUNT,
} from '@/lib/services/fault-drill-aggregator';

describe('severityForFault', () => {
  it('flags major-regex faults as severity 3', () => {
    expect(severityForFault('knee_valgus_collapse')).toBe(3);
    expect(severityForFault('severe_lumbar_flexion')).toBe(3);
    expect(severityForFault('hyper_extension')).toBe(3);
  });

  it('flags moderate-regex faults as severity 2', () => {
    expect(severityForFault('shallow_depth')).toBe(2);
    expect(severityForFault('forward_lean')).toBe(2);
    expect(severityForFault('lateral_shift')).toBe(2);
    expect(severityForFault('rep_asymmetry')).toBe(2);
  });

  it('defaults unknown faults to severity 1', () => {
    expect(severityForFault('knees_in')).toBe(1);
    expect(severityForFault('butt_wink')).toBe(1);
    expect(severityForFault('random_thing')).toBe(1);
  });
});

describe('prettifyFaultCode', () => {
  it('replaces underscores and title-cases words', () => {
    expect(prettifyFaultCode('knees_in')).toBe('Knees In');
    expect(prettifyFaultCode('butt_wink')).toBe('Butt Wink');
  });

  it('trims excess whitespace', () => {
    expect(prettifyFaultCode('  knees_in  ')).toBe('Knees In');
  });

  it('preserves single-word codes', () => {
    expect(prettifyFaultCode('asymmetry')).toBe('Asymmetry');
  });
});

describe('aggregatePersistentFaults', () => {
  it('returns empty when no totals', () => {
    expect(aggregatePersistentFaults([])).toEqual([]);
  });

  it('applies default top-N and minCount', () => {
    const totals = [
      { faultId: 'a', count: 1 },
      { faultId: 'b', count: 4 },
      { faultId: 'c', count: 3 },
      { faultId: 'd', count: 2 },
      { faultId: 'e', count: 5 },
    ];
    const result = aggregatePersistentFaults(totals);
    // min=2 drops 'a'. top 3 by count: e=5, b=4, c=3.
    expect(result.map((r) => r.code)).toEqual(['e', 'b', 'c']);
    expect(result).toHaveLength(DEFAULT_TOP_N);
  });

  it('honours override topN', () => {
    const totals = [
      { faultId: 'a', count: 5 },
      { faultId: 'b', count: 5 },
    ];
    const result = aggregatePersistentFaults(totals, { topN: 1 });
    expect(result).toHaveLength(1);
  });

  it('honours override minCount', () => {
    const totals = [
      { faultId: 'a', count: 1 },
      { faultId: 'b', count: 2 },
    ];
    const result = aggregatePersistentFaults(totals, { minCount: 1 });
    expect(result).toHaveLength(2);
  });

  it('tie-breaks on faultId asc for stable ordering', () => {
    const totals = [
      { faultId: 'zz', count: 3 },
      { faultId: 'aa', count: 3 },
    ];
    const result = aggregatePersistentFaults(totals);
    expect(result.map((r) => r.code)).toEqual(['aa', 'zz']);
  });

  it('populates displayName from lookup when provided', () => {
    const totals = [{ faultId: 'knees_in', count: 5 }];
    const result = aggregatePersistentFaults(totals, {
      displayNames: { knees_in: 'Knees caving in' },
    });
    expect(result[0].displayName).toBe('Knees caving in');
  });

  it('falls back to prettifyFaultCode when no display name supplied', () => {
    const totals = [{ faultId: 'butt_wink', count: 5 }];
    const result = aggregatePersistentFaults(totals);
    expect(result[0].displayName).toBe('Butt Wink');
  });

  it('assigns severity consistently with severityForFault', () => {
    const totals = [
      { faultId: 'knees_in', count: 5 },
      { faultId: 'shallow_depth', count: 4 },
      { faultId: 'lumbar_collapse', count: 3 },
    ];
    const result = aggregatePersistentFaults(totals);
    const byCode = Object.fromEntries(result.map((r) => [r.code, r.severity]));
    expect(byCode).toEqual({
      knees_in: 1,
      shallow_depth: 2,
      lumbar_collapse: 3,
    });
  });

  it('defends against malformed entries', () => {
    const totals = [
      { faultId: 'good', count: 5 },
      { faultId: '', count: 10 },
      { faultId: 'nan', count: Number.NaN },
      { faultId: 'inf', count: Number.POSITIVE_INFINITY },
      { faultId: 'neg', count: -3 },
    ] as unknown as { faultId: string; count: number }[];
    const result = aggregatePersistentFaults(totals);
    expect(result.map((r) => r.code)).toEqual(['good']);
  });

  it('matches the default min count constant', () => {
    expect(DEFAULT_MIN_COUNT).toBe(2);
  });
});
