/**
 * Session Generator Service
 *
 * Generates a structured `WorkoutTemplate` (+ child exercise/set rows) from a
 * natural-language intent by calling the coach service through a JSON-mode
 * wrapper and hydrating the validated response into real Form Factor types.
 *
 * Flow:
 *   1. Build SYSTEM + few-shots + USER messages via session-generator-prompt.
 *   2. Dispatch through coach-service.sendCoachPrompt (Gemma or cloud route).
 *   3. Parse via gemma-json-parser with schema validation.
 *   4. Hydrate generated exercise/set tree into WorkoutTemplate shape with
 *      Crypto.randomUUID() ids.
 */
import * as Crypto from 'expo-crypto';
import { sendCoachPrompt, type CoachContext, type CoachMessage } from './coach-service';
import { parseGemmaJsonResponse, schema, type JsonSchema } from './gemma-json-parser';
import { assertGemmaSessionGenEnabled } from './gemma-session-gen-flag';
import {
  buildSessionGeneratorMessages,
  type SessionGeneratorInput,
} from './session-generator-prompt';
import type {
  GoalProfile,
  SetType,
  WorkoutTemplate,
  WorkoutTemplateExercise,
  WorkoutTemplateSet,
} from '@/lib/types/workout-session';

// =============================================================================
// Response schema (what the LLM returns)
// =============================================================================

export interface GeneratedSetShape {
  target_reps?: number;
  target_seconds?: number;
  target_weight?: number;
  target_rpe?: number;
  set_type?: SetType;
}

export interface GeneratedExerciseShape {
  exercise_slug: string;
  sets: GeneratedSetShape[];
  default_rest_seconds?: number;
  notes?: string;
}

export interface GeneratedTemplateShape {
  name: string;
  description: string;
  goal_profile: GoalProfile;
  exercises: GeneratedExerciseShape[];
}

const GOAL_PROFILES = ['hypertrophy', 'strength', 'power', 'endurance', 'mixed'] as const;
const SET_TYPES = ['normal', 'warmup', 'dropset', 'amrap', 'failure', 'timed'] as const;

const SET_SHAPE: JsonSchema<GeneratedSetShape> = schema.object({
  target_reps: schema.optional(schema.number({ min: 1, max: 1000, integer: true })),
  target_seconds: schema.optional(schema.number({ min: 1, max: 3600, integer: true })),
  target_weight: schema.optional(schema.number({ min: 0, max: 2000 })),
  target_rpe: schema.optional(schema.number({ min: 1, max: 10 })),
  set_type: schema.optional(schema.enumOf(SET_TYPES)),
});

const EXERCISE_SHAPE: JsonSchema<GeneratedExerciseShape> = schema.object({
  exercise_slug: schema.string({ minLength: 1 }),
  sets: schema.array(SET_SHAPE, { minLength: 1, maxLength: 20 }),
  default_rest_seconds: schema.optional(schema.number({ min: 0, max: 600, integer: true })),
  notes: schema.optional(schema.string()),
});

export const SESSION_GENERATOR_SCHEMA: JsonSchema<GeneratedTemplateShape> = schema.object({
  name: schema.string({ minLength: 1 }),
  description: schema.string(),
  goal_profile: schema.enumOf(GOAL_PROFILES),
  exercises: schema.array(EXERCISE_SHAPE, { minLength: 1, maxLength: 12 }),
});

// =============================================================================
// Hydrated template tree
// =============================================================================

export interface HydratedTemplate {
  template: WorkoutTemplate;
  exercises: Array<WorkoutTemplateExercise & { sets: WorkoutTemplateSet[]; exercise_slug: string }>;
  /** Raw response shape — useful for the UI to show a preview before persisting. */
  raw: GeneratedTemplateShape;
}

export interface SessionGeneratorRuntime {
  userId: string;
  coachContext?: CoachContext;
  /** Override dispatcher for tests. */
  dispatch?: (messages: CoachMessage[], ctx?: CoachContext) => Promise<CoachMessage>;
  /** Override uuid for tests. */
  uuid?: () => string;
  /** Retry count passed to gemma-json-parser. Default 1. */
  maxRetries?: number;
  /**
   * Bypass the `EXPO_PUBLIC_GEMMA_SESSION_GEN` feature flag gate. Intended for
   * tests and for callers that inject their own `dispatch` stub — when
   * `dispatch` is supplied we skip the assert automatically since no real
   * Gemma traffic is generated.
   */
  skipFlagCheck?: boolean;
}

/**
 * Generate a workout template from a natural-language intent.
 *
 * Throws AppError-bearing exceptions on coach dispatch failure, JSON parse /
 * validation failure, or retry exhaustion. Callers that want offline-fallback
 * behavior should wrap this in `withFallback` from session-generator-fallback.
 */
export async function generateSession(
  input: SessionGeneratorInput,
  runtime: SessionGeneratorRuntime,
): Promise<HydratedTemplate> {
  // Flag gate: only block the real production dispatcher. Tests and callers
  // that provide their own `dispatch` are allowed through so pure unit tests
  // don't need to toggle env vars.
  if (!runtime.dispatch && !runtime.skipFlagCheck) {
    assertGemmaSessionGenEnabled('session-generator');
  }

  const messages = buildSessionGeneratorMessages(input);
  const dispatch = runtime.dispatch ?? sendCoachPrompt;

  const assistantMessage = await dispatch(messages, runtime.coachContext);

  const retryInvoker = async (ctx: { lastRawText: string; issues?: unknown }): Promise<string> => {
    const retryMessages: CoachMessage[] = [
      ...messages,
      { role: 'assistant', content: ctx.lastRawText },
      {
        role: 'user',
        content: `The previous response was not valid JSON or did not match the schema. Issues: ${JSON.stringify(ctx.issues ?? 'syntax error')}. Respond ONLY with corrected JSON.`,
      },
    ];
    const retryResponse = await dispatch(retryMessages, runtime.coachContext);
    return retryResponse.content;
  };

  const parsed = await parseGemmaJsonResponse<GeneratedTemplateShape>(
    assistantMessage.content,
    SESSION_GENERATOR_SCHEMA,
    {
      maxRetries: runtime.maxRetries ?? 1,
      retry: retryInvoker,
    },
  );

  return hydrateTemplate(parsed, runtime);
}

// =============================================================================
// Hydration: shape -> WorkoutTemplate + rows
// =============================================================================

function nowIso(): string {
  return new Date().toISOString();
}

export function hydrateTemplate(
  raw: GeneratedTemplateShape,
  runtime: Pick<SessionGeneratorRuntime, 'userId' | 'uuid'>,
): HydratedTemplate {
  const uuid = runtime.uuid ?? (() => Crypto.randomUUID());
  const now = nowIso();
  const templateId = uuid();

  const template: WorkoutTemplate = {
    id: templateId,
    user_id: runtime.userId,
    name: raw.name,
    description: raw.description || null,
    goal_profile: raw.goal_profile,
    is_public: false,
    share_slug: null,
    created_at: now,
    updated_at: now,
  };

  const exercises = raw.exercises.map((ex, exIdx) => {
    const templateExerciseId = uuid();
    const sets: WorkoutTemplateSet[] = ex.sets.map((s, sIdx) => ({
      id: uuid(),
      template_exercise_id: templateExerciseId,
      sort_order: sIdx,
      set_type: s.set_type ?? 'normal',
      target_reps: s.target_reps ?? null,
      target_seconds: s.target_seconds ?? null,
      target_weight: s.target_weight ?? null,
      target_rpe: s.target_rpe ?? null,
      rest_seconds_override: null,
      notes: null,
      created_at: now,
      updated_at: now,
    }));

    return {
      id: templateExerciseId,
      template_id: templateId,
      exercise_id: '', // resolved later when UI matches exercise_slug to catalog
      sort_order: exIdx,
      notes: ex.notes ?? null,
      default_rest_seconds: ex.default_rest_seconds ?? null,
      default_tempo: null,
      created_at: now,
      updated_at: now,
      sets,
      exercise_slug: ex.exercise_slug,
    };
  });

  return { template, exercises, raw };
}
