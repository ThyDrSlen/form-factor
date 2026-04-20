import {
  buildMesocycleInsights,
  startOfIsoWeekUtc,
  MESOCYCLE_WEEKS,
  type MesocycleRepRow,
  type MesocycleSetRow,
} from '@/lib/services/form-mesocycle-aggregator';

// Reference date: 2026-04-17 (Friday).
// Current ISO week starts Monday 2026-04-13 00:00 UTC.
// Bucket 3 (current) covers 2026-04-13 through 2026-04-20.
// Bucket 2 covers 2026-04-06 through 2026-04-13.
// Bucket 1 covers 2026-03-30 through 2026-04-06.
// Bucket 0 covers 2026-03-23 through 2026-03-30.
const REFERENCE = new Date('2026-04-17T12:00:00.000Z');

function rep(overrides: Partial<MesocycleRepRow> = {}): MesocycleRepRow {
  return {
    rep_id: 'r',
    session_id: 's',
    exercise: 'squat',
    start_ts: '2026-04-14T00:00:00.000Z',
    fqi: 80,
    faults_detected: [],
    ...overrides,
  };
}

function set(overrides: Partial<MesocycleSetRow> = {}): MesocycleSetRow {
  return {
    set_id: 'st',
    session_id: 's',
    exercise: 'squat',
    completed_at: '2026-04-14T00:00:00.000Z',
    reps_count: 5,
    load_value: 225,
    ...overrides,
  };
}

describe('startOfIsoWeekUtc', () => {
  it('rolls a Friday reference back to Monday 00:00 UTC', () => {
    expect(startOfIsoWeekUtc(REFERENCE).toISOString()).toBe('2026-04-13T00:00:00.000Z');
  });

  it('stays put when the date is already Monday 00:00 UTC', () => {
    const monday = new Date('2026-04-13T00:00:00.000Z');
    expect(startOfIsoWeekUtc(monday).toISOString()).toBe('2026-04-13T00:00:00.000Z');
  });

  it('rolls a Sunday back six days to Monday', () => {
    const sunday = new Date('2026-04-19T10:00:00.000Z');
    expect(startOfIsoWeekUtc(sunday).toISOString()).toBe('2026-04-13T00:00:00.000Z');
  });
});

describe('buildMesocycleInsights', () => {
  it('returns an empty window when there are no rows', () => {
    const result = buildMesocycleInsights([], [], { reference: REFERENCE });
    expect(result.isEmpty).toBe(true);
    expect(result.weeks).toHaveLength(MESOCYCLE_WEEKS);
    expect(result.topFaults).toEqual([]);
    expect(result.deload.severity).toBe('none');
  });

  it('buckets reps into the correct week', () => {
    const reps = [
      rep({ start_ts: '2026-03-24T00:00:00.000Z', fqi: 70 }), // bucket 0
      rep({ start_ts: '2026-04-01T00:00:00.000Z', fqi: 75 }), // bucket 1
      rep({ start_ts: '2026-04-08T00:00:00.000Z', fqi: 80 }), // bucket 2
      rep({ start_ts: '2026-04-15T00:00:00.000Z', fqi: 85 }), // bucket 3
    ];
    const result = buildMesocycleInsights(reps, [], { reference: REFERENCE });
    expect(result.weeks.map((w) => w.avgFqi)).toEqual([70, 75, 80, 85]);
    expect(result.weeks.map((w) => w.repsCount)).toEqual([1, 1, 1, 1]);
  });

  it('ignores reps outside the 4-week window', () => {
    const reps = [
      rep({ start_ts: '2025-04-15T00:00:00.000Z' }), // long before
      rep({ start_ts: '2030-04-15T00:00:00.000Z' }), // long after
      rep({ start_ts: '2026-03-21T00:00:00.000Z' }), // week before bucket 0
    ];
    const result = buildMesocycleInsights(reps, [], { reference: REFERENCE });
    expect(result.weeks.every((w) => w.repsCount === 0)).toBe(true);
    expect(result.isEmpty).toBe(true);
  });

  it('counts unique sessions per week from reps and sets combined', () => {
    const reps = [
      rep({ session_id: 'session-a', start_ts: '2026-04-14T01:00:00.000Z' }),
      rep({ session_id: 'session-a', start_ts: '2026-04-14T01:10:00.000Z' }),
      rep({ session_id: 'session-b', start_ts: '2026-04-15T02:00:00.000Z' }),
    ];
    const sets = [
      set({ session_id: 'session-a', completed_at: '2026-04-14T01:20:00.000Z' }),
      set({ session_id: 'session-c', completed_at: '2026-04-15T02:05:00.000Z' }),
    ];
    const result = buildMesocycleInsights(reps, sets, { reference: REFERENCE });
    expect(result.weeks[MESOCYCLE_WEEKS - 1].sessionsCount).toBe(3);
    expect(result.weeks[MESOCYCLE_WEEKS - 1].setsCount).toBe(2);
  });

  it('builds a top-N fault histogram sorted by frequency', () => {
    const reps = [
      rep({ faults_detected: ['valgus', 'depth'] }),
      rep({ faults_detected: ['valgus'] }),
      rep({ faults_detected: ['valgus', 'hips_rise'] }),
      rep({ faults_detected: ['depth'] }),
    ];
    const result = buildMesocycleInsights(reps, [], {
      reference: REFERENCE,
      topFaultLimit: 2,
    });
    expect(result.topFaults).toEqual([
      expect.objectContaining({ fault: 'valgus', count: 3 }),
      expect.objectContaining({ fault: 'depth', count: 2 }),
    ]);
  });

  it('skips fqi averaging for reps without a score', () => {
    const reps = [
      rep({ fqi: null, start_ts: '2026-04-15T00:00:00.000Z' }),
      rep({ fqi: 60, start_ts: '2026-04-15T01:00:00.000Z' }),
      rep({ fqi: 80, start_ts: '2026-04-15T02:00:00.000Z' }),
    ];
    const result = buildMesocycleInsights(reps, [], { reference: REFERENCE });
    expect(result.weeks[MESOCYCLE_WEEKS - 1].avgFqi).toBe(70);
  });

  it('reports deload when last week faults rise ≥60%', () => {
    const reps: MesocycleRepRow[] = [
      // prior 3 weeks: 20 reps, 1 fault → rate 0.05
      ...Array.from({ length: 20 }, (_, i) =>
        rep({
          rep_id: `p-${i}`,
          start_ts: '2026-04-08T00:00:00.000Z',
          faults_detected: i === 0 ? ['valgus'] : [],
          fqi: 85,
        }),
      ),
      // last week: 10 reps, 5 faults → rate 0.5 (1000% rise)
      ...Array.from({ length: 10 }, (_, i) =>
        rep({
          rep_id: `l-${i}`,
          start_ts: '2026-04-15T00:00:00.000Z',
          faults_detected: i < 5 ? ['valgus'] : [],
          fqi: 60,
        }),
      ),
    ];
    const result = buildMesocycleInsights(reps, [], { reference: REFERENCE });
    expect(result.deload.severity).toBe('deload');
    expect(result.deload.fqiDelta).toBeLessThan(0);
    expect(result.deload.faultDelta).not.toBeNull();
    expect(result.deload.reason).toMatch(/lighter week/);
  });

  it('reports watch when FQI slips modestly without a fault spike', () => {
    const reps: MesocycleRepRow[] = [
      ...Array.from({ length: 10 }, () =>
        rep({ start_ts: '2026-04-01T00:00:00.000Z', fqi: 85, faults_detected: [] }),
      ),
      ...Array.from({ length: 10 }, () =>
        rep({ start_ts: '2026-04-15T00:00:00.000Z', fqi: 78, faults_detected: [] }),
      ),
    ];
    const result = buildMesocycleInsights(reps, [], { reference: REFERENCE });
    expect(result.deload.severity).toBe('watch');
  });

  it('keeps deload severity at none when the signal is flat', () => {
    const reps: MesocycleRepRow[] = [
      ...Array.from({ length: 10 }, () =>
        rep({ start_ts: '2026-04-01T00:00:00.000Z', fqi: 80 }),
      ),
      ...Array.from({ length: 10 }, () =>
        rep({ start_ts: '2026-04-15T00:00:00.000Z', fqi: 81 }),
      ),
    ];
    const result = buildMesocycleInsights(reps, [], { reference: REFERENCE });
    expect(result.deload.severity).toBe('none');
    expect(result.deload.reason).toBeNull();
  });

  it('tolerates rows with malformed timestamps without throwing', () => {
    const reps = [rep({ start_ts: 'not-a-date' })];
    const result = buildMesocycleInsights(reps, [], { reference: REFERENCE });
    expect(result.weeks.every((w) => w.repsCount === 0)).toBe(true);
  });

  it('emits ISO weekStartIso strings in oldest → newest order', () => {
    const result = buildMesocycleInsights([], [], { reference: REFERENCE });
    expect(result.weeks.map((w) => w.weekStartIso)).toEqual([
      '2026-03-23',
      '2026-03-30',
      '2026-04-06',
      '2026-04-13',
    ]);
  });
});
