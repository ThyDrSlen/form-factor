/**
 * Coach cost tracker — an in-memory + AsyncStorage accumulator for coach
 * token usage. Pure data service; no UI. Callers (cloud provider dispatcher,
 * on-device runner, offline queue) record usage events; consumers read a
 * weekly aggregate to surface "you've used X tokens this week" or block
 * further requests past a budget.
 *
 * Persistence is best-effort — if AsyncStorage is unavailable or throws, we
 * keep the in-memory counter and log a warning. The tracker never crashes
 * the coach path.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { warnWithTs } from '@/lib/logger';

// =============================================================================
// Types
// =============================================================================

export type CoachProvider = 'openai' | 'gemma_cloud' | 'gemma_ondevice' | 'stub';

export type CoachTaskKind =
  | 'chat'
  | 'debrief'
  | 'drill_explainer'
  | 'session_generator'
  | 'progression_planner'
  | 'other';

export interface CoachUsageEvent {
  /** ISO timestamp. Defaults to `new Date().toISOString()` when omitted. */
  at?: string;
  provider: CoachProvider;
  taskKind: CoachTaskKind;
  tokensIn: number;
  tokensOut: number;
  /** Whether this request hit the response cache (no LLM call). */
  cacheHit?: boolean;
}

interface StoredBucket {
  date: string; // YYYY-MM-DD
  provider: CoachProvider;
  taskKind: CoachTaskKind;
  tokensIn: number;
  tokensOut: number;
  cacheHits: number;
  calls: number;
}

export interface WeeklyAggregate {
  rangeStart: string; // inclusive ISO date
  rangeEnd: string; // exclusive ISO date
  totalTokensIn: number;
  totalTokensOut: number;
  totalCalls: number;
  cacheHitRate: number; // 0–1
  byProvider: Record<
    CoachProvider,
    { tokensIn: number; tokensOut: number; calls: number }
  >;
  byTaskKind: Record<
    CoachTaskKind,
    { tokensIn: number; tokensOut: number; calls: number }
  >;
}

// =============================================================================
// Storage layout
// =============================================================================

const STORAGE_KEY = '@form-factor/coach-cost-tracker/v1';
const MAX_RETENTION_DAYS = 35; // keep ~5 weeks of history

// =============================================================================
// In-memory state
// =============================================================================

const state: {
  buckets: StoredBucket[];
  hydrated: boolean;
} = {
  buckets: [],
  hydrated: false,
};

function dateKey(iso: string): string {
  return iso.slice(0, 10);
}

function keyOf(date: string, provider: CoachProvider, taskKind: CoachTaskKind): string {
  return `${date}|${provider}|${taskKind}`;
}

function findBucket(
  buckets: StoredBucket[],
  date: string,
  provider: CoachProvider,
  taskKind: CoachTaskKind,
): StoredBucket | null {
  for (const b of buckets) {
    if (b.date === date && b.provider === provider && b.taskKind === taskKind) return b;
  }
  return null;
}

function pruneOld(buckets: StoredBucket[], today: string, maxDays: number): StoredBucket[] {
  const cutoff = addDaysIso(today, -maxDays);
  return buckets.filter((b) => b.date >= cutoff);
}

function addDaysIso(dateKey10: string, delta: number): string {
  const [y, m, d] = dateKey10.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

// =============================================================================
// Hydration + persistence
// =============================================================================

async function hydrate(): Promise<void> {
  if (state.hydrated) return;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { buckets?: StoredBucket[] };
      if (parsed && Array.isArray(parsed.buckets)) {
        state.buckets = parsed.buckets.filter(isValidBucket);
      }
    }
  } catch (error) {
    warnWithTs('[coach-cost-tracker] failed to hydrate from AsyncStorage', error);
  } finally {
    state.hydrated = true;
  }
}

function isValidBucket(b: unknown): b is StoredBucket {
  if (typeof b !== 'object' || b === null) return false;
  const record = b as Partial<StoredBucket>;
  return (
    typeof record.date === 'string' &&
    typeof record.provider === 'string' &&
    typeof record.taskKind === 'string' &&
    Number.isFinite(record.tokensIn) &&
    Number.isFinite(record.tokensOut) &&
    Number.isFinite(record.cacheHits) &&
    Number.isFinite(record.calls)
  );
}

async function persist(): Promise<void> {
  const payload = JSON.stringify({ buckets: state.buckets });
  try {
    await AsyncStorage.setItem(STORAGE_KEY, payload);
    return;
  } catch (firstError) {
    // Transient backgrounding / memory-pressure failures happen — retry once
    // with a brief delay before giving up. In-memory state remains valid for
    // subsequent reads even if both attempts fail, so the tracker degrades
    // to in-memory-only without crashing the coach path.
    try {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, PERSIST_RETRY_DELAY_MS);
      });
      await AsyncStorage.setItem(STORAGE_KEY, payload);
    } catch (secondError) {
      warnWithTs(
        '[coach-cost-tracker] failed to persist to AsyncStorage after retry',
        secondError,
      );
    }
  }
}

/**
 * Retry delay between the first AsyncStorage failure and the second attempt.
 * Short enough that a blocked app-background transition can settle; small
 * enough that a genuinely broken store surfaces in under a second.
 */
const PERSIST_RETRY_DELAY_MS = 120;

// =============================================================================
// Public API
// =============================================================================

/**
 * Record a coach usage event. Safe to call without awaiting — persistence
 * happens in the background; in-memory state is updated synchronously so
 * subsequent reads return the latest number.
 */
export async function recordCoachUsage(event: CoachUsageEvent): Promise<void> {
  await hydrate();

  const at = event.at ?? new Date().toISOString();
  const date = dateKey(at);
  const tokensIn = Math.max(0, Math.round(event.tokensIn));
  const tokensOut = Math.max(0, Math.round(event.tokensOut));
  const cacheHit = event.cacheHit ? 1 : 0;

  const existing = findBucket(state.buckets, date, event.provider, event.taskKind);
  if (existing) {
    existing.tokensIn += tokensIn;
    existing.tokensOut += tokensOut;
    existing.cacheHits += cacheHit;
    existing.calls += 1;
  } else {
    state.buckets.push({
      date,
      provider: event.provider,
      taskKind: event.taskKind,
      tokensIn,
      tokensOut,
      cacheHits: cacheHit,
      calls: 1,
    });
  }

  state.buckets = pruneOld(state.buckets, date, MAX_RETENTION_DAYS);
  await persist();
}

/**
 * Aggregate usage for the most recent 7 days ending at the given date
 * (defaults to today). `rangeStart`/`rangeEnd` are inclusive/exclusive dates.
 */
export async function getWeeklyAggregate(
  nowIso: string = new Date().toISOString(),
): Promise<WeeklyAggregate> {
  await hydrate();

  const today = dateKey(nowIso);
  const rangeStart = addDaysIso(today, -6);
  const rangeEnd = addDaysIso(today, 1);

  const inWindow = state.buckets.filter((b) => b.date >= rangeStart && b.date < rangeEnd);

  const byProvider = emptyProviderMap();
  const byTaskKind = emptyTaskKindMap();
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let totalCalls = 0;
  let totalCacheHits = 0;

  for (const b of inWindow) {
    totalTokensIn += b.tokensIn;
    totalTokensOut += b.tokensOut;
    totalCalls += b.calls;
    totalCacheHits += b.cacheHits;

    byProvider[b.provider].tokensIn += b.tokensIn;
    byProvider[b.provider].tokensOut += b.tokensOut;
    byProvider[b.provider].calls += b.calls;

    byTaskKind[b.taskKind].tokensIn += b.tokensIn;
    byTaskKind[b.taskKind].tokensOut += b.tokensOut;
    byTaskKind[b.taskKind].calls += b.calls;
  }

  return {
    rangeStart,
    rangeEnd,
    totalTokensIn,
    totalTokensOut,
    totalCalls,
    cacheHitRate: totalCalls === 0 ? 0 : totalCacheHits / totalCalls,
    byProvider,
    byTaskKind,
  };
}

/**
 * Rough char-count → token estimator. ~4 characters per token is a standard
 * approximation for English-plus-code prompts; accurate enough for weekly
 * aggregate budgeting / provider comparison. Replace with a real tokenizer
 * (tiktoken / gemini-equivalent) when the edge functions start surfacing real
 * token counts in their responses (#537 follow-up).
 */
export function estimateTokens(text: string | undefined | null): number {
  if (!text) return 0;
  return Math.max(0, Math.round(text.length / 4));
}

/** Sum estimated tokens across the input-side messages of a coach call. */
export function estimateMessageTokens(
  messages: ReadonlyArray<{ content: string }>,
): number {
  let total = 0;
  for (const m of messages) total += estimateTokens(m.content);
  return total;
}

/**
 * Map the coach dispatcher's task-kind enum (see coach-model-dispatch.ts)
 * onto the cost-tracker's narrower taxonomy. Unmapped tactical kinds
 * collapse to 'chat' (closest fit) so new kinds introduced by the dispatcher
 * don't spray into the 'other' bucket before the UI decides how to surface
 * them.
 */
const DISPATCH_TO_COST_TASK_KIND: Readonly<Record<string, CoachTaskKind>> = {
  multi_turn_debrief: 'debrief',
  fault_explainer: 'drill_explainer',
  session_generator: 'session_generator',
  program_design: 'progression_planner',
  form_cue_lookup: 'chat',
  rest_calc: 'chat',
  encouragement: 'chat',
  nutrition_balance: 'chat',
  form_vision_check: 'chat',
  general_chat: 'chat',
};

export function mapDispatchTaskKindForCost(kind: string | undefined): CoachTaskKind {
  if (!kind) return 'chat';
  return DISPATCH_TO_COST_TASK_KIND[kind] ?? 'other';
}

/**
 * Translate the coach UI provider tag (dash-cased, e.g. `gemma-cloud` in
 * `coach-provider-types.ts`) into the cost-tracker provider enum
 * (underscore-cased here). Returns null for paths that do not represent a
 * billable LLM call (cache, local fallback, or an unknown tag) so callers
 * skip recording.
 */
export function mapCoachProviderForCost(
  provider: string | undefined,
): CoachProvider | null {
  if (!provider) return null;
  if (provider === 'openai') return 'openai';
  if (provider === 'gemma-cloud' || provider === 'gemma_cloud') return 'gemma_cloud';
  if (provider === 'gemma-on-device' || provider === 'gemma_ondevice') return 'gemma_ondevice';
  return null;
}

/**
 * High-level convenience: record usage for a coach reply. Collapses the
 * plumbing (provider mapping, task-kind mapping, token estimation) so
 * call sites stay one-liners. Never throws — persistence errors are swallowed
 * inside `recordCoachUsage`. Returns a promise callers can fire-and-forget.
 */
export async function recordCoachReplyUsage(input: {
  provider: string | undefined;
  taskKind: string | undefined;
  inputMessages: ReadonlyArray<{ content: string }>;
  replyText: string;
  cacheHit?: boolean;
}): Promise<void> {
  const provider = mapCoachProviderForCost(input.provider);
  if (!provider) return;
  await recordCoachUsage({
    provider,
    taskKind: mapDispatchTaskKindForCost(input.taskKind),
    tokensIn: estimateMessageTokens(input.inputMessages),
    tokensOut: estimateTokens(input.replyText),
    cacheHit: input.cacheHit,
  });
}

/** Reset the tracker. Intended for tests and sign-out. */
export async function resetCoachCostTracker(): Promise<void> {
  state.buckets = [];
  state.hydrated = true;
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    warnWithTs('[coach-cost-tracker] failed to clear AsyncStorage', error);
  }
}

/** Internal: forces re-hydration on next call. Tests only. */
export function __invalidateHydrationForTests(): void {
  state.hydrated = false;
  state.buckets = [];
}

function emptyProviderMap(): WeeklyAggregate['byProvider'] {
  return {
    openai: { tokensIn: 0, tokensOut: 0, calls: 0 },
    gemma_cloud: { tokensIn: 0, tokensOut: 0, calls: 0 },
    gemma_ondevice: { tokensIn: 0, tokensOut: 0, calls: 0 },
    stub: { tokensIn: 0, tokensOut: 0, calls: 0 },
  };
}

function emptyTaskKindMap(): WeeklyAggregate['byTaskKind'] {
  return {
    chat: { tokensIn: 0, tokensOut: 0, calls: 0 },
    debrief: { tokensIn: 0, tokensOut: 0, calls: 0 },
    drill_explainer: { tokensIn: 0, tokensOut: 0, calls: 0 },
    session_generator: { tokensIn: 0, tokensOut: 0, calls: 0 },
    progression_planner: { tokensIn: 0, tokensOut: 0, calls: 0 },
    other: { tokensIn: 0, tokensOut: 0, calls: 0 },
  };
}

export const __internal = { STORAGE_KEY, MAX_RETENTION_DAYS };

/** Accessor used to keep `keyOf` reachable for internal re-use and tests. */
export function __keyOfForTests(
  date: string,
  provider: CoachProvider,
  taskKind: CoachTaskKind,
): string {
  return keyOf(date, provider, taskKind);
}
