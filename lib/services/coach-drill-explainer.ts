import { sendCoachPrompt } from '@/lib/services/coach-service';
import type { CoachMessage } from '@/lib/services/coach-service';
import { isCoachPipelineV2Enabled } from '@/lib/services/coach-pipeline-v2-flag';

export type DrillExplainerProvider = 'cloud' | 'gemma' | 'openai';

/**
 * Pipeline-v2 provider resolution. Reads `EXPO_PUBLIC_COACH_CLOUD_PROVIDER`
 * mirroring `coach-auto-debrief.resolveCloudProvider`. Returns 'openai' when
 * unset or unrecognised.
 */
function resolveDrillProvider(): 'gemma' | 'openai' {
  const raw = (process.env.EXPO_PUBLIC_COACH_CLOUD_PROVIDER ?? 'openai')
    .trim()
    .toLowerCase();
  if (raw === 'gemma') return 'gemma';
  return 'openai';
}

export interface DrillFaultInput {
  code: string;
  displayName?: string;
  count: number;
  severity: 1 | 2 | 3;
}

export interface ExplainDrillInput {
  drillTitle: string;
  drillCategory: string;
  drillWhy: string;
  exerciseId: string;
  faults: DrillFaultInput[];
  userName?: string;
}

export interface ExplainDrillResult {
  explanation: string;
  provider: DrillExplainerProvider;
  error?: string;
}

const SYSTEM_PROMPT =
  "You're a strength coach. Given a drill and the form faults it targets, explain in 40-70 words why this drill helps THIS lifter RIGHT NOW. Reference their specific faults (by displayName when provided). Keep it direct, second-person, no hype. No markdown, no lists.";

function summarizeFaults(faults: DrillFaultInput[]): string {
  if (faults.length === 0) return 'no specific faults detected this session';
  return faults
    .map((f) => {
      const name = f.displayName ?? f.code.replace(/_/g, ' ');
      const severity = f.severity === 3 ? 'major' : f.severity === 2 ? 'moderate' : 'minor';
      return `${f.count}× ${severity} ${name}`;
    })
    .join(', ');
}

export function buildDrillExplainerMessages(input: ExplainDrillInput): CoachMessage[] {
  const faultLine = summarizeFaults(input.faults);
  const user =
    `Exercise: ${input.exerciseId}\n` +
    `Drill: ${input.drillTitle} (${input.drillCategory})\n` +
    `Stated rationale: ${input.drillWhy}\n` +
    `Faults this session: ${faultLine}` +
    (input.userName ? `\nLifter name: ${input.userName}` : '');
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: user },
  ];
}

/**
 * Routes through the coach Edge Function with `focus: 'drill-explainer'`.
 *
 * Pipeline-v2: when the master flag is on, resolve the provider via
 * `EXPO_PUBLIC_COACH_CLOUD_PROVIDER` (mirroring `coach-auto-debrief.ts:157`)
 * and pass it through to `sendCoachPrompt`. Flag off → legacy behavior
 * (hardcoded 'cloud' return annotation).
 */
export async function explainDrill(input: ExplainDrillInput): Promise<ExplainDrillResult> {
  const messages = buildDrillExplainerMessages(input);
  const pipelineV2 = isCoachPipelineV2Enabled();
  const resolvedProvider: 'gemma' | 'openai' | null = pipelineV2
    ? resolveDrillProvider()
    : null;
  const returnedProvider: DrillExplainerProvider = resolvedProvider ?? 'cloud';

  try {
    const reply = await sendCoachPrompt(
      messages,
      {
        focus: 'drill-explainer',
        sessionId: undefined,
      },
      resolvedProvider ? { provider: resolvedProvider } : undefined,
    );
    const text = (reply.content ?? '').trim();
    if (!text) {
      return { explanation: '', provider: returnedProvider, error: 'Empty response from coach.' };
    }
    return { explanation: text, provider: returnedProvider };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown coach error';
    return {
      explanation: '',
      provider: returnedProvider,
      error: message,
    };
  }
}

export const DRILL_EXPLAINER_SYSTEM_PROMPT = SYSTEM_PROMPT;
