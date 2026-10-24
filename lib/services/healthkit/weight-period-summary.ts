import type { RecordedHealthObservation } from './health-types';

type Input = Omit<RecordedHealthObservation, 'provenance'> & { provenance: string };
const key = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const shift = (date: Date, days: number) => { const next = new Date(date); next.setDate(next.getDate() + days); return next; };

/** Descriptive averages of recorded days; missing days are never imputed. Today is incomplete. */
export function summarizeWeightPeriods(points: readonly Input[], days: number, now = new Date()) {
  const end = new Date(now); end.setHours(0, 0, 0, 0);
  const currentStart = shift(end, -days);
  const previousStart = shift(currentStart, -days);
  const period = (start: Date, exclusiveEnd: Date) => {
    const readings = points.filter((p) => p.provenance === 'observed' && Number.isFinite(p.date) && Number.isFinite(p.value) && p.value > 0 && p.date >= start.getTime() && p.date < exclusiveEnd.getTime());
    const buckets = new Map<string, number[]>();
    for (const p of readings) {
      const day = key(new Date(p.date));
      buckets.set(day, [...(buckets.get(day) ?? []), p.value]);
    }
    const means = [...buckets.values()].map((values) => values.reduce((a, b) => a + b, 0) / values.length);
    return { start: key(start), end: key(shift(exclusiveEnd, -1)), recordedDays: buckets.size, samples: readings.length, mean: means.length ? means.reduce((a, b) => a + b, 0) / means.length : null };
  };
  const previous = period(previousStart, currentStart);
  const current = period(currentStart, end);
  // Compare only compatible recorded observations in these two windows. A generic
  // HealthKit source label is not evidence of a shared originating device.
  const compared = points.filter((p) => p.provenance === 'observed'
    && Number.isFinite(p.date) && Number.isFinite(p.value) && p.value > 0
    && p.date >= previousStart.getTime() && p.date < end.getTime());
  const unit = compared[0]?.unit;
  const source = compared[0]?.source;
  const compatible = Boolean(unit?.trim() && source?.trim())
    && compared.every((p) => p.unit === unit && p.source === source);
  const delta = compatible && previous.recordedDays >= 3 && current.recordedDays >= 3
    && previous.mean != null && current.mean != null ? current.mean - previous.mean : null;
  return { previous, current, days, unit, delta };
}
