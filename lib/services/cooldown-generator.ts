/**
 * Cooldown Generator Service
 *
 * Completed exercises + RPE → post-session recovery routine.
 */
import { sendCoachPrompt, type CoachContext, type CoachMessage } from './coach-service';
import { parseGemmaJsonResponse, schema, type JsonSchema } from './gemma-json-parser';
import { assertGemmaSessionGenEnabled } from './gemma-session-gen-flag';
import {
  buildCooldownGeneratorMessages,
  type CooldownGeneratorInput,
} from './cooldown-generator-prompt';

export type CooldownFocus = 'stretch' | 'breathing' | 'cardio' | 'activation';
export type CooldownIntensity = 'low' | 'medium' | 'high';

export interface CooldownMovement {
  name: string;
  duration_seconds?: number;
  reps?: number;
  focus: CooldownFocus;
  intensity: CooldownIntensity;
  notes?: string;
}

export interface CooldownPlan {
  name: string;
  duration_min: number;
  movements: CooldownMovement[];
  reflection_prompt?: string;
}

const FOCUS_VALUES = ['stretch', 'breathing', 'cardio', 'activation'] as const;
const INTENSITY_VALUES = ['low', 'medium', 'high'] as const;

const MOVEMENT_SHAPE: JsonSchema<CooldownMovement> = schema.object({
  name: schema.string({ minLength: 1 }),
  duration_seconds: schema.optional(schema.number({ min: 1, max: 1800, integer: true })),
  reps: schema.optional(schema.number({ min: 1, max: 200, integer: true })),
  focus: schema.enumOf(FOCUS_VALUES),
  intensity: schema.enumOf(INTENSITY_VALUES),
  notes: schema.optional(schema.string()),
});

export const COOLDOWN_PLAN_SCHEMA: JsonSchema<CooldownPlan> = schema.object({
  name: schema.string({ minLength: 1 }),
  duration_min: schema.number({ min: 1, max: 60 }),
  movements: schema.array(MOVEMENT_SHAPE, { minLength: 2, maxLength: 10 }),
  reflection_prompt: schema.optional(schema.string()),
});

export interface CooldownGeneratorRuntime {
  coachContext?: CoachContext;
  dispatch?: (messages: CoachMessage[], ctx?: CoachContext) => Promise<CoachMessage>;
  maxRetries?: number;
  /**
   * Bypass the EXPO_PUBLIC_GEMMA_SESSION_GEN gate. Intended for integration
   * tests; unit tests that inject `dispatch` skip the gate automatically.
   */
  skipFlagCheck?: boolean;
}

export async function generateCooldown(
  input: CooldownGeneratorInput,
  runtime: CooldownGeneratorRuntime = {},
): Promise<CooldownPlan> {
  if (!runtime.dispatch && !runtime.skipFlagCheck) {
    assertGemmaSessionGenEnabled('cooldown-generator');
  }

  const messages = buildCooldownGeneratorMessages(input);
  const dispatch = runtime.dispatch ?? sendCoachPrompt;

  const response = await dispatch(messages, runtime.coachContext);

  const retryInvoker = async (ctx: { lastRawText: string; issues?: unknown }): Promise<string> => {
    const retryMessages: CoachMessage[] = [
      ...messages,
      { role: 'assistant', content: ctx.lastRawText },
      {
        role: 'user',
        content: `The previous response did not match the cooldown schema. Issues: ${JSON.stringify(ctx.issues ?? 'syntax error')}. Respond ONLY with corrected JSON.`,
      },
    ];
    const retry = await dispatch(retryMessages, runtime.coachContext);
    return retry.content;
  };

  return parseGemmaJsonResponse(response.content, COOLDOWN_PLAN_SCHEMA, {
    maxRetries: runtime.maxRetries ?? 1,
    retry: retryInvoker,
  });
}
