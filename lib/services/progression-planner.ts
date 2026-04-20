/**
 * Progression plan generator.
 *
 * Builds a compact prompt from a summary of recent exercise performance and
 * dispatches it through the existing coach-service so the backend can route
 * the request (OpenAI today, Gemma once the #457/#471 provider dispatch
 * merges). Caches plans in-memory keyed by (user, exercise, weekHash) so
 * the modal can re-render without re-invoking the Edge Function.
 *
 * TODO(#466): wire provider/dispatch streaming opts once they land; today
 * the coach Edge Function returns a single blob and we surface it as-is.
 */

import { sendCoachPrompt, type CoachContext, type CoachMessage } from './coach-service';
import type { ExerciseHistorySummary } from './exercise-history-service';

export interface ProgressionPlanInput {
  userId: string;
  exercise: string;
  summary: ExerciseHistorySummary;
  /** Optional override — otherwise defaults to a 3-week horizon. */
  horizonWeeks?: number;
  /** Coach context (profile/session) to forward for persistence. */
  context?: CoachContext;
}

export interface ProgressionPlan {
  /** Raw text returned by the coach. */
  text: string;
  /** Same prompt body that was sent (surfaced for debug + replay). */
  promptPreview: string;
  /** ISO timestamp when the plan was generated. */
  generatedAt: string;
  /** Horizon used for the prompt. */
  horizonWeeks: number;
  /** Unique cache key used. */
  cacheKey: string;
}

const DEFAULT_HORIZON_WEEKS = 3;

type PlanCacheEntry = { key: string; value: ProgressionPlan };

const PLAN_CACHE: Map<string, PlanCacheEntry> = new Map();
const PLAN_CACHE_MAX = 32;

function summarizeLatestSets(summary: ExerciseHistorySummary): string {
  if (!summary.sets.length) return 'no prior sets logged';
  const recent = summary.sets.slice(0, 3);
  return recent
    .map(
      (s) =>
        `${s.weight}lb × ${s.reps} reps (${s.sets} set${s.sets === 1 ? '' : 's'}) on ${s.date}`,
    )
    .join('; ');
}

function summarizePrs(summary: ExerciseHistorySummary): string {
  const triggered = summary.prData.filter((p) => p.isPr);
  if (!triggered.length) return 'no new PRs in the current window';
  return triggered.map((p) => p.label).join(' | ');
}

export function buildProgressionPrompt(
  input: ProgressionPlanInput,
): string {
  const { summary, exercise } = input;
  const horizon = input.horizonWeeks ?? DEFAULT_HORIZON_WEEKS;
  const latest = summarizeLatestSets(summary);
  const prs = summarizePrs(summary);
  const est = summary.estimatedOneRepMax;
  return [
    `Exercise: ${exercise}.`,
    `Recent sets: ${latest}.`,
    `Estimated 1RM: ${est || 'unknown'}.`,
    `Recent PRs: ${prs}.`,
    `Please propose a ${horizon}-week progressive overload plan with target weight, reps, and RPE per session. Be concise; use bullet points per week.`,
  ].join('\n');
}

function cacheKeyFor(input: ProgressionPlanInput): string {
  const latest = input.summary.lastSession;
  const bucket = latest
    ? `${latest.date}-${latest.weight}-${latest.reps}`
    : 'empty';
  const horizon = input.horizonWeeks ?? DEFAULT_HORIZON_WEEKS;
  return `${input.userId}::${input.exercise}::${horizon}w::${bucket}`;
}

function insertCacheEntry(entry: PlanCacheEntry): void {
  PLAN_CACHE.set(entry.key, entry);
  if (PLAN_CACHE.size > PLAN_CACHE_MAX) {
    const firstKey = PLAN_CACHE.keys().next().value;
    if (firstKey !== undefined) PLAN_CACHE.delete(firstKey);
  }
}

export function clearProgressionPlanCache(): void {
  PLAN_CACHE.clear();
}

export async function generateProgressionPlan(
  input: ProgressionPlanInput,
): Promise<ProgressionPlan> {
  const prompt = buildProgressionPrompt(input);
  const cacheKey = cacheKeyFor(input);
  const cached = PLAN_CACHE.get(cacheKey);
  if (cached) return cached.value;

  const messages: CoachMessage[] = [
    {
      role: 'system',
      content:
        'You are a strength coach. Produce concise progressive overload plans with specific target weights, reps, and RPE values. Use markdown bullet lists grouped per week.',
    },
    { role: 'user', content: prompt },
  ];

  const response = await sendCoachPrompt(messages, input.context);
  const plan: ProgressionPlan = {
    text: response.content,
    promptPreview: prompt,
    generatedAt: new Date().toISOString(),
    horizonWeeks: input.horizonWeeks ?? DEFAULT_HORIZON_WEEKS,
    cacheKey,
  };
  insertCacheEntry({ key: cacheKey, value: plan });
  return plan;
}
