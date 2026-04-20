/**
 * Form Mesocycle Aggregator
 *
 * Rolls up the last 4 weeks of rep / set telemetry into a single view:
 *   - Weekly FQI trend (4 buckets, oldest → newest)
 *   - Fault frequency histogram (top-N across the window)
 *   - Deload signal (fatigue ↑ AND FQI ↓ across last 2 weeks)
 *   - Session volume per week
 *
 * Pure functional core so the hook layer just passes rows in. No database
 * calls, no React state — callers own IO. Tests stay fast and hermetic.
 */

export const MESOCYCLE_WEEKS = 4;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

export interface MesocycleRepRow {
  rep_id: string;
  session_id: string;
  exercise: string;
  /** ISO timestamp for rep start */
  start_ts: string;
  /** 0-100 form quality index (null for untracked reps) */
  fqi: number | null;
  /** Fault codes detected on this rep */
  faults_detected: string[];
}

export interface MesocycleSetRow {
  set_id: string;
  session_id: string;
  exercise: string;
  /** ISO timestamp for set completion */
  completed_at: string;
  reps_count: number;
  load_value: number | null;
}

export interface MesocycleWeekBucket {
  /** ISO date (yyyy-mm-dd) for the Monday of this week */
  weekStartIso: string;
  /** 0-3 — oldest = 0, current = MESOCYCLE_WEEKS-1 */
  weekIndex: number;
  /** Mean FQI across all reps with a tracked score, or null if none */
  avgFqi: number | null;
  /** Number of sessions with at least one logged set */
  sessionsCount: number;
  /** Total reps logged */
  repsCount: number;
  /** Total sets logged */
  setsCount: number;
}

export interface MesocycleFaultCount {
  fault: string;
  count: number;
  /** Share of reps in the window that triggered this fault (0..1) */
  share: number;
}

export type MesocycleDeloadSeverity = 'none' | 'watch' | 'deload';

export interface MesocycleDeloadSignal {
  severity: MesocycleDeloadSeverity;
  /** Difference in avg FQI between last week and the prior 3 weeks, rounded. Negative = worsening. */
  fqiDelta: number | null;
  /** Fraction by which fault rate rose last week vs prior. Positive = rising faults. */
  faultDelta: number | null;
  /** Short user-facing hint — null when severity === 'none'. */
  reason: string | null;
}

export interface MesocycleInsights {
  /** Upper bound timestamp used for bucketing (inclusive) */
  referenceIso: string;
  weeks: MesocycleWeekBucket[];
  topFaults: MesocycleFaultCount[];
  deload: MesocycleDeloadSignal;
  /** True when the window contains no reps AND no sets. */
  isEmpty: boolean;
}

export interface BuildMesocycleOptions {
  /** Upper bound of the window. Defaults to now. */
  reference?: Date;
  /** Maximum number of top faults to return. */
  topFaultLimit?: number;
}

function startOfDayUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Monday 00:00 UTC of the ISO week that contains `d`. */
export function startOfIsoWeekUtc(d: Date): Date {
  const day = startOfDayUtc(d);
  const weekday = day.getUTCDay(); // 0 = Sunday
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  return new Date(day.getTime() + mondayOffset * MS_PER_DAY);
}

/** Bucket index for timestamp `iso` inside a 4-week window ending at `referenceStart`. Null when outside the window. */
function bucketIndex(iso: string, referenceStart: Date, weeks: number): number | null {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return null;
  const startMs = referenceStart.getTime() - (weeks - 1) * MS_PER_WEEK;
  if (ts < startMs) return null;
  const endMs = referenceStart.getTime() + MS_PER_WEEK;
  if (ts >= endMs) return null;
  const offsetWeeks = Math.floor((ts - startMs) / MS_PER_WEEK);
  if (offsetWeeks < 0 || offsetWeeks >= weeks) return null;
  return offsetWeeks;
}

/**
 * Build a MesocycleInsights bag from raw rep + set rows. Pure — callers own IO.
 */
export function buildMesocycleInsights(
  reps: MesocycleRepRow[],
  sets: MesocycleSetRow[],
  options: BuildMesocycleOptions = {},
): MesocycleInsights {
  const reference = options.reference ?? new Date();
  const topFaultLimit = options.topFaultLimit ?? 3;
  const currentWeekStart = startOfIsoWeekUtc(reference);

  const weeks: MesocycleWeekBucket[] = Array.from({ length: MESOCYCLE_WEEKS }, (_, i) => ({
    weekStartIso: new Date(
      currentWeekStart.getTime() - (MESOCYCLE_WEEKS - 1 - i) * MS_PER_WEEK,
    )
      .toISOString()
      .slice(0, 10),
    weekIndex: i,
    avgFqi: null,
    sessionsCount: 0,
    repsCount: 0,
    setsCount: 0,
  }));

  const fqiSumsPerWeek = new Array(MESOCYCLE_WEEKS).fill(0) as number[];
  const fqiCountsPerWeek = new Array(MESOCYCLE_WEEKS).fill(0) as number[];
  const sessionsPerWeek: Set<string>[] = Array.from({ length: MESOCYCLE_WEEKS }, () => new Set());
  const faultCounts = new Map<string, number>();
  let totalReps = 0;
  let totalFaultInstances = 0;
  const repsInLastWeekByFault = { last: 0, prior: 0 };
  const fqiLastWeek = { sum: 0, count: 0 };
  const fqiPriorWeeks = { sum: 0, count: 0 };

  for (const rep of reps) {
    const idx = bucketIndex(rep.start_ts, currentWeekStart, MESOCYCLE_WEEKS);
    if (idx === null) continue;
    weeks[idx].repsCount += 1;
    sessionsPerWeek[idx].add(rep.session_id);
    totalReps += 1;

    if (typeof rep.fqi === 'number') {
      fqiSumsPerWeek[idx] += rep.fqi;
      fqiCountsPerWeek[idx] += 1;
      if (idx === MESOCYCLE_WEEKS - 1) {
        fqiLastWeek.sum += rep.fqi;
        fqiLastWeek.count += 1;
      } else {
        fqiPriorWeeks.sum += rep.fqi;
        fqiPriorWeeks.count += 1;
      }
    }

    for (const fault of rep.faults_detected ?? []) {
      faultCounts.set(fault, (faultCounts.get(fault) ?? 0) + 1);
      totalFaultInstances += 1;
      if (idx === MESOCYCLE_WEEKS - 1) repsInLastWeekByFault.last += 1;
      else repsInLastWeekByFault.prior += 1;
    }
  }

  for (const set of sets) {
    const idx = bucketIndex(set.completed_at, currentWeekStart, MESOCYCLE_WEEKS);
    if (idx === null) continue;
    weeks[idx].setsCount += 1;
    sessionsPerWeek[idx].add(set.session_id);
  }

  for (let i = 0; i < MESOCYCLE_WEEKS; i += 1) {
    weeks[i].avgFqi = fqiCountsPerWeek[i] > 0
      ? Math.round(fqiSumsPerWeek[i] / fqiCountsPerWeek[i])
      : null;
    weeks[i].sessionsCount = sessionsPerWeek[i].size;
  }

  const topFaults: MesocycleFaultCount[] = Array.from(faultCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topFaultLimit)
    .map(([fault, count]) => ({
      fault,
      count,
      share: totalReps > 0 ? Math.round((count / totalReps) * 1000) / 1000 : 0,
    }));

  const fqiDelta =
    fqiLastWeek.count > 0 && fqiPriorWeeks.count > 0
      ? Math.round(
          fqiLastWeek.sum / fqiLastWeek.count - fqiPriorWeeks.sum / fqiPriorWeeks.count,
        )
      : null;

  const faultDelta = computeFaultDelta(repsInLastWeekByFault, weeks);

  const deload = judgeDeload(fqiDelta, faultDelta);

  return {
    referenceIso: reference.toISOString(),
    weeks,
    topFaults,
    deload,
    isEmpty: totalReps === 0 && sets.length === 0,
  };
}

function computeFaultDelta(
  instancesByWeek: { last: number; prior: number },
  weeks: MesocycleWeekBucket[],
): number | null {
  const lastWeekReps = weeks[MESOCYCLE_WEEKS - 1].repsCount;
  const priorWeeksReps = weeks.slice(0, MESOCYCLE_WEEKS - 1).reduce((sum, w) => sum + w.repsCount, 0);
  if (lastWeekReps === 0 || priorWeeksReps === 0) return null;
  const lastRate = instancesByWeek.last / lastWeekReps;
  const priorRate = instancesByWeek.prior / priorWeeksReps;
  if (priorRate === 0) return lastRate > 0 ? 1 : 0;
  return Math.round((lastRate - priorRate) / priorRate * 100) / 100;
}

function judgeDeload(
  fqiDelta: number | null,
  faultDelta: number | null,
): MesocycleDeloadSignal {
  if (fqiDelta === null && faultDelta === null) {
    return { severity: 'none', fqiDelta, faultDelta, reason: null };
  }

  const fqiDropped5 = fqiDelta !== null && fqiDelta <= -5;
  const fqiDropped10 = fqiDelta !== null && fqiDelta <= -10;
  const faultsRose30 = faultDelta !== null && faultDelta >= 0.3;
  const faultsRose60 = faultDelta !== null && faultDelta >= 0.6;

  if ((fqiDropped10 && faultsRose30) || faultsRose60) {
    return {
      severity: 'deload',
      fqiDelta,
      faultDelta,
      reason:
        'Last week your form quality slipped and fault rate rose — consider a lighter week.',
    };
  }

  if (fqiDropped5 || faultsRose30) {
    return {
      severity: 'watch',
      fqiDelta,
      faultDelta,
      reason:
        'Form quality is trending down this week — keep an eye on load progression.',
    };
  }

  return { severity: 'none', fqiDelta, faultDelta, reason: null };
}
