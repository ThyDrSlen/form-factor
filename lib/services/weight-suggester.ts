/**
 * Weight suggestion engine.
 *
 * Given a rolling history of completed sets for a given exercise, suggest a
 * target weight for the upcoming set that nudges the lifter along a
 * progressive-overload curve. Supports:
 *   - Data-rich path (>= LINEAR_FALLBACK_THRESHOLD sets) : blend of
 *     (a) best estimated 1RM at a target-RPE fraction, and
 *     (b) linear-trend extrapolation.
 *   - Linear fallback (< threshold)                      : bump the last
 *     known top-set weight by a small compound-exercise friendly delta.
 *
 * Output is deterministic (same history ⇒ same suggestion), snapped to the
 * nearest 2.5 unit plate, and reasoning is a human-readable string to
 * surface in the UI.
 */

import {
  bestOneRepMaxFromHistory,
  estimateOneRepMaxAveraged,
  type RepMaxInput,
} from './rep-max-calculator';

export interface WeightSuggestionInput {
  /** Past sets (any time order — newest-first preferred but not required). */
  history: HistorySet[];
  /** Target reps for the next set (defaults to median of last 3 sets). */
  targetReps?: number;
  /** Target RPE on a 6-10 scale. Defaults to 8 (hypertrophy). */
  targetRpe?: number;
  /** Plate rounding increment. Defaults to 2.5. */
  plateIncrement?: number;
}

export interface HistorySet extends RepMaxInput {
  /** ISO date when the set was recorded. */
  date?: string;
  /** RPE the lifter reported, 6-10. Optional. */
  rpe?: number;
}

export interface WeightSuggestion {
  suggestedWeight: number;
  /** 0..1 confidence in the suggestion. */
  confidence: number;
  reasoning: string;
  /** Number of history sets considered. */
  historyCount: number;
  /** Whether the linear-progression fallback was used. */
  fallback: boolean;
}

const LINEAR_FALLBACK_THRESHOLD = 5;
const DEFAULT_TARGET_RPE = 8;
const DEFAULT_PLATE_INCREMENT = 2.5;
const MAX_BUMP_RATIO = 0.05; // cap weekly overload at 5% per session
const LINEAR_BUMP_DEFAULT = 2.5; // one micro-plate bump when we lack data

/**
 * RPE → percent of 1RM lookup based on Mike Tuchscherer's chart for 1-rep
 * execution; we interpolate for higher rep ranges via the reps-in-reserve
 * adjustment below (0.033 per rep below max).
 */
const RPE_TO_PERCENT_1RM: Record<number, number> = {
  6: 0.86,
  7: 0.9,
  8: 0.93,
  9: 0.96,
  10: 1.0,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function snapToPlate(value: number, increment: number): number {
  if (increment <= 0) return Math.round(value);
  return Math.round(value / increment) * increment;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function rpeToPercent(rpe: number, reps: number): number {
  const base = RPE_TO_PERCENT_1RM[clamp(Math.round(rpe), 6, 10)] ?? 0.93;
  // RIR adjustment: subtract (reps - 1) * 0.033 to approximate the drop in
  // intensity needed to hit the same RPE at higher rep counts.
  const rirDelta = Math.max(0, reps - 1) * 0.033;
  return clamp(base - rirDelta, 0.4, 1);
}

function byDateDesc(a: HistorySet, b: HistorySet): number {
  const ad = a.date ? Date.parse(a.date) : 0;
  const bd = b.date ? Date.parse(b.date) : 0;
  return bd - ad;
}

function linearTrendSlope(history: HistorySet[]): number {
  // Simple least-squares slope over ordinal index vs weight.
  const n = history.length;
  if (n < 2) return 0;
  const ordered = [...history].sort(byDateDesc).reverse();
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i++) {
    const x = i;
    const y = ordered[i].weight;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

export function suggestWeight(input: WeightSuggestionInput): WeightSuggestion {
  const plateIncrement = input.plateIncrement ?? DEFAULT_PLATE_INCREMENT;
  const history = (input.history ?? []).filter(
    (h) => Number.isFinite(h.weight) && h.weight > 0 && Number.isInteger(h.reps) && h.reps > 0,
  );

  if (history.length === 0) {
    return {
      suggestedWeight: 0,
      confidence: 0,
      reasoning:
        'No recorded sets yet for this exercise. Start with a conservative warm-up weight and log your first working set.',
      historyCount: 0,
      fallback: true,
    };
  }

  const sortedNewestFirst = [...history].sort(byDateDesc);
  const mostRecent = sortedNewestFirst[0];
  const targetRpe = clamp(input.targetRpe ?? DEFAULT_TARGET_RPE, 6, 10);
  const targetReps = clamp(
    Math.round(
      input.targetReps ??
        median(sortedNewestFirst.slice(0, 3).map((s) => s.reps)) ??
        mostRecent.reps,
    ),
    1,
    30,
  );

  if (history.length < LINEAR_FALLBACK_THRESHOLD) {
    const bumped = snapToPlate(
      mostRecent.weight +
        Math.min(LINEAR_BUMP_DEFAULT, mostRecent.weight * MAX_BUMP_RATIO),
      plateIncrement,
    );
    return {
      suggestedWeight: bumped,
      confidence: clamp(0.35 + history.length * 0.08, 0.3, 0.6),
      reasoning: `Only ${history.length} set(s) logged — applying a conservative linear bump from your last top set of ${mostRecent.weight}.`,
      historyCount: history.length,
      fallback: true,
    };
  }

  // Data-rich path: blend 1RM-driven target with linear trend.
  const best = bestOneRepMaxFromHistory(history);
  const averaged = estimateOneRepMaxAveraged({
    weight: mostRecent.weight,
    reps: mostRecent.reps,
  });
  const oneRepMax = best?.oneRepMax ?? averaged.oneRepMax ?? mostRecent.weight;
  const percentOfMax = rpeToPercent(targetRpe, targetReps);
  const rpeDriven = oneRepMax * percentOfMax;

  const slope = linearTrendSlope(sortedNewestFirst.slice(0, 10));
  const trendDriven = mostRecent.weight + slope;
  const weightedTrend = 0.6 * rpeDriven + 0.4 * trendDriven;

  const capped = clamp(
    weightedTrend,
    mostRecent.weight * (1 - MAX_BUMP_RATIO),
    mostRecent.weight * (1 + MAX_BUMP_RATIO),
  );
  const suggestedWeight = snapToPlate(capped, plateIncrement);
  const confidence = clamp(
    0.6 + Math.min(history.length, 20) * 0.015 + (best?.confidence ?? 0.5) * 0.1,
    0.5,
    0.95,
  );

  const trendLabel = slope > 0 ? 'upward' : slope < 0 ? 'downward' : 'flat';
  return {
    suggestedWeight,
    confidence,
    reasoning: `Based on ${history.length} recent sets (est. 1RM ${Math.round(
      oneRepMax,
    )}, ${trendLabel} trend, target RPE ${targetRpe} × ${targetReps} reps).`,
    historyCount: history.length,
    fallback: false,
  };
}
