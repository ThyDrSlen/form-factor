export const TREND_CONTEXT_KINDS = ['Vacation', 'Travel', 'Illness', 'New routine'] as const;
export type TrendContextKind = typeof TREND_CONTEXT_KINDS[number];
export interface TrendContextDraft {
  kind: TrendContextKind;
  startDate: string;
  endDate: string;
  city?: string;
}
export interface TrendContextAnnotation extends TrendContextDraft { id: string }

/** Calendar-day observations only. Never mark interpolated/carry-forward values observed.
 * Steps values must be daily totals, not individual overlapping HealthKit samples.
 */
export interface TrendContextObservation {
  date: string;
  value: number;
  observed: boolean;
  source: string;
  unit: string;
}
export interface TrendContextPeriod {
  label: 'Before' | 'During' | 'After';
  startDate: string;
  endDate: string;
  expectedDays: number;
  recordedDays: number;
  observations: number;
  mean: number | null;
  /** Sunday first; composition is reported, not adjusted/matched. */
  weekdayCounts: number[];
  sources: string[];
  units: string[];
}
export interface TrendContextComparison {
  periods: TrendContextPeriod[];
  duringMinusBefore: number | null;
  afterMinusBefore: number | null;
  reason: string | null;
}

const dateAt = (day: number) => new Date(day * 86400000).toISOString().slice(0, 10);

export function compareTrendContext(
  draft: TrendContextDraft, observations: readonly TrendContextObservation[],
  metric: 'weight' | 'steps', today = localToday(),
): TrendContextComparison {
  const tag = validateTrendContext(draft, today);
  const start = dayNumber(tag.startDate);
  const days = dayNumber(tag.endDate) - start + 1;
  const periods = (['Before', 'During', 'After'] as const).map((label, index): TrendContextPeriod => {
    const first = start + (index - 1) * days;
    const last = first + days - 1;
    const rows = observations.filter(p => p.observed === true && Number.isFinite(p.value)
      && (metric === 'weight' ? p.value > 0 : p.value >= 0)
      && Number.isFinite(dayNumber(p.date)) && dayNumber(p.date) >= first && dayNumber(p.date) <= last && p.date <= today);
    const byDay = new Map<string, number[]>();
    for (const row of rows) byDay.set(row.date, [...(byDay.get(row.date) ?? []), row.value]);
    // Each recorded day has equal weight, regardless of how often someone weighed that day.
    const means = [...byDay.values()].map(values => values.reduce((a, b) => a + b, 0) / values.length);
    const weekdayCounts = Array<number>(7).fill(0);
    for (let day = first; day <= last; day++) weekdayCounts[new Date(day * 86400000).getUTCDay()]++;
    const sources = [...new Set(rows.map(p => p.source))];
    const units = [...new Set(rows.map(p => p.unit))];
    return { label, startDate: dateAt(first), endDate: dateAt(last), expectedDays: days,
      recordedDays: byDay.size, observations: rows.length, weekdayCounts, sources, units,
      mean: means.length && units.length === 1 && sources.length === 1 ? means.reduce((a, b) => a + b, 0) / means.length : null };
  });
  const sources = new Set(periods.flatMap(p => p.sources));
  const units = new Set(periods.flatMap(p => p.units));
  const minimumDays = metric === 'steps' ? Math.max(2, Math.ceil(days / 2)) : 2;
  const reason = periods[2].endDate >= today ? 'Follow-up window is not complete.'
    : sources.size > 1 || units.size > 1 || sources.has('') || units.has('') ? 'Different or unknown sources/units; comparison withheld.'
      : periods.some(p => p.recordedDays < minimumDays || p.mean === null) ? 'Insufficient recorded-day coverage for a comparison.' : null;
  return { periods, reason, duringMinusBefore: reason ? null : periods[1].mean! - periods[0].mean!,
    afterMinusBefore: reason ? null : periods[2].mean! - periods[0].mean! };
}


export function localToday(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dayNumber(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time / 86400000 : NaN;
}

export function validateTrendContext(draft: TrendContextDraft, today = localToday()): TrendContextDraft {
  if (!draft || !TREND_CONTEXT_KINDS.includes(draft.kind)) throw new Error('Choose a context label.');
  if (!Number.isFinite(dayNumber(draft.startDate)) || !Number.isFinite(dayNumber(draft.endDate))) {
    throw new Error('Use real calendar dates in YYYY-MM-DD format.');
  }
  if (draft.startDate > draft.endDate) throw new Error('End date must be on or after start date.');
  if (draft.endDate > today) throw new Error('Choose dates on or before today.');
  if (draft.city !== undefined && typeof draft.city !== 'string') throw new Error('City must be text.');
  const city = draft.city?.trim() || undefined;
  if (city && city.length > 80) throw new Error('City must be 80 characters or fewer.');
  return { kind: draft.kind, startDate: draft.startDate, endDate: draft.endDate, ...(city ? { city } : {}) };
}
