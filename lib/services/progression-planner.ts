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
import { isCoachPipelineV2Enabled } from './coach-pipeline-v2-flag';
import { recordCoachUsage } from './coach-cost-tracker';
import { recordExplicitProviderOverride } from './coach-model-dispatch-telemetry';

const PROGRESSION_TASK_KIND = 'program_design' as const;

function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

type SendCoachPromptOpts = Parameters<typeof sendCoachPrompt>[2];

/**
 * Pipeline-v2: resolve the provider from env. Mirrors
 * `coach-auto-debrief.resolveCloudProvider` and `coach-drill-explainer`.
 */
function resolveProgressionProvider(): 'gemma' | 'openai' {
  const raw = (process.env.EXPO_PUBLIC_COACH_CLOUD_PROVIDER ?? 'openai')
    .trim()
    .toLowerCase();
  if (raw === 'gemma') return 'gemma';
  return 'openai';
}

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
  /**
   * Provider that produced the plan, when the coach reply exposes a
   * `provider` annotation. Omitted for legacy replies without the
   * discriminator.
   */
  provider?: string;
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
  opts?: SendCoachPromptOpts,
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

  // Pipeline v2: route by provider dispatch. The planner is "complex" in
  // dispatch-router terms, so when the flag is on we pass the env-resolved
  // provider as an explicit hint; flag-off preserves the legacy two-arg
  // call (which defaults to the resolved cloud provider inside
  // coach-service). Lands the TODO from line 6.
  //
  // When callers explicitly supply an `opts` object, it wins over the
  // env-resolved default — same precedence rule used in coach-service
  // (`opts.provider ?? routedProvider ?? resolveCloudProvider()`). This
  // lets callers bypass the env-resolved provider when they already know
  // what they want (e.g. pre-wired task-kind dispatch).
  const pipelineOpts: SendCoachPromptOpts | undefined = isCoachPipelineV2Enabled()
    ? { provider: resolveProgressionProvider(), taskKind: PROGRESSION_TASK_KIND }
    : { taskKind: PROGRESSION_TASK_KIND };
  const mergedOpts: SendCoachPromptOpts | undefined =
    opts !== undefined
      ? { ...pipelineOpts, ...opts }
      : pipelineOpts;

  // Telemetry: the planner pins an explicit provider when pipeline-v2 is
  // on, so the dispatch router in coach-service skips
  // `recordDispatchDecision`. Fire the explicit-override counter here so
  // the taskKind ('program_design') still lands in the decision
  // dashboard. Caller-supplied opts win over the computed provider (same
  // precedence as the merge above).
  const decidedProvider: 'gemma' | 'openai' = (() => {
    const hint = mergedOpts?.provider;
    if (hint === 'gemma' || hint === 'openai') return hint;
    return 'openai';
  })();
  try {
    recordExplicitProviderOverride({
      taskKind: PROGRESSION_TASK_KIND,
      decidedProvider,
      reason: 'progression-planner-explicit-provider',
    });
  } catch {
    // Telemetry is never load-bearing.
  }

  const response = await sendCoachPrompt(messages, input.context, mergedOpts);

  // Weekly cost bucket: program design is a complex task. Estimator is
  // char-based (upstream token counts are not surfaced today).
  const promptText = messages.map((m) => m.content).join('\n');
  void recordCoachUsage({
    provider: decidedProvider === 'gemma' ? 'gemma_cloud' : 'openai',
    taskKind: PROGRESSION_TASK_KIND,
    tokensIn: estimateTokens(promptText),
    tokensOut: estimateTokens(response.content ?? ''),
  });

  const plan: ProgressionPlan = {
    text: response.content,
    promptPreview: prompt,
    generatedAt: new Date().toISOString(),
    horizonWeeks: input.horizonWeeks ?? DEFAULT_HORIZON_WEEKS,
    cacheKey,
    ...(response.provider ? { provider: response.provider } : {}),
  };
  insertCacheEntry({ key: cacheKey, value: plan });
  return plan;
}
