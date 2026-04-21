const mockSupabaseFrom = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockSupabaseFrom(...args),
  },
}));

import {
  aggregateFaultHeatmap,
  loadFaultHeatmapData,
  type SessionMetricsRow,
  type RepsRow,
} from '@/lib/services/fault-heatmap-data-loader';

function mkBuilder(data: unknown, error: unknown = null) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = chain;
  builder.order = chain;
  builder.gte = chain;
  builder.in = chain;
  builder.limit = jest.fn(() => Promise.resolve({ data, error }));
  return builder;
}

const NOW = new Date('2026-04-20T12:00:00.000Z');

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

describe('aggregateFaultHeatmap', () => {
  it('produces 7 day labels earliest -> today', () => {
    const result = aggregateFaultHeatmap({ sessions: [], reps: [], now: NOW });
    expect(result.days).toHaveLength(7);
    // Day labels are M/D — last one is today.
    expect(result.days[6]).toBe(`${NOW.getMonth() + 1}/${NOW.getDate()}`);
    expect(result.cells).toEqual([]);
    expect(result.totals).toEqual([]);
    expect(result.lastSessionId).toBeNull();
  });

  it('aggregates rep faults by day + fault id', () => {
    const today = isoDay(NOW);
    const yesterday = isoDay(new Date(NOW.getTime() - 24 * 60 * 60 * 1000));

    const sessions: SessionMetricsRow[] = [
      { session_id: 's-today', start_at: `${today}T09:00:00.000Z` },
      { session_id: 's-yesterday', start_at: `${yesterday}T09:00:00.000Z` },
    ];
    const reps: RepsRow[] = [
      {
        session_id: 's-today',
        faults_detected: ['knees_in'],
        start_ts: `${today}T09:01:00.000Z`,
      },
      {
        session_id: 's-today',
        faults_detected: ['knees_in', 'butt_wink'],
        start_ts: `${today}T09:02:00.000Z`,
      },
      {
        session_id: 's-yesterday',
        faults_detected: ['butt_wink'],
        start_ts: `${yesterday}T09:01:00.000Z`,
      },
    ];

    const result = aggregateFaultHeatmap({ sessions, reps, now: NOW });

    const today6 = result.days[6];
    const yesterday5 = result.days[5];

    const kneesToday = result.cells.find((c) => c.dayLabel === today6 && c.faultId === 'knees_in');
    const buttToday = result.cells.find((c) => c.dayLabel === today6 && c.faultId === 'butt_wink');
    const buttYesterday = result.cells.find(
      (c) => c.dayLabel === yesterday5 && c.faultId === 'butt_wink',
    );

    expect(kneesToday?.count).toBe(2);
    expect(buttToday?.count).toBe(1);
    expect(buttYesterday?.count).toBe(1);

    expect(result.totals).toEqual([
      { faultId: 'knees_in', count: 2 },
      { faultId: 'butt_wink', count: 2 },
    ]);
  });

  it('uses session start_at to bucket reps with missing start_ts', () => {
    const today = isoDay(NOW);
    const sessions: SessionMetricsRow[] = [
      { session_id: 's-today', start_at: `${today}T09:00:00.000Z` },
    ];
    const reps: RepsRow[] = [
      { session_id: 's-today', faults_detected: ['knees_in'], start_ts: null },
    ];

    const result = aggregateFaultHeatmap({ sessions, reps, now: NOW });
    const todayLabel = result.days[6];
    expect(result.cells).toContainEqual({ dayLabel: todayLabel, faultId: 'knees_in', count: 1 });
  });

  it('drops reps outside the 7-day window', () => {
    const old = isoDay(new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000));
    const sessions: SessionMetricsRow[] = [
      { session_id: 's-old', start_at: `${old}T09:00:00.000Z` },
    ];
    const reps: RepsRow[] = [
      { session_id: 's-old', faults_detected: ['knees_in'], start_ts: `${old}T09:00:00.000Z` },
    ];
    const result = aggregateFaultHeatmap({ sessions, reps, now: NOW });
    expect(result.cells).toEqual([]);
    expect(result.totals).toEqual([]);
    // lastSessionId still captures the most recent session even if its
    // reps are out of window — heatmap consumers use totals anyway.
    expect(result.lastSessionId).toBe('s-old');
  });

  it('defends against malformed fault rows', () => {
    const today = isoDay(NOW);
    const sessions: SessionMetricsRow[] = [
      { session_id: 's', start_at: `${today}T09:00:00.000Z` },
    ];
    const reps: RepsRow[] = [
      { session_id: 's', faults_detected: null, start_ts: `${today}T09:00:00.000Z` },
      {
        session_id: 's',
        faults_detected: ['knees_in', '', null as unknown as string, undefined as unknown as string],
        start_ts: `${today}T09:01:00.000Z`,
      },
    ];
    const result = aggregateFaultHeatmap({ sessions, reps, now: NOW });
    expect(result.totals).toEqual([{ faultId: 'knees_in', count: 1 }]);
  });

  it('picks the most recent session as lastSessionId', () => {
    const today = isoDay(NOW);
    const earlier = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000);
    const sessions: SessionMetricsRow[] = [
      { session_id: 's-earlier', start_at: earlier.toISOString() },
      { session_id: 's-today', start_at: `${today}T11:00:00.000Z` },
    ];
    const result = aggregateFaultHeatmap({ sessions, reps: [], now: NOW });
    expect(result.lastSessionId).toBe('s-today');
  });
});

describe('loadFaultHeatmapData', () => {
  beforeEach(() => {
    mockSupabaseFrom.mockReset();
  });

  it('returns the empty snapshot when the sessions query errors', async () => {
    mockSupabaseFrom.mockImplementation(() =>
      mkBuilder(null, { message: 'boom' }),
    );
    const result = await loadFaultHeatmapData(NOW);
    expect(result.cells).toEqual([]);
    expect(result.totals).toEqual([]);
    expect(result.days).toHaveLength(7);
    expect(result.lastSessionId).toBeNull();
  });

  it('returns the empty snapshot when there are no sessions', async () => {
    mockSupabaseFrom.mockImplementation(() => mkBuilder([], null));
    const result = await loadFaultHeatmapData(NOW);
    expect(result.cells).toEqual([]);
    expect(result.totals).toEqual([]);
    expect(result.lastSessionId).toBeNull();
  });

  it('pipes supabase rows through the aggregator', async () => {
    const today = isoDay(NOW);
    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'session_metrics') {
        return mkBuilder(
          [{ session_id: 's-today', start_at: `${today}T09:00:00.000Z` }],
          null,
        );
      }
      if (table === 'reps') {
        return mkBuilder(
          [
            {
              session_id: 's-today',
              faults_detected: ['knees_in', 'knees_in'],
              start_ts: `${today}T09:01:00.000Z`,
            },
          ],
          null,
        );
      }
      return mkBuilder([], null);
    });

    const result = await loadFaultHeatmapData(NOW);
    expect(result.totals).toEqual([{ faultId: 'knees_in', count: 2 }]);
    expect(result.lastSessionId).toBe('s-today');
  });
});
