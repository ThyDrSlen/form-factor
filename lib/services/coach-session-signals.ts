/**
 * Coach Session Signals
 *
 * Digests the rep-quality log into a compact signal shape the cloud coach
 * (OpenAI or Gemma-cloud) or on-device Gemma can use as live context.
 *
 * Pure. Consumes only a flat `RepQualityEntry[]` so callers can wire it from
 * either the in-memory log or a Supabase fetch without branching here.
 */

import type { RepQualityEntry } from './rep-quality-log';

export type FqiTrend = 'improving' | 'declining' | 'stable' | 'insufficient-data';

export interface CoachSessionSignals {
  sessionId: string | null;
  exercise: string | null;
  totalReps: number;
  avgFqi: number | null;
  latestFqi: number | null;
  fqiTrend: FqiTrend;
  /** IDs of the top-N faults in the recent window, most frequent first. */
  recentFaults: string[];
  /** Full fault histogram across the entire session. */
  faultFrequency: Record<string, number>;
  occludedRepCount: number;
  lowConfidenceRepCount: number;
  /**
   * ISO timestamp of the most recent entry. Useful for "stale context"
   * checks before sending to the coach.
   */
  lastEntryTs: string | null;
}

export interface BuildCoachSessionSignalsOptions {
  sessionId?: string;
  /**
   * How many of the most recent reps factor into the trend detection
   * and recentFaults calculation. Default: 5.
   */
  windowSize?: number;
  /**
   * How many fault IDs to report in `recentFaults`. Default: 3.
   */
  topFaultCount?: number;
  /**
   * Minimum average-FQI delta across the split window to call a trend.
   * Default: 5 (points).
   */
  trendThreshold?: number;
}

const DEFAULT_WINDOW_SIZE = 5;
const DEFAULT_TOP_FAULT_COUNT = 3;
const DEFAULT_TREND_THRESHOLD = 5;

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function rankFaults(entries: RepQualityEntry[], limit: number): string[] {
  const counts: Record<string, number> = {};
  for (const entry of entries) {
    for (const fault of entry.faults) {
      counts[fault] = (counts[fault] ?? 0) + 1;
    }
  }
  return Object.entries(counts)
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    })
    .slice(0, limit)
    .map(([id]) => id);
}

function detectTrend(recent: RepQualityEntry[], threshold: number): FqiTrend {
  if (recent.length < 4) return 'insufficient-data';
  const half = Math.floor(recent.length / 2);
  const earlier = recent
    .slice(0, half)
    .map((e) => e.fqi)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const later = recent
    .slice(half)
    .map((e) => e.fqi)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

  const earlierAvg = mean(earlier);
  const laterAvg = mean(later);
  if (earlierAvg === null || laterAvg === null) return 'insufficient-data';

  const delta = laterAvg - earlierAvg;
  if (delta >= threshold) return 'improving';
  if (delta <= -threshold) return 'declining';
  return 'stable';
}

export function buildCoachSessionSignals(
  entries: RepQualityEntry[],
  options: BuildCoachSessionSignalsOptions = {}
): CoachSessionSignals {
  const windowSize = Math.max(1, options.windowSize ?? DEFAULT_WINDOW_SIZE);
  const topFaultCount = Math.max(1, options.topFaultCount ?? DEFAULT_TOP_FAULT_COUNT);
  const trendThreshold = Math.max(0, options.trendThreshold ?? DEFAULT_TREND_THRESHOLD);

  const filtered = options.sessionId
    ? entries.filter((e) => e.sessionId === options.sessionId)
    : entries;

  const sorted = [...filtered].sort((a, b) => {
    if (a.ts !== b.ts) return a.ts.localeCompare(b.ts);
    return a.repIndex - b.repIndex;
  });

  const fqis = sorted
    .map((e) => e.fqi)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const avgFqi = fqis.length === 0 ? null : Math.round(fqis.reduce((a, b) => a + b, 0) / fqis.length);

  const faultFrequency: Record<string, number> = {};
  let occluded = 0;
  let lowConfidence = 0;
  for (const entry of sorted) {
    for (const fault of entry.faults) {
      faultFrequency[fault] = (faultFrequency[fault] ?? 0) + 1;
    }
    if (entry.occluded) occluded++;
    if (typeof entry.minJointConfidence === 'number' && entry.minJointConfidence < 0.4) {
      lowConfidence++;
    }
  }

  const recent = sorted.slice(-windowSize);
  const latest = sorted[sorted.length - 1] ?? null;
  const latestFqi = latest && typeof latest.fqi === 'number' ? latest.fqi : null;

  return {
    sessionId: options.sessionId ?? latest?.sessionId ?? null,
    exercise: latest?.exercise ?? null,
    totalReps: sorted.length,
    avgFqi,
    latestFqi,
    fqiTrend: detectTrend(recent, trendThreshold),
    recentFaults: rankFaults(recent, topFaultCount),
    faultFrequency,
    occludedRepCount: occluded,
    lowConfidenceRepCount: lowConfidence,
    lastEntryTs: latest?.ts ?? null,
  };
}

/**
 * Render the signals as a short block suitable for prepending to a coach
 * prompt. Empty signals return an empty string so callers can use it in a
 * template without guarding.
 */
export function formatSignalsForPrompt(signals: CoachSessionSignals): string {
  if (signals.totalReps === 0) return '';

  const lines: string[] = [];
  const header = signals.exercise
    ? `Live ${signals.exercise} session signals:`
    : 'Live session signals:';
  lines.push(header);
  lines.push(`- Reps so far: ${signals.totalReps}`);
  if (signals.avgFqi !== null) {
    lines.push(`- Avg FQI: ${signals.avgFqi}`);
  }
  if (signals.latestFqi !== null) {
    lines.push(`- Latest rep FQI: ${signals.latestFqi}`);
  }
  if (signals.fqiTrend !== 'insufficient-data') {
    lines.push(`- Trend: ${signals.fqiTrend}`);
  }
  if (signals.recentFaults.length > 0) {
    lines.push(`- Recent faults: ${signals.recentFaults.join(', ')}`);
  }
  if (signals.occludedRepCount > 0) {
    lines.push(`- Occluded reps: ${signals.occludedRepCount}`);
  }
  if (signals.lowConfidenceRepCount > 0) {
    lines.push(`- Low-confidence reps: ${signals.lowConfidenceRepCount}`);
  }
  return lines.join('\n');
}
