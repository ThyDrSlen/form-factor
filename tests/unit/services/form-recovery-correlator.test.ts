import {
  correlateRecoveryWithForm,
  type RecoveryDatum,
} from '@/lib/services/form-recovery-correlator';
import type { FormSession } from '@/lib/services/form-nutrition-correlator';

function isoDay(day: number): string {
  const d = new Date('2026-02-01T00:00:00.000Z');
  d.setUTCDate(d.getUTCDate() + day);
  return d.toISOString().slice(0, 10);
}

function ts(day: number, hour = 10): string {
  const d = new Date(`${isoDay(day)}T00:00:00.000Z`);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

function mkSession(day: number, avgFqi: number): FormSession {
  return { id: `s-${day}`, startAt: ts(day, 10), avgFqi };
}

describe('correlateRecoveryWithForm', () => {
  it('returns zeros on empty inputs', () => {
    const result = correlateRecoveryWithForm([], []);
    expect(result.sampleCount).toBe(0);
    expect(result.insights).toEqual([]);
  });

  it('returns zeros when sessions exist but no recovery data', () => {
    const sessions = Array.from({ length: 5 }, (_, i) => mkSession(i, 80));
    const result = correlateRecoveryWithForm(sessions, []);
    expect(result.sampleCount).toBe(0);
  });

  it('detects strong positive sleep x FQI correlation on injected data', () => {
    const sessions: FormSession[] = [];
    const recovery: RecoveryDatum[] = [];
    // 30 days of linearly increasing sleep + linearly increasing FQI
    for (let day = 0; day < 30; day++) {
      const sleep = 5 + day * 0.1; // 5..7.9 hrs
      const fqi = 70 + day * 0.5; // 70..84.5
      sessions.push(mkSession(day, fqi));
      // "night before" => day-1 sleep feeds into day's session
      recovery.push({ date: isoDay(day - 1), sleepHours: sleep });
    }
    const result = correlateRecoveryWithForm(sessions, recovery, { useNightBefore: true });
    expect(result.sampleCount).toBe(30);
    expect(result.sleepVsFqi.r).toBeGreaterThan(0.9);
    expect(result.sleepVsFqi.significance).toBe('high');
    const sleepInsight = result.insights.find((i) => i.id === 'sleep_hours');
    expect(sleepInsight?.description).toMatch(/sleep/i);
  });

  it('returns low correlation for uncorrelated synthetic data', () => {
    const sessions: FormSession[] = [];
    const recovery: RecoveryDatum[] = [];
    for (let day = 0; day < 30; day++) {
      const sleep = 6 + ((day * 7) % 4) * 0.25; // 6..6.75 cycle
      const fqi = 80 + ((day * 13) % 5); // 80..84 cycle
      sessions.push(mkSession(day, fqi));
      recovery.push({ date: isoDay(day - 1), sleepHours: sleep });
    }
    const result = correlateRecoveryWithForm(sessions, recovery, { useNightBefore: true });
    expect(result.sampleCount).toBe(30);
    expect(Math.abs(result.sleepVsFqi.r)).toBeLessThan(0.2);
  });

  it('HRV uses same-day value and still correlates', () => {
    const sessions: FormSession[] = [];
    const recovery: RecoveryDatum[] = [];
    for (let day = 0; day < 15; day++) {
      const hrv = 40 + day * 2;
      const fqi = 70 + day * 0.8;
      sessions.push(mkSession(day, fqi));
      recovery.push({ date: isoDay(day), hrvMs: hrv });
    }
    const result = correlateRecoveryWithForm(sessions, recovery, { useNightBefore: false });
    expect(result.hrvVsFqi.sampleCount).toBe(15);
    expect(result.hrvVsFqi.r).toBeGreaterThan(0.9);
  });

  it('resting HR tends to correlate negatively with FQI when supplied', () => {
    const sessions: FormSession[] = [];
    const recovery: RecoveryDatum[] = [];
    for (let day = 0; day < 12; day++) {
      const rhr = 70 - day; // higher rhr = lower index, decreasing
      const fqi = 70 + day; // higher fqi
      sessions.push(mkSession(day, fqi));
      recovery.push({ date: isoDay(day), restingHeartRateBpm: rhr });
    }
    const result = correlateRecoveryWithForm(sessions, recovery, { useNightBefore: false });
    expect(result.restingHrVsFqi.r).toBeLessThan(-0.9);
    const rhrInsight = result.insights.find((i) => i.id === 'resting_hr');
    expect(rhrInsight?.description).toMatch(/resting hr/i);
  });

  it('skips sessions with null avgFqi', () => {
    const sessions: FormSession[] = [
      mkSession(0, 80),
      { id: 'nil', startAt: ts(1, 10), avgFqi: null },
      mkSession(2, 85),
    ];
    const recovery: RecoveryDatum[] = [
      { date: isoDay(-1), sleepHours: 6 },
      { date: isoDay(0), sleepHours: 7 },
      { date: isoDay(1), sleepHours: 8 },
    ];
    const result = correlateRecoveryWithForm(sessions, recovery, { useNightBefore: true });
    expect(result.sampleCount).toBe(2);
  });
});
