/**
 * Coach Debrief Prompt Builder
 *
 * Assembles the `[system, user]` message pair that drives the auto-debrief
 * (Part B of issue #458). Input is a compact session analytics record —
 * rep count, avg FQI, trend, top fault, symmetry, tempo — and output is a
 * prompt aimed at a 150–250 word personalized coaching brief.
 *
 * NOTE: The analytics record is normally produced by `calculateRepFqiTrend`
 * and friends from #444. Until that PR lands on main, `computeFqiTrendSlope`
 * below walks a plain FQI array manually; callers can still pass the
 * pre-computed slope directly. TODO(#437): reconcile with
 * `@/lib/workouts/rep-insights.calculateRepFqiTrend` once #444 merges.
 *
 * The live-session serializer is also inlined here pending #443 landing its
 * `coach-live-snapshot.buildLiveSessionSnapshot` + `summarizeForPrompt`
 * helpers on main. TODO(#439): switch to those canonical exports.
 */

import type { CoachMessage } from './coach-service';
import { hardenAgainstInjection } from './coach-injection-hardener';
import { isCoachPipelineV2Enabled } from './coach-pipeline-v2-flag';
import type { CuePreference } from './coach-cue-feedback';

/**
 * Pipeline-v2 helper: when the master flag is on, harden a user-sourced
 * string before it gets interpolated into a debrief prompt template. When
 * the flag is off, pass through untouched.
 */
function maybeHarden(value: string, maxLength: number): string {
  return isCoachPipelineV2Enabled()
    ? hardenAgainstInjection(value, { maxLength })
    : value;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RepAnalytics {
  /** 0..1 per rep — higher is better. */
  fqi: number;
  /** Optional per-rep fault label (e.g. 'depth_short', 'knee_valgus'). */
  topFault?: string | null;
  /** Left/right asymmetry percent; null when bilateral / unmeasured. */
  symmetryPct?: number | null;
  /** Eccentric tempo ms (or null when not measured). */
  eccentricMs?: number | null;
}

export interface DebriefAnalytics {
  sessionId: string;
  exerciseName: string;
  repCount: number;
  avgFqi: number | null;
  /** Slope: positive = improving, negative = fatiguing. Optional. */
  fqiTrendSlope: number | null;
  /** Most-common fault across reps, if any. */
  topFault: string | null;
  /** Max observed asymmetry percent (>=0), or null. */
  maxSymmetryPct: number | null;
  /** Eccentric tempo trend slope (ms per rep). */
  tempoTrendSlope: number | null;
  /** Full rep array — inlined so the LLM can narrate shape. */
  reps: RepAnalytics[];
}

// ---------------------------------------------------------------------------
// Analytics derivations
// ---------------------------------------------------------------------------

/**
 * Simple linear-regression slope across a rep's FQI series. Returns 0 when
 * we have fewer than 2 reps (no defined slope). Positive values indicate
 * improving FQI over the session; negative values indicate fatigue.
 *
 * TODO(#437): replace with `calculateRepFqiTrend` from rep-insights once
 * #444 lands on main.
 */
export function computeFqiTrendSlope(reps: RepAnalytics[]): number {
  if (!Array.isArray(reps) || reps.length < 2) return 0;

  const xs = reps.map((_, i) => i);
  const ys = reps.map((r) => r.fqi);
  const n = reps.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

/** Most-common non-null fault label in the rep series, or null. */
export function topFaultOf(reps: RepAnalytics[]): string | null {
  const counts = new Map<string, number>();
  for (const r of reps) {
    const f = r.topFault?.trim();
    if (!f) continue;
    counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [fault, count] of counts) {
    if (count > bestCount) {
      best = fault;
      bestCount = count;
    }
  }
  return best;
}

/** Largest asymmetry percent across reps, or null when all reps lack it. */
export function maxSymmetryOf(reps: RepAnalytics[]): number | null {
  let best: number | null = null;
  for (const r of reps) {
    if (typeof r.symmetryPct !== 'number') continue;
    if (r.symmetryPct === null) continue;
    if (best === null || r.symmetryPct > best) best = r.symmetryPct;
  }
  return best;
}

/** Simple linear-regression slope over the eccentric tempo series. */
export function tempoTrendSlopeOf(reps: RepAnalytics[]): number | null {
  const ys: number[] = [];
  for (const r of reps) {
    if (typeof r.eccentricMs === 'number') ys.push(r.eccentricMs);
  }
  if (ys.length < 2) return null;
  const n = ys.length;
  const xs = ys.map((_, i) => i);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

/**
 * Build a `DebriefAnalytics` from an exercise name + rep array, filling
 * derived aggregates. Callers that already have pre-computed values can
 * skip this and construct the object directly.
 */
export function deriveDebriefAnalytics(
  sessionId: string,
  exerciseName: string,
  reps: RepAnalytics[],
): DebriefAnalytics {
  const repCount = reps.length;
  const avgFqi =
    repCount === 0 ? null : reps.reduce((a, r) => a + (r.fqi ?? 0), 0) / repCount;
  return {
    sessionId,
    exerciseName,
    repCount,
    avgFqi,
    fqiTrendSlope: repCount >= 2 ? computeFqiTrendSlope(reps) : null,
    topFault: topFaultOf(reps),
    maxSymmetryPct: maxSymmetryOf(reps),
    tempoTrendSlope: tempoTrendSlopeOf(reps),
    reps,
  };
}

// ---------------------------------------------------------------------------
// Prompt assembly
// ---------------------------------------------------------------------------

/**
 * Minimal live-session serializer. Produces a <= 80-word factual summary
 * suitable for the user message.
 *
 * TODO(#439): swap for `coach-live-snapshot.summarizeForPrompt` when #443
 * lands. The canonical implementation will own session-level metadata like
 * set types, rest intervals, and heart-rate context.
 */
function summarizeAnalyticsForPrompt(a: DebriefAnalytics): string {
  const parts: string[] = [];
  // Pipeline-v2: user-sourced exercise name + fault label pass through the
  // injection hardener before interpolation. Flag-off keeps the raw values.
  parts.push(`Exercise: ${maybeHarden(a.exerciseName, 80)}.`);
  parts.push(`Reps logged: ${a.repCount}.`);
  if (a.avgFqi !== null) parts.push(`Average FQI: ${a.avgFqi.toFixed(2)}.`);
  if (a.fqiTrendSlope !== null) {
    const direction = a.fqiTrendSlope > 0.005 ? 'improving' : a.fqiTrendSlope < -0.005 ? 'fatiguing' : 'flat';
    parts.push(`FQI trend: ${direction} (slope ${a.fqiTrendSlope.toFixed(3)}).`);
  }
  if (a.topFault) parts.push(`Most-common fault: ${maybeHarden(a.topFault, 80)}.`);
  if (a.maxSymmetryPct !== null) parts.push(`Peak asymmetry: ${a.maxSymmetryPct.toFixed(0)}%.`);
  if (a.tempoTrendSlope !== null) {
    const tempoDir =
      a.tempoTrendSlope > 20 ? 'slowing' : a.tempoTrendSlope < -20 ? 'speeding up' : 'steady';
    parts.push(`Eccentric tempo: ${tempoDir}.`);
  }
  return parts.join(' ');
}

export interface BuildDebriefPromptOptions {
  /** Optional name of the athlete, already sanitized client-side. */
  athleteName?: string | null;
  /** Optional memory clause (re-used from coach-memory-context). */
  memoryClause?: string | null;
  /**
   * Optional user cue preferences for the top exercise. When provided AND
   * the pipeline-v2 master flag is on, a "User prefers X / dislikes Y" clause
   * is rendered into the system prompt so the coach can weight its advice.
   *
   * Caller is responsible for fetching these via
   * `coach-cue-feedback.getExercisePreferences(exerciseName)` — the builder
   * stays synchronous.
   */
  cuePreferences?: CuePreference[] | null;
}

/**
 * Pipeline-v2: render a short "user prefers X, dislikes Y" clause from cue
 * preferences. Returns '' when there's nothing to say. Exported for tests.
 */
export function renderCuePreferenceClause(
  prefs: CuePreference[] | null | undefined,
): string {
  if (!prefs || prefs.length === 0) return '';
  // Only consider preferences with a non-trivial sample and a clear signal.
  const preferred = prefs
    .filter((p) => p.score >= 0.3 && p.voteCount >= 1)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((p) => p.cueKey);
  const disliked = prefs
    .filter((p) => p.score <= -0.3 && p.voteCount >= 1)
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map((p) => p.cueKey);

  const segments: string[] = [];
  if (preferred.length > 0) {
    segments.push(`User prefers ${preferred.join(', ')} cues`);
  }
  if (disliked.length > 0) {
    segments.push(`dislikes ${disliked.join(', ')} cues`);
  }
  if (segments.length === 0) return '';
  return `${segments.join('; ')}.`;
}

/** Shape of the coach payload we hand to `sendCoachPrompt` / equivalent. */
export function buildDebriefPrompt(
  analytics: DebriefAnalytics,
  opts: BuildDebriefPromptOptions = {},
): CoachMessage[] {
  const nameLine = opts.athleteName
    ? `You are debriefing ${maybeHarden(opts.athleteName, 60)}.`
    : '';
  const memoryLine = opts.memoryClause
    ? ` Prior context: ${maybeHarden(opts.memoryClause, 400)}`
    : '';
  // Pipeline v2: inject user cue preferences so the coach can weight its
  // language toward the athlete's preferred framings. Flag-gated; empty
  // clause when the flag is off or no strong preferences exist.
  const cueLine =
    isCoachPipelineV2Enabled() && opts.cuePreferences
      ? renderCuePreferenceClause(opts.cuePreferences)
      : '';
  const systemContent = [
    "You are Form Factor's post-session coach.",
    nameLine,
    'Author a 150-250 word personalized debrief that celebrates a real positive, names the single most important fix, and gives one concrete drill or cue for next session.',
    'Tone: warm, specific, zero fluff. Avoid medical claims.',
    'Format: 1 short paragraph, then a 1-line "Next session:" directive.',
    memoryLine,
    cueLine,
  ]
    .filter(Boolean)
    .join(' ');

  const userContent = [
    `Session analytics to debrief:`,
    summarizeAnalyticsForPrompt(analytics),
    '',
    'Write the debrief now.',
  ].join('\n');

  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: userContent },
  ];
}
