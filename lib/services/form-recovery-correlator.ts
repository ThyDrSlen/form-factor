/**
 * Form × Recovery correlator (issue #470).
 *
 * Mirrors the shape of `form-nutrition-correlator` but joins sessions with
 * HealthKit-derived recovery metrics (sleep duration, HRV). Operates on
 * per-day summaries so it works equally well from HealthMetricPoint series
 * or local-DB health_metrics rows.
 */
import type { FormSession } from '@/lib/services/form-nutrition-correlator';

export interface RecoveryDatum {
  /** ISO date (YYYY-MM-DD) OR any parseable timestamp; only the day is used. */
  date: string | number;
  /** Total sleep duration in hours for that calendar day. Nullable. */
  sleepHours?: number | null;
  /** HRV SDNN (ms) for that day. Nullable. */
  hrvMs?: number | null;
  /** Resting heart rate (bpm) for that day. Nullable. */
  restingHeartRateBpm?: number | null;
}

export interface RecoveryCorrelationMetric {
  r: number;
  slope: number;
  r2: number;
  sampleCount: number;
  significance: 'low' | 'medium' | 'high';
}

export interface RecoveryFormInsight {
  id: 'sleep_hours' | 'hrv' | 'resting_hr';
  title: string;
  description: string;
  metric: RecoveryCorrelationMetric;
}

export interface RecoveryFormCorrelation {
  sleepVsFqi: RecoveryCorrelationMetric;
  hrvVsFqi: RecoveryCorrelationMetric;
  restingHrVsFqi: RecoveryCorrelationMetric;
  insights: RecoveryFormInsight[];
  sampleCount: number;
}

export interface CorrelateRecoveryOptions {
  /** Match sleep-from-previous-night to session day (default true). */
  useNightBefore?: boolean;
}

const EMPTY_METRIC: RecoveryCorrelationMetric = {
  r: 0,
  slope: 0,
  r2: 0,
  sampleCount: 0,
  significance: 'low',
};

function toIsoDay(value: string | number): string | null {
  const t = typeof value === 'number' ? value : new Date(value).getTime();
  if (!Number.isFinite(t) || t === 0) return null;
  return new Date(t).toISOString().slice(0, 10);
}

function shiftDay(iso: string, deltaDays: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function pearson(xs: number[], ys: number[]): RecoveryCorrelationMetric {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) {
    return { ...EMPTY_METRIC, sampleCount: n };
  }
  const mx = mean(xs);
  const my = mean(ys);
  let numerator = 0;
  let denomX = 0;
  let denomY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }
  if (denomX === 0 || denomY === 0) {
    return { ...EMPTY_METRIC, sampleCount: n };
  }
  const r = numerator / Math.sqrt(denomX * denomY);
  const clampedR = Math.max(-1, Math.min(1, r));
  const slope = numerator / denomX;
  const r2 = clampedR * clampedR;
  const absR = Math.abs(clampedR);
  let significance: RecoveryCorrelationMetric['significance'] = 'low';
  if (n >= 10 && absR >= 0.5) significance = 'high';
  else if (n >= 5 && absR >= 0.3) significance = 'medium';
  return {
    r: Number(clampedR.toFixed(4)),
    slope: Number(slope.toFixed(4)),
    r2: Number(r2.toFixed(4)),
    sampleCount: n,
    significance,
  };
}

interface JoinedRow {
  fqi: number;
  sleepHours: number | null;
  hrvMs: number | null;
  restingHeartRateBpm: number | null;
}

function joinSessionsWithRecovery(
  sessions: FormSession[],
  recovery: RecoveryDatum[],
  opts: CorrelateRecoveryOptions,
): JoinedRow[] {
  const useNightBefore = opts.useNightBefore ?? true;
  const byDay = new Map<string, RecoveryDatum>();
  for (const r of recovery) {
    const day = toIsoDay(r.date);
    if (!day) continue;
    // Collapse multiple entries per day by keeping the most "informative"
    // one (more non-null metrics wins). Stable otherwise.
    const prior = byDay.get(day);
    if (!prior) {
      byDay.set(day, r);
    } else {
      const priorScore =
        (prior.sleepHours != null ? 1 : 0) +
        (prior.hrvMs != null ? 1 : 0) +
        (prior.restingHeartRateBpm != null ? 1 : 0);
      const newScore =
        (r.sleepHours != null ? 1 : 0) +
        (r.hrvMs != null ? 1 : 0) +
        (r.restingHeartRateBpm != null ? 1 : 0);
      if (newScore > priorScore) byDay.set(day, r);
    }
  }

  const rows: JoinedRow[] = [];
  for (const session of sessions) {
    if (session.avgFqi === null || !Number.isFinite(session.avgFqi)) continue;
    const day = toIsoDay(session.startAt);
    if (!day) continue;
    const sleepKey = useNightBefore ? shiftDay(day, -1) : day;
    const sleepSrc = byDay.get(sleepKey);
    const sameDaySrc = byDay.get(day);

    rows.push({
      fqi: session.avgFqi,
      sleepHours: sleepSrc?.sleepHours ?? null,
      // HRV + RHR taken from the session day itself.
      hrvMs: sameDaySrc?.hrvMs ?? null,
      restingHeartRateBpm: sameDaySrc?.restingHeartRateBpm ?? null,
    });
  }
  return rows;
}

function buildSleepInsight(metric: RecoveryCorrelationMetric): RecoveryFormInsight {
  const description =
    metric.sampleCount < 5
      ? 'Log a few more sessions with sleep data to unlock sleep insights.'
      : metric.significance === 'low'
        ? 'No obvious link between sleep duration and FQI yet.'
        : metric.slope > 0
          ? `More sleep the night before tends to lift FQI (r=${metric.r.toFixed(2)}).`
          : `More sleep has not boosted FQI in your sample (r=${metric.r.toFixed(2)}).`;
  return {
    id: 'sleep_hours',
    title: 'Sleep × form',
    description,
    metric,
  };
}

function buildHrvInsight(metric: RecoveryCorrelationMetric): RecoveryFormInsight {
  const description =
    metric.sampleCount < 5
      ? 'Need more paired HRV samples before we can call it.'
      : metric.significance === 'low'
        ? 'HRV and FQI are not clearly linked in your sample.'
        : metric.slope > 0
          ? `Higher HRV days tend to produce higher FQI (r=${metric.r.toFixed(2)}).`
          : `HRV does not positively track FQI in your sample yet (r=${metric.r.toFixed(2)}).`;
  return {
    id: 'hrv',
    title: 'HRV × form',
    description,
    metric,
  };
}

function buildRestingHrInsight(metric: RecoveryCorrelationMetric): RecoveryFormInsight {
  const description =
    metric.sampleCount < 5
      ? 'Log more sessions with resting HR before drawing conclusions.'
      : metric.significance === 'low'
        ? 'Resting HR is not clearly linked to your FQI.'
        : metric.slope < 0
          ? `Lower resting HR days tend to coincide with higher FQI (r=${metric.r.toFixed(2)}).`
          : `Resting HR is trending with FQI rather than against it — watch for overreaching (r=${metric.r.toFixed(2)}).`;
  return {
    id: 'resting_hr',
    title: 'Resting HR × form',
    description,
    metric,
  };
}

export function correlateRecoveryWithForm(
  sessions: FormSession[],
  recovery: RecoveryDatum[],
  opts: CorrelateRecoveryOptions = {},
): RecoveryFormCorrelation {
  if (sessions.length === 0 || recovery.length === 0) {
    return {
      sleepVsFqi: EMPTY_METRIC,
      hrvVsFqi: EMPTY_METRIC,
      restingHrVsFqi: EMPTY_METRIC,
      insights: [],
      sampleCount: 0,
    };
  }

  const rows = joinSessionsWithRecovery(sessions, recovery, opts);
  if (rows.length === 0) {
    return {
      sleepVsFqi: EMPTY_METRIC,
      hrvVsFqi: EMPTY_METRIC,
      restingHrVsFqi: EMPTY_METRIC,
      insights: [],
      sampleCount: 0,
    };
  }

  const withSleep = rows.filter((r) => r.sleepHours !== null);
  const withHrv = rows.filter((r) => r.hrvMs !== null);
  const withRhr = rows.filter((r) => r.restingHeartRateBpm !== null);

  const sleepVsFqi = pearson(
    withSleep.map((r) => r.sleepHours as number),
    withSleep.map((r) => r.fqi),
  );
  const hrvVsFqi = pearson(
    withHrv.map((r) => r.hrvMs as number),
    withHrv.map((r) => r.fqi),
  );
  const restingHrVsFqi = pearson(
    withRhr.map((r) => r.restingHeartRateBpm as number),
    withRhr.map((r) => r.fqi),
  );

  const insights: RecoveryFormInsight[] = [
    buildSleepInsight(sleepVsFqi),
    buildHrvInsight(hrvVsFqi),
    buildRestingHrInsight(restingHrVsFqi),
  ];

  return {
    sleepVsFqi,
    hrvVsFqi,
    restingHrVsFqi,
    insights,
    sampleCount: rows.length,
  };
}
