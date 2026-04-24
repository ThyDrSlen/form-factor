/**
 * Warmup Generator Service
 *
 * NL exercises → 5-10 min mobility + activation plan. Mirrors the pattern
 * from session-generator but returns a lighter `WarmupPlan` tree (no template
 * row materialization — callers consume directly as a checklist).
 */
import {
  sendCoachPrompt,
  type CoachContext,
  type CoachMessage,
  type CoachSendOptions,
} from './coach-service';
import { parseGemmaJsonResponse, schema, type JsonSchema } from './gemma-json-parser';
import { assertGemmaSessionGenEnabled } from './gemma-session-gen-flag';
import {
  buildWarmupGeneratorMessages,
  type WarmupGeneratorInput,
} from './warmup-generator-prompt';

// =============================================================================
// Response types
// =============================================================================

export type WarmupFocus = 'mobility' | 'activation' | 'cardio' | 'breathing';
export type WarmupIntensity = 'low' | 'medium' | 'high';

export interface WarmupMovement {
  name: string;
  duration_seconds?: number;
  reps?: number;
  focus: WarmupFocus;
  intensity: WarmupIntensity;
  notes?: string;
}

export interface WarmupPlan {
  name: string;
  duration_min: number;
  movements: WarmupMovement[];
}

const FOCUS_VALUES = ['mobility', 'activation', 'cardio', 'breathing'] as const;
const INTENSITY_VALUES = ['low', 'medium', 'high'] as const;

const MOVEMENT_SHAPE: JsonSchema<WarmupMovement> = schema.object({
  name: schema.string({ minLength: 1 }),
  duration_seconds: schema.optional(schema.number({ min: 1, max: 1800, integer: true })),
  reps: schema.optional(schema.number({ min: 1, max: 200, integer: true })),
  focus: schema.enumOf(FOCUS_VALUES),
  intensity: schema.enumOf(INTENSITY_VALUES),
  notes: schema.optional(schema.string()),
});

export const WARMUP_PLAN_SCHEMA: JsonSchema<WarmupPlan> = schema.object({
  name: schema.string({ minLength: 1 }),
  duration_min: schema.number({ min: 1, max: 60 }),
  movements: schema.array(MOVEMENT_SHAPE, { minLength: 2, maxLength: 12 }),
});

// =============================================================================
// Runtime + generate
// =============================================================================

export interface WarmupGeneratorRuntime {
  coachContext?: CoachContext;
  /**
   * Dispatcher override for tests. When production uses the default
   * (`sendCoachPrompt`), taskKind is threaded through via the third arg so the
   * cost-tracker can attribute spend to `progression_planner`.
   */
  dispatch?: (
    messages: CoachMessage[],
    ctx?: CoachContext,
    opts?: CoachSendOptions,
  ) => Promise<CoachMessage>;
  maxRetries?: number;
  /**
   * Bypass the EXPO_PUBLIC_GEMMA_SESSION_GEN gate. Intended for integration
   * tests; unit tests that inject `dispatch` skip the gate automatically.
   */
  skipFlagCheck?: boolean;
}

/**
 * Task-kind hint passed to `sendCoachPrompt` so the cost-tracker attributes
 * warmup-generator spend and the dispatch router can pick Gemma when enabled.
 */
export const WARMUP_GENERATOR_TASK_KIND = 'progression_planner' as const;

export async function generateWarmup(
  input: WarmupGeneratorInput,
  runtime: WarmupGeneratorRuntime = {},
): Promise<WarmupPlan> {
  if (!runtime.dispatch && !runtime.skipFlagCheck) {
    assertGemmaSessionGenEnabled('warmup-generator');
  }

  const messages = buildWarmupGeneratorMessages(input);
  const dispatch = runtime.dispatch ?? sendCoachPrompt;
  const dispatchOpts: CoachSendOptions = { taskKind: WARMUP_GENERATOR_TASK_KIND };

  const response = await dispatch(messages, runtime.coachContext, dispatchOpts);

  const retryInvoker = async (ctx: { lastRawText: string; issues?: unknown }): Promise<string> => {
    const retryMessages: CoachMessage[] = [
      ...messages,
      { role: 'assistant', content: ctx.lastRawText },
      {
        role: 'user',
        content: `The previous response did not match the warmup schema. Issues: ${JSON.stringify(ctx.issues ?? 'syntax error')}. Respond ONLY with corrected JSON.`,
      },
    ];
    const retry = await dispatch(retryMessages, runtime.coachContext, dispatchOpts);
    return retry.content;
  };

  return parseGemmaJsonResponse(response.content, WARMUP_PLAN_SCHEMA, {
    maxRetries: runtime.maxRetries ?? 1,
    retry: retryInvoker,
  });
}
