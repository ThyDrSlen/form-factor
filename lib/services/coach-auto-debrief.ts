/**
 * Coach Auto-Debrief Orchestrator
 *
 * When a session finishes, this module:
 *   1. Takes the session id + collected rep analytics (from the caller).
 *   2. Builds the prompt via `coach-debrief-prompt`.
 *   3. Resolves the cloud provider (`openai` by default; pluggable later).
 *   4. Dispatches through `sendCoachPrompt()` with provider metadata.
 *   5. Passes the reply through a minimal output shaper (emojis + list pass).
 *   6. Caches the final brief in AsyncStorage keyed `coach_auto_debrief_${sessionId}`.
 *
 * Gated behind the `EXPO_PUBLIC_COACH_AUTO_DEBRIEF_ENABLED` flag.
 *
 * Cross-PR stubs (to be reconciled after dependent PRs merge):
 *   - TODO(#446): output shaper is inlined — swap for
 *     `@/lib/services/coach-output-shaper.shapeReply` once #448 lands.
 *   - TODO(#454): provider resolver reads `EXPO_PUBLIC_COACH_CLOUD_PROVIDER`
 *     directly and routes through `sendCoachPrompt`; swap for
 *     `resolveCloudProvider` + `sendCoachGemmaPrompt` once #457 lands.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { warnWithTs } from '@/lib/logger';
import { sendCoachPrompt, type CoachContext, type CoachMessage } from './coach-service';
import {
  buildDebriefPrompt,
  type BuildDebriefPromptOptions,
  type DebriefAnalytics,
} from './coach-debrief-prompt';
import { synthesizeMemoryClause } from './coach-memory-context';
import { getExercisePreferences, type CuePreference } from './coach-cue-feedback';
import { isCoachPipelineV2Enabled } from './coach-pipeline-v2-flag';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CoachProvider = 'openai' | 'gemma';

export interface AutoDebriefResult {
  sessionId: string;
  provider: CoachProvider;
  brief: string;
  /** ISO timestamp the brief was generated. */
  generatedAt: string;
}

export interface GenerateAutoDebriefInput {
  sessionId: string;
  analytics: DebriefAnalytics;
  athleteName?: string | null;
  /** Skip the synthesizeMemoryClause() round-trip when caller already has one. */
  memoryClause?: string | null;
  /** Force a specific provider; defaults to the env-resolved choice. */
  provider?: CoachProvider;
}

// ---------------------------------------------------------------------------
// Feature flag
// ---------------------------------------------------------------------------

export function isAutoDebriefEnabled(): boolean {
  const raw = (process.env.EXPO_PUBLIC_COACH_AUTO_DEBRIEF_ENABLED ?? 'true')
    .trim()
    .toLowerCase();
  return raw === '' || raw === 'true' || raw === '1' || raw === 'on';
}

// ---------------------------------------------------------------------------
// Provider resolution
// (TODO(#454): swap for resolveCloudProvider + sendCoachGemmaPrompt once #457 lands.)
// ---------------------------------------------------------------------------

export function resolveCloudProvider(): CoachProvider {
  const raw = (process.env.EXPO_PUBLIC_COACH_CLOUD_PROVIDER ?? 'openai').trim().toLowerCase();
  if (raw === 'gemma') return 'gemma';
  return 'openai';
}

// ---------------------------------------------------------------------------
// Output shaper (inlined pending #448)
// TODO(#446): replace with `@/lib/services/coach-output-shaper.shapeReply`.
// ---------------------------------------------------------------------------

function shapeBriefOutput(text: string): string {
  let out = text.trim();
  // Normalize bullet glyphs the model sometimes emits into standard "-" so
  // the UI's bullet pass is deterministic.
  out = out.replace(/^[•\u2022]\s?/gm, '- ');
  // Collapse runs of emojis to a single representative so the card stays calm.
  out = out.replace(/([\p{Extended_Pictographic}])\1{2,}/gu, '$1');
  // Strip zero-width characters sometimes introduced by copy/paste-style models.
  out = out.replace(/[\u200B-\u200D\uFEFF]/g, '');
  return out;
}

// ---------------------------------------------------------------------------
// AsyncStorage cache
// ---------------------------------------------------------------------------

export const AUTO_DEBRIEF_KEY_PREFIX = 'coach_auto_debrief:';

function cacheKey(sessionId: string): string {
  return `${AUTO_DEBRIEF_KEY_PREFIX}${sessionId}`;
}

export async function getCachedAutoDebrief(sessionId: string): Promise<AutoDebriefResult | null> {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(sessionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AutoDebriefResult;
    if (!parsed?.sessionId || typeof parsed.brief !== 'string') return null;
    return parsed;
  } catch (err) {
    warnWithTs('[coach-auto-debrief] getCachedAutoDebrief parse failed', err);
    return null;
  }
}

export async function cacheAutoDebrief(result: AutoDebriefResult): Promise<void> {
  try {
    await AsyncStorage.setItem(cacheKey(result.sessionId), JSON.stringify(result));
  } catch (err) {
    warnWithTs('[coach-auto-debrief] cacheAutoDebrief failed', err);
  }
}

export async function clearAutoDebrief(sessionId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(cacheKey(sessionId));
  } catch (err) {
    warnWithTs('[coach-auto-debrief] clearAutoDebrief failed', err);
  }
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

/**
 * Generate (or return a cached) auto-debrief for the given session. Always
 * returns a result when the feature flag is enabled and analytics are
 * provided — even the fallback path yields a short coach-authored string.
 *
 * Errors thrown by the downstream coach call propagate so callers (e.g.
 * `use-auto-debrief`) can surface a retry affordance in the UI.
 */
export async function generateAutoDebrief(
  input: GenerateAutoDebriefInput,
): Promise<AutoDebriefResult> {
  if (!isAutoDebriefEnabled()) {
    throw new Error('Auto-debrief disabled by EXPO_PUBLIC_COACH_AUTO_DEBRIEF_ENABLED flag');
  }

  // Return cache when present so double-invocations (e.g. hook remount) are cheap.
  const cached = await getCachedAutoDebrief(input.sessionId);
  if (cached) return cached;

  const provider: CoachProvider = input.provider ?? resolveCloudProvider();

  // Memory clause — either from caller or synthesized fresh. Errors swallow
  // back to null; we never block the debrief on memory synthesis.
  let memoryClause = input.memoryClause ?? null;
  if (memoryClause === null) {
    try {
      const clause = await synthesizeMemoryClause();
      memoryClause = clause.text;
    } catch (err) {
      warnWithTs('[coach-auto-debrief] memory synth failed', err);
      memoryClause = null;
    }
  }

  // Pipeline v2: prefetch cue preferences for the top exercise so the
  // debrief prompt can render a "user prefers X / dislikes Y" clause. We
  // swallow errors: empty prefs → empty clause, never block the debrief.
  let cuePreferences: CuePreference[] | null = null;
  if (isCoachPipelineV2Enabled() && input.analytics.exerciseName) {
    try {
      cuePreferences = await getExercisePreferences(input.analytics.exerciseName);
    } catch (err) {
      warnWithTs('[coach-auto-debrief] cue-prefs lookup failed', err);
      cuePreferences = null;
    }
  }

  const promptOpts: BuildDebriefPromptOptions = {
    athleteName: input.athleteName ?? null,
    memoryClause,
    cuePreferences,
  };
  const messages = buildDebriefPrompt(input.analytics, promptOpts);

  const context: CoachContext = {
    sessionId: input.sessionId,
    focus: 'post_session_debrief',
    memoryClause,
  };
  // Note: provider currently carried as a comment-only concern until #457
  // lands `sendCoachGemmaPrompt`. We still send through the stable
  // sendCoachPrompt so the edge function receives the prompt.
  const reply = await dispatch(provider, messages, context);
  const brief = shapeBriefOutput(reply.content);

  const result: AutoDebriefResult = {
    sessionId: input.sessionId,
    provider,
    brief,
    generatedAt: new Date().toISOString(),
  };

  await cacheAutoDebrief(result);
  return result;
}

async function dispatch(
  provider: CoachProvider,
  messages: CoachMessage[],
  context: CoachContext,
): Promise<CoachMessage> {
  // TODO(#454): when #457 lands, swap the gemma branch to
  // sendCoachGemmaPrompt(messages, context). Today both providers route
  // through sendCoachPrompt so the flow stays testable on main.
  if (provider === 'gemma') {
    try {
      return await sendCoachPrompt(messages, context);
    } catch (err) {
      warnWithTs('[coach-auto-debrief] gemma dispatch failed, falling back to openai', err);
      return sendCoachPrompt(messages, { ...context, focus: 'post_session_debrief' });
    }
  }
  return sendCoachPrompt(messages, context);
}
