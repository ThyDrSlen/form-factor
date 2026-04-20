/**
 * useLiveFatigue
 *
 * Combines recent FQI samples (form quality trend) with HealthKit
 * heart-rate zone to estimate the athlete's fatigue state during a
 * live set. Returns a discrete state + a suggested rest extension in
 * seconds that the caller can feed into the rest timer.
 *
 *   fresh    → FQI stable + HR below aerobic threshold
 *   working  → some FQI dip OR HR in aerobic range
 *   fatigued → sustained FQI drop OR HR above anaerobic threshold
 *
 * Thresholds are deliberately conservative to avoid spooking users.
 * The hook is pure derivation — no side effects, no telemetry.
 */
import { useMemo } from 'react';

export type FatigueState = 'fresh' | 'working' | 'fatigued';

export interface LiveFatigueInput {
  /** Ordered FQI scores, oldest → newest, 0-100 */
  recentFqi: number[];
  /** Latest heart rate BPM (null when unknown) */
  heartRateBpm: number | null | undefined;
  /** Athlete's max HR (defaults to 220 - 30). */
  maxHeartRate?: number;
}

export interface LiveFatigueResult {
  state: FatigueState;
  suggestRestSec: number;
  /** Rationale string for debugging / future coach copy. */
  reason: string;
}

const DEFAULT_MAX_HR = 190;

export function useLiveFatigue(input: LiveFatigueInput): LiveFatigueResult {
  return useMemo(() => computeLiveFatigue(input), [input.recentFqi, input.heartRateBpm, input.maxHeartRate]);
}

/**
 * Pure derivation helper — exported for unit-test access without React.
 */
export function computeLiveFatigue(input: LiveFatigueInput): LiveFatigueResult {
  const { recentFqi, heartRateBpm, maxHeartRate = DEFAULT_MAX_HR } = input;

  const fqiTrend = classifyFqiTrend(recentFqi);
  const hrZone = classifyHrZone(heartRateBpm, maxHeartRate);

  // Combine the two axes — highest of the two signals wins.
  const rank = Math.max(stateRank(fqiTrend), stateRank(hrZone));
  const state = (['fresh', 'working', 'fatigued'] as const)[rank];
  const reason = buildReason(fqiTrend, hrZone);

  const suggestRestSec = suggestionFor(state);
  return { state, suggestRestSec, reason };
}

function stateRank(state: FatigueState): 0 | 1 | 2 {
  return state === 'fatigued' ? 2 : state === 'working' ? 1 : 0;
}

function classifyFqiTrend(samples: number[]): FatigueState {
  if (!samples || samples.length < 2) return 'fresh';
  // Compare last to median of earliest half.
  const half = Math.max(1, Math.floor(samples.length / 2));
  const baseline = median(samples.slice(0, half));
  const last = samples[samples.length - 1];
  const drop = baseline - last;
  if (drop >= 10) return 'fatigued';
  if (drop >= 4) return 'working';
  return 'fresh';
}

function classifyHrZone(bpm: number | null | undefined, maxHr: number): FatigueState {
  if (bpm == null || !Number.isFinite(bpm) || bpm <= 0 || !Number.isFinite(maxHr) || maxHr <= 0) {
    return 'fresh';
  }
  const pct = bpm / maxHr;
  if (pct >= 0.85) return 'fatigued';
  if (pct >= 0.7) return 'working';
  return 'fresh';
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function suggestionFor(state: FatigueState): number {
  switch (state) {
    case 'fresh':
      return 0;
    case 'working':
      return 30;
    case 'fatigued':
    default:
      return 60;
  }
}

function buildReason(fqi: FatigueState, hr: FatigueState): string {
  const parts: string[] = [];
  if (fqi !== 'fresh') parts.push(`fqi:${fqi}`);
  if (hr !== 'fresh') parts.push(`hr:${hr}`);
  return parts.length === 0 ? 'baseline' : parts.join('|');
}
