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
import { assertDailyBudget } from './coach-cost-tracker';
import {
  sendCoachPrompt,
  type CoachContext,
  type CoachMessage,
  type CoachSendOptions,
} from './coach-service';
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

/** Task-kind hint exported for tests + callers that want to key telemetry. */
export const SESSION_GENERATOR_TASK_KIND = 'session_generator' as const;

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
  /**
   * Override dispatcher for tests. When production uses the default
   * (`sendCoachPrompt`), taskKind is threaded through via the third arg so
   * the cost-tracker + dispatch router can attribute spend to
   * `session_generator`.
   */
  dispatch?: (
    messages: CoachMessage[],
    ctx?: CoachContext,
    opts?: CoachSendOptions,
  ) => Promise<CoachMessage>;
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

  // Enforce per-surface daily budget before spending tokens. Only gates the
  // real dispatcher — callers that inject their own `dispatch` (tests, eval
  // harnesses) are allowed through. Throws a typed BudgetExceededError that
  // the UI can catch to show a quota-exceeded state.
  if (!runtime.dispatch) {
    await assertDailyBudget('session_generator');
  }

  const messages = buildSessionGeneratorMessages(input);
  const dispatch = runtime.dispatch ?? sendCoachPrompt;

  // Attach `focus: 'session_generator'` so the cost tracker and telemetry
  // pipelines can attribute usage/tokens back to this surface. Mirrors the
  // pattern in coach-auto-debrief / drill-explainer where a short snake_case
  // label is fed through CoachContext.focus (see coach-cost-tracker
  // CoachTaskKind). Preserves any caller-supplied context fields; a
  // caller-provided focus wins so explicit attribution overrides the default.
  const dispatchContext: CoachContext = {
    ...(runtime.coachContext ?? {}),
    focus: runtime.coachContext?.focus ?? 'session_generator',
  };

  // taskKind flows through CoachSendOptions (third arg) so the dispatch router
  // + cost-tracker attribute spend to `session_generator` on both the primary
  // turn and any JSON-retry turn.
  const dispatchOpts: CoachSendOptions = { taskKind: SESSION_GENERATOR_TASK_KIND };

  const assistantMessage = await dispatch(messages, dispatchContext, dispatchOpts);

  const retryInvoker = async (ctx: { lastRawText: string; issues?: unknown }): Promise<string> => {
    const retryMessages: CoachMessage[] = [
      ...messages,
      { role: 'assistant', content: ctx.lastRawText },
      {
        role: 'user',
        content: `The previous response was not valid JSON or did not match the schema. Issues: ${JSON.stringify(ctx.issues ?? 'syntax error')}. Respond ONLY with corrected JSON.`,
      },
    ];
    const retryResponse = await dispatch(retryMessages, dispatchContext, dispatchOpts);
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
