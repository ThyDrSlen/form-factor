import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  __resetFaultReporterCache,
  clearAll,
  clearSessionFaults,
  FAULT_REPORTER_MAX_EVENTS,
  FAULT_REPORTER_STORAGE_KEY,
  getExerciseFaults,
  getSessionAggregates,
  getSessionFaults,
  recordFault,
  type FormTrackingFault,
} from '@/lib/services/form-tracking-fault-reporter';

describe('form-tracking-fault-reporter', () => {
  beforeEach(async () => {
    __resetFaultReporterCache();
    await AsyncStorage.clear();
  });

  it('records a fault with generated id + timestamp', async () => {
    const f = await recordFault({
      sessionId: 's1',
      exerciseId: 'squat',
      faultCode: 'knee_valgus',
      severity: 2,
    });
    expect(f.id).toContain('s1_knee_valgus_');
    expect(typeof f.timestamp).toBe('number');
    const all = await getSessionFaults('s1');
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ faultCode: 'knee_valgus', severity: 2 });
  });

  it('persists faults across cache reset (round-trips through AsyncStorage)', async () => {
    await recordFault({ sessionId: 's1', exerciseId: 'squat', faultCode: 'shallow_depth', severity: 1 });
    __resetFaultReporterCache();
    const all = await getSessionFaults('s1');
    expect(all).toHaveLength(1);
    expect(all[0].faultCode).toBe('shallow_depth');
  });

  it('filters by session and exercise', async () => {
    await recordFault({ sessionId: 's1', exerciseId: 'squat', faultCode: 'a', severity: 1 });
    await recordFault({ sessionId: 's1', exerciseId: 'deadlift', faultCode: 'b', severity: 2 });
    await recordFault({ sessionId: 's2', exerciseId: 'squat', faultCode: 'c', severity: 3 });
    expect(await getSessionFaults('s1')).toHaveLength(2);
    expect(await getExerciseFaults('s1', 'squat')).toHaveLength(1);
    expect(await getExerciseFaults('s1', 'deadlift')).toHaveLength(1);
    expect(await getSessionFaults('s2')).toHaveLength(1);
  });

  it('computes per-exercise aggregates with max severity + fault counts', async () => {
    await recordFault({ sessionId: 's1', exerciseId: 'squat', faultCode: 'knee_valgus', severity: 2, confidence: 0.8 });
    await recordFault({ sessionId: 's1', exerciseId: 'squat', faultCode: 'knee_valgus', severity: 3, confidence: 0.6 });
    await recordFault({ sessionId: 's1', exerciseId: 'squat', faultCode: 'shallow_depth', severity: 1, confidence: 0.9 });
    const aggs = await getSessionAggregates('s1');
    expect(aggs).toHaveLength(1);
    const [squatAgg] = aggs;
    expect(squatAgg.totalFaults).toBe(3);
    expect(squatAgg.maxSeverity).toBe(3);
    expect(squatAgg.byFaultCode).toEqual({ knee_valgus: 2, shallow_depth: 1 });
    expect(squatAgg.avgConfidence).toBeCloseTo((0.8 + 0.6 + 0.9) / 3, 3);
    expect(typeof squatAgg.firstTimestamp).toBe('number');
    expect(typeof squatAgg.lastTimestamp).toBe('number');
  });

  it('returns empty aggregates when session has no faults', async () => {
    await recordFault({ sessionId: 'other', exerciseId: 'squat', faultCode: 'x', severity: 1 });
    const aggs = await getSessionAggregates('missing');
    expect(aggs).toEqual([]);
  });

  it('clears faults by session without affecting other sessions', async () => {
    await recordFault({ sessionId: 's1', exerciseId: 'squat', faultCode: 'a', severity: 1 });
    await recordFault({ sessionId: 's2', exerciseId: 'squat', faultCode: 'b', severity: 2 });
    await clearSessionFaults('s1');
    expect(await getSessionFaults('s1')).toHaveLength(0);
    expect(await getSessionFaults('s2')).toHaveLength(1);
  });

  it('clearAll wipes storage', async () => {
    await recordFault({ sessionId: 's1', exerciseId: 'squat', faultCode: 'a', severity: 1 });
    await clearAll();
    expect(await getSessionFaults('s1')).toHaveLength(0);
  });

  it('caps events at FAULT_REPORTER_MAX_EVENTS via ring-buffer eviction', async () => {
    const overflow = 5;
    for (let i = 0; i < FAULT_REPORTER_MAX_EVENTS + overflow; i++) {
      await recordFault({
        sessionId: 's1',
        exerciseId: 'squat',
        faultCode: `code_${i}`,
        severity: 1,
      });
    }
    const all = await getSessionFaults('s1');
    expect(all).toHaveLength(FAULT_REPORTER_MAX_EVENTS);
    expect(all[0].faultCode).toBe(`code_${overflow}`);
    expect(all[all.length - 1].faultCode).toBe(`code_${FAULT_REPORTER_MAX_EVENTS + overflow - 1}`);
  });

  it('tolerates corrupt JSON in storage and returns empty set', async () => {
    await AsyncStorage.setItem(FAULT_REPORTER_STORAGE_KEY, '{{corrupt');
    __resetFaultReporterCache();
    expect(await getSessionFaults('anything')).toEqual([]);
  });

  it('tolerates non-array JSON in storage', async () => {
    await AsyncStorage.setItem(FAULT_REPORTER_STORAGE_KEY, JSON.stringify({ not: 'array' }));
    __resetFaultReporterCache();
    expect(await getSessionFaults('anything')).toEqual([]);
  });

  it('filters out malformed entries from persisted storage', async () => {
    const valid: FormTrackingFault = {
      id: 'v1',
      sessionId: 's1',
      exerciseId: 'squat',
      faultCode: 'a',
      severity: 1,
      timestamp: 1000,
    };
    const mixed = [valid, { id: 5, sessionId: 's1' }, null, 'string-entry'];
    await AsyncStorage.setItem(FAULT_REPORTER_STORAGE_KEY, JSON.stringify(mixed));
    __resetFaultReporterCache();
    const all = await getSessionFaults('s1');
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe('v1');
  });

  it('respects provided timestamp when given', async () => {
    const f = await recordFault({
      sessionId: 's1',
      exerciseId: 'squat',
      faultCode: 'a',
      severity: 1,
      timestamp: 9999,
    });
    expect(f.timestamp).toBe(9999);
  });
});
