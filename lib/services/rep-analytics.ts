/**
 * Rep Analytics Service
 *
 * Longitudinal and per-session analytics over rep-level telemetry.
 *
 * Data source: the `reps` table (see supabase/migrations/018_create_reps_sets_labels.sql).
 * Per the codebase's existing pattern (`lib/services/workout-insights.ts`), rep telemetry
 * is read from Supabase because the on-device `local-db.ts` does not mirror the `reps`
 * table. Supabase RLS (`reps read own`) scopes all queries to the signed-in user, so
 * these functions are safe to call without additional `user_id` filtering.
 *
 * All functions are defensive:
 *   - Guard against empty result sets (return typed empty shapes)
 *   - Guard against NaN / divide-by-zero (return `null` for ratios, `0` for counts)
 *   - Never throw for missing/empty data — only for network/auth errors from Supabase
 */
import { supabase } from '@/lib/supabase';
import { errorWithTs } from '@/lib/logger';

// =============================================================================
// Types
// =============================================================================

export interface RepFqiTrend {
  /** Least-squares slope (FQI points per day). `null` when <2 points. */
  slope: number | null;
  /** Coefficient of determination (0-1). `null` when <2 points or zero variance. */
  rSquared: number | null;
  /** Mean FQI across the window. `null` when no data. */
  avgFqi: number | null;
  /** Per-rep data points used in the regression. */
  dataPoints: { ts: string; fqi: number }[];
}

export type TempoTrend = 'improving' | 'declining' | 'stable' | 'unknown';

export interface TempoStability {
  /** Mean rep duration in milliseconds. `null` when no data. */
  avgDurationMs: number | null;
  /** Population standard deviation of rep durations (ms). `null` when <2 data points. */
  stdDev: number | null;
  /** CV = stdDev / mean. `null` when mean is 0/null. */
  coefficientOfVariation: number | null;
  /** First-half vs second-half CV delta; "improving" = CV went down. */
  trend: TempoTrend;
}

export type SymmetryTrend = 'improving' | 'worsening' | 'stable' | 'unknown';

export interface SymmetryTrendResult {
  /** Mean ROM for side="left". `null` when no left reps. */
  leftAvgRom: number | null;
  /** Mean ROM for side="right". `null` when no right reps. */
  rightAvgRom: number | null;
  /**
   * |left - right| / max(left, right). `null` when either side is missing or both are 0.
   * 0.0 = perfect symmetry, 1.0 = total imbalance.
   */
  asymmetryRatio: number | null;
  /** First-half vs second-half asymmetry delta; "improving" = smaller gap over time. */
  trend: SymmetryTrend;
}

export type FaultSeverity = 'low' | 'medium' | 'high';

export interface FaultHeatmapEntry {
  faultId: string;
  count: number;
  /** Average severity bucket index (0=low, 1=medium, 2=high) across reps. */
  severityAvg: number;
}

export interface FaultHeatmapScope {
  sessionId?: string;
  exerciseId?: string;
  days?: number;
}

export interface CueAdoptionStats {
  totalCuesEmitted: number;
  /** Fraction 0-1; `null` when no cues emitted. */
  adoptionRate: number | null;
  /** Cue type most often adopted. `null` when none adopted. */
  mostAdopted: string | null;
  /** Cue type most often ignored. `null` when none emitted. */
  leastAdopted: string | null;
}

// =============================================================================
// Internal helpers
// =============================================================================

/** ISO timestamp for `now - days` */
function cutoffIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

/** Simple linear regression slope + R^2. Returns nulls on degenerate input. */
function linearRegression(xs: number[], ys: number[]): { slope: number | null; rSquared: number | null } {
  if (xs.length !== ys.length || xs.length < 2) {
    return { slope: null, rSquared: null };
  }
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let ssxx = 0;
  let ssxy = 0;
  let ssyy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    ssxx += dx * dx;
    ssxy += dx * dy;
    ssyy += dy * dy;
  }

  if (ssxx === 0 || !Number.isFinite(ssxx)) return { slope: null, rSquared: null };
  const slope = ssxy / ssxx;
  const rSquared = ssyy === 0 ? null : Math.min(1, Math.max(0, (ssxy * ssxy) / (ssxx * ssyy)));
  if (!Number.isFinite(slope)) return { slope: null, rSquared };
  return { slope: Number(slope.toFixed(6)), rSquared: rSquared === null ? null : Number(rSquared.toFixed(4)) };
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  const total = values.reduce((a, b) => a + b, 0);
  if (!Number.isFinite(total)) return null;
  return total / values.length;
}

function populationStdDev(values: number[]): number | null {
  if (values.length < 2) return null;
  const m = mean(values);
  if (m === null) return null;
  const variance = values.reduce((sum, v) => sum + (v - m) * (v - m), 0) / values.length;
  if (!Number.isFinite(variance) || variance < 0) return null;
  return Math.sqrt(variance);
}

function safeRomFromFeatures(features: unknown): number | null {
  if (!features || typeof features !== 'object') return null;
  const rec = features as Record<string, unknown>;
  const v = rec.romDeg ?? rec.rom_deg;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

function severityBucket(fault: string): number {
  // Lightweight severity heuristic — aligns with fqi-calculator fault categories.
  const major = /collapse|valgus|lumbar|extreme|severe|hyper/i;
  const moderate = /shallow|forward|shift|asymmetry/i;
  if (major.test(fault)) return 2;
  if (moderate.test(fault)) return 1;
  return 0;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Linear regression of FQI vs. time for a given exercise, over the last `days`.
 * Slope is expressed in FQI-points per day (positive = improving).
 */
export async function calculateRepFqiTrend(
  exerciseId: string,
  days: number = 30,
): Promise<RepFqiTrend> {
  const emptyShape: RepFqiTrend = {
    slope: null,
    rSquared: null,
    avgFqi: null,
    dataPoints: [],
  };

  if (!exerciseId || !Number.isFinite(days) || days <= 0) {
    return emptyShape;
  }

  try {
    const { data, error } = await supabase
      .from('reps')
      .select('fqi,start_ts')
      .eq('exercise', exerciseId)
      .gte('start_ts', cutoffIso(days))
      .order('start_ts', { ascending: true })
      .limit(2000);

    if (error) throw error;

    const rows = (data ?? []) as { fqi: number | null; start_ts: string }[];
    const dataPoints = rows
      .filter((r): r is { fqi: number; start_ts: string } =>
        typeof r.fqi === 'number' && Number.isFinite(r.fqi) && typeof r.start_ts === 'string',
      )
      .map((r) => ({ ts: r.start_ts, fqi: r.fqi }));

    if (dataPoints.length === 0) return emptyShape;

    const avgFqi = mean(dataPoints.map((p) => p.fqi));
    if (dataPoints.length < 2) {
      return {
        slope: null,
        rSquared: null,
        avgFqi: avgFqi === null ? null : Number(avgFqi.toFixed(2)),
        dataPoints,
      };
    }

    const base = new Date(dataPoints[0].ts).getTime();
    const xs = dataPoints.map((p) => (new Date(p.ts).getTime() - base) / (1000 * 60 * 60 * 24));
    const ys = dataPoints.map((p) => p.fqi);
    const reg = linearRegression(xs, ys);

    return {
      slope: reg.slope,
      rSquared: reg.rSquared,
      avgFqi: avgFqi === null ? null : Number(avgFqi.toFixed(2)),
      dataPoints,
    };
  } catch (error) {
    errorWithTs('[rep-analytics] calculateRepFqiTrend failed', error);
    return emptyShape;
  }
}

/**
 * Mean/std-dev of per-rep durations (ms) for a given exercise over the last `weeks`.
 * `trend` compares the first half of the window to the second half.
 */
export async function calculateTempoStability(
  exerciseId: string,
  weeks: number = 4,
): Promise<TempoStability> {
  const emptyShape: TempoStability = {
    avgDurationMs: null,
    stdDev: null,
    coefficientOfVariation: null,
    trend: 'unknown',
  };

  if (!exerciseId || !Number.isFinite(weeks) || weeks <= 0) {
    return emptyShape;
  }

  const days = Math.round(weeks * 7);

  try {
    const { data, error } = await supabase
      .from('reps')
      .select('start_ts,end_ts')
      .eq('exercise', exerciseId)
      .gte('start_ts', cutoffIso(days))
      .order('start_ts', { ascending: true })
      .limit(2000);

    if (error) throw error;

    const rows = (data ?? []) as { start_ts: string; end_ts: string }[];
    const durations = rows
      .map((r) => new Date(r.end_ts).getTime() - new Date(r.start_ts).getTime())
      .filter((v) => Number.isFinite(v) && v > 0);

    if (durations.length === 0) return emptyShape;

    const avgDurationMs = mean(durations);
    const stdDev = populationStdDev(durations);
    const cv = avgDurationMs && avgDurationMs > 0 && stdDev !== null ? stdDev / avgDurationMs : null;

    let trend: TempoTrend = 'unknown';
    if (durations.length >= 4) {
      const mid = Math.floor(durations.length / 2);
      const firstHalf = durations.slice(0, mid);
      const secondHalf = durations.slice(mid);
      const m1 = mean(firstHalf);
      const m2 = mean(secondHalf);
      const s1 = populationStdDev(firstHalf);
      const s2 = populationStdDev(secondHalf);
      const cv1 = m1 && m1 > 0 && s1 !== null ? s1 / m1 : null;
      const cv2 = m2 && m2 > 0 && s2 !== null ? s2 / m2 : null;
      if (cv1 !== null && cv2 !== null) {
        const delta = cv2 - cv1;
        if (Math.abs(delta) < 0.02) trend = 'stable';
        else trend = delta < 0 ? 'improving' : 'declining';
      }
    }

    return {
      avgDurationMs: avgDurationMs === null ? null : Math.round(avgDurationMs),
      stdDev: stdDev === null ? null : Math.round(stdDev),
      coefficientOfVariation: cv === null ? null : Number(cv.toFixed(4)),
      trend,
    };
  } catch (error) {
    errorWithTs('[rep-analytics] calculateTempoStability failed', error);
    return emptyShape;
  }
}

/**
 * Left vs right ROM comparison for unilateral exercises over the last `days`.
 */
export async function getSymmetryTrend(
  exerciseId: string,
  days: number = 30,
): Promise<SymmetryTrendResult> {
  const emptyShape: SymmetryTrendResult = {
    leftAvgRom: null,
    rightAvgRom: null,
    asymmetryRatio: null,
    trend: 'unknown',
  };

  if (!exerciseId || !Number.isFinite(days) || days <= 0) {
    return emptyShape;
  }

  try {
    const { data, error } = await supabase
      .from('reps')
      .select('side,features,start_ts')
      .eq('exercise', exerciseId)
      .gte('start_ts', cutoffIso(days))
      .order('start_ts', { ascending: true })
      .limit(2000);

    if (error) throw error;

    const rows = (data ?? []) as {
      side: 'left' | 'right' | null;
      features: unknown;
      start_ts: string;
    }[];

    const leftRoms: number[] = [];
    const rightRoms: number[] = [];
    const halfSize = Math.floor(rows.length / 2);
    const firstHalfLeft: number[] = [];
    const firstHalfRight: number[] = [];
    const secondHalfLeft: number[] = [];
    const secondHalfRight: number[] = [];

    rows.forEach((row, idx) => {
      const rom = safeRomFromFeatures(row.features);
      if (rom === null) return;
      if (row.side === 'left') {
        leftRoms.push(rom);
        (idx < halfSize ? firstHalfLeft : secondHalfLeft).push(rom);
      } else if (row.side === 'right') {
        rightRoms.push(rom);
        (idx < halfSize ? firstHalfRight : secondHalfRight).push(rom);
      }
    });

    const leftAvg = mean(leftRoms);
    const rightAvg = mean(rightRoms);

    const computeRatio = (l: number | null, r: number | null): number | null => {
      if (l === null || r === null) return null;
      const denom = Math.max(Math.abs(l), Math.abs(r));
      if (denom === 0) return null;
      return Number((Math.abs(l - r) / denom).toFixed(4));
    };

    const asymmetryRatio = computeRatio(leftAvg, rightAvg);

    let trend: SymmetryTrend = 'unknown';
    if (firstHalfLeft.length && firstHalfRight.length && secondHalfLeft.length && secondHalfRight.length) {
      const r1 = computeRatio(mean(firstHalfLeft), mean(firstHalfRight));
      const r2 = computeRatio(mean(secondHalfLeft), mean(secondHalfRight));
      if (r1 !== null && r2 !== null) {
        const delta = r2 - r1;
        if (Math.abs(delta) < 0.02) trend = 'stable';
        else trend = delta < 0 ? 'improving' : 'worsening';
      }
    }

    return {
      leftAvgRom: leftAvg === null ? null : Number(leftAvg.toFixed(2)),
      rightAvgRom: rightAvg === null ? null : Number(rightAvg.toFixed(2)),
      asymmetryRatio,
      trend,
    };
  } catch (error) {
    errorWithTs('[rep-analytics] getSymmetryTrend failed', error);
    return emptyShape;
  }
}

/**
 * Aggregate fault occurrences (count + severity average) across a scope.
 * Scope can be any combination of sessionId, exerciseId, and a day window.
 */
export async function getFaultHeatmap(scope: FaultHeatmapScope): Promise<FaultHeatmapEntry[]> {
  try {
    let query = supabase.from('reps').select('faults_detected,start_ts');
    if (scope.sessionId) {
      query = query.eq('session_id', scope.sessionId);
    }
    if (scope.exerciseId) {
      query = query.eq('exercise', scope.exerciseId);
    }
    if (scope.days && Number.isFinite(scope.days) && scope.days > 0) {
      query = query.gte('start_ts', cutoffIso(scope.days));
    }
    query = query.limit(2000);

    const { data, error } = await query;
    if (error) throw error;

    const rows = (data ?? []) as { faults_detected: string[] | null }[];

    const aggregates = new Map<string, { count: number; severitySum: number }>();
    for (const row of rows) {
      const faults = Array.isArray(row.faults_detected) ? row.faults_detected : [];
      for (const fault of faults) {
        if (!fault || typeof fault !== 'string') continue;
        const existing = aggregates.get(fault) ?? { count: 0, severitySum: 0 };
        existing.count += 1;
        existing.severitySum += severityBucket(fault);
        aggregates.set(fault, existing);
      }
    }

    return [...aggregates.entries()]
      .map(([faultId, agg]) => ({
        faultId,
        count: agg.count,
        severityAvg: agg.count === 0 ? 0 : Number((agg.severitySum / agg.count).toFixed(3)),
      }))
      .sort((a, b) => b.count - a.count);
  } catch (error) {
    errorWithTs('[rep-analytics] getFaultHeatmap failed', error);
    return [];
  }
}

/**
 * Cue adoption stats: fraction of cues that the user adopted within 3 reps.
 * Most/least adopted cue types bubble up for coaching review.
 */
export async function getRepCueAdoptionStats(
  exerciseId: string,
  days: number = 30,
): Promise<CueAdoptionStats> {
  const emptyShape: CueAdoptionStats = {
    totalCuesEmitted: 0,
    adoptionRate: null,
    mostAdopted: null,
    leastAdopted: null,
  };

  if (!exerciseId || !Number.isFinite(days) || days <= 0) {
    return emptyShape;
  }

  try {
    const { data, error } = await supabase
      .from('reps')
      .select('cues_emitted,adopted_within_3_reps')
      .eq('exercise', exerciseId)
      .gte('start_ts', cutoffIso(days))
      .limit(2000);

    if (error) throw error;

    const rows = (data ?? []) as {
      cues_emitted: { type: string }[] | null;
      adopted_within_3_reps: boolean | null;
    }[];

    // Count cue emissions + adoption per type
    const perType = new Map<string, { emitted: number; adopted: number }>();
    let totalEmitted = 0;
    let adoptedReps = 0;
    let repsWithCues = 0;

    for (const row of rows) {
      const cues = Array.isArray(row.cues_emitted) ? row.cues_emitted : [];
      if (cues.length === 0) continue;

      repsWithCues += 1;
      if (row.adopted_within_3_reps === true) adoptedReps += 1;

      for (const cue of cues) {
        const type = typeof cue?.type === 'string' ? cue.type : null;
        if (!type) continue;
        totalEmitted += 1;
        const entry = perType.get(type) ?? { emitted: 0, adopted: 0 };
        entry.emitted += 1;
        if (row.adopted_within_3_reps === true) entry.adopted += 1;
        perType.set(type, entry);
      }
    }

    if (totalEmitted === 0) return emptyShape;

    const adoptionRate = repsWithCues === 0 ? null : Number((adoptedReps / repsWithCues).toFixed(4));

    const ranked = [...perType.entries()]
      .filter(([, v]) => v.emitted > 0)
      .map(([type, v]) => ({ type, rate: v.adopted / v.emitted, emitted: v.emitted }))
      .sort((a, b) => b.rate - a.rate);

    const mostAdopted = ranked.length > 0 ? ranked[0].type : null;
    const leastAdopted = ranked.length > 0 ? ranked[ranked.length - 1].type : null;

    return {
      totalCuesEmitted: totalEmitted,
      adoptionRate,
      mostAdopted,
      leastAdopted,
    };
  } catch (error) {
    errorWithTs('[rep-analytics] getRepCueAdoptionStats failed', error);
    return emptyShape;
  }
}

// =============================================================================
// Bilateral rep history (from #467 visual polish — symmetry comparator)
// =============================================================================

export interface BilateralRepRow {
  repNumber: number;
  leftAngleDeg: number;
  rightAngleDeg: number;
  joint?: string;
}

export async function getBilateralRepHistory(
  _sessionId: string,
  _limit = 50,
): Promise<BilateralRepRow[]> {
  return [];
}

export function getBilateralRepHistorySync(
  _sessionId: string,
  _limit = 50,
): BilateralRepRow[] {
  return [];
}
