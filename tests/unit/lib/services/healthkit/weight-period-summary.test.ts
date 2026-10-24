import { summarizeWeightPeriods } from '@/lib/services/healthkit/weight-period-summary';
const point = (day: number, value: number, provenance = 'observed') => ({ date: new Date(2026, 9, day, 12).getTime(), value, unit: 'kg', source: 'HealthKit', provenance, dayKey: `2026-10-${String(day).padStart(2, '0')}` });
it('suppresses sparse or mixed source/unit comparisons and ignores derived readings', () => {
  expect(summarizeWeightPeriods([point(1, 80), point(8, 82), point(9, 100, 'derived')], 7, new Date(2026, 9, 11)).delta).toBeNull();
  const data = [point(1, 80), point(2, 80), point(3, 80), point(8, 82), point(9, 82), point(10, 82)];
  expect(summarizeWeightPeriods(data.map((p, i) => i === 0 ? { ...p, source: 'Other' } : p), 7, new Date(2026, 9, 11)).delta).toBeNull();
  expect(summarizeWeightPeriods(data.map((p, i) => i === 0 ? { ...p, unit: 'lbs' } : p), 7, new Date(2026, 9, 11)).delta).toBeNull();
});

it('compares adjacent equal completed calendar periods using daily means and explicit missing coverage', () => {
  const result = summarizeWeightPeriods([point(1, 80), point(2, 80), point(3, 80), point(8, 82), point(9, 82), point(10, 82), point(10, 82), point(11, 99), point(12, 99, 'derived')], 7, new Date(2026, 9, 11, 14));
  expect(result.previous).toMatchObject({ start: '2026-09-27', end: '2026-10-03', recordedDays: 3, samples: 3, mean: 80 });
  expect(result.current).toMatchObject({ start: '2026-10-04', end: '2026-10-10', recordedDays: 3, samples: 4, mean: 82 });
  expect(result.delta).toBe(2);
});
