/**
 * Warmup Generator Service
 *
 * NL exercises → 5-10 min mobility + activation plan. Mirrors the pattern
 * from session-generator but returns a lighter `WarmupPlan` tree (no template
 * row materialization — callers consume directly as a checklist).
 */
import { assertDailyBudget } from './coach-cost-tracker';
import { sendCoachPrompt, type CoachContext, type CoachMessage } from './coach-service';
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
  dispatch?: (messages: CoachMessage[], ctx?: CoachContext) => Promise<CoachMessage>;
  maxRetries?: number;
  /**
   * Bypass the EXPO_PUBLIC_GEMMA_SESSION_GEN gate. Intended for integration
   * tests; unit tests that inject `dispatch` skip the gate automatically.
   */
  skipFlagCheck?: boolean;
}

export async function generateWarmup(
  input: WarmupGeneratorInput,
  runtime: WarmupGeneratorRuntime = {},
): Promise<WarmupPlan> {
  if (!runtime.dispatch && !runtime.skipFlagCheck) {
    assertGemmaSessionGenEnabled('warmup-generator');
  }

  // Enforce per-surface daily budget before spending tokens. Only gates the
  // real dispatcher; tests / eval harnesses that inject `dispatch` are
  // allowed through. Throws a typed BudgetExceededError.
  if (!runtime.dispatch) {
    await assertDailyBudget('warmup_generator');
  }

  const messages = buildWarmupGeneratorMessages(input);
  const dispatch = runtime.dispatch ?? sendCoachPrompt;

  // Attach `focus: 'warmup_generator'` so the cost tracker / telemetry
  // pipelines can attribute tokens to this surface (mirrors the pattern in
  // coach-auto-debrief / drill-explainer). Caller-supplied focus wins when
  // present so explicit attribution overrides the default.
  const dispatchContext: CoachContext = {
    ...(runtime.coachContext ?? {}),
    focus: runtime.coachContext?.focus ?? 'warmup_generator',
  };

  const response = await dispatch(messages, dispatchContext);

  const retryInvoker = async (ctx: { lastRawText: string; issues?: unknown }): Promise<string> => {
    const retryMessages: CoachMessage[] = [
      ...messages,
      { role: 'assistant', content: ctx.lastRawText },
      {
        role: 'user',
        content: `The previous response did not match the warmup schema. Issues: ${JSON.stringify(ctx.issues ?? 'syntax error')}. Respond ONLY with corrected JSON.`,
      },
    ];
    const retry = await dispatch(retryMessages, dispatchContext);
    return retry.content;
  };

  return parseGemmaJsonResponse(response.content, WARMUP_PLAN_SCHEMA, {
    maxRetries: runtime.maxRetries ?? 1,
    retry: retryInvoker,
  });
}
