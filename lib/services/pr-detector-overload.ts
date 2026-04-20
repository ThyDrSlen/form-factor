/**
 * Personal-record detector — category-aware.
 *
 * Detects four flavours of overload PRs from a completed set compared to
 * prior history:
 *   - 1RM   : highest estimated one-rep max (best formula blend)
 *   - 3RM   : heaviest load * 3 reps (actual, not estimated)
 *   - 5RM   : heaviest load * 5 reps (actual, not estimated)
 *   - volume: highest (weight × reps) on any single set
 *
 * Split from the Supabase-backed `pr-detector.ts` (#447 W3-C) which covers
 * weight / reps-at-weight / fqi-at-weight via a live query. This module is
 * pure and synchronous — callers pass history in, so it can back the
 * overload-analytics card and progression planner.
 */

import {
  estimateOneRepMaxAveraged,
  type RepMaxInput,
} from './rep-max-calculator';

export type PrCategory = 'one_rep_max' | 'three_rep_max' | 'five_rep_max' | 'volume';

export interface SetRecord extends RepMaxInput {
  /** Optional ISO date stamp. Used only to break ties when two sets match. */
  date?: string;
}

export interface PrResult {
  category: PrCategory;
  /**
   * Previous record value (1RM for one_rep_max / 3RM / 5RM, volume for
   * volume). Null when no prior history existed.
   */
  previous: number | null;
  /** The new value from the current set. */
  current: number;
  /** Absolute delta from previous. Equals `current` when previous is null. */
  delta: number;
  /** True when `current` strictly beats the previous record. */
  isPr: boolean;
  /** Human-readable reasoning. */
  label: string;
}

function bestRepMaxValue(history: SetRecord[], targetReps: number): number {
  let best = 0;
  for (const entry of history) {
    if (entry.reps === targetReps && entry.weight > best) {
      best = entry.weight;
    }
  }
  return best;
}

function bestOneRepMaxEstimate(history: SetRecord[]): number {
  let best = 0;
  for (const entry of history) {
    const est = estimateOneRepMaxAveraged(entry).oneRepMax;
    if (est > best) best = est;
  }
  return best;
}

function bestVolume(history: SetRecord[]): number {
  let best = 0;
  for (const entry of history) {
    const volume = entry.weight * entry.reps;
    if (volume > best) best = volume;
  }
  return best;
}

function isNumberPositive(n: number): boolean {
  return Number.isFinite(n) && n > 0;
}

export function detectOneRepMaxPr(current: SetRecord, history: SetRecord[]): PrResult {
  const candidateEst = estimateOneRepMaxAveraged(current).oneRepMax;
  const previous = history.length ? bestOneRepMaxEstimate(history) : 0;
  const prev = previous > 0 ? previous : null;
  return {
    category: 'one_rep_max',
    previous: prev,
    current: candidateEst,
    delta: prev === null ? candidateEst : candidateEst - prev,
    isPr: isNumberPositive(candidateEst) && candidateEst > (prev ?? 0),
    label: `Estimated 1RM ${Math.round(candidateEst)}${
      prev !== null ? ` vs prior ${Math.round(prev)}` : ''
    }`,
  };
}

function detectRepMaxPr(
  targetReps: number,
  category: Exclude<PrCategory, 'one_rep_max' | 'volume'>,
  current: SetRecord,
  history: SetRecord[],
): PrResult {
  if (current.reps !== targetReps) {
    return {
      category,
      previous: bestRepMaxValue(history, targetReps) || null,
      current: 0,
      delta: 0,
      isPr: false,
      label: `${targetReps}RM requires a set at exactly ${targetReps} reps.`,
    };
  }
  const previous = bestRepMaxValue(history, targetReps);
  const prev = previous > 0 ? previous : null;
  return {
    category,
    previous: prev,
    current: current.weight,
    delta: prev === null ? current.weight : current.weight - prev,
    isPr: isNumberPositive(current.weight) && current.weight > (prev ?? 0),
    label: `${targetReps}RM ${current.weight}${
      prev !== null ? ` vs prior ${prev}` : ''
    }`,
  };
}

export function detectThreeRepMaxPr(current: SetRecord, history: SetRecord[]): PrResult {
  return detectRepMaxPr(3, 'three_rep_max', current, history);
}

export function detectFiveRepMaxPr(current: SetRecord, history: SetRecord[]): PrResult {
  return detectRepMaxPr(5, 'five_rep_max', current, history);
}

export function detectVolumePr(current: SetRecord, history: SetRecord[]): PrResult {
  const currentVolume = current.weight * current.reps;
  const previous = history.length ? bestVolume(history) : 0;
  const prev = previous > 0 ? previous : null;
  return {
    category: 'volume',
    previous: prev,
    current: currentVolume,
    delta: prev === null ? currentVolume : currentVolume - prev,
    isPr: isNumberPositive(currentVolume) && currentVolume > (prev ?? 0),
    label: `Volume ${Math.round(currentVolume)}${
      prev !== null ? ` vs prior ${Math.round(prev)}` : ''
    }`,
  };
}

/**
 * Run all four category detectors in one pass. Returns results in a stable
 * order regardless of which actually triggered.
 */
export function detectAllPrs(current: SetRecord, history: SetRecord[]): PrResult[] {
  return [
    detectOneRepMaxPr(current, history),
    detectThreeRepMaxPr(current, history),
    detectFiveRepMaxPr(current, history),
    detectVolumePr(current, history),
  ];
}

/**
 * Filter to just the triggered PRs. Useful for UI confetti / toasts.
 */
export function triggeredPrs(current: SetRecord, history: SetRecord[]): PrResult[] {
  return detectAllPrs(current, history).filter((result) => result.isPr);
}
