import { compareTrendContext, validateTrendContext } from '@/lib/services/healthkit/trend-context';

const sample = (date: string, value: number, observed = true, source = 'scale') => ({ date, value, observed, source, unit: 'kg' });
describe('descriptive context comparison', () => {
  const tag = { kind: 'Travel' as const, startDate: '2026-03-08', endDate: '2026-03-09' };
  it('uses equal inclusive calendar windows across DST with weekday composition and observed-day means', () => {
    const result = compareTrendContext(tag, [sample('2026-03-06', 70), sample('2026-03-07', 72), sample('2026-03-08', 71), sample('2026-03-08', 73), sample('2026-03-09', 72), sample('2026-03-10', 73), sample('2026-03-11', 75)], 'weight', '2026-03-12');
    expect(result.periods.map(p => [p.startDate, p.endDate, p.expectedDays, p.recordedDays, p.mean])).toEqual([
      ['2026-03-06', '2026-03-07', 2, 2, 71], ['2026-03-08', '2026-03-09', 2, 2, 72], ['2026-03-10', '2026-03-11', 2, 2, 74],
    ]);
    expect(result.periods[1].weekdayCounts).toEqual([1, 1, 0, 0, 0, 0, 0]);
    expect(result.duringMinusBefore).toBe(1);
    expect(result.afterMinusBefore).toBe(3);
  });
  it('never manufactures measurements from carry-forward or missing days; sparse weight has no delta', () => {
    const result = compareTrendContext(tag, [sample('2026-03-07', 70), sample('2026-03-08', 70, false), sample('2026-03-09', 71), sample('2026-03-10', NaN)], 'weight', '2026-03-12');
    expect(result.periods.map(p => p.recordedDays)).toEqual([1, 1, 0]);
    expect(result.periods[2].mean).toBeNull();
    expect(result.duringMinusBefore).toBeNull();
    expect(result.reason).toMatch(/insufficient/i);
  });
  it('suppresses incomplete follow-up and mixed source/unit comparisons', () => {
    const points = ['06', '07', '08', '09', '10', '11'].map(d => sample(`2026-03-${d}`, 70));
    expect(compareTrendContext(tag, points, 'weight', '2026-03-09').reason).toMatch(/not complete/i);
    expect(compareTrendContext(tag, [...points, sample('2026-03-09', 71, true, 'other')], 'weight', '2026-03-12').reason).toMatch(/source/i);
    expect(compareTrendContext(tag, [...points, { ...sample('2026-03-09', 150), unit: 'lb' }], 'weight', '2026-03-12').duringMinusBefore).toBeNull();
  });
  it('counts recorded zero steps but not missing days and requires half-window coverage', () => {
    const points = [sample('2026-03-06', 0), sample('2026-03-07', 200), sample('2026-03-08', 300), sample('2026-03-09', 500), sample('2026-03-10', 700), sample('2026-03-11', 900)].map(p => ({ ...p, unit: 'steps' }));
    expect(compareTrendContext(tag, points, 'steps', '2026-03-12').periods[0].mean).toBe(100);
    const long = { ...tag, startDate: '2026-03-01', endDate: '2026-03-31' };
    expect(compareTrendContext(long, points, 'steps', '2026-05-01').duringMinusBefore).toBeNull();
  });
});

const today = '2026-10-10';
const draft = { kind: 'Vacation' as const, startDate: '2026-09-01', endDate: '2026-09-07', city: '  Kyoto  ' };
describe('manual trend context validation', () => {
  it('normalizes an optional manually entered city', () => {
    expect(validateTrendContext(draft, today)).toEqual({ ...draft, city: 'Kyoto' });
    expect(validateTrendContext({ ...draft, city: ' ' }, today).city).toBeUndefined();
  });
  it.each([
    { startDate: '2026-02-30' }, { startDate: '09/01/2026' },
    { endDate: '2026-08-31' }, { endDate: '2026-10-11' },
    { startDate: '2027-01-01', endDate: '2027-01-02' },
    { kind: 'GPS' }, { city: 'x'.repeat(81) },
  ])('rejects invalid, reversed or future dates and unsupported labels: %s', (invalid) => {
    expect(() => validateTrendContext({ ...draft, ...invalid } as typeof draft, today)).toThrow();
  });
});
