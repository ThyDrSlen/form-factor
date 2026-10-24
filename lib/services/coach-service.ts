import { warnWithTs } from '@/lib/logger';
import { ensureBuiltinProviders } from '@/lib/ai/providers';
import { getPreferredProviderId } from '@/lib/ai/config';
import { getProvider } from '@/lib/ai/registry';
import { generate, shouldFallBack } from '@/lib/ai/router';
import type { ModelResult } from '@/lib/ai/types';
import { createError, logError } from './ErrorHandler';
import {
  inferCoachProvider,
  type CoachProvider,
} from './coach-provider-types';
import { synthesizeMemoryClause } from './coach-memory-context';
import { shapeFinalResponse } from './coach-output-shaper';
import { isCoachPipelineV2Enabled } from './coach-pipeline-v2-flag';
import { evaluateSafety } from './coach-safety';
import {
  decideCoachModel,
  expectedTierModel,
  type CoachTaskKind,
  type CoachUserTier,
  type CoachSignals,
} from './coach-model-dispatch';
import {
  recordDispatchDecision,
  recordDispatchMismatch,
} from './coach-model-dispatch-telemetry';
import {
  recordCoachUsage,
  type CoachTaskKind as TrackerTaskKind,
  type CoachProvider as TrackerProvider,
} from './coach-cost-tracker';
import { recordCoachFailoverUsed } from './coach-telemetry';
import { buildCoachContext, persistCoachConversation } from './coach-workout-context';

export { parseRetryAfterMs } from '@/lib/ai/providers/edge-chat-provider';

function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function mapTaskKindToTracker(kind: CoachTaskKind | undefined): TrackerTaskKind {
  switch (kind) {
    case 'multi_turn_debrief':
      return 'debrief';
    case 'fault_explainer':
      return 'drill_explainer';
    case 'session_generator':
      return 'session_generator';
    case 'program_design':
      return 'progression_planner';
    default:
      return 'chat';
  }
}

function mapProviderToTracker(provider: CoachProvider): TrackerProvider {
  switch (provider) {
    case 'openai':
      return 'openai';
    case 'gemma-cloud':
      return 'gemma_cloud';
    case 'gemma-on-device':
    case 'on-device':
      return 'gemma_ondevice';
    default:
      return 'stub';
  }
}

function fireAndForgetRecordUsage(
  provider: CoachProvider,
  taskKind: CoachTaskKind | undefined,
  promptText: string,
  completionText: string,
  cacheHit = false,
): void {
  void recordCoachUsage({
    provider: mapProviderToTracker(provider),
    taskKind: mapTaskKindToTracker(taskKind),
    tokensIn: estimateTokens(promptText),
    tokensOut: estimateTokens(completionText),
    cacheHit,
  }).catch((err) => {
    warnWithTs('[coach-service] recordCoachUsage failed', err);
  });
}

export type { CoachProvider } from './coach-provider-types';
import type { LiveSessionSnapshot } from './coach-live-snapshot';

export type CoachRole = 'user' | 'assistant' | 'system';

export interface CoachMessage {
  role: CoachRole;
  content: string;
  id?: string;
  /**
   * The AI backend that produced this message. Set only on assistant replies
   * returned by `sendCoachPrompt`. Absent on user / system turns.
   */
  provider?: CoachProvider;
  /**
   * Model identifier returned by the upstream function (e.g. `gemma-3-4b-it`,
   * `gpt-5.4-mini`). Additive — callers may inspect for telemetry or model
   * routing audits; older producers that don't surface `model` leave it
   * undefined.
   */
  model?: string;
}

export interface CoachContext {
  /**
   * Identifier and display name only. NEVER include email, phone, or other
   * PII — prompts flow to third-party LLMs (OpenAI, Google Gemma cloud) and
   * may be logged at the edge. Keep this field minimal. Downstream edge
   * functions still accept an optional `email` in their input schema for
   * backward compatibility, but the client MUST NOT populate it.
   */
  profile?: {
    id?: string;
    name?: string | null;
  };
  /**
   * User-context label for prompt composition ONLY (e.g. 'fitness_coach',
   * 'pre-set-stance-preview'). Does NOT influence cost-aware routing — use
   * `CoachSendOptions.taskKind` to control which provider/model serves the
   * request. Callers that rely on `focus` for routing will silently hit the
   * default dispatch path.
   */
  focus?: string;
  sessionId?: string;
  /**
   * Optional in-session context passed to the coach edge function. When
   * present, the edge function appends a short "live session context" clause
   * to the system prompt. Purely additive — default call sites do not need to
   * set this.
   */
  liveSession?: LiveSessionSnapshot;
  /**
   * Optional pre-composed memory clause. When provided, skips the
   * AsyncStorage/Supabase lookup inside sendCoachPrompt() — useful for
   * callers (e.g. auto-debrief) that already built their own memory.
   */
  memoryClause?: string | null;
  workoutSummary?: string;
}

/**
 * Optional behaviors for `sendCoachPrompt`. All fields are additive and the
 * existing two-arg call shape (`sendCoachPrompt(messages, ctx?)`) keeps the
 * exact behavior it had before #465 landed.
 */
export interface CoachSendOptions {
  /**
   * Streaming mode (#465 Item 1).
   * - `true`: stream and return the full text once complete (no per-chunk callback).
   * - function: stream and invoke the callback for every delta.
   * - omitted/false: synchronous (default).
   */
  stream?: boolean | ((chunk: string) => void);
  /**
   * If true, a retryable failure (429/5xx/network) moves on to the next
   * enabled provider instead of surfacing (#465 Item 2). Without it only a
   * spend-cap rejection falls back.
   */
  allowFailover?: boolean;
  /**
   * Provider to try first (`gemma` → `gemma-cloud`). Ignored unless that
   * provider is enabled in `EXPO_PUBLIC_AI_PROVIDERS`.
   */
  provider?: 'gemma' | 'openai';
  /**
   * Response cache TTL in ms (#465 Item 3). 0 disables caching; omitted means
   * cache lookups are not consulted. Defaults are picked at the call site
   * (e.g. auto-debrief uses 12h).
   */
  cacheMs?: number;
  /**
   * Used by the cache integration to flag that the cached payload is the
   * already-shaped response (#465 Item 5). Internal; callers shouldn't need it.
   */
  shaper?: boolean;
  /**
   * Pipeline-v2 task kind hint. When the pipeline-v2 flag is on, the task
   * kind is fed to `decideCoachModel()` to prefer a provider (tactical →
   * Gemma, complex → GPT); the preference only applies when that provider is
   * enabled. Omitted means "general_chat".
   *
   * NOTE: `taskKind` is the ONLY routing signal. `CoachContext.focus` is a
   * cosmetic prompt label and does not affect model selection — always set
   * `taskKind` for new surfaces that should be cost-aware routed.
   */
  taskKind?: CoachTaskKind;
  /** Pipeline-v2 user tier for cost-aware model routing. Defaults to 'free'. */
  userTier?: CoachUserTier;
  /** Pipeline-v2 optional signals fed into the model dispatcher. */
  dispatchSignals?: CoachSignals;
}

/**
 * Feature-flag gate for prepending cross-session memory to coach prompts.
 * Defaults to ON (value 'true' or unset). Any other value disables the
 * memory clause so the coach behaves as before.
 */
function isMemoryEnabled(): boolean {
  const raw = (process.env.EXPO_PUBLIC_COACH_MEMORY ?? 'true').trim().toLowerCase();
  return raw === '' || raw === 'true' || raw === '1' || raw === 'on';
}

async function resolveMemoryClause(context?: CoachContext): Promise<string | null> {
  if (!isMemoryEnabled()) return null;
  if (context?.memoryClause !== undefined) return context.memoryClause ?? null;
  try {
    const clause = await synthesizeMemoryClause();
    return clause.text;
  } catch (err) {
    warnWithTs('[coach-service] memory clause synth failed; continuing without memory', err);
    return null;
  }
}

function applyMemoryClause(
  messages: CoachMessage[],
  memoryClause: string | null,
): CoachMessage[] {
  if (!memoryClause) return messages;
  const memoryMessage: CoachMessage = {
    role: 'system',
    content: `Athlete memory (recent sessions): ${memoryClause}`,
  };
  return [memoryMessage, ...messages];
}

const DEFAULT_MODEL_ID = 'gpt-5.4-mini';
const COST_CAP_CODE = 'COACH_COST_CAP_EXCEEDED';

const isCostCap = (err: unknown) =>
  !!err && typeof err === 'object' && (err as { code?: string }).code === COST_CAP_CODE;

/** allowFailover: retryable provider errors, spend caps, and raw transport throws. */
const isFailoverEligible = (err: unknown) =>
  shouldFallBack(err) || !(err && typeof err === 'object' && 'domain' in err);

/** Maps the caller's `gemma`|`openai` hint onto registry ids. */
function providerIdFromHint(hint: CoachSendOptions['provider']): string | undefined {
  if (!hint) return undefined;
  return hint === 'gemma' ? 'gemma-cloud' : hint;
}

/**
 * Pipeline v2 task-kind policy: a tactical task prefers Gemma, a complex one
 * GPT. Only consulted when the caller hasn't pinned a provider. Fires the
 * dispatch telemetry counters; telemetry is never load-bearing.
 */
function taskRoutedProviderId(opts?: CoachSendOptions): string | undefined {
  if (!isCoachPipelineV2Enabled() || !opts?.taskKind || opts.provider !== undefined) return undefined;
  const signals = opts.dispatchSignals ?? {};
  const tier = opts.userTier ?? 'free';
  const decision = decideCoachModel(opts.taskKind, signals, tier);
  try {
    recordDispatchDecision(decision);
    recordDispatchMismatch(expectedTierModel(opts.taskKind, signals, tier), decision.model, decision.reason);
  } catch {
    // Telemetry is never load-bearing.
  }
  return decision.model.startsWith('gemma-') ? 'gemma-cloud' : 'openai';
}

/** UI/telemetry provider label for a routed result. */
function coachProviderFor(result: ModelResult): CoachProvider {
  if (result.providerId === 'gemma-cloud') return 'gemma-cloud';
  if (getProvider(result.providerId)?.kind === 'on-device') return 'on-device';
  // The OpenAI edge function only reports a model; infer the badge from it.
  const raw = (result.raw ?? {}) as { provider?: string };
  return inferCoachProvider({ provider: raw.provider, model: result.model ?? DEFAULT_MODEL_ID, source: result.source });
}

function annotate(reply: CoachMessage, key: 'provider' | 'model', value: string): void {
  // Non-enumerable keeps backward-compatible equality for consumers that
  // shallow/deep-compare replies, while TypeScript and the UI can still read it.
  Object.defineProperty(reply, key, { value, enumerable: false, configurable: true, writable: true });
}

/**
 * Send a coach prompt. Streaming (`opts.stream`) uses the NDJSON stream path;
 * everything else is one routed turn, optionally cached (`opts.cacheMs`).
 *
 * Routing: `opts.provider`, then the pipeline-v2 task-kind policy, then the
 * user's preferred provider, then `EXPO_PUBLIC_AI_PROVIDERS` order (default
 * `openai`). Only enabled providers are tried. A spend-cap rejection always
 * falls back; other retryable failures fall back only with `allowFailover`.
 */
export async function sendCoachPrompt(
  messages: CoachMessage[],
  context?: CoachContext,
  opts?: CoachSendOptions
): Promise<CoachMessage> {
  if (opts?.stream) {
    return sendCoachPromptStreaming(messages, context, opts);
  }
  if (typeof opts?.cacheMs === 'number' && opts.cacheMs > 0) {
    // Lazy require keeps the dep graph 1-way (await import() does not work in
    // jest's CJS env without --experimental-vm-modules).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { withCoachCache } = require('./coach-cache') as typeof import('./coach-cache');
    return withCoachCache(messages, context, opts.cacheMs, () => runCoachTurn(messages, context, opts), {
      shaper: opts.shaper,
    });
  }
  return runCoachTurn(messages, context, opts);
}

async function sendCoachPromptStreaming(
  messages: CoachMessage[],
  context: CoachContext | undefined,
  opts: CoachSendOptions
): Promise<CoachMessage> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { streamCoachPrompt } = require('./coach-streaming') as typeof import('./coach-streaming');
  const onChunk =
    typeof opts.stream === 'function' ? opts.stream : () => undefined;
  const result = await streamCoachPrompt(messages, context, onChunk, {
    provider: opts.provider,
  });

  // Pipeline v2: apply the post-generation safety filter to the resolved
  // full-buffer text. Mirrors the non-stream path in sendCoachPromptInner.
  // On violation we throw `COACH_CLOUD_UNSAFE`; the UI surfaces it and the
  // dispatcher can choose a fallback string. Flag-gated.
  if (isCoachPipelineV2Enabled()) {
    const safety = evaluateSafety(result.text);
    if (!safety.ok) {
      logError(
        createError(
          'ml',
          'COACH_CLOUD_UNSAFE',
          `Cloud coach stream rejected: ${safety.reason}`,
          {
            retryable: false,
            severity: 'warning',
            details: { metric: safety.metric, reason: safety.reason },
          }
        ),
        { feature: 'workouts', location: 'coach-service.sendCoachPromptStreaming' }
      );
      throw createError(
        'ml',
        'COACH_CLOUD_UNSAFE',
        'Coach reply failed safety check',
        {
          retryable: false,
          severity: 'warning',
          details: { metric: safety.metric, reason: safety.reason },
        }
      );
    }
    return { role: 'assistant', content: shapeFinalResponse(safety.output) };
  }
  return { role: 'assistant', content: result.text };
}

async function runCoachTurn(
  messages: CoachMessage[],
  context: CoachContext | undefined,
  opts: CoachSendOptions | undefined,
): Promise<CoachMessage> {
  try {
    ensureBuiltinProviders();
    const prefer = [providerIdFromHint(opts?.provider), taskRoutedProviderId(opts)];
    if (!prefer.some(Boolean)) prefer.push((await getPreferredProviderId()) ?? undefined);

    const memoryClause = await resolveMemoryClause(context);
    const outgoingMessages = applyMemoryClause(messages, memoryClause);
    const contextWithMemory =
      memoryClause !== null
        ? { ...(context ?? {}), memoryClause }
        : context;
    const requestContext = await buildCoachContext(contextWithMemory);

    const result = await generate(
      { messages: outgoingMessages, context: requestContext, taskKind: opts?.taskKind },
      {
        prefer,
        fallbackWhen: opts?.allowFailover ? isFailoverEligible : isCostCap,
        onFallback: (from, to, err) => {
          if (isCostCap(err)) warnWithTs(`[coach-service] ${from} spend cap hit, falling back to ${to}`, err);
          recordCoachFailoverUsed(to);
        },
      },
    );

    // Pipeline v2: post-generation safety filter for every provider. On
    // violation we throw `COACH_CLOUD_UNSAFE`; the UI surfaces it or falls
    // back to a fallback-response string.
    let safeResponseText = result.text;
    if (isCoachPipelineV2Enabled()) {
      const safety = evaluateSafety(result.text);
      if (!safety.ok) {
        const unsafeErr = createError('ml', 'COACH_CLOUD_UNSAFE', 'Coach reply failed safety check', {
          retryable: false,
          severity: 'warning',
          details: { metric: safety.metric, reason: safety.reason },
        });
        try {
          logError(unsafeErr, { feature: 'workouts', location: 'coach-service.runCoachTurn' });
        } catch {
          // logError should never throw in prod; keep the rejection code intact.
        }
        throw unsafeErr;
      }
      // evaluateSafety returns the possibly-word-capped text on pass.
      safeResponseText = safety.output;
    }

    // Pipeline v2: shape the response (strips filler, normalizes lists, caps
    // budget — see coach-output-shaper.ts).
    const responseText = isCoachPipelineV2Enabled()
      ? shapeFinalResponse(safeResponseText)
      : safeResponseText;

    const provider = coachProviderFor(result);
    const modelId = result.model ?? (result.providerId === 'openai' ? DEFAULT_MODEL_ID : undefined);

    if (context?.profile?.id && context.sessionId) {
      const userTurns = messages.filter(m => m.role === 'user');
      const insertPayload = {
        user_id: context.profile.id,
        session_id: context.sessionId,
        turn_index: Math.max(0, userTurns.length - 1),
        user_message: userTurns[userTurns.length - 1]?.content ?? '',
        assistant_message: responseText,
        input_messages: messages,
        context: { focus: context.focus },
        metadata: { model: modelId, provider, timestamp: new Date().toISOString() },
      };
      void persistCoachConversation(insertPayload, context.sessionId, context.profile.id);
    }

    const reply: CoachMessage = { role: 'assistant', content: responseText };
    annotate(reply, 'provider', provider);
    if (modelId) annotate(reply, 'model', modelId);

    // Cost-tracker wiring (#537). Fire-and-forget; never blocks the reply.
    const promptText = messages.map((m) => m.content ?? '').join('\n');
    fireAndForgetRecordUsage(provider, opts?.taskKind, promptText, responseText, result.source === 'cache');

    return reply;
  } catch (err) {
    if (err && typeof err === 'object' && 'domain' in err) {
      throw err;
    }

    throw createError(
      'network',
      'COACH_REQUEST_FAILED',
      'Unable to reach the coach service',
      { details: err, retryable: true }
    );
  }
}
