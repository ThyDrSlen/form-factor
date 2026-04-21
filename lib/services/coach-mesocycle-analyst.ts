/**
 * Coach Mesocycle Analyst
 *
 * Gemma-ready prompt builder + thin invoker for natural-language summaries of
 * a 4-week form-tracking mesocycle. The invoker routes through whatever
 * `sendCoachPrompt` function the caller passes in — when the Gemma cloud
 * provider lands (see PR #457 + the drill-explainer TODO marker in
 * `coach-drill-explainer.ts`), the Edge Function can dispatch on
 * `focus === 'mesocycle-analyst'` to Gemma without any client changes.
 */

import type {
  MesocycleInsights,
  MesocycleFaultCount,
  MesocycleWeekBucket,
} from '@/lib/services/form-mesocycle-aggregator';

export const MESOCYCLE_ANALYST_FOCUS = 'mesocycle-analyst';

export interface MesocycleAnalystResult {
  /** The analyst's natural-language review of the mesocycle. */
  text: string;
  /**
   * Which provider returned the response, if the caller surfaced it.
   * Expected values: `'openai'`, `'gemma-cloud'`, `'local-fallback'`.
   * Annotated as `'cloud'` today; swap to `'gemma-cloud'` once the provider
   * dispatcher lands (#454 / #457).
   */
  provider: 'cloud' | 'gemma-cloud' | 'local-fallback';
}

export interface SendCoachPromptFn {
  (options: {
    messages: { role: 'user' | 'assistant' | 'system'; content: string }[];
    context?: { focus?: string; [key: string]: unknown };
  }): Promise<
    | {
        message?: { role: string; content: string };
        /**
         * Optional provider annotation surfaced by `sendCoachGemmaPrompt`
         * (and the generic `sendCoachPrompt`) on assistant replies. When
         * present, we honor it so the analyst result reports `gemma-cloud`
         * vs the generic `cloud` label.
         */
        provider?: 'openai' | 'gemma-cloud' | 'gemma-on-device' | 'local-fallback' | 'cached' | string;
      }
    | null
    | undefined
  >;
}

/**
 * Build a concise analyst prompt from the mesocycle insights. The prompt is
 * user-consumable (it sits in the coach turn box as the user's question) so
 * it reads naturally rather than as a JSON blob. Gemma 4's 131k context
 * handles this easily; shaping it short also keeps OpenAI parity.
 */
export function buildMesocycleAnalystPrompt(insights: MesocycleInsights): string {
  if (insights.isEmpty) {
    return 'Give me a read on my last 4 weeks of form tracking — there is no data yet, so explain what I need to do to start building this view.';
  }

  const weeklyLine = insights.weeks
    .map((week: MesocycleWeekBucket) => {
      const fqi = week.avgFqi == null ? '—' : week.avgFqi;
      return `W${week.weekIndex + 1} (${week.weekStartIso}): FQI ${fqi}, ${week.sessionsCount} sessions, ${week.repsCount} reps`;
    })
    .join('; ');

  const faultLine =
    insights.topFaults.length > 0
      ? insights.topFaults
          .map((fault: MesocycleFaultCount) => `${fault.fault} ×${fault.count}`)
          .join(', ')
      : 'no recurring faults';

  const deloadLine =
    insights.deload.severity === 'none'
      ? 'deload signal clear'
      : `deload signal ${insights.deload.severity}${
          insights.deload.reason ? ` (${insights.deload.reason})` : ''
        }`;

  return [
    'Review my last 4 weeks of form tracking and tell me what I should focus on next week.',
    `Weekly: ${weeklyLine}.`,
    `Recurring faults: ${faultLine}.`,
    `${deloadLine}.`,
    'Keep the response under 150 words and give me one concrete next step.',
  ].join(' ');
}

/**
 * Send the analyst prompt via the caller-provided sendCoachPrompt adapter.
 * Returns `null` if the adapter returns nothing parseable — callers render
 * a simple "no response" state rather than throwing.
 */
export async function requestMesocycleAnalysis(
  insights: MesocycleInsights,
  sendCoachPrompt: SendCoachPromptFn,
): Promise<MesocycleAnalystResult | null> {
  const prompt = buildMesocycleAnalystPrompt(insights);
  const response = await sendCoachPrompt({
    messages: [{ role: 'user', content: prompt }],
    context: { focus: MESOCYCLE_ANALYST_FOCUS },
  });

  const text = response?.message?.content?.trim();
  if (!text) return null;

  // Honor the provider annotation the caller's sendCoachPrompt may surface
  // on the response (coach-service and coach-gemma-service both set
  // `provider` on successful replies). When present and gemma-cloud,
  // label accordingly; otherwise fall back to the generic `cloud` tag
  // so legacy adapters that don't emit `provider` still work.
  const provider = response?.provider;
  if (provider === 'gemma-cloud') {
    return { text, provider: 'gemma-cloud' };
  }
  return { text, provider: 'cloud' };
}
